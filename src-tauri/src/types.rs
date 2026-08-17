use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============ Process Runtime ============

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProcessStatus {
    Stopped,
    Starting,
    Running,
    Stopping,
    Exited,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessRuntime {
    pub service_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    pub status: ProcessStatus,
    pub ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stopped_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ProcessRuntime {
    pub fn new(service_id: String) -> Self {
        Self {
            service_id,
            pid: None,
            status: ProcessStatus::Stopped,
            ready: false,
            started_at: None,
            stopped_at: None,
            exit_code: None,
            error: None,
        }
    }
}

// ============ Settings Enums ============

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
    System,
}

impl Default for Theme {
    fn default() -> Self {
        Theme::Dark
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CloseBehavior {
    Tray,
    Quit,
    Ask,
}

impl Default for CloseBehavior {
    fn default() -> Self {
        CloseBehavior::Tray
    }
}

// ============ Workspace & Service Enums ============

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum StartMode {
    Parallel,
    Sequential,
    Dependency,
}

impl Default for StartMode {
    fn default() -> Self {
        StartMode::Parallel
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ServiceType {
    Frontend,
    Node,
    Java,
    Generic,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ServiceRole {
    Frontend,
    Backend,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PackageManager {
    Npm,
    Pnpm,
    Yarn,
    Bun,
    Custom,
}

// ============ Settings ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: Theme,
    pub close_behavior: CloseBehavior,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_log_lines: Option<u32>,
    pub start_minimized: bool,
    pub auto_restore_last_session: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub startup_interval: Option<u32>,
    pub show_timestamp: bool,
    pub default_browser: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_path: Option<String>,
}

impl Settings {
    /// Validate settings values and apply constraints
    pub fn validate(&mut self) -> Result<(), String> {
        // maxLogLines: 500 ~ 50000
        if let Some(lines) = self.max_log_lines {
            if !(500..=50000).contains(&lines) {
                return Err(format!("maxLogLines must be between 500 and 50000, got {}", lines));
            }
        }
        
        // startupInterval: 0 ~ 30000
        if let Some(interval) = self.startup_interval {
            if interval > 30000 {
                return Err(format!("startupInterval must be between 0 and 30000, got {}", interval));
            }
        }
        
        Ok(())
    }
    
    /// Apply defaults for optional fields
    pub fn apply_defaults(&mut self) {
        if self.max_log_lines.is_none() {
            self.max_log_lines = Some(5000);
        }
        if self.startup_interval.is_none() {
            self.startup_interval = Some(1000);
        }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::default(),
            close_behavior: CloseBehavior::default(),
            max_log_lines: Some(5000),
            start_minimized: false,
            auto_restore_last_session: false,
            startup_interval: Some(1000),
            show_timestamp: true,
            default_browser: "system".to_string(),
            data_path: None,
        }
    }
}

// ============ SettingsPatch (for updateSettings) ============

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub theme: Option<Theme>,
    pub close_behavior: Option<CloseBehavior>,
    pub max_log_lines: Option<u32>,
    pub start_minimized: Option<bool>,
    pub auto_restore_last_session: Option<bool>,
    pub startup_interval: Option<u32>,
    pub show_timestamp: Option<bool>,
    pub default_browser: Option<String>,
    pub data_path: Option<String>,
}

impl SettingsPatch {
    /// Apply this patch to existing settings
    pub fn apply_to(&self, settings: &mut Settings) {
        if let Some(theme) = &self.theme {
            settings.theme = theme.clone();
        }
        if let Some(behavior) = &self.close_behavior {
            settings.close_behavior = behavior.clone();
        }
        if let Some(lines) = self.max_log_lines {
            settings.max_log_lines = Some(lines);
        }
        if let Some(minimized) = self.start_minimized {
            settings.start_minimized = minimized;
        }
        if let Some(restore) = self.auto_restore_last_session {
            settings.auto_restore_last_session = restore;
        }
        if let Some(interval) = self.startup_interval {
            settings.startup_interval = Some(interval);
        }
        if let Some(timestamp) = self.show_timestamp {
            settings.show_timestamp = timestamp;
        }
        if let Some(browser) = &self.default_browser {
            settings.default_browser = browser.clone();
        }
        if self.data_path.is_some() {
            settings.data_path = self.data_path.clone();
        }
    }
}

// ============ Workspace ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub favorite: bool,
    pub start_mode: StartMode,
    pub created_at: String,
    pub updated_at: String,
}

impl Workspace {
    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("Workspace name cannot be empty".to_string());
        }
        Ok(())
    }
}

// ============ WorkspaceInput (for create) ============

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInput {
    pub name: String,
    pub description: Option<String>,
    pub root_path: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub favorite: Option<bool>,
    pub start_mode: Option<StartMode>,
}

// ============ WorkspacePatch (for update) ============

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePatch {
    pub name: Option<String>,
    pub description: Option<String>,
    pub root_path: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub favorite: Option<bool>,
    pub start_mode: Option<StartMode>,
}

impl WorkspacePatch {
    pub fn apply_to(&self, workspace: &mut Workspace) {
        if let Some(name) = &self.name {
            workspace.name = name.clone();
        }
        if self.description.is_some() {
            workspace.description = self.description.clone();
        }
        if self.root_path.is_some() {
            workspace.root_path = self.root_path.clone();
        }
        if self.color.is_some() {
            workspace.color = self.color.clone();
        }
        if self.icon.is_some() {
            workspace.icon = self.icon.clone();
        }
        if let Some(favorite) = self.favorite {
            workspace.favorite = favorite;
        }
        if let Some(start_mode) = &self.start_mode {
            workspace.start_mode = start_mode.clone();
        }
        workspace.updated_at = chrono::Utc::now().to_rfc3339();
    }
}

// ============ Service ============

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub service_type: ServiceType,
    pub role: ServiceRole,
    pub cwd: String,
    #[serde(alias = "executable")]  // Backward compatibility: P3 v1 used "executable"
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_manager: Option<PackageManager>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env_file: Option<String>,
    #[serde(default = "default_true")]  // Default to true if missing
    pub enabled: bool,
    #[serde(default)]  // Default to empty vec if missing
    pub dependencies: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub startup_delay: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_open_browser: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health_check: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none", default)]  // Default to None (false equivalent)
    pub shell_mode: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discovery: Option<serde_json::Value>,
    pub created_at: String,
    pub updated_at: String,
}

impl Service {
    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("Service name cannot be empty".to_string());
        }
        if self.cwd.trim().is_empty() {
            return Err("Service cwd cannot be empty".to_string());
        }
        if self.command.trim().is_empty() {
            return Err("Service command cannot be empty".to_string());
        }
        if let Some(port) = self.port {
            if port == 0 {
                return Err("Service port must be between 1 and 65535".to_string());
            }
        }
        if let Some(delay) = self.startup_delay {
            if delay > 60000 {
                return Err("Service startupDelay must be between 0 and 60000".to_string());
            }
        }
        Ok(())
    }
}

// ============ ServiceInput (for create) ============

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInput {
    pub workspace_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub service_type: ServiceType,
    pub role: ServiceRole,
    pub cwd: String,
    pub command: String,
    pub args: Option<Vec<String>>,
    pub package_manager: Option<PackageManager>,
    pub port: Option<u16>,
    pub env: Option<HashMap<String, String>>,
    pub env_file: Option<String>,
    #[serde(default = "default_true")]  // Default to true if missing (matches Electron)
    pub enabled: bool,
    #[serde(default)]  // Default to empty vec if missing (matches Electron)
    pub dependencies: Vec<String>,
    pub startup_delay: Option<u32>,
    pub auto_open_browser: Option<bool>,
    pub open_url: Option<String>,
    pub health_check: Option<serde_json::Value>,
    #[serde(default)]  // Default to None if missing (matches Electron default false)
    pub shell_mode: Option<bool>,
    pub discovery: Option<serde_json::Value>,
}

// ============ ServicePatch (for update) ============

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServicePatch {
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub service_type: Option<ServiceType>,
    pub role: Option<ServiceRole>,
    pub cwd: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub package_manager: Option<PackageManager>,
    pub port: Option<u16>,
    pub env: Option<HashMap<String, String>>,
    pub env_file: Option<String>,
    pub enabled: Option<bool>,
    pub dependencies: Option<Vec<String>>,
    pub startup_delay: Option<u32>,
    pub auto_open_browser: Option<bool>,
    pub open_url: Option<String>,
    pub health_check: Option<serde_json::Value>,
    pub shell_mode: Option<bool>,
    pub discovery: Option<serde_json::Value>,
}

impl ServicePatch {
    pub fn apply_to(&self, service: &mut Service) {
        if let Some(name) = &self.name {
            service.name = name.clone();
        }
        if let Some(service_type) = &self.service_type {
            service.service_type = service_type.clone();
        }
        if let Some(role) = &self.role {
            service.role = role.clone();
        }
        if let Some(cwd) = &self.cwd {
            service.cwd = cwd.clone();
        }
        if let Some(command) = &self.command {
            service.command = command.clone();
        }
        if self.args.is_some() {
            service.args = self.args.clone();
        }
        if self.package_manager.is_some() {
            service.package_manager = self.package_manager.clone();
        }
        if self.port.is_some() {
            service.port = self.port;
        }
        if self.env.is_some() {
            service.env = self.env.clone();
        }
        if self.env_file.is_some() {
            service.env_file = self.env_file.clone();
        }
        if let Some(enabled) = self.enabled {
            service.enabled = enabled;
        }
        if let Some(dependencies) = &self.dependencies {
            service.dependencies = dependencies.clone();
        }
        if self.startup_delay.is_some() {
            service.startup_delay = self.startup_delay;
        }
        if self.auto_open_browser.is_some() {
            service.auto_open_browser = self.auto_open_browser;
        }
        if self.open_url.is_some() {
            service.open_url = self.open_url.clone();
        }
        if self.health_check.is_some() {
            service.health_check = self.health_check.clone();
        }
        if self.shell_mode.is_some() {
            service.shell_mode = self.shell_mode;
        }
        if self.discovery.is_some() {
            service.discovery = self.discovery.clone();
        }
        service.updated_at = chrono::Utc::now().to_rfc3339();
    }
}

// ============ AppConfig ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub version: u32,
    pub settings: Settings,
    pub workspaces: Vec<Workspace>,
    pub services: Vec<Service>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: 1,
            settings: Settings::default(),
            workspaces: Vec::new(),
            services: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_settings_default() {
        let settings = Settings::default();
        assert_eq!(settings.theme, Theme::Dark);
        assert_eq!(settings.close_behavior, CloseBehavior::Tray);
        assert_eq!(settings.max_log_lines, Some(5000));
        assert_eq!(settings.startup_interval, Some(1000));
    }

    #[test]
    fn test_settings_validate_max_log_lines() {
        let mut settings = Settings::default();
        
        // Valid
        settings.max_log_lines = Some(5000);
        assert!(settings.validate().is_ok());
        
        // Too low
        settings.max_log_lines = Some(100);
        assert!(settings.validate().is_err());
        
        // Too high
        settings.max_log_lines = Some(100000);
        assert!(settings.validate().is_err());
        
        // Boundary values
        settings.max_log_lines = Some(500);
        assert!(settings.validate().is_ok());
        
        settings.max_log_lines = Some(50000);
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn test_settings_validate_startup_interval() {
        let mut settings = Settings::default();
        
        // Valid
        settings.startup_interval = Some(1000);
        assert!(settings.validate().is_ok());
        
        // Too high
        settings.startup_interval = Some(50000);
        assert!(settings.validate().is_err());
        
        // Boundary values
        settings.startup_interval = Some(0);
        assert!(settings.validate().is_ok());
        
        settings.startup_interval = Some(30000);
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn test_settings_patch_apply() {
        let mut settings = Settings::default();
        let patch = SettingsPatch {
            theme: Some(Theme::Light),
            close_behavior: None,
            max_log_lines: Some(10000),
            start_minimized: Some(true),
            auto_restore_last_session: None,
            startup_interval: None,
            show_timestamp: None,
            default_browser: None,
            data_path: None,
        };
        
        patch.apply_to(&mut settings);
        
        assert_eq!(settings.theme, Theme::Light);
        assert_eq!(settings.close_behavior, CloseBehavior::Tray); // unchanged
        assert_eq!(settings.max_log_lines, Some(10000));
        assert_eq!(settings.start_minimized, true);
    }

    #[test]
    fn test_theme_serde() {
        let json = r#""light""#;
        let theme: Theme = serde_json::from_str(json).unwrap();
        assert_eq!(theme, Theme::Light);
        
        let serialized = serde_json::to_string(&theme).unwrap();
        assert_eq!(serialized, r#""light""#);
    }

    #[test]
    fn test_close_behavior_serde() {
        let json = r#""tray""#;
        let behavior: CloseBehavior = serde_json::from_str(json).unwrap();
        assert_eq!(behavior, CloseBehavior::Tray);
    }

    #[test]
    fn test_service_contract_round_trip() {
        // Real frontend payload (TypeScript → Rust)
        let json_input = r#"{
            "workspaceId": "ws-123",
            "name": "Frontend Dev Server",
            "type": "frontend",
            "role": "frontend",
            "cwd": "/path/to/project",
            "command": "npm",
            "args": ["run", "dev"],
            "packageManager": "npm",
            "enabled": true,
            "dependencies": [],
            "startupDelay": 0,
            "port": 5173,
            "env": {"NODE_ENV": "development"},
            "envFile": ".env.local",
            "autoOpenBrowser": true,
            "openUrl": "http://localhost:5173",
            "shellMode": false
        }"#;

        // Deserialize ServiceInput
        let input: ServiceInput = serde_json::from_str(json_input).unwrap();
        assert_eq!(input.command, "npm");
        assert_eq!(input.enabled, true);
        assert_eq!(input.dependencies.len(), 0);
        
        // Create Service
        let service = Service {
            id: "svc-456".to_string(),
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
            health_check: None,
            shell_mode: input.shell_mode,
            discovery: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        };

        // Serialize back to JSON (Rust → TypeScript)
        let json_output = serde_json::to_value(&service).unwrap();
        
        // Verify field names match TypeScript contract
        assert_eq!(json_output["command"], "npm");
        assert_eq!(json_output["enabled"], true);
        assert_eq!(json_output["dependencies"], serde_json::json!([]));
        assert_eq!(json_output["startupDelay"], 0);
        assert_eq!(json_output["packageManager"], "npm");
        assert_eq!(json_output["envFile"], ".env.local");
        
        // Must NOT contain renamed Rust fields
        assert!(json_output.get("executable").is_none());
        assert!(json_output.get("startup_delay").is_none());
        assert!(json_output.get("package_manager").is_none());
        assert!(json_output.get("env_file").is_none());
        
        // Verify camelCase naming
        assert!(json_output.get("workspaceId").is_some());
        assert!(json_output.get("autoOpenBrowser").is_some());
        assert!(json_output.get("openUrl").is_some());
        assert!(json_output.get("shellMode").is_some());
        assert!(json_output.get("createdAt").is_some());
        assert!(json_output.get("updatedAt").is_some());
    }

    #[test]
    fn test_service_backward_compatibility() {
        // Old P3 v1 data with "executable" instead of "command"
        let old_json = r#"{
            "id": "svc-1",
            "workspaceId": "ws-1",
            "name": "Old Service",
            "type": "node",
            "role": "backend",
            "cwd": "/path",
            "executable": "node",
            "createdAt": "2024-01-01T00:00:00Z",
            "updatedAt": "2024-01-01T00:00:00Z"
        }"#;

        // Should deserialize successfully with alias
        let service: Service = serde_json::from_str(old_json).unwrap();
        assert_eq!(service.command, "node");
        
        // Missing fields should use defaults
        assert_eq!(service.enabled, true);  // default_true
        assert_eq!(service.dependencies.len(), 0);  // default empty vec
        assert_eq!(service.shell_mode, None);  // default None
    }

    #[test]
    fn test_service_input_defaults() {
        // Minimal ServiceInput without optional fields
        let json = r#"{
            "workspaceId": "ws-1",
            "name": "Minimal Service",
            "type": "generic",
            "role": "backend",
            "cwd": "/path",
            "command": "run.sh"
        }"#;

        let input: ServiceInput = serde_json::from_str(json).unwrap();
        
        // Should apply defaults (matching Electron behavior)
        assert_eq!(input.enabled, true);
        assert_eq!(input.dependencies.len(), 0);
        assert_eq!(input.shell_mode, None);
    }
}
