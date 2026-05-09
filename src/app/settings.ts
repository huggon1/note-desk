import { invoke } from '@tauri-apps/api/core';
import { isDesktopRuntime } from '../desktop/window-controls';

export type ThemeMode = 'light' | 'dark';

export type AppSettings = {
  globalShortcut: string;
  fontScale: number;
  themeMode: ThemeMode;
};

export const DEFAULT_SETTINGS: AppSettings = {
  globalShortcut: 'CommandOrControl+Shift+Space',
  fontScale: 100,
  themeMode: 'light'
};

const STORAGE_KEY = 'note-desk-settings';

function normalizeSettings(value: Partial<AppSettings> | null | undefined): AppSettings {
  const fontScale = Number(value?.fontScale);
  return {
    globalShortcut: value?.globalShortcut || DEFAULT_SETTINGS.globalShortcut,
    fontScale: Number.isFinite(fontScale) ? Math.min(125, Math.max(85, fontScale)) : DEFAULT_SETTINGS.fontScale,
    themeMode: value?.themeMode === 'dark' ? 'dark' : 'light'
  };
}

export async function loadSettings(): Promise<AppSettings> {
  if (isDesktopRuntime()) {
    return normalizeSettings(await invoke<AppSettings>('get_settings'));
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return DEFAULT_SETTINGS;
  return normalizeSettings(JSON.parse(stored) as Partial<AppSettings>);
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const normalized = normalizeSettings(settings);

  if (isDesktopRuntime()) {
    return normalizeSettings(await invoke<AppSettings>('save_settings', { settings: normalized }));
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function applySettings(settings: AppSettings) {
  const root = document.documentElement;
  root.dataset.theme = settings.themeMode;
  root.style.setProperty('--font-scale', String(settings.fontScale / 100));
}

export function displayShortcut(shortcut: string): string {
  return shortcut.replaceAll('CommandOrControl', 'Ctrl').replaceAll('+', ' + ');
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): string | null {
  const key = normalizeShortcutKey(event.key);
  const modifiers = [
    event.ctrlKey ? 'CommandOrControl' : null,
    event.altKey ? 'Alt' : null,
    event.shiftKey ? 'Shift' : null,
    event.metaKey && !event.ctrlKey ? 'Meta' : null
  ].filter(Boolean) as string[];

  if (!key || modifiers.length === 0) return null;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;
  return [...modifiers, key].join('+');
}

function normalizeShortcutKey(key: string): string | null {
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  const aliases: Record<string, string> = {
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
    Escape: 'Escape',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Spacebar: 'Space'
  };
  if (/^F([1-9]|1[0-2])$/.test(key)) return key;
  return aliases[key] ?? null;
}
