# Jandraw

A self-hosted, single-user [Excalidraw](https://excalidraw.com) workspace. Draw on
the web, keep your boards in your own Supabase database, share read-only links, and
— the headline feature — **let Claude edit your boards for you over MCP**.

Built with Next.js (App Router) + TypeScript + Tailwind, backed by Supabase
(Postgres + Storage), deployed on Vercel.

- **Editor** — the full Excalidraw canvas at `/edit/[id]`, with autosave.
- **Boards** — create, rename, search, soft-delete (Trash), import/export `.excalidraw`.
- **History** — automatic snapshots on every save; restore any prior version.
- **Sharing** — flip a board public and share a read-only `/v/[token]` link; rotate the token to revoke.
- **Auth** — a single passphrase (`JANDRAW_EDIT_SECRET`) gates all editing; read-only share links need no login.
- **MCP** — an [MCP](https://modelcontextprotocol.io) server so an AI client can read and surgically edit your boards.

---

## ✨ Editing your boards with Claude (the MCP feature)

Jandraw ships an MCP server (`mcp/server.mjs`) that exposes board-editing tools over
the Jandraw HTTP API. Point any MCP client (Claude Code, Claude Desktop, …) at it and
you can just **ask, in plain language, for changes to your boards** — Claude calls the
tools and the edits land on your live boards.

### How you use it

Once the server is connected (setup below), talk to Claude normally:

- *"List my Jandraw boards."*
- *"On the board `sprint-12`, add three rectangles in a row labeled To&nbsp;Do, Doing, Done, with a title text above them."*
- *"Create a new board called `Architecture` and add a box labeled API Gateway."*
- *"Move the blue rectangle on `roadmap` 200px to the right and make it green."*
- *"That looks wrong — restore the previous snapshot of `roadmap`."*
- *"Make `roadmap` public and give me the share link."* (then open `/v/<token>`)

Claude works in real Excalidraw element JSON. It makes **surgical** edits by default
(add / update / delete individual elements) and only rewrites a whole board when asked.
Every write snapshots the prior state first, so changes are always reversible.

### Tools the server exposes

| Tool | What it does |
|------|--------------|
| `list_boards` | List boards (filter by `q`, or `trash:true`) |
| `get_board` | Fetch one board's full scene (image bytes omitted unless asked) |
| `create_board` | Create a new board |
| `add_elements` | Append new elements (each `id` must be new) |
| `update_elements` | Shallow-merge changes into existing elements by `id` |
| `delete_elements` | Remove elements by `id` (idempotent) |
| `replace_board` | Overwrite the whole scene (big rewrites) |
| `rename_board` / `set_board_public` / `delete_board` | Metadata + lifecycle |
| `list_snapshots` / `restore_snapshot` | History + undo |

Writes accept an optional `expected_scene_version` for optimistic-concurrency (the
server returns `409` if the board changed underneath you).

---

## 🔌 Setting up the MCP in your own environment

### Prerequisites

- **Node.js 18+**
- A **running Jandraw instance** — either your deployed URL (e.g. `https://your-app.vercel.app`) or a local dev server (`http://localhost:3000`).
- Your **edit passphrase** (`JANDRAW_EDIT_SECRET`) — the same one you log in with. It's the bearer token the MCP uses to authenticate.

### The two settings the server needs

| Env var | Meaning |
|---------|---------|
| `JANDRAW_API_URL` | Where your Jandraw runs. Defaults to `http://localhost:3000`. |
| `JANDRAW_EDIT_SECRET` | Your edit passphrase (bearer token). |

The server reads both from the process environment, **falling back to the repo's
`.env.local`**. `.env.local` is gitignored — keep your secret there (or in your MCP
client's secret store), never in a committed file.

### Option A — Claude Code (run from the repo)

This repo already contains a `.mcp.json`. Set the URL to your instance and keep the
secret in `.env.local`:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "jandraw": {
      "command": "node",
      "args": ["mcp/server.mjs"],
      "env": { "JANDRAW_API_URL": "https://your-app.vercel.app" }
    }
  }
}
```

```bash
# .env.local  (gitignored — the secret lives here, not in .mcp.json)
JANDRAW_EDIT_SECRET=your-edit-passphrase
```

Launch Claude Code from the repo root, approve the `jandraw` server when prompted, and
manage it any time with `/mcp`.

### Option B — Claude Desktop / other MCP clients

Use absolute paths. If the client isn't launched next to a `.env.local`, put the secret
directly in the client config (and make sure that config file is private):

```jsonc
{
  "mcpServers": {
    "jandraw": {
      "command": "node",
      "args": ["/absolute/path/to/jandraw/mcp/server.mjs"],
      "env": {
        "JANDRAW_API_URL": "https://your-app.vercel.app",
        "JANDRAW_EDIT_SECRET": "your-edit-passphrase"
      }
    }
  }
}
```

### Verify the connection

A bundled smoke test spawns the server, does the MCP handshake, and calls `list_boards`:

```bash
JANDRAW_API_URL=https://your-app.vercel.app node scripts/mcp-smoke.mjs
# -> OK: list_boards returned N board(s)
```

If you see `401`/auth errors, the secret doesn't match the target instance. If you see a
connection error, check `JANDRAW_API_URL` and that the instance is up.

---

## Running Jandraw yourself

### 1. Supabase

Create a Supabase project, then run the SQL in `db/` (the schema, plus
`db/2026-06-22-atomic-version-check.sql` for the atomic save guard) in the SQL editor,
and create a **private** Storage bucket named `board-images`. The `service_role` role
needs `grant usage, all on schema public` if writes return permission errors.

### 2. Environment

Copy your values into `.env.local` (gitignored):

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key — server-only, never shipped to the browser>
JANDRAW_EDIT_SECRET=<a long, random passphrase>
```

> **Security:** the `service_role` key bypasses row-level security and is used only on
> the server. Pick a strong `JANDRAW_EDIT_SECRET` (30+ random chars) — on a public
> deployment it's the only thing protecting your boards from edits.

### 3. Develop / build

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm start   # production build
```

Run the HTTP regression suite (against local or a deployed URL) with:

```bash
bash scripts/regression.sh
JANDRAW_API_URL=https://your-app.vercel.app JANDRAW_EDIT_SECRET=… bash scripts/regression.sh
```

### 4. Deploy on Vercel

Import the repo in Vercel, add the three env vars above in **Settings → Environment
Variables**, and deploy. Pushes to `master` auto-deploy.
