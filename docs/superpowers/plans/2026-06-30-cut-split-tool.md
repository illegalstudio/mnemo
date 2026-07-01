# Cut / Split Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scissors tool to the markdown toolbar that snaps a guide line to block boundaries and offers Delete above / Delete below / Split at that point.

**Architecture:** Extend the existing `rehypeSourcePositions` plugin to tag block elements with their source offset; a DOM helper turns those into snap boundaries; pure functions slice `content_md`; `splitChat` creates a second note from the part below. The toolbar gains a mutually-exclusive tool mode (`none`/`highlight`/`cut`).

**Tech Stack:** React 19 + TypeScript, react-markdown@10 (remark-gfm, rehype-raw), Bun (`bun test`), Tauri, SQLite via `@tauri-apps/plugin-sql`.

## Global Constraints

- Block annotation attribute is exactly `data-md-block-start` (read via `el.dataset.mdBlockStart`); annotated block tags: `p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, hr`.
- Cut units (snap points) are annotated blocks whose parent is the content container (top-level) OR a `UL`/`OL` (list items). The guide line appears only in gaps *between* consecutive cut units.
- Boundary offset = the `data-md-block-start` of the block **below** the gap. Delete above = keep from offset; Delete below = keep up to offset; Split = above stays, below → new note.
- Split-off note inherits source + folder + tags; title = first markdown heading in the part below, else `"<title> (2)"`; no AI re-analysis; user stays on the current note.
- Delete shows a confirmation, then an Undo affordance for ~6s restoring the previous `content_md`.
- Tool mode is mutually exclusive (`type ToolMode = "none" | "highlight" | "cut"`); `Esc` resets to `"none"`; switching chats resets to `"none"`.
- `src/lib/highlight.ts` and `src/lib/cut.ts` must stay DOM-free (importable by `bun test`); DOM code lives in `src/lib/cut-dom.ts`.
- Verify TypeScript with `bun run build` (NOT `npx tsc --noEmit`, which is a no-op here — `tsconfig.json` is a references stub). `*.test.ts` are excluded from the app build and run via `bun test`.
- Commit messages: concise, no `Co-Authored-By` line.

---

### Task 1: Annotate block elements with source offsets (+ de-risk)

**Files:**
- Modify: `src/lib/highlight.ts` (the `HastElement` type and `walkHast`, ~lines 113-157)
- Test: `src/lib/cut-plugin.test.ts`

**Interfaces:**
- Consumes: existing `rehypeSourcePositions` pipeline.
- Produces: block elements (`p,h1-6,li,blockquote,pre,table,hr`) carry `data-md-block-start="<sourceOffset>"`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/cut-plugin.test.ts`:
```ts
import { test, expect } from "bun:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import { rehypeSourcePositions } from "./highlight";

function toHast(md: string) {
  const p = unified().use(remarkParse).use(remarkGfm).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw);
  return p.runSync(p.parse(md)) as any;
}

function collect(node: any, acc: any[] = []): any[] {
  if (node.type === "element" && node.properties?.["data-md-block-start"] != null) acc.push(node);
  for (const c of node.children ?? []) collect(c, acc);
  return acc;
}

test("block elements get data-md-block-start pointing at the block's source start", () => {
  const md = "## Heading\n\nA paragraph.\n\n- first item\n- second item\n";
  const hast = toHast(md);
  rehypeSourcePositions()(hast);
  const blocks = collect(hast);
  // tag -> source offset; verify the source at that offset begins the block.
  const byTag: Record<string, number> = {};
  for (const b of blocks) byTag[b.tagName] ??= Number(b.properties["data-md-block-start"]);

  expect(md.startsWith("## Heading", byTag["h2"])).toBe(true);
  expect(md.startsWith("A paragraph.", byTag["p"])).toBe(true);
  // first li starts at the "- first item" marker
  const liStart = Number(blocks.find((b) => b.tagName === "li").properties["data-md-block-start"]);
  expect(md.startsWith("- first item", liStart)).toBe(true);
});

test("each list item gets its own block-start at its marker", () => {
  const md = "- alpha\n- beta\n- gamma\n";
  const hast = toHast(md);
  rehypeSourcePositions()(hast);
  const lis = collect(hast).filter((b) => b.tagName === "li");
  expect(lis.length).toBe(3);
  const starts = lis.map((b) => Number(b.properties["data-md-block-start"])).sort((a, b) => a - b);
  expect(md.startsWith("- alpha", starts[0])).toBe(true);
  expect(md.startsWith("- beta", starts[1])).toBe(true);
  expect(md.startsWith("- gamma", starts[2])).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/lib/cut-plugin.test.ts`
Expected: FAIL (no `data-md-block-start` attributes yet). If instead it errors that block elements have no `position`, STOP — the de-risk failed and the approach needs revisiting; report back.

- [ ] **Step 3: Add `position` to the `HastElement` type**

In `src/lib/highlight.ts`, change the `HastElement` interface to include an optional position:
```ts
interface HastElement {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children: HastChild[];
  position?: { start?: { offset?: number } };
}
```

- [ ] **Step 4: Annotate block elements in `walkHast`**

In `src/lib/highlight.ts`, add the block-tag set next to `SKIP_TAGS`:
```ts
const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "table", "hr"]);
```
Then, inside `walkHast`, in the `if (child.type === "element")` branch, annotate before recursing:
```ts
    if (child.type === "element") {
      const el = child as HastElement;
      if (BLOCK_TAGS.has(el.tagName)) {
        const blockStart = el.position?.start?.offset;
        if (blockStart != null) {
          el.properties = el.properties ?? {};
          el.properties["data-md-block-start"] = String(blockStart);
        }
      }
      walkHast(el, inSkip || SKIP_TAGS.has(el.tagName));
    } else if (child.type === "text" && !inSkip) {
```
(The text-node branch below is unchanged.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test src/lib/cut-plugin.test.ts`
Expected: PASS (2 tests). Then run the whole suite: `bun test` → all green (existing highlight tests unaffected).

- [ ] **Step 6: Build**

Run: `bun run build`
Expected: `✓ built` with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/highlight.ts src/lib/cut-plugin.test.ts
git commit -m "feat: annotate block elements with source offsets for the cut tool"
```

---

### Task 2: Pure markdown cut operations (`cut.ts`)

**Files:**
- Create: `src/lib/cut.ts`
- Test: `src/lib/cut.test.ts`

**Interfaces:**
- Produces (used by Tasks 4, 7):
  - `deleteAbove(md: string, offset: number): string`
  - `deleteBelow(md: string, offset: number): string`
  - `splitMarkdown(md: string, offset: number): { above: string; below: string }`
  - `deriveSplitTitle(belowMd: string, originalTitle: string): string`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/cut.test.ts`:
```ts
import { test, expect } from "bun:test";
import { deleteAbove, deleteBelow, splitMarkdown, deriveSplitTitle } from "./cut";

const md = "# A\n\nbody text\n\n## B\n\nmore text\n";
const at = md.indexOf("## B");

test("deleteAbove keeps from the offset, trimming leading whitespace", () => {
  expect(deleteAbove(md, at)).toBe("## B\n\nmore text");
});

test("deleteBelow keeps up to the offset, trimming trailing whitespace", () => {
  expect(deleteBelow(md, at)).toBe("# A\n\nbody text");
});

test("splitMarkdown returns trimmed above/below halves", () => {
  expect(splitMarkdown(md, at)).toEqual({ above: "# A\n\nbody text", below: "## B\n\nmore text" });
});

test("deriveSplitTitle uses the first heading in the part below", () => {
  expect(deriveSplitTitle("## Section two\n\ntext", "Orig")).toBe("Section two");
});

test("deriveSplitTitle finds a heading even if not on the first line", () => {
  expect(deriveSplitTitle("intro line\n\n### Deep\n\nx", "Orig")).toBe("Deep");
});

test("deriveSplitTitle falls back to '<title> (2)' when there is no heading", () => {
  expect(deriveSplitTitle("just text, no heading", "Orig")).toBe("Orig (2)");
});

test("deriveSplitTitle strips trailing closing hashes", () => {
  expect(deriveSplitTitle("# Title #\n", "Orig")).toBe("Title");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/lib/cut.test.ts`
Expected: FAIL (module `./cut` not found).

- [ ] **Step 3: Implement `cut.ts`**

Create `src/lib/cut.ts`:
```ts
export function deleteAbove(md: string, offset: number): string {
  return md.slice(offset).replace(/^\s+/, "");
}

export function deleteBelow(md: string, offset: number): string {
  return md.slice(0, offset).replace(/\s+$/, "");
}

export function splitMarkdown(md: string, offset: number): { above: string; below: string } {
  return {
    above: md.slice(0, offset).replace(/\s+$/, ""),
    below: md.slice(offset).replace(/^\s+/, ""),
  };
}

export function deriveSplitTitle(belowMd: string, originalTitle: string): string {
  const m = belowMd.match(/^#{1,6}\s+(.+?)\s*#*\s*$/m);
  if (m) return m[1].trim();
  return `${originalTitle} (2)`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/lib/cut.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Build**

Run: `bun run build`
Expected: `✓ built`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cut.ts src/lib/cut.test.ts
git commit -m "feat: pure markdown cut/split operations"
```

---

### Task 3: Cut boundaries from the DOM (`cut-dom.ts`)

**Files:**
- Create: `src/lib/cut-dom.ts`
- Test: `src/lib/cut-dom.test.ts`

**Interfaces:**
- Produces (used by Task 6):
  - `interface CutBoundary { y: number; offset: number }`
  - `getCutBoundaries(container: HTMLElement): CutBoundary[]`
  - `nearestBoundary(boundaries: CutBoundary[], y: number): CutBoundary | null`

- [ ] **Step 1: Write the failing test (pure part)**

Create `src/lib/cut-dom.test.ts`:
```ts
import { test, expect } from "bun:test";
import { nearestBoundary, type CutBoundary } from "./cut-dom";

const bs: CutBoundary[] = [
  { y: 10, offset: 5 },
  { y: 50, offset: 20 },
  { y: 200, offset: 99 },
];

test("nearestBoundary returns the closest boundary by y", () => {
  expect(nearestBoundary(bs, 12)).toEqual({ y: 10, offset: 5 });
  expect(nearestBoundary(bs, 40)).toEqual({ y: 50, offset: 20 });
  expect(nearestBoundary(bs, 1000)).toEqual({ y: 200, offset: 99 });
});

test("nearestBoundary returns null for an empty list", () => {
  expect(nearestBoundary([], 5)).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/lib/cut-dom.test.ts`
Expected: FAIL (module `./cut-dom` not found).

- [ ] **Step 3: Implement `cut-dom.ts`**

Create `src/lib/cut-dom.ts`:
```ts
export interface CutBoundary {
  y: number; // position in the container's scroll-content coordinate space
  offset: number; // content_md offset of the block below the gap
}

// Pure: the boundary whose y is closest to the target y.
export function nearestBoundary(boundaries: CutBoundary[], y: number): CutBoundary | null {
  let best: CutBoundary | null = null;
  let bestDist = Infinity;
  for (const b of boundaries) {
    const d = Math.abs(b.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best;
}

// DOM: gaps between consecutive cut units (top-level blocks and list items).
export function getCutBoundaries(container: HTMLElement): CutBoundary[] {
  const isCutUnit = (el: HTMLElement): boolean => {
    const p = el.parentElement;
    return p === container || (!!p && (p.tagName === "UL" || p.tagName === "OL"));
  };
  const containerTop = container.getBoundingClientRect().top;
  const scrollTop = container.scrollTop;
  const items = Array.from(container.querySelectorAll<HTMLElement>("[data-md-block-start]"))
    .filter(isCutUnit)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        top: r.top - containerTop + scrollTop,
        bottom: r.bottom - containerTop + scrollTop,
        offset: Number(el.dataset.mdBlockStart),
      };
    })
    .filter((it) => !Number.isNaN(it.offset))
    .sort((a, b) => a.top - b.top);

  const boundaries: CutBoundary[] = [];
  for (let i = 0; i < items.length - 1; i++) {
    boundaries.push({ y: (items[i].bottom + items[i + 1].top) / 2, offset: items[i + 1].offset });
  }
  return boundaries;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/cut-dom.test.ts`
Expected: PASS (2 tests). `getCutBoundaries` is DOM-dependent and is verified manually in Task 6.

- [ ] **Step 5: Build**

Run: `bun run build`
Expected: `✓ built`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cut-dom.ts src/lib/cut-dom.test.ts
git commit -m "feat: compute cut boundaries from rendered blocks"
```

---

### Task 4: `splitChat` in useDatabase + thread to ChatDetail

**Files:**
- Modify: `src/hooks/useDatabase.ts` (add `splitChat`, export it in the return object ~line 432)
- Modify: `src/App.tsx` (destructure `splitChat` ~line 59; pass `onSplitChat` and `onOpenChat` to `<ChatDetail>` ~line 482)
- Modify: `src/components/ChatDetail/ChatDetail.tsx` (extend `ChatDetailProps`)

**Interfaces:**
- Consumes: `splitMarkdown`, `deriveSplitTitle` from `../lib/cut`; `db.insertChat`, `db.getTagsForChat`, `db.addTagToChat`, `db.updateChat`, `db.getAllChats`.
- Produces: `splitChat(chatId: string, offset: number): Promise<Chat | null>`; `ChatDetailProps.onSplitChat` and `ChatDetailProps.onOpenChat`.

- [ ] **Step 1: Import the pure ops in useDatabase**

In `src/hooks/useDatabase.ts`, add near the other imports:
```ts
import { splitMarkdown, deriveSplitTitle } from "../lib/cut";
```

- [ ] **Step 2: Implement `splitChat`**

In `src/hooks/useDatabase.ts`, add this callback alongside the other `useCallback`s (e.g., just after `importFile`):
```ts
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
```

- [ ] **Step 3: Export `splitChat` from the hook**

In the `return { ... }` object of `useDatabase` (~line 432), add `splitChat,` (e.g., right after `importFile,`).

- [ ] **Step 4: Extend `ChatDetailProps`**

In `src/components/ChatDetail/ChatDetail.tsx`, add to the `ChatDetailProps` interface:
```ts
  onSplitChat: (chatId: string, offset: number) => Promise<Chat | null>;
  onOpenChat: (chatId: string) => void;
```
(`Chat` is already imported at the top of the file.)

- [ ] **Step 5: Wire props in App**

In `src/App.tsx`, add `splitChat` to the `useDatabase()` destructure (~line 59, near `importFile, updateChat`). Then in the `<ChatDetail ... />` JSX (~line 482), add:
```tsx
                  onSplitChat={splitChat}
                  onOpenChat={(id) => {
                    const c = chats.find((x) => x.id === id);
                    if (c) setSelectedChat(c);
                  }}
```
(`chats` and `setSelectedChat` are already destructured from `useDatabase()`.)

- [ ] **Step 6: Build**

Run: `bun run build`
Expected: `✓ built` (props are now required; the single `<ChatDetail>` call site supplies them). Also run `bun test` → still green.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useDatabase.ts src/App.tsx src/components/ChatDetail/ChatDetail.tsx
git commit -m "feat: splitChat creates a second note from the part below"
```

---

### Task 5: Tool mode refactor + scissors button

**Files:**
- Modify: `src/components/ChatDetail/MarkdownToolbar.tsx` (two tools)
- Modify: `src/components/ChatDetail/ChatDetail.tsx` (`armed` → `tool` mode)
- Modify: `src/index.css` (crosshair for cut mode)

**Interfaces:**
- Produces: `export type ToolMode = "none" | "highlight" | "cut"` from `MarkdownToolbar`; `ChatDetail` holds `tool` state used by Task 6.

- [ ] **Step 1: Rewrite `MarkdownToolbar` with two tools**

Replace the whole of `src/components/ChatDetail/MarkdownToolbar.tsx` with:
```tsx
export type ToolMode = "none" | "highlight" | "cut";

interface MarkdownToolbarProps {
  tool: ToolMode;
  notice: string | null;
  onToggleHighlight: () => void;
  onToggleCut: () => void;
}

export default function MarkdownToolbar({ tool, notice, onToggleHighlight, onToggleCut }: MarkdownToolbarProps) {
  return (
    <div className="md-toolbar">
      <button
        type="button"
        className={`md-toolbar-btn${tool === "highlight" ? " armed" : ""}`}
        title={tool === "highlight" ? "Highlighter on — drag over text to highlight (Esc to stop)" : "Highlighter — click, then drag over the text"}
        aria-pressed={tool === "highlight"}
        onClick={onToggleHighlight}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 11-6 6v3h9l3-3" />
          <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
        </svg>
      </button>
      <button
        type="button"
        className={`md-toolbar-btn${tool === "cut" ? " armed" : ""}`}
        title={tool === "cut" ? "Cut on — click between blocks to delete or split (Esc to stop)" : "Cut — click, then pick a spot between blocks"}
        aria-pressed={tool === "cut"}
        onClick={onToggleCut}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <line x1="20" y1="4" x2="8.12" y2="15.88" />
          <line x1="14.47" y1="14.48" x2="20" y2="20" />
          <line x1="8.12" y1="8.12" x2="12" y2="12" />
        </svg>
      </button>
      {tool === "highlight" && <span className="md-toolbar-status">Drag to highlight · Esc to stop</span>}
      {tool === "cut" && <span className="md-toolbar-status">Click between blocks · Esc to stop</span>}
      {notice && <span className="md-toolbar-notice">{notice}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Refactor `ChatDetail` state from `armed` to `tool`**

In `src/components/ChatDetail/ChatDetail.tsx`:

(a) Update the toolbar import to also pull the type:
```tsx
import MarkdownToolbar, { type ToolMode } from "./MarkdownToolbar";
```

(b) Replace the state declaration `const [armed, setArmed] = useState(false);` with:
```tsx
  const [tool, setTool] = useState<ToolMode>("none");
```

(c) In the `[chat.id]` reset effect, replace `setArmed(false);` with:
```tsx
    setTool("none");
```

(d) Replace `handleToggleHighlighter` with two togglers:
```tsx
  const handleToggleHighlight = useCallback(() => {
    setTool((t) => (t === "highlight" ? "none" : "highlight"));
  }, []);
  const handleToggleCut = useCallback(() => {
    setTool((t) => (t === "cut" ? "none" : "cut"));
  }, []);
```

(e) In the highlight mouseup effect, change the guard `if (!armed) return;` to `if (tool !== "highlight") return;`, change the apply call's color arg to keep `"yellow"`, and update its dependency array from `[armed, ...]` to `[tool, chat.id, chat.content_md, onUpdateChat, focusMode]`.

(f) Replace the Esc effect with one that exits any tool:
```tsx
  useEffect(() => {
    if (tool === "none") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setTool("none"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool]);
```

(g) In BOTH content-container `className` template literals, replace `${armed ? " hl-armed" : ""}` with:
```tsx
${tool === "highlight" ? " hl-armed" : tool === "cut" ? " cut-armed" : ""}
```

(h) In BOTH `<MarkdownToolbar ... />` usages, replace the props `armed={armed} ... onToggle={handleToggleHighlighter}` with:
```tsx
              tool={tool}
              notice={hlNotice}
              onToggleHighlight={handleToggleHighlight}
              onToggleCut={handleToggleCut}
```

- [ ] **Step 3: Add crosshair CSS for cut mode**

In `src/index.css`, just after the existing `.md-content.hl-armed` rule, add:
```css
.md-content.cut-armed,
.md-content.cut-armed * {
  cursor: crosshair;
}
```

- [ ] **Step 4: Build and test**

Run: `bun run build` → `✓ built`; `bun test` → all green.

- [ ] **Step 5: Manual verification**

`bun run tauri dev`: the highlighter still works exactly as before; a second (scissors) button appears; clicking it shows a crosshair over the content and the "Click between blocks · Esc to stop" hint; the two tools are mutually exclusive; `Esc` exits.

- [ ] **Step 6: Commit**

```bash
git add src/components/ChatDetail/MarkdownToolbar.tsx src/components/ChatDetail/ChatDetail.tsx src/index.css
git commit -m "refactor: mutually-exclusive tool mode + scissors button"
```

---

### Task 6: CutOverlay — guide line + action menu

**Files:**
- Create: `src/components/ChatDetail/CutOverlay.tsx`
- Modify: `src/components/ChatDetail/ChatDetail.tsx` (render `CutOverlay` when `tool === "cut"`, with stub handlers)
- Modify: `src/index.css` (guide line + menu)

**Interfaces:**
- Consumes: `getCutBoundaries`, `nearestBoundary`, `type CutBoundary` from `../../lib/cut-dom`.
- Produces: `CutOverlay` calling `onDeleteAbove(offset)`, `onDeleteBelow(offset)`, `onSplit(offset)`.

- [ ] **Step 1: Create the `CutOverlay` component**

Create `src/components/ChatDetail/CutOverlay.tsx`:
```tsx
import { useEffect, useRef, useState, useCallback } from "react";
import { getCutBoundaries, nearestBoundary, type CutBoundary } from "../../lib/cut-dom";

interface CutOverlayProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  contentMd: string;
  onDeleteAbove: (offset: number) => void;
  onDeleteBelow: (offset: number) => void;
  onSplit: (offset: number) => void;
}

export default function CutOverlay({ containerRef, contentMd, onDeleteAbove, onDeleteBelow, onSplit }: CutOverlayProps) {
  const boundaries = useRef<CutBoundary[]>([]);
  const [lineY, setLineY] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; offset: number } | null>(null);
  const current = useRef<CutBoundary | null>(null);

  const recompute = useCallback(() => {
    const c = containerRef.current;
    if (c) boundaries.current = getCutBoundaries(c);
  }, [containerRef]);

  // Recompute boundaries when the tool opens, the content changes, or layout shifts.
  useEffect(() => {
    recompute();
    const c = containerRef.current;
    if (!c) return;
    c.addEventListener("scroll", recompute);
    window.addEventListener("resize", recompute);
    return () => {
      c.removeEventListener("scroll", recompute);
      window.removeEventListener("resize", recompute);
    };
  }, [recompute, contentMd]);

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const onMove = (e: MouseEvent) => {
      if (menu) return; // freeze the line while the menu is open
      const rect = c.getBoundingClientRect();
      const yInContent = e.clientY - rect.top + c.scrollTop;
      const b = nearestBoundary(boundaries.current, yInContent);
      current.current = b;
      setLineY(b ? b.y : null);
    };
    const onClick = (e: MouseEvent) => {
      if (!current.current) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, offset: current.current.offset });
    };
    c.addEventListener("mousemove", onMove);
    c.addEventListener("click", onClick);
    return () => {
      c.removeEventListener("mousemove", onMove);
      c.removeEventListener("click", onClick);
    };
  }, [containerRef, menu]);

  // Close the menu on Escape or outside click.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest(".cut-menu")) setMenu(null);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [menu]);

  const act = (fn: (offset: number) => void) => {
    if (menu) fn(menu.offset);
    setMenu(null);
  };

  return (
    <>
      {lineY != null && <div className="cut-line" style={{ top: lineY }} />}
      {menu && (
        <div className="cut-menu" style={{ left: menu.x, top: menu.y }}>
          <button type="button" onClick={() => act(onDeleteAbove)}>Delete above</button>
          <button type="button" onClick={() => act(onDeleteBelow)}>Delete below</button>
          <button type="button" onClick={() => act(onSplit)}>Split</button>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Render `CutOverlay` from ChatDetail with stub handlers**

In `src/components/ChatDetail/ChatDetail.tsx`, add the import:
```tsx
import CutOverlay from "./CutOverlay";
```
Then, in BOTH content containers (focus and normal), immediately after the `<MarkdownToolbar .../>` element, add:
```tsx
            {tool === "cut" && (
              <CutOverlay
                containerRef={contentRef}
                contentMd={chat.content_md}
                onDeleteAbove={(offset) => console.warn("deleteAbove", offset)}
                onDeleteBelow={(offset) => console.warn("deleteBelow", offset)}
                onSplit={(offset) => console.warn("split", offset)}
              />
            )}
```
(These stubs are replaced in Task 7.)

- [ ] **Step 3: Make the content container a positioning context + style the line and menu**

In `src/index.css`, add:
```css
/* Cut tool: the content container anchors the absolutely-positioned guide line */
.md-content.cut-armed {
  position: relative;
  user-select: none;
}
.cut-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  border-top: 2px dashed var(--red);
  pointer-events: none;
  z-index: 6;
}
.cut-menu {
  position: fixed;
  z-index: 50;
  display: flex;
  flex-direction: column;
  min-width: 140px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}
.cut-menu button {
  text-align: left;
  background: none;
  border: none;
  color: var(--text-primary);
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.cut-menu button:hover {
  background: var(--bg-hover);
}
```

- [ ] **Step 4: Build and test**

Run: `bun run build` → `✓ built`; `bun test` → green.

- [ ] **Step 5: Manual verification**

`bun run tauri dev`: arm the scissors; moving the mouse over the content shows a red dashed line snapping to the gaps between paragraphs and between list items (and around a code block); clicking opens the 3-item menu at the cursor; choosing an item logs `deleteAbove/deleteBelow/split` with an offset to the console; `Esc`/outside-click closes the menu. (The actions are wired in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add src/components/ChatDetail/CutOverlay.tsx src/components/ChatDetail/ChatDetail.tsx src/index.css
git commit -m "feat: cut guide line and action menu overlay"
```

---

### Task 7: Wire cut actions — delete (confirm + undo) and split (toast)

**Files:**
- Modify: `src/components/ChatDetail/ChatDetail.tsx` (real handlers, confirm modal, undo toast, split toast)
- Modify: `src/index.css` (confirm modal reuse + toast)

**Interfaces:**
- Consumes: `deleteAbove`, `deleteBelow` from `../../lib/cut`; `onSplitChat`, `onOpenChat` (Task 4); `onUpdateChat`.

- [ ] **Step 1: Import the pure delete ops**

In `src/components/ChatDetail/ChatDetail.tsx`, add to the `../../lib/cut` usage (new import line):
```tsx
import { deleteAbove, deleteBelow } from "../../lib/cut";
```

- [ ] **Step 2: Add cut-action state**

Near the other `useState`s in `ChatDetail`, add:
```tsx
  const [cutConfirm, setCutConfirm] = useState<{ direction: "above" | "below"; offset: number } | null>(null);
  const [cutUndo, setCutUndo] = useState<string | null>(null); // previous content_md
  const [splitToast, setSplitToast] = useState<string | null>(null); // new chat id
  const cutUndoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const splitToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```
In the `[chat.id]` reset effect, also add:
```tsx
    setCutConfirm(null);
    setCutUndo(null);
    setSplitToast(null);
    if (cutUndoTimer.current) { clearTimeout(cutUndoTimer.current); cutUndoTimer.current = null; }
    if (splitToastTimer.current) { clearTimeout(splitToastTimer.current); splitToastTimer.current = null; }
```

- [ ] **Step 3: Add the cut handlers**

In `ChatDetail`, near the other cut-related callbacks, add:
```tsx
  const performDelete = useCallback((direction: "above" | "below", offset: number) => {
    const prev = chat.content_md;
    const next = direction === "above" ? deleteAbove(prev, offset) : deleteBelow(prev, offset);
    onUpdateChat(chat.id, { content_md: next });
    setCutUndo(prev);
    if (cutUndoTimer.current) clearTimeout(cutUndoTimer.current);
    cutUndoTimer.current = setTimeout(() => setCutUndo(null), 6000);
  }, [chat.id, chat.content_md, onUpdateChat]);

  const handleCutUndo = useCallback(() => {
    if (cutUndo == null) return;
    onUpdateChat(chat.id, { content_md: cutUndo });
    setCutUndo(null);
    if (cutUndoTimer.current) { clearTimeout(cutUndoTimer.current); cutUndoTimer.current = null; }
  }, [cutUndo, chat.id, onUpdateChat]);

  const handleSplit = useCallback(async (offset: number) => {
    const newChat = await onSplitChat(chat.id, offset);
    if (newChat) {
      setSplitToast(newChat.id);
      if (splitToastTimer.current) clearTimeout(splitToastTimer.current);
      splitToastTimer.current = setTimeout(() => setSplitToast(null), 8000);
    }
  }, [chat.id, onSplitChat]);
```

- [ ] **Step 4: Connect the overlay handlers**

In BOTH `<CutOverlay ... />` usages, replace the three stub props with:
```tsx
                onDeleteAbove={(offset) => setCutConfirm({ direction: "above", offset })}
                onDeleteBelow={(offset) => setCutConfirm({ direction: "below", offset })}
                onSplit={(offset) => handleSplit(offset)}
```

- [ ] **Step 5: Render confirm modal + toasts (shared by both views)**

The scissors tool is available in both the focus and normal views, so the modals must render in both. To avoid duplicating JSX, define them once as a const BEFORE the `if (focusMode) { return ... }` early return in `ChatDetail`:
```tsx
  const cutModals = (
    <>
      {cutConfirm && (
        <div className="expand-modal-overlay" onClick={() => setCutConfirm(null)}>
          <div className="cut-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="cut-confirm-text">
              Delete the part {cutConfirm.direction} this line?
            </div>
            <div className="cut-confirm-actions">
              <button className="cut-confirm-cancel" onClick={() => setCutConfirm(null)}>Cancel</button>
              <button className="cut-confirm-delete" onClick={() => { performDelete(cutConfirm.direction, cutConfirm.offset); setCutConfirm(null); }}>Delete</button>
            </div>
          </div>
        </div>
      )}
      {cutUndo != null && (
        <div className="cut-toast">
          <span>Content deleted</span>
          <button onClick={handleCutUndo}>Undo</button>
        </div>
      )}
      {splitToast && (
        <div className="cut-toast">
          <span>Note split</span>
          <button onClick={() => { onOpenChat(splitToast); setSplitToast(null); }}>Open new note</button>
        </div>
      )}
    </>
  );
```
Then include `{cutModals}` once in the focus return (just before its root `</div>` closes) and once in the normal return (next to the other modals like `mdPreview`). Two insertion points, the same `{cutModals}` expression in each — do not re-inline the JSX.

- [ ] **Step 6: Style the confirm modal and toast**

In `src/index.css`, add:
```css
.cut-confirm {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 18px;
  max-width: 320px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
}
.cut-confirm-text {
  color: var(--text-primary);
  font-size: 14px;
  margin-bottom: 14px;
}
.cut-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.cut-confirm-actions button {
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--border-subtle);
}
.cut-confirm-cancel { background: none; color: var(--text-muted); }
.cut-confirm-delete { background: var(--red); border-color: var(--red); color: #fff; }
.cut-toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 10px 14px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  font-size: 13px;
  color: var(--text-primary);
}
.cut-toast button {
  background: none;
  border: none;
  color: var(--accent, #2d6eb4);
  font-weight: 600;
  cursor: pointer;
}
```

- [ ] **Step 7: Build and test**

Run: `bun run build` → `✓ built`; `bun test` → green.

- [ ] **Step 8: Manual verification**

`bun run tauri dev`:
1. Scissors → click between two blocks → menu → Delete above → confirm → top gone → Undo toast restores it within 6s.
2. Delete below similarly.
3. Split between two blocks → current note keeps the top; a new note exists with the bottom, same source/folder/tags, title from the bottom's first heading (or "<title> (2)"); "Open new note" toast switches to it.
4. Cutting between two list items splits the list cleanly; cutting around a code block works.

- [ ] **Step 9: Commit**

```bash
git add src/components/ChatDetail/ChatDetail.tsx src/index.css
git commit -m "feat: cut actions — delete with confirm+undo, split with toast"
```

---

## Self-Review

**Spec coverage:**
- Scissors tool + crosshair → Tasks 5, 6.
- Guide line snapping between blocks incl. list items → Tasks 1, 3, 6.
- Block source offsets via the plugin → Task 1.
- Boundary offset = below block's start; delete above/below/split slicing → Tasks 2, 7.
- Split inherits source+folder+tags, derived title, no AI, stay on current + toast → Tasks 2, 4, 7.
- Delete confirm + undo (~6s) → Task 7.
- Mutually-exclusive tool mode + Esc + reset on chat change → Task 5.
- De-risk block offsets first → Task 1 (Step 2 gate).
- DOM-free `cut.ts`/`highlight.ts`, DOM in `cut-dom.ts` → Tasks 1-3.
- Re-index on edit handled by existing `insertChat`/`updateChat` → Task 4 (no extra work).
- Verify with `bun run build` not `npx tsc --noEmit` → Global Constraints, every build step.

**Placeholder scan:** None — every code step contains full code; manual-verification steps describe concrete observable outcomes.

**Type consistency:** `CutBoundary`, `getCutBoundaries`, `nearestBoundary`, `deleteAbove`, `deleteBelow`, `splitMarkdown`, `deriveSplitTitle`, `splitChat`, `ToolMode`, `onSplitChat`, `onOpenChat`, and `data-md-block-start` are used with identical names/signatures across tasks.

## Notes / Known limitations (from the spec)

- No sub-block precision (can't cut inside a paragraph or code block).
- Cutting inside a multi-paragraph blockquote is possible but rare; not specially handled.
- Undo holds the previous `content_md` only until the 6s timer or a chat change.
- Split has no undo (non-destructive; merge back manually).
