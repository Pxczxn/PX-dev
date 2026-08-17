mod commands;
mod types;
mod config;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::new().build())
    .invoke_handler(tauri::generate_handler![
      commands::system::px_ping,
      commands::app::get_settings,
      commands::app::update_settings,
      commands::app::get_app_version,
      commands::workspace::list_workspaces,
      commands::workspace::create_workspace,
      commands::workspace::update_workspace,
      commands::workspace::delete_workspace,
      commands::service::list_services,
      commands::service::create_service,
      commands::service::update_service,
      commands::service::delete_service,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
