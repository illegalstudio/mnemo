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
