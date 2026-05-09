import { invoke } from '@tauri-apps/api/core';
import type { Board, CaptureDraft, Note, NotePatch, NoteStore } from '../app/types';

export const tauriNoteStore: NoteStore = {
  ensureBoard() {
    return invoke<Board>('ensure_board');
  },

  loadNotes(options) {
    return invoke<Note[]>('list_notes', {
      boardId: options.boardId,
      archived: options.archived,
      search: options.search
    });
  },

  createNote(boardId: number, draft: CaptureDraft) {
    return invoke<Note>('create_note', { boardId, title: draft.title, content: draft.content });
  },

  patchNote(noteId: number, patch: NotePatch) {
    return invoke<Note>('patch_note', {
      noteId,
      title: patch.title,
      content: patch.content,
      pinned: patch.pinned,
      archived: patch.archived,
      sortOrder: patch.sortOrder
    });
  },

  deleteNote(noteId: number) {
    return invoke<void>('delete_note', { noteId });
  },

  reorderNotes(noteIds: number[]) {
    return invoke<void>('reorder_notes', { noteIds });
  }
};
