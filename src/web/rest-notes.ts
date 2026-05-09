import type { Board, CaptureDraft, Note, NotePatch, NoteStore } from '../app/types';

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (window.location.port === '4000' ? '/api' : 'http://127.0.0.1:4000/api');

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({} as { error?: string }));
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
}

export const restNoteStore: NoteStore = {
  async ensureBoard() {
    const boards = await api<Board[]>('/boards');
    if (boards.length > 0) return boards[0];

    return api<Board>('/boards', {
      method: 'POST',
      body: JSON.stringify({ name: 'Notes' })
    });
  },

  async loadNotes({ boardId, archived, search }) {
    const params = new URLSearchParams({
      archived: String(archived),
      search
    });
    return api<Note[]>(`/boards/${boardId}/notes?${params.toString()}`);
  },

  async createNote(boardId: number, draft: CaptureDraft) {
    return api<Note>(`/boards/${boardId}/notes`, {
      method: 'POST',
      body: JSON.stringify(draft)
    });
  },

  async patchNote(noteId: number, patch: NotePatch) {
    return api<Note>(`/notes/${noteId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });
  },

  async deleteNote(noteId: number) {
    await api<null>(`/notes/${noteId}`, { method: 'DELETE' });
  },

  async reorderNotes(noteIds: number[]) {
    await api<{ ok: boolean }>('/notes/reorder', {
      method: 'POST',
      body: JSON.stringify({ noteIds })
    });
  }
};
