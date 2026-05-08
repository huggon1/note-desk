import {
  closestCenter,
  DndContext,
  type DragCancelEvent,
  DragOverlay,
  type DragMoveEvent,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  type DragStartEvent,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (window.location.port === '4000' ? '/api' : 'http://127.0.0.1:4000/api');

type Board = {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeCount?: number;
};

type Note = {
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

type CaptureDraft = {
  title: string;
  content: string;
};

type EditorModalState =
  | ({ mode: 'capture' } & CaptureDraft)
  | ({ mode: 'note'; noteId: number; originalTitle: string; originalContent: string } & CaptureDraft);

type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

type NotePatch = Partial<Pick<Note, 'title' | 'content' | 'pinned' | 'archived' | 'sortOrder'>>;

type DragSlot = {
  noteId: number;
  index: number;
  pinned: boolean;
  rect: DOMRect;
  centerX: number;
  centerY: number;
};

type DragSession = {
  activeId: number;
  groupPinned: boolean;
  originNotes: Note[];
  slots: DragSlot[];
};

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

function isTextEntryElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, button, [contenteditable="true"], .note-menu, .note-modal'
    )
  );
}

function measureDragSlots(notes: Note[], elements: Map<number, HTMLElement>, groupPinned: boolean): DragSlot[] {
  return notes
    .filter((note) => note.pinned === groupPinned)
    .map((note, index) => {
      const element = elements.get(note.id);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        noteId: note.id,
        index,
        pinned: note.pinned,
        rect,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2
      };
    })
    .filter((slot): slot is DragSlot => Boolean(slot));
}

function getMagneticInsertIndex(session: DragSession, delta: { x: number; y: number }): number {
  const activeSlot = session.slots.find((slot) => slot.noteId === session.activeId);
  if (!activeSlot) return 0;

  const draggedCenterX = activeSlot.centerX + delta.x;
  const draggedCenterY = activeSlot.centerY + delta.y;
  const rowThreshold = activeSlot.rect.height * 0.55;
  const orderedSlots = [...session.slots].sort((a, b) => a.index - b.index);

  for (const slot of orderedSlots) {
    const isBeforeRow = draggedCenterY < slot.centerY - rowThreshold;
    const isSameRowBefore = Math.abs(draggedCenterY - slot.centerY) <= rowThreshold && draggedCenterX < slot.centerX;
    if (isBeforeRow || isSameRowBefore) {
      return slot.index;
    }
  }

  return Math.max(orderedSlots.length - 1, 0);
}

function reorderWithinPinnedGroup(notes: Note[], activeId: number, targetIndex: number): Note[] {
  const activeNote = notes.find((note) => note.id === activeId);
  if (!activeNote) return notes;

  const group = notes.filter((note) => note.pinned === activeNote.pinned);
  const currentIndex = group.findIndex((note) => note.id === activeId);
  if (currentIndex < 0) return notes;

  const clampedTargetIndex = Math.max(0, Math.min(targetIndex, group.length - 1));
  if (currentIndex === clampedTargetIndex) return notes;

  const reorderedGroup = arrayMove(group, currentIndex, clampedTargetIndex);
  let groupCursor = 0;
  return notes.map((note) => {
    if (note.pinned !== activeNote.pinned) return note;
    const nextNote = reorderedGroup[groupCursor];
    groupCursor += 1;
    return nextNote;
  });
}

function App() {
  const [activeBoardId, setActiveBoardId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [modal, setModal] = useState<EditorModalState | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  const [dragOriginNotes, setDragOriginNotes] = useState<Note[] | null>(null);
  const [noteDensity, setNoteDensity] = useState<'full' | 'compact'>('full');
  const [openNoteMenuId, setOpenNoteMenuId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const modalContentRef = useRef<HTMLTextAreaElement | null>(null);
  const modalFocusKeyRef = useRef<string | null>(null);
  const noteElementsRef = useRef(new Map<number, HTMLElement>());
  const dragSessionRef = useRef<DragSession | null>(null);
  const isModalSavingRef = useRef(false);

  async function ensureBoard() {
    const boards = await api<Board[]>('/boards');
    if (boards.length > 0) {
      setActiveBoardId(boards[0].id);
      return;
    }

    const board = await api<Board>('/boards', {
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
    const nextNotes = await api<Note[]>(`/boards/${activeBoardId}/notes?${params.toString()}`);
    setNotes(nextNotes);
  }

  useEffect(() => {
    ensureBoard()
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    loadNotes().catch((err: Error) => setError(err.message));
  }, [activeBoardId, showArchived, search]);

  useEffect(() => {
    if (!modal) {
      modalFocusKeyRef.current = null;
      return;
    }

    const focusKey = modal.mode === 'note' ? `note-${modal.noteId}` : 'capture';
    if (modalFocusKeyRef.current === focusKey) return;
    modalFocusKeyRef.current = focusKey;
    requestAnimationFrame(() => modalContentRef.current?.focus());
  }, [modal]);

  useEffect(() => {
    if (!openNoteMenuId) return;

    function closeMenuOnOutsidePointer(event: PointerEvent) {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('.note-menu-wrap')) return;
      setOpenNoteMenuId(null);
    }

    window.addEventListener('pointerdown', closeMenuOnOutsidePointer);
    return () => window.removeEventListener('pointerdown', closeMenuOnOutsidePointer);
  }, [openNoteMenuId]);

  useEffect(() => {
    function handlePageEnter(event: globalThis.KeyboardEvent) {
      if (
        event.key !== 'Enter' ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        modal ||
        isTextEntryElement(event.target)
      ) {
        return;
      }

      event.preventDefault();
      openCaptureModal();
    }

    window.addEventListener('keydown', handlePageEnter);
    return () => window.removeEventListener('keydown', handlePageEnter);
  }, [modal]);

  async function createNoteFromDraft(source: CaptureDraft): Promise<boolean> {
    const content = source.content.trim();
    const title = source.title.trim();
    if (!content || !activeBoardId) return false;

    try {
      await api<Note>(`/boards/${activeBoardId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ title, content })
      });
      await loadNotes();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  async function patchNote(noteId: number, patch: NotePatch): Promise<boolean> {
    try {
      await api<Note>(`/notes/${noteId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch)
      });
      await loadNotes();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  async function deleteNote(noteId: number) {
    try {
      await api<null>(`/notes/${noteId}`, { method: 'DELETE' });
      setModal(null);
      await loadNotes();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveModalNote(source: Extract<EditorModalState, { mode: 'note' }>): Promise<boolean> {
    const title = source.title.trim();
    const content = source.content.trim();
    if (!content) return false;
    if (title === source.originalTitle && content === source.originalContent) return true;
    return patchNote(source.noteId, { title, content });
  }

  async function persistModalAndClose() {
    if (!modal || isModalSavingRef.current) return;
    const currentModal = modal;
    const content = currentModal.content.trim();

    if (!content) {
      if (currentModal.mode === 'capture') {
        setModal(null);
        setSaveStatus('idle');
        return;
      }

      setSaveStatus('failed');
      setError('Note content is required to save.');
      return;
    }

    setSaveStatus('saving');
    isModalSavingRef.current = true;
    const saved =
      currentModal.mode === 'capture' ? await createNoteFromDraft(currentModal) : await saveModalNote(currentModal);
    isModalSavingRef.current = false;

    if (saved) {
      setSaveStatus('saved');
      setModal(null);
      return;
    }

    setSaveStatus('failed');
  }

  async function submitModal(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    await persistModalAndClose();
  }

  function handleModalKeyDown(event: ReactKeyboardEvent<HTMLFormElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.requestSubmit();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      void persistModalAndClose();
    }
  }

  async function copyNote(content: string) {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      setError('Clipboard permission was denied.');
    }
  }

  async function reorderNotes(nextNotes: Note[]) {
    try {
      await api<{ ok: boolean }>('/notes/reorder', {
        method: 'POST',
        body: JSON.stringify({ noteIds: nextNotes.map((note) => note.id) })
      });
      await loadNotes();
    } catch (err) {
      setError((err as Error).message);
      await loadNotes();
    }
  }

  function openCaptureModal() {
    setSaveStatus('idle');
    setModal({ mode: 'capture', title: '', content: '' });
  }

  function openNoteModal(note: Note) {
    setOpenNoteMenuId(null);
    setSaveStatus('idle');
    setModal({
      mode: 'note',
      noteId: note.id,
      title: note.title || '',
      content: note.content,
      originalTitle: note.title || '',
      originalContent: note.content
    });
  }

  function discardModal() {
    setSaveStatus('idle');
    setModal(null);
  }

  function registerNoteElement(noteId: number, element: HTMLElement | null) {
    if (element) {
      noteElementsRef.current.set(noteId, element);
    } else {
      noteElementsRef.current.delete(noteId);
    }
  }

  const visibleNotes = dragOriginNotes ?? notes;
  const pinnedNotes = useMemo(() => notes.filter((note) => note.pinned), [notes]);
  const unpinnedNotes = useMemo(() => notes.filter((note) => !note.pinned), [notes]);
  const pinnedCount = pinnedNotes.length;
  const canDragSort = !showArchived && !search;
  const activeDragNote = activeDragId ? visibleNotes.find((note) => note.id === activeDragId) : null;
  const activeDragDensity = activeDragNote?.pinned ? 'pinned' : noteDensity;
  const showPinnedSidebar = !isLoading && pinnedCount > 0;
  const modalNote = modal?.mode === 'note' ? notes.find((note) => note.id === modal.noteId) : null;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragStart(event: DragStartEvent) {
    if (!canDragSort) return;
    const activeId = Number(event.active.id);
    const activeNote = notes.find((note) => note.id === activeId);
    if (!activeNote) return;

    const originNotes = notes;
    const slots = measureDragSlots(originNotes, noteElementsRef.current, activeNote.pinned);
    if (slots.length === 0) return;

    setOpenNoteMenuId(null);
    dragSessionRef.current = {
      activeId,
      groupPinned: activeNote.pinned,
      originNotes,
      slots
    };
    setDragOriginNotes(originNotes);
    setActiveDragId(activeId);
  }

  function handleDragMove(event: DragMoveEvent) {
    if (!canDragSort) return;
    const session = dragSessionRef.current;
    if (!session) return;

    setNotes((currentNotes) => {
      const targetIndex = getMagneticInsertIndex(session, event.delta);
      return reorderWithinPinnedGroup(currentNotes, session.activeId, targetIndex);
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeId = Number(event.active.id);
    const overId = event.over ? Number(event.over.id) : null;
    const nextNotes = notes;
    const orderChanged =
      Boolean(dragOriginNotes) &&
      nextNotes.map((note) => note.id).join(',') !== dragOriginNotes?.map((note) => note.id).join(',');
    setActiveDragId(null);
    setDragOriginNotes(null);
    dragSessionRef.current = null;

    if (!overId) {
      if (dragOriginNotes) setNotes(dragOriginNotes);
      return;
    }
    if (activeId === overId) {
      if (orderChanged) void reorderNotes(nextNotes);
      return;
    }
    const activeNote = nextNotes.find((note) => note.id === activeId);
    const overNote = nextNotes.find((note) => note.id === overId);
    if (!activeNote || !overNote || activeNote.pinned !== overNote.pinned) return;

    if (!orderChanged) return;
    void reorderNotes(nextNotes);
  }

  function handleDragCancel(_event: DragCancelEvent) {
    if (dragOriginNotes) setNotes(dragOriginNotes);
    setActiveDragId(null);
    setDragOriginNotes(null);
    dragSessionRef.current = null;
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2>Note Desk</h2>
            <div className="topbar-meta">
              <span className="meta-pill meta-pill-strong">{notes.length} notes</span>
              <span className="meta-pill">{pinnedCount} pinned</span>
            </div>
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
              type="button"
              className="new-note-button"
              onClick={openCaptureModal}
              disabled={!activeBoardId}
            >
              <Plus size={18} />
              <span>New note</span>
            </button>
            <button
              className={`density-toggle ${noteDensity === 'compact' ? 'is-on' : ''}`}
              onClick={() => setNoteDensity((value) => (value === 'compact' ? 'full' : 'compact'))}
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
            <button onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className={`board-layout ${showPinnedSidebar ? 'has-pinned-sidebar' : ''}`}>
            <div className="board-main">
              {isLoading ? (
                <div className="empty-state">Loading local boards...</div>
              ) : notes.length === 0 ? (
                <div className="empty-state">
                  <strong>No notes yet</strong>
                  <span>Use New note or press Enter to start this board.</span>
                </div>
              ) : (
                <div className={`note-grid ${activeDragId ? 'is-reordering' : ''}`}>
                  {unpinnedNotes.length === 0 ? (
                    <div className="empty-state note-grid-empty">
                      <strong>All notes are pinned</strong>
                      <span>Unpin a note to return it to the main board.</span>
                    </div>
                  ) : (
                    <SortableContext items={unpinnedNotes.map((note) => note.id)} strategy={rectSortingStrategy}>
                      {unpinnedNotes.map((note) => (
                        <SortableNoteCard
                          key={note.id}
                          canDragSort={canDragSort}
                          copyNote={copyNote}
                          deleteNote={deleteNote}
                          density={noteDensity}
                          isMenuOpen={openNoteMenuId === note.id}
                          note={note}
                          onMenuToggle={() => setOpenNoteMenuId((value) => (value === note.id ? null : note.id))}
                          openNoteModal={openNoteModal}
                          patchNote={patchNote}
                          registerNoteElement={registerNoteElement}
                        />
                      ))}
                    </SortableContext>
                  )}
                </div>
              )}
            </div>

            {showPinnedSidebar ? (
              <aside className="pinned-sidebar" aria-label="Pinned notes">
                <header className="pinned-sidebar-header">
                  <div>
                    <p className="eyebrow">Pinned</p>
                    <h3>Reference notes</h3>
                  </div>
                  <span>{pinnedCount}</span>
                </header>
                <div className={`pinned-note-list ${activeDragId ? 'is-reordering' : ''}`}>
                  <SortableContext items={pinnedNotes.map((note) => note.id)} strategy={rectSortingStrategy}>
                    {pinnedNotes.map((note) => (
                      <SortableNoteCard
                        key={note.id}
                        canDragSort={canDragSort}
                        copyNote={copyNote}
                        deleteNote={deleteNote}
                        density="pinned"
                        isMenuOpen={openNoteMenuId === note.id}
                        note={note}
                        onMenuToggle={() => setOpenNoteMenuId((value) => (value === note.id ? null : note.id))}
                        openNoteModal={openNoteModal}
                        patchNote={patchNote}
                        registerNoteElement={registerNoteElement}
                      />
                    ))}
                  </SortableContext>
                </div>
              </aside>
            ) : null}
          </div>
          <DragOverlay dropAnimation={null}>
            {activeDragNote ? (
              <NoteCardShell
                canDragSort={canDragSort}
                density={activeDragDensity}
                isOverlay
                note={activeDragNote}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </section>

      {modal ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) void persistModalAndClose();
          }}
        >
          <section className="note-modal" role="dialog" aria-modal="true" aria-label="Large note editor">
            <header className="modal-header">
              <div>
                <p className="eyebrow">{modal.mode === 'capture' ? 'New note' : 'View and edit'}</p>
                <h2>{modal.mode === 'capture' ? 'Expanded capture' : 'Note details'}</h2>
                {modalNote ? (
                  <span className="modal-updated-at">
                    Updated {new Date(modalNote.updatedAt).toLocaleString()}
                  </span>
                ) : null}
              </div>
              <button title="Save and close" onClick={() => void persistModalAndClose()}>
                <X size={20} />
              </button>
            </header>

            <form className="modal-form" onSubmit={submitModal} onKeyDown={handleModalKeyDown}>
              <input
                value={modal.title}
                onChange={(event) => {
                  setSaveStatus('idle');
                  setModal((value) => (value ? { ...value, title: event.target.value } : value));
                }}
                placeholder="Title, optional"
              />
              <textarea
                ref={modalContentRef}
                value={modal.content}
                onChange={(event) => {
                  setSaveStatus('idle');
                  setModal((value) => (value ? { ...value, content: event.target.value } : value));
                }}
                placeholder="Note content"
              />
              <footer className="modal-actions">
                <div className="modal-left-actions">
                  <button type="button" onClick={discardModal}>
                    Discard
                  </button>
                  {modal.mode === 'note' ? (
                    <button type="button" className="danger-button" onClick={() => deleteNote(modal.noteId)}>
                      Delete
                    </button>
                  ) : null}
                </div>
                <span className={`save-status save-status-${saveStatus}`} aria-live="polite">
                  {saveStatus === 'saving'
                    ? 'Saving'
                    : saveStatus === 'saved'
                      ? 'Saved'
                      : saveStatus === 'failed'
                        ? 'Save failed'
                        : ''}
                </span>
                <div className="modal-right-actions">
                  <button type="submit" disabled={saveStatus === 'saving' || (modal.mode === 'note' && !modal.content.trim())}>
                    Done
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

type NoteCardProps = {
  canDragSort: boolean;
  copyNote?: (content: string) => void;
  deleteNote?: (noteId: number) => void;
  density: 'full' | 'compact' | 'pinned';
  isMenuOpen?: boolean;
  isOverlay?: boolean;
  note: Note;
  onMenuToggle?: () => void;
  openNoteModal?: (note: Note) => void;
  patchNote?: (noteId: number, patch: NotePatch) => Promise<boolean>;
  registerNoteElement?: (noteId: number, element: HTMLElement | null) => void;
  setActivatorNodeRef?: (element: HTMLElement | null) => void;
  sortableAttributes?: ReturnType<typeof useSortable>['attributes'];
  sortableListeners?: ReturnType<typeof useSortable>['listeners'];
  style?: CSSProperties;
};

function SortableNoteCard(props: Omit<NoteCardProps, 'isOverlay' | 'setActivatorNodeRef' | 'sortableAttributes' | 'sortableListeners' | 'style'>) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: props.note.id,
      disabled: !props.canDragSort,
      data: { pinned: props.note.pinned },
      transition: {
        duration: 340,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
      }
    });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? 'transform 340ms cubic-bezier(0.22, 1, 0.36, 1)'
  };
  const setCombinedNodeRef = (element: HTMLElement | null) => {
    setNodeRef(element);
    props.registerNoteElement?.(props.note.id, element);
  };

  return (
    <NoteCardShell
      {...props}
      isOverlay={false}
      setActivatorNodeRef={setActivatorNodeRef}
      sortableAttributes={attributes}
      sortableListeners={listeners}
      style={style}
      wrapperRef={setCombinedNodeRef}
      isSorting={isDragging}
    />
  );
}

type NoteCardShellProps = NoteCardProps & {
  isSorting?: boolean;
  wrapperRef?: (element: HTMLElement | null) => void;
};

function NoteCardShell({
  canDragSort,
  copyNote,
  deleteNote,
  density,
  isMenuOpen = false,
  isOverlay = false,
  isSorting = false,
  note,
  onMenuToggle,
  openNoteModal,
  patchNote,
  setActivatorNodeRef,
  sortableAttributes,
  sortableListeners,
  style,
  wrapperRef
}: NoteCardShellProps) {
  const hasTitle = Boolean(note.title.trim());
  const title = hasTitle ? note.title : '';

  return (
    <article
      className={`note-card ${density === 'compact' ? 'is-compact' : ''} ${density === 'pinned' ? 'is-sidebar-card' : ''} ${note.pinned ? 'is-pinned' : ''} ${isSorting ? 'is-sorting' : ''} ${isOverlay ? 'is-drag-overlay' : ''} ${isMenuOpen ? 'has-open-menu' : ''}`}
      ref={wrapperRef}
      style={style}
    >
      <div className="note-toolbar">
        <span
          ref={setActivatorNodeRef}
          className="drag-handle"
          title={canDragSort ? 'Drag to reorder' : 'Sorting is disabled in this view'}
          {...(canDragSort ? sortableAttributes : {})}
          {...(canDragSort ? sortableListeners : {})}
        >
          <GripVertical size={16} />
        </span>
        <h3 className={`note-title ${hasTitle ? '' : 'is-untitled'}`}>{title}</h3>
        {copyNote ? (
          <button title="Copy" onClick={() => copyNote(note.content)}>
            <Clipboard size={16} />
          </button>
        ) : null}
        {onMenuToggle ? (
          <div className="note-menu-wrap">
            <button title="Note actions" onClick={onMenuToggle}>
              <MoreVertical size={16} />
            </button>
            {isMenuOpen ? (
              <div className="note-menu" role="menu">
                <button onClick={() => void patchNote?.(note.id, { pinned: !note.pinned })}>
                  <Pin size={15} />
                  <span>{note.pinned ? 'Unpin' : 'Pin'}</span>
                </button>
                <button onClick={() => openNoteModal?.(note)}>
                  <Maximize2 size={15} />
                  <span>Expand</span>
                </button>
                <button onClick={() => void patchNote?.(note.id, { archived: !note.archived })}>
                  {note.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                  <span>{note.archived ? 'Restore' : 'Archive'}</span>
                </button>
                <button className="danger-menu-item" onClick={() => deleteNote?.(note.id)}>
                  <Trash2 size={15} />
                  <span>Delete</span>
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="note-body" onDoubleClick={() => openNoteModal?.(note)}>
        <p className="note-content">{note.content}</p>
      </div>
    </article>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
