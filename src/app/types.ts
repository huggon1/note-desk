export type Board = {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeCount?: number;
};

export type Note = {
  id: number;
  boardId: number;
  title: string;
  content: string;
  pinned: boolean;
  archived: boolean;
  sortOrder: number | null;
  createdAt: string;
  updatedAt: string;
};

export type CaptureDraft = {
  title: string;
  content: string;
};

export type NotePatch = Partial<Pick<Note, 'title' | 'content' | 'pinned' | 'archived' | 'sortOrder'>>;

export type NoteStore = {
  ensureBoard(): Promise<Board>;
  loadNotes(options: { boardId: number; archived: boolean; search: string }): Promise<Note[]>;
  createNote(boardId: number, draft: CaptureDraft): Promise<Note>;
  patchNote(noteId: number, patch: NotePatch): Promise<Note>;
  deleteNote(noteId: number): Promise<void>;
  reorderNotes(noteIds: number[]): Promise<void>;
};
