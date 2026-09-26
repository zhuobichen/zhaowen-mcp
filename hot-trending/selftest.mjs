// selftest — 通过 stdio 把 MCP 跑起来，依次调 tools/list 和 tools/call，验证真的能用。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// 必须用 fileURLToPath —— URL.pathname 会把中文目录名百分号编码，
// 路径里有"维护"这种字符时直接 ERR_MODULE_NOT_FOUND
const entry = fileURLToPath(new URL("./index.ts", import.meta.url));
const child = spawn("npx", ["tsx", entry], { stdio: ["pipe", "pipe", "pipe"], shell: true });

let buf = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch { /* 非 JSON 行忽略 */ }
  }
});
child.stderr.on("data", (d) => process.stderr.write("[server] " + d));

function rpc(method, params = {}) {
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, res);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => rej(new Error(`${method} 超时`)), 60000);
  });
}

const text = (r) => r?.result?.content?.map((c) => c.text).join("\n") ?? JSON.stringify(r);

try {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "probe", version: "1" },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const tl = await rpc("tools/list");
  console.log("=== 注册的工具 ===");
  for (const t of tl.result.tools) console.log("  -", t.name);

  console.log("\n=== list_boards ===");
  console.log(text(await rpc("tools/call", { name: "list_boards", arguments: {} })));

  for (const board of ["bilibili", "weibo", "tieba"]) {
    console.log(`\n=== get_hot board=${board} limit=5 ===`);
    const r = await rpc("tools/call", { name: "get_hot", arguments: { board, limit: 5 } });
    console.log(text(r));
  }

  console.log("\n=== get_hot board=zhihu（没配 cookie，应给明确提示）===");
  console.log(text(await rpc("tools/call", { name: "get_hot", arguments: { board: "zhihu", limit: 3 } })));

  console.log("\n=== get_hot board=不存在的平台（应给友好错误）===");
  console.log(text(await rpc("tools/call", { name: "get_hot", arguments: { board: "douyin" } })));
} catch (e) {
  console.error("测试失败:", e.message);
  process.exitCode = 1;
} finally {
  child.kill();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
