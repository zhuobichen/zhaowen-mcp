/**
 * Markdown 版战绩小结（第三种输出形态）。
 *
 * HTML 报告好看但不好搬，CSV 好算但不好读。这一份是给人**贴出去**用的：
 * 丢进聊天、issue、笔记都能直接渲染，纯文本也能读。
 *
 * 内容取向和 HTML 报告不同：HTML 是「尽可能全」，这份是「一屏看完」——
 * 只留核心数字、逐周走势、几条结论，以及体检挑出来的待办。
 *
 * 文件写到仓库 reports/ 目录（已在 .gitignore 排除）。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeTrend } from "./trend.js";
import { checkup } from "./checkup.js";
import { loadLolGames } from "./games.js";
import { resolveAccountByName, resolveMe } from "./identity.js";
import { isMayhemGame } from "./lcu.js";
import { loadData } from "./store.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPORTS_DIR = path.join(ROOT, "reports");

export interface MdResult {
  path: string;
  bytes: number;
  name: string;
  games: number;
  winRate: number;
  preview: string;
}

const pct = (v: number) => `${v.toFixed(1)}%`;
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;

export async function reportMarkdown(
  opts: { who?: string; out?: string } = {}
): Promise<MdResult> {
  let puuid: string;
  let name: string;
  if (opts.who) {
    const r = await resolveAccountByName(opts.who);
    if (!r.matches.length) throw new Error(`没找到「${opts.who}」——${r.note}`);
    puuid = r.matches[0].puuid;
    name = r.matches[0].name;
  } else {
    const me = await resolveMe();
    if (!me) throw new Error("客户端没开且没有固定过账号：先在线跑一次 get_my_account_status。");
    puuid = me.puuid;
    name = me.name;
  }

  const d = loadData();
  const res = await loadLolGames(puuid, 2000, name);
  const games = res.games.filter(isMayhemGame);

  // 基础聚合
  let n = 0;
  let wins = 0;
  let kills = 0;
  let deaths = 0;
  let assists = 0;
  let damage = 0;
  let duration = 0;
  let penta = 0;
  let quadra = 0;
  const champMap = new Map<string, { g: number; w: number }>();
  const weekMap = new Map<number, { g: number; w: number }>();

  for (const g of games) {
    const p = (g.participants ?? []).find((x: any) => x.puuid === puuid);
    const s: any = p?.stats ?? {};
    if (s.win === undefined) continue;
    n++;
    if (s.win === true) wins++;
    kills += Number(s.kills ?? 0);
    deaths += Number(s.deaths ?? 0);
    assists += Number(s.assists ?? 0);
    damage += Number(s.totalDamageDealtToChampions ?? 0);
    duration += Number(g.gameDuration ?? 0) / 60;
    penta += Number(s.pentaKills ?? 0);
    quadra += Number(s.quadraKills ?? 0);

    const cid = d.championIds[String(p?.championId)];
    const cn = cid ? d.championById.get(cid.id)?.name ?? cid.name : null;
    if (cn) {
      const c = champMap.get(cn) ?? { g: 0, w: 0 };
      c.g++;
      if (s.win === true) c.w++;
      champMap.set(cn, c);
    }

    const dt = new Date(g.gameCreation ?? 0);
    dt.setHours(0, 0, 0, 0);
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    const wk = dt.getTime();
    const w = weekMap.get(wk) ?? { g: 0, w: 0 };
    w.g++;
    if (s.win === true) w.w++;
    weekMap.set(wk, w);
  }

  if (!n) throw new Error(`没有可用的海斗对局（${res.note}）。`);

  const base = (wins / n) * 100;
  const [trend, chk] = await Promise.all([
    analyzeTrend({ kind: "mayhem" }).catch(() => null),
    checkup({ puuid, name }).catch(() => null),
  ]);

  const fmtDay = (t: number) => {
    const dd = new Date(t);
    const p = (x: number) => String(x).padStart(2, "0");
    return `${p(dd.getMonth() + 1)}/${p(dd.getDate())}`;
  };
  const weeks = [...weekMap.entries()].sort((a, b) => a[0] - b[0]).slice(-12);
  const topChamps = [...champMap.entries()]
    .filter(([, v]) => v.g >= 5)
    .map(([k, v]) => ({ name: k, games: v.g, winRate: (v.w / v.g) * 100 }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 8);

  const L: string[] = [];
  L.push(`# ${name} · 海斗战绩小结`);
  L.push("");
  L.push(`> 数据区间：${new Date(games[games.length - 1]?.gameCreation ?? 0).toLocaleDateString("zh-CN")} ~ ` +
    `${new Date(games[0]?.gameCreation ?? 0).toLocaleDateString("zh-CN")}｜共 ${n} 局｜生成于 ${new Date().toLocaleString("zh-CN", { hour12: false })}`);
  L.push("");
  L.push("## 核心数字");
  L.push("");
  L.push("| 指标 | 数值 |");
  L.push("|---|---|");
  L.push(`| 胜率 | **${pct(base)}**（${wins} 胜 ${n - wins} 负） |`);
  L.push(`| 场均 KDA | ${(kills / n).toFixed(1)} / ${(deaths / n).toFixed(1)} / ${(assists / n).toFixed(1)}（${((kills + assists) / Math.max(deaths, 1)).toFixed(2)}） |`);
  L.push(`| 场均伤害 | ${Math.round(damage / n / 1000)}k |`);
  L.push(`| 场均时长 | ${(duration / n).toFixed(0)} 分 |`);
  L.push(`| 五杀 / 四杀 | ${penta} / ${quadra} |`);
  L.push(`| 英雄池 | ${champMap.size} 个 |`);
  L.push("");

  if (weeks.length > 1) {
    L.push("## 逐周走势");
    L.push("");
    L.push("| 周起始 | 场次 | 胜率 |");
    L.push("|---|---:|---:|");
    for (const [t, v] of weeks) {
      const wr = (v.w / v.g) * 100;
      L.push(`| ${fmtDay(t)} | ${v.g} | ${pct(wr)} |`);
    }
    L.push("");
  }

  if (topChamps.length) {
    L.push("## 常玩英雄");
    L.push("");
    L.push("| 英雄 | 场次 | 胜率 |");
    L.push("|---|---:|---:|");
    for (const c of topChamps) L.push(`| ${c.name} | ${c.games} | ${pct(c.winRate)} |`);
    L.push("");
  }

  if (chk?.items.length) {
    L.push("## 体检：值得看的几条");
    L.push("");
    chk.items.forEach((x, i) => {
      L.push(`${i + 1}. **${x.area}** —— ${x.finding}`);
    });
    L.push("");
    if (chk.skipped.length) {
      L.push(`未跑出结论的维度（样本不够，共 ${chk.skipped.length} 个）：${chk.skipped.join("、")}`);
      L.push("");
    }
  }

  if (trend?.verdict) {
    L.push("## 趋势");
    L.push("");
    L.push(trend.verdict);
    L.push("");
  }

  L.push("---");
  L.push("");
  L.push(
    `数据来源：${res.note}`
  );
  L.push("");
  L.push(
    "说明：本小结由 aram-mayhem MCP 生成；胜率等为**观察数据**，不含因果推断。" +
      "各条结论的样本门槛与口径见对应工具的完整输出。"
  );

  const md = L.join("\n");
  const safe = name.replace(/[\\/:*?"<>|]/g, "_");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const out = opts.out ?? path.join(REPORTS_DIR, `海斗小结-${safe}-${stamp}.md`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, md, "utf8");

  return {
    path: out,
    bytes: Buffer.byteLength(md, "utf8"),
    name,
    games: n,
    winRate: base,
    preview: md.split("\n").slice(0, 14).join("\n"),
  };
}

/** 文本输出 */
export async function reportMarkdownText(opts: { who?: string; out?: string } = {}): Promise<string> {
  let r: MdResult;
  try {
    r = await reportMarkdown(opts);
  } catch (e: any) {
    return `生成失败：${e?.message ?? e}`;
  }
  return [
    `已生成 Markdown 小结：${r.path}`,
    `${r.name} · ${r.games} 局 · 胜率 ${r.winRate.toFixed(1)}% · ${(r.bytes / 1024).toFixed(1)} KB`,
    "",
    "开头几行：",
    r.preview,
    "",
    "说明：Markdown 版是「一屏看完」的取向（核心数字 + 逐周 + 常玩英雄 + 体检结论），",
    "要全量图表用 HTML 报告，要做自己的分析用 CSV。",
  ].join("\n");
}
