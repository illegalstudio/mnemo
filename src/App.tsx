import { useState, useCallback, useRef, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { isMnemoHtmlPaste, convertHtmlToMarkdown } from "./lib/html-parser";
import { useDatabase } from "./hooks/useDatabase";
import { useTheme } from "./hooks/useTheme";
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
    chats, recentChats, tags, selectedChat, selectedChatTags, selectedChatAttachments,
    searchQuery, selectedTagIds, selectedSource, loading, generatingMetadata,
    setSelectedChat, importFile, updateChat, deleteChat,
    createTag, updateTag, deleteTag,
    addTagToChat, removeTagFromChat, addAttachment, removeAttachment,
    toggleTag, clearTags, selectSource, search,
  } = useDatabase();

  const { mode: themeMode, setThemeMode } = useTheme();
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [chatListWidth, setChatListWidth] = useState(260);
  const [isResizing, setIsResizing] = useState(false);

  const handleResizeStart = useCallback(() => setIsResizing(true), []);
  const handleResizeEnd = useCallback(() => setIsResizing(false), []);

  const handleFileOpen = useCallback(async () => {
    const selected = await open({ multiple: true, filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const filePath of paths) {
      const content = await readTextFile(filePath);
      const name = filePath.split("/").pop() || filePath.split("\\").pop() || "unknown.md";
      await importFile(name, content);
    }
  }, [importFile]);

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
        // Bookmarklet HTML paste — convert to markdown, save original HTML
        const { title, content, source } = convertHtmlToMarkdown(text);
        importFile(title + ".md", content, text, source);
      } else if (text.includes("# ") || text.includes("## ")) {
        // Plain markdown paste
        const firstLine = text.split("\n")[0].replace(/^#\s+/, "").trim();
        importFile((firstLine || "Pasted Chat") + ".md", text);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [importFile]);

  const handleImport = async (files: { name: string; content: string }[]) => {
    for (const file of files) {
      await importFile(file.name, file.content);
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
            tags={tags} selectedTagIds={selectedTagIds} selectedSource={selectedSource}
            searchQuery={searchQuery} recentChats={recentChats}
            onSearch={search} onToggleTag={toggleTag} onClearTags={clearTags} onSelectSource={selectSource}
            onSelectChat={setSelectedChat} onCreateTag={createTag}
            onUpdateTag={updateTag} onDeleteTag={deleteTag}
            onOpenSettings={() => setShowSettings(true)}
            onImportClick={handleFileOpen}
          />
        </div>
        <ResizeHandle onResize={handleSidebarResize} onResizeStart={handleResizeStart} onResizeEnd={handleResizeEnd} />
        <div
          className={`center-panel ${selectedChat ? "" : "expanded"}`}
          style={selectedChat ? { width: chatListWidth, minWidth: chatListWidth } : undefined}
        >
          <ChatList
            chats={chats} selectedChatId={selectedChat?.id ?? null}
            generatingMetadata={generatingMetadata}
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
              isResizing={isResizing}
            />
          </>
        )}
      </div>
      {showSettings && (
        <Settings
          themeMode={themeMode}
          onSetTheme={setThemeMode}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
}
