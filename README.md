<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Mnemo logo" width="120">
</p>

<h1 align="center">Mnemo</h1>

<p align="center">
  <em>Your personal archive for AI chat conversations.</em>
</p>

<p align="center">
  <a href="https://github.com/illegalstudio/mnemo/stargazers"><img src="https://img.shields.io/github/stars/illegalstudio/mnemo?style=flat-square&logo=github&logoColor=white&label=stars&color=47bfff" alt="Stars"></a>
  <a href="https://github.com/illegalstudio/mnemo/releases"><img src="https://img.shields.io/github/v/release/illegalstudio/mnemo?style=flat-square&logo=github&logoColor=white&label=release&color=47bfff" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/illegalstudio/mnemo?style=flat-square&color=47bfff" alt="License: MIT"></a>
  <a href="https://tauri.app"><img src="https://img.shields.io/badge/built%20with-Tauri-47bfff?style=flat-square&logo=tauri&logoColor=white" alt="Built with Tauri"></a>
</p>

<p align="center">
  <strong>Local-first &middot; AI-powered analysis &middot; Full-text search &middot; Snapshots &amp; backups</strong>
</p>

<p align="center">
  Mnemo is a desktop app that captures your conversations from Claude, ChatGPT, Perplexity, and Grok
  into one searchable, private archive. Everything lives on your machine — organized into folders and
  tags, indexed for instant full-text search, and optionally enriched with AI-generated titles,
  summaries, and tags.
</p>

---

## Features

- **Capture from anywhere** — Import chats via a bookmarklet (HTML → Markdown) or by pasting Markdown directly. Supports Claude, ChatGPT, Perplexity, and Grok.
- **AI analysis** — Optionally run a configured Claude Code or Codex CLI to generate a title, summary, and tags for each imported chat.
- **Organize** — Sort chats into folders and tags with a tree-based sidebar.
- **Full-text search** — Instant search across your entire archive, powered by a Tantivy index.
- **Attachments** — Files are copied into the app data directory so your archive stays portable.
- **Snapshots** — One-click backups bundle your database and attachments into a single zip; restore atomically with an automatic safety snapshot.
- **Local-first & private** — All data stays on your machine. No accounts, no cloud.

## Tech stack

- **Frontend** — React 19, TypeScript, Vite, Tailwind CSS
- **Backend** — Rust + [Tauri 2](https://tauri.app)
- **Storage** — SQLite (`tauri-plugin-sql`) for data, [Tantivy](https://github.com/quickwit-oss/tantivy) for search
- **Markdown** — `react-markdown`, `remark-gfm`, `turndown` (HTML → Markdown), `mermaid` diagrams

## Getting started

### Prerequisites

- [Bun](https://bun.sh)
- [Rust](https://www.rust-lang.org/tools/install) and the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/)

### Develop

```bash
bun install
bun run tauri dev      # run the app with hot reload
```

### Build

```bash
bun run tauri build    # produce a production desktop bundle
```

### Other commands

```bash
bun run build              # build the frontend only (tsc + vite)
npx tsc --noEmit           # type-check the frontend
cd src-tauri && cargo check  # type-check the Rust backend
```

## Importing chats

1. Open a conversation on Claude, ChatGPT, Perplexity, or Grok.
2. Run the Mnemo bookmarklet to capture the page, or copy the conversation as Markdown.
3. Paste or import it into Mnemo. Duplicate detection compares against existing chats from the same source and offers to update or create a new entry.
4. (Optional) Run AI analysis to generate a title, summary, and tags.

## Architecture

```
src/                  React + TypeScript frontend
  components/         ChatDetail, ChatList, Sidebar, Settings, FolderTree, TagTree
  hooks/              useDatabase (CRUD, filtering, import), useAnalysisSettings
  lib/                db, metadata (AI analysis), attachments, html-parser, parser
src-tauri/            Rust + Tauri backend
  src/lib.rs          Tauri commands: search, indexing, storage usage
  src/backup.rs       Snapshot create / restore / export / delete
  src/search.rs       Tantivy full-text search index
```

Data is stored under the app data directory: SQLite at `mnemo.db`, attachments under
`attachments/`, the search index at `tantivy_index/`, and snapshots as `snapshot-*.mnemo.zip`.

## License

[MIT](LICENSE) © Illegal Studio
