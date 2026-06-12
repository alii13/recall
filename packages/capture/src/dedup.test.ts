import { describe, expect, it } from "vitest";
import { cosineSimilarity, dedupeWithinBatch } from "./dedup.js";

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors and 0 for orthogonal ones", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("is scale-invariant", () => {
    expect(cosineSimilarity([1, 1], [2, 2])).toBeCloseTo(1);
  });

  it("returns 0 when either vector is all zeros", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("dedupeWithinBatch", () => {
  it("drops a near-duplicate but keeps a distinct item", () => {
    const items = [
      { id: "a", embedding: [1, 0, 0] },
      { id: "b", embedding: [0.99, 0.01, 0] }, // ~identical to a
      { id: "c", embedding: [0, 1, 0] }, // distinct
    ];
    const kept = dedupeWithinBatch(items, 0.9);
    expect(kept.map((k) => k.id)).toEqual(["a", "c"]);
  });

  it("keeps everything when nothing crosses the threshold", () => {
    const items = [
      { id: "a", embedding: [1, 0, 0] },
      { id: "b", embedding: [0, 1, 0] },
      { id: "c", embedding: [0, 0, 1] },
    ];
    expect(dedupeWithinBatch(items, 0.9)).toHaveLength(3);
  });
});
