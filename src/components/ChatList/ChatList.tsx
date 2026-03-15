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

function ChatCard({
  chat,
  isSelected,
  isGenerating,
  onSelect,
  onDelete: _onDelete,
}: {
  chat: Chat;
  isSelected: boolean;
  isGenerating: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`px-4 py-3 border-b border-nord-2/50 cursor-pointer transition-colors
        ${isSelected ? "bg-nord-2" : "hover:bg-nord-1/50"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-sm text-nord-6 truncate flex-1">
          {chat.title}
        </h3>
        <SourceBadge source={chat.source} />
      </div>
      {chat.summary && (
        <p className="text-xs text-nord-3 mt-1 truncate">{chat.summary}</p>
      )}
      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-xs text-nord-3">
          {new Date(chat.imported_at).toLocaleDateString()}
        </span>
        {isGenerating && (
          <span className="text-xs text-nord-8 animate-pulse">
            generating metadata...
          </span>
        )}
      </div>
    </div>
  );
}

export default function ChatList({
  chats,
  selectedChatId,
  generatingMetadata,
  onSelectChat,
  onImport,
  onDeleteChat,
}: ChatListProps) {
  const [sortBy, setSortBy] = useState<"imported_at" | "chat_date" | "title">(
    "imported_at",
  );
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
      const name =
        filePath.split("/").pop() ||
        filePath.split("\\").pop() ||
        "unknown.md";
      files.push({ name, content });
    }
    onImport(files);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

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
        if (remaining === 0) {
          onImport(results);
        }
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-nord-0">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-nord-2 bg-nord-1/50">
        <div className="flex items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as "imported_at" | "chat_date" | "title")
            }
            className="bg-nord-1 border border-nord-3 rounded px-2 py-1 text-xs text-nord-4 focus:outline-none focus:border-nord-8"
          >
            <option value="imported_at">Date Imported</option>
            <option value="chat_date">Chat Date</option>
            <option value="title">Title</option>
          </select>
        </div>
        <button
          onClick={handleFileOpen}
          className="bg-nord-8 text-nord-0 px-3 py-1 rounded text-sm font-medium hover:bg-nord-7 transition-colors"
        >
          Import
        </button>
      </div>

      {/* Chat list or empty state */}
      <div
        className="flex-1 overflow-y-auto"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {chats.length === 0 ? (
          <div
            className={`flex flex-col items-center justify-center h-full text-nord-3 ${isDragging ? "bg-nord-8/5 border-2 border-dashed border-nord-8/30" : ""}`}
          >
            <svg
              className="w-16 h-16 mb-4 text-nord-3"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
            <p className="text-lg mb-1">No chats yet</p>
            <p className="text-sm">Drop .md files here or click Import</p>
          </div>
        ) : (
          <div className={`${isDragging ? "opacity-50" : ""}`}>
            {sortedChats.map((chat) => (
              <ChatCard
                key={chat.id}
                chat={chat}
                isSelected={chat.id === selectedChatId}
                isGenerating={generatingMetadata.has(chat.id)}
                onSelect={() => onSelectChat(chat)}
                onDelete={() => onDeleteChat(chat.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
