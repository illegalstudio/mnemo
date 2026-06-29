# Markdown Highlight Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toolbar above the rendered chat markdown whose first tool is a multi-color highlighter that writes `<mark>` tags into `content_md` by precisely mapping a rendered-text selection back to source offsets.

**Architecture:** A rehype plugin wraps every eligible markdown text node in an inert `<span class="md-pos" data-md-start data-md-end>` carrying its source offsets. A DOM helper maps the current selection to source ranges using those offsets; pure string helpers insert/remove/recolor `<mark class="hl-…" data-hl="…">` tags in `content_md`. Saving flows through the existing `updateChat` (persist + re-index); the index is fed a tag-stripped copy.

**Tech Stack:** React 19 + TypeScript, `react-markdown@10` (`remark-gfm`, `rehype-raw`), Vite, Bun (incl. `bun test`), Tauri.

## Global Constraints

- Highlights live in `content_md` as `<mark class="hl-<color>" data-hl="<id>">…</mark>`. Colors: `yellow`, `green`, `pink`, `blue` (exact class suffixes).
- Source-position mapping (Approach 2) only — never text-matching.
- DOM access must live in `src/lib/highlight-dom.ts`; `src/lib/highlight.ts` must stay DOM-free so `bun test` can import it.
- `rehype-raw` is already enabled and must remain; the new rehype plugin runs **after** it.
- Never let `<mark>` tags reach the Tantivy index: strip them at every index call site.
- Do not wrap text inside `code`/`pre` (keeps mermaid's `String(children)` intact).
- Follow existing code style (2-space indent, no semicolize changes, match surrounding patterns). No new runtime dependencies; dev-only deps allowed for tests.
- Commit messages: concise, no `Co-Authored-By` line.

---

### Task 1: De-risk — confirm source offsets survive `rehype-raw`

This validates the load-bearing assumption before anything is built on it.

**Files:**
- Create: `src/lib/pipeline.derisk.test.ts`
- Modify: `package.json` (devDependencies)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing imported by later tasks (proof-only). If it fails, STOP and revisit the design.

- [ ] **Step 1: Add dev dependencies used to replicate react-markdown's pipeline**

Run:
```bash
bun add -d unified remark-parse remark-rehype
```
Expected: `unified`, `remark-parse`, `remark-rehype` appear under `devDependencies`. (`remark-gfm` and `rehype-raw` are already direct deps.)

- [ ] **Step 2: Write the de-risk test**

Create `src/lib/pipeline.derisk.test.ts`:
```ts
import { test, expect } from "bun:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";

// Mirror react-markdown@10's pipeline: remark-parse -> remark-gfm ->
// remark-rehype(allowDangerousHtml) -> rehype-raw.
function toHast(md: string) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw);
  return processor.runSync(processor.parse(md));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findText(node: any, needle: string): any | null {
  if (node.type === "text" && typeof node.value === "string" && node.value.includes(needle)) return node;
  for (const c of node.children ?? []) {
    const hit = findText(c, needle);
    if (hit) return hit;
  }
  return null;
}

test("plain text nodes keep source offsets after rehype-raw", () => {
  const md = "Hello **world** and <mark>existing</mark> text here.\n";
  const hast = toHast(md);
  const node = findText(hast, "and ");
  expect(node).not.toBeNull();
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  expect(typeof start).toBe("number");
  expect(typeof end).toBe("number");
  // 1:1 mapping: the source slice equals the rendered text value.
  expect(md.slice(start, end)).toBe(node.value);
});
```

- [ ] **Step 3: Run the test**

Run: `bun test src/lib/pipeline.derisk.test.ts`
Expected: PASS (1 pass). If it FAILS (offsets `undefined` or slice mismatch), STOP — the rendered-selection approach is not viable as designed; report back before continuing.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock src/lib/pipeline.derisk.test.ts
git commit -m "test: confirm markdown source offsets survive rehype-raw"
```

---

### Task 2: Pure source-mutation helpers (`highlight.ts`)

**Files:**
- Create: `src/lib/highlight.ts`
- Test: `src/lib/highlight.test.ts`

**Interfaces:**
- Produces (imported by Tasks 4–7):
  - `type HighlightColor = "yellow" | "green" | "pink" | "blue"`
  - `const HIGHLIGHT_COLORS: HighlightColor[]`
  - `interface SourceRange { start: number; end: number }`
  - `newHighlightId(): string`
  - `applyHighlight(md: string, ranges: SourceRange[], color: HighlightColor, id: string): string`
  - `removeHighlight(md: string, id: string): string`
  - `recolorHighlight(md: string, id: string, color: HighlightColor): string`
  - `recolorHighlight`/`removeHighlight` ignore unknown ids (return `md` unchanged)
  - `mapSpanRange(mdStart: number, textLen: number, sourceLen: number, relStart: number, relEnd: number): SourceRange | null`
  - `stripHighlights(md: string): string`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/highlight.test.ts`:
```ts
import { test, expect } from "bun:test";
import {
  HIGHLIGHT_COLORS,
  newHighlightId,
  applyHighlight,
  removeHighlight,
  recolorHighlight,
  mapSpanRange,
  stripHighlights,
} from "./highlight";

test("newHighlightId returns 8 hex chars and varies", () => {
  const a = newHighlightId();
  const b = newHighlightId();
  expect(a).toMatch(/^[0-9a-f]{8}$/);
  expect(a).not.toBe(b);
});

test("applyHighlight wraps a single range", () => {
  const md = "the quick brown fox";
  const out = applyHighlight(md, [{ start: 4, end: 9 }], "yellow", "abc12345");
  expect(out).toBe('the <mark class="hl-yellow" data-hl="abc12345">quick</mark> brown fox');
});

test("applyHighlight wraps multiple ranges sharing one id, offsets stay valid", () => {
  const md = "alpha beta gamma";
  const out = applyHighlight(md, [{ start: 0, end: 5 }, { start: 11, end: 16 }], "green", "id000001");
  expect(out).toBe(
    '<mark class="hl-green" data-hl="id000001">alpha</mark> beta <mark class="hl-green" data-hl="id000001">gamma</mark>'
  );
});

test("applyHighlight ignores empty/zero-length ranges", () => {
  const md = "hello";
  expect(applyHighlight(md, [{ start: 2, end: 2 }], "blue", "id000002")).toBe("hello");
});

test("removeHighlight unwraps all marks with the id, keeping inner text", () => {
  const md = '<mark class="hl-green" data-hl="id000001">alpha</mark> beta <mark class="hl-green" data-hl="id000001">gamma</mark>';
  expect(removeHighlight(md, "id000001")).toBe("alpha beta gamma");
});

test("removeHighlight handles nested marks via stack matching", () => {
  const md = 'x <mark class="hl-yellow" data-hl="outer">a <mark class="hl-blue" data-hl="inner">b</mark> c</mark> y';
  expect(removeHighlight(md, "outer")).toBe('x a <mark class="hl-blue" data-hl="inner">b</mark> c y');
});

test("removeHighlight leaves unknown ids untouched", () => {
  const md = '<mark class="hl-pink" data-hl="known">z</mark>';
  expect(removeHighlight(md, "missing")).toBe(md);
});

test("recolorHighlight swaps the class on all marks with the id", () => {
  const md = '<mark class="hl-yellow" data-hl="id7">a</mark> b <mark class="hl-yellow" data-hl="id7">c</mark>';
  expect(recolorHighlight(md, "id7", "pink")).toBe(
    '<mark class="hl-pink" data-hl="id7">a</mark> b <mark class="hl-pink" data-hl="id7">c</mark>'
  );
});

test("mapSpanRange: precise sub-node mapping when lengths match", () => {
  expect(mapSpanRange(100, 5, 5, 1, 4)).toEqual({ start: 101, end: 104 });
});

test("mapSpanRange: whole-node mapping when source has escapes and node fully selected", () => {
  // node rendered length 3 ("a*b"), source length 4 ("a\\*b") -> whole node only
  expect(mapSpanRange(10, 3, 4, 0, 3)).toEqual({ start: 10, end: 14 });
});

test("mapSpanRange: partial selection over escaped node is unmappable", () => {
  expect(mapSpanRange(10, 3, 4, 1, 2)).toBeNull();
});

test("mapSpanRange: empty selection is null", () => {
  expect(mapSpanRange(0, 5, 5, 2, 2)).toBeNull();
});

test("stripHighlights removes mark tags, keeps text", () => {
  const md = 'a <mark class="hl-yellow" data-hl="id7">b c</mark> d';
  expect(stripHighlights(md)).toBe("a b c d");
});

test("HIGHLIGHT_COLORS lists the four colors", () => {
  expect(HIGHLIGHT_COLORS).toEqual(["yellow", "green", "pink", "blue"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/highlight.test.ts`
Expected: FAIL (module `./highlight` not found / exports missing).

- [ ] **Step 3: Implement `highlight.ts`**

Create `src/lib/highlight.ts`:
```ts
export type HighlightColor = "yellow" | "green" | "pink" | "blue";
export const HIGHLIGHT_COLORS: HighlightColor[] = ["yellow", "green", "pink", "blue"];

export interface SourceRange {
  start: number;
  end: number;
}

export function newHighlightId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function applyHighlight(
  md: string,
  ranges: SourceRange[],
  color: HighlightColor,
  id: string,
): string {
  // Insert from highest start to lowest so earlier offsets stay valid.
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => b.start - a.start);
  let out = md;
  for (const r of sorted) {
    const open = `<mark class="hl-${color}" data-hl="${id}">`;
    out = out.slice(0, r.start) + open + out.slice(r.start, r.end) + "</mark>" + out.slice(r.end);
  }
  return out;
}

export function removeHighlight(md: string, id: string): string {
  return transformMarksById(md, id, null);
}

export function recolorHighlight(md: string, id: string, color: HighlightColor): string {
  return transformMarksById(md, id, color);
}

export function stripHighlights(md: string): string {
  return md.replace(/<\/?mark\b[^>]*>/gi, "");
}

// Pure mapping with the correctness guard, used by the DOM layer.
export function mapSpanRange(
  mdStart: number,
  textLen: number,
  sourceLen: number,
  relStart: number,
  relEnd: number,
): SourceRange | null {
  const s = Math.max(0, Math.min(textLen, relStart));
  const e = Math.max(0, Math.min(textLen, relEnd));
  if (e <= s) return null;
  if (sourceLen === textLen) return { start: mdStart + s, end: mdStart + e };
  if (s === 0 && e === textLen) return { start: mdStart, end: mdStart + sourceLen };
  return null;
}

function transformMarksById(md: string, id: string, color: HighlightColor | null): string {
  const re = /<mark\b[^>]*>|<\/mark\s*>/gi;
  type Tok = { type: "open" | "close"; start: number; end: number; raw: string };
  const toks: Tok[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    toks.push({
      type: m[0][1] === "/" ? "close" : "open",
      start: m.index,
      end: m.index + m[0].length,
      raw: m[0],
    });
  }
  const edits: { start: number; end: number; replaceWith: string }[] = [];
  const stack: Tok[] = [];
  for (const t of toks) {
    if (t.type === "open") {
      stack.push(t);
    } else {
      const open = stack.pop();
      if (!open) continue;
      if (!markHasId(open.raw, id)) continue;
      if (color === null) {
        edits.push({ start: open.start, end: open.end, replaceWith: "" });
        edits.push({ start: t.start, end: t.end, replaceWith: "" });
      } else {
        edits.push({ start: open.start, end: open.end, replaceWith: setMarkColor(open.raw, color) });
      }
    }
  }
  edits.sort((a, b) => b.start - a.start);
  let out = md;
  for (const ed of edits) out = out.slice(0, ed.start) + ed.replaceWith + out.slice(ed.end);
  return out;
}

function markHasId(openTag: string, id: string): boolean {
  return new RegExp(`data-hl\\s*=\\s*["']${escapeRe(id)}["']`).test(openTag);
}

function setMarkColor(openTag: string, color: HighlightColor): string {
  return openTag.replace(/class\s*=\s*["'][^"']*["']/i, `class="hl-${color}"`);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/highlight.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/highlight.ts src/lib/highlight.test.ts
git commit -m "feat: pure highlight source-mutation helpers"
```

---

### Task 3: `rehypeSourcePositions` plugin (`highlight.ts`)

**Files:**
- Modify: `src/lib/highlight.ts`
- Test: `src/lib/highlight-plugin.test.ts`

**Interfaces:**
- Produces (imported by Task 5): `rehypeSourcePositions(): (tree: HastRoot) => void` — wraps eligible text nodes in `span.md-pos` with `data-md-start`/`data-md-end`; skips text inside `code`/`pre` and text nodes lacking `position` offsets.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/highlight-plugin.test.ts`:
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

function collect(node: any, pred: (n: any) => boolean, acc: any[] = []): any[] {
  if (pred(node)) acc.push(node);
  for (const c of node.children ?? []) collect(c, pred, acc);
  return acc;
}

test("wraps plain text nodes in span.md-pos with source offsets", () => {
  const md = "hello world\n";
  const hast = toHast(md);
  rehypeSourcePositions()(hast);
  const spans = collect(
    hast,
    (n) => n.type === "element" && n.tagName === "span" && (n.properties?.className ?? []).includes("md-pos"),
  );
  expect(spans.length).toBeGreaterThan(0);
  const s = spans[0];
  const start = Number(s.properties["data-md-start"]);
  const end = Number(s.properties["data-md-end"]);
  const text = s.children[0].value;
  expect(md.slice(start, end)).toBe(text);
});

test("does not wrap text inside code/pre", () => {
  const md = "para text\n\n```js\nconst x = 1;\n```\n";
  const hast = toHast(md);
  rehypeSourcePositions()(hast);
  // Find the <code> element and assert its children are still raw text (no md-pos spans).
  const codes = collect(hast, (n) => n.type === "element" && n.tagName === "code");
  expect(codes.length).toBeGreaterThan(0);
  const hasSpanInCode = codes.some((c) =>
    collect(c, (n) => n.type === "element" && n.tagName === "span" && (n.properties?.className ?? []).includes("md-pos")).length > 0,
  );
  expect(hasSpanInCode).toBe(false);
});

test("skips text nodes without position offsets", () => {
  // Hand-built tree: text node with no position must be left as-is.
  const tree: any = {
    type: "root",
    children: [{ type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: "x" }] }],
  };
  rehypeSourcePositions()(tree);
  expect(tree.children[0].children[0].type).toBe("text");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/highlight-plugin.test.ts`
Expected: FAIL (`rehypeSourcePositions` is not exported).

- [ ] **Step 3: Implement the plugin (append to `src/lib/highlight.ts`)**

Add to the end of `src/lib/highlight.ts`:
```ts
// --- Minimal hast types (avoids a dependency on @types/hast) ---
interface HastText {
  type: "text";
  value: string;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}
interface HastElement {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children: HastChild[];
}
interface HastRoot {
  type: "root";
  children: HastChild[];
}
type HastChild = HastText | HastElement | { type: string; children?: HastChild[] };

const SKIP_TAGS = new Set(["code", "pre"]);

export function rehypeSourcePositions() {
  return (tree: HastRoot) => walkHast(tree, false);
}

function walkHast(node: HastRoot | HastElement, inSkip: boolean): void {
  const children = node.children;
  if (!children) return;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === "element") {
      const el = child as HastElement;
      walkHast(el, inSkip || SKIP_TAGS.has(el.tagName));
    } else if (child.type === "text" && !inSkip) {
      const text = child as HastText;
      const start = text.position?.start?.offset;
      const end = text.position?.end?.offset;
      if (start == null || end == null) continue;
      const span: HastElement = {
        type: "element",
        tagName: "span",
        properties: {
          className: ["md-pos"],
          "data-md-start": String(start),
          "data-md-end": String(end),
        },
        children: [text],
      };
      children[i] = span;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/highlight-plugin.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/highlight.ts src/lib/highlight-plugin.test.ts
git commit -m "feat: rehype plugin tagging text nodes with source offsets"
```

---

### Task 4: DOM selection → source ranges (`highlight-dom.ts`)

**Files:**
- Create: `src/lib/highlight-dom.ts`

**Interfaces:**
- Consumes: `SourceRange`, `mapSpanRange` from `./highlight`.
- Produces (imported by Task 6): `computeSourceRanges(container: HTMLElement): SourceRange[] | null` — returns mapped source ranges for the current `window.getSelection()`, or `null` if nothing is mappable.

This task's logic is DOM-dependent; its pure core (`mapSpanRange`) is already tested in Task 2. Verification here is via type-check; full behavior is exercised manually in Task 6.

- [ ] **Step 1: Implement `highlight-dom.ts`**

Create `src/lib/highlight-dom.ts`:
```ts
import { mapSpanRange, type SourceRange } from "./highlight";

// Char offset within `span.textContent` corresponding to a selection boundary.
// If the boundary is outside the span, the span is fully covered on that side.
function offsetWithin(
  span: HTMLElement,
  boundaryNode: Node,
  boundaryOffset: number,
  which: "start" | "end",
): number {
  if (!span.contains(boundaryNode)) {
    return which === "start" ? 0 : span.textContent?.length ?? 0;
  }
  let offset = 0;
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  let t: Node | null;
  while ((t = walker.nextNode())) {
    if (t === boundaryNode) return offset + boundaryOffset;
    offset += (t as Text).length;
  }
  return offset;
}

export function computeSourceRanges(container: HTMLElement): SourceRange[] | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;

  const spans = container.querySelectorAll<HTMLElement>("span.md-pos");
  const ranges: SourceRange[] = [];
  spans.forEach((span) => {
    if (!range.intersectsNode(span)) return;
    const mdStart = Number(span.dataset.mdStart);
    const mdEnd = Number(span.dataset.mdEnd);
    if (Number.isNaN(mdStart) || Number.isNaN(mdEnd)) return;
    const text = span.textContent ?? "";
    const relStart = offsetWithin(span, range.startContainer, range.startOffset, "start");
    const relEnd = offsetWithin(span, range.endContainer, range.endOffset, "end");
    const mapped = mapSpanRange(mdStart, text.length, mdEnd - mdStart, relStart, relEnd);
    if (mapped) ranges.push(mapped);
  });
  return ranges.length ? ranges : null;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/highlight-dom.ts
git commit -m "feat: map DOM selection to markdown source ranges"
```

---

### Task 5: Wire the plugin, mark click, and CSS into rendering

**Files:**
- Modify: `src/components/ChatDetail/ChatDetail.tsx` (the `MemoizedMarkdown` component, lines ~77-117)
- Modify: `src/index.css` (after the `mark.search-highlight` block, ~line 1614)

**Interfaces:**
- Consumes: `rehypeSourcePositions` from `../../lib/highlight`.
- Produces: `MemoizedMarkdown` now accepts `onMarkClick?: (id: string) => void` and renders highlight spans; `mark` elements call `onMarkClick` with their `data-hl`.

- [ ] **Step 1: Add the import**

In `src/components/ChatDetail/ChatDetail.tsx`, below the existing `rehype-raw` import (line 8), add:
```tsx
import { rehypeSourcePositions } from "../../lib/highlight";
```

- [ ] **Step 2: Update `MemoizedMarkdown` to take `onMarkClick`, register the plugin, and override `mark`**

Replace the `MemoizedMarkdown` definition (currently lines 77-117) with:
```tsx
const MemoizedMarkdown = memo(function MemoizedMarkdown({ content, contentRef, onMarkClick }: { content: string; contentRef: React.RefObject<HTMLDivElement | null>; onMarkClick?: (id: string) => void }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, rehypeSourcePositions]}
      components={{
        h1: ({ children }) => <CollapsibleH1 id={slugify(getTextContent(children))}>{children}</CollapsibleH1>,
        h2: ({ children, ...props }) => <h2 id={slugify(getTextContent(children))} {...props}>{children}</h2>,
        h3: ({ children, ...props }) => <h3 id={slugify(getTextContent(children))} {...props}>{children}</h3>,
        a: ({ children, href, ...props }) => {
          if (href?.startsWith("#")) {
            return <a {...props} href={href} onClick={(e) => {
              e.preventDefault();
              const id = href!.slice(1);
              contentRef.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}>{children}</a>;
          }
          return <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
        },
        mark: ({ children, ...props }) => (
          <mark {...props} onClick={(e) => {
            const id = (e.currentTarget as HTMLElement).dataset.hl;
            if (id) onMarkClick?.(id);
          }}>{children}</mark>
        ),
        code: ({ className, children, ...props }) => {
          const match = /language-(\w+)/.exec(className || "");
          if (match && match[1] === "mermaid") {
            return <MermaidBlock code={String(children).trim()} />;
          }
          return <code className={className} {...props}>{children}</code>;
        },
        pre: ({ children, ...props }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const child = children as any;
          if (child?.props?.className?.includes("language-mermaid")) {
            return <>{children}</>;
          }
          return <pre {...props}>{children}</pre>;
        },
      }}
    >
      {content}
    </Markdown>
  );
});
```

- [ ] **Step 3: Add CSS for offset spans and highlight colors**

In `src/index.css`, immediately after the `mark.search-highlight.active { … }` block (ends ~line 1614), add:
```css
/* Source-offset wrappers: inert, no visual change */
.md-content span.md-pos {
  /* nothing — purely a position carrier */
}

/* User highlights (persisted in content_md) */
.md-content mark[class^="hl-"],
.md-content mark[class*=" hl-"] {
  border-radius: 2px;
  padding: 0 1px;
  cursor: pointer;
  color: #1a1d23;
}
.md-content mark.hl-yellow { background: #fde68a; }
.md-content mark.hl-green { background: #bbf7d0; }
.md-content mark.hl-pink { background: #fbcfe8; }
.md-content mark.hl-blue { background: #bfdbfe; }
```

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no errors. (`onMarkClick` is optional, so the existing call site at line ~696 and the focus-mode call at line ~409 still type-check unchanged.)

- [ ] **Step 5: Manual render check**

Run `bun run tauri dev`. In a chat, temporarily verify rendering by adding a highlight to the source via devtools is not required; instead confirm:
1. The app still renders chats normally (no regressions, mermaid/code intact).
2. In devtools Elements, text in a paragraph is wrapped in `<span class="md-pos" data-md-start="…" data-md-end="…">`, and `content_md.slice(start,end)` equals the span text (spot-check one span in the console: select the chat, then in console compare against the known `content_md`).

- [ ] **Step 6: Commit**

```bash
git add src/components/ChatDetail/ChatDetail.tsx src/index.css
git commit -m "feat: render source-offset spans and highlight colors"
```

---

### Task 6: Toolbar component + ChatDetail integration

**Files:**
- Create: `src/components/ChatDetail/MarkdownToolbar.tsx`
- Modify: `src/components/ChatDetail/ChatDetail.tsx` (imports, state, handlers, both render returns, the `chat.id` reset effect)

**Interfaces:**
- Consumes: `computeSourceRanges` (`../../lib/highlight-dom`); `applyHighlight`, `removeHighlight`, `recolorHighlight`, `newHighlightId`, `HIGHLIGHT_COLORS`, `type HighlightColor` (`../../lib/highlight`); `MemoizedMarkdown.onMarkClick` (Task 5).
- Produces: end-to-end highlighter.

- [ ] **Step 1: Create the toolbar component**

Create `src/components/ChatDetail/MarkdownToolbar.tsx`:
```tsx
import { HIGHLIGHT_COLORS, type HighlightColor } from "../../lib/highlight";

interface MarkdownToolbarProps {
  activeHighlightId: string | null;
  notice: string | null;
  onColor: (color: HighlightColor) => void;
  onRemove: () => void;
}

const COLOR_SWATCH: Record<HighlightColor, string> = {
  yellow: "#fde68a",
  green: "#bbf7d0",
  pink: "#fbcfe8",
  blue: "#bfdbfe",
};

export default function MarkdownToolbar({ activeHighlightId, notice, onColor, onRemove }: MarkdownToolbarProps) {
  return (
    <div className="md-toolbar" onMouseDown={(e) => e.preventDefault()}>
      <span className="md-toolbar-label" title={activeHighlightId ? "Change highlight color" : "Select text, then pick a color to highlight"}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
        </svg>
      </span>
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c}
          className="md-toolbar-swatch"
          style={{ background: COLOR_SWATCH[c] }}
          title={activeHighlightId ? `Recolor: ${c}` : `Highlight: ${c}`}
          onClick={() => onColor(c)}
        />
      ))}
      {activeHighlightId && (
        <button className="md-toolbar-remove" title="Remove highlight" onClick={onRemove}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </button>
      )}
      {notice && <span className="md-toolbar-notice">{notice}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Add toolbar CSS**

In `src/index.css`, after the highlight-color block added in Task 5, add:
```css
.md-toolbar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0 8px;
  margin-bottom: 8px;
  background: var(--bg);
  border-bottom: 1px solid var(--border-subtle);
}
.md-toolbar-label {
  display: inline-flex;
  color: var(--text-faint);
}
.md-toolbar-swatch {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  padding: 0;
}
.md-toolbar-swatch:hover {
  outline: 2px solid var(--border-subtle);
  outline-offset: 1px;
}
.md-toolbar-remove {
  display: inline-flex;
  align-items: center;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px;
}
.md-toolbar-remove:hover {
  color: var(--red);
}
.md-toolbar-notice {
  font-size: 12px;
  color: var(--text-faint);
}
```

- [ ] **Step 3: Import toolbar + helpers in ChatDetail**

In `src/components/ChatDetail/ChatDetail.tsx`, below the `rehypeSourcePositions` import (added in Task 5), add:
```tsx
import MarkdownToolbar from "./MarkdownToolbar";
import { applyHighlight, removeHighlight, recolorHighlight, newHighlightId, type HighlightColor } from "../../lib/highlight";
import { computeSourceRanges } from "../../lib/highlight-dom";
```

- [ ] **Step 4: Add state, handlers, and reset**

In the `ChatDetail` component body, after the existing `const contentRef = useRef…` line (~186), add:
```tsx
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [hlNotice, setHlNotice] = useState<string | null>(null);
```

In the `useEffect(() => { … }, [chat.id])` reset block (~190-198), add as the last statement inside it:
```tsx
    setActiveHighlightId(null);
```

After `handleSummarySave` (~305), add:
```tsx
  const handleMarkClick = useCallback((id: string) => setActiveHighlightId(id), []);

  const handleHighlightColor = useCallback((color: HighlightColor) => {
    if (activeHighlightId) {
      onUpdateChat(chat.id, { content_md: recolorHighlight(chat.content_md, activeHighlightId, color) });
      setActiveHighlightId(null);
      return;
    }
    const container = contentRef.current;
    if (!container) return;
    const ranges = computeSourceRanges(container);
    if (!ranges) {
      setHlNotice("Impossibile evidenziare questa selezione");
      window.setTimeout(() => setHlNotice(null), 2500);
      return;
    }
    onUpdateChat(chat.id, { content_md: applyHighlight(chat.content_md, ranges, color, newHighlightId()) });
    window.getSelection()?.removeAllRanges();
  }, [activeHighlightId, chat.id, chat.content_md, onUpdateChat]);

  const handleRemoveHighlight = useCallback(() => {
    if (!activeHighlightId) return;
    onUpdateChat(chat.id, { content_md: removeHighlight(chat.content_md, activeHighlightId) });
    setActiveHighlightId(null);
  }, [activeHighlightId, chat.id, chat.content_md, onUpdateChat]);
```

- [ ] **Step 5: Render the toolbar in focus mode**

In the `focusMode` return (~407-411), change the content block to:
```tsx
        <div className="focus-content">
          <div ref={contentRef} className="md-content">
            <MarkdownToolbar
              activeHighlightId={activeHighlightId}
              notice={hlNotice}
              onColor={handleHighlightColor}
              onRemove={handleRemoveHighlight}
            />
            <MemoizedMarkdown content={chat.content_md} contentRef={contentRef} onMarkClick={handleMarkClick} />
          </div>
        </div>
```

- [ ] **Step 6: Render the toolbar in the normal view**

In the main content area, replace the `<div ref={contentRef} className="md-content detail-content-main">…</div>` block (~687-698) with:
```tsx
          <div ref={contentRef} className="md-content detail-content-main">
            <MarkdownToolbar
              activeHighlightId={activeHighlightId}
              notice={hlNotice}
              onColor={handleHighlightColor}
              onRemove={handleRemoveHighlight}
            />
            {isResizing || tocResizing ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8, color: "var(--text-faint)" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
                </svg>
                <span style={{ fontSize: 12 }}>Adjusting layout...</span>
              </div>
            ) : (
              <MemoizedMarkdown content={chat.content_md} contentRef={contentRef} onMarkClick={handleMarkClick} />
            )}
          </div>
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Manual end-to-end verification**

Run `bun run tauri dev`, open a chat, then verify:
1. Select a sentence inside a paragraph → click a color swatch → the sentence becomes highlighted in that color and stays after clicking away.
2. Reopen the chat (select another, come back) → the highlight persists.
3. Click the highlight → the remove (trash) button appears; click another swatch → it recolors; click trash → it disappears.
4. Select text that spans a bold/link → still highlights (source span includes the markup).
5. Try to select inside a code block and highlight → no change + the "Impossibile evidenziare questa selezione" notice appears briefly.
6. Focus mode shows the toolbar and highlighting works there too.
7. Mermaid diagrams and code blocks still render correctly.

- [ ] **Step 9: Commit**

```bash
git add src/components/ChatDetail/MarkdownToolbar.tsx src/components/ChatDetail/ChatDetail.tsx src/index.css
git commit -m "feat: markdown toolbar with multi-color highlighter"
```

---

### Task 7: Keep `<mark>` tags out of the search index

**Files:**
- Modify: `src/lib/db.ts` (every `index_chat`/`reindex_all` call site)

**Interfaces:**
- Consumes: `stripHighlights` from `./highlight`.
- Produces: search documents never contain `<mark>` tags.

- [ ] **Step 1: Import the helper**

At the top of `src/lib/db.ts`, add to the imports:
```ts
import { stripHighlights } from "./highlight";
```

- [ ] **Step 2: Strip highlights at every index call site**

There are index calls in `db.ts` (per current line numbers ~174, ~192, ~358, ~384, ~419). For each call that passes a content-markdown value to `invoke("index_chat", …)` or `invoke("reindex_all", …)`, wrap the markdown in `stripHighlights(...)`:

- In `updateChat` (~384-389), change:
```ts
      await invoke("index_chat", {
        id,
        title: chat[0].title,
        summary: chat[0].summary ?? "",
        contentMd: stripHighlights(chat[0].content_md),
      });
```
- In `insertChat` (~358-363), change `contentMd: chat.content_md` to `contentMd: stripHighlights(chat.content_md)`.
- In `restoreChat` (~419-424), change `contentMd: chat[0].content_md` to `contentMd: stripHighlights(chat[0].content_md)`.
- In the two `reindex_all` paths (~174 and ~192) that build a `chats`/`docs` array, map each item's content markdown field through `stripHighlights(...)`. For example, where the doc object sets `contentMd: c.content_md`, change it to `contentMd: stripHighlights(c.content_md)`.

(Read each call site and apply `stripHighlights` to exactly the markdown field being indexed — do not alter what is stored in the DB, only what is indexed.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run `bun run tauri dev`:
1. Highlight a word that is reasonably unique in a chat.
2. Use the app's global search for that word → the chat still appears (highlighted words remain searchable).
3. Search for `mark` or `hl-yellow` → the highlighted chat does NOT surface due to the tags.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat: strip highlight tags before indexing for search"
```

---

## Self-Review

**Spec coverage:**
- Toolbar above content, multi-color highlighter → Tasks 5–6.
- Approach 2 (source-position mapping) → Tasks 1, 3, 4.
- `<mark class="hl-…" data-hl="…">` in source; add/remove/recolor → Tasks 2, 6.
- Correctness guards (entities/escapes), code/pre exclusion → Tasks 2 (`mapSpanRange`), 3 (plugin).
- No-op + notice on unmappable selection → Tasks 4 (`computeSourceRanges` → null), 6 (notice).
- Robust remove/recolor by `data-hl` → Task 2.
- Search-index mitigation → Task 7.
- Toolbar in both normal and focus views → Task 6.
- De-risk position survival first → Task 1.
- Persistence via existing `updateChat` (persist + re-index) → Task 6 (handlers call `onUpdateChat`), Task 7 (clean index).
- Caveats documented (re-parse wipes highlights; DOM weight) → carried from spec; no task needed (non-goals).

**Placeholder scan:** No TBD/TODO; every code step contains full code; Task 7 references concrete line numbers and the exact field to wrap.

**Type consistency:** `SourceRange`, `HighlightColor`, `HIGHLIGHT_COLORS`, `newHighlightId`, `applyHighlight`, `removeHighlight`, `recolorHighlight`, `mapSpanRange`, `stripHighlights`, `rehypeSourcePositions`, `computeSourceRanges`, and `MemoizedMarkdown`'s `onMarkClick` are used with identical names/signatures across tasks.

## Notes / Known limitations (from the spec)

- A chat re-parse (`onReparseHtml`) regenerates `content_md` and therefore drops all highlights — accepted v1 limitation.
- Wrapping every eligible text node adds DOM nodes; fine for typical chats, revisit only for very large documents.
- Highlighting is unavailable inside code/pre/mermaid by design.
