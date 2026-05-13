import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SAVE_TOKEN: z.string().min(1),
  NVIDIA_API_KEY: z.string().min(1),
  JINA_API_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  PORT: z.coerce.number().int().positive().default(8080),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(env: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid env:\n${issues}`);
  }
  return parsed.data;
}
