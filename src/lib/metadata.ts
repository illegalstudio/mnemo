import { Command } from "@tauri-apps/plugin-shell";
import type { MetadataResult } from "../types";
import type { AnalysisSettings } from "../hooks/useAnalysisSettings";
import { LANGUAGES } from "../hooks/useAnalysisSettings";

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
    prompt += `\nProvide ${settings.tagCount.min}-${settings.tagCount.max} lowercase tags using hyphens not spaces.`;
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

    const truncated = contentMd.length > 8000 ? contentMd.slice(0, 8000) + "\n\n[truncated]" : contentMd;
    const fullPrompt = `${prompt}\n\nHere is the chat transcript:\n\n${truncated}`;

    const command = Command.create("claude", [
      "-p",
      fullPrompt,
      "--output-format",
      "json",
    ]);

    const output = await command.execute();
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
      const jsonMatch = resultStr.match(/```(?:json)?\s*([\s\S]*?)```/) || resultStr.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[1].trim());
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
    console.error("[metadata] error:", e);
    return null;
  }
}
