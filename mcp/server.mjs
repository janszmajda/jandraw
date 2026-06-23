#!/usr/bin/env node
// Jandraw MCP server — exposes board-editing tools over the Jandraw HTTP API so an
// MCP client (e.g. Claude) can read and surgically edit boards via tool calls.
//
// Config (env): JANDRAW_API_URL (default http://localhost:3000) and the bearer
// JANDRAW_EDIT_SECRET. Both can come from the process env or the repo .env.local
// (auto-loaded below). Run with: node --env-file=.env.local mcp/server.mjs
//
// stdio transport: stdout is the protocol channel — never write to it; logs go to stderr.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---- env loading (fallback to .env.local if not already in the environment) ----
function loadEnvFallback() {
  // Always read .env.local (don't short-circuit on JANDRAW_EDIT_SECRET) so other keys
  // like JANDRAW_API_URL still load when only the secret is set in the real environment.
  // The per-key `=== undefined` guard means real env vars are never overridden.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(process.cwd(), ".env.local"), join(here, "..", ".env.local")];
  for (const file of candidates) {
    let txt;
    try {
      txt = readFileSync(file, "utf8");
    } catch {
      continue; // try next candidate
    }
    for (const line of txt.split(/\r?\n/)) {
      // tolerate an optional `export ` prefix; non-greedy value so trailing space is trimmed
      const m = /^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) {
        const raw = m[2];
        const isWrapped = (s) =>
          s.length >= 2 && (s[0] === '"' || s[0] === "'") && s.at(-1) === s[0] && !s.slice(1, -1).includes(s[0]);
        // Quoted values keep content verbatim (inner '#' preserved). For unquoted values
        // strip an inline " # comment" first, THEN re-check wrapping so `"val" # comment`
        // unquotes correctly. A '#' with no preceding whitespace (e.g. inside a secret) stays.
        let val;
        if (isWrapped(raw)) {
          val = raw.slice(1, -1);
        } else {
          // Match @next/env and `node --env-file`: an unquoted '#' starts a comment even
          // with no preceding whitespace, so cut at the first '#'. (Keeps the MCP's view
          // of the secret/URL identical to the Next server's, avoiding 401/parse drift.)
          const hash = raw.indexOf("#");
          const stripped = (hash === -1 ? raw : raw.slice(0, hash)).trimEnd();
          val = isWrapped(stripped) ? stripped.slice(1, -1) : stripped;
        }
        process.env[m[1]] = val;
      }
    }
    break; // first readable .env.local wins
  }
}
loadEnvFallback();

const API_URL = (process.env.JANDRAW_API_URL || "http://localhost:3000").replace(/\/+$/, "");
const SECRET = process.env.JANDRAW_EDIT_SECRET;
const enc = encodeURIComponent; // path-segment encode for caller-supplied ids
if (!SECRET) {
  console.error(
    "[jandraw-mcp] JANDRAW_EDIT_SECRET is not set. Set it in the environment or repo .env.local.",
  );
}

// ---- HTTP helper ----
async function api(method, path, body) {
  const res = await fetch(API_URL + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(SECRET ? { Authorization: `Bearer ${SECRET}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = data && typeof data === "object" ? data.error : null;
    let detail = "";
    if (err && err.code && err.message) detail = `${err.code}: ${err.message}`;
    else if (typeof data === "string" && data.trim()) detail = data.slice(0, 500);
    else if (data && typeof data === "object") detail = JSON.stringify(data).slice(0, 500);
    throw new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
  }
  return data;
}

// Replace heavy image dataURLs in a board's files map with a short placeholder so
// tool output stays token-light (editing elements never needs the raw bytes).
function lean(board) {
  if (!board || !board.files) return board;
  const files = {};
  for (const [id, entry] of Object.entries(board.files)) {
    const { dataURL, ...rest } = entry ?? {};
    files[id] = dataURL ? { ...rest, dataURL: `[${entry.mimeType || "image"} bytes omitted]` } : entry;
  }
  return { ...board, files };
}

const ok = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });
const fail = (msg) => ({ content: [{ type: "text", text: `Error: ${msg}` }], isError: true });
const run = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
};

const server = new McpServer({ name: "jandraw", version: "0.1.0" });

server.registerTool(
  "list_boards",
  {
    title: "List boards",
    description: "List Jandraw boards (id, name, public, updated_at). Use q to filter by name; trash=true lists soft-deleted boards.",
    inputSchema: {
      q: z.string().optional().describe("case-insensitive substring filter on board name"),
      trash: z.boolean().optional().describe("when true, list soft-deleted (trashed) boards"),
    },
  },
  ({ q, trash }) =>
    run(async () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (trash) params.set("trash", "1");
      const data = await api("GET", `/api/boards?${params.toString()}`);
      return ok(data);
    }),
);

server.registerTool(
  "get_board",
  {
    title: "Get board",
    description: "Fetch one board's full scene: elements (array; order = z-order), app_state, and files. Image bytes are omitted unless include_images is true.",
    inputSchema: {
      id: z.string().describe("the board slug/id"),
      include_images: z.boolean().optional().describe("include raw image dataURLs (large); default false"),
    },
  },
  ({ id, include_images }) =>
    run(async () => {
      const data = await api("GET", `/api/boards/${enc(id)}`);
      return ok(include_images ? data : { board: lean(data.board) });
    }),
);

server.registerTool(
  "create_board",
  {
    title: "Create board",
    description: "Create a new board. Returns the created board (id is a slug derived from the name).",
    inputSchema: {
      name: z.string().describe("board name"),
      elements: z.array(z.record(z.any())).optional().describe("initial Excalidraw elements"),
      app_state: z.record(z.any()).optional().describe("initial appState (transient keys are stripped)"),
      is_public: z.boolean().optional().describe("default true"),
    },
  },
  ({ name, elements, app_state, is_public }) =>
    run(async () => {
      const data = await api("POST", "/api/boards", { name, elements, app_state, is_public });
      return ok({ board: lean(data.board) });
    }),
);

server.registerTool(
  "add_elements",
  {
    title: "Add elements",
    description: "Append NEW Excalidraw element objects to a board (array order is z-order; appended elements draw on top). Each element needs at least an `id` and `type`, and each id must NOT already exist on the board — use update_elements to edit an existing element (re-adding an existing id is rejected with 400).",
    inputSchema: {
      id: z.string().describe("the board slug/id"),
      elements: z.array(z.record(z.any())).describe("full Excalidraw element objects to append"),
      expected_scene_version: z.number().optional().describe("optimistic concurrency: reject (409) if the board's version differs"),
    },
  },
  ({ id, elements, expected_scene_version }) =>
    run(async () => {
      const data = await api("POST", `/api/boards/${enc(id)}/elements`, { elements, expected_scene_version });
      return ok({ scene_version: data.scene_version, board: lean(data.board) });
    }),
);

server.registerTool(
  "update_elements",
  {
    title: "Update elements",
    description: "Shallow-merge partial updates into existing elements by id. Each update must include the target `id` plus the fields to overwrite. Nested arrays/objects (points, boundElements) are replaced wholesale, not deep-merged. Any unknown id rejects the whole call.",
    inputSchema: {
      id: z.string().describe("the board slug/id"),
      updates: z.array(z.record(z.any())).describe("array of { id, ...fields } to merge"),
      expected_scene_version: z.number().optional(),
    },
  },
  ({ id, updates, expected_scene_version }) =>
    run(async () => {
      const data = await api("PATCH", `/api/boards/${enc(id)}/elements`, { updates, expected_scene_version });
      return ok({ scene_version: data.scene_version, board: lean(data.board) });
    }),
);

server.registerTool(
  "delete_elements",
  {
    title: "Delete elements",
    description: "Remove elements from a board by id (idempotent — unknown ids are ignored). Returns how many were removed.",
    inputSchema: {
      id: z.string().describe("the board slug/id"),
      ids: z.array(z.string()).describe("element ids to remove"),
      expected_scene_version: z.number().optional(),
    },
  },
  ({ id, ids, expected_scene_version }) =>
    run(async () => {
      const data = await api("DELETE", `/api/boards/${enc(id)}/elements`, { ids, expected_scene_version });
      return ok({ scene_version: data.scene_version, removed: data.removed, board: lean(data.board) });
    }),
);

server.registerTool(
  "replace_board",
  {
    title: "Replace board scene",
    description: "Full-board replace (overwrites elements, app_state, files wholesale). Snapshots the prior state first. Prefer add/update/delete_elements for surgical edits; use this for big rewrites.",
    inputSchema: {
      id: z.string(),
      elements: z.array(z.record(z.any())).describe("the complete new elements array"),
      app_state: z.record(z.any()).optional(),
      files: z.record(z.any()).optional(),
      name: z.string().optional(),
      is_public: z.boolean().optional(),
      expected_scene_version: z.number().optional(),
    },
  },
  ({ id, elements, app_state, files, name, is_public, expected_scene_version }) =>
    run(async () => {
      const data = await api("PUT", `/api/boards/${enc(id)}`, {
        elements,
        app_state: app_state ?? {},
        files: files ?? {},
        name,
        is_public,
        expected_scene_version,
      });
      return ok({ scene_version: data.scene_version, board: lean(data.board) });
    }),
);

server.registerTool(
  "rename_board",
  {
    title: "Rename board",
    description: "Rename a board (does not change its slug/id).",
    inputSchema: { id: z.string(), name: z.string() },
  },
  ({ id, name }) =>
    run(async () => ok({ board: lean((await api("PATCH", `/api/boards/${enc(id)}`, { name })).board) })),
);

server.registerTool(
  "set_board_public",
  {
    title: "Set board public/private",
    description: "Toggle whether a board is shareable via its /v view link.",
    inputSchema: { id: z.string(), is_public: z.boolean() },
  },
  ({ id, is_public }) =>
    run(async () => ok({ board: lean((await api("PATCH", `/api/boards/${enc(id)}`, { is_public })).board) })),
);

server.registerTool(
  "delete_board",
  {
    title: "Delete board",
    description: "Soft-delete a board (moves to Trash). Set hard=true to permanently delete it and its images.",
    inputSchema: { id: z.string(), hard: z.boolean().optional() },
  },
  ({ id, hard }) =>
    run(async () => ok(await api("DELETE", `/api/boards/${enc(id)}${hard ? "?hard=1" : ""}`))),
);

server.registerTool(
  "list_snapshots",
  {
    title: "List snapshots",
    description: "List a board's history snapshots (newest first) for restore.",
    inputSchema: { id: z.string(), limit: z.number().int().positive().max(50).optional().describe("max 50") },
  },
  ({ id, limit }) =>
    run(async () => {
      const qs = limit ? `?limit=${limit}` : "";
      return ok(await api("GET", `/api/boards/${enc(id)}/snapshots${qs}`));
    }),
);

server.registerTool(
  "restore_snapshot",
  {
    title: "Restore snapshot",
    description: "Restore a board to a prior snapshot (the current state is snapshotted first, so restore is itself undoable).",
    inputSchema: { id: z.string(), snapshot_id: z.string().describe("a snapshot id from list_snapshots") },
  },
  ({ id, snapshot_id }) =>
    run(async () => {
      const data = await api("POST", `/api/boards/${enc(id)}/restore/${enc(snapshot_id)}`);
      return ok({ scene_version: data.scene_version, board: lean(data.board) });
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[jandraw-mcp] connected (API ${API_URL})`);
