import type { NoteStore } from './types';
import { tauriNoteStore } from '../desktop/tauri-notes';
import { restNoteStore } from '../web/rest-notes';

export function createNoteStore(): NoteStore {
  return '__TAURI_INTERNALS__' in window ? tauriNoteStore : restNoteStore;
}
