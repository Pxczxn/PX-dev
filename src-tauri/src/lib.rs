mod commands;
mod types;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::new().build())
    .invoke_handler(tauri::generate_handler![
      commands::system::px_ping,
      commands::app::get_settings,
      commands::app::update_settings,
      commands::app::get_app_version
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
