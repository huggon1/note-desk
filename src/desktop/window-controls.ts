import { invoke } from '@tauri-apps/api/core';

export function isDesktopRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

export async function hideMainWindow() {
  if (!isDesktopRuntime()) return;
  await invoke('hide_main_window');
}
