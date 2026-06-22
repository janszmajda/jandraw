# Jandraw build plan

## 1. What this is
Jandraw is a self-hosted, personal version of Excalidraw that Jan owns and deploys.
He can open it on any device, edit his boards, and share read-only links with friends
so they can view his presentations. Claude can edit boards through a small HTTP API.
It exists so the paid Excalidraw+ subscription can be dropped without losing anything
Jan actually uses.

## 2. Locked decisions (from planning Q&A)
- Edit API: granular element add, update, delete, plus a full-board replace fallback.
- Auth: a single secret passphrase gates editing and all writes. No accounts.
- Sharing: a static read-only view page. Boards are shareable by default (every board
  has a live view link the moment it exists).
- Dashboard: a home page listing boards. No thumbnails.
- Images: stored as real files in Supabase Storage, referenced from the board, not
  inlined into the board row.
- Safety: latest save wins, plus automatic version snapshots so any board can be
  rolled back. This whole project started from fear of losing a board, so the net stays.
- Editor: desktop only. Phone is for viewing and sharing, which the view page covers.
- Built-in AI: none. All AI help comes through Claude hitting the API.
- Import/export: upload and download of `.excalidraw` files. Because Jandraw uses the
  identical format, files round-trip cleanly with real excalidraw.com both ways.
- Hosting: Vercel free tier on a `.vercel.app` URL to start. Supabase free tier.
- Separation: its own git repo and its own fresh Supabase, fully apart from Jericho.
- View links: each board gets a random, unguessable share token (e.g. /v/8f3k2a9), so a
  public board cannot be found by guessing names.
- Dashboard: a flat list sorted by most recently edited, with a search box.
- Session: stay logged in about 30 days before the passphrase is needed again.
- Theme: the editor and view pages follow the device light or dark setting.

## 3. Defaulted decisions (confirm or change)
These were not asked about. Sensible defaults are chosen so the build is unblocked.
Veto any of them.
- Package manager: npm.
- Framework: Next.js (App Router) with TypeScript.
- Styling: Tailwind CSS for the dashboard and app chrome. Excalidraw styles its own canvas.
- Deleting a board: soft delete into a Trash, recoverable, with a separate permanent
  delete. Stays on brand with not losing work.
- Snapshot policy: snapshot the prior state on each meaningful save (debounced). Keep
  every snapshot from the last 30 days plus the most recent 50, prune older ones.
- Autosave: save 1.5 seconds after the last edit, and also on tab blur or close.
- Board id: a short slug generated from the name, editable, must be unique.
- Region: pick the Supabase and Vercel region closest to Jan.

## 4. Architecture overview
- A single Next.js app holds both the frontend and the API route handlers, deployed on
  Vercel.
- Supabase Postgres stores board data and snapshots. Supabase Storage holds image bytes.
- The editor is the official `@excalidraw/excalidraw` React component.
- Supabase is accessed only server-side with the service-role key. The browser never
  sees that key and only ever talks to Jandraw's own API routes.

## 5. Data model (Supabase)

Table `boards`:
- `id` text primary key (the slug, e.g. "pipeline")
- `name` text not null
- `elements` jsonb not null default '[]'      (Excalidraw elements array)
- `app_state` jsonb not null default '{}'      (background color and similar)
- `files` jsonb not null default '{}'          (image references and mime, not bytes)
- `is_public` boolean not null default true    (shareable by default)
- `share_token` text not null unique            (random token used in the /v view link)
- `is_deleted` boolean not null default false  (soft delete / Trash)
- `scene_version` bigint not null default 0    (bumped on each save)
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()

Table `board_snapshots`:
- `id` uuid primary key default gen_random_uuid()
- `board_id` text not null references boards(id) on delete cascade
- `elements` jsonb not null
- `app_state` jsonb not null
- `files` jsonb not null
- `scene_version` bigint not null
- `created_at` timestamptz not null default now()
- index on (board_id, created_at desc)

Storage bucket `board-images`:
- object path `{board_id}/{file_id}` where file_id is Excalidraw's own file id
- holds the raw image bytes. Mime type is kept in the board's `files` jsonb entry.

RLS note: all access goes through server routes using the service role, so the anon
role stays locked down. Public read is enforced in Jandraw's API layer (return a board
to an unauthenticated caller only if `is_public` and not deleted), not via anon RLS.

## 6. Auth model
- One secret, `JANDRAW_EDIT_SECRET`, set as an env var.
- Login: a `/login` page takes the passphrase. The server compares it to the secret and,
  on success, sets a signed, httpOnly, secure session cookie that lasts about 30 days.
  That cookie gates every edit page and every write API.
- API writes accept either the session cookie (browser) or an
  `Authorization: Bearer <secret>` header (for Claude and any scripts).
- Reads: GET of a public board needs no auth. GET of a private board needs the cookie or
  the bearer.

## 7. API (Next.js route handlers under /app/api)
All write endpoints require auth (cookie or bearer). Bodies are JSON unless noted.

Boards:
- `GET    /api/boards`            list boards (auth). id, name, is_public, updated_at, is_deleted.
- `POST   /api/boards`            create a board {name, id?} (auth).
- `GET    /api/boards/[id]`       full board. public allowed if is_public and not deleted.
- `PUT    /api/boards/[id]`       full replace {name?, elements, app_state, files, is_public?}.
                                  Writes a snapshot of the prior state, bumps scene_version. (auth)
- `PATCH  /api/boards/[id]`       metadata only {name?, is_public?, is_deleted?} (auth).
- `DELETE /api/boards/[id]`       soft delete. `?hard=1` permanently deletes (auth).

Sharing:
- `GET  /api/view/[token]`        full board by its share token. Returned only if the board
                                  is public and not deleted. No auth.
- `POST /api/boards/[id]/rotate-token`   issue a fresh share token, killing old links (auth).

Granular element ops (auth), the surgical edit API for Claude:
- `POST   /api/boards/[id]/elements`   add: {elements:[...]} append or insert, fixes z-order index.
- `PATCH  /api/boards/[id]/elements`   update: {updates:[{id, ...partial}]}.
- `DELETE /api/boards/[id]/elements`   delete: {ids:[...]}.
  Each loads the board, applies the change server-side respecting Excalidraw's element
  index ordering and bound elements (arrows bound to shapes), snapshots the prior state,
  and bumps scene_version.

History:
- `GET  /api/boards/[id]/snapshots`           list snapshots (auth).
- `POST /api/boards/[id]/restore/[snapId]`    restore a snapshot. Saves current as a new
                                              snapshot first, so a restore is itself undoable. (auth)

Import and export:
- `POST /api/boards/import`        body is a `.excalidraw` JSON (or multipart upload). Creates a board (auth).
- `GET  /api/boards/[id]/export`   returns the board as a `.excalidraw` download
                                   (Content-Disposition attachment). Public if the board is public.

Images:
- Handled inside PUT and the element ops. When the incoming `files` map carries new binary
  dataURLs, the server decodes them, uploads the bytes to `board-images/{id}/{fileId}`, and
  stores only a reference plus mime in the `files` jsonb. On GET, the server rehydrates each
  referenced image back into a dataURL so the Excalidraw component renders it directly.

## 8. Pages (Next.js App Router)
- `/login`        passphrase form, sets the session cookie.
- `/` dashboard   (auth) a flat list sorted by most recently edited, with a search box. Each
                  row shows name, last updated, a public badge, a copy-view-link button (copies
                  the /v token link), open, rename, and delete. A New board button. A Trash view
                  of deleted boards with restore.
- `/edit/[id]`    (auth) the full Excalidraw editor. Loads the board, autosaves on a debounce.
                  Top bar: editable name, public toggle with copy-view-link, export `.excalidraw`,
                  import to replace, and a history drawer to view and restore snapshots.
- `/v/[token]`    the public view link. Resolves a board by its share token and shows it in
                  read-only view mode if the board is public. No autosave. Clean message if the
                  board is private or missing.

## 9. Excalidraw integration notes
- Render `<Excalidraw>` with `initialData = {elements, appState, files}`. Read changes via
  `onChange` (debounced) and persist them. Use the `excalidrawAPI` ref for imperative calls
  (updateScene, addFiles, getSceneElements, getAppState, getFiles).
- Read-only view uses `viewModeEnabled`.
- Set the Excalidraw `theme` to match the device using the prefers-color-scheme setting.
- File import uses `loadFromBlob` to parse an uploaded `.excalidraw`. File export uses
  `serializeAsJSON` then a download. Same format means real excalidraw.com opens the file and
  vice versa.
- Excalidraw cannot server-render. The editor and view components must be client components
  loaded with `next/dynamic` and `ssr: false`.

## 10. Environment variables
- `NEXT_PUBLIC_SUPABASE_URL`        Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`       server only, secret.
- `JANDRAW_EDIT_SECRET`             the edit passphrase, server only.
- `JANDRAW_COOKIE_SECRET`           signs the session cookie.
- `NEXT_PUBLIC_BASE_URL`            used to build shareable view links.
Set locally in `.env.local` and in Vercel project settings. `.env*` is gitignored.

## 11. How Claude edits boards
- Claude calls the HTTP API directly with the bearer secret: GET to read, the granular
  element endpoints for surgical edits, PUT for big rewrites, export to grab a file.
- This mirrors how Claude uses the Excalidraw+ MCP today, but against Jan's own server with
  no encryption in the way, so editing is straightforward.
- A thin MCP wrapper over these endpoints can be added later if first-class tools are wanted
  instead of raw HTTP. Not required for the build.

## 12. Build order (implementation runbook)
1. Scaffold with create-next-app (TypeScript, App Router, Tailwind). Commit.
2. Add dependencies: `@excalidraw/excalidraw`, `@supabase/supabase-js`, a cookie or JWT lib.
3. Supabase: create the fresh project, run the schema SQL for `boards` and `board_snapshots`,
   create the `board-images` bucket, and collect the URL and service-role key.
4. Server lib: a Supabase server client, plus auth helpers (verify secret, sign and verify the
   cookie, check the bearer).
5. API routes: boards CRUD, element ops, snapshots and restore, import and export, image handling.
6. Pages: login, dashboard, edit (autosave, history, export, import, public toggle), view (read-only).
7. Image pipeline: extract on save, upload to Storage, rehydrate on load.
8. Seed: import the two backed-up `.excalidraw` files as the first boards.
9. Run the acceptance tests locally.
10. Deploy to Vercel, set the env vars, smoke test the live URL.

## 13. Acceptance tests (the build is done when these pass)
- Log in with the passphrase. A wrong passphrase is rejected.
- Create a board, draw on it, reload, the drawing persists.
- Edit the same board on a second device. Latest save wins, and a snapshot of the prior state
  exists and restores correctly.
- Paste an image, reload, the image still renders, and the board row stays small because the
  bytes live in Storage.
- Toggle a board public and open its `/v` token link in a logged-out browser: read-only and
  visible. Turning the board private blocks that link. Rotating the token kills the old link.
- Export a board to `.excalidraw`, open it on excalidraw.com successfully, then import that same
  file back into Jandraw.
- Claude calls the API with the bearer secret: reads a board, adds an element, updates one, and
  deletes one, and the changes appear on reload.

## 14. Out of scope (off on purpose)
- Real-time multiplayer and live cursors.
- Accounts and multiple users.
- End-to-end encryption of board contents.
- Pushing boards back out as live excalidraw.com share links.
- Built-in text-to-diagram AI.
- Mobile-optimized editing.

## 15. First content to import
Two existing boards are backed up at `C:\Users\jan\Documents\excalidraw-backup`:
- `Synth-Data-Pipeline_2026-06-21.excalidraw` (the main one, 327 elements)
- `Synth-Task-Generation_2026-06-21.excalidraw` (19 elements)
These become the first rows once the app runs (build step 8).

## 16. Still open (Jan's call)
- Confirm or change the defaulted decisions in section 3.
- Custom domain timing (can be added anytime later).
- Snapshot retention numbers, if tighter or looser is wanted.
