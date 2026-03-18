import TurndownService from "turndown";
// @ts-expect-error no types available
import { gfm } from "turndown-plugin-gfm";
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
  } else if (source === "grok") {
    // Grok: message bubbles with response-content-markdown inside
    // User messages: parent has items-end class, AI: items-start
    doc.querySelectorAll(".response-content-markdown").forEach((el) => {
      const container = el.closest("[id^='response-']");
      if (!container) return;
      const isUser = container.classList.contains("items-end");
      turns.push({ role: isUser ? "user" : "assistant", el });
    });
  } else if (source === "perplexity") {
    // Perplexity has two modes:
    // 1. Regular mode: user queries in h1.group/query, AI responses in div[id^="markdown-content-"]
    // 2. Computer mode: user queries in h1.group/query (first) or div.group/query (follow-ups),
    //    AI responses in gap-y-sm containers with .prose blocks (no markdown-content divs)
    const items: { role: "user" | "assistant"; el: Element; idx: number }[] = [];
    const allElements = doc.querySelectorAll("*");
    let hasMarkdownContent = false;

    allElements.forEach((el, idx) => {
      // User query: h1 or div with class "group/query"
      // Regular mode uses h1, Computer mode uses h1 for first message and div for follow-ups
      if (
        (el.tagName === "H1" || el.tagName === "DIV") &&
        el.classList.contains("group/query")
      ) {
        items.push({ role: "user", el, idx });
      }
      // Regular mode: AI response in markdown-content divs
      else if (el.id && el.id.startsWith("markdown-content-")) {
        hasMarkdownContent = true;
        items.push({ role: "assistant", el, idx });
      }
    });

    // Computer mode fallback: no markdown-content divs found
    // Collect response containers (gap-y-sm with .prose descendants)
    if (!hasMarkdownContent && items.some((i) => i.role === "user")) {
      allElements.forEach((el, idx) => {
        if (
          el.tagName === "DIV" &&
          el.classList.contains("gap-y-sm") &&
          el.classList.contains("flex-col") &&
          el.querySelector(".prose") &&
          !el.closest(".group\\/query")
        ) {
          // Only top-level gap-y-sm (skip nested ones)
          if (!el.parentElement?.closest(".gap-y-sm")) {
            items.push({ role: "assistant", el, idx });
          }
        }
      });
    }

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

  turndown.use(gfm);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  turndown.remove(["button", "nav", "style", "script", "svg"] as any);

  // ChatGPT code blocks: <pre> contains deeply nested CodeMirror divs
  // Extract code text from .cm-content and wrap in proper fenced code block
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  turndown.addRule("chatgptCodeBlock", {
    filter: (node: any) => {
      return node.nodeName === "PRE" && node.querySelector(".cm-content");
    },
    replacement: (_content: string, node: any) => {
      // Get language from the header label if available
      const langLabel = node.querySelector('[class*="font-medium"]');
      const lang = langLabel?.textContent?.trim()?.toLowerCase() || "";
      // Get code from cm-content spans
      const cmContent = node.querySelector(".cm-content");
      if (!cmContent) return _content;
      // Extract text preserving line breaks from <br> and span structure
      const lines: string[] = [];
      cmContent.childNodes.forEach((child: Node) => {
        if (child.nodeName === "BR") {
          // ignore, line breaks are handled by spans
        } else {
          lines.push((child as HTMLElement).textContent || "");
        }
      });
      const code = lines.join("\n").trim();
      return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    },
  });

  // Strip ChatGPT table wrapper divs so turndown sees the raw <table>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  turndown.addRule("unwrapTableContainers", {
    filter: (node: any) => {
      return node.nodeName === "DIV" && (
        node.classList?.contains("TyagGW_tableContainer") ||
        node.classList?.contains("TyagGW_tableWrapper")
      );
    },
    replacement: (_content: string, node: any) => {
      const table = node.querySelector("table");
      if (table) return turndown.turndown(table.outerHTML) + "\n\n";
      return _content;
    },
  });

  const turns = extractTurns(doc, source);

  let md = "";

  turns.forEach((turn) => {
    const turnMd = turndown.turndown(turn.el.innerHTML).trim();
    if (!turnMd) return;

    if (turn.role === "user") {
      // For user messages: use turndown but ensure whitespace-pre-wrap newlines are preserved
      // ChatGPT wraps user text in <div class="whitespace-pre-wrap"> where \n are literal
      const clone = turn.el.cloneNode(true) as HTMLElement;
      // Find whitespace-pre-wrap divs and convert their literal \n to <br>
      clone.querySelectorAll('[class*="whitespace-pre-wrap"]').forEach((el) => {
        el.innerHTML = el.innerHTML.replace(/\n/g, "<br>");
      });
      const userMd = turndown.turndown(clone.innerHTML).trim();
      const lines = userMd.split("\n");
      const firstLine = lines[0]?.replace(/^#+\s*/, "").trim() || "";
      const rest = lines.slice(1).join("\n").trim();
      md += `# ${firstLine}\n\n`;
      if (rest) md += `${rest}\n\n`;
      md += `---\n\n`;
    } else {
      // Downshift all headings in AI responses: H1->H2, H2->H3, H3->H4
      const shifted = turnMd
        .replace(/^### /gm, "#### ")
        .replace(/^## /gm, "### ")
        .replace(/^# /gm, "## ");
      md += `${shifted}\n\n---\n\n`;
    }
  });

  return { title, content: md, source };
}

/**
 * Re-parse a chat's stored HTML to regenerate markdown
 */
export function reparseHtml(rawHtml: string): { title: string; content: string; source: Source } | null {
  if (!rawHtml) return null;
  try {
    return convertHtmlToMarkdown(rawHtml);
  } catch {
    return null;
  }
}
