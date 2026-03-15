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

export function extractHeadings(content: string): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  const regex = /^(#{1,2}) (.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const id = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");

    headings.push({ level, text, id });
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
