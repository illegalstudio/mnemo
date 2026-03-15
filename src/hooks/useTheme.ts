import { useState, useEffect, useCallback } from "react";

export type ThemeMode = "light" | "dark" | "system";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? getSystemTheme() : mode;
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("mnemo-theme");
    return (saved as ThemeMode) || "system";
  });

  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveTheme(mode));

  // Apply theme to DOM
  useEffect(() => {
    const theme = resolveTheme(mode);
    setResolved(theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [mode]);

  // Listen for system theme changes when in "system" mode
  useEffect(() => {
    if (mode !== "system") return;

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const theme = getSystemTheme();
      setResolved(theme);
      document.documentElement.setAttribute("data-theme", theme);
    };

    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [mode]);

  const setThemeMode = useCallback((newMode: ThemeMode) => {
    setMode(newMode);
    localStorage.setItem("mnemo-theme", newMode);
  }, []);

  return { mode, resolved, setThemeMode };
}
