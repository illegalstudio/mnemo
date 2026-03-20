import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { v4 as uuidv4 } from "uuid";
import type {
  Chat,
  Tag,
  TagWithCount,
  Attachment,
  Folder,
  FolderWithCount,
} from "../types";

let db: Database | null = null;

export async function initDb(): Promise<Database> {
  const instance = await Database.load("sqlite:mnemo.db");

  await instance.execute(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT,
      source TEXT,
      content_md TEXT,
      content_html TEXT,
      imported_at TEXT,
      chat_date TEXT
    )
  `);

  await instance.execute(`
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      parent_id TEXT,
      color TEXT
    )
  `);

  await instance.execute(`
    CREATE TABLE IF NOT EXISTS chat_tags (
      chat_id TEXT,
      tag_id TEXT,
      PRIMARY KEY (chat_id, tag_id)
    )
  `);

  await instance.execute(`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT,
      attached_at TEXT
    )
  `);

  await instance.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await instance.execute(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      color TEXT,
      position INTEGER DEFAULT 0
    )
  `);

  // Migration: drop old FTS5 table
  await instance.execute("DROP TABLE IF EXISTS chats_fts");

  // Migration: add content_html column if missing
  try {
    await instance.execute("ALTER TABLE chats ADD COLUMN content_html TEXT");
  } catch {
    // Column already exists
  }

  // Migration: add folder_id column if missing
  try {
    await instance.execute("ALTER TABLE chats ADD COLUMN folder_id TEXT");
  } catch {
    // Column already exists
  }

  // Migration: add deleted_at column for trash
  try {
    await instance.execute("ALTER TABLE chats ADD COLUMN deleted_at TEXT");
  } catch {
    // Column already exists
  }

  // Migration: add favorite column
  try {
    await instance.execute("ALTER TABLE chats ADD COLUMN favorite INTEGER DEFAULT 0");
  } catch {
    // Column already exists
  }

  // Indexes for performance
  await instance.execute("CREATE INDEX IF NOT EXISTS idx_chats_folder_id ON chats(folder_id)");
  await instance.execute("CREATE INDEX IF NOT EXISTS idx_chats_deleted_at ON chats(deleted_at)");
  await instance.execute("CREATE INDEX IF NOT EXISTS idx_chats_imported_at ON chats(imported_at DESC)");
  await instance.execute("CREATE INDEX IF NOT EXISTS idx_chat_tags_chat_id ON chat_tags(chat_id)");
  await instance.execute("CREATE INDEX IF NOT EXISTS idx_chat_tags_tag_id ON chat_tags(tag_id)");
  await instance.execute("CREATE INDEX IF NOT EXISTS idx_attachments_chat_id ON attachments(chat_id)");

  // Purge chats in trash older than 30 days
  await instance.execute(
    "DELETE FROM chats WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-30 days')"
  );

  // Migration: move attachment files to app data directory and convert to relative paths
  const migrated = await instance.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = 'migration_attachments_v1'"
  );
  if (migrated.length === 0) {
    const { copyAttachmentToAppData } = await import("./attachments");
    const { exists: fsExists } = await import("@tauri-apps/plugin-fs");
    const allAttachments = await instance.select<{ id: string; filename: string; file_path: string }[]>(
      "SELECT id, filename, file_path FROM attachments"
    );
    let allMigrated = true;
    for (const att of allAttachments) {
      // Skip data: URIs and already-migrated relative paths
      if (att.file_path.startsWith("data:") || !att.file_path.startsWith("/")) continue;
      try {
        const fileStillExists = await fsExists(att.file_path);
        if (fileStillExists) {
          const relativePath = await copyAttachmentToAppData(att.file_path, att.filename);
          await instance.execute(
            "UPDATE attachments SET file_path = ? WHERE id = ?",
            [relativePath, att.id]
          );
        } else {
          // Source file gone — can't migrate, but not a blocker
        }
      } catch (e) {
        console.error(`[migration] Failed to migrate attachment ${att.id}:`, e);
        allMigrated = false;
      }
    }
    // Only mark done if all copyable attachments were migrated
    if (allMigrated) {
      await instance.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_attachments_v1', 'done')"
      );
    }
  }

  db = instance;
  return instance;
}

export async function initSearch(): Promise<void> {
  // Only reindex if Tantivy index is empty (first launch or after reset)
  const indexCount = await invoke<number>("search_index_count");
  if (indexCount > 0) return;

  const d = await getDb();
  const allChats = await d.select<{ id: string; title: string; summary: string | null; content_md: string }[]>(
    "SELECT id, title, summary, content_md FROM chats"
  );
  if (allChats.length > 0) {
    console.log(`[search] Reindexing ${allChats.length} chats...`);
    await invoke("reindex_all", {
      chats: allChats.map((c) => ({
        id: c.id,
        title: c.title,
        summary: c.summary,
        contentMd: c.content_md,
      })),
    });
    console.log("[search] Reindex complete");
  }
}

export async function rebuildSearchIndex(): Promise<void> {
  const d = await getDb();
  const allChats = await d.select<{ id: string; title: string; summary: string | null; content_md: string }[]>(
    "SELECT id, title, summary, content_md FROM chats"
  );
  console.log(`[search] Rebuilding index with ${allChats.length} chats...`);
  await invoke("reindex_all", {
    chats: allChats.map((c) => ({
      id: c.id,
      title: c.title,
      summary: c.summary,
      contentMd: c.content_md,
    })),
  });
  console.log("[search] Rebuild complete");
}

export async function getDb(): Promise<Database> {
  if (db) return db;
  return initDb();
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
  }
}

/**
 * Find an existing chat that looks like a duplicate of the given content.
 * Compares the first PREFIX_LEN chars of normalized content within the same source.
 */
export async function findDuplicateChat(
  contentMd: string,
  source: string
): Promise<Chat | null> {
  const PREFIX_LEN = 800;
  const normalize = (s: string) =>
    s
      .replace(/<!--.*?-->\n?/gs, "") // strip HTML comments (mnemo meta)
      .replace(/\s+/g, " ")           // collapse whitespace
      .trim()
      .slice(0, PREFIX_LEN);

  const newPrefix = normalize(contentMd);
  if (newPrefix.length < 80) return null; // too short to be meaningful

  const d = await getDb();
  const candidates = await d.select<Chat[]>(
    "SELECT * FROM chats WHERE source = ? AND deleted_at IS NULL ORDER BY imported_at DESC",
    [source]
  );

  for (const chat of candidates) {
    const existingPrefix = normalize(chat.content_md);
    // Check if one is a prefix of the other (handles continued conversations)
    if (newPrefix.startsWith(existingPrefix) || existingPrefix.startsWith(newPrefix)) {
      return chat;
    }
  }

  return null;
}

export async function getAllChats(): Promise<Chat[]> {
  const d = await getDb();
  return d.select<Chat[]>(
    `SELECT c.*, (SELECT COUNT(*) FROM attachments a WHERE a.chat_id = c.id) as attachment_count
     FROM chats c WHERE c.deleted_at IS NULL ORDER BY c.imported_at DESC`
  );
}

export async function searchChats(query: string): Promise<Chat[]> {
  const ids = await invoke<string[]>("search_chats", { query });
  if (ids.length === 0) return [];
  const d = await getDb();
  const placeholders = ids.map(() => "?").join(",");
  const results = await d.select<Chat[]>(
    `SELECT * FROM chats WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    ids
  );
  // Re-order to match Tantivy relevance ranking
  const idOrder = new Map(ids.map((id, i) => [id, i]));
  results.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));
  return results;
}

/**
 * Fetch chats with all filters applied in SQL (folder + tags + source).
 * Avoids N+1 queries by doing tag filtering via JOIN.
 */
export async function getFilteredChats(opts: {
  folderId?: string | null;
  tagIds?: string[];
  source?: string | null;
}): Promise<Chat[]> {
  const d = await getDb();
  const conditions: string[] = ["c.deleted_at IS NULL"];
  const params: unknown[] = [];

  // Folder filter
  if (opts.folderId === "__unfiled__") {
    conditions.push("c.folder_id IS NULL");
  } else if (opts.folderId) {
    conditions.push(`c.folder_id IN (
      WITH RECURSIVE folder_tree AS (
        SELECT id FROM folders WHERE id = ?
        UNION ALL
        SELECT f.id FROM folders f JOIN folder_tree ft ON f.parent_id = ft.id
      ) SELECT id FROM folder_tree
    )`);
    params.push(opts.folderId);
  }

  // Source filter
  if (opts.source) {
    conditions.push("c.source = ?");
    params.push(opts.source);
  }

  // Tag filter: chat must have ALL selected tags (AND logic)
  // One subquery per tag — simple, correct, and fast with indexes
  if (opts.tagIds && opts.tagIds.length > 0) {
    for (const tagId of opts.tagIds) {
      conditions.push(`c.id IN (
        SELECT ct.chat_id FROM chat_tags ct WHERE ct.tag_id IN (
          WITH RECURSIVE tag_tree AS (
            SELECT id FROM tags WHERE id = ?
            UNION ALL
            SELECT t.id FROM tags t JOIN tag_tree tt ON t.parent_id = tt.id
          ) SELECT id FROM tag_tree
        )
      )`);
      params.push(tagId);
    }
  }

  return d.select<Chat[]>(
    `SELECT c.*, (SELECT COUNT(*) FROM attachments a WHERE a.chat_id = c.id) as attachment_count
     FROM chats c WHERE ${conditions.join(" AND ")} ORDER BY c.imported_at DESC`,
    params
  );
}

export async function getChatsByTag(tagId: string): Promise<Chat[]> {
  const d = await getDb();
  return d.select<Chat[]>(
    `WITH RECURSIVE tag_tree AS (
       SELECT id FROM tags WHERE id = ?
       UNION ALL
       SELECT t.id FROM tags t
       JOIN tag_tree tt ON t.parent_id = tt.id
     )
     SELECT DISTINCT c.* FROM chats c
     JOIN chat_tags ct ON c.id = ct.chat_id
     JOIN tag_tree tt ON ct.tag_id = tt.id
     ORDER BY c.imported_at DESC`,
    [tagId]
  );
}

export async function insertChat(chat: Omit<Chat, "id">): Promise<Chat> {
  const d = await getDb();
  const id = uuidv4();

  await d.execute(
    `INSERT INTO chats (id, title, summary, source, content_md, content_html, imported_at, chat_date, folder_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, chat.title, chat.summary, chat.source, chat.content_md, chat.content_html, chat.imported_at, chat.chat_date, chat.folder_id ?? null]
  );

  await invoke("index_chat", {
    id,
    title: chat.title,
    summary: chat.summary ?? "",
    contentMd: chat.content_md,
  }
  );

  return { id, ...chat };
}

export async function updateChat(id: string, updates: Partial<Chat>): Promise<void> {
  const d = await getDb();

  const fields = Object.keys(updates).filter((k) => k !== "id");
  if (fields.length === 0) return;

  const setClauses = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => updates[f as keyof Chat] ?? null);

  await d.execute(`UPDATE chats SET ${setClauses} WHERE id = ?`, [...values, id]);

  const searchFields = ["title", "summary", "content_md"];
  if (fields.some((f) => searchFields.includes(f))) {
    const chat = await d.select<Chat[]>("SELECT * FROM chats WHERE id = ?", [id]);
    if (chat.length > 0) {
      await invoke("index_chat", {
        id,
        title: chat[0].title,
        summary: chat[0].summary ?? "",
        contentMd: chat[0].content_md,
      });
    }
  }
}

export async function toggleFavorite(id: string): Promise<boolean> {
  const d = await getDb();
  const rows = await d.select<{ favorite: number }[]>("SELECT favorite FROM chats WHERE id = ?", [id]);
  const newVal = (rows[0]?.favorite ?? 0) ? 0 : 1;
  await d.execute("UPDATE chats SET favorite = ? WHERE id = ?", [newVal, id]);
  return newVal === 1;
}

export async function deleteChat(id: string): Promise<void> {
  // Soft delete: move to trash
  const d = await getDb();
  await d.execute("UPDATE chats SET deleted_at = ?, folder_id = NULL WHERE id = ?", [new Date().toISOString(), id]);
  await invoke("delete_from_index", { id });
}

export async function getTrashChats(): Promise<Chat[]> {
  const d = await getDb();
  return d.select<Chat[]>("SELECT * FROM chats WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC");
}

export async function restoreChat(id: string): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE chats SET deleted_at = NULL WHERE id = ?", [id]);
  const chat = await d.select<Chat[]>("SELECT * FROM chats WHERE id = ?", [id]);
  if (chat.length > 0) {
    await invoke("index_chat", {
      id,
      title: chat[0].title,
      summary: chat[0].summary ?? "",
      contentMd: chat[0].content_md,
    });
  }
}

export async function permanentlyDeleteChat(id: string): Promise<void> {
  const d = await getDb();
  // Delete attachment files from disk
  const attachments = await d.select<{ file_path: string }[]>(
    "SELECT file_path FROM attachments WHERE chat_id = ?", [id]
  );
  if (attachments.length > 0) {
    const { deleteAttachmentFile } = await import("./attachments");
    for (const att of attachments) {
      await deleteAttachmentFile(att.file_path);
    }
  }
  await d.execute("DELETE FROM attachments WHERE chat_id = ?", [id]);
  await d.execute("DELETE FROM chat_tags WHERE chat_id = ?", [id]);
  await d.execute("DELETE FROM chats WHERE id = ?", [id]);
  // Remove from search index
  try { await invoke("delete_from_index", { id }); } catch { /* index entry may not exist */ }
}

export async function emptyTrash(): Promise<void> {
  const d = await getDb();
  const trashed = await d.select<{ id: string }[]>("SELECT id FROM chats WHERE deleted_at IS NOT NULL");
  for (const { id } of trashed) {
    await permanentlyDeleteChat(id);
  }
}

export async function getAllTags(): Promise<TagWithCount[]> {
  const d = await getDb();
  return d.select<TagWithCount[]>(
    `SELECT t.*, COUNT(ct.chat_id) as chat_count
     FROM tags t
     LEFT JOIN chat_tags ct ON t.id = ct.tag_id
     GROUP BY t.id
     ORDER BY t.name`
  );
}

export async function insertTag(
  name: string,
  parentId?: string,
  color?: string
): Promise<Tag> {
  const d = await getDb();
  const id = uuidv4();
  let slug = name.toLowerCase().replace(/\s+/g, "-");

  // Handle duplicate slugs by appending a number
  const existing = await d.select<{ slug: string }[]>(
    "SELECT slug FROM tags WHERE slug = ? OR slug LIKE ?",
    [slug, `${slug}-%`]
  );
  if (existing.length > 0) {
    const existingSlugs = new Set(existing.map(e => e.slug));
    if (existingSlugs.has(slug)) {
      let n = 2;
      while (existingSlugs.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
  }

  await d.execute(
    `INSERT INTO tags (id, name, slug, parent_id, color)
     VALUES (?, ?, ?, ?, ?)`,
    [id, name, slug, parentId ?? null, color ?? null]
  );

  return { id, name, slug, parent_id: parentId ?? null, color: color ?? null };
}

export async function updateTag(id: string, updates: Partial<Tag>): Promise<void> {
  const d = await getDb();

  const fields = Object.keys(updates).filter((k) => k !== "id");
  if (fields.length === 0) return;

  const setClauses = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => updates[f as keyof Tag] ?? null);

  await d.execute(`UPDATE tags SET ${setClauses} WHERE id = ?`, [...values, id]);
}

export async function deleteTag(id: string): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM tags WHERE id = ?", [id]);
  await d.execute("DELETE FROM chat_tags WHERE tag_id = ?", [id]);
}

export async function addTagToChat(chatId: string, tagId: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT OR IGNORE INTO chat_tags (chat_id, tag_id) VALUES (?, ?)",
    [chatId, tagId]
  );
}

export async function removeTagFromChat(chatId: string, tagId: string): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM chat_tags WHERE chat_id = ? AND tag_id = ?", [chatId, tagId]);
}

export async function getTagsForChat(chatId: string): Promise<Tag[]> {
  const d = await getDb();
  return d.select<Tag[]>(
    `SELECT t.* FROM tags t
     JOIN chat_tags ct ON t.id = ct.tag_id
     WHERE ct.chat_id = ?
     ORDER BY t.name`,
    [chatId]
  );
}

export async function getAttachments(chatId: string): Promise<Attachment[]> {
  const d = await getDb();
  return d.select<Attachment[]>(
    "SELECT * FROM attachments WHERE chat_id = ? ORDER BY attached_at DESC",
    [chatId]
  );
}

export async function insertAttachment(
  attachment: Omit<Attachment, "id">
): Promise<Attachment> {
  const d = await getDb();
  const id = uuidv4();

  await d.execute(
    `INSERT INTO attachments (id, chat_id, filename, file_path, mime_type, attached_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      attachment.chat_id,
      attachment.filename,
      attachment.file_path,
      attachment.mime_type,
      attachment.attached_at,
    ]
  );

  return { id, ...attachment };
}

export async function deleteAttachment(id: string): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM attachments WHERE id = ?", [id]);
}

export async function getRecentChats(limit: number): Promise<Chat[]> {
  const d = await getDb();
  return d.select<Chat[]>(
    "SELECT * FROM chats ORDER BY imported_at DESC LIMIT ?",
    [limit]
  );
}

export async function getChatsBySource(source: string): Promise<Chat[]> {
  const d = await getDb();
  return d.select<Chat[]>(
    "SELECT * FROM chats WHERE source = ? ORDER BY imported_at DESC",
    [source]
  );
}

// ---- Settings ----

export async function getSetting(key: string): Promise<string | null> {
  const d = await getDb();
  const rows = await d.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = ?",
    [key]
  );
  return rows.length > 0 ? rows[0].value : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    [key, value]
  );
}

// ---- Folders ----

export async function getAllFolders(): Promise<FolderWithCount[]> {
  const d = await getDb();
  // Get all folders first
  const allFolders = await d.select<Folder[]>(
    "SELECT * FROM folders ORDER BY name COLLATE NOCASE"
  );
  // Get chat counts per folder (direct only)
  const directCounts = await d.select<{ folder_id: string; cnt: number }[]>(
    "SELECT folder_id, COUNT(*) as cnt FROM chats WHERE folder_id IS NOT NULL GROUP BY folder_id"
  );
  const directMap = new Map(directCounts.map(r => [r.folder_id, r.cnt]));

  // Build parent->children map
  const childrenMap = new Map<string, string[]>();
  for (const f of allFolders) {
    if (f.parent_id) {
      const siblings = childrenMap.get(f.parent_id) || [];
      siblings.push(f.id);
      childrenMap.set(f.parent_id, siblings);
    }
  }

  // Recursive count: sum of direct + all descendants
  function totalCount(id: string): number {
    let sum = directMap.get(id) || 0;
    for (const childId of childrenMap.get(id) || []) {
      sum += totalCount(childId);
    }
    return sum;
  }

  return allFolders.map(f => {
    const direct = directMap.get(f.id) || 0;
    const total = totalCount(f.id);
    return {
      ...f,
      chat_count: total,
      nested_chat_count: total - direct,
    };
  });
}

export async function getUnfiledChatCount(): Promise<number> {
  const d = await getDb();
  const rows = await d.select<{ cnt: number }[]>(
    "SELECT COUNT(*) as cnt FROM chats WHERE folder_id IS NULL"
  );
  return rows[0]?.cnt ?? 0;
}

export async function insertFolder(name: string, parentId?: string, color?: string): Promise<Folder> {
  const d = await getDb();
  const id = uuidv4();
  const maxPos = await d.select<{ mp: number | null }[]>(
    "SELECT MAX(position) as mp FROM folders WHERE parent_id IS ?"
    , [parentId ?? null]);
  const position = (maxPos[0]?.mp ?? -1) + 1;

  await d.execute(
    "INSERT INTO folders (id, name, parent_id, color, position) VALUES (?, ?, ?, ?, ?)",
    [id, name, parentId ?? null, color ?? null, position]
  );
  return { id, name, parent_id: parentId ?? null, color: color ?? null, position };
}

export async function updateFolder(id: string, updates: Partial<Folder>): Promise<void> {
  const d = await getDb();
  const fields = Object.keys(updates).filter((k) => k !== "id");
  if (fields.length === 0) return;
  const setClauses = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => updates[f as keyof Folder] ?? null);
  await d.execute(`UPDATE folders SET ${setClauses} WHERE id = ?`, [...values, id]);
}

export async function deleteFolder(id: string): Promise<void> {
  const d = await getDb();
  // Move chats in this folder to unfiled
  await d.execute("UPDATE chats SET folder_id = NULL WHERE folder_id = ?", [id]);
  // Get children and delete them recursively
  const children = await d.select<{ id: string }[]>("SELECT id FROM folders WHERE parent_id = ?", [id]);
  for (const child of children) {
    await deleteFolder(child.id);
  }
  await d.execute("DELETE FROM folders WHERE id = ?", [id]);
}

export async function moveChatToFolder(chatId: string, folderId: string | null): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE chats SET folder_id = ? WHERE id = ?", [folderId, chatId]);
}

export async function moveFolderToParent(folderId: string, newParentId: string | null): Promise<boolean> {
  // Prevent circular nesting: newParentId cannot be folderId itself or any descendant of folderId
  if (newParentId === folderId) return false;
  if (newParentId) {
    const d = await getDb();
    const descendants = await d.select<{ id: string }[]>(
      `WITH RECURSIVE folder_tree AS (
         SELECT id FROM folders WHERE id = ?
         UNION ALL
         SELECT f.id FROM folders f
         JOIN folder_tree ft ON f.parent_id = ft.id
       )
       SELECT id FROM folder_tree`,
      [folderId]
    );
    if (descendants.some((d) => d.id === newParentId)) return false;
  }
  await updateFolder(folderId, { parent_id: newParentId } as Partial<Folder>);
  return true;
}

export async function getChatsByFolder(folderId: string): Promise<Chat[]> {
  const d = await getDb();
  return d.select<Chat[]>(
    `WITH RECURSIVE folder_tree AS (
       SELECT id FROM folders WHERE id = ?
       UNION ALL
       SELECT f.id FROM folders f
       JOIN folder_tree ft ON f.parent_id = ft.id
     )
     SELECT c.* FROM chats c
     JOIN folder_tree ft ON c.folder_id = ft.id
     ORDER BY c.imported_at DESC`,
    [folderId]
  );
}
