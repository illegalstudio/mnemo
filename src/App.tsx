import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
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
    setSelectedChat, importFile, updateChat, deleteChat,
    createTag, updateTag, deleteTag,
    addTagToChat, removeTagFromChat, addAttachment, removeAttachment,
    toggleTag, selectTag, clearTags, selectSource, search,
    createFolder, renameFolder, deleteFolder: deleteFolderCb, moveChatToFolder, moveFolderToParent, selectFolder,
  } = useDatabase();

  const { mode: themeMode, setThemeMode } = useTheme();
  const { settings: analysisSettings, update: updateAnalysis, updateFields: updateAnalysisFields, updateLanguages: updateAnalysisLanguages } = useAnalysisSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [chatListWidth, setChatListWidth] = useState(260);
  const [isResizing, setIsResizing] = useState(false);

  const folderMap = useMemo(() => new Map((folders ?? []).map(f => [f.id, f.name])), [folders]);

  const handleResizeStart = useCallback(() => setIsResizing(true), []);
  const handleResizeEnd = useCallback(() => setIsResizing(false), []);

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

  // Paste from clipboard (Cmd+V) — handles both bookmarklet HTML and plain markdown
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // Don't intercept if user is typing in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      const text = e.clipboardData?.getData("text/plain");
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

  const handleChatListResize = useCallback((delta: number) => {
    setChatListWidth((w) => Math.max(200, Math.min(500, w + delta)));
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
            onOpenSettings={() => setShowSettings(true)}
            onImportClick={handleFileOpen}
          />
        </div>
        <ResizeHandle onResize={handleSidebarResize} onResizeStart={handleResizeStart} onResizeEnd={handleResizeEnd} />
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
        ) : (
          <>
            <div
              className={`center-panel ${selectedChat ? "" : "expanded"}`}
              style={selectedChat ? { width: chatListWidth, minWidth: chatListWidth } : undefined}
            >
              <ChatList
                chats={chats} selectedChatId={selectedChat?.id ?? null}
                generatingMetadata={generatingMetadata}
                folderMap={folderMap}
                onSelectChat={setSelectedChat} onImport={handleImport}
                onDeleteChat={deleteChat}
              />
            </div>
            {selectedChat && (
              <>
                <ResizeHandle onResize={handleChatListResize} onResizeStart={handleResizeStart} onResizeEnd={handleResizeEnd} />
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
                />
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
