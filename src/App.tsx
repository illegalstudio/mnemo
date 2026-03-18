import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { Chat } from "./types";
import { isMnemoHtmlPaste, convertHtmlToMarkdown, reparseHtml } from "./lib/html-parser";
import { generateSingleField } from "./lib/metadata";
import * as db from "./lib/db";
import { useDatabase } from "./hooks/useDatabase";
import { useTheme } from "./hooks/useTheme";
import { useAnalysisSettings } from "./hooks/useAnalysisSettings";
import { Sidebar } from "./components/Sidebar/Sidebar";
import ChatList from "./components/ChatList/ChatList";
import ChatDetail from "./components/ChatDetail/ChatDetail";
import Settings from "./components/Settings/Settings";

function ResizeHandle({ onResize, onResizeStart, onResizeEnd }: {
  onResize: (delta: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    onResizeStart?.();

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = ev.clientX - lastX.current;
      lastX.current = ev.clientX;
      onResize(delta);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      onResizeEnd?.();
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [onResize, onResizeStart, onResizeEnd]);

  return <div className="resize-handle" onMouseDown={onMouseDown} />;
}

export default function App() {
  const {
    chats, recentChats, tags, folders, unfiledCount, selectedChat, selectedChatTags, selectedChatAttachments,
    searchQuery, selectedTagIds, selectedSource, selectedFolderId, loading, generatingMetadata,
    setSelectedChat, importFile, updateChat, toggleFavorite, deleteChat,
    createTag, updateTag, deleteTag,
    addTagToChat, removeTagFromChat, addAttachment, removeAttachment,
    toggleTag, selectTag, clearTags, selectSource, search,
    createFolder, renameFolder, deleteFolder: deleteFolderCb, moveChatToFolder, moveFolderToParent, selectFolder,
    trashChats, showTrash, setShowTrash, restoreChat, permanentlyDeleteChat, emptyTrash, refreshTrash,
  } = useDatabase();

  const { mode: themeMode, setThemeMode } = useTheme();
  const { settings: analysisSettings, update: updateAnalysis, updateFields: updateAnalysisFields, updateLanguages: updateAnalysisLanguages } = useAnalysisSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [activeFilters, setActiveFilters] = useState<import("./components/Sidebar/Sidebar").ActiveFilters>({
    favorites: false, hasAttachment: false, hasSummary: false, createdAfter: "", createdBefore: "",
  });
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [chatListWidth, setChatListWidth] = useState(260);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarWidthRef = useRef(sidebarWidth);
  const chatListWidthRef = useRef(chatListWidth);
  sidebarWidthRef.current = sidebarWidth;
  chatListWidthRef.current = chatListWidth;

  // ESC to close trash
  useEffect(() => {
    if (!showTrash) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowTrash(false); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [showTrash, setShowTrash]);

  // Load column widths from DB settings after DB is ready
  useEffect(() => {
    if (loading) return;
    (async () => {
      const [sw, cw] = await Promise.all([
        db.getSetting("sidebar-width"),
        db.getSetting("chatlist-width"),
      ]);
      if (sw) setSidebarWidth(Number(sw));
      if (cw) setChatListWidth(Number(cw));
    })();
  }, [loading]);

  // Apply filters to chat list
  const filteredChats = useMemo(() => {
    let result = chats;
    if (activeFilters.favorites) {
      result = result.filter(c => c.favorite);
    }
    if (activeFilters.hasAttachment) {
      result = result.filter(c => (c.attachment_count ?? 0) > 0);
    }
    if (activeFilters.hasSummary) {
      result = result.filter(c => c.summary && c.summary.trim().length > 0);
    }
    if (activeFilters.createdAfter) {
      result = result.filter(c => c.imported_at >= activeFilters.createdAfter);
    }
    if (activeFilters.createdBefore) {
      result = result.filter(c => c.imported_at <= activeFilters.createdBefore + "T23:59:59");
    }
    return result;
  }, [chats, activeFilters]);

  // Keep selectedChat in sync with visible list
  useEffect(() => {
    if (!selectedChat) return;
    if (!filteredChats.some(c => c.id === selectedChat.id)) {
      setSelectedChat(filteredChats[0] || null);
    }
  }, [filteredChats, selectedChat]);

  const folderMap = useMemo(() => new Map((folders ?? []).map(f => [f.id, f.name])), [folders]);

  const handleResizeStart = useCallback(() => setIsResizing(true), []);

  const handleFileOpen = useCallback(async () => {
    const selected = await open({ multiple: true, filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const filePath of paths) {
      const content = await readTextFile(filePath);
      const name = filePath.split("/").pop() || filePath.split("\\").pop() || "unknown.md";
      await importFile(name, content, undefined, undefined, analysisSettings, selectedFolderId);
    }
  }, [importFile, analysisSettings, selectedFolderId]);

  const handleRegenerateField = useCallback(async (chatId: string, field: "title" | "summary" | "tags") => {
    const chatObj = chats.find(c => c.id === chatId);
    if (!chatObj) return;
    const allTags = await db.getAllTags();
    const tagNames = allTags.map(t => t.slug);
    const result = await generateSingleField(chatObj.content_md, field, analysisSettings, tagNames);
    if (!result) return;
    if (field === "title" && result.title) {
      await updateChat(chatId, { title: result.title });
    } else if (field === "summary" && result.summary) {
      await updateChat(chatId, { summary: result.summary });
    } else if (field === "tags" && result.tags) {
      for (const tagName of result.tags) {
        const existing = allTags.find(t => t.slug === tagName.toLowerCase().replace(/\s+/g, '-'));
        if (existing) {
          await addTagToChat(chatId, existing.id);
        } else {
          const newTag = await createTag(tagName);
          if (newTag) await addTagToChat(chatId, newTag.id);
        }
      }
    }
  }, [chats, analysisSettings, updateChat, addTagToChat, createTag]);

  const handleReparseHtml = useCallback(async (chatId: string) => {
    const chatObj = chats.find(c => c.id === chatId);
    if (!chatObj?.content_html) return;
    const result = reparseHtml(chatObj.content_html);
    if (result) {
      await updateChat(chatId, { content_md: result.content });
    }
  }, [chats, updateChat]);

  // Cmd+Shift+F to focus global search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "f") {
        e.preventDefault();
        const searchInput = document.querySelector(".sidebar-search input") as HTMLInputElement;
        searchInput?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Escape exits focus mode
  useEffect(() => {
    if (!focusMode) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocusMode(false);
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [focusMode]);

  // Paste from clipboard (Cmd+V) — handles both bookmarklet HTML and plain markdown
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // Don't intercept if user is typing in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      const text = e.clipboardData?.getData("text/plain");
      console.log("[paste] length:", text?.length, "starts:", text?.substring(0, 80));
      if (!text || text.length < 50) return;

      e.preventDefault();

      if (isMnemoHtmlPaste(text)) {
        const { title, content, source } = convertHtmlToMarkdown(text);
        importFile(title + ".md", content, text, source, analysisSettings, selectedFolderId);
      } else if (text.includes("# ") || text.includes("## ")) {
        const firstLine = text.split("\n")[0].replace(/^#\s+/, "").trim();
        importFile((firstLine || "Pasted Chat") + ".md", text, undefined, undefined, analysisSettings, selectedFolderId);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [importFile, analysisSettings, selectedFolderId]);

  const handleImport = async (files: { name: string; content: string }[]) => {
    for (const file of files) {
      await importFile(file.name, file.content, undefined, undefined, analysisSettings, selectedFolderId);
    }
  };

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth((w) => Math.max(180, Math.min(400, w + delta)));
  }, []);

  const handleSidebarResizeEnd = useCallback(() => {
    setIsResizing(false);
    db.setSetting("sidebar-width", String(sidebarWidthRef.current));
  }, []);

  const handleChatListResize = useCallback((delta: number) => {
    setChatListWidth((w) => Math.max(200, Math.min(500, w + delta)));
  }, []);

  const handleChatListResizeEnd = useCallback(() => {
    setIsResizing(false);
    db.setSetting("chatlist-width", String(chatListWidthRef.current));
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", background: "var(--bg-base)" }}>
        <span style={{ color: "var(--text-faint)", fontSize: 13 }}>Loading...</span>
      </div>
    );
  }

  return (
    <>
      <div className="app-layout">
        {!focusMode && (
          <>
            <div className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
              <Sidebar
                tags={tags} folders={folders} unfiledCount={unfiledCount} selectedTagIds={selectedTagIds} selectedSource={selectedSource}
                selectedFolderId={selectedFolderId} searchQuery={searchQuery} recentChats={recentChats}
                onSearch={search} onToggleTag={toggleTag} onSelectTag={selectTag} onClearTags={clearTags} onSelectSource={selectSource}
                onSelectChat={setSelectedChat} onCreateTag={createTag}
                onUpdateTag={updateTag} onDeleteTag={deleteTag}
                onSelectFolder={selectFolder} onCreateFolder={createFolder}
                onRenameFolder={renameFolder} onDeleteFolder={deleteFolderCb}
                onMoveChatToFolder={moveChatToFolder}
                onMoveFolderToParent={moveFolderToParent}
                trashCount={trashChats.length}
                onShowTrash={() => { setShowTrash(true); refreshTrash(); }}
                activeFilters={activeFilters}
                onSetFilters={setActiveFilters}
                onOpenSettings={() => setShowSettings(true)}
                onImportClick={handleFileOpen}
              />
            </div>
            <ResizeHandle onResize={handleSidebarResize} onResizeStart={handleResizeStart} onResizeEnd={handleSidebarResizeEnd} />
          </>
        )}
        {showSettings ? (
          <Settings
            themeMode={themeMode}
            onSetTheme={setThemeMode}
            analysisSettings={analysisSettings}
            onUpdateAnalysis={updateAnalysis}
            onUpdateAnalysisFields={updateAnalysisFields}
            onUpdateAnalysisLanguages={updateAnalysisLanguages}
            onClose={() => setShowSettings(false)}
          />
        ) : showTrash ? (
          <div className="settings-panel">
            <div className="settings-panel-header">
              <h2>Trash</h2>
              <div style={{ display: "flex", gap: 8 }}>
                {trashChats.length > 0 && (
                  <button className="snapshot-restore-btn" style={{ color: "var(--red)", borderColor: "var(--red)" }} onClick={emptyTrash}>Empty Trash</button>
                )}
                <button className="close-btn" onClick={() => setShowTrash(false)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="settings-scroll">
              {trashChats.length === 0 ? (
                <div style={{ textAlign: "center", color: "var(--text-faint)", padding: 40, fontSize: 13 }}>Trash is empty</div>
              ) : (
                <div style={{ maxWidth: 600, margin: "0 auto" }}>
                  <p style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 16 }}>Chats are permanently deleted after 30 days.</p>
                  {trashChats.map((chat) => {
                    const deletedDate = chat.deleted_at ? new Date(chat.deleted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
                    return (
                      <div key={chat.id} className="snapshot-row" style={{ marginBottom: 4 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{chat.title}</div>
                          <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Deleted {deletedDate}</div>
                        </div>
                        <button className="snapshot-restore-btn" onClick={() => restoreChat(chat.id)}>Restore</button>
                        <button className="snapshot-action danger" onClick={() => permanentlyDeleteChat(chat.id)} title="Delete permanently">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {!focusMode && (
              <div
                className={`center-panel ${!selectedChat && filteredChats.length === 0 ? "expanded" : ""}`}
                style={selectedChat || filteredChats.length > 0 ? { width: chatListWidth, minWidth: chatListWidth } : undefined}
              >
                <ChatList
                  chats={filteredChats} selectedChatId={selectedChat?.id ?? null}
                  generatingMetadata={generatingMetadata}
                  folderMap={folderMap}
                  onSelectChat={setSelectedChat}
                  onFocusChat={(chat: Chat) => { setSelectedChat(chat); setFocusMode(true); }}
                  onImport={handleImport}
                  onDeleteChat={deleteChat}
                  onToggleFavorite={toggleFavorite}
                />
              </div>
            )}
            {selectedChat ? (
              <>
                {!focusMode && <ResizeHandle onResize={handleChatListResize} onResizeStart={handleResizeStart} onResizeEnd={handleChatListResizeEnd} />}
                <ChatDetail
                  chat={selectedChat} tags={selectedChatTags} allTags={tags}
                  attachments={selectedChatAttachments}
                  onUpdateChat={updateChat} onClose={() => setSelectedChat(null)}
                  onAddTag={addTagToChat} onRemoveTag={removeTagFromChat}
                  onCreateTag={async (name: string) => {
                    const tag = await createTag(name);
                    if (tag && selectedChat) {
                      await addTagToChat(selectedChat.id, tag.id);
                    }
                  }}
                  onAddAttachment={addAttachment} onRemoveAttachment={removeAttachment}
                  onRegenerateField={handleRegenerateField}
                  onReparseHtml={handleReparseHtml}
                  isResizing={isResizing}
                  focusMode={focusMode}
                  onToggleFocus={() => setFocusMode(f => !f)}
                />
              </>
            ) : !focusMode && filteredChats.length > 0 ? (
              <div className="detail-panel" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ textAlign: "center" }}>
                  <svg width="64" height="64" viewBox="0 0 64 64" fill="none" style={{ margin: "0 auto 16px", display: "block", opacity: 0.25 }}>
                    {/* Back card */}
                    <rect x="14" y="8" width="36" height="44" rx="4" stroke="var(--text-faint)" strokeWidth="1.5" />
                    <line x1="22" y1="18" x2="42" y2="18" stroke="var(--text-faint)" strokeWidth="1.5" strokeLinecap="round" />
                    <line x1="22" y1="24" x2="38" y2="24" stroke="var(--text-faint)" strokeWidth="1.5" strokeLinecap="round" />
                    <line x1="22" y1="30" x2="34" y2="30" stroke="var(--text-faint)" strokeWidth="1.5" strokeLinecap="round" />
                    {/* Front card tilted */}
                    <g transform="rotate(-6 32 36)">
                      <rect x="14" y="12" width="36" height="44" rx="4" fill="var(--bg-base)" stroke="var(--text-faint)" strokeWidth="1.5" />
                      <line x1="22" y1="22" x2="42" y2="22" stroke="var(--text-faint)" strokeWidth="1.5" strokeLinecap="round" />
                      <line x1="22" y1="28" x2="38" y2="28" stroke="var(--text-faint)" strokeWidth="1.5" strokeLinecap="round" />
                      <line x1="22" y1="34" x2="34" y2="34" stroke="var(--text-faint)" strokeWidth="1.5" strokeLinecap="round" />
                    </g>
                  </svg>
                  <p style={{ color: "var(--text-faint)", fontSize: 13 }}>Select a chat to view</p>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
