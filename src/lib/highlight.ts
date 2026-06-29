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
