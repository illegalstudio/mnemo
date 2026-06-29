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
