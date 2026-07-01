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
