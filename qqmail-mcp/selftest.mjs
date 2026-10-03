// 两组检查：
//   A. 静态只读审计 —— 源码里不许出现任何会改动邮箱的 IMAP 调用，且每个 mailboxOpen 必须 readOnly
//   B. 协议层 —— 真的把服务拉起来走 stdio JSON-RPC；无凭据时要给出清晰提示而不是挂死
// 有凭据（QQMAIL_USER + QQMAIL_AUTH_CODE）时再跑 C. 真实邮箱联调。
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
};

// ---------------------------------------------------------------- A. 静态审计

const sources = ["index.ts", ...readdirSync("lib").filter((f) => f.endsWith(".ts")).map((f) => join("lib", f))];
const allText = sources.map((f) => ({ f, t: readFileSync(f, "utf8") }));

// 任何会改动服务器上邮件的 imapflow 接口
const MUTATORS = [
  "messageDelete", "messageMove", "messageCopy", "messageFlagsAdd", "messageFlagsRemove",
  "append", "mailboxCreate", "mailboxDelete", "mailboxRename",
  "mailboxSubscribe", "mailboxUnsubscribe", "expunge", "createMessageUid",
  "sendMail", "smtp", "nodemailer",
];
const hits = [];
for (const { f, t } of allText) {
  for (const m of MUTATORS) {
    // 匹配方法调用形式 .append( / .messageDelete( 等，避免误伤注释里的词
    const re = new RegExp("\\." + m + "\\s*\\(", "i");
    if (re.test(t)) hits.push(`${f}: .${m}(`);
  }
}
check("源码里没有任何会改动邮箱的 IMAP 调用", hits.length === 0, hits.join(", ") || "干净");

// 每个 mailboxOpen 必须带 readOnly: true
let openCount = 0, badOpen = [];
for (const { f, t } of allText) {
  const re = /mailboxOpen\s*\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(t))) {
    openCount++;
    if (!/readOnly\s*:\s*true/.test(m[1])) badOpen.push(`${f}: mailboxOpen(${m[1].trim()})`);
  }
}
check(`每个 mailboxOpen 都带 readOnly: true（共 ${openCount} 处）`, openCount > 0 && badOpen.length === 0,
      badOpen.join(" | ") || `${openCount} 处全部带`);

// 凭据不许出现在返回给模型的内容里：检查没有把 authCode 直接拼进输出
const leaks = [];
for (const { f, t } of allText) {
  if (/\$\{[^}]*authCode[^}]*\}/.test(t) && !/\.length/.test(t.match(/\$\{[^}]*authCode[^}]*\}/g)?.join("") ?? "")) {
    // 只允许输出 authCode.length，不允许输出 authCode 本身
    const occ = t.match(/\$\{[^}]*authCode[^}]*\}/g) || [];
    for (const o of occ) if (!/length/.test(o)) leaks.push(`${f}: ${o}`);
  }
}
check("没有把授权码拼进任何输出", leaks.length === 0, leaks.join(" | ") || "干净");

// ---------------------------------------------------------------- B. 协议层

const env = { ...process.env };
delete env.QQMAIL_USER;
delete env.QQMAIL_AUTH_CODE;

function startServer(extraEnv) {
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "index.ts"], {
    cwd: process.cwd(), env: { ...process.env, ...extraEnv }, stdio: ["pipe", "pipe", "pipe"],
  });
  let buf = "";
  const pending = new Map();
  let id = 1;
  let stderr = "";
  child.stdout.on("data", (d) => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
  const rpc = (method, params) => {
    const i = id++;
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("timeout " + method)), 90000);
      pending.set(i, (m) => { clearTimeout(t); res(m); });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
    });
  };
  return { child, rpc, getStderr: () => stderr };
}

const textOf = (r) => (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");

try {
  // --- 无凭据
  const s1 = startServer({ QQMAIL_USER: "", QQMAIL_AUTH_CODE: "" });
  const init = await s1.rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "selftest", version: "1" } });
  check("initialize", init.result?.serverInfo?.name === "qqmail-mcp", init.result?.serverInfo?.name ?? "?");
  s1.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

  const tools = await s1.rpc("tools/list", {});
  const names = (tools.result?.tools ?? []).map((t) => t.name);
  const expected = ["check_status", "list_folders", "list_recent", "search", "read_message"];
  const missing = expected.filter((n) => !names.includes(n));
  check("tools/list 五个工具齐", missing.length === 0, missing.length ? "缺: " + missing.join(",") : names.join(","));

  const st = await s1.rpc("tools/call", { name: "check_status", arguments: {} });
  const stText = textOf(st);
  check("无凭据时 check_status 说清原因", stText.includes("未设置") && stText.includes("QQMAIL_AUTH_CODE"), stText.split("\n").find(l => l.includes("授权码")) ?? "");

  const lr = await s1.rpc("tools/call", { name: "list_recent", arguments: {} });
  const lrText = textOf(lr);
  check("无凭据时 list_recent 返回提示而非挂死", lrText.includes("错误:") && lrText.includes("未配置凭据"), lrText.slice(0, 60));

  const unk = await s1.rpc("tools/call", { name: "no_such_tool", arguments: {} });
  check("未知工具返回文本", textOf(unk).includes("未知工具"), textOf(unk).slice(0, 40));

  s1.child.kill();

  // --- 有凭据：真实联调
  const hasCreds = Boolean(process.env.QQMAIL_USER && process.env.QQMAIL_AUTH_CODE);
  if (!hasCreds) {
    console.log("\n[SKIP] 未设置 QQMAIL_USER/QQMAIL_AUTH_CODE —— 跳过真实邮箱联调");
    console.log("       设好这两个环境变量后重跑 npm test 即可跑完整链路。");
  } else {
    const s2 = startServer({});
    await s2.rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "selftest", version: "1" } });
    s2.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

    const live = await s2.rpc("tools/call", { name: "check_status", arguments: {} });
    check("真实登录成功", textOf(live).includes("登录成功"), textOf(live).split("\n").filter(l=>l.includes("登录")).join(" "));

    const f = await s2.rpc("tools/call", { name: "list_folders", arguments: {} });
    check("列出文件夹", textOf(f).includes("INBOX"), `${textOf(f).split("\n").length} 行`);

    const r = await s2.rpc("tools/call", { name: "list_recent", arguments: { limit: 5 } });
    check("列出最近邮件", textOf(r).length > 30, textOf(r).split("\n")[0]);

    const sc = await s2.rpc("tools/call", { name: "search", arguments: { q: "", limit: 3 } });
    check("搜索可用（空关键词=全列）", textOf(sc).includes("扫描最近"), textOf(sc).split("\n")[1]);

    // 从最近邮件里挑一封读正文
    const firstUid = (textOf(r).match(/uid=(\d+)/) ?? [])[1];
    if (firstUid) {
      const rd = await s2.rpc("tools/call", { name: "read_message", arguments: { uid: Number(firstUid) } });
      const rdText = textOf(rd);
      check("读正文", rdText.includes("## 正文") || rdText.includes("## 附件"), `uid=${firstUid}, ${rdText.length} 字`);
      check("读正文不泄漏授权码", !rdText.includes(process.env.QQMAIL_AUTH_CODE), "授权码未出现");
    }
    s2.child.kill();
  }
} catch (e) {
  check("整体流程未抛异常", false, String(e?.message ?? e));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
