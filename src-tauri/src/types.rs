use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub close_behavior: String,
    pub max_log_lines: u32,
    pub start_minimized: bool,
    pub auto_restore_last_session: bool,
    pub startup_interval: u32,
    pub show_timestamp: bool,
    pub default_browser: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_path: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            close_behavior: "tray".to_string(),
            max_log_lines: 5000,
            start_minimized: false,
            auto_restore_last_session: false,
            startup_interval: 1000,
            show_timestamp: true,
            default_browser: "system".to_string(),
            data_path: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub version: u32,
    pub settings: Settings,
    pub workspaces: Vec<serde_json::Value>,
    pub services: Vec<serde_json::Value>,
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
