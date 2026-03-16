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

function stripEmoji(text: string): string {
  // Remove emoji, symbols, and other non-text characters
  return text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\ufe0f]/gu, "").trim();
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")  // bold
    .replace(/\*(.+?)\*/g, "$1")       // italic
    .replace(/__(.+?)__/g, "$1")       // bold alt
    .replace(/_(.+?)_/g, "$1")         // italic alt
    .replace(/`(.+?)`/g, "$1")         // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
    .replace(/\\/g, "");               // backslash escapes
}

function slugifyHeading(text: string): string {
  return stripMarkdown(stripEmoji(text))
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function extractHeadings(content: string): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  const regex = /^(#{1,3}) (.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const level = match[1].length;
    const rawText = match[2].trim();
    // Truncate very long headings (user messages can be thousands of chars)
    const truncatedRaw = rawText.length > 200 ? rawText.slice(0, 200) : rawText;
    const text = stripMarkdown(stripEmoji(truncatedRaw)).trim();
    if (!text) continue;
    headings.push({ level, text, id: slugifyHeading(truncatedRaw) });
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
