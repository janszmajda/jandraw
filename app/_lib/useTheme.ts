"use client";

import { useEffect, useState } from "react";

// App theme: defaults to LIGHT. Dark mode is an explicit, persisted choice toggled
// from the dashboard. The preference lives in localStorage and is reflected as a
// `dark` class on <html> (Tailwind class-based dark mode + the CSS vars in
// globals.css). An inline script in the root layout applies it before paint to
// avoid a flash. The editor and public view read the same preference (no toggle of
// their own) and react to changes via a window event / storage event.

export type Theme = "light" | "dark";
const KEY = "jandraw-theme";
const EVENT = "jandraw-theme-change";

function read(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function apply(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void } {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const t = read();
    setThemeState(t);
    apply(t);
    const onChange = () => setThemeState(read());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    apply(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(EVENT));
  };

  const toggle = () =>
    setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark");

  return { theme, setTheme, toggle };
}
