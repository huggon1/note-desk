use serde::{Deserialize, Serialize};
use std::{env, fs, path::PathBuf};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
  global_shortcut: String,
  font_scale: i64,
  theme_mode: String,
}

impl Default for AppSettings {
  fn default() -> Self {
    Self {
      global_shortcut: "CommandOrControl+Shift+Space".to_string(),
      font_scale: 100,
      theme_mode: "light".to_string(),
    }
  }
}

fn settings_path() -> Result<PathBuf, String> {
  let exe = env::current_exe().map_err(|error| error.to_string())?;
  let base_dir = exe
    .parent()
    .ok_or_else(|| "Could not resolve executable directory".to_string())?;
  Ok(base_dir.join("data").join("settings.json"))
}

fn normalize(settings: AppSettings) -> AppSettings {
  AppSettings {
    global_shortcut: if settings.global_shortcut.trim().is_empty() {
      AppSettings::default().global_shortcut
    } else {
      settings.global_shortcut
    },
    font_scale: settings.font_scale.clamp(85, 125),
    theme_mode: if settings.theme_mode == "dark" {
      "dark".to_string()
    } else {
      "light".to_string()
    },
  }
}

#[tauri::command]
pub fn get_settings() -> Result<AppSettings, String> {
  let path = settings_path()?;
  if !path.exists() {
    return Ok(AppSettings::default());
  }

  let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
  let settings = serde_json::from_str::<AppSettings>(&content).unwrap_or_default();
  Ok(normalize(settings))
}

#[tauri::command]
pub fn save_settings(settings: AppSettings) -> Result<AppSettings, String> {
  let settings = normalize(settings);
  let path = settings_path()?;
  fs::create_dir_all(
    path
      .parent()
      .ok_or_else(|| "Could not resolve settings directory".to_string())?,
  )
  .map_err(|error| error.to_string())?;

  let content = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
  fs::write(path, content).map_err(|error| error.to_string())?;
  Ok(settings)
}
