// selftest — 通过 stdio 把 MCP 跑起来，逐个调工具验证
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("./index.ts", import.meta.url));
const child = spawn("npx", ["tsx", entry], { stdio: ["pipe", "pipe", "pipe"], shell: true });
let buf = ""; const pending = new Map(); let nextId = 1;

child.stdout.on("data", (d) => {
  buf += d.toString(); let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    try { const m = JSON.parse(line); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {}
  }
});
child.stderr.on("data", (d) => process.stderr.write("[server] " + d));

function rpc(method, params = {}) {
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, res);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => rej(new Error(`${method} 超时`)), 90000);
  });
}
const text = (r) => r?.result?.content?.map((c) => c.text).join("\n") ?? JSON.stringify(r);

const CASES = [
  ["check_login", {}],
  ["get_video", { bvid: "BV1GJ411x7h7" }],
  ["get_parts", { bvid: "BV1GJ411x7h7" }],
  ["get_subtitles", { bvid: "BV1GJ411x7h7", max_chars: 150 }],
  ["get_related", { bvid: "BV1GJ411x7h7", limit: 2 }],
  ["search_videos", { keyword: "橡皮章", limit: 1 }],
  ["list_popular", { limit: 1 }],
  ["get_ranking", { limit: 1 }],
  ["list_weekly", { limit: 1 }],
  ["get_user_stat", { mid: 946974 }],
  ["get_comments", { bvid: "BV1GJ411x7h7", limit: 1 }],
  ["get_user_videos", { mid: 946974, limit: 1 }],
  ["list_fav_folders", {}],
  ["list_favorites", { media_id: 782029616, limit: 1 }],
  ["list_followings", { limit: 1 }],
  ["list_fans", { limit: 1 }],
  ["get_history", { limit: 1 }],
  ["list_toview", { limit: 1 }],
  ["list_msg_replies", { kind: "like", limit: 1 }],
  ["get_my_top_content", { top: 1 }],
  ["get_watch_time", { days: 7 }],
];

try {
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "1" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const tl = await rpc("tools/list");
  console.log("=== 注册的工具 ===");
  for (const t of tl.result.tools) console.log("  -", t.name);
  for (const [name, a] of CASES) {
    console.log(`\n=== ${name} ${JSON.stringify(a)} ===`);
    console.log(text(await rpc("tools/call", { name, arguments: a })).slice(0, 700));
  }
} catch (e) { console.error("测试失败:", e.message); process.exitCode = 1; }
finally { child.kill(); setTimeout(() => process.exit(process.exitCode ?? 0), 500); }
