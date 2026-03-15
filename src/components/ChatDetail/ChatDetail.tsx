import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { extractHeadings } from "../../lib/parser";
import type { Chat, Tag, TagWithCount, Attachment } from "../../types";

const MemoizedMarkdown = memo(function MemoizedMarkdown({ content, contentRef }: { content: string; contentRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={{
        h1: ({ children, ...props }) => <h1 id={slugify(String(children))} {...props}>{children}</h1>,
        h2: ({ children, ...props }) => <h2 id={slugify(String(children))} {...props}>{children}</h2>,
        h3: ({ children, ...props }) => <h3 id={slugify(String(children))} {...props}>{children}</h3>,
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
  isResizing?: boolean;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const sourceLabels: Record<string, string> = { claude: "Claude", perplexity: "Perplexity", chatgpt: "ChatGPT", other: "Other" };

export default function ChatDetail({
  chat, tags, allTags, attachments, onUpdateChat, onClose,
  onAddTag, onRemoveTag, onCreateTag, onAddAttachment, onRemoveAttachment, isResizing,
}: ChatDetailProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(chat.title);
  const [summaryValue, setSummaryValue] = useState(chat.summary || "");
  const [tagSearch, setTagSearch] = useState("");
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [tagHighlight, setTagHighlight] = useState(-1);
  const [tocWidth, setTocWidth] = useState(200);
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
  }, [chat.id]);

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

  const scrollToHeading = useCallback((id: string) => {
    contentRef.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const importDate = new Date(chat.imported_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <span className="detail-header-label">Details</span>
        <button className="close-btn" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="detail-scroll">
        {/* Metadata */}
        <div className="detail-section">
          {editingTitle ? (
            <input className="detail-title-input" value={titleValue} onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleTitleSave} onKeyDown={(e) => e.key === "Enter" && handleTitleSave()} autoFocus />
          ) : (
            <div className="detail-title" onClick={() => setEditingTitle(true)}>{chat.title}</div>
          )}
          <div className="detail-meta">
            <span className={`source-badge ${chat.source}`}>{sourceLabels[chat.source] || chat.source}</span>
            <span className="detail-date">{importDate}</span>
          </div>
        </div>

        {/* Summary */}
        <div className="detail-section">
          <div className="field-label">Summary</div>
          <textarea className="detail-textarea" value={summaryValue} onChange={(e) => setSummaryValue(e.target.value)}
            onBlur={handleSummarySave} placeholder="Add a summary..." rows={3} />
        </div>

        {/* Tags */}
        <div className="detail-section">
          <div className="field-label">Tags</div>
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
                <button className="open-btn" onClick={() => shellOpen(att.file_path)}>Open</button>
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
              <div style={{ padding: 20, color: "var(--text-faint)", fontSize: 13 }}>Resizing...</div>
            ) : (
              <MemoizedMarkdown content={chat.content_md} contentRef={contentRef} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
