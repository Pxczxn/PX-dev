use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DiscoveryConfidence {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DiscoveryProjectType {
    Node,
    Java,
    Frontend,
    Generic,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionEvidence {
    #[serde(rename = "type")]
    pub evidence_type: String,
    pub detail: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredProject {
    pub id: String,
    pub path: String,
    #[serde(rename = "relativePath")]
    pub relative_path: String,
    pub name: String,
    #[serde(rename = "projectType")]
    pub project_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub framework: Option<String>,
    #[serde(rename = "packageManager", skip_serializing_if = "Option::is_none")]
    pub package_manager: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(rename = "detectedPort", skip_serializing_if = "Option::is_none")]
    pub detected_port: Option<u16>,
    #[serde(rename = "isLibrary", skip_serializing_if = "Option::is_none")]
    pub is_library: Option<bool>,
    #[serde(rename = "suggestedServiceType", skip_serializing_if = "Option::is_none")]
    pub suggested_service_type: Option<String>,
    #[serde(rename = "suggestedRole", skip_serializing_if = "Option::is_none")]
    pub suggested_role: Option<String>,
    #[serde(rename = "suggestedSelected", skip_serializing_if = "Option::is_none")]
    pub suggested_selected: Option<bool>,
    pub confidence: DiscoveryConfidence,
    #[serde(rename = "evidence", skip_serializing_if = "Vec::is_empty")]
    pub evidence_items: Vec<DetectionEvidence>,
    #[serde(rename = "configFiles", skip_serializing_if = "Vec::is_empty")]
    pub config_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryWarning {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryStats {
    pub scanned_directories: u32,
    pub max_depth_reached: u32,
    pub truncated: bool,
    pub elapsed_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped_directories: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryOptions {
    pub max_depth: u32,
    pub max_directories: u32,
    pub timeout: u64,
    pub include_library: bool,
    #[serde(default)]
    pub extra_ignores: Vec<String>,
}

impl Default for DiscoveryOptions {
    fn default() -> Self {
        Self {
            max_depth: 3,
            max_directories: 2000,
            timeout: 15000,
            include_library: false,
            extra_ignores: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDiscoveryResult {
    pub root_path: String,
    pub scanned_at: u64,
    pub projects: Vec<DiscoveredProject>,
    pub warnings: Vec<DiscoveryWarning>,
    pub stats: DiscoveryStats,
}
