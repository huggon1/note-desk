#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod notes;
mod settings;

use tauri::{
  menu::{Menu, MenuItem},
  tray::TrayIconBuilder,
  Manager, WindowEvent,
};

#[tauri::command]
fn is_main_window_visible(app: tauri::AppHandle) -> Result<bool, String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "Main window not found".to_string())?;
  window.is_visible().map_err(|error| error.to_string())
}

#[tauri::command]
fn is_main_window_focused(app: tauri::AppHandle) -> Result<bool, String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "Main window not found".to_string())?;
  window.is_focused().map_err(|error| error.to_string())
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "Main window not found".to_string())?;
  window.show().map_err(|error| error.to_string())?;
  window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
fn hide_main_window(app: tauri::AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "Main window not found".to_string())?;
  window.hide().map_err(|error| error.to_string())
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
  let show_hide = MenuItem::with_id(app, "show_hide", "Show/Hide", true, None::<&str>)?;
  let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&show_hide, &quit])?;

  let mut tray = TrayIconBuilder::new()
    .menu(&menu)
    .show_menu_on_left_click(true)
    .tooltip("Note Desk")
    .on_menu_event(|app, event| match event.id.as_ref() {
      "show_hide" => {
        if let Some(window) = app.get_webview_window("main") {
          match window.is_visible() {
            Ok(true) => {
              let _ = window.hide();
            }
            _ => {
              let _ = window.show();
              let _ = window.set_focus();
            }
          }
        }
      }
      "quit" => app.exit(0),
      _ => {}
    });

  if let Some(icon) = app.default_window_icon().cloned() {
    tray = tray.icon(icon);
  }

  tray.build(app)?;

  Ok(())
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    .setup(|app| {
      setup_tray(app)?;
      Ok(())
    })
    .on_window_event(|window, event| {
      if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
      }
    })
    .invoke_handler(tauri::generate_handler![
      is_main_window_visible,
      is_main_window_focused,
      show_main_window,
      hide_main_window,
      notes::ensure_board,
      notes::list_notes,
      notes::create_note,
      notes::patch_note,
      notes::delete_note,
      notes::reorder_notes,
      settings::get_settings,
      settings::save_settings
    ])
    .run(tauri::generate_context!())
    .expect("error while running Note Desk");
}
