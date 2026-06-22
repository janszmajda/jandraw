# Jandraw MCP server

A small [MCP](https://modelcontextprotocol.io) server that exposes Jandraw board
tools so an MCP client (e.g. Claude) can read and edit your boards directly via
tool calls — the same way the Excalidraw+ MCP works, but against your own Jandraw.

It's a thin wrapper over the Jandraw HTTP API: it holds no data itself, just
forwards tool calls to the API using your edit secret as a Bearer token.

## Tools

`list_boards`, `get_board`, `create_board`, `add_elements`, `update_elements`,
`delete_elements`, `replace_board`, `rename_board`, `set_board_public`,
`delete_board`, `list_snapshots`, `restore_snapshot`.

The surgical editing tools are `add_elements` / `update_elements` /
`delete_elements`; array order is z-order (appended elements draw on top).

## Configuration

The server needs two values from its environment:

- `JANDRAW_API_URL` — the Jandraw base URL. `http://localhost:3000` for local dev;
  your `https://<project>.vercel.app` URL once deployed.
- `JANDRAW_EDIT_SECRET` — the bearer token (your Jandraw edit passphrase). The
  server auto-loads it from the repo `.env.local` if it isn't already in the
  environment, so you don't have to put the secret in any MCP config.

Dependencies are installed in this folder: `cd mcp && npm install`.

## Use it from Claude Code

`/.mcp.json` at the repo root already registers this server:

```json
{
  "mcpServers": {
    "jandraw": {
      "command": "node",
      "args": ["mcp/server.mjs"],
      "env": { "JANDRAW_API_URL": "http://localhost:3000" }
    }
  }
}
```

Approve the `jandraw` server when Claude Code prompts (or restart Claude Code), and
the `mcp__jandraw__*` tools become available. Make sure the Jandraw app is running
at `JANDRAW_API_URL` (e.g. `npm run dev`) when you use the tools.

## Use it from another MCP client (Claude Desktop, etc.)

Add an equivalent stdio server entry, pointing `args` at the absolute path of
`server.mjs` and setting the two env vars:

```json
{
  "mcpServers": {
    "jandraw": {
      "command": "node",
      "args": ["C:\\Users\\jan\\Documents\\jandraw\\mcp\\server.mjs"],
      "env": {
        "JANDRAW_API_URL": "https://<your-project>.vercel.app",
        "JANDRAW_EDIT_SECRET": "<your edit secret>"
      }
    }
  }
}
```

## Production

After deploying to Vercel, set `JANDRAW_API_URL` to the live `.vercel.app` URL so
the tools edit your real boards. The same edit secret authenticates both the web
login and the MCP server.
