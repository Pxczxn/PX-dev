use tauri::{AppHandle, State};
use crate::process::ProcessManager;
use crate::types::ProcessRuntime;

#[tauri::command]
pub async fn start_process(
    app: AppHandle,
    manager: State<'_, ProcessManager>,
    service_id: String,
) -> Result<ProcessRuntime, String> {
    manager.start(&app, &service_id).await
}

#[tauri::command]
pub async fn stop_process(
    app: AppHandle,
    manager: State<'_, ProcessManager>,
    service_id: String,
) -> Result<ProcessRuntime, String> {
    manager.stop(&app, &service_id).await
}

#[tauri::command]
pub async fn restart_process(
    app: AppHandle,
    manager: State<'_, ProcessManager>,
    service_id: String,
) -> Result<ProcessRuntime, String> {
    manager.restart(&app, &service_id).await
}

#[tauri::command]
pub async fn force_kill_process(
    app: AppHandle,
    manager: State<'_, ProcessManager>,
    service_id: String,
) -> Result<serde_json::Value, String> {
    manager.force_kill(&app, &service_id).await?;
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn get_process_runtime(
    manager: State<'_, ProcessManager>,
    service_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let runtimes = manager.get_runtime(service_id.as_deref())?;
    
    if service_id.is_some() {
        // Return single runtime (use first element or return null-like object)
        if let Some(runtime) = runtimes.first() {
            Ok(serde_json::to_value(runtime).unwrap())
        } else {
            // Service exists in config but not in runtime map - return default stopped state
            let default_runtime = ProcessRuntime::new(service_id.unwrap());
            Ok(serde_json::to_value(&default_runtime).unwrap())
        }
    } else {
        // Return array of runtimes (may be empty)
        Ok(serde_json::to_value(&runtimes).unwrap())
    }
}
