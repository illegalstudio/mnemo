import { useMemo, useState, useCallback, useRef } from "react";
import { useDatabase } from "./hooks/useDatabase";
import { Sidebar } from "./components/Sidebar/Sidebar";
import ChatList from "./components/ChatList/ChatList";
import ChatDetail from "./components/ChatDetail/ChatDetail";

function ResizeHandle({ onResize }: { onResize: (delta: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

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
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [onResize]);

  return <div className="resize-handle" onMouseDown={onMouseDown} />;
}

export default function App() {
  const {
    chats, tags, selectedChat, selectedChatTags, selectedChatAttachments,
    searchQuery, selectedTagId, selectedSource, loading, generatingMetadata,
    setSelectedChat, importFile, updateChat, deleteChat,
    createTag, updateTag, deleteTag,
    addTagToChat, removeTagFromChat, addAttachment, removeAttachment,
    selectTag, selectSource, search,
  } = useDatabase();

  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [chatListWidth, setChatListWidth] = useState(260);

  const recentChats = useMemo(() => chats.slice(0, 5), [chats]);

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
    <div className="app-layout">
      <div className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
        <Sidebar
          tags={tags} selectedTagId={selectedTagId} selectedSource={selectedSource}
          searchQuery={searchQuery} recentChats={recentChats}
          onSearch={search} onSelectTag={selectTag} onSelectSource={selectSource}
          onSelectChat={setSelectedChat} onCreateTag={createTag}
          onUpdateTag={updateTag} onDeleteTag={deleteTag}
        />
      </div>
      <ResizeHandle onResize={handleSidebarResize} />
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
          <ResizeHandle onResize={handleChatListResize} />
          <ChatDetail
            chat={selectedChat} tags={selectedChatTags} allTags={tags}
            attachments={selectedChatAttachments}
            onUpdateChat={updateChat} onClose={() => setSelectedChat(null)}
            onAddTag={addTagToChat} onRemoveTag={removeTagFromChat}
            onCreateTag={async (name: string) => { await createTag(name); }}
            onAddAttachment={addAttachment} onRemoveAttachment={removeAttachment}
          />
        </>
      )}
    </div>
  );
}
