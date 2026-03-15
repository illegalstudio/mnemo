import TurndownService from "turndown";
import type { Source } from "../types";

const MNEMO_META_RE = /^<!--\s*mnemo:(.+?)\s*-->\n?/;

interface ParsedMeta {
  source: Source;
  url?: string;
  title: string;
}

function parseMeta(raw: string): { meta: ParsedMeta | null; html: string } {
  const match = raw.match(MNEMO_META_RE);
  if (!match) return { meta: null, html: raw };

  const pairs: Record<string, string> = {};
  match[1].split(",").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      pairs[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  });

  const html = raw.replace(MNEMO_META_RE, "");
  return {
    meta: {
      source: (pairs.source as Source) || "other",
      url: pairs.url,
      title: pairs.title ? decodeURIComponent(pairs.title) : "Imported Chat",
    },
    html,
  };
}

/**
 * Check if pasted content is from a Mnemo bookmarklet (starts with mnemo comment)
 */
export function isMnemoHtmlPaste(text: string): boolean {
  return MNEMO_META_RE.test(text);
}

interface Turn {
  role: "user" | "assistant";
  el: Element;
}

/**
 * Extract conversation turns from raw HTML based on source
 */
function extractTurns(doc: Document, source: Source): Turn[] {
  const turns: Turn[] = [];

  if (source === "chatgpt") {
    // ChatGPT: [data-message-author-role="user"|"assistant"]
    doc.querySelectorAll("[data-message-author-role]").forEach((el) => {
      const role = el.getAttribute("data-message-author-role") === "user" ? "user" : "assistant";
      turns.push({ role, el });
    });
  } else if (source === "claude") {
    // Claude: user messages in [data-testid="user-message"], responses in .font-claude-response
    // Collect both and sort by DOM position
    const items: { role: "user" | "assistant"; el: Element; idx: number }[] = [];
    const allElements = doc.querySelectorAll("*");
    allElements.forEach((el, idx) => {
      if (el.getAttribute("data-testid") === "user-message") {
        items.push({ role: "user", el, idx });
      } else if (el.classList.contains("font-claude-response")) {
        items.push({ role: "assistant", el, idx });
      }
    });
    items.sort((a, b) => a.idx - b.idx);
    items.forEach((item) => turns.push({ role: item.role, el: item.el }));
  }

  // Fallback: if no turns found, treat entire content as a single assistant message
  if (turns.length === 0) {
    const body = doc.querySelector("body");
    if (body) turns.push({ role: "assistant", el: body });
  }

  return turns;
}

/**
 * Convert bookmarklet HTML paste to markdown
 */
export function convertHtmlToMarkdown(raw: string): {
  title: string;
  content: string;
  source: Source;
} {
  const { meta, html } = parseMeta(raw);
  const title = meta?.title || "Imported Chat";
  const source = meta?.source || "other";

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  turndown.remove(["button", "nav", "style", "script", "svg"] as any);

  const turns = extractTurns(doc, source);

  let md = `# ${title}\n\n`;

  turns.forEach((turn) => {
    const turnMd = turndown.turndown(turn.el.innerHTML).trim();
    if (!turnMd) return;

    if (turn.role === "user") {
      const firstLine = turnMd.split("\n")[0].replace(/^#+\s*/, "").trim();
      const rest = turnMd.split("\n").slice(1).join("\n").trim();
      md += `## ${firstLine}\n\n`;
      if (rest) md += `${rest}\n\n`;
    } else {
      md += `${turnMd}\n\n---\n\n`;
    }
  });

  return { title, content: md, source };
}
