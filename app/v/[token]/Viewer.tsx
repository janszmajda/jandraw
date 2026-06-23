"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "../../_lib/useTheme";
import Logo from "../../_components/Logo";

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
  const { theme } = useTheme();

  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce((n) => n + 1);

  useEffect(() => {
    const ctrl = new AbortController();
    setState("loading");
    fetch(`/api/view/${token}`, { signal: ctrl.signal })
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
      .catch((e) => {
        if (e?.name !== "AbortError") setState("error");
      });
    return () => ctrl.abort();
  }, [token, nonce]);

  if (state === "loading") return <Centered>Loading…</Centered>;
  if (state === "missing")
    return <Centered>This board is private or the link has changed.</Centered>;
  if (state === "error")
    return (
      <Centered>
        <div>
          <p className="mb-3">Could not load this board.</p>
          <button
            onClick={reload}
            className="rounded-md border border-black/15 px-3 py-1 text-sm dark:border-white/20"
          >
            Retry
          </button>
        </div>
      </Centered>
    );

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-black/[0.08] px-4 py-2.5 dark:border-white/10">
        <Logo size="sm" withText={false} />
        <span className="truncate font-medium tracking-tight">{board?.name}</span>
        <span className="ml-auto rounded-full bg-black/[0.05] px-2.5 py-0.5 text-xs font-medium text-foreground/55 dark:bg-white/10">
          Read-only
        </span>
      </header>
      <div className="relative flex-1 min-h-0">
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
