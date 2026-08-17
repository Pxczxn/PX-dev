use tauri::AppHandle;
use tauri_plugin_store::{Store, StoreExt};
use serde_json::json;
use std::sync::Arc;
use crate::types::{
    Settings, SettingsPatch,
    Workspace, WorkspaceInput, WorkspacePatch,
    Service, ServiceInput, ServicePatch,
};

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

    // ============ Settings ============

    /// Get settings
    pub fn get_settings(&self) -> Result<Settings, String> {
        match self.store.get("settings") {
            Some(value) => {
                let mut settings: Settings = serde_json::from_value(value.clone())
                    .map_err(|e| format!("Failed to parse settings: {}", e))?;
                
                settings.apply_defaults();
                settings.validate()?;
                Ok(settings)
            }
            None => {
                Ok(Settings::default())
            }
        }
    }

    /// Update settings with patch
    pub fn update_settings(&self, patch: SettingsPatch) -> Result<Settings, String> {
        let mut current_settings = self.get_settings()?;
        patch.apply_to(&mut current_settings);
        current_settings.validate()?;

        self.store.set("settings", json!(current_settings));
        self.store.save().map_err(|e| e.to_string())?;

        Ok(current_settings)
    }

    // ============ Workspace CRUD ============

    /// List all workspaces
    pub fn list_workspaces(&self) -> Result<Vec<Workspace>, String> {
        match self.store.get("workspaces") {
            Some(value) => {
                serde_json::from_value(value.clone())
                    .map_err(|e| format!("Failed to parse workspaces: {}", e))
            }
            None => Ok(Vec::new()),
        }
    }

    /// Get workspace by ID
    pub fn get_workspace(&self, id: &str) -> Result<Workspace, String> {
        let workspaces = self.list_workspaces()?;
        workspaces
            .into_iter()
            .find(|w| w.id == id)
            .ok_or_else(|| format!("Workspace not found: {}", id))
    }

    /// Create workspace
    pub fn create_workspace(&self, input: WorkspaceInput) -> Result<Workspace, String> {
        let now = chrono::Utc::now().to_rfc3339();
        let workspace = Workspace {
            id: uuid::Uuid::new_v4().to_string(),
            name: input.name,
            description: input.description,
            root_path: input.root_path,
            color: input.color,
            icon: input.icon,
            favorite: input.favorite.unwrap_or(false),
            start_mode: input.start_mode.unwrap_or_default(),
            created_at: now.clone(),
            updated_at: now,
        };

        workspace.validate()?;

        let mut workspaces = self.list_workspaces()?;
        workspaces.push(workspace.clone());

        self.store.set("workspaces", json!(workspaces));
        self.store.save().map_err(|e| e.to_string())?;

        Ok(workspace)
    }

    /// Update workspace
    pub fn update_workspace(&self, id: &str, patch: WorkspacePatch) -> Result<Workspace, String> {
        let mut workspaces = self.list_workspaces()?;
        let workspace = workspaces
            .iter_mut()
            .find(|w| w.id == id)
            .ok_or_else(|| format!("Workspace not found: {}", id))?;

        patch.apply_to(workspace);
        workspace.validate()?;

        let updated = workspace.clone();

        self.store.set("workspaces", json!(workspaces));
        self.store.save().map_err(|e| e.to_string())?;

        Ok(updated)
    }

    /// Delete workspace and its services
    pub fn delete_workspace(&self, id: &str) -> Result<(), String> {
        let mut workspaces = self.list_workspaces()?;
        let index = workspaces
            .iter()
            .position(|w| w.id == id)
            .ok_or_else(|| format!("Workspace not found: {}", id))?;

        workspaces.remove(index);

        // Also delete all services belonging to this workspace
        let mut services = self.list_services()?;
        services.retain(|s| s.workspace_id != id);

        self.store.set("workspaces", json!(workspaces));
        self.store.set("services", json!(services));
        self.store.save().map_err(|e| e.to_string())?;

        Ok(())
    }

    // ============ Service CRUD ============

    /// List all services
    pub fn list_services(&self) -> Result<Vec<Service>, String> {
        match self.store.get("services") {
            Some(value) => {
                serde_json::from_value(value.clone())
                    .map_err(|e| format!("Failed to parse services: {}", e))
            }
            None => Ok(Vec::new()),
        }
    }

    /// List services by workspace ID
    pub fn list_services_by_workspace(&self, workspace_id: &str) -> Result<Vec<Service>, String> {
        let services = self.list_services()?;
        Ok(services.into_iter().filter(|s| s.workspace_id == workspace_id).collect())
    }

    /// Get service by ID
    pub fn get_service(&self, id: &str) -> Result<Service, String> {
        let services = self.list_services()?;
        services
            .into_iter()
            .find(|s| s.id == id)
            .ok_or_else(|| format!("Service not found: {}", id))
    }

    /// Create service
    pub fn create_service(&self, input: ServiceInput) -> Result<Service, String> {
        // Verify workspace exists
        self.get_workspace(&input.workspace_id)?;

        let now = chrono::Utc::now().to_rfc3339();
        let service = Service {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: input.workspace_id,
            name: input.name,
            service_type: input.service_type,
            role: input.role,
            cwd: input.cwd,
            command: input.command,
            args: input.args,
            package_manager: input.package_manager,
            port: input.port,
            env: input.env,
            env_file: input.env_file,
            enabled: input.enabled,
            dependencies: input.dependencies,
            startup_delay: input.startup_delay,
            auto_open_browser: input.auto_open_browser,
            open_url: input.open_url,
            health_check: input.health_check,
            shell_mode: input.shell_mode,
            discovery: input.discovery,
            created_at: now.clone(),
            updated_at: now,
        };

        service.validate()?;

        let mut services = self.list_services()?;
        services.push(service.clone());

        self.store.set("services", json!(services));
        self.store.save().map_err(|e| e.to_string())?;

        Ok(service)
    }

    /// Update service
    pub fn update_service(&self, id: &str, patch: ServicePatch) -> Result<Service, String> {
        let mut services = self.list_services()?;
        let service = services
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| format!("Service not found: {}", id))?;

        patch.apply_to(service);
        service.validate()?;

        let updated = service.clone();

        self.store.set("services", json!(services));
        self.store.save().map_err(|e| e.to_string())?;

        Ok(updated)
    }

    /// Delete service
    pub fn delete_service(&self, id: &str) -> Result<(), String> {
        let mut services = self.list_services()?;
        let index = services
            .iter()
            .position(|s| s.id == id)
            .ok_or_else(|| format!("Service not found: {}", id))?;

        services.remove(index);

        self.store.set("services", json!(services));
        self.store.save().map_err(|e| e.to_string())?;

        Ok(())
    }

    // ============ Internal ============

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
