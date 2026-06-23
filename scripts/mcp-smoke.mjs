#!/usr/bin/env node
// Jandraw MCP smoke test. Spawns mcp/server.mjs, performs the MCP handshake over
// stdio, and calls list_boards through it — proving the server's env loading,
// auth, and API connectivity all work end-to-end.
//
//   node scripts/mcp-smoke.mjs
//   JANDRAW_API_URL=https://jandraw.vercel.app node scripts/mcp-smoke.mjs
//
// The target URL comes from JANDRAW_API_URL (env) and the secret from the
// environment or .env.local — exactly like the real MCP client launch.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, ["mcp/server.mjs"], {
  cwd: root,
  env: process.env, // pass JANDRAW_API_URL / JANDRAW_EDIT_SECRET straight through
  stdio: ["pipe", "pipe", "pipe"],
});

let buf = "";
let phase = 0;
const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
child.stderr.on("data", (d) => process.stderr.write(d)); // server logs to stderr
child.stdout.on("data", (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === 1 && phase === 0) {
      phase = 1;
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_boards", arguments: {} } });
    } else if (msg.id === 2) {
      const isErr = msg.result?.isError;
      const text = msg.result?.content?.[0]?.text ?? "";
      let n = "?";
      try { n = (JSON.parse(text).boards || []).length; } catch {}
      console.log(isErr ? `FAIL: list_boards errored: ${text}` : `OK: list_boards returned ${n} board(s)`);
      child.kill();
      process.exit(isErr ? 1 : 0);
    }
  }
});

send({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1.0" } },
});

setTimeout(() => { console.error("FAIL: timed out waiting for MCP response"); child.kill(); process.exit(1); }, 25000);
