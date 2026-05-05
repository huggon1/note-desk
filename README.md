# Note Desk

Note Desk is a small local-first notes workspace for capturing short development notes, commands, links, and follow-up tasks. It uses a single workspace, stores data in SQLite, and keeps the interface focused on fast capture, lightweight review, and smooth card reordering.

## Design Core

- **Capture first**: the page is optimized for quickly entering a thought without navigating away from the board.
- **Lightweight workspace UI**: the interface keeps a quiet, professional surface with compact controls, readable cards, and restrained motion.
- **Local-first persistence**: data stays in a local SQLite database by default, with no external service dependency.

## Features

- Quick note capture with optional titles
- Search across note titles and content
- Full and compact note display modes
- Pin, archive, restore, edit, copy, and delete actions
- Magnetic drag-and-drop ordering within pinned and unpinned groups
- Local SQLite persistence

## Usage

- Add a note from the quick capture form with an optional title and required content.
- Press `Enter` while the page is focused, and not while typing in a control, to open the large capture editor.
- Press `Ctrl + Enter` on Windows/Linux or `Cmd + Enter` on macOS inside a note editor to save and close.
- Double-click a note body, or use the note menu, to open the large editor.
- Drag a note by its grip handle to reorder it. Pinned notes reorder only within pinned notes; unpinned notes reorder only within unpinned notes.
- Use search to filter the current board. Sorting is paused while searching or viewing archived notes.
- Use the density toggle to switch between full cards and compact one-line cards.
- Delete removes a note immediately without a browser confirmation prompt.

## Tech Stack

- React + TypeScript
- Vite
- Express + TypeScript
- SQLite via `better-sqlite3`
- `dnd-kit` for drag interaction
- Lucide React icons

## Getting Started

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

The client runs through Vite and the API runs on `http://127.0.0.1:4000`.

## Production Build

Build the client:

```bash
npm run build
```

Start the Express server:

```bash
npm start
```

When `dist/` exists, the Express server serves the built client and API from the same process.

## Data

Note Desk stores data in `data/dev-notes.sqlite` by default. This directory is ignored by Git. To use a different database path, set `NOTES_DB_PATH`.

## Scripts

- `npm run dev` starts the API and Vite client together.
- `npm run build` builds the frontend.
- `npm run start` starts the Express server.
- `npm run check` runs TypeScript checking and the production build.

## License

No license has been selected yet.
