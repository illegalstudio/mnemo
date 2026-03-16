import { useState, useEffect, useCallback } from "react";
import { getSetting, setSetting } from "../lib/db";

export type ThemeMode = "light" | "dark" | "system";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? getSystemTheme() : mode;
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [loaded, setLoaded] = useState(false);

  // Load from SQLite on mount
  useEffect(() => {
    getSetting("theme").then((saved) => {
      if (saved && ["light", "dark", "system"].includes(saved)) {
        setMode(saved as ThemeMode);
      }
      setLoaded(true);
    });
  }, []);

  // Apply theme to DOM
  useEffect(() => {
    const theme = resolveTheme(mode);
    document.documentElement.setAttribute("data-theme", theme);
  }, [mode]);

  // Listen for system theme changes when in "system" mode
  useEffect(() => {
    if (mode !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      document.documentElement.setAttribute("data-theme", getSystemTheme());
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [mode]);

  const setThemeMode = useCallback((newMode: ThemeMode) => {
    setMode(newMode);
    setSetting("theme", newMode);
  }, []);

  return { mode, resolved: resolveTheme(mode), setThemeMode, loaded };
}
