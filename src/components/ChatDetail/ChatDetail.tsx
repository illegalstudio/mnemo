import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Command } from "@tauri-apps/plugin-shell";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { readTextFile } from "@tauri-apps/plugin-fs";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { extractHeadings } from "../../lib/parser";
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
  onDeleteChat: (id: string) => void;
  onRegenerateField: (chatId: string, field: "title" | "summary" | "tags") => Promise<void>;
  onReparseHtml: (chatId: string) => Promise<void>;
  isResizing?: boolean;
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
  onAddTag, onRemoveTag, onCreateTag, onAddAttachment, onRemoveAttachment, onDeleteChat, onRegenerateField, onReparseHtml, isResizing,
}: ChatDetailProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(chat.title);
  const [summaryValue, setSummaryValue] = useState(chat.summary || "");
  const [tagSearch, setTagSearch] = useState("");
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [tagHighlight, setTagHighlight] = useState(-1);
  const [tocWidth, setTocWidth] = useState(200);
  const [regenerating, setRegenerating] = useState<string | null>(null);
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
      const range = document.createRange();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + chatSearchTerm.length);
      const mark = document.createElement("mark");
      mark.className = "search-highlight";
      range.surroundContents(mark);
      markElements.unshift(mark);
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
    const ext = att.filename.split(".").pop()?.toLowerCase();
    if (ext === "html" || ext === "htm") {
      try {
        const html = await readTextFile(att.file_path);
        const webview = new WebviewWindow(`attachment-${att.id}`, {
          title: att.filename,
          width: 900,
          height: 700,
          center: true,
          url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
        });
        webview.once("tauri://error", (e) => {
          console.error("Failed to open attachment window:", e);
        });
      } catch (e) {
        console.error("Failed to read HTML file:", e);
      }
    } else {
      try {
        await Command.create("open", [att.file_path]).execute();
      } catch (e) {
        console.error("Failed to open attachment:", e);
      }
    }
  }, []);

  const scrollToHeading = useCallback((id: string) => {
    contentRef.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const importDate = new Date(chat.imported_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

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
          <button className="close-btn delete-chat-btn" onClick={() => {
            if (window.confirm("Delete this chat and all its data?")) {
              onDeleteChat(chat.id);
            }
          }} title="Delete chat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button className="close-btn" onClick={onClose} title="Close">
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
        <div className="detail-section">
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

        {/* Summary */}
        <div className="detail-section">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="field-label" style={{ marginBottom: 0 }}>Summary</div>
            <button className="regenerate-btn" title="Regenerate summary with AI" disabled={regenerating === "summary"}
              onClick={async () => { setRegenerating("summary"); await onRegenerateField(chat.id, "summary"); setRegenerating(null); }}>
              {regenerating === "summary" ? <span className="regenerate-spinner" /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>}
            </button>
          </div>
          <textarea className="detail-textarea" value={summaryValue} onChange={(e) => setSummaryValue(e.target.value)}
            onBlur={handleSummarySave} placeholder="Add a summary..." rows={3} />
        </div>

        {/* Tags */}
        <div className="detail-section">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="field-label" style={{ marginBottom: 0 }}>Tags</div>
            <button className="regenerate-btn" title="Regenerate tags with AI" disabled={regenerating === "tags"}
              onClick={async () => { setRegenerating("tags"); await onRegenerateField(chat.id, "tags"); setRegenerating(null); }}>
              {regenerating === "tags" ? <span className="regenerate-spinner" /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>}
            </button>
          </div>
          {tags.length > 0 && (
            <div className="tag-list">
              {tags.map((tag) => (
                <span key={tag.id} className="tag-pill">
                  <span className="dot" style={{ backgroundColor: tag.color || "#88C0D0", width: 6, height: 6, borderRadius: "50%", flexShrink: 0 }} />
                  {tag.name}
                  <button className="remove" onClick={() => onRemoveTag(chat.id, tag.id)}>&times;</button>
                </span>
              ))}
            </div>
          )}
          <div style={{ position: "relative" }} ref={tagDropdownRef}>
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
        <div className="detail-section">
          <div className="field-label">Attachments</div>
          {attachments.map((att) => (
            <div key={att.id} className="attachment-row">
              <span className="attachment-name">{att.filename}</span>
              <div className="attachment-actions">
                <button className="open-btn" onClick={() => handleOpenAttachment(att)}>Open</button>
                <button className="remove-btn" onClick={() => onRemoveAttachment(att.id)}>&times;</button>
              </div>
            </div>
          ))}
          <button className="link-btn" onClick={handleAttachFile}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Attach file
          </button>
        </div>

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
    </div>
  );
}
