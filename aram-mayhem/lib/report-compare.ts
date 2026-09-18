/**
 * 双账号对比报告（HTML）。
 *
 * 补的是「报告之间的比较」这一层：已有的报告都是**单人快照**，看完只能记住数字，
 * 没法并排比。compare_accounts 工具虽然能对比，但只回文本、没有图、也没法留档。
 *
 * 这一份把两个人放在同一张图上：
 *   · 逐周胜率双线（同一时间轴上直接看谁的状态更好）
 *   · 英雄池并列条形（各自的常玩英雄与胜率）
 *   · 符文偏好差异（谁更爱拿什么，背离条形）
 *   · 核心指标对照表 + 出装差异
 *
 * 口径提醒：两人局数、时间跨度、队列构成可能不同，图注里会点明 ——
 * 直接比总胜率在没有对齐样本时是不严谨的。
 *
 * 输出到仓库 reports/ 目录（已在 .gitignore 排除）。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLolGames } from "./games.js";
import { resolveAccountByName, resolveMe } from "./identity.js";
import { isMayhemGame } from "./lcu.js";
import { REPORT_CSS, reflowFigures } from "./report-style.js";
import { loadData } from "./store.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPORTS_DIR = path.join(ROOT, "reports");
const W = 900;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const pctNum = (w: number, g: number) => (g ? (w / g) * 100 : 0);
const fmtPct = (v: number, d = 1) => `${v.toFixed(d)}%`;

interface Side {
  name: string;
  games: number;
  wins: number;
  winRate: number;
  kda: number;
  damage: number;
  minutes: number;
  from: number | null;
  to: number | null;
  weekly: Array<{ t: number; games: number; wins: number; winRate: number }>;
  champions: Array<{ name: string; games: number; wins: number; winRate: number }>;
  augments: Array<{ name: string; games: number; winRate: number; share: number }>;
  items: Array<{ name: string; games: number; winRate: number }>;
}

async function collectSide(puuid: string, name: string): Promise<Side> {
  const d = loadData();
  const res = await loadLolGames(puuid, 2000, name);
  const games = res.games.filter(isMayhemGame);

  interface Row {
    t: number;
    win: boolean;
    champ: string;
    k: number;
    dd: number;
    a: number;
    dmg: number;
    min: number;
    augments: number[];
    items: number[];
  }
  const rows: Row[] = [];
  for (const g of games) {
    const p = (g.participants ?? []).find((x: any) => x.puuid === puuid) as any;
    const s: any = p?.stats ?? {};
    if (!p || s.win === undefined) continue;
    const cid = d.championIds[String(p.championId)];
    rows.push({
      t: Number(g.gameCreation ?? 0),
      win: s.win === true,
      champ: cid ? d.championById.get(cid.id)?.name ?? cid.name : "",
      k: Number(s.kills ?? 0),
      dd: Number(s.deaths ?? 0),
      a: Number(s.assists ?? 0),
      dmg: Number(s.totalDamageDealtToChampions ?? 0),
      min: Number(g.gameDuration ?? 0) / 60,
      augments: [1, 2, 3, 4, 5, 6].map((i) => Number(s[`playerAugment${i}`] ?? 0)).filter(Boolean),
      items: [0, 1, 2, 3, 4, 5, 6].map((i) => Number(s[`item${i}`] ?? 0)).filter(Boolean),
    });
  }
  rows.sort((x, y) => x.t - y.t);

  const n = rows.length;
  const wins = rows.filter((r) => r.win).length;
  const bucket = <T extends string | number>(key: (r: Row) => T) => {
    const m = new Map<T, { g: number; w: number }>();
    for (const r of rows) {
      const c = m.get(key(r)) ?? { g: 0, w: 0 };
      c.g++;
      if (r.win) c.w++;
      m.set(key(r), c);
    }
    return m;
  };

  const weekMap = bucket((r) => {
    const dd = new Date(r.t);
    dd.setHours(0, 0, 0, 0);
    dd.setDate(dd.getDate() - ((dd.getDay() + 6) % 7));
    return dd.getTime();
  });
  const weekly = [...weekMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, c]) => ({ t, games: c.g, wins: c.w, winRate: pctNum(c.w, c.g) }));

  const champMap = bucket((r) => r.champ);
  const champions = [...champMap.entries()]
    .filter(([k, c]) => k && c.g >= 5)
    .map(([k, c]) => ({ name: k, games: c.g, wins: c.w, winRate: pctNum(c.w, c.g) }))
    .sort((a, b) => b.games - a.games);

  // 符文要按「每件」展开，bucket 是按整局 key 的，这里单独算
  const augStat = new Map<number, { g: number; w: number }>();
  for (const r of rows) {
    for (const id of new Set(r.augments)) {
      const c = augStat.get(id) ?? { g: 0, w: 0 };
      c.g++;
      if (r.win) c.w++;
      augStat.set(id, c);
    }
  }
  const totalSlots = rows.reduce((s, r) => s + r.augments.length, 0);
  const augments = [...augStat.entries()]
    .filter(([, c]) => c.g >= 5)
    .map(([id, c]) => ({
      name: d.augments.find((x) => x.officialId === id)?.name ?? "",
      games: c.g,
      winRate: pctNum(c.w, c.g),
      share: totalSlots ? c.g / totalSlots : 0,
    }))
    .filter((x) => x.name);

  const itemStat = new Map<number, { g: number; w: number }>();
  for (const r of rows) {
    for (const id of new Set(r.items)) {
      const it = d.items[String(id)];
      if (!it) continue;
      // 只算成装与二级鞋，散件会被「结束得早」污染（见 store.isBuildItem 的注释）
      const finished = it.categories.includes("Boots") ? it.price >= 900 : it.price >= 2000;
      if (!finished) continue;
      const c = itemStat.get(id) ?? { g: 0, w: 0 };
      c.g++;
      if (r.win) c.w++;
      itemStat.set(id, c);
    }
  }
  const items = [...itemStat.entries()]
    .filter(([, c]) => c.g >= 5)
    .map(([id, c]) => ({ name: d.items[String(id)]?.name ?? `#${id}`, games: c.g, winRate: pctNum(c.w, c.g) }))
    .sort((a, b) => b.games - a.games);

  const avg = (f: (r: Row) => number) => (n ? rows.reduce((s, r) => s + f(r), 0) / n : 0);
  return {
    name,
    games: n,
    wins,
    winRate: pctNum(wins, n),
    kda: (avg((r) => r.k) + avg((r) => r.a)) / Math.max(avg((r) => r.dd), 0.1),
    damage: avg((r) => r.dmg),
    minutes: avg((r) => r.min),
    from: rows[0]?.t ?? null,
    to: rows[n - 1]?.t ?? null,
    weekly,
    champions,
    augments,
    items,
  };
}

// ---------------------------------------------------------------- 图

/** 逐周胜率双线：两人同一时间轴，各自一条线 */
function weeklyDual(a: Side, b: Side): string {
  const all = [...a.weekly.map((x) => x.t), ...b.weekly.map((x) => x.t)];
  if (all.length < 2) return "";
  const t0 = Math.min(...all);
  const t1 = Math.max(...all);
  const H = 240,
    padL = 44,
    padR = 18,
    padT = 22,
    padB = 34;
  const plotW = W - padL - padR,
    plotH = H - padT - padB;
  const X = (t: number) => padL + (plotW * (t - t0)) / Math.max(1, t1 - t0);
  const Y = (v: number) => padT + plotH * (1 - v / 100);

  const grid = [0, 25, 50, 75, 100]
    .map(
      (v) =>
        `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}"/>` +
        `<text class="axis-label" x="${padL - 8}" y="${Y(v) + 4}" text-anchor="end">${v}%</text>`
    )
    .join("");

  const line = (s: Side, color: string, dash = "") =>
    s.weekly.length > 1
      ? `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ""}` +
        ` points="${s.weekly.map((w) => `${X(w.t).toFixed(1)},${Y(w.winRate).toFixed(1)}`).join(" ")}"/>` +
        s.weekly
          .map(
            (w) =>
              `<circle cx="${X(w.t).toFixed(1)}" cy="${Y(w.winRate).toFixed(1)}" r="2.6" fill="${color}"` +
              ` data-tip="${esc(s.name)} · ${fmtDay(w.t)}|${w.wins}/${w.games} 胜 · ${fmtPct(w.winRate)}"/>`
          )
          .join("")
      : "";

  const ticks = 6;
  const xLabels = Array.from({ length: ticks }, (_, i) => {
    const t = t0 + ((t1 - t0) * i) / (ticks - 1);
    return `<text class="axis-label" x="${X(t).toFixed(1)}" y="${H - 12}" text-anchor="middle">${fmtDay(t)}</text>`;
  }).join("");

  return `
<figure class="chart">
  <figcaption>逐周胜率对照（两人同一时间轴；虚线=50% 基准。⚠ 两人局数/跨度不同，线越密的周样本越厚）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="双账号逐周胜率">
    ${grid}
    <line class="baseline" x1="${padL}" x2="${W - padR}" y1="${Y(50)}" y2="${Y(50)}"/>
    ${line(a, "var(--pos)")}
    ${line(b, "var(--accent)", "6 4")}
    ${xLabels}
  </svg>
</figure>`;
}

/** 符文偏好差异：背离条形，中轴 0 = 两人出现比例相同 */
function augmentDiff(a: Side, b: Side): string {
  const m = new Map<string, { a: number; b: number }>();
  for (const x of a.augments) m.set(x.name, { a: x.share, b: m.get(x.name)?.b ?? 0 });
  for (const x of b.augments) {
    const cur = m.get(x.name) ?? { a: 0, b: 0 };
    cur.b = x.share;
    m.set(x.name, cur);
  }
  const rows = [...m.entries()]
    .map(([name, v]) => ({ name, gap: v.a - v.b }))
    .filter((x) => Math.abs(x.gap) >= 0.015)
    .sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap))
    .slice(0, 12);
  if (rows.length < 2) return "";

  const rowH = 24,
    labelW = 150,
    valueW = 170;
  const trackW = W - labelW - valueW;
  const H = rows.length * rowH + 34;
  const maxAbs = Math.max(0.01, ...rows.map((r) => Math.abs(r.gap)));
  const cx = labelW + trackW / 2;
  const scale = (trackW / 2 - 10) / maxAbs;

  const bars = rows
    .map((r, i) => {
      const y = 24 + i * rowH;
      const len = Math.max(2, Math.abs(r.gap) * scale);
      const color = r.gap > 0 ? "var(--pos)" : "var(--accent)";
      const x = r.gap > 0 ? cx : cx - len;
      const who = r.gap > 0 ? a.name : b.name;
      return (
        `<text class="row-label" x="0" y="${y + 12}">${esc(r.name)}</text>` +
        `<rect class="bar" x="${x.toFixed(1)}" y="${y + 3}" width="${len.toFixed(1)}" height="13" rx="4" fill="${color}"` +
        ` data-tip="${esc(r.name)}|${esc(who)} 拿得更多 · 出现比例差 ${(Math.abs(r.gap) * 100).toFixed(1)} 个百分点"/>` +
        `<text class="row-value" x="${W - 2}" y="${y + 13}" text-anchor="end">${esc(who)} +${(Math.abs(r.gap) * 100).toFixed(1)}%</text>`
      );
    })
    .join("");

  return `
<figure class="chart">
  <figcaption>符文偏好差异（中轴=两人出现比例相同；右蓝=${esc(a.name)}拿得多，左橙=${esc(b.name)}拿得多）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="符文偏好差异">
    <text class="axis-label" x="${labelW}" y="14">← ${esc(b.name)}</text>
    <text class="axis-label" x="${W - valueW}" y="14" text-anchor="end">${esc(a.name)} →</text>
    <line class="baseline" x1="${cx}" y1="20" x2="${cx}" y2="${H - 10}"/>
    ${bars}
  </svg>
</figure>`;
}

/** 英雄池并列：各自出场最多的英雄，左右两栏 */
function championColumns(a: Side, b: Side): string {
  const top = 10;
  const A = a.champions.slice(0, top);
  const B = b.champions.slice(0, top);
  if (!A.length || !B.length) return "";
  const rowH = 24,
    colW = W / 2 - 12;
  const H = Math.max(A.length, B.length) * rowH + 30;
  const maxG = Math.max(1, ...A.map((x) => x.games), ...B.map((x) => x.games));

  const col = (list: typeof A, x0: number, label: string) => {
    const head = `<text class="axis-label" x="${x0}" y="14">${esc(label)}</text>`;
    const bars = list
      .map((c, i) => {
        const y = 22 + i * rowH;
        const w = Math.max(2, ((colW - 150) * c.games) / maxG);
        const color = c.winRate >= 50 ? "var(--pos)" : "var(--neg)";
        return (
          `<text class="row-label" x="${x0}" y="${y + 12}">${esc(c.name)}</text>` +
          `<rect class="bar" x="${x0 + 88}" y="${y + 3}" width="${w.toFixed(1)}" height="13" rx="4" fill="${color}"` +
          ` data-tip="${esc(c.name)}|${c.games} 把 · ${fmtPct(c.winRate, 1)}"/>` +
          `<text class="row-sub" x="${x0 + colW - 6}" y="${y + 12}" text-anchor="end">${c.games} 把 ${c.winRate.toFixed(0)}%</text>`
        );
      })
      .join("");
    return head + bars;
  };

  return `
<figure class="chart">
  <figcaption>英雄池并列（各自出场 ≥5 把里最多的 10 个；条形=出场数，颜色=胜率是否过半，蓝≥50% 红&lt;50%）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="英雄池并列">
    ${col(A, 0, a.name)}
    ${col(B, W / 2 + 12, b.name)}
  </svg>
</figure>`;
}

const fmtDay = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

// ---------------------------------------------------------------- 主流程

export interface CompareReportResult {
  path: string;
  a: string;
  b: string;
  aGames: number;
  bGames: number;
  preview: string;
}

export async function reportCompare(opts: { a?: string; b: string; out?: string }): Promise<CompareReportResult> {
  const resolveOne = async (who?: string): Promise<{ puuid: string; name: string }> => {
    if (!who || /^(me|我)$/i.test(who)) {
      const me = await resolveMe();
      if (!me) throw new Error("客户端没开且没有固定过账号：先在线跑一次 get_my_account_status。");
      return { puuid: me.puuid, name: me.name };
    }
    const r = await resolveAccountByName(who);
    if (!r.matches.length) throw new Error(`没找到「${who}」——${r.note}`);
    if (r.matches.length > 1) throw new Error(`「${who}」匹配到多个账号：${r.matches.map((m) => m.name).join("、")}`);
    return { puuid: r.matches[0].puuid, name: r.matches[0].name };
  };

  const [A, B] = await Promise.all([resolveOne(opts.a), resolveOne(opts.b)]);
  const [sa, sb] = await Promise.all([collectSide(A.puuid, A.name), collectSide(B.puuid, B.name)]);
  if (!sa.games || !sb.games) {
    throw new Error(`有一方没有可用的海斗对局（${sa.name} ${sa.games} 局 / ${sb.name} ${sb.games} 局）。`);
  }

  const fmtDate = (t: number | null) => (t ? new Date(t).toLocaleDateString("zh-CN") : "—");
  const rows: Array<[string, string, string, "a" | "b" | ""]> = [
    ["海斗局数", `${sa.games}`, `${sb.games}`, ""],
    ["胜率", fmtPct(sa.winRate), fmtPct(sb.winRate), sa.winRate >= sb.winRate ? "a" : "b"],
    ["KDA", sa.kda.toFixed(2), sb.kda.toFixed(2), sa.kda >= sb.kda ? "a" : "b"],
    ["场均伤害", `${Math.round(sa.damage / 1000)}k`, `${Math.round(sb.damage / 1000)}k`, sa.damage >= sb.damage ? "a" : "b"],
    ["场均时长", `${sa.minutes.toFixed(0)} 分`, `${sb.minutes.toFixed(0)} 分`, ""],
    ["数据跨度", `${fmtDate(sa.from)} ~ ${fmtDate(sa.to)}`, `${fmtDate(sb.from)} ~ ${fmtDate(sb.to)}`, ""],
    ["英雄池", `${sa.champions.length} 个（≥5 把）`, `${sb.champions.length} 个（≥5 把）`, ""],
  ];
  const table = rows
    .map(
      ([k, va, vb, win]) =>
        `<tr><td>${esc(k)}</td><td class="num"${win === "a" ? ' style="font-weight:650"' : ""}>${esc(va)}</td>` +
        `<td class="num"${win === "b" ? ' style="font-weight:650"' : ""}>${esc(vb)}</td></tr>`
    )
    .join("");

  const itemsTable = (() => {
    const setA = new Map(sa.items.map((x) => [x.name, x]));
    const setB = new Map(sb.items.map((x) => [x.name, x]));
    const names = [...new Set([...setA.keys(), ...setB.keys()])];
    const shared = names
      .filter((n) => setA.has(n) && setB.has(n))
      .sort((x, y) => (setB.get(y)?.games ?? 0) + (setA.get(y)?.games ?? 0) - ((setB.get(x)?.games ?? 0) + (setA.get(x)?.games ?? 0)))
      .slice(0, 10);
    if (!shared.length) return "";
    return (
      `<details><summary>两人都出过的装备（按合计场次，前 10）</summary><table>` +
      `<caption>出场局数与该装备下的胜率</caption>` +
      `<thead><tr><th>装备</th><th class="num">${esc(sa.name)}</th><th class="num">${esc(sb.name)}</th></tr></thead><tbody>` +
      shared
        .map((n) => {
          const x = setA.get(n)!;
          const y = setB.get(n)!;
          return `<tr><td>${esc(n)}</td><td class="num">${x.games} 把 ${x.winRate.toFixed(0)}%</td><td class="num">${y.games} 把 ${y.winRate.toFixed(0)}%</td></tr>`;
        })
        .join("") +
      `</tbody></table></details>`
    );
  })();

  const html = reflowFigures(`<!DOCTYPE html>
<html lang="zh-CN" data-theme="">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>海斗对比报告 · ${esc(sa.name)} vs ${esc(sb.name)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <div>
      <h1>海斗对比报告</h1>
      <div class="meta">${esc(sa.name)} vs ${esc(sb.name)} · 生成于 ${new Date().toLocaleString("zh-CN", { hour12: false })}</div>
    </div>
    <div style="text-align:right">
      <div class="hero-num">${(sa.winRate - sb.winRate >= 0 ? "+" : "")}${(sa.winRate - sb.winRate).toFixed(1)}<small>个百分点</small></div>
      <div class="meta">${esc(sa.name)} 相对 ${esc(sb.name)}</div>
    </div>
  </header>

  <div class="legend">
    <span><i class="swatch" style="background:var(--pos)"></i>${esc(sa.name)}</span>
    <span><i class="swatch" style="background:var(--accent)"></i>${esc(sb.name)}</span>
  </div>

  <section>
    <h2>核心指标对照</h2>
    <table>
      <caption>加粗的一侧在该项上更好。局数与时间跨度不同时，直接比总胜率不严谨 —— 见下方图注。</caption>
      <thead><tr><th>指标</th><th class="num">${esc(sa.name)}</th><th class="num">${esc(sb.name)}</th></tr></thead>
      <tbody>${table}</tbody>
    </table>
    ${itemsTable}
  </section>

  <section>
    <h2>逐周胜率对照</h2>
    ${weeklyDual(sa, sb)}
  </section>

  <section>
    <h2>英雄池</h2>
    ${championColumns(sa, sb)}
  </section>

  <section>
    <h2>符文偏好差异</h2>
    ${augmentDiff(sa, sb)}
  </section>

  <footer>
    <ul>
      <li>口径：只统计海斗（海克斯大乱斗及其同族队列），数据来自本地归档 ∪ 实时取数。</li>
      <li>⚠ 两人的样本量、时间跨度、队列构成可能不同（本次 ${esc(sa.name)} ${sa.games} 局 / ${esc(sb.name)} ${sb.games} 局），
          总胜率差在没有对齐样本时不构成「谁更强」的结论。</li>
      <li>符文与出装都是**观察数据**：由玩家自选，含选择偏差。</li>
      <li>「两人都出过的装备」里只算成装与二级鞋 —— 散件留在最终背包是「那局结束得早」的信号，不是出装选择。</li>
    </ul>
  </footer>
</div>
</body>
</html>`);

  const safe = `${sa.name}_vs_${sb.name}`.replace(/[\\/:*?"<>|]/g, "_");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const out = opts.out ?? path.join(REPORTS_DIR, `海斗对比-${safe}-${stamp}.html`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, html, "utf8");

  return {
    path: out,
    a: sa.name,
    b: sb.name,
    aGames: sa.games,
    bGames: sb.games,
    preview: `${sa.name} ${sa.games} 局 ${fmtPct(sa.winRate)} vs ${sb.name} ${sb.games} 局 ${fmtPct(sb.winRate)}`,
  };
}

/** 文本输出 */
export async function reportCompareText(opts: { a?: string; b: string; out?: string } = { b: "" }): Promise<string> {
  let r: CompareReportResult;
  try {
    r = await reportCompare(opts);
  } catch (e: any) {
    return `生成失败：${e?.message ?? e}`;
  }
  return [
    `已生成对比报告：${r.path}`,
    r.preview,
    "",
    "包含：核心指标对照表、逐周胜率双线图、英雄池并列、符文偏好差异（背离条形）、两人都出过的装备。",
    "说明：两人样本量/跨度不同时，总胜率差不能当「谁更强」的结论 —— 报告页脚里写明了。",
  ].join("\n");
}
