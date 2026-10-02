// 真走 stdio JSON-RPC。除了协议层，重点是**筛选器的判别力**：
// 宽阈值必须覆盖得更广、严阈值必须更窄——只断言「有返回」是恒真的，测不出筛选器坏没坏。
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "index.ts"],
  { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
let buf = ""; const pending = new Map(); let id = 1; let stderr = "";
child.stdout.on("data", (d) => {
  buf += d.toString("utf8"); let i;
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
const textOf = (r) => (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  -- " + d : ""}`); };

try {
  const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "selftest", version: "1" } });
  check("initialize", init.result?.serverInfo?.name === "weather-mcp", init.result?.serverInfo?.name ?? "?");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

  const tools = await rpc("tools/list", {});
  const names = (tools.result?.tools ?? []).map((t) => t.name);
  const want = ["hourly_forecast", "dry_windows", "resolve_place"];
  const miss = want.filter((n) => !names.includes(n));
  check("tools/list 三个工具齐", miss.length === 0, miss.length ? "缺: " + miss.join(",") : names.join(","));

  // 地名解析
  const geo = textOf(await rpc("tools/call", { name: "resolve_place", arguments: { name: "广州" } }));
  const m = geo.match(/坐标: (-?[\d.]+),(-?[\d.]+)/);
  // ⚠️ 第一个是纬度(上限 90)、第二个是经度(上限 180)——别套反
  const inRange = m && Math.abs(Number(m[1])) <= 90 && Math.abs(Number(m[2])) <= 180;
  check("resolve_place 给出合法坐标", !!inRange, m ? `lat=${m[1]} lon=${m[2]}` : geo.slice(0, 60));

  // 逐小时表
  const hf = textOf(await rpc("tools/call", { name: "hourly_forecast", arguments: { place: "广州", days: 3 } }));
  const hourRows = hf.split("\n").filter((l) => /^\s+\d{2}:\d{2}\s/.test(l)).length;
  check("hourly_forecast 返回逐小时行", hourRows >= 24, `${hourRows} 行`);
  check("hourly_forecast 含降水与风", hf.includes("降水") && hf.includes("风"), "");

  // 取一个可预报的日期（从返回里抽）
  const dstr = (hf.match(/\d{4}-\d{2}-\d{2}/) ?? [])[0];
  check("能确定一个可预报日期", !!dstr, dstr ?? "?");

  if (dstr) {
    // ① 默认阈值
    const dw = textOf(await rpc("tools/call", { name: "dry_windows", arguments: { place: "广州", date: dstr, min_hours: 1 } }));
    check("dry_windows 有结论（有窗口 或 明确说没有）",
      dw.includes("~") || dw.includes("没有满足条件的窗口"), dw.split("\n")[1] ?? "");

    // ② 判别力：宽阈值覆盖更广、严阈值更窄。
    // ⚠️ 度量要用「覆盖的总小时数」，不是「窗口个数」——宽阈值会把全天合并成
    //    一个长窗口，个数反而变少；用个数比会得出「宽阈值更严」的反向结论。
    const loose = textOf(await rpc("tools/call", { name: "dry_windows", arguments: { place: "广州", date: dstr, min_hours: 1, mm_tol: 999, prob_tol: 100 } }));
    const tight = textOf(await rpc("tools/call", { name: "dry_windows", arguments: { place: "广州", date: dstr, min_hours: 1, mm_tol: 0, prob_tol: 0 } }));
    const hours = (t) => (t.match(/（(\d+) 小时）/g) ?? [])
      .reduce((s, x) => s + Number(x.replace(/\D/g, "")), 0);
    const hl = hours(loose), ht = hours(tight), hd = hours(dw);
    check("筛选器有判别力（覆盖小时数 宽 >= 默认 >= 严）", hl >= hd && hd >= ht, `宽=${hl}h 默认=${hd}h 严=${ht}h`);
    check("宽阈值确实覆盖更多", hl > ht, `宽=${hl}h vs 严=${ht}h`);
  }

  // 错误路径
  const bad = textOf(await rpc("tools/call", { name: "dry_windows", arguments: { place: "广州", date: "10-05" } }));
  check("坏日期返回错误文本", bad.startsWith("错误:"), bad.slice(0, 40));
  const unk = textOf(await rpc("tools/call", { name: "no_such", arguments: {} }));
  check("未知工具返回文本", unk.includes("未知工具"), unk.slice(0, 30));
} catch (e) {
  check("整体流程未抛异常", false, String(e?.message ?? e));
} finally { child.kill(); }

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (stderr.trim()) { console.log("\n--- stderr ---"); console.log(stderr.trim().split("\n").slice(0, 8).join("\n")); }
process.exit(failed.length ? 1 : 0);
