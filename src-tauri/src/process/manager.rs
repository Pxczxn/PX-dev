use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use sysinfo::{System, Pid, Signal, ProcessesToUpdate};
use crate::types::{ProcessRuntime, ProcessStatus};
use crate::config::ConfigStore;

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

        // Build command with chaining
        let cmd = app.shell()
            .command(&service.command)
            .current_dir(&service.cwd);

        // Add args
        let cmd = if let Some(args) = &service.args {
            args.iter().fold(cmd, |c, arg| c.arg(arg))
        } else {
            cmd
        };

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
            Ok((_rx, child)) => {
                let pid = child.pid();
                
                // Update runtime with pid and status
                runtime.pid = Some(pid);
                runtime.status = ProcessStatus::Running;
                runtime.ready = true;

                {
                    let mut processes = self.processes.lock().unwrap();
                    if let Some(managed) = processes.get_mut(service_id) {
                        managed.runtime = runtime.clone();
                        managed.pid = Some(pid);
                    }
                }

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

    /// Stop a service process
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

        // Kill process using sysinfo
        let mut sys = System::new();
        sys.refresh_processes(ProcessesToUpdate::All, true);
        
        let pid_obj = Pid::from_u32(pid);
        if let Some(process) = sys.process(pid_obj) {
            if process.kill_with(Signal::Term).is_none() {
                return Err(format!("Failed to send SIGTERM to process {}", pid));
            }
        } else {
            return Err(format!("Process {} not found", pid));
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let mut runtime = {
            let processes = self.processes.lock().unwrap();
            processes.get(service_id).unwrap().runtime.clone()
        };

        runtime.status = ProcessStatus::Stopped;
        runtime.stopped_at = Some(now);
        runtime.ready = false;

        {
            let mut processes = self.processes.lock().unwrap();
            if let Some(managed) = processes.get_mut(service_id) {
                managed.runtime = runtime.clone();
            }
        }

        Ok(runtime)
    }

    /// Restart a service process
    pub async fn restart(&self, app: &AppHandle, service_id: &str) -> Result<ProcessRuntime, String> {
        self.stop(app, service_id).await?;
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

        // Force kill using sysinfo
        let mut sys = System::new();
        sys.refresh_processes(ProcessesToUpdate::All, true);
        
        let pid_obj = Pid::from_u32(pid);
        if let Some(process) = sys.process(pid_obj) {
            if process.kill_with(Signal::Kill).is_none() {
                return Err(format!("Failed to send SIGKILL to process {}", pid));
            }
        } else {
            return Err(format!("Process {} not found", pid));
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        {
            let mut processes = self.processes.lock().unwrap();
            if let Some(managed) = processes.get_mut(service_id) {
                managed.runtime.status = ProcessStatus::Stopped;
                managed.runtime.stopped_at = Some(now);
                managed.runtime.ready = false;
            }
        }

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
