import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { extractHeadings } from "../../lib/parser";
import type { Chat, Tag, TagWithCount, Attachment } from "../../types";

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
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function renderMarkdown(md: string): string {
  let html = md
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/^### (.+)$/gm, (_, t) => `<h3 id="${slugify(t)}">${t}</h3>`)
    .replace(/^## (.+)$/gm, (_, t) => `<h2 id="${slugify(t)}">${t}</h2>`)
    .replace(/^# (.+)$/gm, (_, t) => `<h1 id="${slugify(t)}">${t}</h1>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^---$/gm, "<hr/>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br/>");

  return `<p>${html}</p>`;
}

const sourceStyles: Record<string, { bg: string; text: string; label: string }> = {
  claude: { bg: "bg-nord-12/15", text: "text-nord-12", label: "Claude" },
  perplexity: { bg: "bg-nord-10/15", text: "text-nord-9", label: "Perplexity" },
  chatgpt: { bg: "bg-nord-14/15", text: "text-nord-14", label: "ChatGPT" },
  other: { bg: "bg-nord-3/20", text: "text-nord-4", label: "Other" },
};

export default function ChatDetail({
  chat,
  tags,
  allTags,
  attachments,
  onUpdateChat,
  onClose,
  onAddTag,
  onRemoveTag,
  onCreateTag,
  onAddAttachment,
  onRemoveAttachment,
}: ChatDetailProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(chat.title);
  const [summaryValue, setSummaryValue] = useState(chat.summary || "");
  const [tagSearch, setTagSearch] = useState("");
  const [showTagDropdown, setShowTagDropdown] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEditingTitle(false);
    setTitleValue(chat.title);
    setSummaryValue(chat.summary || "");
    setTagSearch("");
    setShowTagDropdown(false);
  }, [chat.id]);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setShowTagDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const headings = useMemo(() => extractHeadings(chat.content_md), [chat.content_md]);
  const renderedContent = useMemo(() => renderMarkdown(chat.content_md), [chat.content_md]);

  const filteredTags = useMemo(() => {
    const currentTagIds = new Set(tags.map((t) => t.id));
    return allTags.filter(
      (t) => !currentTagIds.has(t.id) && t.name.toLowerCase().includes(tagSearch.toLowerCase())
    );
  }, [allTags, tags, tagSearch]);

  const handleTitleSave = useCallback(() => {
    onUpdateChat(chat.id, { title: titleValue });
    setEditingTitle(false);
  }, [chat.id, titleValue, onUpdateChat]);

  const handleSummarySave = useCallback(() => {
    onUpdateChat(chat.id, { summary: summaryValue });
  }, [chat.id, summaryValue, onUpdateChat]);

  const handleAddTag = useCallback(
    (tag: TagWithCount) => {
      onAddTag(chat.id, tag.id);
      setTagSearch("");
      setShowTagDropdown(false);
    },
    [chat.id, onAddTag]
  );

  const handleCreateNewTag = useCallback(() => {
    onCreateTag(tagSearch);
    setTagSearch("");
    setShowTagDropdown(false);
  }, [tagSearch, onCreateTag]);

  const handleAttachFile = useCallback(async () => {
    const selected = await open({ multiple: false, directory: false });
    if (selected) {
      const filePath = selected as string;
      const filename = filePath.split("/").pop() || filePath;
      const ext = filename.split(".").pop()?.toLowerCase() || "";
      const mimeMap: Record<string, string> = {
        pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        gif: "image/gif", txt: "text/plain", md: "text/markdown", json: "application/json",
        html: "text/html",
      };
      onAddAttachment(chat.id, filename, filePath, mimeMap[ext] || null);
    }
  }, [chat.id, onAddAttachment]);

  const handleOpenAttachment = useCallback(async (att: Attachment) => {
    await shellOpen(att.file_path);
  }, []);

  const scrollToHeading = useCallback((id: string) => {
    const el = contentRef.current?.querySelector(`#${CSS.escape(id)}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const srcStyle = sourceStyles[chat.source] || sourceStyles.other;
  const importDate = new Date(chat.imported_at).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  return (
    <div className="w-[420px] min-w-[420px] h-full bg-[#2a2f3a] flex flex-col overflow-hidden relative animate-slide-in-right noise-bg">
      {/* Left border gradient */}
      <div className="absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-nord-2/60 to-transparent z-10" />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-5 py-3 border-b border-nord-2/30">
        <span className="text-[10px] text-nord-3/60 uppercase tracking-[0.12em] font-medium">Details</span>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-md flex items-center justify-center text-nord-3 hover:text-nord-5 hover:bg-white/[0.05] transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="relative z-10 flex-1 overflow-y-auto">
        {/* Metadata */}
        <div className="px-5 py-4 space-y-4 border-b border-nord-2/30">
          {/* Title */}
          {editingTitle ? (
            <input
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => e.key === "Enter" && handleTitleSave()}
              autoFocus
              className="w-full bg-nord-0/50 border border-nord-8/40 rounded-md px-3 py-1.5 text-[15px] font-display text-nord-6 focus:outline-none"
            />
          ) : (
            <h2
              onClick={() => setEditingTitle(true)}
              className="text-[15px] font-display text-nord-6 cursor-pointer hover:text-nord-8 transition-colors leading-snug"
              title="Click to edit"
            >
              {chat.title}
            </h2>
          )}

          {/* Source + date row */}
          <div className="flex items-center gap-2.5">
            <span className={`text-[10px] font-medium px-[7px] py-[2px] rounded ${srcStyle.bg} ${srcStyle.text} uppercase tracking-wide`}>
              {srcStyle.label}
            </span>
            <span className="text-[11px] text-nord-3/60">{importDate}</span>
            {chat.chat_date && (
              <>
                <span className="text-nord-3/30">&middot;</span>
                <span className="text-[11px] text-nord-3/60">
                  {new Date(chat.chat_date).toLocaleDateString()}
                </span>
              </>
            )}
          </div>

          {/* Summary */}
          <div>
            <label className="text-[10px] text-nord-3/60 uppercase tracking-[0.1em] block mb-1.5 font-medium">
              Summary
            </label>
            <textarea
              value={summaryValue}
              onChange={(e) => setSummaryValue(e.target.value)}
              onBlur={handleSummarySave}
              placeholder="Add a summary..."
              rows={3}
              className="w-full bg-nord-0/30 border border-nord-2/40 rounded-md px-3 py-2 text-[12.5px] text-nord-4 placeholder:text-nord-3/40 focus:outline-none focus:border-nord-8/30 resize-none transition-colors leading-relaxed"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="text-[10px] text-nord-3/60 uppercase tracking-[0.1em] block mb-1.5 font-medium">
              Tags
            </label>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-[5px] text-[11px] px-2 py-[3px] rounded-md bg-nord-0/40 text-nord-4 border border-nord-2/30 group"
                  >
                    <span
                      className="w-[6px] h-[6px] rounded-full flex-shrink-0"
                      style={{ backgroundColor: tag.color || "#88C0D0" }}
                    />
                    {tag.name}
                    <button
                      onClick={() => onRemoveTag(chat.id, tag.id)}
                      className="text-nord-3/50 hover:text-nord-11 transition-colors ml-0.5"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative" ref={tagDropdownRef}>
              <input
                value={tagSearch}
                onChange={(e) => { setTagSearch(e.target.value); setShowTagDropdown(true); }}
                onFocus={() => setShowTagDropdown(true)}
                placeholder="Add tag..."
                className="w-full bg-nord-0/30 border border-nord-2/40 rounded-md px-3 py-[5px] text-[11.5px] text-nord-4 placeholder:text-nord-3/40 focus:outline-none focus:border-nord-8/30 transition-colors"
              />
              {showTagDropdown && tagSearch && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#2f3541] border border-nord-2/60 rounded-lg shadow-xl shadow-black/20 max-h-[140px] overflow-y-auto z-20 animate-fade-in">
                  {filteredTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => handleAddTag(tag)}
                      className="w-full text-left px-3 py-[6px] text-[11.5px] text-nord-4 hover:bg-white/[0.04] hover:text-nord-6 flex items-center gap-2 transition-colors"
                    >
                      <span className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ backgroundColor: tag.color || "#88C0D0" }} />
                      {tag.name}
                    </button>
                  ))}
                  {filteredTags.length === 0 && (
                    <button
                      onClick={handleCreateNewTag}
                      className="w-full text-left px-3 py-[6px] text-[11.5px] text-nord-8 hover:bg-white/[0.04] transition-colors"
                    >
                      Create &ldquo;{tagSearch}&rdquo;
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Attachments */}
          <div>
            <label className="text-[10px] text-nord-3/60 uppercase tracking-[0.1em] block mb-1.5 font-medium">
              Attachments
            </label>
            {attachments.length > 0 && (
              <div className="space-y-1 mb-2">
                {attachments.map((att) => (
                  <div key={att.id} className="flex items-center justify-between text-[11.5px] bg-nord-0/30 border border-nord-2/30 rounded-md px-2.5 py-[5px] group">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <svg className="w-3 h-3 text-nord-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                      </svg>
                      <span className="text-nord-4 truncate">{att.filename}</span>
                    </div>
                    <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                      <button onClick={() => handleOpenAttachment(att)} className="text-nord-8/60 hover:text-nord-8 transition-colors text-[10px]">
                        Open
                      </button>
                      <button onClick={() => onRemoveAttachment(att.id)} className="text-nord-3/40 hover:text-nord-11 transition-colors">
                        &times;
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={handleAttachFile} className="text-[11px] text-nord-8/60 hover:text-nord-8 transition-colors flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Attach file
            </button>
          </div>
        </div>

        {/* Table of contents */}
        {headings.length > 0 && (
          <div className="px-5 py-3 border-b border-nord-2/30">
            <label className="text-[10px] text-nord-3/60 uppercase tracking-[0.1em] block mb-2 font-medium">
              Contents
            </label>
            <div className="space-y-[2px]">
              {headings.map((h, i) => (
                <button
                  key={i}
                  onClick={() => scrollToHeading(h.id)}
                  className="block w-full text-left text-[11.5px] text-nord-9/70 hover:text-nord-8 transition-colors truncate py-[2px] leading-snug"
                  style={{ paddingLeft: `${(h.level - 1) * 14}px` }}
                >
                  {h.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Rendered markdown */}
        <div
          ref={contentRef}
          className="px-5 py-4 md-content font-mono text-[12.5px] text-nord-4 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderedContent }}
        />
      </div>
    </div>
  );
}
