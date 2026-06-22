"use client";

import { useState, type FormEvent } from "react";

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
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/15 dark:bg-neutral-900"
      >
        <h1 className="mb-6 text-center text-2xl font-semibold tracking-tight">Jandraw</h1>

        <label htmlFor="passphrase" className="mb-1 block text-sm font-medium opacity-80">
          Passphrase
        </label>
        <input
          id="passphrase"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          className="mb-4 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-blue-500 dark:border-white/20"
        />

        <button
          type="submit"
          disabled={loading || secret.length === 0}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        {error && (
          <p className="mt-4 text-center text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </form>
    </main>
  );
}
