import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("/Users/shekh/recall/.env", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const eq = l.indexOf("=");
      return [l.slice(0, eq), l.slice(eq + 1)];
    }),
);

const child = spawn(
  "node",
  ["/Users/shekh/recall/packages/mcp/dist/index.js"],
  { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "inherit"] },
);

const rl = createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    console.error("non-json line:", line);
    return;
  }
  if (msg.id != null && pending.has(msg.id)) {
    const resolve = pending.get(msg.id);
    pending.delete(msg.id);
    resolve(msg);
  }
});

function call(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

try {
  console.log("--- initialize ---");
  const init = await call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  });
  console.log(`server: ${init.result.serverInfo.name} v${init.result.serverInfo.version}`);

  notify("notifications/initialized", {});

  console.log("\n--- tools/list ---");
  const list = await call("tools/list", {});
  for (const t of list.result.tools) {
    console.log(`  ${t.name}: ${t.description.slice(0, 90)}...`);
  }

  console.log("\n--- recent_saves (7 days) ---");
  const recent = await call("tools/call", {
    name: "recent_saves",
    arguments: { days: 30, limit: 5 },
  });
  const recentRows = JSON.parse(recent.result.content[0].text);
  console.log(`got ${recentRows.length} rows`);
  for (const r of recentRows) {
    console.log(`  - ${r.title} [${r.source_type}]`);
  }

  console.log("\n--- search_saved 'retrieval augmented generation' ---");
  const search = await call("tools/call", {
    name: "search_saved",
    arguments: { query: "retrieval augmented generation", limit: 3 },
  });
  const searchRows = JSON.parse(search.result.content[0].text);
  for (const r of searchRows) {
    console.log(`  ${r.score} - ${r.title} (${r.source_type})`);
    console.log(`    ${r.summary?.slice(0, 120)}...`);
  }

  if (searchRows[0]) {
    console.log(`\n--- get_card ${searchRows[0].id} ---`);
    const got = await call("tools/call", {
      name: "get_card",
      arguments: { id: searchRows[0].id },
    });
    const card = JSON.parse(got.result.content[0].text);
    console.log(`title: ${card.title}`);
    console.log(`markdown length: ${card.markdown?.length ?? 0}`);
    console.log(`tags: ${JSON.stringify(card.tags)}`);
  }
} finally {
  child.stdin.end();
  child.kill();
}
