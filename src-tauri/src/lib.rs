mod commands;
mod types;
mod config;
mod process;
mod log;

use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      let app_handle = app.handle().clone();
      
      // Get max_log_lines from settings, default to 5000
      let max_lines = {
        let store = config::ConfigStore::open(&app_handle)
          .expect("Failed to open ConfigStore");
        store.get_settings()
          .ok()
          .and_then(|s| s.max_log_lines)
          .unwrap_or(5000) as usize
      };
      
      // Initialize managers with app handle
      let process_manager = process::ProcessManager::new();
      let log_manager = log::LogManager::new(app_handle.clone(), max_lines);
      
      app.manage(process_manager);
      app.manage(log_manager);
      
      Ok(())
    })
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
      commands::log::log_subscribe,
      commands::log::log_unsubscribe,
      commands::log::log_clear,
      commands::log::log_history,
      commands::log::log_export,
    ])
    .build(tauri::generate_context!())
    .expect("error while running tauri application")
    .run(|app_handle, event| {
      // Clean up all processes on exit
      if let RunEvent::Exit = event {
        let app = app_handle.clone();
        let manager = app.state::<process::ProcessManager>();
        tauri::async_runtime::block_on(async {
          let _ = manager.force_kill_all(&app).await;
        });
      }
    });
}
