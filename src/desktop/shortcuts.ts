import { invoke } from '@tauri-apps/api/core';
import { isRegistered, register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { hideMainWindow, isDesktopRuntime } from './window-controls';

let activeShortcut: string | null = null;
let activeHandler: (() => Promise<boolean>) | null = null;

export async function configureWindowToggleShortcut(shortcut: string, onHideRequested: () => Promise<boolean>) {
  if (!isDesktopRuntime()) return;

  activeHandler = onHideRequested;
  if (activeShortcut === shortcut && await isRegistered(shortcut)) return;

  await register(shortcut, async (event) => {
    if (event.state !== 'Pressed') return;

    const isVisible = await invoke<boolean>('is_main_window_visible');
    if (!isVisible) {
      await invoke('show_main_window');
      return;
    }

    const canHide = await activeHandler?.();
    if (canHide) await hideMainWindow();
  });

  if (activeShortcut && activeShortcut !== shortcut && await isRegistered(activeShortcut)) {
    await unregister(activeShortcut);
  }

  activeShortcut = shortcut;
}

export async function testWindowToggleShortcut(shortcut: string) {
  if (!isDesktopRuntime()) return;
  if (activeShortcut === shortcut) return;

  await register(shortcut, () => undefined);
  if (await isRegistered(shortcut)) {
    await unregister(shortcut);
  }
}
