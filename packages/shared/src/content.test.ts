import { describe, expect, test } from "vitest";
import { providedContent } from "./content.js";

describe("providedContent", () => {
  test("uses the provided text as markdown and marks it ok", () => {
    const out = providedContent("Hello world\n\nthis is the body");
    expect(out.markdown).toBe("Hello world\n\nthis is the body");
    expect(out.status).toBe("ok");
  });

  test("derives the title from the first non-empty line", () => {
    const out = providedContent("\n\n  First real line  \nsecond line");
    expect(out.title).toBe("First real line");
  });

  test("caps the title at 80 characters", () => {
    const long = "x".repeat(200);
    const out = providedContent(long);
    expect(out.title).toBe("x".repeat(80));
  });

  test("normalizes CRLF and trims", () => {
    const out = providedContent("  a\r\nb  ");
    expect(out.markdown).toBe("a\nb");
  });

  test("returns null markdown for empty or whitespace-only text", () => {
    expect(providedContent("   \n\t ").markdown).toBeNull();
    expect(providedContent("").title).toBeNull();
  });
});
