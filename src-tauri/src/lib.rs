mod commands;
mod types;
mod config;
mod process;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let process_manager = process::ProcessManager::new();

  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_shell::init())
    .manage(process_manager)
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
      commands::process::start_process,
      commands::process::stop_process,
      commands::process::restart_process,
      commands::process::force_kill_process,
      commands::process::get_process_runtime,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
