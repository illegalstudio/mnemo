# Markdown Highlight Tool — Design

- **Date:** 2026-06-29
- **Status:** Approved for spec review
- **Component area:** `src/components/ChatDetail/`, `src/lib/`, `src/index.css`, `src/lib/db.ts`

## Summary

Add a tools toolbar above the rendered markdown content area in `ChatDetail`. The
first (and for now only) tool is a **multi-color highlighter**. The user selects
text in the rendered view, picks a color, and the matching span of the underlying
`content_md` source is wrapped in `<mark class="hl-…" data-hl="…">…</mark>`. The
change is saved to `content_md` (persisted + re-indexed via the existing
`updateChat` path) and re-rendered, showing the highlight. Clicking an existing
highlight lets the user remove it or change its color.

The toolbar is built to host future tools; v1 ships only the highlighter.

## User decisions (from brainstorming)

1. Highlights are written into the **markdown source** (`content_md`), not stored as
   separate annotations. The content area stays a **rendered view** — selection
   happens on the rendered text, never in a raw editor.
2. **Multiple colors**, chosen from a palette in the toolbar → stored as
   `<mark class="hl-…">` (rendered for free because `rehypeRaw` is already enabled).
   Colors: **yellow, green, pink, blue**.
3. Selection→source mapping uses **Approach 2 (precise source-position mapping)**,
   not text-matching.
4. Include the **search-index mitigation**: strip `<mark>` tags before indexing.
5. Toolbar appears in both the normal detail view and **focus mode**.

## Architecture

### Rendering pipeline today

`MemoizedMarkdown` renders `chat.content_md` with `react-markdown`
(`remarkGfm` + `rehypeRaw`) and a set of component overrides (`h1`–`h3`, `a`,
`code`, `pre`, mermaid). The view is read-only. The in-chat search already wraps
DOM text in `<mark class="search-highlight">` at runtime via a `TreeWalker`.

### Core idea (Approach 2)

`remark`/`rehype` nodes carry `position.start.offset` / `position.end.offset` —
character offsets into the exact `content_md` string we pass in. We expose those
offsets to the DOM, then map a DOM selection back to source offsets precisely.

A custom **rehype plugin** (`rehypeSourcePositions`) walks the hast tree and wraps
every eligible **text node** in an inert `<span class="md-pos" data-md-start=S
data-md-end=E>` carrying its source offsets. Because a markdown `text` node's
rendered characters map 1:1 to its source slice (for plain text), a selection
boundary inside such a span maps to source offset `S + offsetWithinTextNode`.

To add a highlight we compute the source range(s) covered by the selection, wrap
them in `<mark>` tags, and write the new string back to `content_md`.

#### Eligibility / exclusions (handled by the plugin)

- **Skip text inside `code` / `pre`** (and therefore mermaid): wrapping their text
  would break the mermaid component (which does `String(children)`), and
  highlighting code is undesirable. These text nodes are left bare and are simply
  not highlightable.
- **Skip text nodes without `position` offsets** (e.g., anything whose offsets did
  not survive raw re-parsing). They render normally but are not highlightable.
- No new npm dependency: the plugin is a small hand-written recursive walker (no
  `unist-util-visit`).

### De-risking step (FIRST implementation task)

Before building on it, verify at runtime that text nodes still carry
`position.*.offset` **after `rehypeRaw`** in this project's pipeline (a temporary
`console.log` spike in a rehype plugin). `hast-util-raw` is documented to preserve
positional info, but this assumption is load-bearing and must be confirmed first.
If offsets are missing, enable position tracking explicitly before proceeding.

## Components & files

### New

- `src/lib/highlight.ts` — pure, DOM-aware helpers (unit-testable where possible):
  - `rehypeSourcePositions()` — the rehype plugin described above.
  - `computeSourceRanges(selection, container): Range[] | null` — maps a DOM
    selection to a list of `{start, end}` source offsets (see algorithm). Returns
    `null` when nothing is mappable.
  - `applyHighlight(md, ranges, colorClass, id): string` — inserts
    `<mark class="hl-…" data-hl="id">…</mark>` at the given ranges (inserted from
    highest offset to lowest to keep offsets valid).
  - `removeHighlight(md, id): string` — unwraps every `<mark data-hl="id">…</mark>`,
    keeping inner content.
  - `recolorHighlight(md, id, colorClass): string` — swaps the class on every mark
    with that `data-hl`.
  - `stripHighlights(md): string` — removes `</?mark[^>]*>` tags (for indexing).
  - `newHighlightId(): string` — short unique id (8 chars).
- `src/components/ChatDetail/MarkdownToolbar.tsx` — the toolbar. Renders tool
  controls; v1 = highlighter (color palette) + contextual remove/recolor when a
  highlight is active. Designed so future tools are added as siblings.

### Changed

- `src/components/ChatDetail/ChatDetail.tsx`
  - Add `rehypeSourcePositions` to the `rehypePlugins` array in `MemoizedMarkdown`.
  - Override the `mark` component to attach an `onClick` that sets the active
    highlight id (read from `data-hl`) — for remove/recolor.
  - Render `<MarkdownToolbar>` above `.detail-content-main` in both the normal
    return and the `focusMode` return.
  - Hold UI state: `activeHighlightId`, and a transient "can't highlight this
    selection" notice.
  - On add/remove/recolor, compute the new markdown and call
    `onUpdateChat(chat.id, { content_md: newMd })`.
- `src/lib/db.ts`
  - Add `stripHighlights()` usage at **every** index call site (`insertChat`,
    `updateChat`, `restoreChat`, and the `reindex_all` paths) so the Tantivy index
    never sees `<mark>` tags. Centralize via a single helper import from
    `highlight.ts`.
- `src/index.css`
  - Add `.md-content mark.hl-yellow|hl-green|hl-pink|hl-blue` (theme-aware), plus a
    subtle affordance (cursor/pointer) so highlights look clickable. Add
    `.md-pos { /* inert inline wrapper, no visual change */ }`.
  - Add `.md-toolbar` styles (thin bar, swatches, active state).

## Data flow

### Add

1. User selects text in `.md-content`; clicks a color swatch in the toolbar.
2. `computeSourceRanges(window.getSelection(), contentRef.current)`:
   - Reject if the selection is empty/collapsed or its anchor/focus is outside the
     container.
   - Walk text nodes intersected by the range. For each:
     - Its parent must be a `.md-pos` span with `data-md-start = S`; otherwise the
       node is **unmappable** → skipped.
     - **Correctness guard:** only do sub-node offset math when the text node's
       rendered length equals its source slice length (`E - S === node.length`).
       If they differ (escapes/entities like `&amp;`, `\*`), the node is mappable
       only as a **whole** (if fully selected) — otherwise skipped.
     - `withinStart = node === range.startContainer ? range.startOffset : 0`
     - `withinEnd   = node === range.endContainer   ? range.endOffset   : node.length`
     - Emit source range `[S + withinStart, S + withinEnd)`.
   - If **no** ranges are mappable → return `null` (caller shows the transient
     notice, makes no change).
3. `id = newHighlightId()`; `newMd = applyHighlight(content_md, ranges, "hl-<color>", id)`.
4. `onUpdateChat(chat.id, { content_md: newMd })` → persists + re-indexes (stripped).
5. Re-render shows the highlight; selection is cleared.

Per-text-node ranges (rather than one span from global start to global end) keep
each `<mark>` within a single block, avoiding invalid mark nesting across block
boundaries. A multi-node selection produces several marks sharing **one** `data-hl`
id, so removing/recoloring treats them as a single logical highlight.

### Remove / recolor

1. User clicks an existing highlight → `mark` `onClick` sets `activeHighlightId`
   from `data-hl`. Toolbar shows a trash button + the color swatches.
2. Remove → `removeHighlight(content_md, id)`; recolor → `recolorHighlight(...)`.
3. `onUpdateChat(chat.id, { content_md: newMd })`; clear `activeHighlightId`.

These operations are **robust** (independent of source-position mapping) because
marks are explicit tags addressed by their unique `data-hl` id.

## Rendering & CSS

- `<mark class="hl-yellow" data-hl="…">` renders via `rehypeRaw` (already enabled).
- Four color classes, defined with theme-aware backgrounds and readable foreground,
  reusing existing CSS variables where possible. Distinct from
  `mark.search-highlight` (search marks may nest inside; that's fine).
- `.md-pos` spans are display-inline with no box/spacing changes.

## Search-index mitigation

`stripHighlights(md)` removes `</?mark[^>]*>` (keeping inner text) and is applied to
the `contentMd` passed to `index_chat` / `reindex_all` at every call site in
`db.ts`. The DB still stores the marks in `content_md`; only the search documents
are cleaned, so highlighted words remain searchable without tag noise.

## Edge cases & caveats

- **Re-parse wipes highlights:** `onReparseHtml` regenerates `content_md` from
  `content_html`, discarding all `<mark>`s. Documented v1 limitation (re-parse is
  rare and already destructive). Not mitigated in v1.
- **Entities / escapes:** guarded — sub-node offset math only runs when source slice
  length equals rendered length; otherwise whole-node-only or skip. No corruption.
- **Code / pre / mermaid:** not highlightable by design.
- **Selection spanning blocks:** handled by per-text-node marks; no invalid nesting.
- **Unmappable selection** (raw-reparsed text, code, zero mappable nodes): no-op +
  transient notice; never corrupts the source.
- **DOM weight:** wrapping every eligible text node in a span increases inline node
  count. Acceptable for typical chats; flagged for very large documents (no
  virtualization today). Revisit only if it becomes a problem.
- **Idempotent/nested marks:** adding a highlight over already-highlighted text is
  allowed; nested `<mark>`s render fine. (No merge logic in v1.)

## Non-goals (v1)

- Surviving a re-parse.
- Highlighting inside code blocks.
- Merging/normalizing overlapping highlights.
- Additional toolbar tools (bold, notes, etc.) — the toolbar is built to host them
  later, but none ship now.
- Keyboard shortcut for highlighting (could be added later).

## Testing strategy

- **Unit (pure functions in `highlight.ts`):** `applyHighlight`, `removeHighlight`,
  `recolorHighlight`, `stripHighlights` over representative `content_md` strings
  (single range, multi range/shared id, nested, entities present).
- **De-risk spike:** confirm `position` offsets exist on text nodes post-`rehypeRaw`.
- **Manual:** select within a paragraph, across bold/links, across two paragraphs,
  inside a code block (should no-op), recolor, remove; reopen chat (persists);
  verify in-chat search still finds highlighted words; verify Tantivy search isn't
  polluted by tags.

## Open risks

1. Source positions not surviving `rehypeRaw` for some node types → addressed by the
   de-risk spike; fallback is to skip unmappable nodes (feature degrades, never
   corrupts).
2. `react-markdown` passing `data-*` props through to the custom `mark`/`span`
   components — verified during implementation; data attributes are standard
   pass-through.
