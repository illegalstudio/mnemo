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

export default function ChatList({
  chats, selectedChatId, generatingMetadata, onSelectChat, onImport, onDeleteChat: _onDeleteChat,
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
    const selected = await open({ multiple: true, filters: [{ name: "Markdown", extensions: ["md"] }] });
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

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(true); };
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
    <div className="chatlist-inner">
      <div className="toolbar">
        <div className="toolbar-left">
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
            <option value="imported_at">Date Imported</option>
            <option value="chat_date">Chat Date</option>
            <option value="title">Title</option>
          </select>
          <span className="chat-count">{chats.length} {chats.length === 1 ? "chat" : "chats"}</span>
        </div>
        <button className="import-btn" onClick={handleFileOpen}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Import
        </button>
      </div>

      <div className="chat-list" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        {chats.length === 0 ? (
          <div className="empty-state">
            <div className={`empty-state-box ${isDragging ? "dragging" : ""}`}>
              <div className="empty-state-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <p className="empty-state-title">Drop markdown files here</p>
              <p className="empty-state-subtitle">or click Import to browse</p>
            </div>
          </div>
        ) : (
          <div style={{ opacity: isDragging ? 0.4 : 1, transition: "opacity 0.2s" }}>
            {sortedChats.map((chat) => {
              const isSelected = chat.id === selectedChatId;
              const isGenerating = generatingMetadata.has(chat.id);
              const dateStr = new Date(chat.imported_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });

              return (
                <button
                  key={chat.id}
                  className={`chat-card ${isSelected ? "selected" : ""}`}
                  onClick={() => onSelectChat(chat)}
                >
                  <div className="chat-card-title">{chat.title}</div>
                  {chat.summary && <div className="chat-card-summary">{chat.summary}</div>}
                  <div className="chat-card-meta">
                    <span className={`source-badge ${chat.source}`}>{chat.source}</span>
                    <span className="chat-card-date">{dateStr}</span>
                    {isGenerating && <span className="chat-card-generating">analyzing...</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
