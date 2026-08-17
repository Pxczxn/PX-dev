use tauri::AppHandle;
use crate::config::ConfigStore;
use crate::types::{Service, ServiceInput, ServicePatch};

#[tauri::command]
pub async fn list_services(
    app: AppHandle,
    workspace_id: Option<String>,
) -> Result<Vec<Service>, String> {
    let store = ConfigStore::open(&app)?;
    
    match workspace_id {
        Some(id) => store.list_services_by_workspace(&id),
        None => store.list_services(),
    }
}

#[tauri::command]
pub async fn create_service(
    app: AppHandle,
    input: serde_json::Value,
) -> Result<Service, String> {
    let store = ConfigStore::open(&app)?;
    let service_input: ServiceInput = serde_json::from_value(input)
        .map_err(|e| format!("Invalid service input: {}", e))?;
    store.create_service(service_input)
}

#[tauri::command]
pub async fn update_service(
    app: AppHandle,
    input: serde_json::Value,
) -> Result<Service, String> {
    let store = ConfigStore::open(&app)?;
    
    // Extract id from input
    let id = input
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing service id".to_string())?
        .to_string();
    
    let patch: ServicePatch = serde_json::from_value(input)
        .map_err(|e| format!("Invalid service patch: {}", e))?;
    
    store.update_service(&id, patch)
}

#[tauri::command]
pub async fn delete_service(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
    let store = ConfigStore::open(&app)?;
    store.delete_service(&id)?;
    Ok(serde_json::json!({ "success": true }))
}
