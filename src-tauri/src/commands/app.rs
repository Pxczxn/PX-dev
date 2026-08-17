use tauri::{AppHandle, State};
use crate::config::ConfigStore;
use crate::log::LogManager;
use crate::types::{Settings, SettingsPatch};

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Result<Settings, String> {
    let store = ConfigStore::open(&app)?;
    store.get_settings()
}

#[tauri::command]
pub async fn update_settings(
    app: AppHandle,
    log_manager: State<'_, LogManager>,
    input: serde_json::Value,
) -> Result<Settings, String> {
    let store = ConfigStore::open(&app)?;
    
    // Parse input as SettingsPatch
    let patch: SettingsPatch = serde_json::from_value(input)
        .map_err(|e| format!("Invalid settings input: {}", e))?;
    
    // Sync maxLogLines to LogManager if changed
    if let Some(max_lines) = patch.max_log_lines {
        log_manager.set_max_lines(max_lines as usize);
    }
    
    store.update_settings(patch)
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
