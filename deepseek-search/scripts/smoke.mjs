// 冒烟测试：按 MCP stdio 协议起服务，跑 initialize → tools/list → check_status。
//
// 默认**不花钱**：check_status 不发网络请求。
// 要连真实搜索一起测（会产生一次计费，约 0.005 元）：
//     SMOKE_CALL=1 npm run smoke
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "..", "index.ts");
const doCall = process.env.SMOKE_CALL === "1";

const child = spawn(process.execPath, ["--import", "tsx", entry], {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});

let buf = "";
const pending = new Map();
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
child.stderr.on("data", (d) => {
  const s = d.toString().trim();
  if (s) console.log("[stderr]", s.slice(0, 300));
});

let nextId = 1;
function rpc(method, params, timeoutMs = 60000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`超时 ${timeoutMs}ms: ${method}`));
    }, timeoutMs);
    pending.set(id, (m) => {
      clearTimeout(t);
      resolve(m);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

const textOf = (r) => (r?.result?.content ?? []).map((c) => c.text).join("\n");
const indent = (s, n = 3) => s.split("\n").map((l) => " ".repeat(n) + l).join("\n");

try {
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1" },
  });
  console.log("① initialize →", init.result?.serverInfo?.name, init.result?.serverInfo?.version);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

  const list = await rpc("tools/list", {});
  const tools = list.result?.tools ?? [];
  console.log(`② tools/list → ${tools.length} 个: ${tools.map((t) => t.name).join(", ")}`);
  if (tools.length === 0) throw new Error("没有注册任何工具");

  const st = await rpc("tools/call", { name: "check_status", arguments: {} });
  console.log("\n③ check_status（不花钱）→\n" + indent(textOf(st)));

  if (doCall) {
    const se = await rpc("tools/call", {
      name: "deepseek_search",
      arguments: { query: "DeepSeek 搜索 API", count: 2 },
    });
    console.log("\n④ deepseek_search（计费一次）→\n" + indent(textOf(se).split("\n").slice(0, 12).join("\n")));
  } else {
    console.log("\n④ 跳过真实搜索（设 SMOKE_CALL=1 才测）");
  }
  console.log("\n✓ 冒烟通过");
} catch (e) {
  console.error("✗ 冒烟失败:", e.message);
  process.exitCode = 1;
} finally {
  child.kill();
  setTimeout(() => process.exit(process.exitCode ?? 0), 300);
}
