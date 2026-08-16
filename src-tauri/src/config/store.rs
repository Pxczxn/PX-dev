use tauri::AppHandle;
use tauri_plugin_store::{Store, StoreExt};
use serde_json::json;
use std::sync::Arc;
use crate::types::{AppConfig, Settings, SettingsPatch};

const STORE_FILENAME: &str = "config.json";
const CURRENT_VERSION: u32 = 1;

pub struct ConfigStore {
    store: Arc<Store<tauri::Wry>>,
}

impl ConfigStore {
    /// Open or create the config store
    pub fn open(app: &AppHandle) -> Result<Self, String> {
        let store = app.store(STORE_FILENAME).map_err(|e| e.to_string())?;
        Ok(Self { store })
    }

    /// Ensure config is initialized with default values
    pub fn ensure_initialized(&self) -> Result<(), String> {
        // Check if version exists
        if self.store.get("version").is_some() {
            // Config already initialized
            return Ok(());
        }

        // Initialize with default config
        let config = AppConfig::default();
        self.store.set("version", json!(config.version));
        self.store.set("settings", json!(config.settings));
        self.store.set("workspaces", json!(config.workspaces));
        self.store.set("services", json!(config.services));
        self.store.save().map_err(|e| e.to_string())?;

        Ok(())
    }

    /// Get settings, initializing if necessary
    pub fn get_settings(&self) -> Result<Settings, String> {
        // Ensure initialized
        self.ensure_initialized()?;

        // Get settings
        match self.store.get("settings") {
            Some(value) => {
                let mut settings: Settings = serde_json::from_value(value.clone())
                    .map_err(|e| format!("Failed to parse settings: {}", e))?;
                
                // Apply defaults for optional fields
                settings.apply_defaults();
                
                Ok(settings)
            }
            None => {
                // Should not happen after ensure_initialized, but return default as fallback
                Ok(Settings::default())
            }
        }
    }

    /// Update settings with patch
    pub fn update_settings(&self, patch: SettingsPatch) -> Result<Settings, String> {
        // Ensure initialized
        self.ensure_initialized()?;

        // Get current settings
        let mut current_settings = self.get_settings()?;

        // Apply patch
        patch.apply_to(&mut current_settings);

        // Validate after applying patch
        current_settings.validate()?;

        // Save
        self.store.set("settings", json!(current_settings));
        self.store.save().map_err(|e| e.to_string())?;

        Ok(current_settings)
    }

    /// Get config version
    pub fn get_version(&self) -> Result<u32, String> {
        self.ensure_initialized()?;
        
        match self.store.get("version") {
            Some(value) => value
                .as_u64()
                .map(|v| v as u32)
                .ok_or_else(|| "Invalid version format".to_string()),
            None => Ok(CURRENT_VERSION),
        }
    }

    /// Migrate config to current version (placeholder for future migrations)
    pub fn migrate_if_needed(&self) -> Result<(), String> {
        let current_version = self.get_version()?;
        
        if current_version < CURRENT_VERSION {
            // Future: implement version migration logic
            // For now, just update version
            self.store.set("version", json!(CURRENT_VERSION));
            self.store.save().map_err(|e| e.to_string())?;
        }
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_current_version() {
        assert_eq!(CURRENT_VERSION, 1);
    }
}
