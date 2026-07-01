# Cut / Split Tool — Design

- **Date:** 2026-06-30
- **Status:** Approved for spec review
- **Component area:** `src/components/ChatDetail/`, `src/lib/`, `src/hooks/useDatabase.ts`, `src/index.css`

## Summary

Add a second tool to the markdown toolbar: a **scissors (cut) tool**. When active, the
cursor is a crosshair and a horizontal guide line snaps to the gap between blocks
nearest the mouse. Left-clicking the line opens a small menu with three actions:

1. **Delete above** — remove all content above the line.
2. **Delete below** — remove all content below the line.
3. **Split** — split the note in two at the line: the current note keeps the part
   above, a new note is created with the part below.

The cut point maps to a precise offset in `content_md` via source positions exposed on
block elements, so every action edits the markdown source cleanly at a block boundary.

## User decisions (from brainstorming)

1. **Granularity:** the line snaps to boundaries between blocks **including individual
   list items** (`li`), not only top-level blocks. The line only appears in gaps
   *between* consecutive blocks (never above the first or below the last), so both
   sides always have content.
2. **Split inheritance:** the new note inherits **source + folder + tags**. Its title is
   the first heading found in the part below, falling back to `"<original title> (2)"`.
   **No AI re-analysis.** After splitting, the user stays on the current (top) note; a
   toast links to the new note.
3. **Delete safety:** **both** a confirmation prompt **and** an undo. Delete asks to
   confirm, performs the edit, then shows an "Undo" affordance for ~6 seconds that
   restores the previous `content_md`.

## Architecture

### Tool mode (replaces the highlighter's `armed` boolean)

`ChatDetail` currently tracks `armed: boolean` for the highlighter. Replace it with a
single mutually-exclusive mode:

```ts
type ToolMode = "none" | "highlight" | "cut";
```

Only one tool is active at a time; activating the scissors turns the highlighter off and
vice-versa. `Esc` returns to `"none"`. Switching chats resets to `"none"`. The content
container gets `hl-armed` when `tool === "highlight"` and `cut-armed` (crosshair) when
`tool === "cut"`.

### Block source positions (extend `rehypeSourcePositions`)

The plugin already wraps text nodes in `<span class="md-pos" data-md-start/end>`. Extend
it so that, in the same walk, every **block element** in this set —
`p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, hr` — that has
`position.start.offset` also gets `data-md-block-start="<offset>"`. (Text-node wrapping
is unchanged; this only adds an attribute to block elements.) `li` block-start includes
the list marker (`- `, `1. `), so cutting between list items splits the list cleanly.

### Cut-point mapping (`src/lib/cut-dom.ts`, DOM)

- `interface CutBoundary { y: number; offset: number }` — `y` is in the scroll-content
  coordinate space of the container; `offset` is the `content_md` offset of the block
  **below** the gap.
- `getCutBoundaries(container): CutBoundary[]` — collect elements with
  `data-md-block-start` in document order; for each consecutive pair `(a, b)`, emit
  `{ y: midpoint of the gap between a.bottom and b.top, offset: b's block-start }`.
  Coordinates are computed relative to the container's content
  (`rect.top - container rect.top + container.scrollTop`) so they are stable across
  scroll.
- `nearestBoundary(boundaries, mouseYInContent): CutBoundary | null` — the boundary with
  `y` closest to the mouse.

### Pure markdown ops (`src/lib/cut.ts`, DOM-free, unit-tested)

- `deleteAbove(md, offset): string` → `md.slice(offset)` with leading whitespace trimmed.
- `deleteBelow(md, offset): string` → `md.slice(0, offset)` with trailing whitespace trimmed.
- `splitMarkdown(md, offset): { above: string; below: string }` → trimmed halves.
- `deriveSplitTitle(belowMd, originalTitle): string` → text of the first markdown heading
  in `belowMd` (`/^#{1,6}\s+(.+?)\s*#*\s*$/m` on the first matching line), else
  `"<originalTitle> (2)"`.

### Split persistence (`useDatabase.splitChat`)

```ts
splitChat(chatId: string, offset: number): Promise<Chat>  // returns the new (below) note
```

1. Load the chat; compute `{ above, below } = splitMarkdown(chat.content_md, offset)`.
2. Insert a new chat via `db.insertChat`: `title = deriveSplitTitle(below, chat.title)`,
   `summary = null`, `source = chat.source`, `content_md = below`, `content_html = null`,
   `imported_at = now`, `chat_date = chat.chat_date`, `folder_id = chat.folder_id`.
3. Copy tags: for each tag of the original (`db.getTagsForChat`), `db.addTagToChat(new.id, tag.id)`.
4. Update the current chat: `db.updateChat(chatId, { content_md: above })`.
5. Refresh chats/tags/folders; keep the current chat selected. Return the new chat.

## UX & components

- **`MarkdownToolbar`**: now renders two tool buttons — the existing highlighter and a
  new **scissors** button. Each toggles its mode; the active one is visually pressed.
- **Cut mode active**: crosshair cursor over the content; on `mousemove` the guide line
  (a full-width absolutely-positioned element inside the content container) moves to the
  nearest gap. The container needs `position: relative` for the overlay.
- **Click** (left) on the content while in cut mode opens a small **menu** positioned at
  the click, with *Delete above* / *Delete below* / *Split*, acting on the currently
  shown boundary. The menu closes on outside click, `Esc`, or after an action.
- **Delete above/below**: a confirmation (`Delete the part above/below this line?`) →
  on confirm, `onUpdateChat(chat.id, { content_md })` and show an **Undo** toast for ~6s.
  Undo restores the saved previous `content_md`. The saved snapshot is dropped when the
  timer fires or the chat changes.
- **Split**: `splitChat(chat.id, offset)`; stay on the current note; show a toast
  `Note split → Open new note` linking to the created note. Non-destructive, no confirm.

### Files

- **Change** `src/lib/highlight.ts` — extend `rehypeSourcePositions` to annotate blocks.
- **Create** `src/lib/cut.ts` — pure markdown ops + title derivation (unit-tested).
- **Create** `src/lib/cut-dom.ts` — `getCutBoundaries`, `nearestBoundary`.
- **Create** `src/components/ChatDetail/CutOverlay.tsx` — the guide line + action menu.
- **Change** `src/components/ChatDetail/MarkdownToolbar.tsx` — two tools, `tool` prop.
- **Change** `src/components/ChatDetail/ChatDetail.tsx` — `ToolMode` state, cut handlers,
  confirm/undo/toast, render `CutOverlay` in both normal and focus views.
- **Change** `src/hooks/useDatabase.ts` — `splitChat`; thread it to `ChatDetail`.
- **Change** `src/index.css` — scissors button, crosshair, guide line, menu, toast.

## Edge cases & caveats

- **Code/mermaid blocks** are single cut units: you can cut around them, not inside.
- **De-risk first:** confirm block elements carry `position.start.offset` after
  `rehype-raw` (a `bun test` over the real pipeline, like the highlight de-risk).
- **Undo window:** the pre-delete `content_md` is held only until the timer fires or the
  chat changes; after that the only recovery is a snapshot.
- **Boundary trimming:** slicing at a block-start and trimming whitespace keeps both
  halves valid markdown; the inter-block blank line is dropped from whichever side loses it.
- **Empty results are prevented** because the line only appears between two blocks.
- **Search index:** `splitChat` and deletes flow through `db.insertChat`/`db.updateChat`,
  which already re-index (with `stripHighlights`). No extra work.
- **Highlights across the cut:** a `<mark>` fully on one side moves with that side; a
  `<mark>` that the cut would bisect is rare (cuts are at block boundaries, marks are
  within a block) — not specially handled in v1.

## Non-goals (v1)

- Cutting inside a paragraph/code block (sub-block precision).
- Undo for Split (it is non-destructive; recover by merging manually).
- AI re-analysis of the split-off note.
- Merging two notes back together (the inverse of split).

## Testing strategy

- **Unit (`cut.ts`):** `deleteAbove`/`deleteBelow`/`splitMarkdown` trimming; `deriveSplitTitle`
  with/without a leading heading.
- **De-risk test:** block elements have source offsets after the real pipeline.
- **Plugin test:** blocks (incl. `li`) get `data-md-block-start` matching the source.
- **Manual:** snap line between paragraphs / list items / around a code block; delete
  above/below with confirm + undo; split and verify the new note inherits source/folder/
  tags and a sensible title; tool mutual-exclusivity and `Esc`.
