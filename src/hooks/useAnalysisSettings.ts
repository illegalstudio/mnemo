import { useState, useCallback, useEffect } from "react";
import { getSetting, setSetting } from "../lib/db";

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "it", label: "Italiano" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
  { code: "nl", label: "Nederlands" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
  { code: "ko", label: "한국어" },
  { code: "auto", label: "Same as chat" },
] as const;

export type LangCode = (typeof LANGUAGES)[number]["code"];
export type AnalysisTool = "claude-code" | "codex";

export const ANALYSIS_TOOLS: { value: AnalysisTool; label: string; defaultBinary: string }[] = [
  { value: "claude-code", label: "Claude Code (CLI)", defaultBinary: "claude" },
  { value: "codex", label: "Codex (CLI)", defaultBinary: "codex" },
];

export interface AnalysisSettings {
  enabled: boolean;
  tool: AnalysisTool;
  toolPaths: Record<AnalysisTool, string>;
  fields: {
    title: boolean;
    summary: boolean;
    tags: boolean;
  };
  languages: {
    title: LangCode;
    summary: LangCode;
    tags: LangCode;
  };
  tagCount: { min: number; max: number };
}

const STORAGE_KEY = "analysis-settings";

function getDefaults(): AnalysisSettings {
  return {
    enabled: true,
    tool: "claude-code",
    toolPaths: { "claude-code": "", codex: "" },
    fields: { title: true, summary: true, tags: true },
    languages: { title: "auto", summary: "auto", tags: "en" },
    tagCount: { min: 3, max: 6 },
  };
}

function save(settings: AnalysisSettings) {
  setSetting(STORAGE_KEY, JSON.stringify(settings));
}

export function useAnalysisSettings() {
  const [settings, setSettings] = useState<AnalysisSettings>(getDefaults);

  // Load from SQLite on mount
  useEffect(() => {
    getSetting(STORAGE_KEY).then((stored) => {
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          const defaults = getDefaults();
          const tool = ANALYSIS_TOOLS.some((t) => t.value === parsed.tool)
            ? parsed.tool as AnalysisTool
            : defaults.tool;
          setSettings({
            ...defaults,
            ...parsed,
            tool,
            toolPaths: { ...defaults.toolPaths, ...parsed.toolPaths },
            fields: { ...defaults.fields, ...parsed.fields },
            languages: { ...defaults.languages, ...parsed.languages },
            tagCount: { ...defaults.tagCount, ...parsed.tagCount },
          });
        } catch {
          // ignore
        }
      }
    });
  }, []);

  const update = useCallback((updates: Partial<AnalysisSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...updates };
      save(next);
      return next;
    });
  }, []);

  const updateFields = useCallback((fields: Partial<AnalysisSettings["fields"]>) => {
    setSettings((prev) => {
      const next = { ...prev, fields: { ...prev.fields, ...fields } };
      save(next);
      return next;
    });
  }, []);

  const updateLanguages = useCallback((languages: Partial<AnalysisSettings["languages"]>) => {
    setSettings((prev) => {
      const next = { ...prev, languages: { ...prev.languages, ...languages } };
      save(next);
      return next;
    });
  }, []);

  return { settings, update, updateFields, updateLanguages };
}
