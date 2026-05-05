import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, nowSql } from './db.js';

type BoardRow = {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
};

type BoardListRow = BoardRow & {
  active_count: number;
};

type NoteRow = {
  id: number;
  board_id: number;
  title: string;
  content: string;
  pinned: number;
  archived: number;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
};

type BoardResponse = {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type NoteResponse = {
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

type BoardIdRow = {
  board_id: number;
};

type HttpError = Error & {
  status?: number;
};

const app = express();
const port = Number(process.env.PORT || 4000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'dist');

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function normalizeBoard(row: BoardRow): BoardResponse {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeNote(row: NoteRow): NoteResponse {
  return {
    id: row.id,
    boardId: row.board_id,
    title: row.title,
    content: row.content,
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function requireText(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    const error: HttpError = new Error(`${fieldName} is required`);
    error.status = 400;
    throw error;
  }

  return value.trim();
}

function optionalTitle(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get('/api/boards', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT boards.*,
      (SELECT COUNT(*) FROM notes WHERE notes.board_id = boards.id AND notes.archived = 0) as active_count
    FROM boards
    ORDER BY updated_at DESC, id DESC
  `).all() as BoardListRow[];

  res.json(rows.map((row) => ({ ...normalizeBoard(row), activeCount: row.active_count })));
});

app.post('/api/boards', (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = requireText(req.body.name, 'name');
    const result = db.prepare('INSERT INTO boards (name) VALUES (?)').run(name);
    const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(result.lastInsertRowid) as BoardRow;
    res.status(201).json(normalizeBoard(board));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/boards/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const name = requireText(req.body.name, 'name');
    const result = db.prepare('UPDATE boards SET name = ?, updated_at = ? WHERE id = ?').run(name, nowSql(), id);
    if (result.changes === 0) return res.status(404).json({ error: 'Board not found' });
    const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(id) as BoardRow;
    res.json(normalizeBoard(board));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/boards/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const result = db.prepare('DELETE FROM boards WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Board not found' });
  res.status(204).end();
});

app.get('/api/boards/:id/notes', (req: Request, res: Response) => {
  const boardId = Number(req.params.id);
  const archived = req.query.archived === 'true' ? 1 : 0;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const params = { boardId, archived, search: `%${search}%` };

  const rows = db.prepare(`
    SELECT *
    FROM notes
    WHERE board_id = @boardId
      AND archived = @archived
      AND (@search = '%%' OR content LIKE @search OR title LIKE @search)
    ORDER BY pinned DESC, COALESCE(sort_order, 999999999) ASC, updated_at DESC, id DESC
  `).all(params) as NoteRow[];

  res.json(rows.map(normalizeNote));
});

app.post('/api/boards/:id/notes', (req: Request, res: Response, next: NextFunction) => {
  try {
    const boardId = Number(req.params.id);
    const title = optionalTitle(req.body.title);
    const content = requireText(req.body.content, 'content');
    db.prepare(`
      UPDATE notes
      SET sort_order = COALESCE(sort_order, 0) + 1
      WHERE board_id = ? AND archived = 0 AND pinned = 0
    `).run(boardId);
    const result = db.prepare(`
      INSERT INTO notes (board_id, title, content, sort_order)
      VALUES (?, ?, ?, 0)
    `).run(boardId, title, content);

    db.prepare('UPDATE boards SET updated_at = ? WHERE id = ?').run(nowSql(), boardId);
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid) as NoteRow;
    res.status(201).json(normalizeNote(note));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/notes/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined;
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const title = req.body.title === undefined ? note.title : optionalTitle(req.body.title);
    const content = req.body.content === undefined ? note.content : requireText(req.body.content, 'content');
    const pinned = req.body.pinned === undefined ? note.pinned : Number(Boolean(req.body.pinned));
    const archived = req.body.archived === undefined ? note.archived : Number(Boolean(req.body.archived));
    const sortOrder = req.body.sortOrder === undefined ? note.sort_order : Number(req.body.sortOrder);
    const updatedAt = nowSql();
    const contentChanged = title !== note.title || content !== note.content;
    const shouldPromote = contentChanged && pinned === 0 && archived === 0;

    const updateNote = db.transaction(() => {
      if (shouldPromote) {
        db.prepare(`
          UPDATE notes
          SET sort_order = COALESCE(sort_order, 0) + 1
          WHERE board_id = ? AND archived = 0 AND pinned = 0 AND id != ?
        `).run(note.board_id, id);
      }

      db.prepare(`
        UPDATE notes
        SET title = ?, content = ?, pinned = ?, archived = ?, sort_order = ?, updated_at = ?
        WHERE id = ?
      `).run(
        title,
        content,
        pinned,
        archived,
        shouldPromote ? 0 : (Number.isFinite(sortOrder) ? sortOrder : note.sort_order),
        updatedAt,
        id
      );
    });

    updateNote();

    db.prepare('UPDATE boards SET updated_at = ? WHERE id = ?').run(updatedAt, note.board_id);
    const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow;
    res.json(normalizeNote(updated));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/notes/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const note = db.prepare('SELECT board_id FROM notes WHERE id = ?').get(id) as BoardIdRow | undefined;
  const result = db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Note not found' });
  if (!note) return res.status(404).json({ error: 'Note not found' });
  db.prepare('UPDATE boards SET updated_at = ? WHERE id = ?').run(nowSql(), note.board_id);
  res.status(204).end();
});

app.post('/api/notes/reorder', (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!Array.isArray(req.body.noteIds)) {
      return res.status(400).json({ error: 'noteIds must be an array' });
    }

    const update = db.prepare('UPDATE notes SET sort_order = ? WHERE id = ?');
    const transaction = db.transaction((noteIds: unknown[]) => {
      noteIds.forEach((id, index) => update.run(index, Number(id)));
    });
    transaction(req.body.noteIds);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/.*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((error: HttpError, _req: Request, res: Response, _next: NextFunction) => {
  const status = error.status || 500;
  res.status(status).json({ error: status === 500 ? 'Internal server error' : error.message });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Dev Notes Board API running at http://127.0.0.1:${port}`);
});
