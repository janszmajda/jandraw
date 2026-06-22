"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePrefersTheme } from "../../_lib/usePrefersTheme";
import { relativeTime, viewLink } from "../../_lib/format";

const ExcalidrawCanvas = dynamic(() => import("../../_components/ExcalidrawCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center opacity-70">Loading editor…</div>
  ),
});

type Status = "loading" | "ready" | "notfound" | "error";
type SaveStatus = "idle" | "saving" | "saved" | "failed";
type Snapshot = { id: string; scene_version: number; created_at: string };

// Element + file signature used to skip pure view churn (selection / scroll / zoom)
// so app_state-only changes never trigger a PUT (and never flood board_snapshots).
function computeSig(elements: readonly { id?: string; version?: number; isDeleted?: boolean }[], files: Record<string, unknown> | undefined): string {
  const eSig = (elements ?? [])
    .filter((e) => !e.isDeleted)
    .map((e) => `${e.id}:${e.version ?? 0}`)
    .join(",");
  const fSig = Object.keys(files ?? {}).sort().join(",");
  return `${eSig}||${fSig}`;
}

export default function Editor({ boardId }: { boardId: string }) {
  const theme = usePrefersTheme();
  const [status, setStatus] = useState<Status>("loading");
  const [initialData, setInitialData] = useState<unknown>(null);
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [shareToken, setShareToken] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [copied, setCopied] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null);
  const lastSavedSigRef = useRef<string>("");
  const savedNameRef = useRef<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const readyRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Load the board scene once ----
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/boards/${boardId}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) return setStatus("notfound");
        if (!res.ok) return setStatus("error");
        const { board } = await res.json();
        setName(board.name);
        savedNameRef.current = board.name;
        setIsPublic(board.is_public);
        setShareToken(board.share_token);
        setInitialData({
          elements: board.elements,
          appState: board.app_state,
          files: board.files,
        });
        lastSavedSigRef.current = computeSig(board.elements, board.files);
        readyRef.current = true;
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  // ---- Autosave (serialized, latest-wins) ----
  const doSave = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    savingRef.current = true;
    setSaveStatus("saving");
    try {
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      const files = api.getFiles();
      const sig = computeSig(elements, files);
      const res = await fetch(`/api/boards/${boardId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elements, app_state: appState, files }),
      });
      if (!res.ok) throw new Error("save failed");
      lastSavedSigRef.current = sig;
      setSaveStatus("saved");
    } catch {
      setSaveStatus("failed");
    } finally {
      savingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void doSave();
      }
    }
  }, [boardId]);

  const onChange = useCallback(
    (elements: readonly { id?: string; version?: number; isDeleted?: boolean }[], _appState: unknown, files: Record<string, unknown>) => {
      if (!readyRef.current) return;
      const sig = computeSig(elements, files);
      if (sig === lastSavedSigRef.current) return; // view-only churn → no save
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void doSave(), 1500);
    },
    [doSave],
  );

  // ---- Save on tab blur / close ----
  useEffect(() => {
    const flushBeacon = () => {
      if (!readyRef.current) return;
      const api = apiRef.current;
      if (!api) return;
      const elements = api.getSceneElements();
      const files = api.getFiles();
      const sig = computeSig(elements, files);
      if (sig === lastSavedSigRef.current) return;
      const body = JSON.stringify({ elements, app_state: api.getAppState(), files });
      fetch(`/api/boards/${boardId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
      lastSavedSigRef.current = sig;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void doSave();
    };
    window.addEventListener("beforeunload", flushBeacon);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", flushBeacon);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [boardId, doSave]);

  // ---- Metadata actions ----
  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === savedNameRef.current) {
      setName(savedNameRef.current);
      return;
    }
    try {
      const res = await fetch(`/api/boards/${boardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error();
      savedNameRef.current = trimmed;
    } catch {
      setName(savedNameRef.current);
    }
  }

  async function togglePublic() {
    const next = !isPublic;
    setIsPublic(next);
    try {
      const res = await fetch(`/api/boards/${boardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_public: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setIsPublic(!next); // revert on failure
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(viewLink(shareToken));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function rotateToken() {
    setRotateOpen(false);
    try {
      const res = await fetch(`/api/boards/${boardId}/rotate-token`, { method: "POST" });
      if (!res.ok) throw new Error();
      const { share_token } = await res.json();
      setShareToken(share_token);
    } catch {
      /* ignore */
    }
  }

  async function onImportFile(file: File) {
    try {
      const { loadFromBlob } = await import("@excalidraw/excalidraw");
      const scene = await loadFromBlob(file, null, null);
      const api = apiRef.current;
      if (!api) return;
      if (debounceRef.current) clearTimeout(debounceRef.current); // drop any stale queued save
      api.updateScene({ elements: scene.elements, appState: scene.appState });
      if (scene.files) api.addFiles(Object.values(scene.files));
      // The programmatic updateScene fires onChange → the normal debounced autosave
      // persists the replacement via PUT.
    } catch {
      setSaveStatus("failed");
    }
  }

  async function openHistory() {
    setShowHistory(true);
    setSnapshotsLoading(true);
    try {
      const res = await fetch(`/api/boards/${boardId}/snapshots`);
      const data = await res.json();
      setSnapshots(data.snapshots ?? []);
    } catch {
      setSnapshots([]);
    }
    setSnapshotsLoading(false);
  }

  async function restoreSnapshot(snapId: string) {
    // Cancel any pending autosave so a queued PUT can't clobber the restored scene.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingRef.current = false;
    try {
      const res = await fetch(`/api/boards/${boardId}/restore/${snapId}`, { method: "POST" });
      if (!res.ok) throw new Error();
      const { board } = await res.json();
      const api = apiRef.current;
      if (api) {
        lastSavedSigRef.current = computeSig(board.elements, board.files);
        api.updateScene({ elements: board.elements, appState: board.app_state });
        api.addFiles(Object.values(board.files ?? {}));
      }
      setSaveStatus("saved");
      setShowHistory(false);
    } catch {
      setSaveStatus("failed");
    }
  }

  // ---- Render states ----
  if (status === "loading") {
    return <div className="flex min-h-full flex-1 items-center justify-center opacity-70">Loading…</div>;
  }
  if (status === "notfound") {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-3">
        <p className="opacity-80">Board not found.</p>
        <Link href="/" className="text-blue-600 hover:underline dark:text-blue-400">
          Back to dashboard
        </Link>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-3">
        <p className="opacity-80">Could not load this board.</p>
        <Link href="/" className="text-blue-600 hover:underline dark:text-blue-400">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const saveLabel =
    saveStatus === "saving"
      ? "Saving…"
      : saveStatus === "failed"
        ? "Save failed"
        : "Saved";
  const barBtn =
    "rounded-md px-2 py-1 text-sm transition border border-black/10 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10";

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-2 border-b border-black/10 px-3 py-2 dark:border-white/10">
        <Link href="/" className="text-sm opacity-70 hover:opacity-100">
          ‹ Back
        </Link>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="min-w-0 max-w-56 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium outline-none hover:border-black/10 focus:border-blue-500 dark:hover:border-white/15"
        />

        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={isPublic} onChange={togglePublic} />
          Public
        </label>

        <div className="relative flex items-center gap-1">
          <button onClick={copyLink} className={barBtn}>
            {copied ? "Copied" : "Copy link"}
          </button>
          <button
            onClick={() => setRotateOpen((o) => !o)}
            className={barBtn}
            aria-label="Share link options"
          >
            ⋯
          </button>
          {rotateOpen && (
            <div className="absolute right-0 top-9 z-10 w-48 rounded-lg border border-black/10 bg-white p-1 shadow-lg dark:border-white/15 dark:bg-neutral-900">
              <button
                onClick={rotateToken}
                className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
              >
                Rotate share link
              </button>
            </div>
          )}
        </div>

        <button onClick={() => fileInputRef.current?.click()} className={barBtn}>
          Import
        </button>
        <a href={`/api/boards/${boardId}/export`} download className={barBtn}>
          Export
        </a>
        <button onClick={openHistory} className={barBtn}>
          History
        </button>

        <span className="ml-auto flex items-center gap-2 text-sm opacity-70">
          {saveLabel}
          {saveStatus === "failed" && (
            <button onClick={() => void doSave()} className={barBtn}>
              Retry
            </button>
          )}
        </span>

        <input
          ref={fileInputRef}
          type="file"
          accept=".excalidraw,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImportFile(f);
            e.target.value = "";
          }}
        />
      </header>

      {/* Canvas + history drawer */}
      <div className="relative flex-1 min-h-0">
        {initialData != null && (
          <ExcalidrawCanvas
            theme={theme}
            initialData={initialData as never}
            onChange={onChange as never}
            excalidrawAPI={(api: unknown) => {
              apiRef.current = api;
            }}
          />
        )}

        {showHistory && (
          <aside className="absolute right-0 top-0 z-20 flex h-full w-72 flex-col border-l border-black/10 bg-white dark:border-white/15 dark:bg-neutral-900">
            <div className="flex items-center justify-between border-b border-black/10 p-3 dark:border-white/10">
              <span className="font-medium">History</span>
              <button onClick={() => setShowHistory(false)} className={barBtn}>
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              <div className="rounded-md px-2 py-2 text-sm font-medium opacity-80">now</div>
              {snapshotsLoading ? (
                <div className="px-2 py-2 text-sm opacity-60">Loading…</div>
              ) : snapshots.length === 0 ? (
                <div className="px-2 py-2 text-sm opacity-60">No history yet.</div>
              ) : (
                snapshots.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <span className="opacity-80">{relativeTime(s.created_at)}</span>
                    <button
                      onClick={() => restoreSnapshot(s.id)}
                      className="rounded border border-black/10 px-2 py-0.5 text-xs hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
                    >
                      Restore
                    </button>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
