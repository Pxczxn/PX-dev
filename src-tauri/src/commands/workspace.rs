use std::path::Path;
use tauri::AppHandle;
use crate::config::ConfigStore;
use crate::types::{
    Workspace, WorkspaceInput, WorkspacePatch,
    Service, ServiceInput,
};
use crate::discovery::types::{DiscoveryOptions, WorkspaceDiscoveryResult};
use crate::discovery::walker;
use crate::discovery::scanner;

// ============ Workspace CRUD ============

#[tauri::command]
pub async fn list_workspaces(app: AppHandle) -> Result<Vec<Workspace>, String> {
    let store = ConfigStore::open(&app)?;
    store.list_workspaces()
}

#[tauri::command]
pub async fn create_workspace(
    app: AppHandle,
    input: serde_json::Value,
) -> Result<Workspace, String> {
    let store = ConfigStore::open(&app)?;
    let ws_input: WorkspaceInput = serde_json::from_value(input)
        .map_err(|e| format!("Invalid workspace input: {}", e))?;
    store.create_workspace(ws_input)
}

#[tauri::command]
pub async fn update_workspace(
    app: AppHandle,
    input: serde_json::Value,
) -> Result<Workspace, String> {
    let store = ConfigStore::open(&app)?;

    let id = input
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing workspace id".to_string())?
        .to_string();

    let patch: WorkspacePatch = serde_json::from_value(input)
        .map_err(|e| format!("Invalid workspace patch: {}", e))?;

    store.update_workspace(&id, patch)
}

#[tauri::command]
pub async fn delete_workspace(
    app: AppHandle,
    id: String,
) -> Result<serde_json::Value, String> {
    let store = ConfigStore::open(&app)?;
    store.delete_workspace(&id)?;
    Ok(serde_json::json!({ "success": true }))
}

// ============ Discovery ============

#[tauri::command]
pub async fn workspace_discover(
    root_path: String,
    workspace_id: Option<String>,
    options: Option<serde_json::Value>,
) -> Result<WorkspaceDiscoveryResult, String> {
    let _ = workspace_id; // Phase 1 不使用，预留给 Phase 6 重扫比对
    let root = Path::new(&root_path);

    // 验证根目录
    if !root.exists() {
        return Err(format!("目录不存在：{}", root_path));
    }
    if !root.is_dir() {
        return Err(format!("路径不是目录：{}", root_path));
    }

    // 解析选项
    let discovery_options: DiscoveryOptions = match options {
        Some(opts) => serde_json::from_value(opts)
            .unwrap_or_default(),
        None => DiscoveryOptions::default(),
    };

    // 遍历目录
    let walk_result = walker::walk(root, &discovery_options);

    // 扫描每个候选目录
    let projects = walk_result
        .candidates
        .iter()
        .map(|path| scanner::scan_project(path, root))
        .collect();

    Ok(WorkspaceDiscoveryResult {
        root_path: root_path.clone(),
        scanned_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
        projects,
        warnings: walk_result.warnings,
        stats: walk_result.stats,
    })
}

#[tauri::command]
pub async fn apply_discovery(
    app: AppHandle,
    workspace_id: String,
    services: Vec<serde_json::Value>,
) -> Result<Vec<Service>, String> {
    let store = ConfigStore::open(&app)?;

    // 验证工作区存在
    store.get_workspace(&workspace_id)?;

    let mut created = Vec::new();

    for svc_value in services {
        let input: ServiceInput = serde_json::from_value(svc_value)
            .map_err(|e| format!("Invalid service input: {}", e))?;

        // 强制覆盖 workspace_id
        let mut input = input;
        input.workspace_id = workspace_id.clone();

        let service = store.create_service(input)?;
        created.push(service);
    }

    Ok(created)
}
