use tauri::{AppHandle, State};
use crate::config::ConfigStore;
use crate::process::ProcessManager;
use crate::log::LogManager;
use crate::types::{Workspace, WorkspaceInput, WorkspacePatch};

#[tauri::command]
pub async fn list_workspaces(app: AppHandle) -> Result<Vec<Workspace>, String> {
    let store = ConfigStore::open(&app)?;
    store.list_workspaces()
}

#[tauri::command]
pub async fn create_workspace(
    app: AppHandle,
    input: serde_json::Value,
) -> Result<Workspace, String> {
    let store = ConfigStore::open(&app)?;
    let workspace_input: WorkspaceInput = serde_json::from_value(input)
        .map_err(|e| format!("Invalid workspace input: {}", e))?;
    store.create_workspace(workspace_input)
}

#[tauri::command]
pub async fn update_workspace(
    app: AppHandle,
    input: serde_json::Value,
) -> Result<Workspace, String> {
    let store = ConfigStore::open(&app)?;
    
    // Extract id from input
    let id = input
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing workspace id".to_string())?
        .to_string();
    
    let patch: WorkspacePatch = serde_json::from_value(input)
        .map_err(|e| format!("Invalid workspace patch: {}", e))?;
    
    store.update_workspace(&id, patch)
}

#[tauri::command]
pub async fn delete_workspace(
    app: AppHandle,
    manager: State<'_, ProcessManager>,
    log_manager: State<'_, LogManager>,
    id: String,
) -> Result<serde_json::Value, String> {
    let store = ConfigStore::open(&app)?;
    
    // Get all services in this workspace
    let services = store.list_services_by_workspace(&id)?;
    let service_ids: Vec<String> = services.iter().map(|s| s.id.clone()).collect();
    
    // Stop all running processes in this workspace
    manager.stop_workspace(&app, &service_ids).await?;
    
    // Remove from tracking and clean up logs
    for service_id in &service_ids {
        manager.remove_service(service_id);
        log_manager.remove_service(service_id);
    }
    
    // Delete workspace (cascades to services)
    store.delete_workspace(&id)?;
    
    Ok(serde_json::json!({ "success": true }))
}
