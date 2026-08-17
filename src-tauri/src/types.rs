use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    pub executable: String,
    pub args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_open_browser: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health_check: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
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
        if self.executable.trim().is_empty() {
            return Err("Service executable cannot be empty".to_string());
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
    pub executable: String,
    pub args: Vec<String>,
    pub env: Option<HashMap<String, String>>,
    pub port: Option<u16>,
    pub auto_open_browser: Option<bool>,
    pub open_url: Option<String>,
    pub health_check: Option<serde_json::Value>,
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
    pub executable: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub port: Option<u16>,
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
        if let Some(executable) = &self.executable {
            service.executable = executable.clone();
        }
        if let Some(args) = &self.args {
            service.args = args.clone();
        }
        if self.env.is_some() {
            service.env = self.env.clone();
        }
        if self.port.is_some() {
            service.port = self.port;
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
}
