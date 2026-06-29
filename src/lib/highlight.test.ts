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

test("removeHighlight removes the inner of two nested marks, keeping the outer", () => {
  const md = '<mark class="hl-yellow" data-hl="outer">a <mark class="hl-blue" data-hl="inner">b</mark> c</mark>';
  expect(removeHighlight(md, "inner")).toBe('<mark class="hl-yellow" data-hl="outer">a b c</mark>');
});

test("removeHighlight removes one of two sibling marks sharing an id, leaving the other text intact", () => {
  const md = '<mark class="hl-green" data-hl="dup">a</mark> mid <mark class="hl-green" data-hl="other">b</mark>';
  expect(removeHighlight(md, "dup")).toBe('a mid <mark class="hl-green" data-hl="other">b</mark>');
});
