import { useState, useCallback } from "react";

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

export interface AnalysisSettings {
  enabled: boolean;
  tool: "claude-code";
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

const STORAGE_KEY = "mnemo-analysis-settings";

function getDefaults(): AnalysisSettings {
  return {
    enabled: true,
    tool: "claude-code",
    fields: { title: true, summary: true, tags: true },
    languages: { title: "auto", summary: "auto", tags: "en" },
    tagCount: { min: 3, max: 6 },
  };
}

function load(): AnalysisSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...getDefaults(),
        ...parsed,
        fields: { ...getDefaults().fields, ...parsed.fields },
        languages: { ...getDefaults().languages, ...parsed.languages },
        tagCount: { ...getDefaults().tagCount, ...parsed.tagCount },
      };
    }
  } catch {
    // ignore
  }
  return getDefaults();
}

function save(settings: AnalysisSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function useAnalysisSettings() {
  const [settings, setSettings] = useState<AnalysisSettings>(load);

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
