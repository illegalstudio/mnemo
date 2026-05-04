import { invoke } from "@tauri-apps/api/core";
import type { MetadataResult } from "../types";
import type { AnalysisSettings } from "../hooks/useAnalysisSettings";
import { ANALYSIS_TOOLS, LANGUAGES } from "../hooks/useAnalysisSettings";

export class ToolNotFoundError extends Error {
  constructor(tool: string) {
    super(`Il tool "${tool}" non è stato trovato nel sistema. Imposta il percorso del binario nelle preferenze o assicurati che sia disponibile nel PATH.`);
    this.name = "ToolNotFoundError";
  }
}

interface ToolExecutionOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

function getToolPath(settings: Pick<AnalysisSettings, "tool" | "toolPaths">): string | null {
  return settings.toolPaths[settings.tool]?.trim() || null;
}

function toolLabel(settings: Pick<AnalysisSettings, "tool">): string {
  return ANALYSIS_TOOLS.find((tool) => tool.value === settings.tool)?.label ?? settings.tool;
}

export async function checkToolAvailable(
  settings: Pick<AnalysisSettings, "tool" | "toolPaths">
): Promise<boolean> {
  try {
    return await invoke<boolean>("check_analysis_tool", {
      tool: settings.tool,
      binaryPath: getToolPath(settings),
    });
  } catch {
    return false;
  }
}

function langName(code: string): string {
  const lang = LANGUAGES.find((l) => l.code === code);
  if (!lang || code === "auto") return "the same language as the chat";
  return lang.label;
}

function buildPrompt(settings: AnalysisSettings, existingTags: string[]): string {
  const fields: string[] = [];
  const langInstructions: string[] = [];

  if (settings.fields.title) {
    fields.push(`  "title": "concise title describing the main topic (max 60 chars)"`);
    langInstructions.push(`- Title must be in ${langName(settings.languages.title)}`);
  }
  if (settings.fields.summary) {
    fields.push(`  "summary": "2-3 sentence summary of what was discussed"`);
    langInstructions.push(`- Summary must be in ${langName(settings.languages.summary)}`);
  }
  if (settings.fields.tags) {
    fields.push(`  "tags": ["tag1", "tag2", "tag3"]`);
    langInstructions.push(`- Tags must be in ${langName(settings.languages.tags)}`);
  }

  if (fields.length === 0) return "";

  let prompt = `You are a metadata extractor for an AI chat archive.
Given the following AI chat transcript, respond ONLY with valid JSON (no markdown, no explanation) in this exact format:
{
${fields.join(",\n")}
}`;

  if (settings.fields.tags) {
    prompt += `\nProvide ${settings.tagCount.min}-${settings.tagCount.max} lowercase single-word tags. Prefer broad, general categories (e.g. "finance", "programming", "health") over specific multi-word tags. Use hyphens only when absolutely necessary.`;
    prompt += `\nReuse existing tags as much as possible before creating new ones.`;
    if (existingTags.length > 0) {
      prompt += `\nExisting tags: ${existingTags.join(", ")}.`;
    }
  }

  if (langInstructions.length > 0) {
    prompt += `\n\nLanguage requirements:\n${langInstructions.join("\n")}`;
  }

  return prompt;
}

export async function generateMetadata(
  contentMd: string,
  settings: AnalysisSettings,
  existingTags: string[] = []
): Promise<Partial<MetadataResult> | null> {
  if (!settings.enabled) return null;
  if (!settings.fields.title && !settings.fields.summary && !settings.fields.tags) return null;

  try {
    const prompt = buildPrompt(settings, existingTags);
    if (!prompt) return null;

    const available = await checkToolAvailable(settings);
    if (!available) {
      throw new ToolNotFoundError(getToolPath(settings) ?? toolLabel(settings));
    }

    const truncated = contentMd.length > 8000 ? contentMd.slice(0, 8000) + "\n\n[truncated]" : contentMd;
    const fullPrompt = `${prompt}\n\nHere is the chat transcript:\n\n${truncated}`;

    const TIMEOUT_MS = 60_000;
    const output = await Promise.race([
      invoke<ToolExecutionOutput>("run_analysis_tool", {
        tool: settings.tool,
        binaryPath: getToolPath(settings),
        prompt: fullPrompt,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("AI analysis timed out after 60s")), TIMEOUT_MS)
      ),
    ]);
    console.log("[metadata] exit code:", output.code);

    if (output.code !== 0) {
      console.error("[metadata] command failed:", output.stderr);
      return null;
    }

    const stdout = output.stdout.trim();
    if (!stdout) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        console.error("[metadata] could not parse JSON from output");
        return null;
      }
    }

    const obj = parsed as Record<string, unknown>;
    let result: Partial<MetadataResult>;

    if (obj.result && typeof obj.result === "string") {
      const resultStr = obj.result as string;
      // Try to extract JSON: look for a JSON block with our expected keys
      let extracted: string | null = null;
      // First try: ```json ... ``` block
      const fenceMatch = resultStr.match(/```json\s*([\s\S]*?)```/);
      if (fenceMatch) {
        extracted = fenceMatch[1].trim();
      }
      // Second try: find a { that contains "title" or "summary" or "tags"
      if (!extracted) {
        const braceMatch = resultStr.match(/\{[^{}]*(?:"title"|"summary"|"tags")[^{}]*\}/);
        if (braceMatch) {
          extracted = braceMatch[0];
        }
      }
      // Third try: any ``` block
      if (!extracted) {
        const anyFence = resultStr.match(/```\w*\s*([\s\S]*?)```/);
        if (anyFence) {
          extracted = anyFence[1].trim();
        }
      }
      console.log("[metadata] result field:", resultStr.slice(0, 1000));
      if (extracted) {
        try {
          result = JSON.parse(extracted);
        } catch (parseErr) {
          console.error("[metadata] failed to parse extracted JSON:", parseErr, extracted);
          return null;
        }
      } else {
        console.error("[metadata] could not extract JSON from result field");
        return null;
      }
    } else if (Array.isArray(parsed)) {
      const textItem = (parsed as { type?: string; text?: string }[]).find(
        (item) => item.type === "text" && item.text
      );
      if (textItem?.text) {
        result = JSON.parse(textItem.text);
      } else {
        return null;
      }
    } else if (obj.title || obj.tags || obj.summary) {
      result = obj as Partial<MetadataResult>;
    } else {
      console.error("[metadata] unexpected response format:", parsed);
      return null;
    }

    const filtered: Partial<MetadataResult> = {};
    if (settings.fields.title && result.title) filtered.title = result.title;
    if (settings.fields.summary && result.summary) filtered.summary = result.summary;
    if (settings.fields.tags && result.tags && Array.isArray(result.tags)) filtered.tags = result.tags;

    return Object.keys(filtered).length > 0 ? filtered : null;
  } catch (e) {
    if (e instanceof ToolNotFoundError) throw e;
    console.error("[metadata] error:", e);
    return null;
  }
}

/**
 * Regenerate a single field using AI
 */
export async function generateSingleField(
  contentMd: string,
  field: "title" | "summary" | "tags",
  settings: AnalysisSettings,
  existingTags: string[] = []
): Promise<Partial<MetadataResult> | null> {
  // Create a temporary settings object with only the requested field enabled
  const singleFieldSettings: AnalysisSettings = {
    ...settings,
    enabled: true,
    fields: {
      title: field === "title",
      summary: field === "summary",
      tags: field === "tags",
    },
  };
  return generateMetadata(contentMd, singleFieldSettings, existingTags);
}
