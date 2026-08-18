use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::{ShellExt, process::CommandEvent};
use crate::types::{ProcessRuntime, ProcessStatus, RuntimeChangedPayload};
use crate::config::ConfigStore;
use crate::log::{LogManager, LogEntry, LogStream, decode_bytes};
use super::{build_command, kill_process_tree};

const EVENT_RUNTIME_CHANGED: &str = "runtime:changed";

/// Emit runtime changed event with proper payload structure
fn emit_runtime_changed(app: &AppHandle, service_id: &str, runtime: &ProcessRuntime) {
    let payload = RuntimeChangedPayload {
        service_id: service_id.to_string(),
        runtime: runtime.clone(),
    };
    let _ = app.emit(EVENT_RUNTIME_CHANGED, &payload);
}

pub struct ManagedProcess {
    pub runtime: ProcessRuntime,
    pub pid: Option<u32>,
    pub generation: u64,  // Unique ID for this process instance
    pub termination_intent: Option<TerminationIntent>,  // Why we're stopping
}

#[derive(Clone, Copy, PartialEq)]
pub enum TerminationIntent {
    Stop,       // User requested stop
    ForceKill,  // User requested force kill
}

pub struct ProcessManager {
    processes: Arc<Mutex<HashMap<String, ManagedProcess>>>,
    next_generation: Arc<Mutex<u64>>,
}

impl ProcessManager {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            next_generation: Arc::new(Mutex::new(1)),
        }
    }

    fn allocate_generation(&self) -> u64 {
        let mut gen = self.next_generation.lock().unwrap();
        let current = *gen;
        *gen += 1;
        current
    }

    /// Start a service process
    pub async fn start(&self, app: &AppHandle, service_id: &str) -> Result<ProcessRuntime, String> {
        // Get service from config
        let store = ConfigStore::open(app)?;
        let service = store.get_service(service_id)?;

        // Allocate generation for this process instance
        let generation = self.allocate_generation();

        // Atomic check-and-reserve: within same critical section
        let runtime = {
            let mut processes = self.processes.lock().unwrap();
            
            // Check if already running or stopping
            if let Some(managed) = processes.get(service_id) {
                if matches!(
                    managed.runtime.status,
                    ProcessStatus::Running | ProcessStatus::Starting | ProcessStatus::Stopping
                ) {
                    return Err(format!("Service {} is already running or stopping", service.name));
                }
            }
            
            // Atomically reserve with Starting status
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;

            let mut runtime = ProcessRuntime::new(service_id.to_string());
            runtime.status = ProcessStatus::Starting;
            runtime.started_at = Some(now);

            processes.insert(
                service_id.to_string(),
                ManagedProcess {
                    runtime: runtime.clone(),
                    pid: None,
                    generation,
                    termination_intent: None,
                },
            );
            
            runtime
        };
        // Lock released here - emit Starting status
        emit_runtime_changed(&app, service_id, &runtime);

        // Validate cwd
        if service.cwd.trim().is_empty() {
            // Cleanup: remove the reserved entry
            let mut processes = self.processes.lock().unwrap();
            processes.remove(service_id);
            return Err(format!("Service {} has no working directory configured", service.name));
        }
        // Build platform-specific command
        let built_cmd = build_command(&service);

        // Build command with chaining
        let cmd = app.shell()
            .command(&built_cmd.program)
            .current_dir(&service.cwd);

        // Add args
        let cmd = built_cmd.args.iter().fold(cmd, |c, arg| c.arg(arg));

        // Add env vars
        let cmd = if let Some(env) = &service.env {
            env.iter().fold(cmd, |c, (key, value)| c.env(key, value))
        } else {
            cmd
        };

        // Spawn process
        match cmd.spawn() {
            Ok((mut rx, child)) => {
                let pid = child.pid();
                
                // Update runtime with pid and status
                {
                    let mut processes = self.processes.lock().unwrap();
                    if let Some(managed) = processes.get_mut(service_id) {
                        // Verify generation to prevent race
                        if managed.generation == generation {
                            managed.runtime.pid = Some(pid);
                            managed.runtime.status = ProcessStatus::Running;
                            managed.runtime.ready = false; // Wait for health check (Phase 5)
                            managed.pid = Some(pid);
                        } else {
                            // Race condition: another start() won, cleanup this spawn
                            // (This should be very rare with atomic reserve)
                            return Err("Process reservation race detected".to_string());
                        }
                    }
                }
                // Spawn task to listen for process events
                let service_id_clone = service_id.to_string();
                let processes_clone = self.processes.clone();
                let expected_generation = generation;
                
                // Clone app handle for the async task
                let app_handle = app.clone();
                
                tauri::async_runtime::spawn(async move {
                    // Get LogManager inside the task
                    let log_manager = app_handle.state::<LogManager>();
                    
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(data) => {
                                // Check generation before processing stdout
                                let should_process = {
                                    let processes = processes_clone.lock().unwrap();
                                    if let Some(managed) = processes.get(&service_id_clone) {
                                        managed.generation == expected_generation
                                    } else {
                                        false
                                    }
                                };
                                
                                if should_process {
                                    // Convert bytes to string using lossy conversion for safety
                                    let text = decode_bytes(&data);
                                    let entry = LogEntry::new(
                                        service_id_clone.clone(),
                                        LogStream::Stdout,
                                        text,
                                    );
                                    log_manager.append(entry);
                                }
                            }
                            CommandEvent::Stderr(data) => {
                                // Check generation before processing stderr
                                let should_process = {
                                    let processes = processes_clone.lock().unwrap();
                                    if let Some(managed) = processes.get(&service_id_clone) {
                                        managed.generation == expected_generation
                                    } else {
                                        false
                                    }
                                };
                                
                                if should_process {
                                    // Convert bytes to string using lossy conversion for safety
                                    let text = decode_bytes(&data);
                                    let entry = LogEntry::new(
                                        service_id_clone.clone(),
                                        LogStream::Stderr,
                                        text,
                                    );
                                    log_manager.append(entry);
                                }
                            }
                            CommandEvent::Terminated(payload) => {
                                let mut processes = processes_clone.lock().unwrap();
                                if let Some(managed) = processes.get_mut(&service_id_clone) {
                                    // Check generation to avoid stale events
                                    if managed.generation != expected_generation {
                                        continue;
                                    }
                                    
                                    let now = std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap()
                                        .as_millis() as u64;
                                    
                                    managed.runtime.stopped_at = Some(now);
                                    managed.runtime.exit_code = payload.code;
                                    managed.runtime.ready = false;
                                    managed.runtime.pid = None; // Clear PID
                                    managed.pid = None;
                                    
                                    // Determine final status based on termination intent
                                    if let Some(_intent) = managed.termination_intent {
                                        // User requested stop/forceKill - always mark as Stopped
                                        managed.runtime.status = ProcessStatus::Stopped;
                                        managed.termination_intent = None; // Clear intent
                                    } else {
                                        // Natural exit
                                        if payload.code == Some(0) {
                                            managed.runtime.status = ProcessStatus::Exited;
                                        } else {
                                            managed.runtime.status = ProcessStatus::Failed;
                                        }
                                    }
                                    
                                    // Emit runtime changed event
                                    let runtime = managed.runtime.clone();
                                    drop(processes); // Release lock before emitting
                                    emit_runtime_changed(&app_handle, &service_id_clone, &runtime);
                                }
                            }
                            CommandEvent::Error(error) => {
                                let mut processes = processes_clone.lock().unwrap();
                                if let Some(managed) = processes.get_mut(&service_id_clone) {
                                    // Check generation
                                    if managed.generation != expected_generation {
                                        continue;
                                    }
                                    
                                    // Error event doesn't mean process died - just log it
                                    managed.runtime.error = Some(error);
                                }
                            }
                            _ => {}
                        }
                    }
                });

                // Return current runtime
                let runtime = {
                    let processes = self.processes.lock().unwrap();
                    processes.get(service_id).unwrap().runtime.clone()
                };
                
                // Emit runtime changed event
                emit_runtime_changed(&app, service_id, &runtime);
                
                Ok(runtime)
            }
            Err(e) => {
                // Cleanup: remove the reserved entry on spawn failure
                let runtime = {
                    let mut processes = self.processes.lock().unwrap();
                    if let Some(managed) = processes.get_mut(service_id) {
                        if managed.generation == generation {
                            managed.runtime.status = ProcessStatus::Failed;
                            managed.runtime.error = Some(format!("Failed to spawn process: {}", e));
                            managed.runtime.clone()
                        } else {
                            return Err(format!("Failed to start service {}: {}", service.name, e));
                        }
                    } else {
                        return Err(format!("Failed to start service {}: {}", service.name, e));
                    }
                };
                
                // Emit failure status
                emit_runtime_changed(&app, service_id, &runtime);

                Err(format!("Failed to start service {}: {}", service.name, e))
            }
        }
    }

    /// Wait for process termination (used by stop and forceKill)
    async fn wait_for_termination(
        &self,
        service_id: &str,
        timeout: Duration,
    ) -> Result<ProcessRuntime, String> {
        let start = Instant::now();
        
        loop {
            tokio::time::sleep(Duration::from_millis(100)).await;
            
            // Check if process terminated
            let status = {
                let processes = self.processes.lock().unwrap();
                if let Some(managed) = processes.get(service_id) {
                    managed.runtime.status.clone()
                } else {
                    return Err("Service disappeared during wait".to_string());
                }
            };
            
            if matches!(status, ProcessStatus::Stopped | ProcessStatus::Exited | ProcessStatus::Failed) {
                // Process terminated
                break;
            }
            
            if start.elapsed() > timeout {
                return Err("Timeout waiting for process termination".to_string());
            }
        }

        // Return final runtime
        let runtime = {
            let processes = self.processes.lock().unwrap();
            processes.get(service_id).unwrap().runtime.clone()
        };

        Ok(runtime)
    }

    /// Stop a service process (graceful, waits for exit with timeout)
    pub async fn stop(&self, _app: &AppHandle, service_id: &str) -> Result<ProcessRuntime, String> {
        let pid = {
            let processes = self.processes.lock().unwrap();
            let managed = processes
                .get(service_id)
                .ok_or_else(|| format!("Service {} not found", service_id))?;

            if matches!(
                managed.runtime.status,
                ProcessStatus::Stopped | ProcessStatus::Exited | ProcessStatus::Failed
            ) {
                return Ok(managed.runtime.clone());
            }

            managed.pid.ok_or_else(|| format!("Service {} has no PID", service_id))?
        };

        // Update status to stopping and set intent
        let runtime = {
            let mut processes = self.processes.lock().unwrap();
            if let Some(managed) = processes.get_mut(service_id) {
                managed.runtime.status = ProcessStatus::Stopping;
                managed.termination_intent = Some(TerminationIntent::Stop);
                managed.runtime.clone()
            } else {
                return Err(format!("Service {} not found during stop", service_id));
            }
        };
        
        // Emit Stopping status
        emit_runtime_changed(_app, service_id, &runtime);

        // Try graceful termination first (no /F on Windows)
        if let Err(_e) = kill_process_tree(pid, false) {
            // If graceful kill fails, try force kill
            kill_process_tree(pid, true)?;
        }

        // Wait for process to actually terminate (with timeout)
        match self.wait_for_termination(service_id, Duration::from_secs(5)).await {
            Ok(runtime) => Ok(runtime),
            Err(_) => {
                // Timeout, force kill
                kill_process_tree(pid, true)?;
                
                // Wait a bit more
                tokio::time::sleep(Duration::from_millis(500)).await;
                
                // Update to stopped if still not updated
                let runtime = {
                    let mut processes = self.processes.lock().unwrap();
                    if let Some(managed) = processes.get_mut(service_id) {
                        if managed.runtime.status == ProcessStatus::Stopping {
                            let now = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap()
                                .as_millis() as u64;
                            
                            managed.runtime.status = ProcessStatus::Stopped;
                            managed.runtime.stopped_at = Some(now);
                            managed.runtime.ready = false;
                            managed.runtime.pid = None;
                            managed.pid = None;
                            managed.termination_intent = None;
                        }
                        managed.runtime.clone()
                    } else {
                        return Err(format!("Service {} not found after timeout", service_id));
                    }
                };
                
                // Emit timeout stopped status
                emit_runtime_changed(_app, service_id, &runtime);
                
                Ok(runtime)
            }
        }
    }

    /// Restart a service process
    pub async fn restart(&self, app: &AppHandle, service_id: &str) -> Result<ProcessRuntime, String> {
        // Stop first (this waits for actual termination)
        self.stop(app, service_id).await?;
        
        // No need for additional sleep - stop() already waited
        
        self.start(app, service_id).await
    }

    /// Force kill a service process (waits for termination)
    pub async fn force_kill(&self, _app: &AppHandle, service_id: &str) -> Result<(), String> {
        let pid = {
            let processes = self.processes.lock().unwrap();
            let managed = processes
                .get(service_id)
                .ok_or_else(|| format!("Service {} not found", service_id))?;
            managed.pid.ok_or_else(|| format!("Service {} has no PID", service_id))?
        };

        // Update status to stopping BEFORE killing and set intent
        let runtime = {
            let mut processes = self.processes.lock().unwrap();
            if let Some(managed) = processes.get_mut(service_id) {
                managed.runtime.status = ProcessStatus::Stopping;
                managed.termination_intent = Some(TerminationIntent::ForceKill);
                managed.runtime.clone()
            } else {
                return Err(format!("Service {} not found during force kill", service_id));
            }
        };
        
        // Emit Stopping status
        emit_runtime_changed(_app, service_id, &runtime);

        // Force kill process tree
        kill_process_tree(pid, true)?;

        // Wait for Terminated event to update status
        match self.wait_for_termination(service_id, Duration::from_secs(3)).await {
            Ok(_) => Ok(()),
            Err(_) => {
                // Timeout - manually update to stopped
                let runtime = {
                    let mut processes = self.processes.lock().unwrap();
                    if let Some(managed) = processes.get_mut(service_id) {
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_millis() as u64;
                        
                        managed.runtime.status = ProcessStatus::Stopped;
                        managed.runtime.stopped_at = Some(now);
                        managed.runtime.ready = false;
                        managed.runtime.pid = None;
                        managed.pid = None;
                        managed.termination_intent = None;
                        managed.runtime.clone()
                    } else {
                        return Ok(());
                    }
                };
                
                // Emit timeout stopped status
                emit_runtime_changed(_app, service_id, &runtime);
                
                Ok(())
            }
        }
    }

    /// Get runtime for one or all services
    pub fn get_runtime(&self, service_id: Option<&str>) -> Result<Vec<ProcessRuntime>, String> {
        let processes = self.processes.lock().unwrap();

        match service_id {
            Some(id) => {
                let managed = processes
                    .get(id)
                    .ok_or_else(|| format!("Service {} not found", id))?;
                Ok(vec![managed.runtime.clone()])
            }
            None => {
                let runtimes: Vec<ProcessRuntime> = processes
                    .values()
                    .map(|m| m.runtime.clone())
                    .collect();
                Ok(runtimes)
            }
        }
    }

    /// Stop a service if it's running (used before deletion)
    pub async fn stop_if_running(&self, app: &AppHandle, service_id: &str) -> Result<(), String> {
        let is_running = {
            let processes = self.processes.lock().unwrap();
            if let Some(managed) = processes.get(service_id) {
                !matches!(
                    managed.runtime.status,
                    ProcessStatus::Stopped | ProcessStatus::Exited | ProcessStatus::Failed
                )
            } else {
                false
            }
        };

        if is_running {
            self.stop(app, service_id).await?;
        }

        Ok(())
    }

    /// Remove a service from tracking (used after deletion)
    pub fn remove_service(&self, service_id: &str) {
        let mut processes = self.processes.lock().unwrap();
        processes.remove(service_id);
    }

    /// Stop all services in a workspace
    #[allow(dead_code)]
    pub async fn stop_workspace(&self, app: &AppHandle, service_ids: &[String]) -> Result<(), String> {
        for service_id in service_ids {
            self.stop_if_running(app, service_id).await?;
        }
        Ok(())
    }

    /// Force kill all running processes (used on app exit)
    pub async fn force_kill_all(&self, app: &AppHandle) -> Result<(), String> {
        let service_ids: Vec<String> = {
            let processes = self.processes.lock().unwrap();
            processes.keys().cloned().collect()
        };

        for service_id in service_ids {
            let _ = self.force_kill(app, &service_id).await; // Ignore errors during shutdown
        }

        Ok(())
    }
}
