# Jandraw

A self-hosted, single-user [Excalidraw](https://excalidraw.com) workspace. Draw on
the web, store boards in Supabase, share read-only links, and edit boards through
an MCP server.

Built with Next.js App Router, TypeScript, Tailwind, Supabase Postgres and
Supabase Storage. The current deployment target is Vercel.

- **Editor:** Excalidraw canvas at `/edit/[id]`, with autosave.
- **Boards:** create, rename, search, soft-delete to Trash, import and export `.excalidraw`.
- **History:** snapshots on save, with restore support.
- **Sharing:** public read-only `/v/[token]` links, with token rotation to revoke access.
- **Auth:** one passphrase, `JANDRAW_EDIT_SECRET`, gates editing. Share links do not require login.
- **MCP:** a local MCP server can read and edit boards through the HTTP API.

## MCP

Jandraw includes an MCP server at `mcp/server.mjs`. It exposes board-editing tools
over the Jandraw HTTP API for MCP clients such as Claude Code or Claude Desktop.

The server works with Excalidraw element JSON. It can add, update, or delete
individual elements, and it can replace a whole board when requested. Every write
creates a snapshot first.

Example requests once the server is connected:

- "List my Jandraw boards."
- "On the board `sprint-12`, add three rectangles in a row labeled To Do, Doing, Done."
- "Create a board called `Architecture` and add a box labeled API Gateway."
- "Move the blue rectangle on `roadmap` 200px to the right and make it green."
- "Restore the previous snapshot of `roadmap`."
- "Make `roadmap` public and give me the share link."

## MCP Tools

| Tool | What it does |
|------|--------------|
| `list_boards` | List boards, optionally filtered by `q` or `trash:true`. |
| `get_board` | Fetch one board's full scene. Image bytes are omitted unless requested. |
| `create_board` | Create a new board. |
| `add_elements` | Append new elements. Each `id` must be new. |
| `update_elements` | Shallow-merge changes into existing elements by `id`. |
| `delete_elements` | Remove elements by `id`. Unknown IDs are ignored. |
| `replace_board` | Overwrite the whole scene. |
| `rename_board` | Rename a board. |
| `set_board_public` | Toggle public read-only access. |
| `delete_board` | Soft-delete or hard-delete a board. |
| `list_snapshots` | List saved snapshots. |
| `restore_snapshot` | Restore a saved snapshot. |

Writes accept an optional `expected_scene_version`. The server returns `409` if the
board changed since that version.

## MCP Setup

### Prerequisites

- Node.js 18+
- A running Jandraw instance, either deployed or local.
- `JANDRAW_EDIT_SECRET`, the same passphrase used for web login.

### Environment

| Env var | Meaning |
|---------|---------|
| `JANDRAW_API_URL` | Jandraw base URL. Defaults to `http://localhost:3000`. |
| `JANDRAW_EDIT_SECRET` | Edit passphrase used as the bearer token. |

The server reads both from the process environment and falls back to `.env.local`.
Keep `.env.local` private.

### Claude Code

The repo includes `.mcp.json`:

```jsonc
{
  "mcpServers": {
    "jandraw": {
      "command": "node",
      "args": ["mcp/server.mjs"],
      "env": { "JANDRAW_API_URL": "https://jandraw.vercel.app" }
    }
  }
}
```

Put the secret in `.env.local`:

```bash
JANDRAW_EDIT_SECRET=your-edit-passphrase
```

Launch Claude Code from the repo root and approve the `jandraw` server when
prompted. Use `/mcp` to inspect or manage the connection.

### Other MCP Clients

Use absolute paths if the client is not launched from this repo:

```jsonc
{
  "mcpServers": {
    "jandraw": {
      "command": "node",
      "args": ["/absolute/path/to/jandraw/mcp/server.mjs"],
      "env": {
        "JANDRAW_API_URL": "https://jandraw.vercel.app",
        "JANDRAW_EDIT_SECRET": "your-edit-passphrase"
      }
    }
  }
}
```

### Verify

```bash
JANDRAW_API_URL=https://jandraw.vercel.app node scripts/mcp-smoke.mjs
```

Expected output:

```text
OK: list_boards returned N board(s)
```

If the command returns `401`, check the secret. If it cannot connect, check
`JANDRAW_API_URL` and the app deployment.

## Run Jandraw

### 1. Supabase

Create a Supabase project, run the SQL in `db/`, and create a private Storage
bucket named `board-images`. If writes fail with permission errors, grant the
`service_role` role usage on the public schema.

### 2. Environment

Create `.env.local`:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
JANDRAW_EDIT_SECRET=<long random passphrase>
```

`SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security and must stay server-side.
On a public deployment, `JANDRAW_EDIT_SECRET` is the edit boundary for the app.

### 3. Develop and Build

```bash
npm install
npm run dev
npm run build
npm start
```

Local dev runs at `http://localhost:3000`.

Run the HTTP regression suite:

```bash
bash scripts/regression.sh
JANDRAW_API_URL=https://jandraw.vercel.app JANDRAW_EDIT_SECRET=<secret> bash scripts/regression.sh
```

### 4. Deploy on Vercel

Import the repo in Vercel, add the three env vars above under Environment
Variables, and deploy. Pushes to `master` auto-deploy.
