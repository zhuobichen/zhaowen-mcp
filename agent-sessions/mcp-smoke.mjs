/**
 * MCP 冒烟测试：真的把服务器当子进程起起来，走一遍 stdio 握手，
 * 列出工具、调几个工具确认协议层没坏。
 *
 * 设计要点：
 *   - 只调「不花钱」的路径：annotate 一律用 dry_run=true（不调 LLM）
 *   - 直接 spawn node + tsx 的 CLI 入口（不走 shell），避免 Windows 上 spawn cmd.exe 失败误判
 *   - stdout 收到非 JSON 行会显式报错 —— 这正是「日志污染了 stdio」的检测点
 *
 * 用法: node mcp-smoke.mjs
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

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
      console.log("（非 JSON 输出 —— stdout 被污染了）", line.slice(0, 200));
      child.kill();
      process.exit(1);
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
    const timer = setTimeout(() => reject(new Error(`${method} 超时（60s 无响应）`)), 60000);
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
  console.log(`✓ 工具列表：${tools.length} 个 —— ${tools.map((t) => t.name).join(", ")}`);
  const noSchema = tools.filter((t) => !t.inputSchema || !t.name || !t.description);
  if (noSchema.length) fail(`有工具缺 name/description/inputSchema：${noSchema.map((t) => t.name).join("、")}`);

  const WANT = ["list_agent_sessions", "read_agent_session", "search_agent_sessions",
                "agent_token_usage", "session_insights", "annotate_sessions", "generate_session_report"];
  const names = tools.map((t) => t.name);
  for (const w of WANT) if (!names.includes(w)) fail(`缺少工具 ${w}`);

  // 1) 生成报告（纯本地，零成本）
  for (const agent of ["codex", "claude"]) {
    const r = await send("tools/call", { name: "generate_session_report", arguments: { agent } });
    if (r.error) fail(`generate_session_report(${agent}) 协议错误：${JSON.stringify(r.error)}`);
    const text = r.result?.content?.[0]?.text ?? "";
    if (!/会话洞察报告/.test(text) || !/· HTML:/.test(text)) fail(`generate_session_report(${agent}) 返回异常：${text.slice(0, 160)}`);
    const m = text.match(/([A-Za-z]:\\[^\s(]+\.html)/);
    if (m && !fs.existsSync(m[1])) fail(`报告文件不存在：${m[1]}`);
    console.log(`✓ generate_session_report(${agent}) → ${text.split("\n")[0].slice(0, 60)}`);
  }

  // 2) annotate 只跑 dry_run（不花钱）
  for (const agent of ["codex", "claude"]) {
    const r = await send("tools/call", { name: "annotate_sessions", arguments: { agent, dry_run: true } });
    if (r.error) fail(`annotate_sessions(${agent}) 协议错误：${JSON.stringify(r.error)}`);
    const text = r.result?.content?.[0]?.text ?? "";
    if (!/dry_run=true/.test(text)) fail(`annotate_sessions(${agent}) 没有走 dry_run 分支：${text.slice(0, 160)}`);
    if (!/facets/.test(text)) fail(`annotate_sessions(${agent}) 没报 facets 目录`);
    console.log(`✓ annotate_sessions(${agent}, dry_run) → ${text.split("\n")[1].slice(0, 60)}`);
  }

  // 3) 未知工具应走「未知工具」分支，而不是崩掉
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
