"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { relativeTime, viewLink } from "../_lib/format";
import { useTheme } from "../_lib/useTheme";
import Logo from "./Logo";

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

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
      setCreateError(true); // inline notice - do NOT wipe the loaded list with the global load error
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
    const url = viewLink(b.share_token);
    try {
      // navigator.clipboard is undefined in non-secure contexts (e.g. http LAN access from
      // a phone). Feature-detect and fall back to a prompt so the user can still copy the URL.
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopiedId(b.id);
        setTimeout(() => setCopiedId((c) => (c === b.id ? null : c)), 1500);
        return;
      }
      window.prompt("Copy this view link:", url);
    } catch {
      window.prompt("Copy this view link:", url);
    }
  }

  const ghostBtn =
    "rounded-md px-2.5 py-1 text-sm font-medium text-foreground/65 transition hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/10";
  const dangerBtn =
    "rounded-md px-2.5 py-1 text-sm font-medium text-red-600 transition hover:bg-red-500/10 dark:text-red-400";
  const primaryBtn =
    "rounded-lg bg-accent px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-accent-hover disabled:opacity-50";
  const seg = (active: boolean) =>
    `rounded-md px-3 py-1 text-sm font-medium transition ${
      active
        ? "bg-white text-foreground shadow-sm dark:bg-neutral-700"
        : "text-foreground/55 hover:text-foreground"
    }`;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <Logo />
        <div className="ml-auto flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search boards..."
            className="w-40 rounded-lg border border-black/[0.1] bg-black/[0.02] px-3 py-1.5 text-sm outline-none transition focus:w-52 focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-white/15 dark:bg-white/[0.04] sm:w-52 sm:focus:w-60"
          />
          <button
            onClick={toggle}
            aria-label="Toggle dark mode"
            title="Toggle dark mode"
            className="grid h-9 w-9 place-items-center rounded-lg border border-black/[0.1] text-foreground/70 transition hover:bg-black/[0.05] hover:text-foreground dark:border-white/15 dark:hover:bg-white/10"
          >
            {!mounted ? <MoonIcon /> : theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <button onClick={newBoard} disabled={creating} className={primaryBtn}>
            {creating ? "Creating..." : "New board"}
          </button>
        </div>
      </header>
      {createError && (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">
          Could not create a board. Please try again.
        </p>
      )}

      {/* Segmented Boards / Trash switch */}
      <div className="mb-5 inline-flex gap-0.5 rounded-lg border border-black/[0.08] bg-black/[0.03] p-0.5 dark:border-white/10 dark:bg-white/[0.04]">
        <button onClick={() => setTrash(false)} className={seg(!trash)}>
          Boards
        </button>
        <button onClick={() => setTrash(true)} className={seg(trash)}>
          Trash
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <ul className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="h-[68px] animate-pulse rounded-xl border border-black/[0.06] bg-black/[0.03] dark:border-white/10 dark:bg-white/5"
            />
          ))}
        </ul>
      ) : error ? (
        <div className="rounded-xl border border-black/[0.08] p-10 text-center dark:border-white/10">
          <p className="mb-3 text-foreground/70">Could not load boards.</p>
          <button onClick={load} className={ghostBtn}>
            Retry
          </button>
        </div>
      ) : boards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/15 p-12 text-center dark:border-white/15">
          {trash ? (
            <p className="text-foreground/55">Trash is empty.</p>
          ) : q.trim() ? (
            <>
              <p className="mb-3 text-foreground/55">No boards match &quot;{q.trim()}&quot;.</p>
              <button onClick={() => setQ("")} className={ghostBtn}>
                Clear search
              </button>
            </>
          ) : (
            <>
              <p className="mb-5 text-foreground/55">No boards yet. Create one to start.</p>
              <button onClick={newBoard} disabled={creating} className={primaryBtn}>
                New board
              </button>
            </>
          )}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {boards.map((b) => (
            <li
              key={b.id}
              className="group rounded-xl border border-black/[0.08] bg-white p-4 transition hover:border-black/[0.16] hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_-12px_rgba(0,0,0,0.18)] dark:border-white/10 dark:bg-neutral-900 dark:hover:border-white/20"
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
                    className="rounded-md border border-black/15 bg-transparent px-2 py-0.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-white/20"
                  />
                ) : trash ? (
                  <span className="font-medium tracking-tight">{b.name}</span>
                ) : (
                  <button
                    onClick={() => router.push(`/edit/${b.id}`)}
                    className="font-medium tracking-tight hover:text-accent"
                  >
                    {b.name}
                  </button>
                )}

                {!trash && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                      b.is_public
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "bg-black/[0.06] text-foreground/55 dark:bg-white/10"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        b.is_public ? "bg-emerald-500" : "bg-foreground/40"
                      }`}
                    />
                    {b.is_public ? "public" : "private"}
                  </span>
                )}

                <span className="text-xs text-foreground/45">
                  {trash ? "deleted " : "edited "}
                  {relativeTime(b.updated_at)}
                </span>
              </div>

              <div className="-ml-2.5 mt-2.5 flex flex-wrap items-center gap-1">
                {trash ? (
                  <>
                    <button onClick={() => restore(b.id)} className={ghostBtn}>
                      Restore
                    </button>
                    <button onClick={() => hardDelete(b.id)} className={dangerBtn}>
                      Delete forever
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => router.push(`/edit/${b.id}`)} className={ghostBtn}>
                      Open
                    </button>
                    <button onClick={() => copyLink(b)} className={ghostBtn}>
                      {copiedId === b.id ? "Copied" : "Copy view link"}
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(b.id);
                        setDraftName(b.name);
                      }}
                      className={ghostBtn}
                    >
                      Rename
                    </button>
                    <button onClick={() => softDelete(b.id)} className={dangerBtn}>
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
