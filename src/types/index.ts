export interface Chat {
  id: string;
  title: string;
  summary: string | null;
  source: "claude" | "perplexity" | "chatgpt" | "other";
  content_md: string;
  content_html: string | null;
  imported_at: string;
  chat_date: string | null;
  folder_id: string | null;
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  color: string | null;
}

export interface TagWithCount extends Tag {
  chat_count: number;
  children?: TagWithCount[];
}

export interface ChatTag {
  chat_id: string;
  tag_id: string;
}

export interface Attachment {
  id: string;
  chat_id: string;
  filename: string;
  file_path: string;
  mime_type: string | null;
  attached_at: string;
}

export type Source = "claude" | "perplexity" | "chatgpt" | "other";

export interface MetadataResult {
  title: string;
  summary: string;
  tags: string[];
}

export interface HeadingEntry {
  level: number;
  text: string;
  id: string;
}

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  position: number;
}

export interface FolderWithCount extends Folder {
  chat_count: number;
  nested_chat_count: number;
  children?: FolderWithCount[];
}
