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
  // Note: the scroll listener on containerRef.current may be inert in layouts where the
  // actual scroll container is an ancestor (e.g. wide/focus view). This is intentional and
  // safe: both the boundary `y` values and the mouse `yInContent` are computed relative to
  // containerRef.current's live getBoundingClientRect().top, and .cut-line is absolutely
  // positioned inside that same container — so the values stay internally consistent even
  // while the page is scrolled. Do NOT "fix" this by switching to a window scroll listener
  // or subtracting scrollTop from lineY; doing so would break the wide-view case.
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
