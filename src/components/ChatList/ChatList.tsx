import { useState, useMemo, useCallback, useEffect, type DragEvent } from "react";
import type { Chat } from "../../types";
import { setDragPayload, clearDragPayload } from "../../lib/drag-state";

interface ChatListProps {
  chats: Chat[];
  selectedChatId: string | null;
  generatingMetadata: Set<string>;
  folderMap: Map<string, string>;
  onSelectChat: (chat: Chat) => void;
  onFocusChat: (chat: Chat) => void;
  onImport: (files: { name: string; content: string }[]) => void;
  onDeleteChat: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}

export default function ChatList({
  chats, selectedChatId, generatingMetadata, folderMap, onSelectChat, onFocusChat, onImport, onDeleteChat, onToggleFavorite,
}: ChatListProps) {
  const [sortBy, setSortBy] = useState<"imported_at" | "chat_date" | "title">("imported_at");
  const [isDragging, setIsDragging] = useState(false);
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Clear multi-selection when chats change
  useEffect(() => {
    setMultiSelected((prev) => {
      const chatIds = new Set(chats.map((c) => c.id));
      const next = new Set([...prev].filter((id) => chatIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [chats]);

  // Clear confirm delete when clicking elsewhere
  useEffect(() => {
    if (!confirmDeleteId) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".chat-card-delete-confirm")) {
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [confirmDeleteId]);

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

  const handleChatClick = useCallback((chat: Chat, e: React.MouseEvent) => {
    if (confirmDeleteId) { setConfirmDeleteId(null); return; }
    if (e.metaKey || e.ctrlKey) {
      setMultiSelected((prev) => {
        const next = new Set(prev);
        if (next.has(chat.id)) next.delete(chat.id);
        else next.add(chat.id);
        return next;
      });
    } else {
      setMultiSelected(new Set());
      onSelectChat(chat);
    }
  }, [onSelectChat, confirmDeleteId]);

  const handleDeleteSelected = useCallback(async () => {
    if (multiSelected.size === 0) return;
    for (const id of multiSelected) {
      await onDeleteChat(id);
    }
    setMultiSelected(new Set());
  }, [multiSelected, onDeleteChat]);

  // Keyboard: Backspace/Delete to delete selected
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (multiSelected.size > 0 && (e.key === "Backspace" || e.key === "Delete")) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        handleDeleteSelected();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [multiSelected, handleDeleteSelected]);

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
      if (!file.name.endsWith(".md") || file.size > 10 * 1024 * 1024) continue; // skip non-md and >10MB
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
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
          <option value="imported_at">Date Imported</option>
          <option value="chat_date">Chat Date</option>
          <option value="title">Title</option>
        </select>
        <span className="chat-count">{chats.length} {chats.length === 1 ? "chat" : "chats"}</span>
      </div>

      {multiSelected.size > 0 && (
        <div className="multi-select-bar">
          <span>{multiSelected.size} selected</span>
          <button className="multi-delete-btn" onClick={handleDeleteSelected}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        </div>
      )}

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
              const isSelected = chat.id === selectedChatId && multiSelected.size === 0;
              const isMultiSelected = multiSelected.has(chat.id);
              const isGenerating = generatingMetadata.has(chat.id);
              const isConfirming = confirmDeleteId === chat.id;
              const dateStr = new Date(chat.imported_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });

              return (
                <div key={chat.id} className="chat-card-wrapper">
                  <button
                    className={`chat-card ${isSelected ? "selected" : ""} ${isMultiSelected ? "multi-selected" : ""} ${isConfirming ? "slide-left" : ""}`}
                    draggable
                    onDragStart={(e) => {
                      setDragPayload({ type: "chat", chatId: chat.id });
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", chat.id);
                      (e.currentTarget as HTMLElement).classList.add("dragging");
                    }}
                    onDragEnd={(e) => {
                      clearDragPayload();
                      (e.currentTarget as HTMLElement).classList.remove("dragging");
                    }}
                    onClick={(e) => handleChatClick(chat, e)}
                    onDoubleClick={() => onFocusChat(chat)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setConfirmDeleteId(isConfirming ? null : chat.id);
                    }}
                  >
                    <div className="chat-card-title">
                      {chat.favorite ? <span className="chat-card-star">★</span> : null}
                      {chat.title}
                    </div>
                    {chat.summary && <div className="chat-card-summary">{chat.summary}</div>}
                    <div className="chat-card-meta">
                      <span className={`source-badge ${chat.source}`}>{chat.source}</span>
                      {chat.folder_id && folderMap.get(chat.folder_id) && (
                        <span className="source-badge folder">{folderMap.get(chat.folder_id)}</span>
                      )}
                      <span className="chat-card-date">{dateStr}</span>
                      {isGenerating && <span className="chat-card-generating">analyzing...</span>}
                    </div>
                  </button>
                  <div className="chat-card-actions">
                    <button
                      className="chat-card-action-btn favorite"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(null);
                        onToggleFavorite(chat.id);
                      }}
                      title={chat.favorite ? "Remove from favorites" : "Add to favorites"}
                    >
                      <span style={{ fontSize: 16 }}>{chat.favorite ? "★" : "☆"}</span>
                    </button>
                    <button
                      className="chat-card-action-btn delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(null);
                        onDeleteChat(chat.id);
                      }}
                      title="Delete"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
