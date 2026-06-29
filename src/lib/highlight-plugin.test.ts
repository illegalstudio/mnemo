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
