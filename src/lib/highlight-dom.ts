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
    if (!nodeInSelection(sel, range, span)) return;
    const mdStart = Number(span.dataset.mdStart);
    const mdEnd = Number(span.dataset.mdEnd);
    if (Number.isNaN(mdStart) || Number.isNaN(mdEnd)) return;
    const text = span.textContent ?? "";
    const relStart = offsetWithin(span, range.startContainer, range.startOffset, "start");
    const relEnd = offsetWithin(span, range.endContainer, range.endOffset, "end");
    const mapped = mapSpanRange(mdStart, text.length, mdEnd - mdStart, relStart, relEnd);
    if (mapped) {
      ranges.push(mapped);
    } else if (relEnd > relStart) {
      // Precise sub-mapping unavailable (escapes/entities make source length differ
      // from rendered length). Rather than silently fail, highlight the whole piece
      // of source this span covers.
      ranges.push({ start: mdStart, end: mdEnd });
    }
  });
  return ranges.length ? ranges : null;
}

// Whether `node` is at least partially within the selection. Selection.containsNode
// is the most reliable in WebKit/WKWebView; fall back to Range boundary geometry.
function nodeInSelection(sel: Selection, range: Range, node: Node): boolean {
  if (typeof sel.containsNode === "function") {
    try {
      return sel.containsNode(node, true);
    } catch {
      /* fall through to geometry */
    }
  }
  const nodeRange = document.createRange();
  nodeRange.selectNodeContents(node);
  // Overlap iff range.start <= node.end AND range.end >= node.start.
  return (
    range.compareBoundaryPoints(Range.END_TO_START, nodeRange) <= 0 &&
    range.compareBoundaryPoints(Range.START_TO_END, nodeRange) >= 0
  );
}
