"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useTheme } from "../../_lib/useTheme";
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

// Persisted app_state keys that change only by deliberate user action (a canvas
// background or grid change), never by selection / scroll / zoom / tool churn.
// Folding just these into the save signature makes those changes save, while pure
// view churn (which never touches them) is still skipped — so board_snapshots
// isn't flooded by transient app_state keys (activeTool, openMenu, selection, …).
const SAVABLE_APPSTATE_KEYS = ["viewBackgroundColor", "gridModeEnabled", "gridSize", "gridStep"];

// Signature used to skip no-op saves: elements (id:version), the file-id set, and
// the savable app_state keys above.
function computeSig(
  elements: readonly { id?: string; version?: number; isDeleted?: boolean }[],
  appState: Record<string, unknown> | null | undefined,
  files: Record<string, unknown> | undefined,
): string {
  const eSig = (elements ?? [])
    .filter((e) => !e.isDeleted)
    .map((e) => `${e.id}:${e.version ?? 0}`)
    .join(",");
  const fSig = Object.keys(files ?? {}).sort().join(",");
  const a = (appState ?? {}) as Record<string, unknown>;
  // Fold in the canvas-visual keys AND every currentItem* style default (all persisted
  // per A.10) so changing a default style (e.g. stroke color, font) autosaves — but NOT
  // transient UI keys (activeTool, selection, scroll, zoom) which would cause save churn.
  const keys = [
    ...SAVABLE_APPSTATE_KEYS,
    ...Object.keys(a).filter((k) => k.startsWith("currentItem")),
  ].sort();
  const aSig = keys.map((k) => `${k}:${JSON.stringify(a[k])}`).join(",");
  return `${eSig}||${fSig}||${aSig}`;
}

export default function Editor({ boardId }: { boardId: string }) {
  const { theme } = useTheme();
  const [status, setStatus] = useState<Status>("loading");
  const [initialData, setInitialData] = useState<unknown>(null);
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [shareToken, setShareToken] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [suspended, setSuspended] = useState(false); // locks the canvas during restore/import
  const [copied, setCopied] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null);
  const lastSavedSigRef = useRef<string>("");
  const savedNameRef = useRef<string>("");
  const nameRef = useRef<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const readyRef = useRef(false);
  const baselineSetRef = useRef(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const suspendRef = useRef(false);
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
        lastSavedSigRef.current = computeSig(board.elements, board.app_state, board.files);
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

  // Keep a ref of the current name so the close-time flush sees the latest value.
  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  // Suspend autosave (ref, read synchronously) AND lock the canvas (state -> viewModeEnabled)
  // so the user can't draw into a scene that restore/import is about to replace.
  const setSuspend = (v: boolean) => {
    suspendRef.current = v;
    setSuspended(v);
  };

  // ---- Autosave (serialized, latest-wins) ----
  const doSave = useCallback(async () => {
    const api = apiRef.current;
    if (!api || suspendRef.current) return;
    const elements = api.getSceneElements();
    const appState = api.getAppState();
    const files = api.getFiles();
    const sig = computeSig(elements, appState, files);
    // No-op if nothing changed (defends against redundant triggers from flush vs debounce).
    if (sig === lastSavedSigRef.current) {
      setSaveStatus("saved");
      return;
    }
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    savingRef.current = true;
    setSaveStatus("saving");
    const work = (async () => {
      try {
        const res = await fetch(`/api/boards/${boardId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ elements, app_state: appState, files }),
        });
        if (!res.ok) throw new Error("save failed");
        // Don't record "saved" if a restore/import superseded this save mid-flight.
        if (!suspendRef.current) lastSavedSigRef.current = sig;
        setSaveStatus("saved");
      } catch {
        setSaveStatus("failed");
      } finally {
        savingRef.current = false;
        if (pendingRef.current && !suspendRef.current) {
          pendingRef.current = false;
          void doSave();
        }
      }
    })();
    // Expose the in-flight save so restore/import can await it before writing.
    inFlightRef.current = work;
    try {
      await work;
    } finally {
      if (inFlightRef.current === work) inFlightRef.current = null;
    }
  }, [boardId]);

  const onChange = useCallback(
    (
      elements: readonly { id?: string; version?: number; isDeleted?: boolean }[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>,
    ) => {
      if (!readyRef.current || suspendRef.current) return;
      const sig = computeSig(elements, appState, files);
      // Excalidraw fires onChange on mount with its normalized scene (grid/defaults
      // filled in) which differs from the stored scene. Adopt that first emission as
      // the saved baseline so merely OPENING a board never triggers a save/snapshot;
      // only genuine edits after mount differ from the baseline.
      if (!baselineSetRef.current) {
        baselineSetRef.current = true;
        lastSavedSigRef.current = sig;
        return;
      }
      if (sig === lastSavedSigRef.current) return; // view-only churn → no save
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void doSave(), 1500);
    },
    [doSave],
  );

  // ---- Save on tab blur / close ----
  useEffect(() => {
    const flush = (isClosing: boolean) => {
      if (!readyRef.current) return;
      const api = apiRef.current;
      if (!api) return;
      // Drop any pending debounced save so a late timer can't duplicate this flush.
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      // Persist a pending rename (typed but not yet blurred) via a tiny keepalive PATCH,
      // independent of the scene so it doesn't trigger a snapshot / version bump.
      const t = nameRef.current.trim();
      if (t.length > 0 && t !== savedNameRef.current) {
        fetch(`/api/boards/${boardId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: t }),
          keepalive: true,
        })
          .then((res) => {
            if (res.ok) savedNameRef.current = t;
          })
          .catch(() => {});
      }
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      const files = api.getFiles();
      const sig = computeSig(elements, appState, files);
      if (sig === lastSavedSigRef.current) return;

      // On a tab BLUR (page survives) with a save already in flight, defer to doSave's
      // serialization so we don't race a second concurrent PUT. On a real CLOSE there is
      // no "later" — the in-flight non-keepalive PUT is cancelled by the unload — so send
      // the latest scene now via keepalive instead of deferring to a doomed re-run.
      if (!isClosing && (savingRef.current || inFlightRef.current)) {
        pendingRef.current = true;
        return;
      }

      const body = JSON.stringify({ elements, app_state: appState, files });
      // keepalive bodies are capped at ~64KB measured in BYTES; size with TextEncoder.
      if (new TextEncoder().encode(body).length < 60000) {
        const baseline = lastSavedSigRef.current;
        fetch(`/api/boards/${boardId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        })
          .then((res) => {
            if (res.ok) {
              // advance the baseline only if nothing superseded it (a later save, an
              // import, or a restore) — never clobber a newer baseline with a stale sig.
              if (lastSavedSigRef.current === baseline && !suspendRef.current) {
                lastSavedSigRef.current = sig;
              }
            } else {
              setSaveStatus("failed"); // surface failure so the Retry affordance appears
            }
          })
          .catch(() => setSaveStatus("failed"));
      } else if (!isClosing) {
        // Over the keepalive cap but the page survives (blur): a normal save completes.
        void doSave();
      }
      // else: closing + over-cap → unavoidable gap (browser keepalive limit; documented).
    };
    const onBeforeUnload = () => flush(true);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush(false);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
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
        keepalive: true, // survive a tab close that happens right after the field blurs
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
        keepalive: true,
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
      // Suspend autosave while swapping the scene; let any in-flight save land first so
      // it can't clobber the replacement, and drop any queued save.
      setSuspend(true);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      pendingRef.current = false;
      if (inFlightRef.current) {
        try {
          await inFlightRef.current;
        } catch {
          /* ignore */
        }
      }
      api.updateScene({ elements: scene.elements, appState: scene.appState });
      if (scene.files) api.addFiles(Object.values(scene.files));
      // Adopt the imported scene as the baseline so the async onChange updateScene fires
      // is recognized as a no-op; the explicit doSave below is the single write.
      lastSavedSigRef.current = computeSig(api.getSceneElements(), api.getAppState(), api.getFiles());
      setSuspend(false);
      void doSave(); // persist the imported replacement via PUT
    } catch {
      setSuspend(false);
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
    // Suspend autosave and let any in-flight save land FIRST, so neither a queued nor
    // an in-flight PUT can overwrite the restored scene (restore must commit last).
    suspendRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingRef.current = false;
    try {
      if (inFlightRef.current) {
        try {
          await inFlightRef.current;
        } catch {
          /* ignore */
        }
      }
      const res = await fetch(`/api/boards/${boardId}/restore/${snapId}`, { method: "POST" });
      if (!res.ok) throw new Error();
      const { board } = await res.json();
      const api = apiRef.current;
      if (api) {
        api.updateScene({ elements: board.elements, appState: board.app_state });
        api.addFiles(Object.values(board.files ?? {}));
        // Baseline = the actual normalized scene now on the canvas, so the onChange
        // triggered by updateScene doesn't re-save the just-restored (already-persisted) state.
        lastSavedSigRef.current = computeSig(
          api.getSceneElements(),
          api.getAppState(),
          api.getFiles(),
        );
      }
      setSaveStatus("saved");
      setShowHistory(false);
    } catch {
      setSaveStatus("failed");
    } finally {
      setSuspend(false);
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
            viewModeEnabled={suspended}
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
