"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { relativeTime, viewLink } from "../_lib/format";
import { useTheme } from "../_lib/useTheme";

type BoardSummary = {
  id: string;
  name: string;
  is_public: boolean;
  share_token: string;
  is_deleted: boolean;
  scene_version: number;
  created_at: string;
  updated_at: string;
};

export default function Dashboard() {
  const router = useRouter();
  const { theme, toggle, mounted } = useTheme();
  const loadIdRef = useRef(0);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [trash, setTrash] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [createError, setCreateError] = useState(false);

  const load = useCallback(async () => {
    const myId = ++loadIdRef.current; // only the latest load may mutate state
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (trash) params.set("trash", "1");
      const res = await fetch(`/api/boards?${params.toString()}`);
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      if (myId !== loadIdRef.current) return; // a newer load superseded this one
      setBoards(data.boards ?? []);
    } catch {
      if (myId === loadIdRef.current) setError(true);
    } finally {
      if (myId === loadIdRef.current) setLoading(false);
    }
  }, [q, trash]);

  // Debounced reload on search / tab change. Show the skeleton immediately so stale rows
  // aren't rendered under the new header/tab during the debounce+fetch window.
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  async function newBoard() {
    setCreating(true);
    setCreateError(false);
    try {
      const res = await fetch("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled board" }),
      });
      if (!res.ok) throw new Error("create failed");
      const { board } = await res.json();
      router.push(`/edit/${board.id}`);
    } catch {
      setCreating(false);
      setCreateError(true); // inline notice — do NOT wipe the loaded list with the global load error
    }
  }

  async function rename(id: string) {
    const name = draftName.trim();
    setEditingId(null);
    if (!name) return;
    try {
      const res = await fetch(`/api/boards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      setBoards((bs) => bs.map((b) => (b.id === id ? { ...b, name } : b)));
    } catch {
      rowFail(id);
    }
  }

  async function softDelete(id: string) {
    try {
      const res = await fetch(`/api/boards/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setBoards((bs) => bs.filter((b) => b.id !== id));
    } catch {
      rowFail(id);
    }
  }

  async function restore(id: string) {
    try {
      const res = await fetch(`/api/boards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_deleted: false }),
      });
      if (!res.ok) throw new Error();
      setBoards((bs) => bs.filter((b) => b.id !== id));
    } catch {
      rowFail(id);
    }
  }

  async function hardDelete(id: string) {
    if (!window.confirm("Delete this board forever? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/boards/${id}?hard=1`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setBoards((bs) => bs.filter((b) => b.id !== id));
    } catch {
      rowFail(id);
    }
  }

  function rowFail(id: string) {
    setRowError((e) => ({ ...e, [id]: "Action failed, try again." }));
  }

  async function copyLink(b: BoardSummary) {
    try {
      await navigator.clipboard.writeText(viewLink(b.share_token));
      setCopiedId(b.id);
      setTimeout(() => setCopiedId((c) => (c === b.id ? null : c)), 1500);
    } catch {
      rowFail(b.id);
    }
  }

  const btn =
    "rounded-md px-2.5 py-1 text-sm transition border border-black/10 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      {/* Header */}
      <header className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Jandraw</h1>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search boards…"
          className="ml-auto w-56 rounded-lg border border-black/15 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-white/20"
        />
        <button
          onClick={toggle}
          aria-label="Toggle dark mode"
          title="Toggle dark mode"
          className="rounded-lg border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          {!mounted ? "Theme" : theme === "dark" ? "☀ Light" : "🌙 Dark"}
        </button>
        <button
          onClick={newBoard}
          disabled={creating}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {creating ? "Creating…" : "New board"}
        </button>
      </header>
      {createError && (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">
          Could not create a board. Please try again.
        </p>
      )}

      {/* View switch */}
      <div className="mb-3 flex items-center justify-between border-b border-black/10 pb-2 dark:border-white/10">
        <span className="text-sm font-medium">{trash ? "Trash" : "Boards"}</span>
        <button onClick={() => setTrash((t) => !t)} className={btn}>
          {trash ? "Boards" : "Trash"}
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <ul className="space-y-2">
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="h-16 animate-pulse rounded-xl border border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/5"
            />
          ))}
        </ul>
      ) : error ? (
        <div className="rounded-xl border border-black/10 p-6 text-center dark:border-white/10">
          <p className="mb-3 opacity-80">Could not load boards.</p>
          <button onClick={load} className={btn}>
            Retry
          </button>
        </div>
      ) : boards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/15 p-10 text-center dark:border-white/15">
          {trash ? (
            <p className="opacity-70">Trash is empty.</p>
          ) : (
            <>
              <p className="mb-4 opacity-70">No boards yet. Create one to start.</p>
              <button
                onClick={newBoard}
                disabled={creating}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                New board
              </button>
            </>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {boards.map((b) => (
            <li
              key={b.id}
              className="rounded-xl border border-black/10 p-3 dark:border-white/10"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {editingId === b.id ? (
                  <input
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => rename(b.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") rename(b.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="rounded-md border border-black/15 bg-transparent px-2 py-0.5 text-sm dark:border-white/20"
                  />
                ) : (
                  <span className="font-medium">{b.name}</span>
                )}

                {!trash && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      b.is_public
                        ? "bg-green-500/15 text-green-700 dark:text-green-400"
                        : "bg-black/10 opacity-70 dark:bg-white/10"
                    }`}
                  >
                    {b.is_public ? "public" : "private"}
                  </span>
                )}

                <span className="text-xs opacity-60">
                  {trash ? "deleted " : "edited "}
                  {relativeTime(b.updated_at)}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {trash ? (
                  <>
                    <button onClick={() => restore(b.id)} className={btn}>
                      Restore
                    </button>
                    <button
                      onClick={() => hardDelete(b.id)}
                      className="rounded-md border border-red-500/30 px-2.5 py-1 text-sm text-red-600 transition hover:bg-red-500/10 dark:text-red-400"
                    >
                      Delete forever
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => copyLink(b)} className={btn}>
                      {copiedId === b.id ? "Copied" : "Copy view link"}
                    </button>
                    <button onClick={() => router.push(`/edit/${b.id}`)} className={btn}>
                      Open
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(b.id);
                        setDraftName(b.name);
                      }}
                      className={btn}
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => softDelete(b.id)}
                      className="rounded-md border border-black/10 px-2.5 py-1 text-sm transition hover:bg-red-500/10 dark:border-white/15"
                    >
                      Delete
                    </button>
                  </>
                )}
                {rowError[b.id] && (
                  <span className="self-center text-xs text-red-600 dark:text-red-400">
                    {rowError[b.id]}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
