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
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const fmtPct = (v: number, d = 0) => `${v.toFixed(d)}%`;

// ---------------------------------------------------------------- 取数

async function collect(demo: boolean, who?: { puuid: string; name: string }) {
  const d = loadData();
  const traitCn = (id: string) => tftName("traits", id) ?? id.replace(/^TFT\d+_/i, "");
  const champCn = (id?: string) => (id ? tftName("champions", id) ?? id.replace(/^TFT\d+_/i, "") : "?");

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
  let t = Date.UTC(2026, 8, 1);
  for (let i = 0; i < 60; i++) {
    t += (30 + (i % 7) * 10) * 60 * 1000;
    const placement = Math.max(1, Math.min(8, Math.round(4.5 + (Math.random() - 0.5) * 7)));
    rows.push({
      t,
      placement,
      level: 6 + Math.round(Math.random() * 4),
      gold: Math.round(Math.random() * 60),
      minutes: 25 + Math.round(Math.random() * 15),
      queue: i % 3 === 0 ? "云顶之弈（排位）" : "云顶之弈（匹配）",
      traits: [traitPool[i % traitPool.length], traitPool[(i * 3) % traitPool.length]].filter(Boolean),
      units: [champPool[i % champPool.length], champPool[(i * 5) % champPool.length]].filter(Boolean),
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

  const pref = (key: "traits" | "units") => {
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
    ${levelPlacementScatter(rows)}
  </section>

  <section>
    <h2>阵容与棋子偏好</h2>
    ${preferenceBars("羁绊偏好", "常见羁绊（按平均名次排序；蓝色=平均名次好于 4.5，红色=更差）", pref("traits"))}
    ${preferenceBars("棋子偏好", "常见棋子（同样按平均名次排序，蓝=好于 4.5）", pref("units"))}
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
