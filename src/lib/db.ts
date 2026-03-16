import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { v4 as uuidv4 } from "uuid";
import type {
  Chat,
  Tag,
  TagWithCount,
  Attachment,
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

  // Migration: drop old FTS5 table
  await instance.execute("DROP TABLE IF EXISTS chats_fts");

  // Migration: add content_html column if missing
  try {
    await instance.execute("ALTER TABLE chats ADD COLUMN content_html TEXT");
  } catch {
    // Column already exists
  }

  db = instance;
  return instance;
}

export async function initSearch(): Promise<void> {
  const d = await getDb();
  const allChats = await d.select<{ id: string; title: string; summary: string | null; content_md: string }[]>(
    "SELECT id, title, summary, content_md FROM chats"
  );
  if (allChats.length > 0) {
    await invoke("reindex_all", {
      chats: allChats.map((c) => ({
        id: c.id,
        title: c.title,
        summary: c.summary,
        contentMd: c.content_md,
      })),
    });
  }
}

export async function getDb(): Promise<Database> {
  if (db) return db;
  return initDb();
}

export async function getAllChats(): Promise<Chat[]> {
  const d = await getDb();
  return d.select<Chat[]>("SELECT * FROM chats ORDER BY imported_at DESC");
}

export async function searchChats(query: string): Promise<Chat[]> {
  const ids = await invoke<string[]>("search_chats", { query });
  if (ids.length === 0) return [];
  const d = await getDb();
  const placeholders = ids.map(() => "?").join(",");
  const results = await d.select<Chat[]>(
    `SELECT * FROM chats WHERE id IN (${placeholders})`,
    ids
  );
  // Re-order to match Tantivy relevance ranking
  const idOrder = new Map(ids.map((id, i) => [id, i]));
  results.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));
  return results;
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
    `INSERT INTO chats (id, title, summary, source, content_md, content_html, imported_at, chat_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, chat.title, chat.summary, chat.source, chat.content_md, chat.content_html, chat.imported_at, chat.chat_date]
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

export async function deleteChat(id: string): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM chats WHERE id = ?", [id]);
  await invoke("delete_from_index", { id });
  await d.execute("DELETE FROM chat_tags WHERE chat_id = ?", [id]);
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
  const slug = name.toLowerCase().replace(/\s+/g, "-");

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
