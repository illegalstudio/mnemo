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
