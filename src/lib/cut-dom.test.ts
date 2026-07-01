import { test, expect } from "bun:test";
import { nearestBoundary, type CutBoundary } from "./cut-dom";

const bs: CutBoundary[] = [
  { y: 10, offset: 5 },
  { y: 50, offset: 20 },
  { y: 200, offset: 99 },
];

test("nearestBoundary returns the closest boundary by y", () => {
  expect(nearestBoundary(bs, 12)).toEqual({ y: 10, offset: 5 });
  expect(nearestBoundary(bs, 40)).toEqual({ y: 50, offset: 20 });
  expect(nearestBoundary(bs, 1000)).toEqual({ y: 200, offset: 99 });
});

test("nearestBoundary returns null for an empty list", () => {
  expect(nearestBoundary([], 5)).toBeNull();
});
