use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tauri_plugin_shell::{ShellExt, process::CommandEvent};
use crate::types::{ProcessRuntime, ProcessStatus};
use crate::config::ConfigStore;
use super::{build_command, kill_process_tree};

pub struct ManagedProcess {
    pub runtime: ProcessRuntime,
    pub pid: Option<u32>,
}

pub struct ProcessManager {
    processes: Arc<Mutex<HashMap<String, ManagedProcess>>>,
}

impl ProcessManager {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Start a service process
    pub async fn start(&self, app: &AppHandle, service_id: &str) -> Result<ProcessRuntime, String> {
        // Get service from config
        let store = ConfigStore::open(app)?;
        let service = store.get_service(service_id)?;

        // Check if already running
        {
            let processes = self.processes.lock().unwrap();
            if let Some(managed) = processes.get(service_id) {
                if matches!(
                    managed.runtime.status,
                    ProcessStatus::Running | ProcessStatus::Starting
                ) {
                    return Err(format!("Service {} is already running", service.name));
                }
            }
        }

        // Validate cwd
        if service.cwd.trim().is_empty() {
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

        // Update status to starting
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let mut runtime = ProcessRuntime::new(service_id.to_string());
        runtime.status = ProcessStatus::Starting;
        runtime.started_at = Some(now);

        {
            let mut processes = self.processes.lock().unwrap();
            processes.insert(
                service_id.to_string(),
                ManagedProcess {
                    runtime: runtime.clone(),
                    pid: None,
                },
            );
        }

        // Spawn process
        match cmd.spawn() {
            Ok((mut rx, child)) => {
                let pid = child.pid();
                
                // Update runtime with pid and status
                runtime.pid = Some(pid);
                runtime.status = ProcessStatus::Running;
                // Don't set ready=true yet - wait for health check (Phase 5)
                runtime.ready = false;

                {
                    let mut processes = self.processes.lock().unwrap();
                    if let Some(managed) = processes.get_mut(service_id) {
                        managed.runtime = runtime.clone();
                        managed.pid = Some(pid);
                    }
                }

                // Spawn task to listen for process events
                let service_id_clone = service_id.to_string();
                let processes_clone = self.processes.clone();
                
                tauri::async_runtime::spawn(async move {
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Terminated(payload) => {
                                let mut processes = processes_clone.lock().unwrap();
                                if let Some(managed) = processes.get_mut(&service_id_clone) {
                                    let now = std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap()
                                        .as_millis() as u64;
                                    
                                    managed.runtime.stopped_at = Some(now);
                                    managed.runtime.exit_code = payload.code;
                                    managed.runtime.ready = false;
                                    
                                    // Determine final status
                                    if managed.runtime.status == ProcessStatus::Stopping {
                                        managed.runtime.status = ProcessStatus::Stopped;
                                    } else if payload.code == Some(0) {
                                        managed.runtime.status = ProcessStatus::Exited;
                                    } else {
                                        managed.runtime.status = ProcessStatus::Failed;
                                    }
                                }
                            }
                            CommandEvent::Error(error) => {
                                let mut processes = processes_clone.lock().unwrap();
                                if let Some(managed) = processes.get_mut(&service_id_clone) {
                                    managed.runtime.status = ProcessStatus::Failed;
                                    managed.runtime.error = Some(error);
                                    managed.runtime.ready = false;
                                }
                            }
                            CommandEvent::Stdout(_) | CommandEvent::Stderr(_) => {
                                // Phase 5: Forward to LogManager
                            }
                            _ => {}
                        }
                    }
                });

                Ok(runtime)
            }
            Err(e) => {
                runtime.status = ProcessStatus::Failed;
                runtime.error = Some(format!("Failed to spawn process: {}", e));

                {
                    let mut processes = self.processes.lock().unwrap();
                    if let Some(managed) = processes.get_mut(service_id) {
                        managed.runtime = runtime.clone();
                    }
                }

                Err(format!("Failed to start service {}: {}", service.name, e))
            }
        }
    }

    /// Stop a service process (graceful, waits for exit)
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

        // Update status to stopping
        {
            let mut processes = self.processes.lock().unwrap();
            if let Some(managed) = processes.get_mut(service_id) {
                managed.runtime.status = ProcessStatus::Stopping;
            }
        }

        // Kill process tree (graceful on Windows still uses /F due to .cmd wrappers)
        kill_process_tree(pid, false)?;

        // Wait for Terminated event to update status
        // For now, return current runtime (Terminated event will update asynchronously)
        let runtime = {
            let processes = self.processes.lock().unwrap();
            processes.get(service_id).unwrap().runtime.clone()
        };

        Ok(runtime)
    }

    /// Restart a service process
    pub async fn restart(&self, app: &AppHandle, service_id: &str) -> Result<ProcessRuntime, String> {
        self.stop(app, service_id).await?;
        
        // Wait a bit for process to fully terminate and ports to release
        std::thread::sleep(std::time::Duration::from_millis(500));
        
        self.start(app, service_id).await
    }

    /// Force kill a service process
    pub async fn force_kill(&self, _app: &AppHandle, service_id: &str) -> Result<(), String> {
        let pid = {
            let processes = self.processes.lock().unwrap();
            let managed = processes
                .get(service_id)
                .ok_or_else(|| format!("Service {} not found", service_id))?;
            managed.pid.ok_or_else(|| format!("Service {} has no PID", service_id))?
        };

        // Force kill process tree
        kill_process_tree(pid, true)?;

        // Terminated event will handle status update
        Ok(())
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
}
