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

export interface Side {
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

/**
 * 取一侧的数据。
 *
 * `slice` 用来只取一部分局 —— 这是「跨时间对比」的实现方式：
 * 同一个账号按时间切成两段，就能复用整套双人对比的图（逐周双线、英雄池、符文差异）。
 * 否则「我 vs 过去的我」得再写一套一模一样的图，那是纯重复。
 */
export async function collectSide(
  puuid: string,
  name: string,
  slice?: { from?: number; to?: number; idxFrom?: number; idxTo?: number }
): Promise<Side> {
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

  // 两种切法：按时间（from/to）或按「第几把到第几把」（idxFrom/idxTo，左闭右开）。
  // 跨时间对比要用后者 —— 按时间切会把「之前的所有局」都算进前段，
  // 结果变成「最近 100 把 vs 之前 206 把」，两段样本量不对等，比出来的差没意义。
  const keep = (r: Row, i: number) => {
    if (slice?.idxFrom != null && i < slice.idxFrom) return false;
    if (slice?.idxTo != null && i >= slice.idxTo) return false;
    if (slice?.from != null && r.t < slice.from) return false;
    if (slice?.to != null && r.t >= slice.to) return false;
    return true;
  };
  const rowsAll = rows.filter(keep);
  rows.length = 0;
  rows.push(...rowsAll);

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
export function weeklyDual(a: Side, b: Side, noun = "两人"): string {
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
  <figcaption>逐周胜率对照（${noun}同一时间轴；虚线=50% 基准。⚠ ${noun}局数/跨度不同，线越密的周样本越厚）</figcaption>
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
export function augmentDiff(a: Side, b: Side, noun = "两人"): string {
  const m = new Map<string, { a: number; b: number }>();
  for (const x of a.augments) m.set(x.name, { a: x.share, b: m.get(x.name)?.b ?? 0 });
  for (const x of b.augments) {
    const cur = m.get(x.name) ?? { a: 0, b: 0 };
    cur.b = x.share;
    m.set(x.name, cur);
  }
  const rows = [...m.entries()]
    .map(([name, v]) => ({ name, gap: v.a - v.b }))
    // 2 个百分点 —— 与文字版（lib/compare.ts 的符文偏好差异）保持一致。
    // 原先这里是 0.015，两边**讲的是同一件事却用不同的门槛**，于是同一个双账号对比，
    // 看文字版和看 HTML 版会列出不同的符文。是「门槛登记表」的配对检查查出来的
    // （tools/audit-thresholds.mjs 的 sameAs 判据）。
    .filter((x) => Math.abs(x.gap) >= 0.02)
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
  <figcaption>符文偏好差异（中轴=${noun}出现比例相同；右蓝=${esc(a.name)}拿得多，左橙=${esc(b.name)}拿得多）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="符文偏好差异">
    <text class="axis-label" x="${labelW}" y="14">← ${esc(b.name)}</text>
    <text class="axis-label" x="${W - valueW}" y="14" text-anchor="end">${esc(a.name)} →</text>
    <line class="baseline" x1="${cx}" y1="20" x2="${cx}" y2="${H - 10}"/>
    ${bars}
  </svg>
</figure>`;
}

/** 英雄池并列：各自出场最多的英雄，左右两栏 */
export function championColumns(a: Side, b: Side): string {
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

/** 解析一个账号（不传或写「我」就是当前登录/固定账号） */
async function resolveOne(who?: string): Promise<{ puuid: string; name: string }> {
  if (!who || /^(me|我)$/i.test(who)) {
    const me = await resolveMe();
    if (!me) throw new Error("客户端没开且没固定过账号：先在线跑一次 get_my_account_status。");
    return { puuid: me.puuid, name: me.name };
  }
  const r = await resolveAccountByName(who);
  if (!r.matches.length) throw new Error(`没找到「${who}」——${r.note}`);
  if (r.matches.length > 1) throw new Error(`「${who}」匹配到多个账号：${r.matches.map((m) => m.name).join("、")}`);
  return { puuid: r.matches[0].puuid, name: r.matches[0].name };
}

export interface CompareOptions {
  a?: string;
  b: string;
  out?: string;
  /**
   * 内部用：直接给算好的两侧数据，跳过账号解析。
   * 「跨时间对比」（同一个人的两段时间）走这条 —— 图完全复用，只是数据来源不同。
   */
  sides?: { sa: Side; sb: Side };
  /** 内部用：覆盖标题与文案 */
  title?: string;
  legendB?: string;
  fileTag?: string;
  footerExtra?: string;
  /** 图注里的称呼：双人对比用「两人」，跨时间对比用「两段」 */
  captionNoun?: string;
}

export async function reportCompare(opts: CompareOptions): Promise<CompareReportResult> {
  let sa: Side;
  let sb: Side;
  if (opts.sides) {
    ({ sa, sb } = opts.sides);
  } else {
    const [A, B] = await Promise.all([resolveOne(opts.a), resolveOne(opts.b)]);
    [sa, sb] = await Promise.all([collectSide(A.puuid, A.name), collectSide(B.puuid, B.name)]);
  }
  if (!sa.games || !sb.games) {
    throw new Error(`有一方没有可用的海斗对局（${sa.name} ${sa.games} 局 / ${sb.name} ${sb.games} 局）。`);
  }

  const title = opts.title ?? "海斗对比报告";
  const legendB = opts.legendB ?? sb.name;
  const footerExtra =
    opts.footerExtra ?? "两人的样本量、时间跨度、队列构成可能不同，总胜率差在没有对齐样本时不构成「谁更强」的结论";
  const fileTag = opts.fileTag ?? `海斗对比-${sa.name}_vs_${sb.name}`;
  const noun = opts.captionNoun ?? "两人";

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
      `<details><summary>${noun}都出过的装备（按合计场次，前 10）</summary><table>` +
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
<title>${esc(title)} · ${esc(sa.name)} vs ${esc(sb.name)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <div>
      <h1>${esc(title)}</h1>
      <div class="meta">${esc(sa.name)} vs ${esc(sb.name)} · 生成于 ${new Date().toLocaleString("zh-CN", { hour12: false })}</div>
    </div>
    <div style="text-align:right">
      <div class="hero-num">${(sa.winRate - sb.winRate >= 0 ? "+" : "")}${(sa.winRate - sb.winRate).toFixed(1)}<small>个百分点</small></div>
      <div class="meta">${esc(sa.name)} 相对 ${esc(sb.name)}</div>
    </div>
  </header>

  <div class="legend">
    <span><i class="swatch" style="background:var(--pos)"></i>${esc(sa.name)}</span>
    <span><i class="swatch" style="background:var(--accent)"></i>${esc(legendB)}</span>
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
    ${weeklyDual(sa, sb, noun)}
  </section>

  <section>
    <h2>英雄池</h2>
    ${championColumns(sa, sb)}
  </section>

  <section>
    <h2>符文偏好差异</h2>
    ${augmentDiff(sa, sb, noun)}
  </section>

  <footer>
    <ul>
      <li>口径：只统计海斗（海克斯大乱斗及其同族队列），数据来自本地归档 ∪ 实时取数。</li>
      <li>⚠ ${esc(footerExtra)}（本次 ${esc(sa.name)} ${sa.games} 局 / ${esc(sb.name)} ${sb.games} 局）。</li>
      <li>符文与出装都是**观察数据**：由玩家自选，含选择偏差。</li>
      <li>「${noun}都出过的装备」里只算成装与二级鞋 —— 散件留在最终背包是「那局结束得早」的信号，不是出装选择。</li>
    </ul>
  </footer>
</div>
</body>
</html>`);

  const safe = fileTag.replace(/[\\/:*?"<>|]/g, "_");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const out = opts.out ?? path.join(REPORTS_DIR, `${safe}-${stamp}.html`);
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

// ---------------------------------------------------------------- 跨时间对比（我 vs 过去的我）

export interface SelfCompareOptions {
  /** 看谁；不传就是自己 */
  who?: string;
  /** 每段取多少把（默认各 100） */
  window?: number;
  out?: string;
}

/**
 * 同一个账号「最近 N 把 vs 之前 N 把」的对比报告。
 *
 * 复用双人对比的整套图 —— 差别只在两侧的数据来源（同一人的两个时间窗），
 * 所以标题、图例、页脚口径都换掉，图一个不改。
 *
 * 为什么值得单做：现有的对比只有「我和别人同期」，看的是相对位置；
 * 「我和我过去」看的是自己有没有变 —— 这两个问题不一样，后者还更能排除
 * 「对手/版本不同」这类外部因素（因为版本差异会直接体现在两段的时间跨度上，图注里点明）。
 */
export async function reportSelfCompare(opts: SelfCompareOptions = {}): Promise<CompareReportResult> {
  const me = opts.who ? await resolveOne(opts.who) : await resolveOne();
  const all = await loadLolGames(me.puuid, 2000, me.name);
  const games = all.games
    .filter(isMayhemGame)
    .slice()
    .sort((a: any, b: any) => (a.gameCreation ?? 0) - (b.gameCreation ?? 0));

  const total = games.length;
  if (total < 40) {
    throw new Error(`只有 ${total} 把海斗，切两段每段不足 20 把，比不出什么（至少需要 40 把）。`);
  }
  const half = Math.min(opts.window ?? 100, Math.floor(total / 2));
  const splitAt = total - half;

  // 按局数对称切：最近 half 把 vs 紧邻它之前的那 half 把。
  // 两边样本量相等，比出来的差才有可比性（按时间切会让前段多出一大截）。
  const [older, recent] = await Promise.all([
    collectSide(me.puuid, me.name, { idxFrom: splitAt - half, idxTo: splitAt }),
    collectSide(me.puuid, me.name, { idxFrom: splitAt, idxTo: total }),
  ]);
  const olderLabel = `之前 ${older.games} 把`;
  const recentLabel = `最近 ${recent.games} 把`;
  const fmtD = (t: number | null) => (t ? new Date(t).toLocaleDateString("zh-CN") : "—");

  return reportCompare({
    b: me.name,
    sides: {
      sa: { ...recent, name: recentLabel },
      sb: { ...older, name: olderLabel },
    },
    title: "海斗跨时间对比（我 vs 过去的我）",
    captionNoun: "两段",
    legendB: olderLabel,
    fileTag: `海斗跨时间-${me.name}`,
    footerExtra:
      "两段是同一个人的前后两段，口径一致（同一账号、同一模式）；但仍可能有版本差异与对手差异" +
      `（前段 ${fmtD(older.from)}~${fmtD(older.to)}，后段 ${fmtD(recent.from)}~${fmtD(recent.to)}），` +
      "所以「后段更好」只说明这一段的成绩更好，不等于能力变强",
    out: opts.out,
  });
}

/** 文本输出 */
export async function reportSelfCompareText(opts: SelfCompareOptions = {}): Promise<string> {
  let r: CompareReportResult;
  try {
    r = await reportSelfCompare(opts);
  } catch (e: any) {
    return `生成失败：${e?.message ?? e}`;
  }
  return [
    `已生成跨时间对比报告：${r.path}`,
    r.preview,
    "",
    "同一账号前后两段的并排：逐周双线、英雄池变化、符文偏好变化、出装变化。",
    "⚠ 「后段更好」不等于「变强了」—— 版本与对手也在变，报告页脚里写明了。",
  ].join("\n");
}
