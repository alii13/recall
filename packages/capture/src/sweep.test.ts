import { describe, expect, it } from "vitest";
import { type SweepRow, planSweep } from "./sweep.js";

const recent = new Date("2025-06-01");
const old = new Date("2023-01-01");
const cutoff = new Date("2024-01-01");
const opts = { dedupThreshold: 0.93, staleCutoff: cutoff, maxDelete: 25 };

function row(over: Partial<SweepRow> & { id: string }): SweepRow {
  return {
    title: over.id,
    importance: 4,
    surfaceCount: 1,
    createdAt: recent,
    embedding: [1, 0, 0],
    ...over,
  };
}

describe("planSweep", () => {
  it("drops the weaker of a near-duplicate pair, keeps higher importance", () => {
    const rows = [
      row({ id: "a", importance: 5, embedding: [1, 0, 0] }),
      row({ id: "b", importance: 4, embedding: [1, 0, 0] }),
      row({ id: "c", importance: 4, embedding: [0, 1, 0] }),
    ];
    const plan = planSweep(rows, opts);
    expect(plan).toEqual([{ id: "b", title: "b", reason: "duplicate" }]);
  });

  it("prunes stale rows but spares importance-5 and surfaced ones", () => {
    const rows = [
      row({ id: "x", importance: 4, surfaceCount: 0, createdAt: old, embedding: [1, 0, 0] }),
      row({ id: "y", importance: 5, surfaceCount: 0, createdAt: old, embedding: [0, 1, 0] }),
      row({ id: "z", importance: 4, surfaceCount: 3, createdAt: old, embedding: [0, 0, 1] }),
    ];
    const plan = planSweep(rows, opts);
    expect(plan).toEqual([{ id: "x", title: "x", reason: "stale" }]);
  });

  it("respects the per-run delete cap", () => {
    const rows = [
      row({ id: "s1", surfaceCount: 0, createdAt: old, embedding: [1, 0, 0] }),
      row({ id: "s2", surfaceCount: 0, createdAt: old, embedding: [0, 1, 0] }),
      row({ id: "s3", surfaceCount: 0, createdAt: old, embedding: [0, 0, 1] }),
    ];
    expect(planSweep(rows, { ...opts, maxDelete: 2 })).toHaveLength(2);
  });

  it("does nothing when the store is clean", () => {
    const rows = [row({ id: "a", embedding: [1, 0, 0] }), row({ id: "b", embedding: [0, 1, 0] })];
    expect(planSweep(rows, opts)).toEqual([]);
  });
});
