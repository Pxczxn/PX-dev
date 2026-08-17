use tauri::State;
use crate::log::{LogManager, LogEntry};

#[tauri::command]
pub async fn log_subscribe(
    service_id: String,
    log_manager: State<'_, LogManager>,
) -> Result<serde_json::Value, String> {
    log_manager.subscribe(service_id);
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn log_unsubscribe(
    service_id: String,
    log_manager: State<'_, LogManager>,
) -> Result<serde_json::Value, String> {
    log_manager.unsubscribe(&service_id);
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn log_clear(
    service_id: String,
    log_manager: State<'_, LogManager>,
) -> Result<serde_json::Value, String> {
    log_manager.clear(&service_id);
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn log_history(
    service_id: String,
    limit: Option<usize>,
    log_manager: State<'_, LogManager>,
) -> Result<Vec<LogEntry>, String> {
    Ok(log_manager.history(&service_id, limit))
}

#[tauri::command]
pub async fn log_export(
    service_id: String,
    save_path: Option<String>,
    log_manager: State<'_, LogManager>,
) -> Result<serde_json::Value, String> {
    use tauri_plugin_dialog::{DialogExt, FilePath};
    
    // Get log entries
    let entries = log_manager.history(&service_id, None);
    
    if entries.is_empty() {
        return Ok(serde_json::json!({
            "success": false,
            "error": "No logs to export"
        }));
    }
    
    // Determine the file path
    let path = if let Some(p) = save_path {
        p
    } else {
        // Use dialog to get save path - requires app handle
        // For now, return error if no path provided
        // TODO: Integrate tauri_plugin_dialog properly with app handle
        return Err("Save path is required (dialog integration pending)".to_string());
    };
    
    // Format logs in Electron-compatible format
    let mut content = String::new();
    for entry in entries {
        // Convert timestamp to ISO 8601
        let timestamp = chrono::DateTime::from_timestamp_millis(entry.timestamp as i64)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_else(|| entry.timestamp.to_string());
        
        let stream_tag = match entry.stream {
            crate::log::LogStream::Stdout => "OUT",
            crate::log::LogStream::Stderr => "ERR",
        };
        
        content.push_str(&format!("[{}] [{}] {}\n", timestamp, stream_tag, entry.text));
    }
    
    // Write to file
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write log file: {}", e))?;
    
    Ok(serde_json::json!({
        "success": true,
        "path": path
    }))
}
