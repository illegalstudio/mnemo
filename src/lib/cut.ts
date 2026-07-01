export function deleteAbove(md: string, offset: number): string {
  return md.slice(offset).replace(/^\s+/, "").replace(/\s+$/, "");
}

export function deleteBelow(md: string, offset: number): string {
  return md.slice(0, offset).replace(/\s+$/, "");
}

export function splitMarkdown(md: string, offset: number): { above: string; below: string } {
  return {
    above: md.slice(0, offset).replace(/\s+$/, ""),
    below: md.slice(offset).replace(/^\s+/, "").replace(/\s+$/, ""),
  };
}

export function deriveSplitTitle(belowMd: string, originalTitle: string): string {
  const m = belowMd.match(/^#{1,6}\s+(.+?)\s*#*\s*$/m);
  if (m) return m[1].trim();
  return `${originalTitle} (2)`;
}
