import { Command } from "@tauri-apps/plugin-shell";
import type { MetadataResult } from "../types";

const SYSTEM_PROMPT = `You are a metadata extractor for an AI chat archive.
Given the following AI chat transcript, respond ONLY with valid JSON (no markdown, no explanation) in this exact format:
{
  "title": "concise title describing the main topic (max 60 chars)",
  "summary": "2-3 sentence summary of what was discussed",
  "tags": ["tag1", "tag2", "tag3"]
}`;

export async function generateMetadata(
  contentMd: string
): Promise<MetadataResult | null> {
  try {
    const fullPrompt = `${SYSTEM_PROMPT}\n\nHere is the chat transcript:\n\n${contentMd}`;

    const command = Command.create("claude", [
      "-p",
      fullPrompt,
      "--output-format",
      "json",
    ]);

    const output = await command.execute();

    if (output.code !== 0) {
      return null;
    }

    const result: MetadataResult = JSON.parse(output.stdout);
    return result;
  } catch {
    return null;
  }
}
