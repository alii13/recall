import { createDb, learnings } from "@recall/shared";
import { and, desc, eq, inArray } from "drizzle-orm";

const ENV_FILE = process.env.RECALL_ENV_FILE ?? "/Users/shekh/recall/.env";

function usage(): void {
  console.error("usage: review <list [project] | keep <id...> | skip <id...>>");
  process.exitCode = 1;
}

// Curation gate for captured learnings: they land as `pending` and stay out of
// any recall path until kept here. `list` shows them, `keep` promotes to
// `kept`, `skip` deletes. Mirrors the journal keep/edit/skip review flow.
async function main(): Promise<void> {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch {
    // env may already be present
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("missing DATABASE_URL");
    process.exitCode = 1;
    return;
  }

  const [cmd, ...rest] = process.argv.slice(2);
  const { db, close } = createDb(url);
  try {
    if (cmd === "list") {
      const project = rest[0];
      const rows = await db
        .select({
          id: learnings.id,
          kind: learnings.kind,
          project: learnings.project,
          status: learnings.status,
          importance: learnings.importance,
          title: learnings.title,
          body: learnings.body,
          why: learnings.why,
          howToApply: learnings.howToApply,
          tags: learnings.tags,
          sessionId: learnings.sessionId,
          createdAt: learnings.createdAt,
        })
        .from(learnings)
        .where(project ? eq(learnings.project, project) : undefined)
        .orderBy(desc(learnings.createdAt));
      console.log(JSON.stringify({ count: rows.length, rows }, null, 2));
    } else if (cmd === "keep") {
      if (rest.length === 0) return usage();
      const res = await db
        .update(learnings)
        .set({ status: "kept" })
        .where(and(eq(learnings.status, "pending"), inArray(learnings.id, rest)))
        .returning({ id: learnings.id });
      console.log(JSON.stringify({ kept: res.length }, null, 2));
    } else if (cmd === "skip") {
      if (rest.length === 0) return usage();
      const res = await db
        .delete(learnings)
        .where(inArray(learnings.id, rest))
        .returning({ id: learnings.id });
      console.log(JSON.stringify({ skipped: res.length }, null, 2));
    } else {
      usage();
    }
  } finally {
    await close();
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
