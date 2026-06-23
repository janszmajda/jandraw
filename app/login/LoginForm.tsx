"use client";

import { useState, type FormEvent } from "react";
import Logo from "../_components/Logo";

export default function LoginForm() {
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      if (res.ok) {
        // Hard navigation so the freshly-set cookie gates the dashboard render.
        window.location.href = "/";
        return;
      }
      if (res.status === 401) {
        setError("Wrong passphrase.");
        setSecret("");
      } else {
        setError("Something went wrong, try again.");
      }
    } catch {
      setError("Something went wrong, try again.");
    }
    setLoading(false);
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Logo size="lg" withText={false} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Jandraw</h1>
            <p className="mt-1 text-sm text-foreground/55">Sign in to your boards</p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-black/[0.08] bg-white p-7 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] dark:border-white/10 dark:bg-neutral-900 dark:shadow-none"
        >
          <label htmlFor="passphrase" className="mb-1.5 block text-sm font-medium text-foreground/70">
            Passphrase
          </label>
          <input
            id="passphrase"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="mb-4 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-white/20"
          />

          <button
            type="submit"
            disabled={loading || secret.length === 0}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>

          {error && (
            <p className="mt-4 text-center text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </form>
      </div>
    </main>
  );
}
