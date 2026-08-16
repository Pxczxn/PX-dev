#[tauri::command]
pub fn px_ping() -> String {
    "PX Dev Tauri backend ready".to_string()
}
