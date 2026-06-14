import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextSlice, readOffset, writeOffset } from "./offsets.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "recall-offsets-"));
  process.env.RECALL_OFFSET_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readOffset / writeOffset", () => {
  it("round-trips a stored offset", () => {
    writeOffset("session-a", 42);
    expect(readOffset("session-a")).toBe(42);
  });

  it("returns 0 for a session that has never been written", () => {
    expect(readOffset("unknown")).toBe(0);
  });

  it("treats an empty session id as no offset and a no-op write", () => {
    writeOffset("", 10);
    expect(readOffset("")).toBe(0);
  });

  it("does not let a hostile session id escape the offset directory", () => {
    writeOffset("../../etc/passwd", 7);
    // Sanitised key still round-trips, and nothing was written outside dir.
    expect(readOffset("../../etc/passwd")).toBe(7);
  });
});

describe("nextSlice", () => {
  it("returns the whole transcript at offset 0", () => {
    const { slice, totalLines } = nextSlice("a\nb\nc\n", 0);
    expect(slice).toBe("a\nb\nc");
    expect(totalLines).toBe(3);
  });

  it("returns only the new tail at a prior offset", () => {
    const { slice, totalLines } = nextSlice("a\nb\nc\nd\n", 2);
    expect(slice).toBe("c\nd");
    expect(totalLines).toBe(4);
  });

  it("never skips the last real line as the file grows across runs", () => {
    // run 1: "a\nb\n" -> offset 2; run 2 must still surface "c".
    expect(nextSlice("a\nb\n", 0).totalLines).toBe(2);
    expect(nextSlice("a\nb\nc\n", 2).slice).toBe("c");
  });

  it("returns an empty slice when nothing is new", () => {
    expect(nextSlice("a\nb\n", 2).slice).toBe("");
  });

  it("clamps an offset past the end to an empty slice", () => {
    const { slice, totalLines } = nextSlice("a\nb\n", 99);
    expect(slice).toBe("");
    expect(totalLines).toBe(2);
  });
});
