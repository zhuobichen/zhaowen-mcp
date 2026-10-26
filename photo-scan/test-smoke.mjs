// Smoke test for the photo-scan MCP server: 握手 → tools/list → doctor → 真跑一次扫描。
//
//   node test-smoke.mjs                     # 只握手 + doctor
//   node test-smoke.mjs <图片或目录> [输出目录]  # 再跑一次 photo_to_scan
//
// 走的是真正的 stdio 协议（不是直接 import 处理函数），所以能抓到 schema、
// 序列化和"回执里到底写了什么"这一类问题。
import { spawn } from "node:child_process";
import path from "node:path";

const [input, outdirArg] = process.argv.slice(2);
const outdir = outdirArg || path.join(process.cwd(), ".smoke-out");

const child = spawn(process.execPath, ["--import", "tsx", "index.ts"], {
  cwd: process.cwd(),
  stdio: ["pipe", "pipe", "pipe"],
});

let buf = "";
const seen = new Map();

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line.startsWith("{")) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id) seen.set(msg.id, msg);
    } catch {
      /* 非 JSON 行（比如 stderr 混进来），忽略 */
    }
  }
});
child.stderr.on("data", (chunk) => process.stderr.write(`[stderr] ${chunk}`));

const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`);

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "photo-scan-smoke", version: "0" },
  },
});
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "photo_to_scan_doctor", arguments: {} } });
if (input) {
  send({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "photo_to_scan", arguments: { input, outdir, preview: true } },
  });
}

const wanted = input ? [2, 3, 4] : [2, 3];
const deadline = Date.now() + 180_000;
let failed = false;

const timer = setInterval(() => {
  const done = wanted.every((id) => seen.has(id));
  if (!done && Date.now() < deadline) return;
  clearInterval(timer);
  if (!done) {
    console.error(`TIMEOUT, 收到: ${[...seen.keys()].join(",") || "无"}`);
    failed = true;
  }
  for (const id of wanted) {
    const msg = seen.get(id);
    if (!msg) continue;
    if (id === 2) {
      const names = (msg.result?.tools ?? []).map((t) => t.name);
      console.log(`tools/list: ${names.join(", ")}`);
      if (names.length !== 3) failed = true;
      continue;
    }
    const isError = Boolean(msg.result?.isError) || Boolean(msg.error);
    if (isError) failed = true;
    const text = msg.result?.content?.[0]?.text ?? JSON.stringify(msg.error ?? msg.result);
    console.log(`\n--- id=${id} ${isError ? "ERROR" : "ok"} ---\n${text}`);
  }
  child.stdin.end();
  child.kill();
  process.exitCode = failed ? 1 : 0;
}, 250);
