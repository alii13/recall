import { serve } from "@hono/node-server";
import { createDb, loadEnv } from "@recall/shared";
import { Hono } from "hono";
import { authMiddleware } from "./middleware/auth.js";
import { makeGetCardHandler } from "./routes/cards.js";
import { makeSaveHandler } from "./routes/save.js";

const env = loadEnv();
const { db } = createDb(env.DATABASE_URL);

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));

const auth = authMiddleware(env.SAVE_TOKEN);
app.use("/save", auth);
app.use("/cards/*", auth);

app.post(
  "/save",
  makeSaveHandler({
    db,
    nvidiaApiKey: env.NVIDIA_API_KEY,
    jinaApiKey: env.JINA_API_KEY,
  }),
);
app.get("/cards/:id", makeGetCardHandler(db));

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`recall-api listening on http://localhost:${info.port}`);
});
