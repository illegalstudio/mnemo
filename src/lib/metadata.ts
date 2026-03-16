import { Command } from "@tauri-apps/plugin-shell";
import type { MetadataResult } from "../types";

const PROMPT = `You are a metadata extractor for an AI chat archive.
Given the following AI chat transcript, respond ONLY with valid JSON (no markdown, no explanation) in this exact format:
{
  "title": "concise title describing the main topic (max 60 chars)",
  "summary": "2-3 sentence summary of what was discussed",
  "tags": ["tag1", "tag2", "tag3"]
}
Provide 3-6 lowercase tags using hyphens not spaces.`;

export async function generateMetadata(
  contentMd: string
): Promise<MetadataResult | null> {
  try {
    // Truncate content to avoid exceeding CLI argument limits
    const truncated = contentMd.length > 8000 ? contentMd.slice(0, 8000) + "\n\n[truncated]" : contentMd;
    const fullPrompt = `${PROMPT}\n\nHere is the chat transcript:\n\n${truncated}`;

    const command = Command.create("claude", [
      "-p",
      fullPrompt,
      "--output-format",
      "json",
    ]);

    const output = await command.execute();
    console.log("[metadata] exit code:", output.code);
    console.log("[metadata] stdout:", output.stdout?.slice(0, 500));
    console.log("[metadata] stderr:", output.stderr?.slice(0, 500));

    if (output.code !== 0) {
      console.error("[metadata] command failed with code", output.code);
      return null;
    }

    const stdout = output.stdout.trim();
    if (!stdout) return null;

    // Claude CLI --output-format json wraps the response in a JSON array
    // Try parsing as-is first, then try extracting from the wrapper
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      // Try to extract JSON object from the response
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        console.error("[metadata] could not parse JSON from output");
        return null;
      }
    }

    // Handle Claude CLI JSON output format: may be an array of result objects
    // or a direct result object
    let result: MetadataResult;
    if (Array.isArray(parsed)) {
      // Find the text content in the array
      const textItem = parsed.find((item: { type?: string; text?: string }) =>
        item.type === "text" && item.text
      );
      if (textItem?.text) {
        result = JSON.parse(textItem.text);
      } else {
        console.error("[metadata] no text item in array response");
        return null;
      }
    } else if (parsed && typeof parsed === "object" && "title" in parsed) {
      result = parsed as MetadataResult;
    } else {
      console.error("[metadata] unexpected response format:", parsed);
      return null;
    }

    // Validate the result has required fields
    if (!result.title || !result.tags || !Array.isArray(result.tags)) {
      console.error("[metadata] invalid result structure:", result);
      return null;
    }

    return result;
  } catch (e) {
    console.error("[metadata] error:", e);
    return null;
  }
}
