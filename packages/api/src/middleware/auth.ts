import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export function authMiddleware(token: string): MiddlewareHandler {
  const expected = Buffer.from(token, "utf8");
  return async (c, next) => {
    const provided = Buffer.from(c.req.header("X-Save-Token") ?? "", "utf8");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}
