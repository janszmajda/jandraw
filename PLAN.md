# Jandraw build plan

## What this is
Jandraw is a self-hosted, personal version of Excalidraw that I own and deploy
myself. I can open it on any device, edit my boards, and share read-only links with
friends so they can view my presentations. Claude can edit my boards for me through
a small API.

## Why
Excalidraw+ (the paid cloud) starts charging after the trial, and its API is a
paid-only feature. The Excalidraw editor itself is open source (MIT licensed). I
only use single-user editing plus view-only sharing, never real-time collaboration.
Dropping collaboration removes the hard part, so a small self-hosted version covers
everything I actually use, at close to zero cost.

## Scope
In scope:
- Single-user editing of my own boards.
- View-only share links for friends.
- A read/write API so Claude can edit boards for me.
- Deployed on Vercel, reachable from any device.

Out of scope, on purpose:
- Real-time multi-person editing (no live cursors, no presence server). This is the
  deliberate simplification that makes the whole thing easy.
- User accounts or multi-tenant logins. It is just me, protected by a secret token.
- End-to-end encryption of boards. I want the server to be able to read the board
  JSON so the API can edit it.

## Architecture
- Frontend: a Next.js app that embeds the official `@excalidraw/excalidraw` React
  component. Cleaner than forking the whole Excalidraw monorepo, and less to maintain.
- Storage: a fresh, separate Supabase project, kept fully apart from the Jericho work.
  One table holds boards as JSON.
- API: two endpoints over that table, read and write.
- Hosting: Vercel free tier plus Supabase free tier. Target cost is about $0 for
  personal use.

## Routes
- `/edit/[id]`  the editor. Loads a board, autosaves changes to the API.
- `/view/[id]`  read-only render of a board, for sharing with friends.
- `/api/scene/[id]`
    - GET: return the board JSON (allowed if the board is marked public).
    - PUT: overwrite the board JSON. Requires a secret write token.

## Data model (Supabase table: `scenes`)
- `id`          text, primary key (a slug like "pipeline")
- `name`        text
- `elements`    jsonb  (the Excalidraw elements array)
- `app_state`   jsonb  (background color and similar)
- `files`       jsonb  (embedded images, usually empty)
- `is_public`   boolean (controls whether /view and GET are open)
- `updated_at`  timestamptz

## How Claude edits my boards
A board is just the `.excalidraw` JSON. To edit, Claude either:
- calls `PUT /api/scene/[id]` with the new JSON and the write token, or
- writes straight to the Supabase row.
No encryption is in the way, so this is straightforward.

## Decisions locked
- Name: Jandraw.
- Lives in `C:\Users\jan\Documents\jandraw`.
- Its own git repo, separate from anything Jericho.
- Its own fresh Supabase project, separate from `synth-task-pipeline`.
- No real-time collaboration.

## First content to import
Two existing boards are already backed up at `C:\Users\jan\Documents\excalidraw-backup`:
- `Synth-Data-Pipeline_2026-06-21.excalidraw` (the main one, 327 elements)
- `Synth-Task-Generation_2026-06-21.excalidraw` (19 elements)
These get loaded into the new store once the app is running.

## Build steps
1. Scaffold the Next.js app in this folder (TypeScript, app router).
2. Add `@excalidraw/excalidraw` and render the editor on `/edit/[id]`.
3. Create the fresh Supabase project and the `scenes` table.
4. Wire the GET/PUT API to Supabase, with the write token in an env var.
5. Add autosave on the editor and the read-only `/view/[id]` page.
6. Import the two backed-up boards as the first rows.
7. Deploy to Vercel and set the env vars there.
8. Test: open on phone and laptop, share a view link, have Claude edit a board.

## What I (Jan) need to provide when we build
- Confirm Node.js is installed, or install it.
- Create a fresh Supabase project and hand over its URL and keys, or run the setup
  together.
- A Vercel account to deploy to.
- Pick a write-token secret, or let the build generate one.

## Open questions (answer whenever)
- Name is set: Jandraw.
- Custom domain later, or just the `.vercel.app` URL to start?
- Should view links be public by default, or off until I flip a board to public?
