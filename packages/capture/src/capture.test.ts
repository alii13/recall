import { describe, expect, it } from "vitest";
import { buildExtractionPrompt, parseExtraction } from "./extract.js";
import { parseTranscript, projectFromCwd } from "./transcript.js";

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

describe("parseTranscript", () => {
  it("keeps user string content and assistant text blocks in order", () => {
    const jsonl = [
      line({ type: "user", message: { role: "user", content: "fix the bug" } }),
      line({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hmm" },
            { type: "text", text: "Done, it was a null check." },
          ],
        },
      }),
    ].join("\n");

    expect(parseTranscript(jsonl)).toEqual([
      { role: "user", text: "fix the bug" },
      { role: "assistant", text: "Done, it was a null check." },
    ]);
  });

  it("drops tool_use, tool_result, images, and sidechain lines", () => {
    const jsonl = [
      line({ type: "user", message: { role: "user", content: "go" } }),
      line({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: {} }] },
      }),
      line({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "x", content: "SECRET=abc123" }],
        },
      }),
      line({
        type: "assistant",
        isSidechain: true,
        message: { role: "assistant", content: [{ type: "text", text: "subagent chatter" }] },
      }),
    ].join("\n");

    // Only the genuine user prompt survives; tool output (with the secret) and
    // the subagent line are dropped.
    expect(parseTranscript(jsonl)).toEqual([{ role: "user", text: "go" }]);
  });

  it("skips malformed and metadata lines without throwing", () => {
    const jsonl = [
      "not json",
      line({ type: "queue-operation" }),
      line({ type: "user", message: { role: "user", content: "real" } }),
      "",
    ].join("\n");

    expect(parseTranscript(jsonl)).toEqual([{ role: "user", text: "real" }]);
  });
});

describe("projectFromCwd", () => {
  it("returns the basename of a project dir", () => {
    expect(projectFromCwd("/Users/shekh/recall", "/Users/shekh")).toBe("recall");
    expect(projectFromCwd("/Users/shekh/atlan-frontend/", "/Users/shekh")).toBe("atlan-frontend");
  });

  it("returns null for the home dir or empty cwd", () => {
    expect(projectFromCwd("/Users/shekh", "/Users/shekh")).toBeNull();
    expect(projectFromCwd("/Users/shekh/", "/Users/shekh")).toBeNull();
    expect(projectFromCwd("", "/Users/shekh")).toBeNull();
    expect(projectFromCwd(undefined, "/Users/shekh")).toBeNull();
  });
});

describe("parseExtraction", () => {
  it("parses a plain JSON array of valid learnings", () => {
    const out = parseExtraction(
      JSON.stringify([
        {
          kind: "decision",
          title: "Use Drizzle",
          body: "Chose Drizzle over Prisma",
          tags: ["orm"],
        },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("decision");
    expect(out[0]?.tags).toEqual(["orm"]);
  });

  it("strips code fences before parsing", () => {
    const fenced = '```json\n[{"kind":"gotcha","title":"t","body":"b"}]\n```';
    const out = parseExtraction(fenced);
    expect(out).toHaveLength(1);
    expect(out[0]?.tags).toEqual([]);
  });

  it("drops invalid entries but keeps valid ones", () => {
    const out = parseExtraction(
      JSON.stringify([
        { kind: "bogus", title: "x", body: "y" },
        { kind: "correction", title: "Stage files by name", body: "no git add -A" },
        { title: "no kind", body: "y" },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("correction");
  });

  it("returns [] on non-array or unparseable output", () => {
    expect(parseExtraction("sorry, I could not find anything")).toEqual([]);
    expect(parseExtraction('{"kind":"decision"}')).toEqual([]);
    expect(parseExtraction("")).toEqual([]);
  });
});

describe("buildExtractionPrompt", () => {
  it("labels roles and caps length to the most recent turns", () => {
    const prompt = buildExtractionPrompt([
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi" },
    ]);
    expect(prompt).toContain("USER: hello");
    expect(prompt).toContain("ASSISTANT: hi");

    const huge = "x".repeat(30_000);
    const capped = buildExtractionPrompt([{ role: "user", text: huge }]);
    expect(capped.length).toBeLessThan(25_000);
    expect(capped.endsWith("x")).toBe(true);
  });
});
