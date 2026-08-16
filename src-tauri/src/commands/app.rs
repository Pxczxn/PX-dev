use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use serde_json::json;
use crate::types::{AppConfig, Settings};

const STORE_FILENAME: &str = "config.json";

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Result<Settings, String> {
    let store = app.store(STORE_FILENAME).map_err(|e| e.to_string())?;
    
    // Try to get settings from store
    match store.get("settings") {
        Some(value) => {
            serde_json::from_value(value.clone())
                .map_err(|e| format!("Failed to parse settings: {}", e))
        }
        None => {
            // No settings found, initialize with defaults
            let config = AppConfig::default();
            let settings = config.settings.clone();
            
            // Save default config to store
            store.set("version", json!(config.version));
            store.set("settings", json!(settings));
            store.set("workspaces", json!(config.workspaces));
            store.set("services", json!(config.services));
            store.save().map_err(|e| e.to_string())?;
            
            Ok(settings)
        }
    }
}

#[tauri::command]
pub async fn update_settings(
    app: AppHandle,
    input: serde_json::Value,
) -> Result<Settings, String> {
    let store = app.store(STORE_FILENAME).map_err(|e| e.to_string())?;
    
    // Get current settings
    let mut current_settings = match store.get("settings") {
        Some(value) => serde_json::from_value::<Settings>(value.clone())
            .map_err(|e| format!("Failed to parse current settings: {}", e))?,
        None => Settings::default(),
    };
    
    // Merge input into current settings (handle both camelCase from TypeScript and snake_case)
    if let Some(obj) = input.as_object() {
        for (key, value) in obj {
            match key.as_str() {
                "theme" => {
                    if let Some(s) = value.as_str() {
                        current_settings.theme = s.to_string();
                    }
                }
                "closeBehavior" | "close_behavior" => {
                    if let Some(s) = value.as_str() {
                        current_settings.close_behavior = s.to_string();
                    }
                }
                "maxLogLines" | "max_log_lines" => {
                    if let Some(n) = value.as_u64() {
                        current_settings.max_log_lines = n as u32;
                    }
                }
                "startMinimized" | "start_minimized" => {
                    if let Some(b) = value.as_bool() {
                        current_settings.start_minimized = b;
                    }
                }
                "autoRestoreLastSession" | "auto_restore_last_session" => {
                    if let Some(b) = value.as_bool() {
                        current_settings.auto_restore_last_session = b;
                    }
                }
                "startupInterval" | "startup_interval" => {
                    if let Some(n) = value.as_u64() {
                        current_settings.startup_interval = n as u32;
                    }
                }
                "showTimestamp" | "show_timestamp" => {
                    if let Some(b) = value.as_bool() {
                        current_settings.show_timestamp = b;
                    }
                }
                "defaultBrowser" | "default_browser" => {
                    if let Some(s) = value.as_str() {
                        current_settings.default_browser = s.to_string();
                    }
                }
                "dataPath" | "data_path" => {
                    current_settings.data_path = value.as_str().map(|s| s.to_string());
                }
                _ => {}
            }
        }
    }
    
    // Save updated settings
    store.set("settings", json!(current_settings));
    store.save().map_err(|e| e.to_string())?;
    
    Ok(current_settings)
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
