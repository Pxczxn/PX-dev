use tauri::AppHandle;
use crate::config::ConfigStore;
use crate::types::{Settings, SettingsPatch};

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Result<Settings, String> {
    let store = ConfigStore::open(&app)?;
    store.get_settings()
}

#[tauri::command]
pub async fn update_settings(
    app: AppHandle,
    input: serde_json::Value,
) -> Result<Settings, String> {
    let store = ConfigStore::open(&app)?;
    
    // Parse input as SettingsPatch
    let patch: SettingsPatch = serde_json::from_value(input)
        .map_err(|e| format!("Invalid settings input: {}", e))?;
    
    store.update_settings(patch)
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
