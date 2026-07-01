import { useState, useEffect, useCallback, useRef } from 'react';
import type { Chat, Tag, TagWithCount, FolderWithCount, Attachment, Source } from '../types';
import * as db from '../lib/db';
import { parseImportFile } from '../lib/parser';
import { generateMetadata, ToolNotFoundError } from '../lib/metadata';
import { splitMarkdown, deriveSplitTitle } from '../lib/cut';
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
    let result: Chat[];
    if (searchQuery) {
      result = await db.searchChats(searchQuery);
      // Apply client-side filters to search results (search uses Tantivy, not SQL)
      if (selectedFolderId === "__unfiled__") {
        result = result.filter(c => !c.folder_id);
      } else if (selectedFolderId) {
        const folderChats = await db.getChatsByFolder(selectedFolderId);
        const folderChatIds = new Set(folderChats.map(c => c.id));
        result = result.filter(c => folderChatIds.has(c.id));
      }
      if (selectedSource) {
        result = result.filter(c => c.source === selectedSource);
      }
    } else {
      // Single optimized SQL query with all filters
      result = await db.getFilteredChats({
        folderId: selectedFolderId,
        tagIds: selectedTagIds.size > 0 ? [...selectedTagIds] : undefined,
        source: selectedSource,
      });
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

  const checkDuplicate = useCallback(async (content: string, contentHtml?: string, sourceOverride?: Source) => {
    const parsed = parseImportFile("check", content, contentHtml);
    if (sourceOverride) parsed.source = sourceOverride;
    return db.findDuplicateChat(parsed.content_md, parsed.source);
  }, []);

  const updateExistingChat = useCallback(async (existingId: string, content: string, contentHtml?: string, analysisSettings?: AnalysisSettings) => {
    const updates: Partial<Chat> = { content_md: content, imported_at: new Date().toISOString() };
    if (contentHtml) updates.content_html = contentHtml;
    await db.updateChat(existingId, updates);
    await refreshChats();
    const updated = (await db.getAllChats()).find(c => c.id === existingId);
    if (updated) {
      setSelectedChat(updated);
    }

    if (!analysisSettings?.enabled) return;

    setGeneratingMetadata(prev => new Set(prev).add(existingId));
    try {
      const allExistingTags = await db.getAllTags();
      const tagNames = allExistingTags.map(t => t.slug);
      const metadata = await generateMetadata(content, analysisSettings, tagNames);
      if (metadata) {
        const metaUpdates: Partial<Chat> = {};
        if (metadata.title) metaUpdates.title = metadata.title;
        if (metadata.summary) metaUpdates.summary = metadata.summary;
        if (Object.keys(metaUpdates).length > 0) {
          await db.updateChat(existingId, metaUpdates);
        }
        for (const tagName of metadata.tags || []) {
          const existingTags = await db.getAllTags();
          const slug = tagName.toLowerCase().replace(/\s+/g, '-');
          const existingTag = existingTags.find(t => t.slug === slug);
          if (existingTag) {
            await db.addTagToChat(existingId, existingTag.id);
          } else {
            const newTag = await db.insertTag(tagName);
            await db.addTagToChat(existingId, newTag.id);
          }
        }
        await refreshChats();
        await refreshTags();
        const refreshed = (await db.getAllChats()).find(c => c.id === existingId);
        if (refreshed) {
          setSelectedChat(refreshed);
          const chatTags = await db.getTagsForChat(existingId);
          setSelectedChatTags(chatTags);
        }
      }
    } catch (e) {
      if (e instanceof ToolNotFoundError) throw e;
      console.error('Metadata generation failed:', e);
    } finally {
      setGeneratingMetadata(prev => {
        const next = new Set(prev);
        next.delete(existingId);
        return next;
      });
    }
  }, [refreshChats, refreshTags]);

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
      if (e instanceof ToolNotFoundError) throw e;
      console.error('Metadata generation failed:', e);
    } finally {
      setGeneratingMetadata(prev => {
        const next = new Set(prev);
        next.delete(chat.id);
        return next;
      });
    }
  }, [refreshChats, refreshTags, refreshFolders]);

  const splitChat = useCallback(async (chatId: string, offset: number): Promise<Chat | null> => {
    const all = await db.getAllChats();
    const chat = all.find((c) => c.id === chatId);
    if (!chat) return null;
    const { above, below } = splitMarkdown(chat.content_md, offset);
    const newChat = await db.insertChat({
      title: deriveSplitTitle(below, chat.title),
      summary: null,
      source: chat.source,
      content_md: below,
      content_html: null,
      imported_at: new Date().toISOString(),
      chat_date: chat.chat_date,
      folder_id: chat.folder_id,
      deleted_at: null,
      favorite: 0,
    });
    const tags = await db.getTagsForChat(chatId);
    for (const t of tags) await db.addTagToChat(newChat.id, t.id);
    await db.updateChat(chatId, { content_md: above });
    await refreshChats();
    await refreshTags();
    await refreshFolders();
    const updatedCurrent = (await db.getAllChats()).find((c) => c.id === chatId);
    if (updatedCurrent) setSelectedChat(updatedCurrent);
    return newChat;
  }, [refreshChats, refreshTags, refreshFolders, setSelectedChat]);

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
      // Pick next/prev chat from current state without depending on `chats`
      setChats(prev => {
        const idx = prev.findIndex(c => c.id === id);
        const next = prev[idx + 1] || prev[idx - 1] || null;
        setSelectedChat(next);
        return prev;
      });
    }
    await db.deleteChat(id);
    await refreshChats();
    await refreshTags();
    await refreshFolders();
    await refreshTrash();
  }, [refreshChats, refreshTags, refreshFolders, refreshTrash, selectedChat?.id]);

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
    const { copyAttachmentToAppData, deleteAttachmentFile } = await import('../lib/attachments');
    const relativePath = await copyAttachmentToAppData(filePath, filename);
    try {
      await db.insertAttachment({
        chat_id: chatId,
        filename,
        file_path: relativePath,
        mime_type: mimeType,
        attached_at: new Date().toISOString(),
      });
    } catch (e) {
      // DB insert failed — clean up the copied file
      await deleteAttachmentFile(relativePath);
      throw e;
    }
    if (selectedChat?.id === chatId) {
      const attachments = await db.getAttachments(chatId);
      setSelectedChatAttachments(attachments);
    }
  }, [selectedChat?.id]);

  const removeAttachment = useCallback(async (attachmentId: string) => {
    // Get file path before deleting the record
    let fileToDelete: string | null = null;
    if (selectedChat) {
      const attachments = await db.getAttachments(selectedChat.id);
      const att = attachments.find(a => a.id === attachmentId);
      if (att) fileToDelete = att.file_path;
    }
    // Delete DB record first, then file (file orphan is less harmful than broken reference)
    await db.deleteAttachment(attachmentId);
    if (fileToDelete) {
      const { deleteAttachmentFile } = await import('../lib/attachments');
      await deleteAttachmentFile(fileToDelete);
    }
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
    checkDuplicate,
    updateExistingChat,
    importFile,
    splitChat,
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
    refreshFolders,
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
