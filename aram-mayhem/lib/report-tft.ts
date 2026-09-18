/**
 * 云顶之弈（TFT）战绩报告（单文件 HTML，离线，内联 SVG 图表）。
 *
 * 用法：
 *   npx tsx lib/report-tft.ts                    # → reports/云顶战绩报告-<账号>-<日期>.html
 *   npx tsx lib/report-tft.ts --out x.html
 *   npx tsx lib/report-tft.ts --demo             # 合成数据，用于离线检查排版
 *
 * 数据边界（会写进页脚）：云顶对局接口最多只给**最近 20 局**，没有可用的翻页参数；
 * 本地归档会随每次查询累积，所以攒久了能超过 20 局。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTftGames } from "./games.js";
import { resolveMe } from "./identity.js";
import { REPORT_CSS, reflowFigures } from "./report-style.js";
import { loadData, tftName } from "./store.js";
import { parsePatch } from "./sgp.js";
import { clientQueueNames } from "./queues.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const W = 900;

interface TftRow {
  t: number;
  placement: number;
  level: number;
  gold: number;
  minutes: number;
  queue: string;
  traits: string[];
  units: string[];
  /** 最终阵容里的成装名（占位条目已在取数时过滤） */
  items: string[];
  /** 对局版本（只有 SGP 会给；本地客户端的历史摘要没有这个字段） */
  patch: string | null;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const fmtPct = (v: number, d = 0) => `${v.toFixed(d)}%`;

// ---------------------------------------------------------------- 取数

async function collect(demo: boolean, who?: { puuid: string; name: string }) {
  const d = loadData();
  const traitCn = (id: string) => tftName("traits", id) ?? id.replace(/^TFT\d+_/i, "");
  const champCn = (id?: string) => (id ? tftName("champions", id) ?? id.replace(/^TFT\d+_/i, "") : "?");
  const itemCn = (id?: string) => (id ? tftName("items", id) ?? id.replace(/^TFT_Item_/i, "").replace(/^TFT\d+_/i, "") : "?");

  if (demo) return demoData(traitCn, champCn);

  const me = who ?? (await resolveMe());
  if (!me) throw new Error("客户端没开且没有固定过账号：先在线跑一次 get_my_account_status，或打开客户端。");
  const res = await loadTftGames(me.puuid, me.name);
  const qnames = await clientQueueNames();
  const rows: TftRow[] = res.games
    .map((g: any) => {
      const p = (g.participants ?? []).find((x: any) => x.puuid === me.puuid) ?? (g.participants ?? [])[0];
      if (!p) return null;
      return {
        t: g.gameCreation,
        placement: p.placement ?? 0,
        level: p.level ?? 0,
        gold: p.gold_left ?? 0,
        minutes: Math.round((g.gameDuration ?? 0) / 60),
        queue: qnames.get(g.queueId ?? 0) ?? `队列 ${g.queueId}`,
        patch: parsePatch(g.gameVersion),
        traits: (p.traits ?? [])
          .slice()
          .sort((a: any, b: any) => (b.style ?? 0) - (a.style ?? 0) || (b.num_units ?? 0) - (a.num_units ?? 0))
          .slice(0, 6)
          .map((x: any) => traitCn(x.name)),
        units: (p.units ?? [])
          .slice()
          .sort((a: any, b: any) => (b.tier ?? 0) - (a.tier ?? 0) || (b.rarity ?? 0) - (a.rarity ?? 0))
          .slice(0, 8)
          .map((u: any) => champCn(u.character_id)),
        // 只收成装；EmptyBag 这类占位不是玩家出的装备，收了会让「平均名次 1.20」霸榜
        items: [
          ...new Set<string>(
            (p.units ?? [])
              .flatMap((u: any) => u.itemNames ?? [])
              .filter((it: any) => it && !/^(emptybag|empty|placeholder)$/i.test(String(it)))
              .map((it: any) => itemCn(it))
          ),
        ],
      } as TftRow;
    })
    .filter((x: TftRow | null): x is TftRow => !!x && x.placement > 0)
    .sort((a: TftRow, b: TftRow) => a.t - b.t);
  return { name: me.name, rows, note: res.note, demo: false };
}

/** 合成数据：客户端离线 + 归档为空时，用来自查图表排版 */
function demoData(traitCn: (s: string) => string, champCn: (s: string) => string) {
  const d = loadData();
  const traitPool = Object.values(d.tftNames.traits).slice(0, 12);
  const champPool = Object.values(d.tftNames.champions).slice(0, 24);
  const rows: TftRow[] = [];
  // 铺开到 ~10 周（否则周趋势/补丁两张图会因为没有跨周而整张不出现，demo 就查不出排版问题）
  let t = Date.UTC(2026, 6, 1);
  for (let i = 0; i < 60; i++) {
    t += (2 + (i % 3)) * 86400 * 1000 + (30 + (i % 7) * 10) * 60 * 1000;
    const placement = Math.max(1, Math.min(8, Math.round(4.5 + (Math.random() - 0.5) * 7)));
    rows.push({
      t,
      placement,
      level: 6 + Math.round(Math.random() * 4),
      gold: Math.round(Math.random() * 60),
      minutes: 25 + Math.round(Math.random() * 15),
      queue: i % 3 === 0 ? "云顶之弈（排位）" : "云顶之弈（匹配）",
      patch: `16.${10 + Math.floor(i / 6)}`,
      traits: [traitPool[i % traitPool.length], traitPool[(i * 3) % traitPool.length]].filter(Boolean),
      units: [champPool[i % champPool.length], champPool[(i * 5) % champPool.length]].filter(Boolean),
      items: [`示例装备${i % 5}`, `示例装备${(i * 2) % 5}`],
    } as TftRow);
  }
  return { name: "（演示数据）", rows, note: "⚠ 这是 --demo 生成的演示数据，不是真实战绩", demo: true };
}

// ---------------------------------------------------------------- 图表

/** 名次分布：横向条形，前四蓝 / 后四红，带基准说明 */
function placementBars(dist: Array<{ place: number; count: number; share: number }>): string {
  const rowH = 28,
    labelW = 64,
    valueW = 76;
  const barW = W - labelW - valueW;
  const H = dist.length * rowH + 24;
  const body = dist
    .map((d, i) => {
      const y = 16 + i * rowH;
      const w = Math.max(2, barW * d.share);
      const color = d.place <= 4 ? "var(--pos)" : "var(--neg)";
      return (
        `<text class="row-label" x="0" y="${y + 13}">第 ${d.place} 名</text>` +
        `<rect class="bar" x="${labelW}" y="${y + 4}" width="${w.toFixed(1)}" height="14" rx="4" fill="${color}"` +
        ` data-tip="第 ${d.place} 名|${d.count} 局 · 占 ${fmtPct(d.share * 100, 1)}"/>` +
        `<text class="row-value" x="${W - 4}" y="${y + 15}" text-anchor="end">${d.count} 局 · ${fmtPct(d.share * 100)}</text>`
      );
    })
    .join("");
  return `
<figure class="chart">
  <figcaption>名次分布（前四=蓝，后四=红；8 人局理论平均名次 4.5）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="云顶名次分布图">
    <line class="baseline" x1="${labelW + barW / 2}" x2="${labelW + barW / 2}" y1="10" y2="${H - 6}"/>
    ${body}
  </svg>
</figure>`;
}

/** 逐局名次折线（y 轴反转：1 名在上；4.5 为基准线） */
/**
 * 逐周平均名次与场次：上块柱=该周局数，下块折线=该周平均名次（越小越好）。
 * 云顶一局 30 多分钟，一周通常没几局，所以样本少的点画空心、不连线判断趋势。
 */
function weeklyPlacement(rows: TftRow[]): string {
  const map = new Map<number, { g: number; sum: number }>();
  for (const r of rows) {
    const d = new Date(r.t);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 周一
    const k = d.getTime();
    const c = map.get(k) ?? { g: 0, sum: 0 };
    c.g++;
    c.sum += r.placement;
    map.set(k, c);
  }
  const weeks = [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, c]) => ({ t, games: c.g, avg: c.sum / c.g }));
  if (weeks.length < 2) return "";

  const H = 280,
    padL = 46,
    padR = 18,
    padT = 16,
    padB = 30,
    gap = 24;
  const volH = 62;
  const rateT = padT + volH + gap;
  const rateH = H - rateT - padB;
  const plotW = W - padL - padR;
  const slot = plotW / weeks.length;
  const barW = Math.max(3, Math.min(28, slot * 0.6));
  const maxGames = Math.max(1, ...weeks.map((k) => k.games));
  // 名次轴固定 1~8，便于跨图比较
  const yP = (p: number) => rateT + rateH * ((p - 1) / 7);
  const cxOf = (i: number) => padL + slot * i + slot / 2;

  const fmtW = (t: number) => {
    const d = new Date(t);
    const q = (n: number) => String(n).padStart(2, "0");
    return `${q(d.getMonth() + 1)}/${q(d.getDate())}`;
  };

  const bars = weeks
    .map((k, i) => {
      const h = Math.max(2, (volH * k.games) / maxGames);
      return (
        `<rect class="bar" x="${(cxOf(i) - barW / 2).toFixed(1)}" y="${(padT + volH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3"` +
        ` fill="var(--baseline)" data-tip="${fmtW(k.t)}|${k.games} 局 · 平均名次 ${k.avg.toFixed(2)}"/>`
      );
    })
    .join("");
  const grid = [1, 2, 3, 4, 5, 6, 7, 8]
    .map(
      (p) =>
        `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${yP(p)}" y2="${yP(p)}"/>` +
        `<text class="axis-label" x="${padL - 8}" y="${yP(p) + 4}" text-anchor="end">${p}</text>`
    )
    .join("");
  const pts = weeks.map((k, i) => ({ x: cxOf(i), y: yP(k.avg), k }));
  const dots = pts
    .map((p) => {
      const thin = p.k.games < 5;
      return (
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.2"` +
        (thin ? ` fill="var(--surface-1)" stroke="var(--accent)" stroke-width="1.6"` : ` fill="var(--accent)"`) +
        ` data-tip="${fmtW(p.k.t)}|${p.k.games} 局 · 平均名次 ${p.k.avg.toFixed(2)}${thin ? "（样本少）" : ""}"/>`
      );
    })
    .join("");
  const every = Math.ceil(weeks.length / 12);
  const xLabels = weeks
    .map((k, i) =>
      i % every === 0
        ? `<text class="axis-label" x="${cxOf(i).toFixed(1)}" y="${H - 10}" text-anchor="middle">${fmtW(k.t)}</text>`
        : ""
    )
    .join("");

  return `
<figure class="chart">
  <figcaption>逐周场次（上，柱=该周局数）与周平均名次（下，折线；轴反向，越靠下名次越差；空心点=该周不足 5 局）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="云顶周场次与周平均名次">
    <text class="axis-label" x="${padL}" y="${padT - 4}">场次（最高 ${maxGames} 局）</text>
    ${bars}
    ${grid}
    <line class="baseline" x1="${padL}" x2="${W - padR}" y1="${yP(4.5)}" y2="${yP(4.5)}"/>
    ${pts.length > 1 ? `<polyline class="series-line" points="${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}"/>` : ""}
    ${dots}
    ${xLabels}
  </svg>
</figure>`;
}

/** 按补丁的平均名次（客户端版本 / 赛季号两行标签，与海斗报告同一口径） */
function patchPlacement(rows: TftRow[]): string {
  const map = new Map<string, { g: number; sum: number }>();
  let noPatch = 0;
  for (const r of rows) {
    if (!r.patch) {
      noPatch++;
      continue;
    }
    const c = map.get(r.patch) ?? { g: 0, sum: 0 };
    c.g++;
    c.sum += r.placement;
    map.set(r.patch, c);
  }
  const verKey = (v: string) => {
    const [a, b] = v.split(".").map(Number);
    return a * 1000 + b;
  };
  const patches = [...map.entries()]
    .sort((a, b) => verKey(a[0]) - verKey(b[0]))
    .map(([v, c]) => {
      const [a, b] = v.split(".");
      return { patch: v, playerPatch: `${Number(a) + 10}.${b}`, games: c.g, avg: c.sum / c.g };
    });
  if (patches.length < 2) return "";

  const H = 210,
    padL = 44,
    padR = 16,
    padT = 26,
    padB = 46;
  const plotW = W - padL - padR,
    plotH = H - padT - padB;
  const slot = plotW / patches.length;
  const barW = Math.min(48, slot * 0.6);
  const y = (p: number) => padT + plotH * ((p - 1) / 7);
  const grid = [1, 2, 3, 4, 5, 6, 7, 8]
    .map(
      (p) =>
        `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(p)}" y2="${y(p)}"/>` +
        `<text class="axis-label" x="${padL - 8}" y="${y(p) + 4}" text-anchor="end">${p}</text>`
    )
    .join("");
  const bars = patches
    .map((p, i) => {
      const cx = padL + slot * i + slot / 2;
      // 柱子从底部往上长到「名次」的位置，颜色按好于/差于 4.5 分
      const top = y(p.avg);
      const h = Math.max(2, padT + plotH - top);
      const color = p.avg <= 4.5 ? "var(--pos)" : "var(--neg)";
      const thin = p.games < 15;
      return (
        `<rect class="bar" x="${(cx - barW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4"` +
        ` fill="${color}"${thin ? ' fill-opacity="0.45"' : ""}` +
        ` data-tip="${p.patch}（${p.playerPatch}）|${p.games} 局 · 平均名次 ${p.avg.toFixed(2)}${thin ? "（样本少）" : ""}"/>` +
        `<text class="row-value" x="${cx.toFixed(1)}" y="${(top - 5).toFixed(1)}" text-anchor="middle">${p.avg.toFixed(2)}</text>` +
        `<text class="axis-label" x="${cx.toFixed(1)}" y="${H - 30}" text-anchor="middle">${p.patch}</text>` +
        `<text class="axis-label" x="${cx.toFixed(1)}" y="${H - 18}" text-anchor="middle">${p.playerPatch}</text>` +
        `<text class="axis-label" x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${p.games} 局</text>`
      );
    })
    .join("");
  const note =
    noPatch > 0
      ? `<p style="font-size:12px;color:var(--muted);margin:8px 0 0">另有 ${noPatch} 局没有版本号（本地客户端的历史摘要不带 gameVersion），未计入本图。</p>`
      : "";
  return `
<figure class="chart">
  <figcaption>按补丁的平均名次（柱=名次，越短越好；上行=客户端版本、下行=赛季号，差 10；半透明=该补丁不足 15 局）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="云顶按补丁平均名次">
    ${grid}
    <line class="baseline" x1="${padL}" x2="${W - padR}" y1="${y(4.5)}" y2="${y(4.5)}"/>
    ${bars}
  </svg>
  ${note}
</figure>`;
}

function placementTrend(rows: TftRow[]): string {
  const H = 220,
    padL = 34,
    padR = 16,
    padT = 16,
    padB = 26;
  const plotW = W - padL - padR,
    plotH = H - padT - padB;
  const x = (i: number) => padL + (plotW * i) / Math.max(1, rows.length - 1);
  const y = (p: number) => padT + plotH * ((p - 1) / 7); // 1 名在顶部
  const pts = rows.map((r, i) => `${x(i).toFixed(1)},${y(r.placement).toFixed(1)}`).join(" ");
  const grid = [1, 2, 3, 4, 5, 6, 7, 8]
    .map(
      (p) =>
        `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(p)}" y2="${y(p)}"/>` +
        (p % 2 === 1 ? `<text class="axis-label" x="${padL - 6}" y="${y(p) + 4}" text-anchor="end">${p}</text>` : "")
    )
    .join("");
  const dots = rows
    .map(
      (r, i) =>
        `<circle class="hoverdot" cx="${x(i).toFixed(1)}" cy="${y(r.placement).toFixed(1)}" r="9" fill="transparent"` +
        ` data-tip="${new Date(r.t).toLocaleString("zh-CN", { hour12: false, dateStyle: "short" })}|第 ${r.placement} 名 · Lv${r.level} · ${r.minutes} 分 · ${esc(r.queue)}"/>`
    )
    .join("");
  return `
<figure class="chart">
  <figcaption>逐局名次（越靠上越好；虚线为 4.5 名的理论平均）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="逐局名次折线图" data-plot="line" data-w="${W}" data-h="${H}" data-padl="${padL}" data-padr="${padR}" data-padt="${padT}" data-padb="${padB}">
    ${grid}
    <line class="baseline" x1="${padL}" x2="${W - padR}" y1="${y(4.5)}" y2="${y(4.5)}"/>
    <polyline class="series-line" points="${pts}"/>
    <line class="crosshair" x1="0" x2="0" y1="${padT}" y2="${padT + plotH}" style="display:none"/>
    ${dots}
  </svg>
</figure>`;
}

/** 羁绊 / 棋子偏好：出现次数 + 平均名次 */
function preferenceBars(
  title: string,
  caption: string,
  items: Array<{ name: string; games: number; share: number; avgPlace: number }>
): string {
  const rowH = 26,
    labelW = 150,
    valueW = 150;
  const barW = W - labelW - valueW;
  const H = items.length * rowH + 22;
  const maxShare = Math.max(0.01, ...items.map((i) => i.share));
  const body = items
    .map((it, i) => {
      const y = 16 + i * rowH;
      const w = Math.max(2, (barW * it.share) / maxShare);
      const color = it.avgPlace <= 4.5 ? "var(--pos)" : "var(--neg)";
      return (
        `<text class="row-label" x="0" y="${y + 12}">${esc(it.name)}</text>` +
        `<rect class="bar" x="${labelW}" y="${y + 3}" width="${w.toFixed(1)}" height="13" rx="4" fill="${color}"` +
        ` data-tip="${esc(it.name)}|出现 ${it.games} 局（${fmtPct(it.share * 100)}）· 平均名次 ${it.avgPlace.toFixed(2)}"/>` +
        `<text class="row-value" x="${W - 4}" y="${y + 13}" text-anchor="end">${it.games} 局 · 均 ${it.avgPlace.toFixed(2)}</text>`
      );
    })
    .join("");
  return `
<figure class="chart">
  <figcaption>${caption}</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">
    ${body}
  </svg>
</figure>`;
}

/**
 * 等级 × 名次 散点：横轴=收尾等级，纵轴=名次（1 在上）。
 * 高等级+差名次 = 运营/阵容问题；低等级+好名次 = 速通或天胡。
 */
function levelPlacementScatter(rows: TftRow[]): string {
  const H = 320,
    padL = 44,
    padR = 20,
    padT = 22,
    padB = 42;
  const plotW = W - padL - padR,
    plotH = H - padT - padB;
  const levels = rows.map((r) => r.level).filter((v) => v > 0);
  const minL = Math.max(3, Math.min(...levels) - 1);
  const maxL = Math.max(...levels) + 1;
  const X = (lv: number) => padL + (plotW * (lv - minL)) / Math.max(1, maxL - minL);
  const Y = (p: number) => padT + plotH * ((p - 1) / 7);
  const grid: string[] = [];
  for (let lv = minL; lv <= maxL; lv++) {
    grid.push(
      `<line class="grid" x1="${X(lv)}" x2="${X(lv)}" y1="${padT}" y2="${padT + plotH}"/>` +
        `<text class="axis-label" x="${X(lv)}" y="${H - 24}" text-anchor="middle">${lv}</text>`
    );
  }
  for (let p = 1; p <= 8; p++) {
    grid.push(
      `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${Y(p)}" y2="${Y(p)}"/>` +
        `<text class="axis-label" x="${padL - 6}" y="${Y(p) + 4}" text-anchor="end">${p}</text>`
    );
  }
  const dots = rows
    .map((r) => {
      const good = r.placement <= 4;
      return (
        `<circle class="bar" cx="${X(r.level).toFixed(1)}" cy="${Y(r.placement).toFixed(1)}" r="6"` +
        ` fill="${good ? "var(--pos)" : "var(--neg)"}" fill-opacity="0.7" stroke="var(--surface-1)" stroke-width="2"` +
        ` data-tip="Lv${r.level} · 第 ${r.placement} 名|${new Date(r.t).toLocaleString("zh-CN", { hour12: false, dateStyle: "short" })} · ${r.minutes} 分 · ${esc(r.queue)}"/>`
      );
    })
    .join("");
  return `
<figure class="chart">
  <figcaption>等级 × 名次（横轴=收尾等级，纵轴=名次，越靠上越好；蓝=前四，红=后四）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="等级与名次散点图">
    ${grid.join("")}
    <text class="axis-label" x="${padL + plotW / 2}" y="${H - 6}" text-anchor="middle">收尾等级 →</text>
    ${dots}
  </svg>
</figure>`;
}


/**
 * 羁绊组合（两两）与平均名次：看「哪两个羁绊一起成型时成绩最好」。
 * 只统计成型羁绊（num_units ≥ 2），且组合出现 ≥ minGames 次才展示。
 */
function traitPairs(rows: TftRow[], minGames = 5): string {
  const pairStat = new Map<string, { g: number; sum: number }>();
  for (const r of rows) {
    const traits = r.traits.filter((t) => t.includes("(") ? false : true).slice(0, 6);
    for (let i = 0; i < traits.length; i++) {
      for (let j = i + 1; j < traits.length; j++) {
        const key = [traits[i], traits[j]].sort().join(" + ");
        const c = pairStat.get(key) ?? { g: 0, sum: 0 };
        c.g++;
        c.sum += r.placement;
        pairStat.set(key, c);
      }
    }
  }
  const items = [...pairStat.entries()]
    .filter(([, v]) => v.g >= minGames)
    .map(([name, v]) => ({ name, games: v.g, avgPlace: v.sum / v.g }))
    .sort((a, b) => a.avgPlace - b.avgPlace)
    .slice(0, 12);
  if (!items.length) return "";
  const rowH = 26,
    labelW = 250,
    valueW = 150;
  const barW = W - labelW - valueW;
  const H = items.length * rowH + 22;
  const maxGames = Math.max(1, ...items.map((i) => i.games));
  const body = items
    .map((it, i) => {
      const y = 16 + i * rowH;
      const w = Math.max(2, (barW * it.games) / maxGames);
      const color = it.avgPlace <= 4.5 ? "var(--pos)" : "var(--neg)";
      return (
        `<text class="row-label" x="0" y="${y + 12}" style="font-size:12px">${esc(it.name)}</text>` +
        `<rect class="bar" x="${labelW}" y="${y + 3}" width="${w.toFixed(1)}" height="13" rx="4" fill="${color}"` +
        ` data-tip="${esc(it.name)}|${it.games} 局 · 平均名次 ${it.avgPlace.toFixed(2)}"/>` +
        `<text class="row-value" x="${W - 4}" y="${y + 13}" text-anchor="end">${it.games} 局 · 均 ${it.avgPlace.toFixed(2)}</text>`
      );
    })
    .join("");
  return `
<figure class="chart">
  <figcaption>羁绊组合与成绩（条形=该组合出现局数；颜色=平均名次是否好于 4.5，蓝=更好）</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="羁绊组合平均名次图">
    ${body}
  </svg>
</figure>`;
}

// ---------------------------------------------------------------- 渲染

function render(data: Awaited<ReturnType<typeof collect>>): string {
  const { rows, name, note, demo } = data;
  const n = rows.length;
  const placements = rows.map((r) => r.placement);
  const avg = placements.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const first = placements.filter((p) => p === 1).length;
  const top4 = placements.filter((p) => p <= 4).length;
  const dist = [1, 2, 3, 4, 5, 6, 7, 8].map((place) => {
    const count = placements.filter((p) => p === place).length;
    return { place, count, share: n ? count / n : 0 };
  });
  const fmtTime = (t: number) => new Date(t).toLocaleString("zh-CN", { hour12: false, dateStyle: "short", timeStyle: "short" });

  const pref = (key: "traits" | "units" | "items") => {
    const m = new Map<string, { g: number; sum: number }>();
    for (const r of rows) {
      for (const item of r[key]) {
        const c = m.get(item) ?? { g: 0, sum: 0 };
        c.g++;
        c.sum += r.placement;
        m.set(item, c);
      }
    }
    return [...m.entries()]
      .filter(([, v]) => v.g >= Math.max(2, Math.ceil(n * 0.15)))
      .map(([k, v]) => ({ name: k, games: v.g, share: v.g / Math.max(1, n), avgPlace: v.sum / v.g }))
      .sort((a, b) => a.avgPlace - b.avgPlace || b.games - a.games)
      .slice(0, 10);
  };

  const tiles = [
    ["平均名次", avg.toFixed(2), "8 人局理论平均 4.50"],
    ["前四率", fmtPct((top4 / Math.max(1, n)) * 100), `${top4} 局拿到分`],
    ["吃鸡率", fmtPct((first / Math.max(1, n)) * 100), `${first} 次第一（理论 12.5%）`],
    ["场次", String(n), "本地可查范围"],
    ["平均等级", (rows.reduce((a, r) => a + r.level, 0) / Math.max(1, n)).toFixed(1), "收尾等级"],
    ["平均时长", `${(rows.reduce((a, r) => a + r.minutes, 0) / Math.max(1, n)).toFixed(0)} 分`, "每局耗时"],
  ]
    .map(
      ([label, value, sub]) =>
        `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-sub">${sub}</div></div>`
    )
    .join("");

  const detail = [...rows]
    .sort((a, b) => b.t - a.t)
    .slice(0, 20)
    .map(
      (r) =>
        `<tr><td>${fmtTime(r.t)}</td><td>${esc(r.queue)}</td><td class="${r.placement <= 4 ? "win" : "lose"}">第 ${r.placement} 名</td>` +
        `<td class="num">Lv${r.level}</td><td class="num">${r.minutes} 分</td><td>${esc(r.traits.slice(0, 3).join(" / ")) || "—"}</td></tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>云顶战绩报告 · ${esc(name)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <div>
      <h1>云顶之弈 · 战绩报告</h1>
      <div class="meta">${esc(name)} · ${rows.length ? fmtTime(rows[0].t) + " ~ " + fmtTime(rows[rows.length - 1].t) : "—"} · ${n} 局 · 生成于 ${new Date().toLocaleString("zh-CN", { hour12: false })}</div>
    </div>
    <div style="text-align:right">
      <div class="hero-num">${avg.toFixed(2)}<small>平均名次</small></div>
      <div class="meta">前四 ${fmtPct((top4 / Math.max(1, n)) * 100)} · 吃鸡 ${fmtPct((first / Math.max(1, n)) * 100)}</div>
    </div>
  </header>

  <div class="tiles">${tiles}</div>

  <section>
    <h2>名次与走势</h2>
    ${placementBars(dist)}
    ${placementTrend(rows)}
    ${weeklyPlacement(rows)}
    ${patchPlacement(rows)}
    ${levelPlacementScatter(rows)}
  </section>

  <section>
    <h2>阵容、棋子与装备偏好</h2>
    ${preferenceBars("羁绊偏好", "常见羁绊（按平均名次排序；蓝色=平均名次好于 4.5，红色=更差）", pref("traits"))}
    ${preferenceBars("棋子偏好", "常见棋子（同样按平均名次排序，蓝=好于 4.5）", pref("units"))}
    ${preferenceBars("装备偏好", "常见成装（你最终阵容里带过它的局，平均名次如何；占位条目已过滤）", pref("items"))}
    ${traitPairs(rows)}
  </section>

  <section>
    <h2>最近 20 局</h2>
    <table>
      <thead><tr><th>时间</th><th>队列</th><th>名次</th><th class="num">等级</th><th class="num">时长</th><th>成型羁绊</th></tr></thead>
      <tbody>${detail}</tbody>
    </table>
  </section>

  <footer>
    <div style="margin-bottom:6px"><button class="toggle" id="themeBtn">切换深色 / 浅色</button></div>
    <strong>数据来源与边界</strong>
    <ul>
      <li>${esc(note)}</li>
      <li>云顶对局接口最多只给<strong>最近 20 局</strong>（count 参数给多大都一样，也没有可用翻页参数）；本地归档随每次查询累积，攒久了能超过 20 局 —— 但仍然<strong>不是生涯总场次</strong>。</li>
      <li>队列中文名取自客户端自带的 queues.json；羁绊/棋子中文名取自官方云顶数据（CloudDragon）。</li>
      <li>读取方式为本地只读（127.0.0.1 客户端接口）${demo ? "；<strong>本页为演示数据</strong>" : ""}。</li>
    </ul>
  </footer>
</div>
<div id="tip"><div class="t1"></div><div class="t2"></div></div>
<script>
(function () {
  var tip = document.getElementById('tip');
  function show(a, b, x, y) {
    tip.querySelector('.t1').innerHTML = a; tip.querySelector('.t2').innerHTML = b || '';
    tip.style.display = 'block';
    var w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(Math.max(8, x + 14), window.innerWidth - w - 8) + 'px';
    tip.style.top = Math.max(8, y - h - 14) + 'px';
  }
  function hide() { tip.style.display = 'none'; }
  document.addEventListener('mousemove', function (ev) {
    var el = ev.target.closest ? ev.target.closest('[data-tip]') : null;
    if (el) {
      var parts = (el.getAttribute('data-tip') || '').split('|');
      show(parts[0] || '', parts[1] || '', ev.clientX, ev.clientY);
      return;
    }
    var svg = ev.target.closest ? ev.target.closest('svg[data-plot="line"]') : null;
    if (!svg) { hide(); return; }
    var r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, padL = +svg.dataset.padl, padR = +svg.dataset.padr;
    var vx = ((ev.clientX - r.left) / r.width) * vb.width;
    var pts = svg.querySelectorAll('.hoverdot');
    if (!pts.length) return;
    var best = null, bestD = Infinity;
    for (var i = 0; i < pts.length; i++) {
      var d = Math.abs(+pts[i].getAttribute('cx') - vx);
      if (d < bestD) { bestD = d; best = pts[i]; }
    }
    if (!best) return;
    var line = svg.querySelector('.crosshair');
    if (line) { line.setAttribute('x1', best.getAttribute('cx')); line.setAttribute('x2', best.getAttribute('cx')); line.style.display = ''; }
    var parts = (best.getAttribute('data-tip') || '').split('|');
    show(parts[0] || '', parts[1] || '', ev.clientX, ev.clientY);
  });
  document.addEventListener('mouseleave', hide);
  document.getElementById('themeBtn').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme');
    var isDark = cur === 'dark' || (!cur && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  });
})();
</script>
</body>
</html>`;
  return reflowFigures(html);
}

async function main() {
  const argv = process.argv.slice(2);
  const argOf = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const demo = argv.includes("--demo");
  let who: { puuid: string; name: string } | undefined;
  const friendArg = argOf("--friend");
  if (friendArg) {
    const { resolveAccountByName } = await import("./identity.js");
    const r = await resolveAccountByName(friendArg);
    if (!r.matches.length) {
      console.log(`没找到「${friendArg}」——${r.note}`);
      return;
    }
    if (r.matches.length > 1) {
      console.log(`「${friendArg}」匹配到多个账号：${r.matches.map((m) => m.name).join("、")}`);
      return;
    }
    who = { puuid: r.matches[0].puuid, name: r.matches[0].name };
    console.log(`生成对象：${who.name}`);
  }
  const data = await collect(demo, who);
  if (!data.rows.length) {
    console.log("没有云顶对局数据（" + data.note + "），可用 --demo 先看排版。");
    return;
  }
  const html = render(data);
  const safe = data.name.replace(/[\\/:*?"<>|]/g, "_");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const out = argOf("--out") ?? path.join(ROOT, "reports", `云顶战绩报告-${safe}-${stamp}.html`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, html, "utf8");
  console.log(`已生成报告：${out}`);
  console.log(`账号 ${data.name} · 云顶 ${data.rows.length} 局 · 平均名次 ${(data.rows.reduce((a, r) => a + r.placement, 0) / data.rows.length).toFixed(2)}`);
}

main().catch((e) => {
  console.error("生成失败:", e?.message ?? e);
  process.exit(1);
});
