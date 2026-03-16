import type { Chat, Source, HeadingEntry } from "../types";

const MNEMO_META_RE = /^<!--\s*mnemo:(.+?)\s*-->\n?/;

function parseMnemoMeta(content: string): { source?: Source; url?: string; exportedAt?: string; cleanContent: string } {
  const match = content.match(MNEMO_META_RE);
  if (!match) return { cleanContent: content };

  const meta: Record<string, string> = {};
  match[1].split(",").forEach((pair) => {
    const [key, value] = pair.split("=").map((s) => s.trim());
    if (key && value) meta[key] = value;
  });

  const cleanContent = content.replace(MNEMO_META_RE, "");
  return {
    source: meta.source as Source | undefined,
    url: meta.url,
    exportedAt: meta.exported_at,
    cleanContent,
  };
}

export function detectSource(content: string): Source {
  if (/perplexity\.ai/i.test(content) || /pplx/i.test(content)) {
    return "perplexity";
  }
  if (/claude\.ai/i.test(content) || /anthropic/i.test(content)) {
    return "claude";
  }
  if (/openai/i.test(content) || /chatgpt/i.test(content) || /chat\.openai\.com/i.test(content)) {
    return "chatgpt";
  }
  return "other";
}

export function extractTitle(content: string, filename: string): string {
  const match = content.match(/^# (.+)$/m);
  if (match) {
    return match[1].trim();
  }
  return filename.replace(/\.[^/.]+$/, "");
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

export function extractHeadings(content: string): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match H1 (title) — always include
    const h1Match = line.match(/^# (.+)$/);
    if (h1Match) {
      const text = h1Match[1].trim();
      headings.push({ level: 1, text, id: slugifyHeading(text) });
      continue;
    }
    // Match H2 — only include if it's a "user turn" heading:
    // preceded by start of file, blank line after ---, or blank lines only
    const h2Match = line.match(/^## (.+)$/);
    if (h2Match) {
      // Look backwards to see if this H2 follows a --- separator or is near the start
      let isUserHeading = false;
      for (let j = i - 1; j >= 0; j--) {
        const prev = lines[j].trim();
        if (prev === "") continue; // skip blank lines
        if (prev === "---") { isUserHeading = true; break; }
        if (prev.startsWith("# ")) { isUserHeading = true; break; } // right after title
        break; // any other content means it's an AI heading
      }
      // Also include if it's near the beginning (first heading after title)
      if (i <= 2) isUserHeading = true;

      if (isUserHeading) {
        const text = h2Match[1].trim();
        headings.push({ level: 2, text, id: slugifyHeading(text) });
      }
    }
  }

  return headings;
}

export function parseImportFile(
  filename: string,
  content: string,
  contentHtml?: string | null,
): Omit<Chat, "id"> {
  const { source: metaSource, cleanContent } = parseMnemoMeta(content);
  const source = metaSource || detectSource(cleanContent);
  const title = extractTitle(cleanContent, filename);

  return {
    title,
    summary: null,
    source,
    content_md: cleanContent,
    content_html: contentHtml || null,
    imported_at: new Date().toISOString(),
    chat_date: null,
  };
}
