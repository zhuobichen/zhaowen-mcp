// 真的把 MCP 服务拉起来、走 stdio JSON-RPC 调工具。
// 直接 import 函数测不出「协议层装配错了」这类问题（工具没注册、schema 写错、
// stdout 被日志污染都会让真实调用失败而单元测试全绿）。
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpHome = mkdtempSync(join(tmpdir(), "memefinder-selftest-"));
const child = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "index.ts"],
  { cwd: process.cwd(), env: { ...process.env, MEME_FINDER_HOME: tmpHome }, stdio: ["pipe", "pipe", "pipe"] }
);

let buf = "";
const pending = new Map();
let nextId = 1;
let stderrAll = "";

child.stdout.on("data", (d) => {
  buf += d.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
child.stderr.on("data", (d) => { stderrAll += d.toString("utf8"); });

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`超时: ${method}`)), 120000);
    pending.set(id, (m) => { clearTimeout(t); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

try {
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "selftest", version: "1.0.0" },
  });
  check("initialize", init.result?.serverInfo?.name === "meme-finder",
        init.result?.serverInfo?.name ?? JSON.stringify(init).slice(0, 120));
  notify("notifications/initialized", {});

  const tools = await rpc("tools/list", {});
  const names = (tools.result?.tools ?? []).map((t) => t.name);
  const expected = ["search_packs", "list_pack", "save_pack", "list_saved", "remove_saved", "fetch_pack"];
  const missing = expected.filter((n) => !names.includes(n));
  check("tools/list 六个工具齐", missing.length === 0, missing.length ? "缺: " + missing.join(",") : names.join(","));

  const textOf = (r) => (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");

  // 1) search_packs —— 用一个已知存在的主题，验证真能搜到
  const s = await rpc("tools/call", { name: "search_packs", arguments: { keyword: "蓝色大肥鱼", limit: 6 } });
  const sText = textOf(s);
  check("search_packs 有返回", sText.length > 50, `${sText.length} 字`);
  // 断「仓库列表非空」而不是断某个具体仓库：GitHub 排序会变，锁死单个仓库名会变成假失败。
  const repoLines = sText.split("\n").filter((l) => l.startsWith("- **"));
  check("search_packs 仓库列表非空", repoLines.length > 0, `${repoLines.length} 个仓库`);
  const KNOWN = ["deepseek-chan-meme-pack", "blue-fish-archive", "ai-girl-stickers", "deepseek-meme-hub", "dsh-meme"];
  const hit = KNOWN.find((k) => sText.includes(k));
  check("search_packs 命中了已知的蓝色大肥鱼仓库", !!hit, hit ? `命中 ${hit}` : "一个已知仓库都没命中");

  // 2) list_pack —— 验证给出的是改写过、可直连的链接
  const l = await rpc("tools/call", { name: "list_pack", arguments: { repo: "the-beating-light-of-the-nail/deepseek-chan-meme-pack", path: "previews", limit: 3 } });
  const lText = textOf(l);
  check("list_pack 列出图片", /\.webp/.test(lText), `${lText.split("\n").length} 行`);
  check("list_pack 用 jsdelivr 改写（不用 raw）", lText.includes("cdn.jsdelivr.net") && !/raw\.githubusercontent\.com\/[^ ]+\d/.test(lText),
        lText.includes("cdn.jsdelivr.net") ? "有 jsdelivr 链接" : "没看到 jsdelivr");

  // 3) save_pack + list_saved + remove_saved —— 登记簿往返
  const sv = await rpc("tools/call", { name: "save_pack", arguments: { repo: "the-beating-light-of-the-nail/deepseek-chan-meme-pack", path: "previews", title: "自测用", note: "selftest" } });
  const svText = textOf(sv);
  check("save_pack 登记成功", svText.includes("已登记"), svText.split("\n")[0]);
  const regFile = join(tmpHome, "packs.json");
  check("登记簿文件已落盘", existsSync(regFile), regFile);
  if (existsSync(regFile)) {
    const packs = JSON.parse(readFileSync(regFile, "utf8")).packs ?? [];
    check("登记簿内容正确", packs.length === 1 && packs[0].id.includes("deepseek-chan-meme-pack"),
          packs.length ? packs[0].id : "空");
  }
  // 注意：上面 save_pack 传了 title/note，把自动填的仓库简介覆盖掉了，
  // 所以记录里能匹配的词是 repo id（含 deepseek-chan-meme-pack），不是「大肥鱼」。
  const ls = await rpc("tools/call", { name: "list_saved", arguments: { keyword: "deepseek-chan" } });
  const lsText = textOf(ls);
  check("list_saved 能按关键词查到", lsText.includes("deepseek-chan-meme-pack"), `${lsText.split("\n").length} 行`);
  // 反向用例：过滤必须是真过滤，不能永远返回全部
  const lsMiss = await rpc("tools/call", { name: "list_saved", arguments: { keyword: "这个词不可能命中zzz" } });
  check("list_saved 查不到时确实为空", textOf(lsMiss).includes("清单里没有记录"), textOf(lsMiss).split("\n")[0].slice(0, 50));
  const rm = await rpc("tools/call", { name: "remove_saved", arguments: { id: "the-beating-light-of-the-nail/deepseek-chan-meme-pack#previews" } });
  check("remove_saved 移除成功", textOf(rm).includes("已从清单移除"), textOf(rm).trim());

  // 4) 错误路径必须是「文本返回」而不是抛异常/断连
  const bad = await rpc("tools/call", { name: "list_pack", arguments: { repo: "不存在的仓库格式" } });
  check("错误输入返回错误文本而非崩掉", textOf(bad).startsWith("错误:"), textOf(bad).slice(0, 60));
  const unknown = await rpc("tools/call", { name: "no_such_tool", arguments: {} });
  check("未知工具返回文本", textOf(unknown).includes("未知工具"), textOf(unknown).slice(0, 40));
} catch (e) {
  check("整体流程未抛异常", false, String(e.message ?? e));
} finally {
  child.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (stderrAll.trim()) {
  console.log("\n--- 服务端 stderr（stdout 才是协议，stderr 应只有日志）---");
  console.log(stderrAll.trim().split("\n").slice(0, 15).join("\n"));
}
process.exit(failed.length ? 1 : 0);
