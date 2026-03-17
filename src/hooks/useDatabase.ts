import { useState, useEffect, useCallback, useRef } from 'react';
import type { Chat, Tag, TagWithCount, FolderWithCount, Attachment, Source } from '../types';
import * as db from '../lib/db';
import { parseImportFile } from '../lib/parser';
import { generateMetadata } from '../lib/metadata';
import type { AnalysisSettings } from './useAnalysisSettings';

export function useDatabase() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [selectedChatTags, setSelectedChatTags] = useState<Tag[]>([]);
  const [selectedChatAttachments, setSelectedChatAttachments] = useState<Attachment[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [recentChats, setRecentChats] = useState<Chat[]>([]);
  const [folders, setFolders] = useState<FolderWithCount[]>([]);
  const [unfiledCount, setUnfiledCount] = useState(0);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [trashChats, setTrashChats] = useState<Chat[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generatingMetadata, setGeneratingMetadata] = useState<Set<string>>(new Set());
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    (async () => {
      await db.initDb();
      await db.initSearch();
      await refreshChats();
      await refreshTags();
      await refreshFolders();
      setLoading(false);
    })();
  }, []);

  const refreshChats = useCallback(async () => {
    // Start with all chats or search results
    let result: Chat[];
    if (searchQuery) {
      result = await db.searchChats(searchQuery);
    } else {
      result = await db.getAllChats();
    }

    // Filter by folder (including subfolders via recursive CTE)
    if (selectedFolderId === "__unfiled__") {
      result = result.filter(c => !c.folder_id);
    } else if (selectedFolderId) {
      const folderChats = await db.getChatsByFolder(selectedFolderId);
      const folderChatIds = new Set(folderChats.map(c => c.id));
      result = result.filter(c => folderChatIds.has(c.id));
    }

    // Filter by source
    if (selectedSource) {
      result = result.filter(c => c.source === selectedSource);
    }

    // Filter by tags (AND: chat must have ALL selected tags)
    if (selectedTagIds.size > 0) {
      const filtered: Chat[] = [];
      for (const chat of result) {
        const chatTags = await db.getTagsForChat(chat.id);
        const chatTagIds = new Set(chatTags.map(t => t.id));
        let hasAll = true;
        for (const tagId of selectedTagIds) {
          if (!chatTagIds.has(tagId)) {
            const chatsForTag = await db.getChatsByTag(tagId);
            if (!chatsForTag.some(c => c.id === chat.id)) {
              hasAll = false;
              break;
            }
          }
        }
        if (hasAll) filtered.push(chat);
      }
      result = filtered;
    }

    setChats(result);
    const recent = await db.getRecentChats(5);
    setRecentChats(recent);
  }, [searchQuery, selectedTagIds, selectedSource, selectedFolderId]);

  const refreshTags = useCallback(async () => {
    const result = await db.getAllTags();
    setTags(result);
  }, []);

  const refreshFolders = useCallback(async () => {
    const [result, unfiled] = await Promise.all([
      db.getAllFolders(),
      db.getUnfiledChatCount(),
    ]);
    setFolders(result);
    setUnfiledCount(unfiled);
  }, []);

  const refreshTrash = useCallback(async () => {
    const result = await db.getTrashChats();
    setTrashChats(result);
  }, []);

  useEffect(() => {
    if (!initialized.current) return;
    refreshChats();
  }, [refreshChats]);

  useEffect(() => {
    if (!selectedChat) {
      setSelectedChatTags([]);
      setSelectedChatAttachments([]);
      return;
    }
    (async () => {
      const [chatTags, attachments] = await Promise.all([
        db.getTagsForChat(selectedChat.id),
        db.getAttachments(selectedChat.id),
      ]);
      setSelectedChatTags(chatTags);
      setSelectedChatAttachments(attachments);
    })();
  }, [selectedChat?.id]);

  const importFile = useCallback(async (filename: string, content: string, contentHtml?: string, sourceOverride?: Source, analysisSettings?: AnalysisSettings, folderId?: string | null) => {
    const parsed = parseImportFile(filename, content, contentHtml);
    if (sourceOverride) parsed.source = sourceOverride;
    if (folderId && folderId !== "__unfiled__") parsed.folder_id = folderId;
    const chat = await db.insertChat(parsed);
    await refreshChats();
    await refreshTags();
    await refreshFolders();
    setSelectedChat(chat);

    if (!analysisSettings?.enabled) {
      return;
    }

    setGeneratingMetadata(prev => new Set(prev).add(chat.id));
    try {
      const allExistingTags = await db.getAllTags();
      const tagNames = allExistingTags.map(t => t.slug);
      const metadata = await generateMetadata(content, analysisSettings, tagNames);
      if (metadata) {
        const updates: Partial<Chat> = {};
        if (metadata.title) updates.title = metadata.title;
        if (metadata.summary) updates.summary = metadata.summary;
        if (Object.keys(updates).length > 0) {
          await db.updateChat(chat.id, updates);
        }
        for (const tagName of metadata.tags || []) {
          const existingTags = await db.getAllTags();
          const slug = tagName.toLowerCase().replace(/\s+/g, '-');
          const existingTag = existingTags.find(t => t.slug === slug);
          if (existingTag) {
            await db.addTagToChat(chat.id, existingTag.id);
          } else {
            const newTag = await db.insertTag(tagName);
            await db.addTagToChat(chat.id, newTag.id);
          }
        }
        await refreshChats();
        await refreshTags();
        // Refresh the selected chat with updated data
        const updated = (await db.getAllChats()).find(c => c.id === chat.id);
        if (updated) {
          setSelectedChat(updated);
          const chatTags = await db.getTagsForChat(chat.id);
          setSelectedChatTags(chatTags);
        }
      }
    } catch (e) {
      console.error('Metadata generation failed:', e);
    } finally {
      setGeneratingMetadata(prev => {
        const next = new Set(prev);
        next.delete(chat.id);
        return next;
      });
    }
  }, [refreshChats, refreshTags, refreshFolders]);

  const updateChat = useCallback(async (id: string, updates: Partial<Chat>) => {
    await db.updateChat(id, updates);
    await refreshChats();
    if (selectedChat?.id === id) {
      setSelectedChat(prev => prev ? { ...prev, ...updates } : null);
    }
  }, [refreshChats, selectedChat?.id]);

  const toggleFavorite = useCallback(async (id: string) => {
    await db.toggleFavorite(id);
    await refreshChats();
    if (selectedChat?.id === id) {
      setSelectedChat(prev => prev ? { ...prev, favorite: prev.favorite ? 0 : 1 } : null);
    }
  }, [refreshChats, selectedChat?.id]);

  const deleteChat = useCallback(async (id: string) => {
    if (selectedChat?.id === id) {
      const idx = chats.findIndex(c => c.id === id);
      const next = chats[idx + 1] || chats[idx - 1] || null;
      setSelectedChat(next);
    }
    await db.deleteChat(id);
    await refreshChats();
    await refreshTags();
    await refreshFolders();
    await refreshTrash();
  }, [refreshChats, refreshTags, refreshFolders, refreshTrash, selectedChat?.id, chats]);

  const restoreChat = useCallback(async (id: string) => {
    await db.restoreChat(id);
    await refreshChats();
    await refreshTags();
    await refreshFolders();
    await refreshTrash();
  }, [refreshChats, refreshTags, refreshFolders, refreshTrash]);

  const permanentlyDeleteChat = useCallback(async (id: string) => {
    await db.permanentlyDeleteChat(id);
    await refreshTrash();
  }, [refreshTrash]);

  const emptyTrashCb = useCallback(async () => {
    await db.emptyTrash();
    await refreshTrash();
  }, [refreshTrash]);

  const createTag = useCallback(async (name: string, parentId?: string, color?: string) => {
    const tag = await db.insertTag(name, parentId, color);
    await refreshTags();
    return tag;
  }, [refreshTags]);

  const updateTag = useCallback(async (id: string, updates: Partial<Tag>) => {
    await db.updateTag(id, updates);
    await refreshTags();
  }, [refreshTags]);

  const deleteTag = useCallback(async (id: string) => {
    await db.deleteTag(id);
    setSelectedTagIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await refreshTags();
  }, [refreshTags]);

  const addTagToChat = useCallback(async (chatId: string, tagId: string) => {
    await db.addTagToChat(chatId, tagId);
    if (selectedChat?.id === chatId) {
      const chatTags = await db.getTagsForChat(chatId);
      setSelectedChatTags(chatTags);
    }
    await refreshTags();
  }, [selectedChat?.id, refreshTags]);

  const removeTagFromChat = useCallback(async (chatId: string, tagId: string) => {
    await db.removeTagFromChat(chatId, tagId);
    if (selectedChat?.id === chatId) {
      const chatTags = await db.getTagsForChat(chatId);
      setSelectedChatTags(chatTags);
    }
    await refreshTags();
  }, [selectedChat?.id, refreshTags]);

  const addAttachment = useCallback(async (chatId: string, filename: string, filePath: string, mimeType: string | null) => {
    await db.insertAttachment({
      chat_id: chatId,
      filename,
      file_path: filePath,
      mime_type: mimeType,
      attached_at: new Date().toISOString(),
    });
    if (selectedChat?.id === chatId) {
      const attachments = await db.getAttachments(chatId);
      setSelectedChatAttachments(attachments);
    }
  }, [selectedChat?.id]);

  const removeAttachment = useCallback(async (attachmentId: string) => {
    await db.deleteAttachment(attachmentId);
    if (selectedChat) {
      const attachments = await db.getAttachments(selectedChat.id);
      setSelectedChatAttachments(attachments);
    }
  }, [selectedChat]);

  // Toggle a tag in the selection (click to add, click again to remove)
  // Cmd+click: toggle a single tag in the multi-selection
  const toggleTag = useCallback((tagId: string) => {
    setSelectedTagIds(prev => {
      const next = new Set(prev);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return next;
    });
  }, []);

  // Simple click: select only this tag, or deselect if it was the only one
  const selectTag = useCallback((tagId: string) => {
    setSelectedTagIds(prev => {
      if (prev.size === 1 && prev.has(tagId)) {
        return new Set();
      }
      return new Set([tagId]);
    });
  }, []);

  const clearTags = useCallback(() => {
    setSelectedTagIds(new Set());
  }, []);

  const selectSource = useCallback((source: Source | null) => {
    setSelectedSource(source);
  }, []);

  const createFolder = useCallback(async (name: string, parentId?: string, color?: string) => {
    const folder = await db.insertFolder(name, parentId, color);
    await refreshFolders();
    return folder;
  }, [refreshFolders]);

  const renameFolder = useCallback(async (id: string, name: string) => {
    await db.updateFolder(id, { name });
    await refreshFolders();
  }, [refreshFolders]);

  const deleteFolderCb = useCallback(async (id: string) => {
    await db.deleteFolder(id);
    if (selectedFolderId === id) setSelectedFolderId(null);
    await refreshFolders();
    await refreshChats();
  }, [refreshFolders, refreshChats, selectedFolderId]);

  const moveChatToFolder = useCallback(async (chatId: string, folderId: string | null) => {
    await db.moveChatToFolder(chatId, folderId);
    await refreshChats();
    await refreshFolders();
  }, [refreshChats, refreshFolders]);

  const moveFolderToParent = useCallback(async (folderId: string, newParentId: string | null) => {
    const ok = await db.moveFolderToParent(folderId, newParentId);
    if (ok) await refreshFolders();
    return ok;
  }, [refreshFolders]);

  const selectFolder = useCallback((folderId: string | null) => {
    setSelectedFolderId(folderId);
  }, []);

  const search = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  return {
    chats,
    recentChats,
    tags,
    folders,
    unfiledCount,
    selectedChat,
    selectedChatTags,
    selectedChatAttachments,
    searchQuery,
    selectedTagIds,
    selectedSource,
    selectedFolderId,
    loading,
    generatingMetadata,
    setSelectedChat,
    importFile,
    updateChat,
    toggleFavorite,
    deleteChat,
    createTag,
    updateTag,
    deleteTag,
    addTagToChat,
    removeTagFromChat,
    addAttachment,
    removeAttachment,
    toggleTag,
    selectTag,
    clearTags,
    selectSource,
    search,
    refreshChats,
    refreshTags,
    createFolder,
    renameFolder,
    deleteFolder: deleteFolderCb,
    moveChatToFolder,
    moveFolderToParent,
    selectFolder,
    trashChats,
    showTrash,
    setShowTrash,
    restoreChat,
    permanentlyDeleteChat,
    emptyTrash: emptyTrashCb,
    refreshTrash,
  };
}
