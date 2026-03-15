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
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [recentChats, setRecentChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingMetadata, setGeneratingMetadata] = useState<Set<string>>(new Set());
  const initialized = useRef(false);

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
    // Start with all chats or search results
    let result: Chat[];
    if (searchQuery) {
      result = await db.searchChats(searchQuery);
    } else {
      result = await db.getAllChats();
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
        // Also include chats tagged with child tags (check via getChatsByTag)
        let hasAll = true;
        for (const tagId of selectedTagIds) {
          if (!chatTagIds.has(tagId)) {
            // Check if chat has any descendant of this tag
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
  }, [searchQuery, selectedTagIds, selectedSource]);

  const refreshTags = useCallback(async () => {
    const result = await db.getAllTags();
    setTags(result);
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

  const importFile = useCallback(async (filename: string, content: string) => {
    const parsed = parseImportFile(filename, content);
    const chat = await db.insertChat(parsed);
    await refreshChats();
    await refreshTags();
    setSelectedChat(chat);

    setGeneratingMetadata(prev => new Set(prev).add(chat.id));
    try {
      const metadata = await generateMetadata(content);
      if (metadata) {
        await db.updateChat(chat.id, {
          title: metadata.title,
          summary: metadata.summary,
        });
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

  const clearTags = useCallback(() => {
    setSelectedTagIds(new Set());
  }, []);

  const selectSource = useCallback((source: Source | null) => {
    setSelectedSource(source);
  }, []);

  const search = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  return {
    chats,
    recentChats,
    tags,
    selectedChat,
    selectedChatTags,
    selectedChatAttachments,
    searchQuery,
    selectedTagIds,
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
    toggleTag,
    clearTags,
    selectSource,
    search,
    refreshChats,
    refreshTags,
  };
}
