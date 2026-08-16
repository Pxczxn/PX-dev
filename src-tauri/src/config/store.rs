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
    /// Open or create the config store, ensure initialized and migrated
    pub fn open(app: &AppHandle) -> Result<Self, String> {
        let store = app.store(STORE_FILENAME).map_err(|e| e.to_string())?;
        let config_store = Self { store };
        
        // Ensure all required fields exist
        config_store.ensure_initialized()?;
        
        // Migrate if needed
        config_store.migrate_if_needed()?;
        
        Ok(config_store)
    }

    /// Ensure all required config fields exist (補缺失字段)
    fn ensure_initialized(&self) -> Result<(), String> {
        let mut changed = false;

        // Ensure version exists
        if self.store.get("version").is_none() {
            self.store.set("version", json!(CURRENT_VERSION));
            changed = true;
        }

        // Ensure settings exists
        if self.store.get("settings").is_none() {
            self.store.set("settings", json!(Settings::default()));
            changed = true;
        }

        // Ensure workspaces exists
        if self.store.get("workspaces").is_none() {
            self.store.set("workspaces", json!([]));
            changed = true;
        }

        // Ensure services exists
        if self.store.get("services").is_none() {
            self.store.set("services", json!([]));
            changed = true;
        }

        // Save if any field was added
        if changed {
            self.store.save().map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    /// Get settings
    pub fn get_settings(&self) -> Result<Settings, String> {
        // ConfigStore::open already ensured initialization
        match self.store.get("settings") {
            Some(value) => {
                let mut settings: Settings = serde_json::from_value(value.clone())
                    .map_err(|e| format!("Failed to parse settings: {}", e))?;
                
                // Apply defaults for optional fields
                settings.apply_defaults();
                
                Ok(settings)
            }
            None => {
                // Should not happen after ensure_initialized in open()
                // But return default as defensive fallback
                Ok(Settings::default())
            }
        }
    }

    /// Update settings with patch
    pub fn update_settings(&self, patch: SettingsPatch) -> Result<Settings, String> {
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
    fn get_version(&self) -> Result<u32, String> {
        match self.store.get("version") {
            Some(value) => value
                .as_u64()
                .map(|v| v as u32)
                .ok_or_else(|| "Invalid version format".to_string()),
            None => Ok(CURRENT_VERSION),
        }
    }

    /// Migrate config to current version (called automatically by open())
    fn migrate_if_needed(&self) -> Result<(), String> {
        let current_version = self.get_version()?;
        
        if current_version < CURRENT_VERSION {
            // Future: implement version migration logic
            // Example:
            // if current_version == 1 {
            //     self.migrate_v1_to_v2()?;
            // }
            
            // Update version
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
