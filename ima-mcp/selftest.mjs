#!/usr/bin/env node
/**
 * ima MCP 自检：走 stdio 起服务，验握手 + 工具清单 + 一次只读实调。
 * 只调用只读接口（列笔记本），不会改动任何 ima 数据。
 *
 *   node selftest.mjs
 *
 * 需要凭证：IMA_CLIENT_ID / IMA_API_KEY 环境变量，或 ~/.config/ima/{client_id,api_key}。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const creds =
  existsSync(join(process.env.USERPROFILE || "", ".config", "ima", "api_key")) ||
  process.env.IMA_API_KEY;
if (!creds) {
  console.error("缺少凭证：设置 IMA_API_KEY / IMA_CLIENT_ID，或写入 ~/.config/ima/");
  process.exit(2);
}

// 复用仓库根的 tsx，避免要求本目录单独 npm install
const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const useTsx = existsSync(tsxCli);
const proc = useTsx
  ? spawn(process.execPath, [tsxCli, join(HERE, "index.ts")], { stdio: ["pipe", "pipe", "inherit"] })
  : spawn(process.execPath, [join(HERE, "index.ts")], { stdio: ["pipe", "pipe", "inherit"] });

let buf = "";
const pending = new Map();
proc.stdout.on("data", (d) => {
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
    // 只有带 id 的响应才占等待槽；通知类消息直接忽略，否则会错位死锁
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let seq = 0;
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, resolve);
    setTimeout(() => pending.delete(id) && reject(new Error(`${method} 超时`)), 30000);
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
};

try {
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "ima-selftest", version: "1.0.0" },
  });
  check(
    "initialize 握手",
    init.result?.serverInfo?.name === "ima-mcp",
    JSON.stringify(init.result?.serverInfo)
  );
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const list = await rpc("tools/list", {});
  const names = (list.result?.tools || []).map((t) => t.name);
  check("tools/list 返回 17 个工具", names.length === 17, `实际 ${names.length}`);

  // 未知工具应返回 isError 而不是崩进程
  const bad = await rpc("tools/call", { name: "__nope__", arguments: {} });
  check("未知工具返回错误而非崩溃", bad.result?.isError === true);

  // 只读实调：列笔记本（会真实打到 ima.qq.com，验证凭证与端点）
  const nb = await rpc("tools/call", { name: "ima_list_notebooks", arguments: { limit: 5 } });
  const nbText = nb.result?.content?.[0]?.text || "";
  check(
    "ima_list_notebooks 实调",
    nb.result?.isError !== true && nbText.includes("notebooks"),
    nb.result?.isError ? nbText.slice(0, 120) : ""
  );
} catch (e) {
  check("自检异常", false, e.message);
} finally {
  proc.kill();
}

console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
