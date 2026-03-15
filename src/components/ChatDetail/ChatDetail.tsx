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
  onAddAttachment: (
    chatId: string,
    filename: string,
    filePath: string,
    mimeType: string | null
  ) => void;
  onRemoveAttachment: (attachmentId: string) => void;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function renderMarkdown(md: string): string {
  let html = md
    // Code blocks first (to protect their content)
    .replace(
      /```(\w*)\n([\s\S]*?)```/g,
      '<pre class="bg-nord-0 rounded p-3 my-2 overflow-x-auto text-sm"><code>$2</code></pre>'
    )
    // Headings
    .replace(
      /^### (.+)$/gm,
      (_, t) =>
        `<h3 id="${slugify(t)}" class="text-base font-semibold text-nord-8 mt-4 mb-1">${t}</h3>`
    )
    .replace(
      /^## (.+)$/gm,
      (_, t) =>
        `<h2 id="${slugify(t)}" class="text-lg font-semibold text-nord-7 mt-5 mb-2">${t}</h2>`
    )
    .replace(
      /^# (.+)$/gm,
      (_, t) =>
        `<h1 id="${slugify(t)}" class="text-xl font-bold text-nord-6 mt-6 mb-2">${t}</h1>`
    )
    // Bold and italic
    .replace(
      /\*\*(.+?)\*\*/g,
      '<strong class="text-nord-6 font-semibold">$1</strong>'
    )
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Inline code
    .replace(
      /`([^`]+)`/g,
      '<code class="bg-nord-1 px-1 py-0.5 rounded text-sm text-nord-8">$1</code>'
    )
    // Links
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" class="text-nord-8 hover:text-nord-7 underline" target="_blank" rel="noopener">$1</a>'
    )
    // Line breaks to paragraphs
    .replace(/\n\n/g, '</p><p class="my-2 leading-relaxed">')
    // Single line breaks
    .replace(/\n/g, "<br/>");

  return `<p class="my-2 leading-relaxed">${html}</p>`;
}

function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    claude: "bg-nord-12 text-nord-0",
    perplexity: "bg-nord-10 text-nord-6",
    chatgpt: "bg-nord-14 text-nord-0",
    other: "bg-nord-3 text-nord-6",
  };
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${colors[source] || colors.other}`}
    >
      {source}
    </span>
  );
}

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

  // Reset local state when chat changes
  useEffect(() => {
    setEditingTitle(false);
    setTitleValue(chat.title);
    setSummaryValue(chat.summary || "");
    setTagSearch("");
    setShowTagDropdown(false);
  }, [chat.id]);

  // Close tag dropdown when clicking outside
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (
        tagDropdownRef.current &&
        !tagDropdownRef.current.contains(e.target as Node)
      ) {
        setShowTagDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const headings = useMemo(
    () => extractHeadings(chat.content_md),
    [chat.content_md]
  );

  const renderedContent = useMemo(
    () => renderMarkdown(chat.content_md),
    [chat.content_md]
  );

  const filteredTags = useMemo(() => {
    const currentTagIds = new Set(tags.map((t) => t.id));
    return allTags.filter(
      (t) =>
        !currentTagIds.has(t.id) &&
        t.name.toLowerCase().includes(tagSearch.toLowerCase())
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
    const selected = await open({
      multiple: false,
      directory: false,
    });
    if (selected) {
      const filePath = selected as string;
      const filename = filePath.split("/").pop() || filePath;
      const ext = filename.split(".").pop()?.toLowerCase() || "";
      const mimeMap: Record<string, string> = {
        pdf: "application/pdf",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        txt: "text/plain",
        md: "text/markdown",
        json: "application/json",
      };
      const mimeType = mimeMap[ext] || null;
      onAddAttachment(chat.id, filename, filePath, mimeType);
    }
  }, [chat.id, onAddAttachment]);

  const handleOpenAttachment = useCallback(async (att: Attachment) => {
    await shellOpen(att.file_path);
  }, []);

  const scrollToHeading = useCallback((id: string) => {
    const el = contentRef.current?.querySelector(`#${CSS.escape(id)}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div className="w-[400px] min-w-[400px] h-full bg-nord-1 border-l border-nord-2 flex flex-col overflow-hidden">
      {/* Header with close button */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-nord-2">
        <span className="text-xs text-nord-3">Chat Details</span>
        <button
          onClick={onClose}
          className="text-nord-3 hover:text-nord-6 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Metadata section */}
        <div className="p-4 border-b border-nord-2 space-y-3">
          {/* Title - editable */}
          {editingTitle ? (
            <input
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => e.key === "Enter" && handleTitleSave()}
              autoFocus
              className="w-full bg-nord-0 border border-nord-8 rounded px-2 py-1 text-sm text-nord-6 focus:outline-none"
            />
          ) : (
            <h2
              onClick={() => setEditingTitle(true)}
              className="text-base font-semibold text-nord-6 cursor-pointer hover:text-nord-8 transition-colors"
            >
              {chat.title}
            </h2>
          )}

          {/* Source + Date */}
          <div className="flex items-center gap-2 text-xs text-nord-3">
            <SourceBadge source={chat.source} />
            <span>
              {new Date(chat.imported_at).toLocaleDateString()}
            </span>
            {chat.chat_date && (
              <span>
                &middot; {new Date(chat.chat_date).toLocaleDateString()}
              </span>
            )}
          </div>

          {/* Summary - editable textarea */}
          <div>
            <label className="text-xs text-nord-3 block mb-1">Summary</label>
            <textarea
              value={summaryValue}
              onChange={(e) => setSummaryValue(e.target.value)}
              onBlur={handleSummarySave}
              placeholder="Add a summary..."
              rows={3}
              className="w-full bg-nord-0 border border-nord-3 rounded px-2 py-1.5 text-sm text-nord-4 placeholder-nord-3 focus:outline-none focus:border-nord-8 resize-none transition-colors"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="text-xs text-nord-3 block mb-1">Tags</label>
            <div className="flex flex-wrap gap-1 mb-2">
              {tags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-nord-2 text-nord-4"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: tag.color || "#88C0D0" }}
                  />
                  {tag.name}
                  <button
                    onClick={() => onRemoveTag(chat.id, tag.id)}
                    className="text-nord-3 hover:text-nord-11 ml-0.5"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
            {/* Tag autocomplete input */}
            <div className="relative" ref={tagDropdownRef}>
              <input
                value={tagSearch}
                onChange={(e) => {
                  setTagSearch(e.target.value);
                  setShowTagDropdown(true);
                }}
                onFocus={() => setShowTagDropdown(true)}
                placeholder="Add tag..."
                className="w-full bg-nord-0 border border-nord-3 rounded px-2 py-1 text-xs text-nord-4 placeholder-nord-3 focus:outline-none focus:border-nord-8 transition-colors"
              />
              {showTagDropdown && tagSearch && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-nord-2 border border-nord-3 rounded shadow-lg max-h-32 overflow-y-auto z-10">
                  {filteredTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => handleAddTag(tag)}
                      className="w-full text-left px-2 py-1 text-xs text-nord-4 hover:bg-nord-1 hover:text-nord-6 flex items-center gap-1.5"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: tag.color || "#88C0D0" }}
                      />
                      {tag.name}
                    </button>
                  ))}
                  {filteredTags.length === 0 && (
                    <button
                      onClick={handleCreateNewTag}
                      className="w-full text-left px-2 py-1 text-xs text-nord-8 hover:bg-nord-1"
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
            <label className="text-xs text-nord-3 block mb-1">
              Attachments
            </label>
            <div className="space-y-1">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center justify-between text-xs bg-nord-0 rounded px-2 py-1"
                >
                  <span className="text-nord-4 truncate flex-1">
                    {att.filename}
                  </span>
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      onClick={() => handleOpenAttachment(att)}
                      className="text-nord-8 hover:text-nord-7"
                    >
                      Open
                    </button>
                    <button
                      onClick={() => onRemoveAttachment(att.id)}
                      className="text-nord-3 hover:text-nord-11"
                    >
                      &times;
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={handleAttachFile}
              className="text-xs text-nord-8 hover:text-nord-7 mt-1 transition-colors"
            >
              + Attach file
            </button>
          </div>
        </div>

        {/* Table of contents */}
        {headings.length > 0 && (
          <div className="p-4 border-b border-nord-2">
            <label className="text-xs text-nord-3 block mb-1">Contents</label>
            <div className="space-y-0.5">
              {headings.map((h, i) => (
                <button
                  key={i}
                  onClick={() => scrollToHeading(h.id)}
                  className="block text-xs text-nord-9 hover:text-nord-8 transition-colors truncate"
                  style={{ paddingLeft: `${(h.level - 1) * 12}px` }}
                >
                  {h.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Markdown content */}
        <div
          ref={contentRef}
          className="p-4 prose-sm font-mono text-sm text-nord-4 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderedContent }}
        />
      </div>
    </div>
  );
}
