use tauri::AppHandle;
use crate::config::ConfigStore;
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
pub async fn delete_workspace(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
    let store = ConfigStore::open(&app)?;
    store.delete_workspace(&id)?;
    Ok(serde_json::json!({ "success": true }))
}
