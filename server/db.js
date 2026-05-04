import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const dbPath = process.env.NOTES_DB_PATH || path.join(dataDir, 'dev-notes.sqlite');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_notes_board ON notes(board_id);
  CREATE INDEX IF NOT EXISTS idx_notes_board_archived ON notes(board_id, archived);
  CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);
`);

const noteColumns = db.prepare('PRAGMA table_info(notes)').all().map((column) => column.name);
if (!noteColumns.includes('title')) {
  db.prepare("ALTER TABLE notes ADD COLUMN title TEXT NOT NULL DEFAULT ''").run();
}

const boardCount = db.prepare('SELECT COUNT(*) as count FROM boards').get().count;
if (boardCount === 0) {
  const insertBoard = db.prepare('INSERT INTO boards (name) VALUES (?)');
  const current = insertBoard.run('Notes');

  const insertNote = db.prepare(`
    INSERT INTO notes (board_id, title, content, pinned, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertNote.run(current.lastInsertRowid, 'Quick capture', 'Drop temporary ideas, steps, URLs, and commands here.', 1, 0);
  insertNote.run(current.lastInsertRowid, '', 'Editing a note updates its position. Pin important notes to keep them at the top.', 0, 1);
} else if (boardCount > 1) {
  const primary = db.prepare('SELECT id FROM boards ORDER BY updated_at DESC, id DESC LIMIT 1').get();
  const collapseBoards = db.transaction((primaryId) => {
    db.prepare('UPDATE notes SET board_id = ? WHERE board_id != ?').run(primaryId, primaryId);
    db.prepare('DELETE FROM boards WHERE id != ?').run(primaryId);
    db.prepare('UPDATE boards SET name = ? WHERE id = ?').run('Notes', primaryId);
  });
  collapseBoards(primary.id);
}

export function nowSql() {
  return new Date().toISOString();
}
