import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Command } from "@tauri-apps/plugin-shell";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { readTextFile } from "@tauri-apps/plugin-fs";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { extractHeadings } from "../../lib/parser";
import { jsxToHtml } from "../../lib/jsx-preview";
import { resolveAttachmentPath } from "../../lib/attachments";
import type { Chat, Tag, TagWithCount, Attachment } from "../../types";
import mermaid from "mermaid";

mermaid.initialize({ startOnLoad: false, theme: "default" });

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
    mermaid.render(id, code).then(
      ({ svg: renderedSvg }) => { if (!cancelled) setSvg(renderedSvg); },
      (err) => { if (!cancelled) setError(String(err)); }
    );
    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return <pre style={{ color: "var(--red)", fontSize: 12 }}>{error}</pre>;
  }

  return <div ref={ref} className="mermaid-block" dangerouslySetInnerHTML={{ __html: svg }} />;
}

const MAX_H1_LENGTH = 200;

function CollapsibleH1({ children, id }: { children: React.ReactNode; id: string }) {
  const [expanded, setExpanded] = useState(false);
  const text = getTextContent(children);
  const isLong = text.length > MAX_H1_LENGTH;

  if (!isLong) {
    return <h1 id={id}>{children}</h1>;
  }

  return (
    <>
      <h1 id={id}>
        {text.slice(0, MAX_H1_LENGTH)}...
        <button className="expand-msg-btn" onClick={() => setExpanded(true)}>
          Expand
        </button>
      </h1>
      {expanded && (
        <div className="expand-modal-overlay" onClick={() => setExpanded(false)}>
          <div className="expand-modal" onClick={(e) => e.stopPropagation()}>
            <div className="expand-modal-header">
              <span>Full message</span>
              <button className="close-btn" onClick={() => setExpanded(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="expand-modal-body">{text}</div>
          </div>
        </div>
      )}
    </>
  );
}

const MemoizedMarkdown = memo(function MemoizedMarkdown({ content, contentRef }: { content: string; contentRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={{
        h1: ({ children }) => <CollapsibleH1 id={slugify(getTextContent(children))}>{children}</CollapsibleH1>,
        h2: ({ children, ...props }) => <h2 id={slugify(getTextContent(children))} {...props}>{children}</h2>,
        h3: ({ children, ...props }) => <h3 id={slugify(getTextContent(children))} {...props}>{children}</h3>,
        a: ({ children, href, ...props }) => {
          if (href?.startsWith("#")) {
            return <a {...props} href={href} onClick={(e) => {
              e.preventDefault();
              const id = href!.slice(1);
              contentRef.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}>{children}</a>;
          }
          return <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
        },
        code: ({ className, children, ...props }) => {
          const match = /language-(\w+)/.exec(className || "");
          if (match && match[1] === "mermaid") {
            return <MermaidBlock code={String(children).trim()} />;
          }
          return <code className={className} {...props}>{children}</code>;
        },
        pre: ({ children, ...props }) => {
          // Check if the child is a mermaid code block — if so, render without <pre> wrapper
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const child = children as any;
          if (child?.props?.className?.includes("language-mermaid")) {
            return <>{children}</>;
          }
          return <pre {...props}>{children}</pre>;
        },
      }}
    >
      {content}
    </Markdown>
  );
});

interface ChatDetailProps {
  chat: Chat;
  tags: Tag[];
  allTags: TagWithCount[];
  attachments: Attachment[];
  onUpdateChat: (id: string, updates: Partial<Chat>) => void;
  onClose: () => void;
  onAddTag: (chatId: string, tagId: string) => void;
  onRemoveTag: (chatId: string, tagId: string) => void;
  onCreateTag: (name: string) => Promise<void> | void;
  onAddAttachment: (chatId: string, filename: string, filePath: string, mimeType: string | null) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onRegenerateField: (chatId: string, field: "title" | "summary" | "tags") => Promise<void>;
  onReparseHtml: (chatId: string) => Promise<void>;
  isResizing?: boolean;
  focusMode?: boolean;
  onToggleFocus?: () => void;
}

function getTextContent(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(getTextContent).join("");
  if (typeof node === "object" && node !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = node as any;
    if (el.props?.children) return getTextContent(el.props.children);
  }
  return "";
}

function slugify(text: string): string {
  // Truncate to match parser's heading extraction (200 char limit)
  const truncated = text.length > 200 ? text.slice(0, 200) : text;
  return truncated
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\ufe0f]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const sourceLabels: Record<string, string> = { claude: "Claude", perplexity: "Perplexity", chatgpt: "ChatGPT", other: "Other" };

export default function ChatDetail({
  chat, tags, allTags, attachments, onUpdateChat, onClose,
  onAddTag, onRemoveTag, onCreateTag, onAddAttachment, onRemoveAttachment, onRegenerateField, onReparseHtml, isResizing, focusMode, onToggleFocus,
}: ChatDetailProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(chat.title);
  const [summaryValue, setSummaryValue] = useState(chat.summary || "");
  const [tagSearch, setTagSearch] = useState("");
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [tagHighlight, setTagHighlight] = useState(-1);
  const [tocWidth, setTocWidth] = useState(200);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [metaCollapsed, setMetaCollapsed] = useState(false);
  const [confirmRemoveAtt, setConfirmRemoveAtt] = useState<string | null>(null);
  const [mdPreview, setMdPreview] = useState<{ filename: string; content: string } | null>(null);
  const [imgPreview, setImgPreview] = useState<{ filename: string; path: string } | null>(null);
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [chatSearchTerm, setChatSearchTerm] = useState("");
  const [chatSearchIndex, setChatSearchIndex] = useState(0);
  const chatSearchRef = useRef<HTMLInputElement>(null);
  const [tocResizing, setTocResizing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const tocDragging = useRef(false);

  useEffect(() => {
    setEditingTitle(false);
    setTitleValue(chat.title);
    setSummaryValue(chat.summary || "");
    setTagSearch("");
    setShowTagDropdown(false);
    setShowChatSearch(false);
    setChatSearchTerm("");
  }, [chat.id]);

  // Sync local state when chat data changes externally (e.g. after analysis)
  useEffect(() => {
    if (!editingTitle) setTitleValue(chat.title);
  }, [chat.title]);

  useEffect(() => {
    setSummaryValue(chat.summary || "");
  }, [chat.summary]);

  // Cmd+F to open in-chat search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f" && !e.shiftKey) {
        e.preventDefault();
        setShowChatSearch(true);
        setTimeout(() => chatSearchRef.current?.focus(), 50);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Highlight search matches in content
  useEffect(() => {
    if (!contentRef.current) return;
    // Clear previous marks
    contentRef.current.querySelectorAll("mark.search-highlight").forEach((m) => {
      const parent = m.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(m.textContent || ""), m);
        parent.normalize();
      }
    });
    if (!chatSearchTerm || chatSearchTerm.length < 2) return;

    const walker = document.createTreeWalker(contentRef.current, NodeFilter.SHOW_TEXT);
    const matches: { node: Text; index: number }[] = [];
    const term = chatSearchTerm.toLowerCase();

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const text = node.textContent || "";
      let idx = text.toLowerCase().indexOf(term);
      while (idx !== -1) {
        matches.push({ node, index: idx });
        idx = text.toLowerCase().indexOf(term, idx + 1);
      }
    }

    // Wrap matches with <mark> (process in reverse to keep indices valid)
    const markElements: HTMLElement[] = [];
    for (let i = matches.length - 1; i >= 0; i--) {
      const { node: textNode, index } = matches[i];
      try {
        const range = document.createRange();
        range.setStart(textNode, index);
        range.setEnd(textNode, index + chatSearchTerm.length);
        const mark = document.createElement("mark");
        mark.className = "search-highlight";
        mark.appendChild(range.extractContents());
        range.insertNode(mark);
        markElements.unshift(mark);
      } catch {
        // Skip if range spans across element boundaries
      }
    }

    // Scroll to current match
    if (markElements.length > 0) {
      const clampedIndex = Math.max(0, Math.min(chatSearchIndex, markElements.length - 1));
      markElements.forEach((m, i) => {
        m.classList.toggle("active", i === clampedIndex);
      });
      markElements[clampedIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [chatSearchTerm, chatSearchIndex]);

  const chatSearchMatchCount = useMemo(() => {
    if (!chatSearchTerm || chatSearchTerm.length < 2) return 0;
    const text = chat.content_md.toLowerCase();
    const term = chatSearchTerm.toLowerCase();
    let count = 0;
    let idx = text.indexOf(term);
    while (idx !== -1) {
      count++;
      idx = text.indexOf(term, idx + 1);
    }
    return count;
  }, [chat.content_md, chatSearchTerm]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) setShowTagDropdown(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const headings = useMemo(() => extractHeadings(chat.content_md), [chat.content_md]);
  const filteredTags = useMemo(() => {
    const ids = new Set(tags.map((t) => t.id));
    return allTags.filter((t) => !ids.has(t.id) && t.name.toLowerCase().includes(tagSearch.toLowerCase()));
  }, [allTags, tags, tagSearch]);

  const handleTitleSave = useCallback(() => { onUpdateChat(chat.id, { title: titleValue }); setEditingTitle(false); }, [chat.id, titleValue, onUpdateChat]);
  const handleSummarySave = useCallback(() => { onUpdateChat(chat.id, { summary: summaryValue }); }, [chat.id, summaryValue, onUpdateChat]);

  const handleAttachFile = useCallback(async () => {
    const selected = await open({ multiple: false, directory: false });
    if (selected) {
      const filePath = selected as string;
      const filename = filePath.split("/").pop() || filePath;
      const ext = filename.split(".").pop()?.toLowerCase() || "";
      const mimeMap: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", html: "text/html", txt: "text/plain" };
      onAddAttachment(chat.id, filename, filePath, mimeMap[ext] || null);
    }
  }, [chat.id, onAddAttachment]);

  const handleOpenAttachment = useCallback(async (att: Attachment) => {
    const resolved = await resolveAttachmentPath(att.file_path);
    const ext = att.filename.split(".").pop()?.toLowerCase();
    const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"];
    if (ext && imageExts.includes(ext)) {
      try {
        const { readFile } = await import("@tauri-apps/plugin-fs");
        const bytes = await readFile(resolved);
        const blob = new Blob([bytes], { type: att.mime_type || `image/${ext}` });
        const dataUrl = URL.createObjectURL(blob);
        setImgPreview({ filename: att.filename, path: dataUrl });
      } catch (e) {
        console.error("Failed to read image:", e);
      }
      return;
    }
    if (ext === "md" || ext === "markdown") {
      try {
        const content = await readTextFile(resolved);
        setMdPreview({ filename: att.filename, content });
      } catch (e) {
        console.error("Failed to read markdown file:", e);
      }
      return;
    }
    if (ext === "jsx" || ext === "tsx") {
      try {
        const source = await readTextFile(resolved);
        const html = jsxToHtml(source, att.filename);
        const webview = new WebviewWindow(`attachment-${att.id}`, {
          title: att.filename,
          width: 900,
          height: 700,
          center: true,
          url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
        });
        webview.once("tauri://error", (e) => {
          console.error("Failed to open JSX preview:", e);
        });
      } catch (e) {
        console.error("Failed to read JSX file:", e);
      }
      return;
    }
    if (ext === "html" || ext === "htm") {
      try {
        let url: string;
        if (att.file_path.startsWith("data:")) {
          url = att.file_path;
        } else {
          const html = await readTextFile(resolved);
          url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
        }
        const webview = new WebviewWindow(`attachment-${att.id}`, {
          title: att.filename,
          width: 900,
          height: 700,
          center: true,
          url,
        });
        webview.once("tauri://error", (e) => {
          console.error("Failed to open attachment window:", e);
        });
      } catch (e) {
        console.error("Failed to read HTML file:", e);
      }
    } else {
      try {
        await Command.create("open", [resolved]).execute();
      } catch (e) {
        console.error("Failed to open attachment:", e);
      }
    }
  }, []);

  const scrollToHeading = useCallback((id: string) => {
    contentRef.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const importDate = new Date(chat.imported_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  if (focusMode) {
    return (
      <div className="focus-mode">
        <button className="focus-close-btn" onClick={onToggleFocus} title="Exit focus (Esc)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="focus-content">
          <div ref={contentRef} className="md-content">
            <MemoizedMarkdown content={chat.content_md} contentRef={contentRef} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <span className="detail-header-label">Details</span>
        <div style={{ display: "flex", gap: 4 }}>
          {chat.content_html && (
            <button className="close-btn" onClick={async () => {
              await onReparseHtml(chat.id);
            }} title="Re-parse from original HTML">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l-.008-.006" />
              </svg>
            </button>
          )}
          {onToggleFocus && (
            <button className="close-btn" onClick={onToggleFocus} title={focusMode ? "Exit focus" : "Focus mode"}>
              {focusMode ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                </svg>
              )}
            </button>
          )}
          <button className="close-btn" onClick={focusMode ? onToggleFocus : onClose} title={focusMode ? "Exit focus" : "Close"}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {showChatSearch && (
        <div className="chat-search-bar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, color: "var(--text-faint)" }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            ref={chatSearchRef}
            value={chatSearchTerm}
            onChange={(e) => { setChatSearchTerm(e.target.value); setChatSearchIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (e.shiftKey) {
                  setChatSearchIndex((i) => Math.max(0, i - 1));
                } else {
                  setChatSearchIndex((i) => Math.min(chatSearchMatchCount - 1, i + 1));
                }
              } else if (e.key === "Escape") {
                setShowChatSearch(false);
                setChatSearchTerm("");
              }
            }}
            placeholder="Search in chat..."
            autoComplete="off" autoCorrect="off" spellCheck={false}
          />
          {chatSearchTerm.length >= 2 && (
            <span className="chat-search-count">
              {chatSearchMatchCount > 0 ? `${chatSearchIndex + 1}/${chatSearchMatchCount}` : "0"}
            </span>
          )}
          <button className="close-btn" onClick={() => { setShowChatSearch(false); setChatSearchTerm(""); }} style={{ width: 20, height: 20 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="detail-scroll">
        {/* Metadata */}
        <div className="detail-section" style={{ borderBottom: "none", paddingBottom: 0 }}>
          {editingTitle ? (
            <input className="detail-title-input" value={titleValue} onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleTitleSave} onKeyDown={(e) => e.key === "Enter" && handleTitleSave()} autoFocus />
          ) : (
            <div style={{ display: "flex", alignItems: "start", gap: 6 }}>
              <div className="detail-title" style={{ flex: 1 }} onClick={() => setEditingTitle(true)}>{chat.title}</div>
              <button className="regenerate-btn" title="Regenerate title with AI" disabled={regenerating === "title"}
                onClick={async () => { setRegenerating("title"); await onRegenerateField(chat.id, "title"); setRegenerating(null); }}>
                {regenerating === "title" ? <span className="regenerate-spinner" /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>}
              </button>
            </div>
          )}
          <div className="detail-meta">
            <span className={`source-badge ${chat.source}`}>{sourceLabels[chat.source] || chat.source}</span>
            <span className="detail-date">{importDate}</span>
          </div>
        </div>

        {/* Collapsible metadata: Summary + Tags + Attachments */}
        <div className="detail-meta-toggle" onClick={() => setMetaCollapsed(c => !c)}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2.5"
            style={{ transform: metaCollapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s", flexShrink: 0 }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          <span className="detail-meta-toggle-label">Details</span>
          {metaCollapsed && tags.length > 0 && (
            <span className="detail-meta-toggle-tags">{tags.map(t => t.name).join(", ")}</span>
          )}
          {!metaCollapsed && <span className="detail-meta-toggle-line" />}
        </div>

        {!metaCollapsed && <>
        {/* Summary + Tags */}
        <div className="detail-section" style={{ borderBottom: "none" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="field-label" style={{ marginBottom: 0 }}>Summary</div>
            <div style={{ display: "flex", gap: 4 }}>
              <button className="regenerate-btn" title="Regenerate summary with AI" disabled={regenerating === "summary"}
                onClick={async () => { setRegenerating("summary"); await onRegenerateField(chat.id, "summary"); setRegenerating(null); }}>
                {regenerating === "summary" ? <span className="regenerate-spinner" /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>}
              </button>
              <button className="regenerate-btn" title="Regenerate tags with AI" disabled={regenerating === "tags"}
                onClick={async () => { setRegenerating("tags"); await onRegenerateField(chat.id, "tags"); setRegenerating(null); }}>
                {regenerating === "tags" ? <span className="regenerate-spinner" /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" /><path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" /></svg>}
              </button>
            </div>
          </div>
          <textarea className="detail-textarea" value={summaryValue} onChange={(e) => setSummaryValue(e.target.value)}
            onBlur={handleSummarySave} placeholder="Add a summary..." rows={3} />
          <div className="tag-list">
            {tags.map((tag) => (
              <span key={tag.id} className="tag-pill">
                <span className="dot" style={{ backgroundColor: tag.color || "#88C0D0", width: 6, height: 6, borderRadius: "50%", flexShrink: 0 }} />
                {tag.name}
                <button className="remove" onClick={() => onRemoveTag(chat.id, tag.id)}>&times;</button>
              </span>
            ))}
            <div style={{ position: "relative", flex: "1 1 80px", minWidth: 80 }} ref={tagDropdownRef}>
              <input className="tag-input" value={tagSearch}
              name="mnemo-tag-search" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} data-form-type="other" data-1p-ignore
              onChange={(e) => { setTagSearch(e.target.value); setShowTagDropdown(true); setTagHighlight(-1); }}
              onFocus={() => { setShowTagDropdown(true); setTagHighlight(-1); }}
              placeholder="Add tag..."
              onKeyDown={(e) => {
                if (!showTagDropdown || !tagSearch.trim()) return;
                const totalItems = filteredTags.length + (filteredTags.length === 0 ? 1 : 0);
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setTagHighlight((prev) => (prev + 1) % totalItems);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setTagHighlight((prev) => (prev - 1 + totalItems) % totalItems);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (tagHighlight >= 0 && tagHighlight < filteredTags.length) {
                    onAddTag(chat.id, filteredTags[tagHighlight].id);
                  } else {
                    const exact = filteredTags.find((t) => t.name.toLowerCase() === tagSearch.trim().toLowerCase());
                    if (exact) {
                      onAddTag(chat.id, exact.id);
                    } else {
                      onCreateTag(tagSearch.trim());
                    }
                  }
                  setTagSearch(""); setShowTagDropdown(false); setTagHighlight(-1);
                } else if (e.key === "Escape") {
                  setShowTagDropdown(false); setTagHighlight(-1);
                }
              }} />
            {showTagDropdown && tagSearch && (
              <div className="tag-dropdown">
                {filteredTags.map((tag, i) => (
                  <button key={tag.id}
                    className={tagHighlight === i ? "highlighted" : ""}
                    onClick={() => { onAddTag(chat.id, tag.id); setTagSearch(""); setShowTagDropdown(false); setTagHighlight(-1); }}
                    onMouseEnter={() => setTagHighlight(i)}>
                    <span className="dot" style={{ backgroundColor: tag.color || "#88C0D0", width: 6, height: 6, borderRadius: "50%" }} />
                    {tag.name}
                  </button>
                ))}
                {filteredTags.length === 0 && (
                  <button
                    className={`create ${tagHighlight === 0 ? "highlighted" : ""}`}
                    onClick={() => { onCreateTag(tagSearch); setTagSearch(""); setShowTagDropdown(false); setTagHighlight(-1); }}
                    onMouseEnter={() => setTagHighlight(0)}>
                    Create "{tagSearch}"
                  </button>
                )}
              </div>
            )}
            </div>
          </div>

          {/* Attachments */}
          <div className="attachment-list">
            {attachments.map((att) => {
              const ext = att.filename.split(".").pop()?.toLowerCase() || "";
              const previewable = ["png","jpg","jpeg","gif","webp","svg","bmp","ico","md","markdown","jsx","tsx","html","htm"].includes(ext) || att.file_path.startsWith("data:");
              return (
              <span key={att.id} className="attachment-chip">
                <span className="attachment-name" onClick={previewable ? () => handleOpenAttachment(att) : undefined} style={previewable ? { cursor: "pointer" } : undefined}>{att.filename}</span>
                <span className="attachment-chip-actions">
                  {previewable && <button className="open-btn" onClick={() => handleOpenAttachment(att)} title="Open">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  </button>}
                  <button className="open-btn" title="Download" onClick={async () => {
                    const ext = att.filename.split(".").pop() || "";
                    const dest = await import("@tauri-apps/plugin-dialog").then(d => d.save({ defaultPath: att.filename, filters: [{ name: "File", extensions: [ext] }] }));
                    if (dest) {
                      const resolved = await resolveAttachmentPath(att.file_path);
                      const { copyFile } = await import("@tauri-apps/plugin-fs");
                      await copyFile(resolved, dest);
                    }
                  }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                  </button>
                  {confirmRemoveAtt === att.id ? (<>
                    <button className="remove-btn" style={{ color: "var(--red)" }} onClick={() => { onRemoveAttachment(att.id); setConfirmRemoveAtt(null); }} title="Confirm">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    </button>
                    <button className="remove-btn" onClick={() => setConfirmRemoveAtt(null)} title="Cancel">&times;</button>
                  </>) : (
                    <button className="remove-btn" onClick={() => setConfirmRemoveAtt(att.id)} title="Remove">&times;</button>
                  )}
                </span>
              </span>
              );
            })}
            <button className="link-btn" onClick={handleAttachFile}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Attach
            </button>
          </div>
        </div>
        </>}

        {/* Content area: markdown + optional TOC sidebar */}
        <div className="detail-content-area">
          {headings.length > 0 && (
            <>
              <aside className="detail-toc" style={{ "--toc-width": `${tocWidth}px` } as React.CSSProperties}>
                <div className="field-label">Contents</div>
                {headings.map((h, i) => (
                  <button key={i} className="toc-item" onClick={() => scrollToHeading(h.id)} style={{ paddingLeft: (h.level - 1) * 14 }}>
                    {h.text}
                  </button>
                ))}
              </aside>
              <div className="detail-toc-handle" onMouseDown={(e) => {
                e.preventDefault();
                tocDragging.current = true;
                setTocResizing(true);
                const startX = e.clientX;
                const startWidth = tocWidth;
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
                const onMove = (ev: MouseEvent) => {
                  if (!tocDragging.current) return;
                  const delta = startX - ev.clientX;
                  setTocWidth(Math.max(140, Math.min(400, startWidth + delta)));
                };
                const onUp = () => {
                  tocDragging.current = false;
                  setTocResizing(false);
                  document.body.style.cursor = "";
                  document.body.style.userSelect = "";
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }} />
            </>
          )}
          <div ref={contentRef} className="md-content detail-content-main">
            {isResizing || tocResizing ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8, color: "var(--text-faint)" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
                </svg>
                <span style={{ fontSize: 12 }}>Adjusting layout...</span>
              </div>
            ) : (
              <MemoizedMarkdown content={chat.content_md} contentRef={contentRef} />
            )}
          </div>
        </div>
      </div>

      {/* Markdown preview modal */}
      {mdPreview && (
        <div className="expand-modal-overlay" onClick={() => setMdPreview(null)}>
          <div className="md-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="expand-modal-header">
              <span>{mdPreview.filename}</span>
              <button className="close-btn" onClick={() => setMdPreview(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="md-preview-body md-content">
              <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                {mdPreview.content}
              </Markdown>
            </div>
          </div>
        </div>
      )}

      {/* Image preview modal */}
      {imgPreview && (
        <div className="expand-modal-overlay" onClick={() => setImgPreview(null)}>
          <div className="img-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="expand-modal-header">
              <span>{imgPreview.filename}</span>
              <button className="close-btn" onClick={() => setImgPreview(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="img-preview-body">
              <img src={imgPreview.path} alt={imgPreview.filename} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
