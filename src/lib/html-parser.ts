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
 * Check if pasted content is from a Mnemo bookmarklet (starts with mnemo comment + HTML)
 */
export function isMnemoHtmlPaste(text: string): boolean {
  return MNEMO_META_RE.test(text) && /<div\s+data-role=/.test(text);
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

  // Parse the HTML to extract conversation turns
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const turns = doc.querySelectorAll("div[data-role]");

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  // Remove unwanted elements (buttons, icons, etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  turndown.remove(["button", "nav", "style", "script", "svg"] as any);

  let md = `# ${title}\n\n`;

  turns.forEach((turn) => {
    const role = turn.getAttribute("data-role");
    const turnMd = turndown.turndown(turn.innerHTML).trim();

    if (!turnMd) return;

    if (role === "user") {
      // User message becomes H2 — use first line as heading
      const firstLine = turnMd.split("\n")[0].replace(/^#+\s*/, "").trim();
      const rest = turnMd.split("\n").slice(1).join("\n").trim();
      md += `## ${firstLine}\n\n`;
      if (rest) md += `${rest}\n\n`;
    } else {
      // Assistant response is body text
      md += `${turnMd}\n\n---\n\n`;
    }
  });

  return { title, content: md, source };
}
