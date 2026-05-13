import { describe, expect, test } from "vitest";
import { normalizeUrl, routeUrl, urlHash } from "./url.js";

describe("normalizeUrl", () => {
  test("rejects non-http schemes", () => {
    expect(() => normalizeUrl("ftp://example.com")).toThrow();
    expect(() => normalizeUrl("javascript:alert(1)")).toThrow();
    expect(() => normalizeUrl("file:///etc/passwd")).toThrow();
  });

  test("rejects malformed input", () => {
    expect(() => normalizeUrl("not a url")).toThrow();
    expect(() => normalizeUrl("")).toThrow();
  });

  test("lowercases hostname but preserves path case", () => {
    expect(normalizeUrl("https://EXAMPLE.com/Path")).toBe("https://example.com/Path");
  });

  test("drops fragment", () => {
    expect(normalizeUrl("https://example.com/x#section")).toBe("https://example.com/x");
  });

  test("strips utm_* params", () => {
    expect(
      normalizeUrl("https://example.com/x?utm_source=tw&utm_medium=social&keep=1"),
    ).toBe("https://example.com/x?keep=1");
  });

  test("strips other known tracking params", () => {
    expect(
      normalizeUrl(
        "https://example.com/x?gclid=a&fbclid=b&mc_cid=c&mc_eid=d&ref=e&ref_src=f&ref_url=g",
      ),
    ).toBe("https://example.com/x");
  });

  test("drops trailing slash from non-root path", () => {
    expect(normalizeUrl("https://example.com/path/")).toBe("https://example.com/path");
  });

  test("preserves root slash", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  test("sorts remaining params alphabetically", () => {
    expect(normalizeUrl("https://example.com/?z=1&a=2&m=3")).toBe(
      "https://example.com/?a=2&m=3&z=1",
    );
  });

  test("param order does not affect output", () => {
    expect(normalizeUrl("https://example.com/x?a=1&b=2")).toBe(
      normalizeUrl("https://example.com/x?b=2&a=1"),
    );
  });

  test("preserves port if non-default", () => {
    expect(normalizeUrl("https://example.com:8443/x")).toBe("https://example.com:8443/x");
  });
});

describe("routeUrl", () => {
  test("routes reddit hosts", () => {
    expect(routeUrl("https://reddit.com/r/x")).toBe("reddit");
    expect(routeUrl("https://www.reddit.com/r/x")).toBe("reddit");
    expect(routeUrl("https://old.reddit.com/r/x")).toBe("reddit");
  });

  test("routes youtube hosts including youtu.be and mobile", () => {
    expect(routeUrl("https://youtube.com/watch?v=x")).toBe("youtube");
    expect(routeUrl("https://www.youtube.com/watch?v=x")).toBe("youtube");
    expect(routeUrl("https://m.youtube.com/watch?v=x")).toBe("youtube");
    expect(routeUrl("https://youtu.be/abc")).toBe("youtube");
  });

  test("routes twitter, X, and mobile twitter to twitter", () => {
    expect(routeUrl("https://x.com/a/status/1")).toBe("twitter");
    expect(routeUrl("https://twitter.com/a/status/1")).toBe("twitter");
    expect(routeUrl("https://mobile.twitter.com/a/status/1")).toBe("twitter");
  });

  test("routes github and hackernews", () => {
    expect(routeUrl("https://github.com/foo/bar")).toBe("github");
    expect(routeUrl("https://news.ycombinator.com/item?id=1")).toBe("hackernews");
  });

  test("defaults unknown hosts to article", () => {
    expect(routeUrl("https://example.com/post")).toBe("article");
    expect(routeUrl("https://medium.com/@a/b")).toBe("article");
  });

  test("is case insensitive on hostname", () => {
    expect(routeUrl("https://REDDIT.com/r/x")).toBe("reddit");
  });
});

describe("urlHash", () => {
  test("returns 64-char hex", () => {
    expect(urlHash("https://example.com")).toMatch(/^[a-f0-9]{64}$/);
  });

  test("is deterministic", () => {
    expect(urlHash("https://example.com")).toBe(urlHash("https://example.com"));
  });

  test("differs for different inputs", () => {
    expect(urlHash("https://example.com/a")).not.toBe(urlHash("https://example.com/b"));
  });
});
