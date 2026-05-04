import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Archive,
  ArchiveRestore,
  Clipboard,
  GripVertical,
  Maximize2,
  MoreVertical,
  Pin,
  Plus,
  Rows3,
  Search,
  Trash2,
  X
} from 'lucide-react';
import './styles.css';

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (window.location.port === '4000' ? '/api' : 'http://127.0.0.1:4000/api');

const emptyCapture = { title: '', content: '' };

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

function App() {
  const [activeBoardId, setActiveBoardId] = useState(null);
  const [notes, setNotes] = useState([]);
  const [capture, setCapture] = useState(emptyCapture);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [modal, setModal] = useState(null);
  const [draggedNoteId, setDraggedNoteId] = useState(null);
  const [dragInsert, setDragInsert] = useState(null);
  const [noteDensity, setNoteDensity] = useState('full');
  const [openNoteMenuId, setOpenNoteMenuId] = useState(null);
  const dragOriginalNotesRef = useRef([]);
  const noteRefs = useRef(new Map());
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  async function ensureBoard() {
    const boards = await api('/boards');
    if (boards.length > 0) {
      setActiveBoardId(boards[0].id);
      return;
    }

    const board = await api('/boards', {
      method: 'POST',
      body: JSON.stringify({ name: 'Notes' })
    });
    setActiveBoardId(board.id);
  }

  async function loadNotes() {
    if (!activeBoardId) {
      setNotes([]);
      return;
    }

    const params = new URLSearchParams({
      archived: String(showArchived),
      search
    });
    const nextNotes = await api(`/boards/${activeBoardId}/notes?${params.toString()}`);
    setNotes(nextNotes);
  }

  useEffect(() => {
    ensureBoard()
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    loadNotes().catch((err) => setError(err.message));
  }, [activeBoardId, showArchived, search]);

  async function createNote(event, source = capture) {
    event.preventDefault();
    const content = source.content.trim();
    const title = source.title.trim();
    if (!content || !activeBoardId) return;

    try {
      await api(`/boards/${activeBoardId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ title, content })
      });
      setCapture(emptyCapture);
      setModal(null);
      await loadNotes();
    } catch (err) {
      setError(err.message);
    }
  }

  async function patchNote(noteId, patch) {
    try {
      await api(`/notes/${noteId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch)
      });
      await loadNotes();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteNote(noteId) {
    if (!window.confirm('Delete this note?')) return;

    try {
      await api(`/notes/${noteId}`, { method: 'DELETE' });
      setModal(null);
      await loadNotes();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveModalNote(event) {
    event.preventDefault();
    if (!modal || modal.mode !== 'note') return;
    const title = modal.title.trim();
    const content = modal.content.trim();
    if (!content) return;
    await patchNote(modal.noteId, { title, content });
    setModal(null);
  }

  async function copyNote(content) {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      setError('Clipboard permission was denied.');
    }
  }

  async function reorderNotes(nextNotes) {
    try {
      await api('/notes/reorder', {
        method: 'POST',
        body: JSON.stringify({ noteIds: nextNotes.map((note) => note.id) })
      });
      await loadNotes();
    } catch (err) {
      setError(err.message);
      await loadNotes();
    }
  }

  function getNoteRects() {
    const rects = new Map();
    noteRefs.current.forEach((element, noteId) => {
      if (element) rects.set(noteId, element.getBoundingClientRect());
    });
    return rects;
  }

  function animateNoteLayout(previousRects) {
    requestAnimationFrame(() => {
      noteRefs.current.forEach((element, noteId) => {
        const previous = previousRects.get(noteId);
        if (!element || !previous) return;

        const next = element.getBoundingClientRect();
        const deltaX = previous.left - next.left;
        const deltaY = previous.top - next.top;
        if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;

        element.animate(
          [
            { transform: `translate(${deltaX}px, ${deltaY}px)` },
            { transform: 'translate(0, 0)' }
          ],
          {
            duration: 230,
            easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
          }
        );
      });
    });
  }

  function getInsertSideFromRect(clientX, clientY, rect) {
    const horizontalWeight = Math.abs(clientX - (rect.left + rect.width / 2));
    const verticalWeight = Math.abs(clientY - (rect.top + rect.height / 2));

    if (horizontalWeight > verticalWeight) {
      return clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    }

    return clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  }

  function getInsertSide(event) {
    return getInsertSideFromRect(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect()
    );
  }

  function previewNearestDragOrder(event) {
    if (!canDragSort || !draggedNoteId) return;

    const sourceNote = notes.find((note) => note.id === draggedNoteId);
    if (!sourceNote) return;

    let closest = null;
    noteRefs.current.forEach((element, noteId) => {
      const note = notes.find((item) => item.id === noteId);
      if (!element || !note || note.id === draggedNoteId || note.pinned !== sourceNote.pinned) return;

      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distance = Math.hypot(event.clientX - centerX, event.clientY - centerY);

      if (!closest || distance < closest.distance) {
        closest = { note, rect, distance };
      }
    });

    if (!closest) return;
    previewDragOrder(
      closest.note,
      getInsertSideFromRect(event.clientX, event.clientY, closest.rect)
    );
  }

  function previewDragOrder(targetNote, insertSide) {
    if (!canDragSort || !draggedNoteId || draggedNoteId === targetNote.id) return;
    if (dragInsert?.noteId === targetNote.id && dragInsert.side === insertSide) return;

    const sourceIndex = notes.findIndex((note) => note.id === draggedNoteId);
    const targetIndex = notes.findIndex((note) => note.id === targetNote.id);
    const sourceNote = notes[sourceIndex];
    const rawInsertIndex = targetIndex + (insertSide === 'after' ? 1 : 0);
    const insertIndex = sourceIndex < rawInsertIndex ? rawInsertIndex - 1 : rawInsertIndex;

    if (
      sourceIndex < 0 ||
      targetIndex < 0 ||
      sourceIndex === insertIndex ||
      !sourceNote ||
      sourceNote.pinned !== targetNote.pinned
    ) {
      setDragInsert({ noteId: targetNote.id, side: insertSide });
      return;
    }

    const previousRects = getNoteRects();
    const nextNotes = [...notes];
    const [moved] = nextNotes.splice(sourceIndex, 1);
    nextNotes.splice(insertIndex, 0, moved);
    setNotes(nextNotes);
    setDragInsert({ noteId: targetNote.id, side: insertSide });
    animateNoteLayout(previousRects);
  }

  function handleDrop() {
    if (!draggedNoteId) return;
    const nextNotes = notes;
    setDraggedNoteId(null);
    setDragInsert(null);
    dragOriginalNotesRef.current = [];
    reorderNotes(nextNotes);
  }

  function cancelDrag() {
    const originalNotes = dragOriginalNotesRef.current;
    setDraggedNoteId(null);
    setDragInsert(null);

    if (originalNotes.length > 0) {
      const previousRects = getNoteRects();
      setNotes(originalNotes);
      animateNoteLayout(previousRects);
    }

    dragOriginalNotesRef.current = [];
  }

  function openCaptureModal() {
    setModal({ mode: 'capture', title: capture.title, content: capture.content });
  }

  function openNoteModal(note) {
    setOpenNoteMenuId(null);
    setModal({ mode: 'note', noteId: note.id, title: note.title || '', content: note.content });
  }

  const pinnedCount = notes.filter((note) => note.pinned).length;
  const canDragSort = !showArchived && !search;
  const dragHint = canDragSort
    ? 'Drag notes to reorder within their current group'
    : 'Sorting is paused while searching or viewing archived notes';

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2>Note Desk</h2>
          </div>
          <div className="topbar-tools">
            <label className="search-box">
              <Search size={18} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search this board"
              />
              {search && (
                <button title="Clear search" onClick={() => setSearch('')}>
                  <X size={16} />
                </button>
              )}
            </label>
            <button
              className={`density-toggle ${noteDensity === 'compact' ? 'is-on' : ''}`}
              onClick={() => setNoteDensity((value) => value === 'compact' ? 'full' : 'compact')}
              title={noteDensity === 'compact' ? 'Show full notes' : 'Show one-line notes'}
            >
              <Rows3 size={18} />
              <span>{noteDensity === 'compact' ? 'Compact' : 'Full'}</span>
            </button>
            <button
              className={`archive-toggle ${showArchived ? 'is-on' : ''}`}
              onClick={() => setShowArchived((value) => !value)}
            >
              {showArchived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
              <span>{showArchived ? 'Archived' : 'Active'}</span>
            </button>
          </div>
        </header>

        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => setError('')}><X size={16} /></button>
          </div>
        )}

        <form className="quick-capture" onSubmit={createNote}>
          <div className="capture-title-row">
            <input
              className="capture-title"
              value={capture.title}
              disabled={!activeBoardId}
              onChange={(event) => setCapture((value) => ({ ...value, title: event.target.value }))}
              placeholder="Title"
            />
            <div className="capture-actions">
              <button type="button" className="ghost-button" onClick={openCaptureModal} title="Open large editor">
                <Maximize2 size={18} />
              </button>
              <button type="submit" disabled={!capture.content.trim() || !activeBoardId}>
                <Plus size={18} />
                <span>Add note</span>
              </button>
            </div>
          </div>
          <textarea
            className="capture-content"
            value={capture.content}
            disabled={!activeBoardId}
            onChange={(event) => setCapture((value) => ({ ...value, content: event.target.value }))}
            placeholder="Note content"
            rows={1}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                createNote(event);
              }
            }}
          />
        </form>

        <div className="board-meta">
          <span className="meta-pill meta-pill-strong">{notes.length} notes</span>
          <span className="meta-pill">{pinnedCount} pinned</span>
          <span className="meta-pill meta-pill-wide">{dragHint}</span>
        </div>

        {isLoading ? (
          <div className="empty-state">Loading local boards...</div>
        ) : notes.length === 0 ? (
          <div className="empty-state">
            <strong>No notes yet</strong>
            <span>Add a quick note above to start this board.</span>
          </div>
        ) : (
          <div
            className="note-grid"
            onDragOver={(event) => {
              if (!canDragSort || !draggedNoteId) return;
              event.preventDefault();
              previewNearestDragOrder(event);
            }}
          >
            {notes.map((note) => (
              <article
                className={`note-card ${noteDensity === 'compact' ? 'is-compact' : ''} ${note.pinned ? 'is-pinned' : ''} ${draggedNoteId === note.id ? 'is-dragging' : ''} ${dragInsert?.noteId === note.id && draggedNoteId !== note.id ? 'is-drop-target' : ''} ${dragInsert?.noteId === note.id && dragInsert.side === 'before' ? 'is-insert-before' : ''} ${dragInsert?.noteId === note.id && dragInsert.side === 'after' ? 'is-insert-after' : ''}`}
                draggable={canDragSort}
                key={note.id}
                ref={(element) => {
                  if (element) {
                    noteRefs.current.set(note.id, element);
                  } else {
                    noteRefs.current.delete(note.id);
                  }
                }}
                onDragStart={(event) => {
                  dragOriginalNotesRef.current = notes;
                  setDraggedNoteId(note.id);
                  setDragInsert(null);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(event) => {
                  if (!canDragSort || !draggedNoteId || draggedNoteId === note.id) return;
                  event.preventDefault();
                  previewDragOrder(note, getInsertSide(event));
                }}
                onDrop={handleDrop}
                onDragEnd={cancelDrag}
              >
                <div className="note-toolbar">
                  <span className="drag-handle" title={canDragSort ? 'Drag to reorder' : 'Sorting is disabled in this view'}>
                    <GripVertical size={16} />
                  </span>
                  <h3 className="note-title">{note.title || note.content.split('\n')[0] || 'Untitled'}</h3>
                  <button title="Copy" onClick={() => copyNote(note.content)}>
                    <Clipboard size={16} />
                  </button>
                  <div className="note-menu-wrap">
                    <button
                      title="Note actions"
                      onClick={() => setOpenNoteMenuId((value) => value === note.id ? null : note.id)}
                    >
                      <MoreVertical size={16} />
                    </button>
                    {openNoteMenuId === note.id ? (
                      <div className="note-menu" role="menu">
                        <button onClick={() => patchNote(note.id, { pinned: !note.pinned })}>
                          <Pin size={15} />
                          <span>{note.pinned ? 'Unpin' : 'Pin'}</span>
                        </button>
                        <button onClick={() => openNoteModal(note)}>
                          <Maximize2 size={15} />
                          <span>Expand</span>
                        </button>
                        <button onClick={() => patchNote(note.id, { archived: !note.archived })}>
                          {note.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                          <span>{note.archived ? 'Restore' : 'Archive'}</span>
                        </button>
                        <button className="danger-menu-item" onClick={() => deleteNote(note.id)}>
                          <Trash2 size={15} />
                          <span>Delete</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="note-body" onDoubleClick={() => openNoteModal(note)}>
                  <p className="note-content">{note.content}</p>
                </div>
                <footer className="note-footer">
                  {note.pinned ? <span className="note-chip">Pinned</span> : <span />}
                  <span>{new Date(note.updatedAt).toLocaleString()}</span>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>

      {modal ? (
        <div className="modal-backdrop" role="presentation">
          <section className="note-modal" role="dialog" aria-modal="true" aria-label="Large note editor">
            <header className="modal-header">
              <div>
                <p className="eyebrow">{modal.mode === 'capture' ? 'New note' : 'View and edit'}</p>
                <h2>{modal.mode === 'capture' ? 'Expanded capture' : 'Note details'}</h2>
              </div>
              <button title="Close" onClick={() => setModal(null)}>
                <X size={20} />
              </button>
            </header>

            <form
              className="modal-form"
              onSubmit={(event) => {
                if (modal.mode === 'capture') {
                  createNote(event, modal);
                } else {
                  saveModalNote(event);
                }
              }}
            >
              <input
                value={modal.title}
                onChange={(event) => setModal((value) => ({ ...value, title: event.target.value }))}
                placeholder="Title, optional"
              />
              <textarea
                autoFocus
                value={modal.content}
                onChange={(event) => setModal((value) => ({ ...value, content: event.target.value }))}
                placeholder="Note content"
              />
              <footer className="modal-actions">
                {modal.mode === 'note' ? (
                  <button type="button" className="danger-button" onClick={() => deleteNote(modal.noteId)}>
                    Delete
                  </button>
                ) : <span />}
                <div>
                  <button type="button" onClick={() => setModal(null)}>Cancel</button>
                  <button type="submit" disabled={!modal.content.trim()}>
                    {modal.mode === 'capture' ? 'Add note' : 'Save changes'}
                  </button>
                </div>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
