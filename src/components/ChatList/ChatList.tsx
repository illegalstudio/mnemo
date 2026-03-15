import { useState, useMemo, type DragEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { Chat } from "../../types";

interface ChatListProps {
  chats: Chat[];
  selectedChatId: string | null;
  generatingMetadata: Set<string>;
  onSelectChat: (chat: Chat) => void;
  onImport: (files: { name: string; content: string }[]) => void;
  onDeleteChat: (id: string) => void;
}

const sourceStyles: Record<string, { bg: string; text: string; label: string }> = {
  claude: { bg: "bg-nord-12/15", text: "text-nord-12", label: "Claude" },
  perplexity: { bg: "bg-nord-10/15", text: "text-nord-9", label: "Perplexity" },
  chatgpt: { bg: "bg-nord-14/15", text: "text-nord-14", label: "ChatGPT" },
  other: { bg: "bg-nord-3/20", text: "text-nord-4", label: "Other" },
};

function SourceBadge({ source }: { source: string }) {
  const style = sourceStyles[source] || sourceStyles.other;
  return (
    <span className={`inline-flex items-center text-[10px] font-medium px-[7px] py-[2px] rounded ${style.bg} ${style.text} tracking-wide uppercase`}>
      {style.label}
    </span>
  );
}

function ChatCard({
  chat,
  isSelected,
  isGenerating,
  onSelect,
}: {
  chat: Chat;
  isSelected: boolean;
  isGenerating: boolean;
  onSelect: () => void;
}) {
  const importDate = new Date(chat.imported_at);
  const dateStr = importDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-4 py-3 transition-all duration-150 border-b border-nord-2/20 group relative
        ${isSelected
          ? "bg-nord-8/[0.07]"
          : "hover:bg-white/[0.02]"
        }`}
    >
      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute left-0 top-2 bottom-2 w-[2px] bg-nord-8 rounded-r" />
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className={`text-[13px] font-medium leading-snug truncate ${isSelected ? "text-nord-6" : "text-nord-5 group-hover:text-nord-6"} transition-colors`}>
            {chat.title}
          </h3>
          {chat.summary && (
            <p className="text-[11.5px] text-nord-3 mt-[3px] line-clamp-2 leading-relaxed">
              {chat.summary}
            </p>
          )}
          <div className="flex items-center gap-2 mt-[6px]">
            <SourceBadge source={chat.source} />
            <span className="text-[10px] text-nord-3/60 tabular-nums">{dateStr}</span>
            {isGenerating && (
              <span className="text-[10px] text-nord-8/70 animate-pulse-soft flex items-center gap-1">
                <span className="w-1 h-1 bg-nord-8 rounded-full" />
                analyzing...
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

export default function ChatList({
  chats,
  selectedChatId,
  generatingMetadata,
  onSelectChat,
  onImport,
  onDeleteChat: _onDeleteChat,
}: ChatListProps) {
  const [sortBy, setSortBy] = useState<"imported_at" | "chat_date" | "title">("imported_at");
  const [isDragging, setIsDragging] = useState(false);

  const sortedChats = useMemo(() => {
    return [...chats].sort((a, b) => {
      if (sortBy === "title") return a.title.localeCompare(b.title);
      if (sortBy === "chat_date") {
        if (!a.chat_date && !b.chat_date) return 0;
        if (!a.chat_date) return 1;
        if (!b.chat_date) return -1;
        return b.chat_date.localeCompare(a.chat_date);
      }
      return b.imported_at.localeCompare(a.imported_at);
    });
  }, [chats, sortBy]);

  const handleFileOpen = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    const files: { name: string; content: string }[] = [];
    for (const filePath of paths) {
      const content = await readTextFile(filePath);
      const name = filePath.split("/").pop() || filePath.split("\\").pop() || "unknown.md";
      files.push({ name, content });
    }
    onImport(files);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = e.dataTransfer.files;
    const results: { name: string; content: string }[] = [];
    let remaining = 0;
    for (let i = 0; i < droppedFiles.length; i++) {
      const file = droppedFiles[i];
      if (!file.name.endsWith(".md")) continue;
      remaining++;
      const reader = new FileReader();
      reader.onload = () => {
        results.push({ name: file.name, content: reader.result as string });
        remaining--;
        if (remaining === 0) onImport(results);
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-nord-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-nord-2/30 bg-nord-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-nord-3/60 uppercase tracking-[0.1em] mr-1">Sort</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "imported_at" | "chat_date" | "title")}
            className="appearance-none bg-nord-1/50 border border-nord-2/40 rounded-md px-2.5 py-[4px] text-[11px] text-nord-4 focus:outline-none focus:border-nord-8/40 cursor-pointer transition-colors"
          >
            <option value="imported_at">Date Imported</option>
            <option value="chat_date">Chat Date</option>
            <option value="title">Title</option>
          </select>
          <span className="text-[10px] text-nord-3/40 tabular-nums ml-1">{chats.length} chats</span>
        </div>
        <button
          onClick={handleFileOpen}
          className="flex items-center gap-1.5 bg-nord-8/10 hover:bg-nord-8/20 text-nord-8 px-3 py-[5px] rounded-md text-[11px] font-medium transition-all duration-200 hover:shadow-sm hover:shadow-nord-8/5"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Import
        </button>
      </div>

      {/* List or empty state */}
      <div
        className="flex-1 overflow-y-auto"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {chats.length === 0 ? (
          <div className={`flex flex-col items-center justify-center h-full transition-all duration-300 ${isDragging ? "scale-[1.01]" : ""}`}>
            <div className={`flex flex-col items-center p-10 rounded-2xl border-2 border-dashed transition-all duration-300 ${isDragging ? "border-nord-8/40 bg-nord-8/[0.03] scale-105" : "border-nord-2/30"}`}>
              <div className="w-14 h-14 rounded-2xl bg-nord-1/50 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-nord-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <p className="text-[13px] text-nord-4 font-medium mb-1">Drop markdown files here</p>
              <p className="text-[11px] text-nord-3/60">or click Import to browse</p>
            </div>
          </div>
        ) : (
          <div className={`transition-opacity duration-200 ${isDragging ? "opacity-40" : ""}`}>
            {sortedChats.map((chat, i) => (
              <div key={chat.id} className="animate-fade-in" style={{ animationDelay: `${Math.min(i * 20, 200)}ms` }}>
                <ChatCard
                  chat={chat}
                  isSelected={chat.id === selectedChatId}
                  isGenerating={generatingMetadata.has(chat.id)}
                  onSelect={() => onSelectChat(chat)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
