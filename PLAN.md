# Jandraw build plan

---

## Current state (as-built — 2026-06-23)

> This section is the up-to-date snapshot of the **shipped** app. The sections that
> follow it are the original build plan + spec; they remain accurate as reference for
> the schema (A), API (B), and page layouts (C), with the deltas called out below.

**Status: built, hardened, and deployed. Live and in use.**

- **Live URL:** https://jandraw.vercel.app (Vercel, production). Log in with the edit passphrase.
- **Source:** private GitHub repo `janszmajda/jandraw`, default branch `master`. Vercel auto-deploys on every push to `master`.
- **Local dev:** `npm run dev` (or `npm run build && npm start`) at http://localhost:3000.

### Stack (actual versions)
- Next.js 16.2.9 (App Router) + React 19.2.4 + TypeScript + Tailwind v4. Note: Next 16 makes `cookies()`, route `params`, and `headers()` async, and dropped the `eslint` key from `next.config`.
- `@excalidraw/excalidraw` 0.18.1 (loaded via `next/dynamic`, `ssr:false`).
- `@supabase/supabase-js` 2.108.2 (service-role client, server-only).
- `@modelcontextprotocol/sdk` 1.29.0 (MCP server).

### Infrastructure
- **Supabase** project ref `yuohxhfzgiowxwhcdqnk`: schema from section A, private `board-images` bucket. The `service_role` role needed an explicit `grant usage, all on schema public to service_role` (Supabase did not auto-grant).
- **Atomic save guard installed.** `db/2026-06-22-atomic-version-check.sql` adds `save_board_scene_checked` (the `save_board_scene` variant with a `for update` row lock + version check). It was run in Supabase and verified active. `saveScene` uses it when `expected_scene_version` is supplied, and falls back to the plain `save_board_scene` if it is ever absent.

### Secrets (NONE are stored in this repo)
- Three env vars, all server-only: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JANDRAW_EDIT_SECRET`. Set in Vercel (Production) and in local `.env.local` (gitignored; verified never committed, history is pickaxe-clean).
- `JANDRAW_EDIT_SECRET` is a **strong 32-char random value** (kept in Jan's password manager). The same value is used locally and on Vercel, so there is one password everywhere. (The original weak passphrase is retired and intentionally not recorded here.)

### Claude edits boards over MCP (this was the point)
- `mcp/server.mjs` is a built MCP server exposing 12 board tools: `list_boards`, `get_board`, `create_board`, `add_elements`, `update_elements`, `delete_elements`, `replace_board`, `rename_board`, `set_board_public`, `delete_board`, `list_snapshots`, `restore_snapshot`. It is a thin authenticated wrapper over the HTTP API in section B.
- `.mcp.json` registers it and points `JANDRAW_API_URL` at the **live site** (`https://jandraw.vercel.app`); the bearer secret is read from `.env.local`. So Claude can edit the live boards without Jan's laptop running.
- `README.md` documents how to use the feature and set the MCP up in another environment (Claude Code and Claude Desktop).

### Deltas from the original plan
- **Theme (changed):** the plan said "follow the device `prefers-color-scheme`, no toggle." Shipped behavior is **default light, with a dark-mode toggle on the dashboard that applies app-wide** (`app/_lib/useTheme.ts`, class-based `.dark` on `<html>` + `localStorage`; a no-flash inline script in the layout). This overrides the section 2 theme decision, section 9's theme bullet, and the section C intro.
- **MCP (done early):** section 11 called the MCP wrapper optional/"later." It is built and is now the primary way Claude edits boards.
- **Deploy (done):** runbook step 10 is complete; the app is live on Vercel.

### Hardening + testing
- A multi-agent code-review/critic **bug-hunt loop** was run to convergence (confirmed-finding counts 24 → 21 → 16 → 15 → 11 → 7 → 6; final round 0 critical / 0 high).
- `scripts/regression.sh` — a 65-check HTTP regression suite (auth, validation, search escaping, board CRUD, the granular elements API, the version guard, snapshots/restore, export, public view, token rotation, import, trash lifecycle). Reads the secret from the env / `.env.local`. Passes against both local and production. Run with `bash scripts/regression.sh` or `JANDRAW_API_URL=https://jandraw.vercel.app JANDRAW_EDIT_SECRET=… bash scripts/regression.sh`.
- `scripts/mcp-smoke.mjs` — spawns the MCP server, does the protocol handshake, and calls `list_boards` end-to-end.

### Notable bugs found and fixed
- **Save-on-open churn:** opening a board double-saved (Excalidraw's mount `onChange` differs from the stored `app_state`), flooding snapshots. Fixed by adopting the first post-mount `onChange` as the save baseline.
- **Blank-on-exit data loss (critical):** opening a board, editing, then leaving via "‹ Back" could overwrite it with an empty canvas. Root cause: the autosave read the scene from the Excalidraw API, and a debounced save pending when the component unmounted (client-side nav fires no `beforeunload`) ran ~1.5s later against a torn-down Excalidraw, which returns an empty element array — that empty scene was PUT. Fix: saves capture the live scene on every `onChange` into a ref and never read the (possibly dead) API; `doSave` is guarded against running post-unmount; the pending debounce is cleared on unmount; and a final save persists the captured scene via a normal fetch that survives in-app navigation. Verified with a real-browser repro on both local and prod (open → draw → Back immediately → reopen → content + edit survive). The two seeded boards' lost content was recovered from snapshots.

### Open / optional
- Custom domain (still on the free `.vercel.app` URL).
- Snapshot retention numbers (currently 30 days + most recent 50).

---

## 0. Before you start (setup checklist)

> Historical: this checklist was the pre-build setup. It is all done (see "Current state" above). Kept for reference / re-provisioning.

Read this first. It lists what is already in place and what you must set up before the build can run end to end.

Already installed on this machine (verified):
- Node.js v24 and npm 11.
- git 2.53.
- This repo, at `C:\Users\jan\Documents\jandraw`, with this plan committed.
- The two boards to import, backed up at `C:\Users\jan\Documents\excalidraw-backup`.

You still need to set up:

1. A Supabase project, fresh and separate from any Jericho work.
   - Create a new project at supabase.com.
   - In Project Settings, API, copy two values: the Project URL and the service_role key.
   - Run the SQL in section A (A.1 through A.10) in the Supabase SQL editor.
   - Create the private Storage bucket named `board-images` (A.5 has the SQL, or make it in the dashboard with Public off).

2. A Vercel account. Only needed to deploy, local dev runs without it.
   - Sign up at vercel.com.
   - At deploy time, either connect a GitHub repo or run the `vercel` CLI from this folder.
   - Set the environment variables (below) in the Vercel project settings.

3. Pick a passphrase. This one secret is how you log in to edit, it also signs the session cookie, and it is the value the Authorization Bearer API check compares against. Choose something long and random.

Environment variables (put them in `.env.local` for local dev, and in Vercel for the deploy):
- `SUPABASE_URL`: the Supabase Project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: the Supabase service_role key. Server side only, never shipped to the browser.
- `JANDRAW_EDIT_SECRET`: your chosen passphrase.

That is the whole list. There is no separate cookie secret (the cookie is signed with `JANDRAW_EDIT_SECRET`, see section B), and no base URL variable (share links are built from the browser origin at click time, see section C). Supabase is only ever called from the server with the service role, so there is no public Supabase key and no `NEXT_PUBLIC_` Supabase variable.

Optional, can come later:
- A GitHub repo, if you want Vercel to deploy on push instead of using the `vercel` CLI.
- A custom domain. The plan starts on the free `.vercel.app` URL.
- The Supabase CLI, if you prefer running the schema from the command line instead of the SQL editor.

Order of operations for the one-shot build:
1. Scaffold the Next.js app in this folder.
2. Create the Supabase project, run section A SQL, create the bucket.
3. Put the three env vars in `.env.local`.
4. Build the route handlers and pages from sections B and C.
5. Import the two backup boards (build step 8 in section 12).
6. Test locally against the acceptance tests (section 13).
7. Deploy to Vercel and set the same three env vars there.

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
- Theme: ~~the editor and view pages follow the device light or dark setting.~~ **Superseded (see "Current state"): default light, with a dark-mode toggle on the dashboard that applies app-wide.**

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
- Region: pick the Supabase and Vercel region nearest you. It does not affect the build or how the app works.

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
- Set the Excalidraw `theme` from the app theme. As-built this is default-light with a dashboard dark toggle applied app-wide (`useTheme.ts`), not the device `prefers-color-scheme`.
- File import uses `loadFromBlob` to parse an uploaded `.excalidraw`. File export uses
  `serializeAsJSON` then a download. Same format means real excalidraw.com opens the file and
  vice versa.
- Excalidraw cannot server-render. The editor and view components must be client components
  loaded with `next/dynamic` and `ssr: false`.

## 10. Environment variables
Three variables, all server side. See section 0 for where to get each.
- `SUPABASE_URL`                the Supabase project URL. Access is service-role only, so there is no NEXT_PUBLIC Supabase variable.
- `SUPABASE_SERVICE_ROLE_KEY`   the Supabase service_role key. Server only, secret.
- `JANDRAW_EDIT_SECRET`         the edit passphrase. Also the HMAC key that signs the session cookie (section B), and the value the Authorization Bearer check compares against. No separate cookie secret is needed.
Share links are built from the browser origin at click time (section C), so there is no base URL variable. Set the three locally in `.env.local` and in Vercel project settings. `.env*` is gitignored.

## 11. How Claude edits boards
- Claude calls the HTTP API directly with the bearer secret: GET to read, the granular
  element endpoints for surgical edits, PUT for big rewrites, export to grab a file.
- This mirrors how Claude uses the Excalidraw+ MCP today, but against Jan's own server with
  no encryption in the way, so editing is straightforward.
- A thin MCP wrapper over these endpoints ~~can be added later~~ **is built** (`mcp/server.mjs`, 12 tools; `.mcp.json` points it at the live site). This is now the primary way Claude edits boards — see "Current state" and `README.md`.

## 12. Build order (implementation runbook)

> All 10 steps are complete and the app is live (see "Current state"). Kept as the historical build order.

1. Scaffold the Next.js app. This folder is not empty (it already has `PLAN.md`, `.git`, and `.gitignore`), and create-next-app refuses a non-empty directory, so scaffold into a temp folder and move the files in. From `C:\Users\jan\Documents\jandraw`:
   - Run: `npx create-next-app@latest jandraw-tmp --ts --app --tailwind --eslint --no-src-dir --import-alias "@/*" --use-npm --yes`
   - Move the generated contents up into this folder, keeping the existing `PLAN.md`, `.git`, and the committed `.gitignore` (it already covers `.next`, `.env*`, and `.vercel`). Do not overwrite our files. Then delete `jandraw-tmp`.
   - Commit the scaffold.
2. Add dependencies: `@excalidraw/excalidraw` and `@supabase/supabase-js`. No auth library is needed: the session cookie is a hand-built HMAC using Node's built-in `crypto` (`createHmac`, `timingSafeEqual`) plus Next's `cookies()` helper (see section B). If `npm install @excalidraw/excalidraw` reports a peer-dependency error against the React or Next major that create-next-app pulled, retry with `--legacy-peer-deps`, or pin Excalidraw to its current stable release and the React major it expects.
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
These were imported as the first boards (build step 8) and are live as `synth-data-pipeline` and `synth-task-generation`.

## 16. Still open (Jan's call)
- Confirm or change the defaulted decisions in section 3.
- Custom domain timing (can be added anytime later).
- Snapshot retention numbers, if tighter or looser is wanted.

---

# Detailed specification

The sections below expand sections 5, 7, and 8 into a build-ready spec: the exact Supabase schema with the image and snapshot logic (A), the full API reference with request and response shapes (B), and text wireframes for every page (C). They were drafted, cross-checked for consistency and completeness, and reconciled before being added here.

## A. Supabase schema and storage

This section is run once against the Supabase Postgres database (SQL editor or a migration) plus a few Storage setup steps. After it, the tables, indexes, trigger, bucket, and RLS policies all exist, and the image pipeline contract is fixed. All SQL below is runnable as written on Supabase Postgres.

### A.1 Extensions

Enable the two extensions the schema needs. `pgcrypto` gives `gen_random_uuid()` for snapshot ids. `pg_trgm` powers the dashboard name search GIN index. Run this first.

```sql
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
```

(On Supabase these install into the `extensions` schema, which is already on the default `search_path`, so the function names below resolve without qualification.)

### A.2 Tables

`boards` is the live state of every board. `id` is the slug and the primary key. `share_token` is the per-board random token for read-only sharing and is unique. `scene_version` is a monotonic counter bumped on each write so the client can detect staleness.

```sql
create table boards (
  id            text         primary key,
  name          text         not null,
  elements      jsonb        not null default '[]'::jsonb,
  app_state     jsonb        not null default '{}'::jsonb,
  files         jsonb        not null default '{}'::jsonb,
  is_public     boolean      not null default true,
  share_token   text         not null unique,
  is_deleted    boolean      not null default false,
  scene_version bigint       not null default 0,
  created_at    timestamptz  not null default now(),
  updated_at    timestamptz  not null default now()
);
```

`board_snapshots` holds the prior state captured before each write, for the history drawer and restore. `id` is a uuid default. `board_id` is a foreign key to `boards.id` with `on delete cascade`, so deleting a board (hard delete) drops its snapshots too.

```sql
create table board_snapshots (
  id            uuid         primary key default gen_random_uuid(),
  board_id      text         not null references boards(id) on delete cascade,
  elements      jsonb        not null,
  app_state     jsonb        not null,
  files         jsonb        not null,
  scene_version bigint       not null,
  created_at    timestamptz  not null default now()
);
```

Notes on column choices:
- `elements` is stored as a JSON array, `app_state` and `files` as JSON objects. Defaults match an empty Excalidraw scene so a freshly created board is valid without a first save.
- `files` on `boards` holds only references (see A.7), never image bytes.
- The `unique` on `share_token` is declared inline; A.3 also adds a plain lookup index for the `/v/[token]` read path.
- There is no `deleted_at` column. Soft delete sets `is_deleted = true` and stamps `updated_at = now()`, so `updated_at` doubles as the soft-delete time and the Trash list orders by it (see B `GET /api/boards` and C Trash view).

### A.3 Indexes

```sql
-- history drawer / restore: newest snapshots per board first
create index board_snapshots_board_created_idx
  on board_snapshots (board_id, created_at desc);

-- dashboard recent-first list
create index boards_updated_at_idx
  on boards (updated_at desc);

-- /v/[token] read-only view lookup by share_token
create index boards_share_token_idx
  on boards (share_token);

-- dashboard search box: ILIKE '%term%' on name
create index boards_name_trgm_idx
  on boards using gin (name gin_trgm_ops);
```

The dashboard search query that uses the trigram index:

```sql
select id, name, is_public, is_deleted, updated_at
from boards
where is_deleted = false
  and name ilike '%' || $1 || '%'
order by updated_at desc;
```

A trigram GIN index serves a leading-wildcard `ILIKE '%term%'`, which a plain B-tree index cannot. The unique constraint on `share_token` already creates a B-tree index, so `boards_share_token_idx` is technically redundant with it; keep the explicit one only if you later drop the unique constraint, otherwise it can be omitted. (Leaving it in is harmless.)

### A.4 updated_at trigger

Keep `updated_at` current on every `UPDATE` without trusting the caller to set it. The function sets `new.updated_at` to `now()`; the trigger fires before each row update.

```sql
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger boards_set_updated_at
  before update on boards
  for each row
  execute function set_updated_at();
```

`scene_version` is not bumped here. It is set explicitly by the write code (A.8) so the value is predictable and returned to the client in the same response.

### A.5 Storage bucket

Create one private bucket named `board-images`. Objects live at the path `{board_id}/{file_id}`, where `board_id` is the board slug and `file_id` is the Excalidraw file id (the key in the files map). One folder per board, one object per image.

Create the bucket either in the dashboard (Storage, New bucket, name `board-images`, Public off) or via SQL:

```sql
insert into storage.buckets (id, name, public)
values ('board-images', 'board-images', false)
on conflict (id) do nothing;
```

Rules:
- The bucket is private. There are no Storage RLS policies for anon or authenticated, so no client can read or write objects directly.
- All uploads and downloads go through the service role from server route handlers only. The service-role client bypasses Storage RLS, which is why no bucket policies are needed.
- Server routes build the path as `${boardId}/${fileId}`. Never put the raw image bytes in `boards.files`; that column holds references only.

The server Supabase client is created with the service-role key (server-side env only, never shipped to the browser):

```ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)
```

### A.6 Row Level Security

Enable RLS on both tables and add no policies. With RLS on and zero policies, the anon and authenticated roles are denied all access. Only the service role (used by server routes) bypasses RLS, which is exactly the single-user, server-mediated access model here.

```sql
alter table boards          enable row level security;
alter table board_snapshots enable row level security;

-- No policies are created on purpose. anon and authenticated get nothing.
-- All reads and writes go through the service role from server routes.
```

If you want the denial to be explicit and self-documenting rather than implicit, you can add policies that match nothing, but they are not required and the lines above are sufficient:

```sql
-- optional, documents intent; behavior is identical to having no policies
create policy boards_no_anon
  on boards for all to anon, authenticated
  using (false) with check (false);

create policy snapshots_no_anon
  on board_snapshots for all to anon, authenticated
  using (false) with check (false);
```

### A.7 Image pipeline

Excalidraw carries images in a files map. Each full entry is keyed by `fileId` and shaped:

```
{ [fileId]: { id, dataURL, mimeType, created, lastRetrieved } }
```

`dataURL` is an inline `data:<mime>;base64,<...>` string. Elements of type `image` reference an image by its `fileId`. So the file id is load-bearing: it must be preserved end to end, or the element loses its picture. We strip the bytes out of `dataURL` before storing the board, keep only a reference in `boards.files`, and put the bytes back when reading for the editor, the view page, and export.

**Persisted reference shape (the only shape ever written into `boards.files`):**

```
{ [fileId]: { id, mimeType, created, stored: true } }   // never any dataURL
```

This exact shape is what B documents for the `files` map on `boards` (see B `POST /api/boards`, `PUT /api/boards/[id]`). `created` is carried through so it survives a round trip; `id` is the join key to the image element and the Storage object name.

Two functions own this. Both use the service-role client from A.5.

**extractAndStoreImages** runs on the write side, before any board write that carries a `files` map (PUT, element ops, import). It uploads new inline images to Storage and returns a reference-only files map to persist in `boards.files`. It enforces the invariant that `boards.files` never contains a `dataURL`, including in the pass-through branch.

```ts
// shape persisted in boards.files for each image
// { id: fileId, mimeType: string, created: number, stored: true }   // note: no dataURL

async function extractAndStoreImages(
  boardId: string,
  files: Record<string, any>
): Promise<Record<string, any>> {
  const out: Record<string, any> = {}

  for (const [fileId, entry] of Object.entries(files ?? {})) {
    // already a stored reference from a prior write: keep as-is, do not re-upload
    if (entry?.stored === true) {
      out[fileId] = {
        id: entry.id ?? fileId,
        mimeType: entry.mimeType,
        created: entry.created ?? Date.now(),
        stored: true,
      }
      continue
    }

    const dataURL: string | undefined = entry?.dataURL
    if (typeof dataURL === 'string' && dataURL.startsWith('data:')) {
      // Excalidraw image data URLs are always base64-encoded. Guard on that so we
      // never decode a non-base64 payload (e.g. data:image/svg+xml,<raw>) as base64
      // and store corrupt bytes.
      const comma = dataURL.indexOf(',')
      const header = dataURL.slice(5, comma)            // e.g. "image/png;base64"
      if (!header.includes(';base64')) {
        throw new Error(`Unsupported data URL for file ${fileId}: expected base64 encoding`)
      }
      const mimeType = entry.mimeType ?? header.split(';')[0]
      const base64 = dataURL.slice(comma + 1)
      const bytes = Buffer.from(base64, 'base64')        // Node Buffer is fine server-side

      const { error } = await supabase
        .storage
        .from('board-images')
        .upload(`${boardId}/${fileId}`, bytes, {
          contentType: mimeType,
          upsert: true,                                  // overwrite if the object exists
        })
      if (error) throw error

      // replace the heavy entry with a lightweight reference (no dataURL)
      out[fileId] = { id: fileId, mimeType, created: entry.created ?? Date.now(), stored: true }
    } else {
      // no inline data and not marked stored: strip any stray dataURL and persist a
      // reference only, so the 'boards.files never contains dataURL' invariant holds
      // in code, not just prose.
      const { dataURL: _drop, ...rest } = entry ?? {}
      out[fileId] = { ...rest, id: rest.id ?? fileId, stored: true }
    }
  }

  return out   // store this in boards.files
}
```

**rehydrateImages** runs on the read side, after loading the board, before handing `files` to the editor, the view page, or the export file. It downloads each stored object, base64-encodes it, and rebuilds a full Excalidraw files entry with a `data:` URL.

```ts
async function rehydrateImages(
  boardId: string,
  files: Record<string, any>
): Promise<Record<string, any>> {
  const out: Record<string, any> = {}

  for (const [fileId, entry] of Object.entries(files ?? {})) {
    if (entry?.stored === true) {
      const { data, error } = await supabase
        .storage
        .from('board-images')
        .download(`${boardId}/${fileId}`)         // returns a Blob
      if (error) throw error

      const bytes = Buffer.from(await data.arrayBuffer())
      const base64 = bytes.toString('base64')
      const mimeType = entry.mimeType
      const dataURL = `data:${mimeType};base64,${base64}`

      out[fileId] = {
        id: fileId,                                // preserve id so image elements still resolve
        dataURL,
        mimeType,
        created: entry.created ?? Date.now(),      // round-tripped from the stored reference
        lastRetrieved: Date.now(),
      }
    } else {
      out[fileId] = entry                          // already full / inline: pass through
    }
  }

  return out   // hand to @excalidraw/excalidraw as initialData.files, or embed in an export file
}
```

Where each runs:
- `PUT /api/boards/[id]` (full replace), the element ops (`POST`, `PATCH`, `DELETE /api/boards/[id]/elements`), and `POST /api/boards/import`: call `extractAndStoreImages(boardId, files)` on the incoming `files` map and write the returned reference-only map into `boards.files`. The request body may contain full `dataURL`s (the editor autosave sends them); the column never does.
- `GET /api/boards/[id]`: call `rehydrateImages(boardId, files)` on the stored map and return the full map for the editor. The read-only `GET /api/view/[token]` does the same so shared views render images. `GET /api/boards/[id]/export` also runs `rehydrateImages` so the downloaded `.excalidraw` file embeds full `dataURL`s and opens correctly in real Excalidraw.
- The file id is the join key between an image element and its bytes, and it is the Storage object name. Preserve it unchanged in both directions.

Orphan policy (stated, not enforced): when an image element is deleted, its `fileId` simply stops appearing in the incoming `files` map, so `extractAndStoreImages` never touches the Storage object and it is left in place. This is intentional. Older snapshots may still reference that image for restore, and the 30-day / 50-snapshot prune does not cascade to Storage. Storage objects are removed only on a hard board delete (A.9), never on per-image removal, so restoring an old snapshot still resolves its images.

### A.8 Snapshot routine

On every write that changes `elements`, `app_state`, or `files`, capture the prior board state into `board_snapshots` before overwriting, then prune. The four scene-changing routes that must wire this in are: `PUT /api/boards/[id]`, the three element ops (`POST` / `PATCH` / `DELETE /api/boards/[id]/elements`), and `POST /api/boards/[id]/restore/[snapId]`. Metadata-only writes do not snapshot: a rename or public toggle (`PATCH /api/boards/[id]`) and `POST /api/boards/[id]/rotate-token` change no scene fields, do not snapshot, and do not bump `scene_version`.

**Atomicity.** Run the three steps inside a single Postgres function so they are one transaction. Plain supabase-js calls go to PostgREST as separate requests and are not atomic, so the "a board never overwrites without first being snapshotted" guarantee only holds if the snapshot-insert and the board-update commit together. Call the function with `supabase.rpc(...)`. The element ops and restore build the new `elements` / `app_state` / `files` in the route, then call the same function to persist.

```sql
-- one transaction: snapshot the current row, then overwrite it, then return the new version.
-- the boards_set_updated_at trigger (A.4) stamps updated_at on the update.
create or replace function save_board_scene(
  p_id        text,
  p_elements  jsonb,
  p_app_state jsonb,
  p_files     jsonb
)
returns bigint
language plpgsql
as $$
declare
  v_new_version bigint;
begin
  -- step 1: snapshot the CURRENT row state before it is overwritten
  insert into board_snapshots (board_id, elements, app_state, files, scene_version)
  select id, elements, app_state, files, scene_version
  from boards
  where id = p_id;

  -- step 2: write the new scene and bump the version
  update boards
  set elements = p_elements,
      app_state = p_app_state,
      files = p_files,
      scene_version = scene_version + 1
  where id = p_id
  returning scene_version into v_new_version;

  -- step 3: prune snapshots for this board (see retention rule below)
  delete from board_snapshots s
  where s.board_id = p_id
    and s.created_at < now() - interval '30 days'
    and s.id not in (
      select id
      from board_snapshots
      where board_id = p_id
      order by created_at desc
      limit 50
    );

  return v_new_version;
end;
$$;
```

Called from a route handler:

```ts
const { data: newVersion, error } = await supabase.rpc('save_board_scene', {
  p_id: boardId,
  p_elements: elements,
  p_app_state: appState,
  p_files: storedFiles,   // already passed through extractAndStoreImages
})
if (error) throw error
// newVersion is the bumped scene_version to return to the client
```

Retention rule (step 3). Keep any snapshot that is within the last 30 days OR among the newest 50 for that board. A snapshot is deleted only when it fails both, that is, it is older than 30 days AND not in the most recent 50. Equivalent keep rule: a row survives if `created_at >= now() - interval '30 days'` OR it is in the newest 50. The `DELETE` above is the exact negation of that keep rule.

Notes:
- Step 1 runs only for the scene-changing routes listed above, where `elements`, `app_state`, or `files` actually change.
- Restore (`POST /api/boards/[id]/restore/[snapId]`) is itself a scene write: the route reads the chosen snapshot row, then calls `save_board_scene` with that snapshot's `elements`, `app_state`, and `files`, so the current state is snapshotted first (step 1) and restoring is itself undoable.
- `scene_version` is bigint in the column. supabase-js returns it as a JS number in JSON; realistic counts stay well under 2^53, so the route coerces with `Number(...)` and returns a plain number. Do not hand-roll BigInt serialization (`JSON.stringify` of a BigInt throws).
- As-built addition: `db/2026-06-22-atomic-version-check.sql` defines `save_board_scene_checked` — the same routine plus a `select ... for update` row lock and a version check that raises `jandraw_version_conflict` (mapped to `409`) when the locked `scene_version` differs from `p_expected_version`. The route calls it when `expected_scene_version` is supplied so the check-and-bump is atomic (closing the read-then-write race a pre-flight check alone leaves open), and falls back to plain `save_board_scene` if it is absent. This migration is installed in the live database.

### A.9 Storage cleanup on hard delete

Hard delete (`DELETE /api/boards/[id]?hard=1`) removes the board row (snapshots cascade via the foreign key) and must also remove the board's Storage objects. supabase-js `.remove(paths)` takes an explicit array of object paths and cannot delete a bare folder/prefix, so the route lists the objects under `{board_id}/` first, then removes them by full path.

```ts
async function deleteBoardImages(boardId: string): Promise<void> {
  // list() pages at 100 by default; loop until a short page comes back
  const limit = 100
  let offset = 0

  for (;;) {
    const { data, error } = await supabase
      .storage
      .from('board-images')
      .list(boardId, { limit, offset })
    if (error) throw error
    if (!data || data.length === 0) break

    const paths = data.map((obj) => `${boardId}/${obj.name}`)
    const { error: rmError } = await supabase
      .storage
      .from('board-images')
      .remove(paths)                 // no-op if paths is empty; never accepts a bare prefix
    if (rmError) throw rmError

    if (data.length < limit) break
    offset += limit
  }
}
```

Notes:
- Call this from `DELETE /api/boards/[id]?hard=1` only. Soft delete (default) leaves Storage untouched.
- `remove()` cannot take a prefix, which is why the list-then-remove loop exists.
- Paging matters only if a single board ever exceeds 100 objects; the loop handles it.

### A.10 Persisted app_state allowlist

Excalidraw's runtime `appState` carries transient and non-serializable fields that must not be persisted: `collaborators` is a `Map` (which `JSON.stringify` drops to `{}` or breaks reconstruction), and keys like `selectedElementIds`, `cursorButton`, `scrollX`, `scrollY`, `zoom`, `width`, and `height` are session or viewport state that would create noisy snapshots and reset other clients. Every writer that stores `app_state` (PUT autosave, import, and the element ops when they touch `app_state`) and every reader/exporter that hands `appState` back must agree on one persisted subset.

Rule: before storing, strip the transient keys and keep only the view-relevant ones. At minimum, drop `collaborators`, `selectedElementIds`, `selectedGroupIds`, `editingElement`, `cursorButton`, `scrollX`, `scrollY`, `zoom`, `width`, `height`, and `offsetTop`/`offsetLeft`. Keep view-relevant keys such as `viewBackgroundColor`, `gridSize`, `theme`, and `currentItem*` style defaults. Apply the same allowlist in `PUT /api/boards/[id]`, `POST /api/boards/import`, the export file build (`GET /api/boards/[id]/export`), and the editor autosave path in C, so all paths store and emit the same clean `app_state`.

Sources:
- [Excalidraw Data Types (BinaryFileData / BinaryFiles)](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/types/data)
- [Supabase JS Storage: upload (ArrayBuffer from base64)](https://supabase.com/docs/reference/javascript/storage-from-upload)
- [Supabase JS Storage: download](https://supabase.com/docs/reference/javascript/storage-from-download)
- [Supabase JS Storage: list](https://supabase.com/docs/reference/javascript/storage-from-list)
- [Supabase JS Storage: remove](https://supabase.com/docs/reference/javascript/storage-from-remove)

## B. API reference

All endpoints live under `/api`. Request and response bodies are JSON unless noted (file upload and file download are the two exceptions, both called out below). All timestamps are ISO 8601 strings. The `id` field on a board is its slug (a text primary key), not a UUID. `scene_version` is a Postgres bigint returned as a plain JS number in JSON (realistic counts stay well under 2^53; the route coerces with `Number(...)`).

### Auth model and cookie mechanics

Two kinds of endpoints exist: writes and private reads (which require auth), and public reads (which do not).

Auth is satisfied by EITHER of these, checked in this order:

1. A signed, httpOnly, secure session cookie set by `POST /api/login`. The browser sends it automatically. Lasts about 30 days.
2. An `Authorization: Bearer <secret>` header whose value equals `JANDRAW_EDIT_SECRET`. Used by Claude and scripts.

If neither is present or valid on an endpoint that requires auth, the response is `401`.

Cookie mechanics (so login, verify, and logout can be built directly):

- Cookie name: `jandraw_session`.
- Value: an HMAC-SHA256 signature over a fixed payload plus an issued-at timestamp, keyed by `JANDRAW_EDIT_SECRET`. Concretely, payload = `jandraw.v1.<issuedAtEpochMs>`, and the cookie value is `<issuedAtEpochMs>.<base64url(HMAC_SHA256(payload, JANDRAW_EDIT_SECRET))>`.
- Attributes: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000` (about 30 days). `SameSite=Lax` is chosen so top-level navigations to `/` and to `/v/[token]` links carry or do not need the cookie correctly; the `/v` route needs no auth anyway.
- Verification: recompute the HMAC over `jandraw.v1.<issuedAtEpochMs>` from the cookie, compare it to the supplied signature with a timing-safe comparison, and reject if the signature does not match or if `issuedAtEpochMs` is older than 30 days.
- Logout: `POST /api/logout` sends the same cookie with `Max-Age=0` (and an empty value) to clear it.

Secret comparison: both the `POST /api/login` passphrase check and the `Authorization: Bearer` check use a timing-safe comparison (for example `crypto.timingSafeEqual` over equal-length buffers, with a length guard before the compare). There is no rate limiting or lockout: on the Vercel free tier none is configured, and the single env passphrase plus timing-safe compare is the entire security boundary. State this assumption explicitly so it is a known limitation, not an oversight.

Auth requirement per endpoint:

- No auth (public reads): `GET /api/view/[token]`, and `GET /api/boards/[id]/export` only when the target board has `is_public = true`. If the board is private, export requires auth.
- Auth required (everything that writes, plus private listing and history): `POST /api/logout`, `GET /api/boards`, `POST /api/boards`, `GET /api/boards/[id]`, `PUT /api/boards/[id]`, `PATCH /api/boards/[id]`, `DELETE /api/boards/[id]`, `POST /api/boards/[id]/elements`, `PATCH /api/boards/[id]/elements`, `DELETE /api/boards/[id]/elements`, `GET /api/boards/[id]/snapshots`, `POST /api/boards/[id]/restore/[snapId]`, `POST /api/boards/import`, `POST /api/boards/[id]/rotate-token`.
- `POST /api/login` is the one auth endpoint that takes no prior auth: it is how you obtain the cookie.

Note on `GET /api/boards/[id]`: this returns the full owner view of a single board and requires auth. Anonymous read access to a board is only available through the share-token route (`GET /api/view/[token]`) or public export.

### Error envelope

Every error response uses one shape:

```json
{ "error": { "code": "string", "message": "string" } }
```

`code` is a short stable string (for example `bad_request`, `unauthenticated`, `forbidden`, `not_found`, `conflict`). `message` is a human-readable description. Status codes used across the API:

- `400 bad_request`: malformed JSON, missing required fields, wrong types, or invalid query params.
- `401 unauthenticated`: auth required but no valid cookie or bearer token was supplied. This includes a private-board export with no auth.
- `403 forbidden`: auth was valid but the action is not allowed. In a single-user model this case does not currently arise; it is reserved.
- `404 not_found`: no board matches the given `id`, no snapshot matches `snapId`, or no board matches the share `token`. Soft-deleted boards return `404` from the normal read and edit routes; the one exception is the trash-restore action (`PATCH /api/boards/[id]` with `is_deleted: false`), which is the single edit route allowed to reach a soft-deleted board (see below). A non-public or rotated/unknown share token also returns `404` from `GET /api/view/[token]` so the response never confirms a token exists.
- `409 conflict`: a slug collision that cannot be auto-resolved, or a `scene_version` mismatch on a write that supplies an expected version.

Concurrency note: the default policy is latest save wins, so writes normally do not require a version. If a request includes an `expected_scene_version` field and it does not match the board's current `scene_version`, the write is rejected with `409`. Every successful scene write bumps `scene_version` by 1 and snapshots the prior state into `board_snapshots` (via `save_board_scene`, A.8).

### The `files` map in request and response bodies

Throughout B, the `files` object behaves as follows, matching A.7:

- On write (`POST /api/boards`, `PUT /api/boards/[id]`, the element ops, `POST /api/boards/import`): the request body may contain the FULL Excalidraw files map, including inline `dataURL`s (the editor autosave sends them). The server runs `extractAndStoreImages` before persisting, so `boards.files` ends up reference-only. The request body is not reference-only; only the stored column is.
- The persisted/stored shape in `boards.files` is exactly `{ [fileId]: { id, mimeType, created, stored: true } }`, never any `dataURL`.
- On read (`GET /api/boards/[id]`, `GET /api/view/[token]`, `GET /api/boards/[id]/export`): the server runs `rehydrateImages`, so the `files` map returned to the client (or embedded in the export file) is the FULL map with `dataURL`s, ready for `@excalidraw/excalidraw`.

`app_state` on write and read is reduced to the persisted allowlist defined in A.10 (transient and non-serializable keys such as `collaborators` are stripped before storing).

---

### POST /api/login

Exchange the passphrase for a session cookie.

- Auth: none (this is how you get auth).
- Request headers: `Content-Type: application/json`.
- Path params: none.
- Query params: none.
- Body:

```json
{ "secret": "string" }
```

- Success: `200`. Sets the `jandraw_session` cookie (signed, httpOnly, secure, SameSite=Lax, about 30 days; see cookie mechanics above). Body:

```json
{ "ok": true }
```

- Errors:
  - `400 bad_request`: `secret` missing or not a string.
  - `401 unauthenticated`: `secret` does not match `JANDRAW_EDIT_SECRET` (compared timing-safe).

---

### POST /api/logout

Clear the session cookie.

- Auth: required.
- Request headers: cookie (browser) or `Authorization: Bearer <secret>`.
- Path params: none.
- Query params: none.
- Body: none.
- Success: `200`. Clears `jandraw_session` by sending it back with `Max-Age=0`. Body:

```json
{ "ok": true }
```

- Errors:
  - `401 unauthenticated`: no valid cookie or bearer token.

---

### GET /api/boards

List boards for the dashboard, sorted by `updated_at` descending (most recently edited first). The Trash variant returns soft-deleted boards in the same `updated_at desc` order, which for trashed boards is effectively most-recently-deleted first (soft delete stamps `updated_at`).

- Auth: required.
- Request headers: cookie or `Authorization: Bearer <secret>`.
- Path params: none.
- Query params:
  - `q` (string, optional): case-insensitive substring (contains) search over `name`, backed by the `pg_trgm` GIN index (`ILIKE '%q%'`, see A.3). Not a prefix or exact match.
  - `trash` (`"1"`, optional): when present, returns only soft-deleted boards (`is_deleted = true`) for the Trash view. When absent, returns only active boards (`is_deleted = false`).
- Body: none.
- Success: `200`. Returns a list of board summaries (the heavy `elements`, `app_state`, and `files` are omitted to keep the list light):

```json
{
  "boards": [
    {
      "id": "string",
      "name": "string",
      "is_public": true,
      "share_token": "string",
      "is_deleted": false,
      "scene_version": 0,
      "created_at": "string",
      "updated_at": "string"
    }
  ]
}
```

- Errors:
  - `400 bad_request`: `trash` present with a value other than `"1"`.
  - `401 unauthenticated`: no valid auth.

---

### POST /api/boards

Create a new board.

- Auth: required.
- Request headers: cookie or `Authorization: Bearer <secret>`; `Content-Type: application/json`.
- Path params: none.
- Query params: none.
- Body (all fields optional except `name`):

```json
{
  "name": "string",
  "elements": [],
  "app_state": {},
  "files": {},
  "is_public": true
}
```

  - `name` (string, required): non-empty after trimming; max length 200 characters.
  - `elements` (array, optional, default `[]`): full Excalidraw element objects.
  - `app_state` (object, optional, default `{}`): reduced to the persisted allowlist (A.10) before storing.
  - `files` (object, optional, default `{}`): the full Excalidraw files map. May contain inline `dataURL`s; the server runs `extractAndStoreImages` so the stored `boards.files` is reference-only, exactly `{ [fileId]: { id, mimeType, created, stored: true } }`.
  - `is_public` (boolean, optional, default `true`).

- Slug generation: `id` is derived from `name` by lowercasing, trimming, and replacing any run of non-alphanumeric characters with a single hyphen (stripping leading and trailing hyphens). An empty result falls back to `board`. The server then tries to insert with that base slug and relies on the DB unique constraint to close the race: on a unique violation (Postgres `23505` on the `boards` primary key), it retries with `-2`, then `-3`, up to 5 attempts; if all collide it appends a 6-character random suffix and tries once more; if that still collides it returns `409`. (Do not pre-check with a SELECT, which has a race between the check and the insert.) The server assigns `share_token` as a random unguessable string and sets `scene_version = 0`.
- Collision behavior: the slug is auto-resolved by suffixing, so normal creation does not `409`. A `409 conflict` is only returned if a unique slug cannot be produced after the bounded attempts above.
- Success: `201`. Returns the full created board (the returned `files` is rehydrated to the full map, consistent with the read contract):

```json
{
  "board": {
    "id": "string",
    "name": "string",
    "elements": [],
    "app_state": {},
    "files": {},
    "is_public": true,
    "share_token": "string",
    "is_deleted": false,
    "scene_version": 0,
    "created_at": "string",
    "updated_at": "string"
  }
}
```

- Errors:
  - `400 bad_request`: `name` missing, not a string, empty/whitespace, or longer than 200 characters; any supplied field has the wrong type.
  - `401 unauthenticated`: no valid auth.
  - `409 conflict`: could not generate a unique slug after the bounded attempts.

---

### GET /api/boards/[id]

Fetch one full board (owner view).

- Auth: required.
- Request headers: cookie or `Authorization: Bearer <secret>`.
- Path params: `id` (string): the board slug.
- Query params: none.
- Body: none.
- Success: `200`. Returns the full board object (same shape as the `board` object in `POST /api/boards`, including `elements`, `app_state`, and `files`). `files` is rehydrated to the full Excalidraw map with `dataURL`s (A.7), so the editor can pass it as `initialData.files`.
- Errors:
  - `401 unauthenticated`: no valid auth.
  - `404 not_found`: no active board with that `id` (soft-deleted boards also return `404` here).

---

### PUT /api/boards/[id]

Full-board replace. This is the editor's debounced autosave AND the import-to-replace target (the editor reads a `.excalidraw` file, maps its `appState` to `app_state`, and PUTs the parsed scene to replace in place). It overwrites the scene wholesale.

- Auth: required.
- Request headers: cookie or `Authorization: Bearer <secret>`; `Content-Type: application/json`.
- Path params: `id` (string): the board slug.
- Query params: none.
- Body (the full board scene; `name` and `is_public` optional, the three scene fields expected on autosave):

```json
{
  "name": "string",
  "elements": [],
  "app_state": {},
  "files": {},
  "is_public": true,
  "expected_scene_version": 0
}
```

  - `elements` (array): replaces `boards.elements` entirely.
  - `app_state` (object): replaces `boards.app_state` entirely, after reduction to the persisted allowlist (A.10).
  - `files` (object): the full Excalidraw files map; may contain inline `dataURL`s. The server runs `extractAndStoreImages` and stores the reference-only map. Replaces `boards.files` entirely.
  - `name` (string, optional): if present, renames the board. Renaming does NOT change the slug `id`.
  - `is_public` (boolean, optional): if present, updates publish state.
  - `expected_scene_version` (number, optional): if present, the write is rejected with `409` unless it equals the current `scene_version`. Omit it to accept the latest-save-wins default.

- Behavior: runs `extractAndStoreImages`, then calls `save_board_scene` (A.8), which snapshots the prior state into `board_snapshots`, writes the new scene, and bumps `scene_version` by 1; the trigger sets `updated_at = now()`. `name`/`is_public`, if supplied, are updated in the same write.
- Success: `200`. Returns the updated board (with rehydrated `files`) and the new version:

```json
{
  "board": { "id": "string", "name": "string", "elements": [], "app_state": {}, "files": {}, "is_public": true, "share_token": "string", "is_deleted": false, "scene_version": 1, "created_at": "string", "updated_at": "string" },
  "scene_version": 1
}
```

- Errors:
  - `400 bad_request`: malformed JSON; `elements` not an array, or `app_state`/`files` not objects, or a supplied optional field has the wrong type.
  - `401 unauthenticated`: no valid auth.
  - `404 not_found`: no active board with that `id`.
  - `409 conflict`: `expected_scene_version` supplied and does not match current `scene_version`.

---

### PATCH /api/boards/[id]

Update board metadata only (no scene replace). Used by the rename and public-toggle controls, and by the trash-restore action.

- Auth: required.
- Request headers: cookie or `Authorization: Bearer <secret>`; `Content-Type: application/json`.
- Path params: `id` (string): the board slug.
- Query params: none.
- Body (any subset of the mutable metadata fields):

```json
{
  "name": "string",
  "is_public": true,
  "is_deleted": false
}
```

  - `name` (string, optional): renames the board. Does NOT change the slug `id`. Max length 200 characters, non-empty after trimming.
  - `is_public` (boolean, optional): toggles publish state.
  - `is_deleted` (boolean, optional): the trash flag. Setting `is_deleted: false` is the trash-restore action (moves a board out of Trash). Setting `is_deleted: true` is equivalent to a soft delete. This is the ONE edit route allowed to target a soft-deleted board, specifically to flip `is_deleted` back to `false`; the board lookup for PATCH does not exclude soft-deleted rows.

- Behavior: a metadata-only update. It sets `updated_at = now()` (via the trigger). It does not touch the scene fields, does not bump `scene_version`, and does not write a snapshot (no scene state changed). At least one mutable field must be present. When `is_deleted: false` is supplied, the route looks up the board including soft-deleted rows so a trashed board can be restored.
- Success: `200`. Returns the updated board (with rehydrated `files`):

```json
{ "board": { "id": "string", "name": "string", "elements": [], "app_state": {}, "files": {}, "is_public": true, "share_token": "string", "is_deleted": false, "scene_version": 0, "created_at": "string", "updated_at": "string" } }
```

- Errors:
  - `400 bad_request`: body empty (no mutable field supplied), or a supplied field has the wrong type, or `name` empty/whitespace or over 200 characters.
  - `401 unauthenticated`: no valid auth.
  - `404 not_found`: no board with that `id`. (For a `name`/`is_public`-only PATCH the lookup excludes soft-deleted rows, so a trashed board returns `404`; for an `is_deleted` change the lookup includes soft-deleted rows so restore works.)

---

### DELETE /api/boards/[id]

Delete a board. Soft delete by default (move to Trash); permanent delete with `?hard=1`.

- Auth: required.
- Request headers: cookie or `Authorization: Bearer <secret>`.
- Path params: `id` (string): the board slug.
- Query params:
  - `hard` (`"1"`, optional): when present, permanently deletes the board row and cascades its snapshots, and the route removes the board's Storage objects under `{board_id}/` via `deleteBoardImages` (A.9). When absent, soft delete only.
- Body: none.
- Behavior:
  - Soft delete (default): sets `is_deleted = true` and `updated_at = now()`. The board moves to Trash and is no longer returned by active reads. Storage is untouched.
  - Hard delete (`?hard=1`): removes the board row; `board_snapshots` cascade via the foreign key; the route also calls `deleteBoardImages(boardId)` to delete the Storage objects at `{board_id}/` (A.9).
- Success: `200`. Body:

```json
{ "ok": true, "id": "string", "hard": false }
```

  (`hard` reflects whether a permanent delete was performed.)

- Errors:
  - `400 bad_request`: `hard` present with a value other than `"1"`.
  - `401 unauthenticated`: no valid auth.
  - `404 not_found`: no board with that `id`. (A soft delete on an already soft-deleted board returns `404`; a hard delete can still target a Trash board, since Trash boards exist in the row.)

---

### POST /api/boards/[id]/elements

Granular add. Appends one or more full Excalidraw element objects to the board.

- Auth: required.
- Request headers: cookie or `Authorization: Bearer <secret>`; `Content-Type: application/json`.
- Path params: `id` (string): the board slug.
- Query params: none.
- Body:

```json
{
  "elements": [],
  "expected_scene_version": 0
}
```

  - `elements` (array, required): full Excalidraw element objects, each with its own `id`, `type`, geometry, and style. These are appended to the existing `boards.elements`.
  - `expected_scene_version` (number, optional): same `409` semantics as on PUT.

- Z-order: array order is z-order in Excalidraw (later elements draw on top). New elements are appended to the end of the existing `elements` array, so they land on top of everything already on the board, in the order given in the request. The server does not reorder them.
- Behavior: reads the current `elements`, appends the new ones, then calls `save_board_scene` (A.8), which snapshots prior state and bumps `scene_version` by 1; `updated_at` is set by the trigger. (If any appended element carries inline image `files`, run `extractAndStoreImages` on the merged `files` map first.)
- Success: `200`. Returns the new version and the updated board (with rehydrated `files`):

```json
{
  "scene_version": 1,
  "board": { "id": "string", "name": "string", "elements": [], "app_state": {}, "files": {}, "is_public": true, "share_token": "string", "is_deleted": false, "scene_version": 1, "created_at": "string", "updated_at": "string" }
}
```

- Errors:
  - `400 bad_request`: `elements` missing, not an array, empty, or an element is missing a required field such as `id`.
  - `401 unauthenticated`: no valid auth.
  - `404 not_found`: no active board with that `id`.
  - `409 conflict`: `expected_scene_version` supplied and does not match.

---

### PATCH /api/boards/[id]/elements

Granular update. Patches existing elements by their `id` with partial fields.

- Auth: required.
- Request headers: cookie or `Authorization: Bearer <secret>`; `Content-Type: application/json`.
- Path params: `id` (string): the board slug.
- Query params: none.
- Body:

```json
{
  "updates": [
    { "id": "string", "...": "partial element fields to merge" }
  ],
  "expected_scene_version": 0
}
```

  - `updates` (array, required): each entry must contain an `id` identifying an existing element, plus any subset of element fields to merge over that element.
  - `expected_scene_version` (number, optional): same `409` semantics as on PUT.

- Merge semantics: the merge is a SHALLOW top-level key overwrite. Supplied keys replace the matching keys on the element; omitted keys are left unchanged. Nested objects and arrays (for example `points`, `boundElements`, `groupIds`) are replaced wholesale, not deep-merged, so a caller changing any of them MUST send the full nested array/object, or the existing one is clobbered. Z-order (array position) is not changed by a patch unless a supplied key moves the element. The server does not bump each element's `version`/`versionNonce`/`updated` reconciliation fields; the caller should include them in the patch if Excalidraw reconciliation order matters.
- Behavior: reads current `elements`, merges each update into the element with the matching `id`, then calls `save_board_scene` (A.8) to snapshot and bump `scene_version` by 1. Any `id` in `updates` that does not match an existing element is rejected with `400` and no write is committed (atomic: all-or-nothing).
- Success: `200`. Returns the new version and the updated board (with rehydrated `files`):

```json
{
  "scene_version": 1,
  "board": { "id": "string", "name": "string", "elements": [], "app_state": {}, "files": {}, "is_public": true, "share_token": "string", "is_deleted": false, "scene_version": 1, "created_at": "string", "updated_at": "string" }
}
```

- Errors:
  - `400 bad_request`: `updates` missing, not an array, empty, or an entry is missing `id`; or an `id` in `updates` matches no element on the board.
  - `401 unauthenticated`: no valid auth.
  - `404 not_found`: no active board with that `id`.
  - `409 conflict`: `expected_scene_version` supplied and does not match.

---

### DELETE /api/boards/[id]/elements

Granular delete. Removes elements by `id`.

- Auth: required.
- Request headers: cookie or `Authorization: Bearer <secret>`; `Content-Type: application/json`.
- Path params: `id` (string): the board slug.
- Query params: none.
- Body:

```json
{
  "ids": ["string"],
  "expected_scene_version": 0
}
```

  - `ids` (array of strings, required): the element ids to remove from `boards.elements`. Ids that are not present on the board are ignored (delete is idempotent), so a request to delete an already-removed id still succeeds.
  - `expected_scene_version` (number, optional): same `409` semantics as on PUT.

- Behavior: reads current `elements`, removes the matching elements (preserving the order of the rest), then calls `save_board_scene` (A.8) to snapshot and bump `scene_version` by 1. Per the orphan policy (A.7), removing an image element here does NOT delete its Storage object.
- Success: `200`. Returns the new version, the updated board (with rehydrated `files`), and how many were actually removed:

```json
{
  "scene_version": 1,
  "removed": 0,
  "board": { "id": "string", "name": "string", "elements": [], "app_state": {}, "files": {}, "is_public": true, "share_token": "string", "is_deleted": false, "scene_version": 1, "created_at": "string", "updated_at": "string" }
}
```

- Errors:
  - `400 bad_request`: `ids` missing, not an array, empty, or contains a non-string.
  - `401 unauthenticated`: no valid auth.
  - `404 not_found`: no active board with that `id`.
  - `409 conflict`: `expected_scene_version` supplied and does not match.

---

### GET /api/boards/[id]/snapshots

List the history snapshots for a board, newest first. Backs the editor's history drawer.

- Auth: required.
- Request headers: cookie or `Authorization: Bearer <secret>`.
- Path params: `id` (string): the board slug.
- Query params:
  - `limit` (number, optional, default 50, max 50): max snapshots to return. Values above 50 are clamped to 50. Retention already bounds the stored set to the last 30 days plus the most recent 50 per board, so a default of 50 returns the full retained set in the common case.
- Body: none.
- Success: `200`. Returns snapshot metadata, ordered by `created_at` descending (matching the `(board_id, created_at desc)` index). The heavy `elements`, `app_state`, and `files` are omitted from the list to keep it light:

```json
{
  "snapshots": [
    {
      "id": "uuid",
      "board_id": "string",
      "scene_version": 0,
      "created_at": "string"
    }
  ]
}
```

  (The current live board state is NOT itself a snapshot row. The history drawer's "now" entry is synthesized client-side from `GET /api/boards/[id]`; see C.)

- Errors:
  - `400 bad_request`: `limit` present and not a positive integer.
  - `401 unauthenticated`: no valid auth.
  - `404 not_found`: no active board with that `id`.

---

### POST /api/boards/[id]/restore/[snapId]

Restore a board to a prior snapshot. The current state is snapshotted first (so a restore is itself undoable), then the snapshot's scene is written over the board.

- Auth: required.
- Request headers: cookie or `Authorization: Bearer <secret>`.
- Path params:
  - `id` (string): the board slug.
  - `snapId` (uuid): the `board_snapshots.id` to restore from. Must belong to this board.
- Query params: none.
- Body: none.
- Behavior: reads the chosen snapshot row, then calls `save_board_scene` (A.8) with that snapshot's `elements`, `app_state`, and `files`, which snapshots the current state into `board_snapshots`, writes the snapshot's scene onto the board, and bumps `scene_version` by 1; the trigger sets `updated_at = now()`.
- Success: `200`. Returns the updated board (with rehydrated `files`) and new version:

```json
{
  "scene_version": 1,
  "board": { "id": "string", "name": "string", "elements": [], "app_state": {}, "files": {}, "is_public": true, "share_token": "string", "is_deleted": false, "scene_version": 1, "created_at": "string", "updated_at": "string" }
}
```

- Errors:
  - `401 unauthenticated`: no valid auth.
  - `404 not_found`: no active board with that `id`, or no snapshot with `snapId`, or the snapshot exists but belongs to a different board.

---

### POST /api/boards/import

Create a NEW board from an uploaded `.excalidraw` file (or equivalent JSON body). Format is identical to real Excalidraw. This always creates a new board; it never overwrites an existing one. (Import-to-replace an existing board is done by the editor reading the file and calling `PUT /api/boards/[id]`.)

- Auth: required.
- Request headers: cookie or `Authorization: Bearer <secret>`. Either `Content-Type: application/json` with the parsed scene in the body, or `multipart/form-data` with the `.excalidraw` file in a `file` field.
- Path params: none.
- Query params: none.
- Multipart handling (App Router route handler): read with `await request.formData()`, get the `File` from the `file` field, then `await file.text()` and `JSON.parse`. Reject files larger than 5 MB with `400` before parsing.
- Body: the Excalidraw file contents. The relevant fields pulled from the file are:

```json
{
  "type": "excalidraw",
  "version": 2,
  "elements": [],
  "appState": {},
  "files": {}
}
```

  Plus an optional `name` (string) for the new board; if omitted, the name falls back to the uploaded filename (without extension) or `Imported board`. The Excalidraw file uses `appState`; the server maps it onto `boards.app_state` and reduces it to the persisted allowlist (A.10), dropping `collaborators` and transient view state. The file's `elements` map directly onto `boards.elements`. The file's `files` map (which contains inline `dataURL`s for any images) is run through `extractAndStoreImages` before insert, so the stored `boards.files` is reference-only.
- Behavior: creates a new board the same way `POST /api/boards` does (slug generation with the bounded retry, unique `share_token`, `scene_version = 0`, `is_public` default `true`), populated from the imported scene.
- Success: `201`. Returns the full created board (same shape as `POST /api/boards`, with rehydrated `files`).
- Errors:
  - `400 bad_request`: body is not valid Excalidraw JSON, `type` is not `"excalidraw"`, `elements` is not an array, the multipart `file` field is missing, or the file exceeds 5 MB.
  - `401 unauthenticated`: no valid auth.
  - `409 conflict`: could not generate a unique slug.

---

### GET /api/boards/[id]/export

Download a board as a `.excalidraw` file, identical format to real Excalidraw.

- Auth: none if the board is public (`is_public = true`); required if the board is private. (A valid cookie or bearer token always grants access.)
- Request headers: cookie or `Authorization: Bearer <secret>` (only needed for a private board).
- Path params: `id` (string): the board slug.
- Query params: none.
- Body: none.
- Behavior: loads the board, runs `rehydrateImages` on `boards.files` so the downloaded file embeds full `dataURL`s and opens correctly in real Excalidraw (without this, an exported board with images would have unresolvable image elements). Maps `boards.app_state` to the file's `appState`.
- Success: `200`. The body is the Excalidraw file JSON:

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "jandraw",
  "elements": [],
  "appState": {},
  "files": {}
}
```

  Response headers:
  - `Content-Type: application/json` (the route may use `application/vnd.excalidraw+json`; plain `application/json` is fine since the file is JSON).
  - `Content-Disposition: attachment; filename="<slug>.excalidraw"`.

  (`elements` come straight from the board; `files` is the rehydrated full map; `appState` is mapped from `boards.app_state`.)

- Errors:
  - `401 unauthenticated`: board is private and no valid auth was supplied.
  - `404 not_found`: no active board with that `id`.

---

### GET /api/view/[token]

Read-only public view of a board by its share token. Backs the `/v/[token]` page.

- Auth: none. Access is granted by knowing the unguessable `share_token`.
- Request headers: none required.
- Path params: `token` (string): the board's `share_token`.
- Query params: none.
- Body: none.
- Behavior: looks up the board by `share_token`. The board must be public (`is_public = true`) and not soft-deleted. Runs `rehydrateImages` so the returned `files` map is the full Excalidraw map with `dataURL`s, ready for the view page to pass as `initialData.files`.
- Success: `200`. Returns the read-only scene (no `share_token` is echoed back, to avoid leaking the owner's other controls):

```json
{
  "board": {
    "id": "string",
    "name": "string",
    "elements": [],
    "app_state": {},
    "files": {},
    "scene_version": 0,
    "updated_at": "string"
  }
}
```

- Errors:
  - `404 not_found`: no board matches the token, OR the matched board is soft-deleted, OR the matched board has `is_public = false` (the owner toggled sharing off or rotated the token). All three return `404` so the response never confirms whether a token exists. There is no `403` branch on this endpoint.

---

### POST /api/boards/[id]/rotate-token

Rotate a board's `share_token`, invalidating the old `/v/[token]` link.

- Auth: required.
- Request headers: cookie or `Authorization: Bearer <secret>`.
- Path params: `id` (string): the board slug.
- Query params: none.
- Body: none.
- Behavior: generates a new random unguessable `share_token`, replaces the old one (the old `/v/[token]` link stops working immediately), sets `updated_at = now()`. Does not touch the scene or bump `scene_version` (no snapshot).
- Success: `200`. Returns the new token:

```json
{ "share_token": "string" }
```

- Errors:
  - `401 unauthenticated`: no valid auth.
  - `404 not_found`: no active board with that `id`.

## C. Page layouts (text wireframes)

Theme (as-built): the app defaults to **light** and has a **dark-mode toggle on the dashboard** that applies app-wide (persisted in `localStorage`, no device-preference follow). The wireframes below show the light-mode chrome; the same layout renders in dark mode with inverted colors. Desktop layout only. (The original plan called for following the device `prefers-color-scheme` with no toggle; that was superseded — see "Current state".)

View links (the `/v/<share_token>` URLs copied by the dashboard and the editor) are always built from `window.location.origin` at click time, so they work on production and on Vercel preview deploys without a hardcoded host or env base URL.

### /login

```
+--------------------------------------------------------------+
|                                                              |
|                                                              |
|                    +----------------------+                  |
|                    |       Jandraw        |                  |
|                    +----------------------+                  |
|                    | Passphrase           |                  |
|                    | [....................] |                |
|                    |                      |                  |
|                    |   [    Sign in    ]  |                  |
|                    |                      |                  |
|                    |  (error line here)   |                  |
|                    +----------------------+                  |
|                                                              |
|                                                              |
+--------------------------------------------------------------+
```

Behavior:
- Single centered card. One password field plus a Sign in button.
- Sign in posts the passphrase to `POST /api/login`. On success the server sets the signed httpOnly secure `jandraw_session` cookie (about 30 days) and the page redirects to `/`.
- Loading: the button shows a disabled "Signing in..." state while the request is in flight.
- Error: a wrong passphrase returns 401. The card shows a one line message ("Wrong passphrase.") under the button and clears the field. Network or 500 errors show "Something went wrong, try again."
- If a valid cookie already exists, hitting `/login` redirects straight to `/`.

### / (dashboard)

```
+--------------------------------------------------------------+
| Jandraw            [ Search boards........ ]   [ New board ] |  <- header
+--------------------------------------------------------------+
| Boards                                          [ Trash ]    |  <- view switch
+--------------------------------------------------------------+
| Q3 roadmap            public    edited 2h ago               |
|                       [Copy view link] [Open] [Rename] [Del] |
+--------------------------------------------------------------+
| Pricing sketch        private   edited yesterday            |
|                       [Copy view link] [Open] [Rename] [Del] |
+--------------------------------------------------------------+
| Onboarding flow       public    edited 3 days ago           |
|                       [Copy view link] [Open] [Rename] [Del] |
+--------------------------------------------------------------+
|  ...                                                         |
+--------------------------------------------------------------+
```

Behavior:
- Header holds the title, a search box, and the New board button. Below it a row switches between the active list and Trash.
- The list loads from `GET /api/boards` (active boards only, not soft deleted), sorted most recently edited first (by `updated_at desc`). Each row shows the board name, a public or private badge, and a relative edited time.
- Search filters by name. Typing passes the text as the `q` query param to `GET /api/boards`, which does a case-insensitive substring (contains) match on name; the list stays recent-first within matches.
- New board calls `POST /api/boards`, which creates a board with a generated slug id and share_token, then routes to `/edit/[id]`.
- Copy view link builds `${window.location.origin}/v/<share_token>` from the board row's `share_token` and copies it to the clipboard. No request is needed; the button flips to "Copied" for a moment. For a private board the link still copies but `GET /api/view/[token]` will 404 for viewers until the board is made public again. (The row's `share_token` can go stale if it was rotated from the editor elsewhere; it refreshes on the next `GET /api/boards`.)
- Open routes to `/edit/[id]`. Rename does an inline edit and saves via `PATCH /api/boards/[id]` (name only). Del is a soft delete via `DELETE /api/boards/[id]` (sets is_deleted true), and the row drops out of the active list.
- Loading: rows show skeleton placeholders while `GET /api/boards` runs.
- Empty: with no boards the list area shows "No boards yet. Create one to start." with the New board button repeated.
- Error: if `GET /api/boards` fails, the list area shows "Could not load boards." and a Retry button that refetches.

### / (dashboard, Trash view)

```
+--------------------------------------------------------------+
| Jandraw            [ Search boards........ ]   [ New board ] |
+--------------------------------------------------------------+
| Trash                                           [ Boards ]   |  <- back to active
+--------------------------------------------------------------+
| Old wireframe v1      deleted 2 days ago                     |
|                       [Restore]   [Delete forever]           |
+--------------------------------------------------------------+
| Scratch              deleted 5 days ago                      |
|                       [Restore]   [Delete forever]           |
+--------------------------------------------------------------+
|  ...                                                         |
+--------------------------------------------------------------+
```

Behavior:
- Trash lists soft deleted boards via `GET /api/boards?trash=1` (returns `is_deleted = true` rows), sorted by most recently deleted, which is `updated_at desc` (soft delete stamps `updated_at`, so it doubles as the delete time; there is no separate `deleted_at` column).
- Restore calls `PATCH /api/boards/[id]` with `{ "is_deleted": false }`. This is the one edit route allowed to reach a trashed board (see B). The row moves back to the active list.
- Delete forever calls `DELETE /api/boards/[id]?hard=1`, which removes the board row, its snapshots (cascade), and its Storage images (via `deleteBoardImages`). A confirm prompt guards it since it cannot be undone.
- Empty: an empty Trash shows "Trash is empty."
- Error: a failed restore or hard delete shows an inline notice on the row ("Action failed, try again.") and leaves the row in place.

### /edit/[id]

```
+--------------------------------------------------------------+
| <Back | [Board name______]  o Public  [Copy link]           |  <- top bar
|        [Import] [Export] [History]                  Saved    |
+--------------------------------------------------------------+
| [tools]                                          +--------+  |
| +----+                                           |History |  |
| | T  |                                           | drawer |  |
| | [] |          (Excalidraw canvas)              |--------|  |
| | O  |                                           |now     |  |
| | /  |                                           |2h ago  |  |
| | A  |                                           |1d ago  |  |
| +----+                                           |[Restore]| |
|                                                   +--------+  |
+--------------------------------------------------------------+
```

Behavior:
- Top bar (left to right): a Back link to `/`, an editable board name field, a Public toggle, a Copy link button, then Import, Export, and History. A save status indicator sits at the right ("Saved", "Saving...", or "Save failed").
- The canvas is the `@excalidraw/excalidraw` component filling the rest of the page. Its own toolbar (text, shapes, draw, arrow, etc.) is on the left, owned by the component.
- The board loads from `GET /api/boards/[id]` (elements, app_state, files). The server has already run `rehydrateImages`, so `files` arrives as the full map with `dataURL`s and is passed to the component as `initialData.files`.
- Autosave: edits are debounced about 1 to 2 seconds after the last Excalidraw `onChange`, then the full scene is written with `PUT /api/boards/[id]`. To avoid flooding `board_snapshots`, a save is skipped when `elements` and `files` are unchanged since the last save (app_state-only churn like cursor, selection, scroll, or zoom does NOT trigger a PUT; only the persisted app_state allowlist from A.10 is considered savable). Saves are serialized: if a new debounced save fires while a PUT is in flight, it is queued and only the latest scene is sent, so an older payload never overwrites a newer one. Latest save wins, and the server snapshots the prior state into board_snapshots before applying. The indicator reads "Saving..." during the call and "Saved" after. As-built, saves read the scene captured from the latest `onChange` (never from the Excalidraw API, which returns an empty scene once unmounted), the pending debounce is cleared on unmount, and leaving the editor (e.g. "‹ Back") flushes a final save of the captured scene — this is the fix for the blank-on-exit data-loss bug (see "Current state").
- Board name: editing the field and blurring (or pressing Enter) saves via `PATCH /api/boards/[id]` (name only).
- Public toggle: flipping it calls `PATCH /api/boards/[id]` with `{ "is_public": ... }`. Copy link builds `${window.location.origin}/v/<share_token>` and copies it. A separate rotate action (in a small menu by Copy link) calls `POST /api/boards/[id]/rotate-token`; the route returns the new `share_token`, which is stored in local state so the next Copy link uses the fresh token, and the old link stops working.
- Export downloads a `.excalidraw` file from `GET /api/boards/[id]/export`, identical to real Excalidraw format (the server rehydrates images so the file embeds full image bytes).
- Import opens a file picker for a `.excalidraw` file, reads and parses it client-side, maps its `appState` to `app_state`, and replaces the current board in place via `PUT /api/boards/[id]` with the parsed `elements`, `app_state`, and `files`. (It does NOT call `POST /api/boards/import`, which only ever creates a new board.) This replace also snapshots the prior state first, since it is a PUT.
- History opens the right side drawer, which loads snapshots from `GET /api/boards/[id]/snapshots` (returns up to the last 30 days plus most recent 50, newest first, capped at the endpoint's default/max limit of 50). The top "now" entry is not a snapshot row; it reflects the currently loaded board state (synthesized from `GET /api/boards/[id]`). Each snapshot entry shows a relative time and a Restore button calling `POST /api/boards/[id]/restore/[snapId]`, which writes the snapshot back as the current scene (itself snapshotting the prior state first). Triggering Restore first cancels any pending debounced autosave (so a queued PUT cannot clobber the just-restored scene), then reloads the canvas from the restore response.
- Granular element edits (used by scripts and Claude, not the UI autosave) go through `POST`, `PATCH`, and `DELETE /api/boards/[id]/elements`.
- Loading: a full page spinner until the board scene arrives.
- Empty: a brand new board opens to a blank canvas with the name focused for editing.
- Error: if `GET /api/boards/[id]` 404s, the page shows "Board not found" with a Back to dashboard link. If a `PUT` autosave fails, the indicator turns to "Save failed" with a Retry, and local edits are kept in the editor so nothing is lost until the retry succeeds.

### /v/[token]

```
+--------------------------------------------------------------+
| Q3 roadmap                                   read only view  |  <- slim header
+--------------------------------------------------------------+
|                                                              |
|                                                              |
|                  (Excalidraw canvas, view only)             |
|                                                              |
|                  zoom and pan allowed, no editing            |
|                                                              |
|                                                              |
+--------------------------------------------------------------+
```

Behavior:
- A slim header shows the board name and a "read only view" label. No tools, no save, no edit affordances.
- The scene loads from `GET /api/view/[token]`, which looks the board up by share_token and runs `rehydrateImages`, so `files` arrives as the full map with `dataURL`s. The Excalidraw component renders with `viewModeEnabled` on (pan and zoom allowed, editing off) and receives the rehydrated `files` as `initialData.files` so images display.
- This page needs no auth. Anyone with the token link can read a public board.
- Loading: a centered spinner until the scene arrives.
- Missing or private board: `GET /api/view/[token]` returns 404 for an unknown token, a soft-deleted board, or a board whose `is_public` is false (including after a token rotation). The page shows "This board is private or the link has changed." for that 404 and exposes no board contents. (B returns a single 404 for all of these cases on purpose, so the response never confirms whether a token exists.)
- Error: a 500 or network failure shows "Could not load this board." with a Retry button.
