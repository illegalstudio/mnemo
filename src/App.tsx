import { useMemo } from "react";
import { useDatabase } from "./hooks/useDatabase";
import { Sidebar } from "./components/Sidebar/Sidebar";
import ChatList from "./components/ChatList/ChatList";
import ChatDetail from "./components/ChatDetail/ChatDetail";

export default function App() {
  const {
    chats,
    tags,
    selectedChat,
    selectedChatTags,
    selectedChatAttachments,
    searchQuery,
    selectedTagId,
    selectedSource,
    loading,
    generatingMetadata,
    setSelectedChat,
    importFile,
    updateChat,
    deleteChat,
    createTag,
    updateTag,
    deleteTag,
    addTagToChat,
    removeTagFromChat,
    addAttachment,
    removeAttachment,
    selectTag,
    selectSource,
    search,
  } = useDatabase();

  const recentChats = useMemo(() => chats.slice(0, 5), [chats]);

  const handleImport = async (files: { name: string; content: string }[]) => {
    for (const file of files) {
      await importFile(file.name, file.content);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-nord-0">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-nord-3 border-t-nord-8 rounded-full animate-spin" />
          <span className="text-sm text-nord-3 font-light tracking-wide">Loading archive...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-nord-0">
      {/* Sidebar */}
      <Sidebar
        tags={tags}
        selectedTagId={selectedTagId}
        selectedSource={selectedSource}
        searchQuery={searchQuery}
        recentChats={recentChats}
        onSearch={search}
        onSelectTag={selectTag}
        onSelectSource={selectSource}
        onSelectChat={setSelectedChat}
        onCreateTag={createTag}
        onUpdateTag={updateTag}
        onDeleteTag={deleteTag}
      />

      {/* Center: chat list */}
      <ChatList
        chats={chats}
        selectedChatId={selectedChat?.id ?? null}
        generatingMetadata={generatingMetadata}
        onSelectChat={setSelectedChat}
        onImport={handleImport}
        onDeleteChat={deleteChat}
      />

      {/* Right: detail panel */}
      {selectedChat && (
        <ChatDetail
          chat={selectedChat}
          tags={selectedChatTags}
          allTags={tags}
          attachments={selectedChatAttachments}
          onUpdateChat={updateChat}
          onClose={() => setSelectedChat(null)}
          onAddTag={addTagToChat}
          onRemoveTag={removeTagFromChat}
          onCreateTag={async (name: string) => {
            await createTag(name);
          }}
          onAddAttachment={addAttachment}
          onRemoveAttachment={removeAttachment}
        />
      )}
    </div>
  );
}
