use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{env, fs, path::PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
  id: i64,
  name: String,
  created_at: String,
  updated_at: String,
  active_count: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
  id: i64,
  board_id: i64,
  title: String,
  content: String,
  pinned: bool,
  archived: bool,
  sort_order: Option<i64>,
  created_at: String,
  updated_at: String,
}

#[derive(Clone)]
struct NoteRow {
  id: i64,
  board_id: i64,
  title: String,
  content: String,
  pinned: i64,
  archived: i64,
  sort_order: Option<i64>,
  created_at: String,
  updated_at: String,
}

fn now_sql() -> String {
  Utc::now().to_rfc3339()
}

fn db_path() -> Result<PathBuf, String> {
  let exe = env::current_exe().map_err(|error| error.to_string())?;
  let base_dir = exe
    .parent()
    .ok_or_else(|| "Could not resolve executable directory".to_string())?;
  Ok(base_dir.join("data").join("note-desk.sqlite"))
}

fn connect() -> Result<Connection, String> {
  let path = db_path()?;
  fs::create_dir_all(
    path
      .parent()
      .ok_or_else(|| "Could not resolve database directory".to_string())?,
  )
  .map_err(|error| error.to_string())?;

  let connection = Connection::open(path).map_err(|error| error.to_string())?;
  connection
    .pragma_update(None, "journal_mode", "WAL")
    .map_err(|error| error.to_string())?;
  connection
    .pragma_update(None, "foreign_keys", "ON")
    .map_err(|error| error.to_string())?;
  migrate(&connection)?;
  Ok(connection)
}

fn migrate(connection: &Connection) -> Result<(), String> {
  connection
    .execute_batch(
      "
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
      ",
    )
    .map_err(|error| error.to_string())?;

  let has_title = {
    let mut statement = connection
      .prepare("PRAGMA table_info(notes)")
      .map_err(|error| error.to_string())?;
    let columns = statement
      .query_map([], |row| row.get::<_, String>(1))
      .map_err(|error| error.to_string())?
      .collect::<Result<Vec<_>, _>>()
      .map_err(|error| error.to_string())?;
    columns.iter().any(|name| name == "title")
  };

  if !has_title {
    connection
      .execute("ALTER TABLE notes ADD COLUMN title TEXT NOT NULL DEFAULT ''", [])
      .map_err(|error| error.to_string())?;
  }

  let board_count: i64 = connection
    .query_row("SELECT COUNT(*) FROM boards", [], |row| row.get(0))
    .map_err(|error| error.to_string())?;

  if board_count == 0 {
    let now = now_sql();
    connection
      .execute(
        "INSERT INTO boards (name, created_at, updated_at) VALUES (?1, ?2, ?2)",
        params!["Notes", now],
      )
      .map_err(|error| error.to_string())?;
    let board_id = connection.last_insert_rowid();

    connection
      .execute(
        "INSERT INTO notes (board_id, title, content, pinned, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
          board_id,
          "Quick capture",
          "Drop temporary ideas, steps, URLs, and commands here.",
          1,
          0
        ],
      )
      .map_err(|error| error.to_string())?;
    connection
      .execute(
        "INSERT INTO notes (board_id, title, content, pinned, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
          board_id,
          "",
          "Editing a note updates its position. Pin important notes to keep them at the top.",
          0,
          1
        ],
      )
      .map_err(|error| error.to_string())?;
  } else if board_count > 1 {
    let primary_id: i64 = connection
      .query_row(
        "SELECT id FROM boards ORDER BY updated_at DESC, id DESC LIMIT 1",
        [],
        |row| row.get(0),
      )
      .map_err(|error| error.to_string())?;
    connection
      .execute(
        "UPDATE notes SET board_id = ?1 WHERE board_id != ?1",
        params![primary_id],
      )
      .map_err(|error| error.to_string())?;
    connection
      .execute("DELETE FROM boards WHERE id != ?1", params![primary_id])
      .map_err(|error| error.to_string())?;
    connection
      .execute(
        "UPDATE boards SET name = 'Notes' WHERE id = ?1",
        params![primary_id],
      )
      .map_err(|error| error.to_string())?;
  }

  Ok(())
}

fn normalize_note(row: NoteRow) -> Note {
  Note {
    id: row.id,
    board_id: row.board_id,
    title: row.title,
    content: row.content,
    pinned: row.pinned != 0,
    archived: row.archived != 0,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

fn get_note(connection: &Connection, note_id: i64) -> Result<Option<NoteRow>, String> {
  connection
    .query_row(
      "
      SELECT id, board_id, title, content, pinned, archived, sort_order, created_at, updated_at
      FROM notes
      WHERE id = ?1
      ",
      params![note_id],
      |row| {
        Ok(NoteRow {
          id: row.get(0)?,
          board_id: row.get(1)?,
          title: row.get(2)?,
          content: row.get(3)?,
          pinned: row.get(4)?,
          archived: row.get(5)?,
          sort_order: row.get(6)?,
          created_at: row.get(7)?,
          updated_at: row.get(8)?,
        })
      },
    )
    .optional()
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn ensure_board() -> Result<Board, String> {
  let connection = connect()?;
  connection
    .query_row(
      "
      SELECT boards.id, boards.name, boards.created_at, boards.updated_at,
        (SELECT COUNT(*) FROM notes WHERE notes.board_id = boards.id AND notes.archived = 0) as active_count
      FROM boards
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
      ",
      [],
      |row| {
        Ok(Board {
          id: row.get(0)?,
          name: row.get(1)?,
          created_at: row.get(2)?,
          updated_at: row.get(3)?,
          active_count: Some(row.get(4)?),
        })
      },
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_notes(board_id: i64, archived: bool, search: String) -> Result<Vec<Note>, String> {
  let connection = connect()?;
  let archived_int = if archived { 1 } else { 0 };
  let search_like = format!("%{}%", search.trim());
  let mut statement = connection
    .prepare(
      "
      SELECT id, board_id, title, content, pinned, archived, sort_order, created_at, updated_at
      FROM notes
      WHERE board_id = ?1
        AND archived = ?2
        AND (?3 = '%%' OR content LIKE ?3 OR title LIKE ?3)
      ORDER BY pinned DESC, COALESCE(sort_order, 999999999) ASC, updated_at DESC, id DESC
      ",
    )
    .map_err(|error| error.to_string())?;

  let rows = statement
    .query_map(params![board_id, archived_int, search_like], |row| {
      Ok(NoteRow {
        id: row.get(0)?,
        board_id: row.get(1)?,
        title: row.get(2)?,
        content: row.get(3)?,
        pinned: row.get(4)?,
        archived: row.get(5)?,
        sort_order: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
      })
    })
    .map_err(|error| error.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| error.to_string())?;

  Ok(rows.into_iter().map(normalize_note).collect())
}

#[tauri::command]
pub fn create_note(board_id: i64, title: String, content: String) -> Result<Note, String> {
  let connection = connect()?;
  let title = title.trim().to_string();
  let content = content.trim().to_string();
  if content.is_empty() {
    return Err("content is required".to_string());
  }

  connection
    .execute(
      "
      UPDATE notes
      SET sort_order = COALESCE(sort_order, 0) + 1
      WHERE board_id = ?1 AND archived = 0 AND pinned = 0
      ",
      params![board_id],
    )
    .map_err(|error| error.to_string())?;
  connection
    .execute(
      "INSERT INTO notes (board_id, title, content, sort_order) VALUES (?1, ?2, ?3, 0)",
      params![board_id, title, content],
    )
    .map_err(|error| error.to_string())?;

  let updated_at = now_sql();
  connection
    .execute(
      "UPDATE boards SET updated_at = ?1 WHERE id = ?2",
      params![updated_at, board_id],
    )
    .map_err(|error| error.to_string())?;

  get_note(&connection, connection.last_insert_rowid())?
    .map(normalize_note)
    .ok_or_else(|| "Note not found after create".to_string())
}

#[tauri::command]
pub fn patch_note(
  note_id: i64,
  title: Option<String>,
  content: Option<String>,
  pinned: Option<bool>,
  archived: Option<bool>,
  sort_order: Option<i64>,
) -> Result<Note, String> {
  let connection = connect()?;
  let current = get_note(&connection, note_id)?.ok_or_else(|| "Note not found".to_string())?;

  let next_title = title
    .map(|value| value.trim().to_string())
    .unwrap_or_else(|| current.title.clone());
  let next_content = content
    .map(|value| value.trim().to_string())
    .unwrap_or_else(|| current.content.clone());
  if next_content.is_empty() {
    return Err("content is required".to_string());
  }

  let next_pinned = pinned.map(|value| if value { 1 } else { 0 }).unwrap_or(current.pinned);
  let next_archived = archived.map(|value| if value { 1 } else { 0 }).unwrap_or(current.archived);
  let next_sort_order = sort_order.or(current.sort_order);
  let updated_at = now_sql();
  let content_changed = next_title != current.title || next_content != current.content;
  let should_return_to_unpinned_start = current.pinned == 1 && next_pinned == 0 && next_archived == 0;
  let should_promote = content_changed && next_pinned == 0 && next_archived == 0;
  let should_place_at_start = should_return_to_unpinned_start || should_promote;

  if should_place_at_start {
    connection
      .execute(
        "
        UPDATE notes
        SET sort_order = COALESCE(sort_order, 0) + 1
        WHERE board_id = ?1 AND archived = 0 AND pinned = 0 AND id != ?2
        ",
        params![current.board_id, note_id],
      )
      .map_err(|error| error.to_string())?;
  }

  connection
    .execute(
      "
      UPDATE notes
      SET title = ?1, content = ?2, pinned = ?3, archived = ?4, sort_order = ?5, updated_at = ?6
      WHERE id = ?7
      ",
      params![
        next_title,
        next_content,
        next_pinned,
        next_archived,
        if should_place_at_start { Some(0) } else { next_sort_order },
        updated_at,
        note_id
      ],
    )
    .map_err(|error| error.to_string())?;
  connection
    .execute(
      "UPDATE boards SET updated_at = ?1 WHERE id = ?2",
      params![updated_at, current.board_id],
    )
    .map_err(|error| error.to_string())?;

  get_note(&connection, note_id)?
    .map(normalize_note)
    .ok_or_else(|| "Note not found after update".to_string())
}

#[tauri::command]
pub fn delete_note(note_id: i64) -> Result<(), String> {
  let connection = connect()?;
  let board_id = get_note(&connection, note_id)?
    .map(|note| note.board_id)
    .ok_or_else(|| "Note not found".to_string())?;
  connection
    .execute("DELETE FROM notes WHERE id = ?1", params![note_id])
    .map_err(|error| error.to_string())?;
  connection
    .execute(
      "UPDATE boards SET updated_at = ?1 WHERE id = ?2",
      params![now_sql(), board_id],
    )
    .map_err(|error| error.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn reorder_notes(note_ids: Vec<i64>) -> Result<(), String> {
  let mut connection = connect()?;
  let transaction = connection.transaction().map_err(|error| error.to_string())?;
  {
    let mut statement = transaction
      .prepare("UPDATE notes SET sort_order = ?1 WHERE id = ?2")
      .map_err(|error| error.to_string())?;
    for (index, note_id) in note_ids.iter().enumerate() {
      statement
        .execute(params![index as i64, note_id])
        .map_err(|error| error.to_string())?;
    }
  }
  transaction.commit().map_err(|error| error.to_string())
}
