import { useState, useCallback } from "react";

export interface AnalysisSettings {
  enabled: boolean;
  tool: "claude-code";
  fields: {
    title: boolean;
    summary: boolean;
    tags: boolean;
  };
  prompt: string;
  tagCount: { min: number; max: number };
}

const DEFAULT_PROMPT = `You are a metadata extractor for an AI chat archive.
Given the following AI chat transcript, respond ONLY with valid JSON (no markdown, no explanation) in this exact format:
{
  "title": "concise title describing the main topic (max 60 chars)",
  "summary": "2-3 sentence summary of what was discussed",
  "tags": ["tag1", "tag2", "tag3"]
}`;

const STORAGE_KEY = "mnemo-analysis-settings";

function getDefaults(): AnalysisSettings {
  return {
    enabled: true,
    tool: "claude-code",
    fields: { title: true, summary: true, tags: true },
    prompt: DEFAULT_PROMPT,
    tagCount: { min: 3, max: 6 },
  };
}

function load(): AnalysisSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...getDefaults(), ...parsed, fields: { ...getDefaults().fields, ...parsed.fields }, tagCount: { ...getDefaults().tagCount, ...parsed.tagCount } };
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

  const resetPrompt = useCallback(() => {
    setSettings((prev) => {
      const next = { ...prev, prompt: DEFAULT_PROMPT };
      save(next);
      return next;
    });
  }, []);

  return { settings, update, updateFields, resetPrompt };
}
