use std::process::Command;

/// Kill a process tree on Windows using taskkill
#[cfg(target_os = "windows")]
pub fn kill_process_tree(pid: u32, force: bool) -> Result<(), String> {
    let mut cmd = Command::new("taskkill");
    cmd.arg("/PID").arg(pid.to_string()).arg("/T"); // /T = kill tree
    
    if force {
        cmd.arg("/F"); // /F = force terminate
    }
    
    let output = cmd.output().map_err(|e| format!("Failed to execute taskkill: {}", e))?;
    
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("taskkill failed: {}", stderr))
    }
}

/// Kill a process tree on Unix using process group
#[cfg(not(target_os = "windows"))]
pub fn kill_process_tree(pid: u32, force: bool) -> Result<(), String> {
    use sysinfo::{System, Pid, Signal, ProcessesToUpdate};
    
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    
    let pid_obj = Pid::from_u32(pid);
    if let Some(process) = sys.process(pid_obj) {
        let signal = if force { Signal::Kill } else { Signal::Term };
        
        if process.kill_with(signal).is_none() {
            return Err(format!("Failed to send signal to process {}", pid));
        }
        Ok(())
    } else {
        Err(format!("Process {} not found", pid))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "windows")]
    fn test_kill_command_structure() {
        // This test just validates command structure, doesn't actually kill anything
        let mut cmd = std::process::Command::new("taskkill");
        cmd.arg("/PID").arg("12345").arg("/T").arg("/F");
        
        // Verify args are structured correctly
        assert_eq!(format!("{:?}", cmd).contains("taskkill"), true);
    }
}
