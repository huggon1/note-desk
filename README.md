# Note Desk

Note Desk is a small local-first notes workspace for capturing short development notes, commands, links, and follow-up tasks. It uses a single workspace, stores data in SQLite, and keeps the interface focused on quick entry and lightweight review.

## Features

- Quick note capture with optional titles
- Search across note titles and content
- Full and compact note display modes
- Pin, archive, restore, edit, copy, and delete actions
- Drag-and-drop note ordering
- Local SQLite persistence

## Tech Stack

- React
- Vite
- Express
- SQLite via `better-sqlite3`
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
- `npm run check` runs the production build.

## License

No license has been selected yet.
