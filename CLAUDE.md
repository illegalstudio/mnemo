# Mnemo

Personal archive for AI chat conversations. Tauri desktop app with React/TypeScript frontend and Rust backend.

## Build & Run

```bash
bun run tauri dev      # Development (hot reload)
bun run tauri build    # Production build
bun run build          # Frontend only (tsc + vite)
npx tsc --noEmit       # Type check without emit
cd src-tauri && cargo check  # Rust type check
```

## Architecture

### Frontend (React + TypeScript + Vite)
- `src/App.tsx` — Root component, import/paste handlers, error modals, layout
- `src/components/` — ChatDetail, ChatList, Sidebar, Settings, FolderTree, TagTree
- `src/hooks/useDatabase.ts` — Central data hook: CRUD, filtering, import, analysis
- `src/hooks/useAnalysisSettings.ts` — AI analysis config (persisted in SQLite)
- `src/lib/db.ts` — SQLite operations via `@tauri-apps/plugin-sql`, migrations in `initDb()`
- `src/lib/metadata.ts` — Claude CLI invocation for AI analysis (title, summary, tags)
- `src/lib/attachments.ts` — Attachment file management (copy, resolve, delete)
- `src/lib/html-parser.ts` — Bookmarklet HTML to Markdown conversion (Claude, ChatGPT, Perplexity, Grok)
- `src/lib/parser.ts` — Source detection, title extraction, heading parsing

### Backend (Rust + Tauri)
- `src-tauri/src/lib.rs` — Tauri commands: search, indexing, storage usage
- `src-tauri/src/backup.rs` — Snapshot create/restore/export/delete (DB + attachments in zip)
- `src-tauri/src/search.rs` — Tantivy full-text search index

### Data
- **Database**: SQLite at `app_data_dir/mnemo.db` (via tauri-plugin-sql)
- **Attachments**: Copied to `app_data_dir/attachments/{uuid}.{ext}`, stored as relative paths in DB
- **Search index**: Tantivy at `app_data_dir/tantivy_index/`
- **Snapshots**: `app_data_dir/snapshot-{timestamp}.mnemo.zip` containing DB + attachments

### Shell permissions
Shell commands allowed in `src-tauri/capabilities/default.json`: `open` (system file opener). AI analysis tools are executed by dedicated Rust Tauri commands so user-configured absolute binary paths do not require `plugin-shell` permissions.

## Key Design Decisions

### Attachments
Files are copied into app data dir on attach, with relative paths (`attachments/uuid.ext`) stored in DB. This ensures portability across machines and inclusion in snapshots. Absolute paths and `data:` URIs are passed through unchanged by `resolveAttachmentPath()`.

### Snapshots
Zip contains `mnemo.db` + `attachments/` directory. Before creating, a WAL checkpoint is flushed via rusqlite. Before restoring, a safety snapshot is auto-created. Restore extracts to a temp dir first, then swaps atomically. Tantivy index is cleared on restore and rebuilt on next launch.

### AI Analysis
Uses a configured Claude Code or Codex CLI binary. Claude runs in non-interactive mode with tools, slash commands, Chrome integration, session persistence, and external MCP config disabled while preserving normal user auth. Codex runs through `codex exec` in read-only, ephemeral mode with user config and rules ignored. Tool availability is checked with `--version`. Has 60s timeout. `ToolNotFoundError` is propagated to UI as a modal. Analysis is optional and runs post-import.

### Duplicate Detection
On import, compares first 800 normalized chars of content against existing chats with same source. If match found, prompts user to update existing or create new.

### HTML Import
Imported HTML from AI platforms (Claude, ChatGPT, Perplexity, Grok) is preserved as-is in `content_html` for re-parsing. Do NOT sanitize it — these contain dynamic content, CodeMirror editors, etc. that are needed for correct markdown extraction.

### Tag Slugs
Tags use unique slugs. `insertTag()` returns the existing tag if slug matches, preventing duplicates silently.

## Database Migrations

All migrations live in `initDb()` in `src/lib/db.ts`. They use `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN` (caught if exists), and `CREATE INDEX IF NOT EXISTS`. Migration flags use the `settings` table (e.g., `migration_attachments_v1`).

## Important Patterns

- `getFilteredChats()` applies folder/tag/source filters in a single SQL query — avoid N+1 patterns
- `permanentlyDeleteChat()` must clean up: attachments (files + records), chat_tags, search index, then chat
- `deleteChat()` is soft-delete (sets `deleted_at`, clears `folder_id`, removes from search index)
- `restoreChat()` re-indexes in Tantivy
- Callbacks in `useDatabase` avoid depending on `chats` array to prevent cascading re-renders
