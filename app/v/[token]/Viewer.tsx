"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePrefersTheme } from "../../_lib/usePrefersTheme";

const ExcalidrawCanvas = dynamic(() => import("../../_components/ExcalidrawCanvas"), {
  ssr: false,
  loading: () => <Centered>Loading…</Centered>,
});

type ViewBoard = {
  id: string;
  name: string;
  elements: unknown[];
  app_state: Record<string, unknown>;
  files: Record<string, unknown>;
};

type State = "loading" | "ready" | "missing" | "error";

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6 text-center opacity-70">
      {children}
    </div>
  );
}

export default function Viewer({ token }: { token: string }) {
  const [state, setState] = useState<State>("loading");
  const [board, setBoard] = useState<ViewBoard | null>(null);
  const theme = usePrefersTheme();

  const load = () => {
    setState("loading");
    fetch(`/api/view/${token}`)
      .then(async (res) => {
        if (res.status === 404) {
          setState("missing");
          return;
        }
        if (!res.ok) {
          setState("error");
          return;
        }
        const data = await res.json();
        setBoard(data.board);
        setState("ready");
      })
      .catch(() => setState("error"));
  };

  useEffect(load, [token]);

  if (state === "loading") return <Centered>Loading…</Centered>;
  if (state === "missing")
    return <Centered>This board is private or the link has changed.</Centered>;
  if (state === "error")
    return (
      <Centered>
        <div>
          <p className="mb-3">Could not load this board.</p>
          <button
            onClick={load}
            className="rounded-md border border-black/15 px-3 py-1 text-sm dark:border-white/20"
          >
            Retry
          </button>
        </div>
      </Centered>
    );

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-black/10 px-4 py-2 dark:border-white/10">
        <span className="truncate font-medium">{board?.name}</span>
        <span className="text-xs opacity-60">read only view</span>
      </header>
      <div className="relative flex-1">
        <ExcalidrawCanvas
          viewModeEnabled
          theme={theme}
          initialData={{
            elements: (board?.elements ?? []) as never,
            appState: (board?.app_state ?? {}) as never,
            files: (board?.files ?? {}) as never,
          }}
        />
      </div>
    </div>
  );
}
