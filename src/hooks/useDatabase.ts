import { useState, useEffect, useCallback, useRef } from 'react';
import type { Chat, Tag, TagWithCount, Attachment, Source } from '../types';
import * as db from '../lib/db';
import { parseImportFile } from '../lib/parser';
import { generateMetadata } from '../lib/metadata';

export function useDatabase() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [selectedChatTags, setSelectedChatTags] = useState<Tag[]>([]);
  const [selectedChatAttachments, setSelectedChatAttachments] = useState<Attachment[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingMetadata, setGeneratingMetadata] = useState<Set<string>>(new Set());
  const initialized = useRef(false);

  // Initialize DB and load data
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    (async () => {
      await db.initDb();
      await refreshChats();
      await refreshTags();
      setLoading(false);
    })();
  }, []);

  const refreshChats = useCallback(async () => {
    let result: Chat[];
    if (searchQuery) {
      result = await db.searchChats(searchQuery);
    } else if (selectedTagId) {
      result = await db.getChatsByTag(selectedTagId);
    } else if (selectedSource) {
      result = await db.getChatsBySource(selectedSource);
    } else {
      result = await db.getAllChats();
    }
    setChats(result);
  }, [searchQuery, selectedTagId, selectedSource]);

  const refreshTags = useCallback(async () => {
    const result = await db.getAllTags();
    setTags(result);
  }, []);

  // Refresh chats when filters change
  useEffect(() => {
    if (!initialized.current) return;
    refreshChats();
  }, [refreshChats]);

  // Load selected chat details
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

  const importFile = useCallback(async (filename: string, content: string) => {
    const parsed = parseImportFile(filename, content);
    const chat = await db.insertChat(parsed);
    await refreshChats();
    await refreshTags();
    setSelectedChat(chat);

    // Async metadata generation
    setGeneratingMetadata(prev => new Set(prev).add(chat.id));
    try {
      const metadata = await generateMetadata(content);
      if (metadata) {
        await db.updateChat(chat.id, {
          title: metadata.title,
          summary: metadata.summary,
        });
        // Create and assign suggested tags
        for (const tagName of metadata.tags) {
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
        // Refresh selected chat
        const updated = (await db.getAllChats()).find(c => c.id === chat.id);
        if (updated) setSelectedChat(updated);
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
  }, [refreshChats, refreshTags]);

  const updateChat = useCallback(async (id: string, updates: Partial<Chat>) => {
    await db.updateChat(id, updates);
    await refreshChats();
    if (selectedChat?.id === id) {
      setSelectedChat(prev => prev ? { ...prev, ...updates } : null);
    }
  }, [refreshChats, selectedChat?.id]);

  const deleteChat = useCallback(async (id: string) => {
    await db.deleteChat(id);
    if (selectedChat?.id === id) setSelectedChat(null);
    await refreshChats();
    await refreshTags();
  }, [refreshChats, refreshTags, selectedChat?.id]);

  const createTag = useCallback(async (name: string, parentId?: string, color?: string) => {
    await db.insertTag(name, parentId, color);
    await refreshTags();
  }, [refreshTags]);

  const updateTag = useCallback(async (id: string, updates: Partial<Tag>) => {
    await db.updateTag(id, updates);
    await refreshTags();
  }, [refreshTags]);

  const deleteTag = useCallback(async (id: string) => {
    await db.deleteTag(id);
    if (selectedTagId === id) setSelectedTagId(null);
    await refreshTags();
  }, [refreshTags, selectedTagId]);

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

  const selectTag = useCallback((tagId: string | null) => {
    setSelectedTagId(tagId);
    setSelectedSource(null);
    setSearchQuery('');
  }, []);

  const selectSource = useCallback((source: Source | null) => {
    setSelectedSource(source);
    setSelectedTagId(null);
    setSearchQuery('');
  }, []);

  const search = useCallback((query: string) => {
    setSearchQuery(query);
    setSelectedTagId(null);
    setSelectedSource(null);
  }, []);

  return {
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
    refreshChats,
    refreshTags,
  };
}
