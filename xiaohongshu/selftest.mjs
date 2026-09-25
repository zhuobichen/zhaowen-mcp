#!/usr/bin/env node
/**
 * 自测：起一个**假引擎**（同协议的 MCP over HTTP），把本服务接上去逐条验。
 *
 * 为什么必须有这个文件：真实发布这一步我无法验证（要你的账号扫码登录），
 * 但**代理本身的链路**——stdio 协议、上游 MCP 客户端、参数把关、确认闸门——
 * 全都可以用假引擎验到底。所以这里的断言是：
 *
 *   1. 工具面齐全（9 个）
 *   2. 连得上引擎时 status 报告可达 + 登录状态
 *   3. **dry_run 只回显、绝不发布**（断言引擎没收到 publish_content）
 *   4. 标题超 20 字 → 拦住，且没有发出任何发布请求
 *   5. 本地图片不存在 → 拦住，且没有发出任何发布请求
 *   6. **正文里的 #话题 被自动搬到 tags**（这是本服务存在的理由，必须验）
 *   7. 二维码落成 PNG 且字节正确，并作为 image 内容块返回
 *   8. 删除笔记不带 confirm → 拦住；带了 → 真的调用
 *   9. xhs_raw 走会改状态的上游工具时，没有 confirm 一律拒绝
 *  10. 引擎连不上时给人话（含启动提示），而不是堆栈
 *
 * 跑法：npm test   （需要 xiaohongshu 目录下已 npm install）
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const QR_DIR = mkdtempSync(join(tmpdir(), "xhs-qr-"));
// 1×1 的合法 PNG，用来冒充登录二维码
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const ENGINE_TOOLS = [
  "check_login_status", "get_login_qrcode", "publish_content", "save_draft",
  "search_feeds", "get_my_feeds", "get_feed_detail", "delete_feed", "list_feeds",
];

const calls = [];

// ══════════════════════════════════════════════════════════
// 假引擎：工具名与真实引擎一致，把收到的每次调用记下来
// ══════════════════════════════════════════════════════════
async function startMockEngine() {
  const server = new Server({ name: "mock-xhs", version: "0.0.0" },
    { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ENGINE_TOOLS.map((name) => ({
      name, description: `mock ${name}`,
      inputSchema: { type: "object", properties: {} },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    calls.push({ name, args });
    if (name === "check_login_status") {
      return { content: [{ type: "text", text: "已登录。mock-engine-says-ok" }] };
    }
    if (name === "get_login_qrcode") {
      return { content: [{ type: "image", data: PNG_B64, mimeType: "image/png" }] };
    }
    if (name === "publish_content") {
      return { content: [{ type: "text", text: "发布成功 note_id=abc123" }] };
    }
    if (name === "delete_feed") {
      return { content: [{ type: "text", text: "已删除 " + (args.feed_id ?? "") }] };
    }
    return { content: [{ type: "text", text: `mock ${name} ok` }] };
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await server.connect(transport);

  const http = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body;
    try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
    try {
      await transport.handleRequest(req, res, body);
    } catch (e) {
      if (!res.headersSent) res.writeHead(500).end(String(e));
    }
  });
  await new Promise((r) => http.listen(0, "127.0.0.1", r));
  const port = http.address().port;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => new Promise((r) => http.close(r)),
  };
}

// ══════════════════════════════════════════════════════════
// 把我的服务当成一个 stdio MCP 客户端接上去
// ══════════════════════════════════════════════════════════
async function connect(engineUrl) {
  const client = new Client({ name: "selftest", version: "0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "index.ts"],
    cwd: HERE,
    env: { ...process.env, XHS_ENGINE_URL: engineUrl, XHS_QR_DIR: QR_DIR },
    stderr: "inherit",
  });
  await client.connect(transport);
  return client;
}

const textOf = (r) => (r.content ?? [])
  .filter((c) => c.type === "text").map((c) => c.text).join("\n");

let pass = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ✓ ${label}`); pass++; }
  catch (e) { console.error(`  ✗ ${label}\n      ${e.message}`); failed++; }
}
const publishes = () => calls.filter((c) => c.name === "publish_content");

// ══════════════════════════════════════════════════════════
const mock = await startMockEngine();
console.log(`假引擎起来了：${mock.url}\n`);
const cli = await connect(mock.url);

console.log("【1】工具面");
const tools = (await cli.listTools()).tools.map((t) => t.name).sort();
{
  const want = ["xhs_delete_note", "xhs_get_note", "xhs_login_qrcode",
    "xhs_my_feeds", "xhs_publish_note", "xhs_raw", "xhs_save_draft",
    "xhs_search", "xhs_status"].sort();
  check(`9 个工具齐全：${tools.join(", ")}`,
    () => assert.deepEqual(tools, want));
}

console.log("\n【2】引擎可达 + 登录状态");
{
  const t = textOf(await cli.callTool({ name: "xhs_status", arguments: {} }));
  check("报告引擎可达", () => assert.match(t, /引擎：\*\*可达\*\* ✓/));
  check("带出登录状态", () => assert.match(t, /mock-engine-says-ok/));
  check("列出引擎的工具名", () => assert.match(t, /publish_content/));
}

console.log("\n【3】dry_run 只回显、不发布");
{
  const t = textOf(await cli.callTool({
    name: "xhs_publish_note",
    arguments: { title: "标题", content: "正文", images: [], dry_run: true },
  }));
  check("回显了标题与正文", () => {
    assert.match(t, /dry_run：没有发布任何东西/);
    assert.match(t, /标题（2\/20 字）：标题/);
  });
  check("**引擎一次发布请求都没收到**", () => assert.equal(publishes().length, 0));
}

console.log("\n【4】标题超 20 字被拦住");
{
  const long = "一二三四五六七八九十一二三四五六七八九十多出来的字";
  const r = await cli.callTool({
    name: "xhs_publish_note",
    arguments: { title: long, content: "正文", images: [] },
  });
  check("isError + 指出上限并给出截断样子", () => {
    assert.equal(r.isError, true);
    assert.match(textOf(r), /超过小红书上限 20 字/);
    assert.match(textOf(r), /截到上限是：「一二三四五六七八九十一二三四五六七八九十」/);
  });
  check("依然没有发出发布请求", () => assert.equal(publishes().length, 0));
}

console.log("\n【5】本地图片不存在被拦住");
{
  const r = await cli.callTool({
    name: "xhs_publish_note",
    arguments: { title: "标题", content: "正文", images: ["D:/肯定不存在的图.png"] },
  });
  check("isError + 列出缺失路径", () => {
    assert.equal(r.isError, true);
    assert.match(textOf(r), /这些本地图片不存在/);
    assert.match(textOf(r), /D:\/肯定不存在的图\.png/);
  });
  check("依然没有发出发布请求", () => assert.equal(publishes().length, 0));
}

console.log("\n【6】正文里的 #话题 被搬到 tags（本服务存在的理由）");
{
  const r = await cli.callTool({
    name: "xhs_publish_note",
    arguments: {
      title: "测试标题",
      content: "我的做法是#数学建模 里的#无人机调度，仅供参考。",
      images: ["https://example.com/a.png"],
      tags: ["研赛"],
    },
  });
  const t = textOf(r);
  const sent = publishes().at(-1);
  check("发布请求已发出", () => assert.equal(publishes().length, 1));
  check("正文里不再有 # 标签", () => {
    assert.ok(!/#(数学建模|无人机调度)/.test(sent.args.content),
      `正文里仍有标签：${sent.args.content}`);
  });
  check("三个话题都在 tags 里且不带 #", () => {
    assert.deepEqual(sent.args.tags, ["研赛", "数学建模", "无人机调度"]);
  });
  check("抽掉标签后其余文字逐字保留、且无连续双空格", () => {
    // 标签是**夹在句子中间**写的，抽走之后自然留一个空档——这是能做到的最好结果，
    // 不能指望脚本替你把句子重写通顺。这里断言的就是这个行为本身。
    const c = sent.args.content;
    assert.ok(!/ {2}/.test(c), `出现了连续空格：${JSON.stringify(c)}`);
    assert.equal(c, "我的做法是 里的，仅供参考。");
  });
  check("回显里提醒了这次搬动", () => assert.match(t, /已自动移到话题/));
  check("引擎返回的发布结果被转达", () => assert.match(t, /发布成功 note_id=abc123/));
}

console.log("\n【6b】正文过长 / markdown 残留：提醒但放行");
{
  const before = publishes().length;
  const long = "啊".repeat(1200) + "\n**加粗**\n## 标题";
  const r = await cli.callTool({
    name: "xhs_publish_note",
    arguments: { title: "标题", content: long, images: ["https://example.com/a.png"] },
  });
  const t = textOf(r);
  check("超长正文被提醒", () =>
    assert.ok(t.includes("超过约 1000 字的常见上限"), t.slice(0, 200)));
  check("markdown 残留被点名", () =>
    assert.ok(t.includes("markdown 写法（**加粗**、## 标题）"), t.slice(0, 300)));
  check("仍然放行（只提醒不硬拦）", () =>
    assert.equal(publishes().length, before + 1));
}

console.log("\n【7】二维码落成 PNG 并作为图片返回");
{
  const r = await cli.callTool({ name: "xhs_login_qrcode", arguments: {} });
  const img = (r.content ?? []).find((c) => c.type === "image");
  check("返回了 image 内容块（客户端能直接显示）", () => {
    assert.ok(img, "没有 image 块");
    assert.equal(img.mimeType, "image/png");
    assert.equal(img.data, PNG_B64);
  });
  check("PNG 确实写到了磁盘且字节正确", () => {
    const m = /二维码已存到：(\S+\.png)/.exec(textOf(r));
    assert.ok(m, "回显里没有路径");
    assert.ok(existsSync(m[1]), `文件不存在：${m[1]}`);
    assert.equal(readFileSync(m[1]).toString("base64"), PNG_B64);
  });
}

console.log("\n【8】删除笔记的确认闸门");
{
  const before = calls.filter((c) => c.name === "delete_feed").length;
  const r1 = await cli.callTool({
    name: "xhs_delete_note", arguments: { feed_id: "note-1" },
  });
  check("不带 confirm → 拒绝", () => {
    assert.equal(r1.isError, true);
    assert.match(textOf(r1), /删除不可恢复/);
  });
  check("拒绝时没有真的调用 delete_feed", () =>
    assert.equal(calls.filter((c) => c.name === "delete_feed").length, before));
  const r2 = await cli.callTool({
    name: "xhs_delete_note", arguments: { feed_id: "note-1", confirm: true },
  });
  check("带 confirm → 真的删了", () => {
    assert.equal(textOf(r2).includes("已删除 note-1"), true);
    assert.equal(calls.filter((c) => c.name === "delete_feed").length, before + 1);
  });
}

console.log("\n【9】xhs_raw 的确认闸门");
{
  const before = publishes().length;
  const r1 = await cli.callTool({
    name: "xhs_raw",
    arguments: { tool: "publish_content", args: { title: "x", content: "y", images: [] } },
  });
  check("透传发布类工具、不带 confirm → 拒绝", () => {
    assert.equal(r1.isError, true);
    assert.match(textOf(r1), /必须显式传 confirm=true/);
    assert.equal(publishes().length, before);
  });
  const r2 = await cli.callTool({
    name: "xhs_raw", arguments: { tool: "list_feeds", args: {} },
  });
  check("只读工具可透传", () => {
    assert.equal(r2.isError ?? false, false);
    assert.match(textOf(r2), /list_feeds/);
  });
}

await cli.close();

console.log("\n【10】引擎连不上时给人话（换个死端口）");
{
  const dead = await connect("http://127.0.0.1:1/mcp");
  const t = textOf(await dead.callTool({ name: "xhs_status", arguments: {} }));
  check("status 报告连不上", () => assert.match(t, /连不上/));
  check("给出启动办法而不是堆栈", () => {
    assert.match(t, /docker compose up -d/);
    assert.match(t, /18060/);
  });
  const r = await dead.callTool({
    name: "xhs_publish_note",
    arguments: { title: "标题", content: "正文", images: [] },
  });
  check("发布失败也返回人话 + isError", () => {
    assert.equal(r.isError, true);
    assert.match(textOf(r), /连不上小红书引擎/);
  });
  await dead.close();
}

await mock.close();
console.log(`\n${"─".repeat(60)}`);
console.log(`通过 ${pass} 项，失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
