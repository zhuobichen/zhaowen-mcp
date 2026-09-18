/**
 * MCP 冒烟测试：真的把服务器当子进程起起来，走一遍 stdio 握手，
 * 列出工具、再调几个只读工具，确认协议层没有坏。
 *
 * 直接 spawn node + tsx 的 CLI 入口（不走 shell），避免在 Windows 上
 * 因为 spawn cmd.exe 失败而误判成服务端有问题。
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TSX = path.join(HERE, "node_modules", "tsx", "dist", "cli.mjs");

const child = spawn(process.execPath, [TSX, path.join(HERE, "index.ts")], {
  cwd: HERE,
  stdio: ["pipe", "pipe", "pipe"],
});

let buf = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (d) => {
  buf += d.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.log("（非 JSON 输出）", line.slice(0, 200));
      continue;
    }
    const r = pending.get(msg.id);
    if (r) {
      pending.delete(msg.id);
      r(msg);
    }
  }
});
child.stderr.on("data", (d) => {
  const s = d.toString("utf8").trim();
  if (s) console.log("[server stderr]", s.slice(0, 300));
});

function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} 超时（30s 无响应）`)), 30000);
    pending.set(id, (m) => {
      clearTimeout(timer);
      resolve(m);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const fail = (m) => {
  console.log("✗ " + m);
  child.kill();
  process.exit(1);
};

try {
  const init = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1" },
  });
  if (!init.result?.serverInfo) fail("initialize 没有返回 serverInfo");
  console.log(`✓ 握手成功：${init.result.serverInfo.name} ${init.result.serverInfo.version}`);
  notify("notifications/initialized", {});

  const list = await send("tools/list", {});
  const tools = list.result?.tools ?? [];
  console.log(`✓ 工具列表：${tools.length} 个`);
  const noSchema = tools.filter((t) => !t.inputSchema || !t.name || !t.description);
  if (noSchema.length) fail(`有工具缺 name/description/inputSchema：${noSchema.map((t) => t.name).join("、")}`);

  // 只调不联网、不依赖客户端的工具 —— 起服务时不一定开着游戏
  const offline = ["get_data_info", "search_augments", "get_empirical_augments", "check_synergy_sets"];
  for (const name of offline) {
    const args =
      name === "search_augments" ? { query: "坦克", limit: 2 } : name === "get_empirical_augments" ? { min_games: 500, top: 1 } : {};
    const r = await send("tools/call", { name, arguments: args });
    const text = r.result?.content?.[0]?.text ?? "";
    if (r.error) fail(`${name} 返回协议错误：${JSON.stringify(r.error)}`);
    if (!text.trim()) fail(`${name} 返回了空文本`);
    console.log(`✓ ${name} → ${text.split("\n")[0].slice(0, 70)}`);
  }

  // 故意查一个不存在的工具，确认错误路径也可用（返回文本而不是崩掉）
  const bad = await send("tools/call", { name: "no_such_tool", arguments: {} });
  const badText = bad.result?.content?.[0]?.text ?? "";
  if (!/未知工具/.test(badText)) fail(`未知工具没有走预期分支，返回：${badText.slice(0, 80)}`);
  console.log("✓ 未知工具被正确拒绝");

  console.log("\n全部通过。");
  child.kill();
  process.exit(0);
} catch (e) {
  fail(e?.message ?? String(e));
}
