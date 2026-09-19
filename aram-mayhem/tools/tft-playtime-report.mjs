// 云顶排位「每天打了多久」的单文件 HTML 报告。
//
// 数据来源：本地归档 data/archive/tft-matches.json，只取 queueId 1100（自然之力 排位 BETA测试）
// 里属于**本人 puuid** 的对局。时长只算 gameDuration（对局内），不含排队 / 选秀 / 加载。
//
// 跑：node tools/tft-playtime-report.mjs
// 产物：reports/云顶排位时长-<账号>-<日期>.html
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const RANKED_QUEUE = 1100;

const prof = JSON.parse(readFileSync(path.join(ROOT, "data/profile.json"), "utf8"));
const myPuuid = prof.puuid ?? prof.puuidEncrypted;
const arch = JSON.parse(readFileSync(path.join(ROOT, "data/archive/tft-matches.json"), "utf8"));

const mine = Object.values(arch.games).filter(
  (g) => g.queueId === RANKED_QUEUE && (g.participants ?? []).some((p) => p.puuid === myPuuid)
);

const dayOf = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// 按天聚合
const byDay = new Map();
for (const g of mine) {
  const k = dayOf(g.gameCreation);
  const c = byDay.get(k) ?? { n: 0, sec: 0, wins: 0 };
  c.n++;
  c.sec += Number(g.gameDuration ?? 0);
  const me = (g.participants ?? []).find((p) => p.puuid === myPuuid);
  if (Number(me?.placement) === 1) c.wins++;
  byDay.set(k, c);
}

// 完整日期轴（含没打的日子，缺口要看见）
const first = [...byDay.keys()].sort()[0];
const last = [...byDay.keys()].sort().pop();
const axis = [];
for (let t = new Date(first); dayOf(t.getTime()) <= last; t.setDate(t.getDate() + 1)) {
  const k = dayOf(t.getTime());
  axis.push({ key: k, ...(byDay.get(k) ?? { n: 0, sec: 0, wins: 0 }) });
}

const totalSec = axis.reduce((s, d) => s + d.sec, 0);
const activeDays = axis.filter((d) => d.n > 0).length;
const totalGames = axis.reduce((s, d) => s + d.n, 0);
const H = (s) => s / 3600;

// 按月
const byMonth = new Map();
for (const d of axis) {
  if (!d.n) continue;
  const m = d.key.slice(0, 7);
  const c = byMonth.get(m) ?? { days: 0, n: 0, sec: 0 };
  c.days++;
  c.n += d.n;
  c.sec += d.sec;
  byMonth.set(m, c);
}
// 时段（按每局开打的小时）
const byHour = new Map();
for (const g of mine) {
  const h = new Date(g.gameCreation).getHours();
  byHour.set(h, (byHour.get(h) ?? 0) + 1);
}

// 峰值那天：图上要标、图注里也要引用，所以放模块级（原先定义在 dailyChart 里，模板引用不到）
const peak = [...axis].filter((d) => d.n).sort((a, b) => b.sec - a.sec)[0];

// ---------------------------------------------------------------- 画图
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

function dailyChart() {
  const W = 1120, PADL = 44, PADR = 16, PADT = 18, PADB = 34;
  const Hh = 250;
  const plotW = W - PADL - PADR;
  const plotH = Hh - PADT - PADB;
  const maxH = 12;
  const bw = plotW / axis.length;
  const x = (i) => PADL + i * bw + bw * 0.15;
  const y = (h) => PADT + plotH - (Math.min(h, maxH) / maxH) * plotH;
  const barW = Math.max(1.4, bw * 0.7);

  const parts = [];
  // y 轴刻度
  for (let h = 0; h <= maxH; h += 3) {
    parts.push(`<line x1="${PADL}" x2="${W - PADR}" y1="${y(h)}" y2="${y(h)}" class="grid"/>`);
    parts.push(`<text x="${PADL - 6}" y="${y(h) + 3.5}" class="tick" text-anchor="end">${h}h</text>`);
  }
  // 柱子
  axis.forEach((d, i) => {
    const h = H(d.sec);
    if (!d.n) {
      // 空白天：只画一条贴底的浅线，让「那天没打」可见
      parts.push(`<rect x="${x(i)}" y="${PADT + plotH - 1.2}" width="${barW}" height="1.2" class="empty"/>`);
      return;
    }
    parts.push(
      `<rect x="${x(i)}" y="${y(h)}" width="${barW}" height="${PADT + plotH - y(h)}" class="bar">` +
        `<title>${d.key}　${d.n} 局　${h.toFixed(1)} 小时</title></rect>`
    );
  });
  // 月份分隔与标签
  const seen = new Set();
  axis.forEach((d, i) => {
    const m = d.key.slice(0, 7);
    if (seen.has(m)) return;
    seen.add(m);
    if (i > 0) parts.push(`<line x1="${x(i) - bw * 0.4}" x2="${x(i) - bw * 0.4}" y1="${PADT}" y2="${PADT + plotH}" class="mon"/>`);
    const [yy, mm] = m.split("-");
    parts.push(`<text x="${x(i)}" y="${Hh - 12}" class="month">${yy.slice(2)}/${mm}</text>`);
  });
  // 峰值标注
  const pi = axis.findIndex((d) => d.key === peak.key);
  parts.push(
    `<text x="${x(pi)}" y="${y(H(peak.sec)) - 6}" class="peaklabel" text-anchor="middle">${peak.key.slice(5)}　${H(peak.sec).toFixed(1)}h</text>`
  );
  return `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="每日排位时长">${parts.join("")}</svg>`;
}

function monthChart() {
  const rows = [...byMonth.entries()].sort();
  const W = 1120, L = 96, R = 130;
  const rowH = 34;
  const Hh = rows.length * rowH + 16;
  const plotW = W - L - R;
  const maxSec = Math.max(...rows.map(([, v]) => v.sec));
  const parts = [];
  rows.forEach(([m, v], i) => {
    const yy = 8 + i * rowH;
    const w = (v.sec / maxSec) * plotW;
    parts.push(`<text x="${L - 10}" y="${yy + 17}" class="mname" text-anchor="end">${m}</text>`);
    parts.push(
      `<rect x="${L}" y="${yy + 5}" width="${w}" height="18" rx="2" class="bar2">` +
        `<title>${m}　${v.days} 天　${v.n} 局　${H(v.sec).toFixed(1)} 小时</title></rect>`
    );
    parts.push(
      `<text x="${L + w + 8}" y="${yy + 18}" class="mval">${H(v.sec).toFixed(1)} h · ${v.days} 天 · ${v.n} 局</text>`
    );
  });
  return `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="每月排位时长">${parts.join("")}</svg>`;
}

function hourChart() {
  const W = 1120, L = 56, R = 60;
  const rowH = 22;
  const hours = [...Array(24).keys()];
  const Hh = 24 * rowH + 14;
  const plotW = W - L - R;
  const maxN = Math.max(1, ...hours.map((h) => byHour.get(h) ?? 0));
  const parts = [];
  for (const h of hours) {
    const n = byHour.get(h) ?? 0;
    const yy = 6 + h * rowH;
    const w = (n / maxN) * plotW;
    parts.push(`<text x="${L - 10}" y="${yy + 14}" class="mname" text-anchor="end">${h} 点</text>`);
    if (n)
      parts.push(
        `<rect x="${L}" y="${yy + 4}" width="${w}" height="13" rx="2" class="bar3"><title>${h} 点开打　${n} 局</title></rect>`
      );
    parts.push(`<text x="${L + w + 8}" y="${yy + 15}" class="mval">${n || ""}</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="开打时段分布">${parts.join("")}</svg>`;
}

// ---------------------------------------------------------------- HTML
const top = [...axis].filter((d) => d.n).sort((a, b) => b.sec - a.sec).slice(0, 8);
const name = prof.summonerName ?? prof.name ?? "我";
const today = new Date().toLocaleDateString("zh-CN");

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>云顶排位时长 · ${esc(name)}</title>
<style>
  :root{
    --bg:#ffffff; --fg:#1a1d21; --dim:#5b6470; --line:#e3e6ea;
    --accent:#2a78d6; --accent2:#4a9ae8; --empty:#d9dee5; --weak:#8b94a3;
  }
  @media (prefers-color-scheme: dark){
    :root{ --bg:#16181c; --fg:#e8eaed; --dim:#9aa3ae; --line:#2a2e35;
      --accent:#3987e5; --accent2:#5ba0ee; --empty:#333941; --weak:#7a838f; }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
    font:15px/1.65 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
  .wrap{max-width:1180px;margin:0 auto;padding:40px 24px 72px}
  h1{font-size:24px;margin:0 0 6px;font-weight:650}
  .sub{color:var(--dim);font-size:14px;margin-bottom:28px}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:0 0 34px}
  .tile{border:1px solid var(--line);border-radius:10px;padding:14px 16px}
  .tile .k{color:var(--dim);font-size:13px}
  .tile .v{font-size:23px;font-weight:650;margin-top:3px;font-variant-numeric:tabular-nums}
  .tile .n{color:var(--weak);font-size:12px;margin-top:2px}
  figure{margin:0 0 38px}
  figcaption{color:var(--dim);font-size:13px;margin-top:10px;padding-top:9px;border-top:1px solid var(--line)}
  figcaption b{color:var(--fg);font-weight:600}
  svg{width:100%;height:auto;display:block;overflow:visible}
  .grid{stroke:var(--line);stroke-width:1}
  .mon{stroke:var(--line);stroke-width:1;stroke-dasharray:3 3}
  .tick,.month,.mname,.mval,.peaklabel{font-size:11px;fill:var(--dim);font-variant-numeric:tabular-nums}
  .mname{font-size:12px}
  .peaklabel{fill:var(--accent);font-weight:600}
  .bar,.bar2,.bar3{fill:var(--accent)}
  .bar:hover,.bar2:hover,.bar3:hover{fill:var(--accent2)}
  .empty{fill:var(--empty)}
  table{border-collapse:collapse;width:100%;font-size:14px;font-variant-numeric:tabular-nums}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}
  th{color:var(--dim);font-weight:500}
  td.num,th.num{text-align:right}
  .note{color:var(--dim);font-size:13.5px;border-left:3px solid var(--line);padding:2px 0 2px 14px;margin:22px 0}
  .note b{color:var(--fg)}
  @media print{ body{background:#fff;color:#000} .wrap{padding:0} figure{break-inside:avoid} }
</style></head><body><div class="wrap">

<h1>云顶排位 · 每天打了多久</h1>
<div class="sub">${esc(name)}　·　${first} ~ ${last}　·　生成于 ${today}</div>

<div class="tiles">
  <div class="tile"><div class="k">对局总时长</div><div class="v">${H(totalSec).toFixed(0)} 小时</div><div class="n">只算局内，不含排队/选秀</div></div>
  <div class="tile"><div class="k">排位局数</div><div class="v">${totalGames}</div><div class="n">队列 1100</div></div>
  <div class="tile"><div class="k">有打的天数</div><div class="v">${activeDays} 天</div><div class="n">跨 ${axis.length} 天</div></div>
  <div class="tile"><div class="k">有打的天平均</div><div class="v">${(H(totalSec) / activeDays).toFixed(1)} 小时</div><div class="n">单局平均 ${(totalSec / 60 / totalGames).toFixed(0)} 分钟</div></div>
</div>

<figure>
  ${dailyChart()}
  <figcaption><b>图 1</b>　每日对局时长。贴底细线是「那天没打排位」——<b>2025 年 11 月整月空白</b>，
  2025/10 只出现一天。这两处更可能是本地归档没同步到，不一定是真没打（云顶接口只给最近 20 局，补不回更早的）。
  最高的一天是 ${peak.key}：${peak.n} 局 ${H(peak.sec).toFixed(1)} 小时。</figcaption>
</figure>

<figure>
  ${monthChart()}
  <figcaption><b>图 2</b>　按月汇总。真正的排位期是 <b>2025/12 ~ 2026/02</b>：
  2026 年 1 月整整 <b>31 天全打了</b>，155 小时。</figcaption>
</figure>

<figure>
  ${hourChart()}
  <figcaption><b>图 3</b>　每局的开打时段。集中在 <b>18~23 点</b>，19 点最多。</figcaption>
</figure>

<figure>
  <table>
    <thead><tr><th>日期</th><th class="num">局数</th><th class="num">时长</th><th class="num">吃鸡</th></tr></thead>
    <tbody>
      ${top
        .map(
          (d) =>
            `<tr><td>${d.key}</td><td class="num">${d.n}</td><td class="num">${H(d.sec).toFixed(1)} h</td><td class="num">${d.wins}</td></tr>`
        )
        .join("")}
    </tbody>
  </table>
  <figcaption><b>表 1</b>　最长的 8 天。</figcaption>
</figure>

<p class="note">
  <b>口径与限制</b>：时长只取对局的 <code>gameDuration</code>，<b>不含</b>排队、选秀、加载与重开 ——
  按 TFT 的常态再加 8~15 分钟/局，实际占用时间比图上高 <b>25%~40%</b>（约 ${Math.round(H(totalSec) * 1.3)} 小时量级）。<br>
  数据来自本地归档，不是生涯总场次：段位与 LP 变化不在归档里（Riot 的对局接口不返回），所以这份报告只能说明「打了多久」，<b>不能</b>对应到上分节点。
</p>

</div></body></html>
`;

if (!existsSync(path.join(ROOT, "reports"))) mkdirSync(path.join(ROOT, "reports"));
const out = path.join(ROOT, "reports", `云顶排位时长-${name.replace(/[\\/:*?"<>|]/g, "_")}-${today.replace(/\//g, "")}.html`);
writeFileSync(out, html, "utf8");
console.log(`已生成：${out}`);
console.log(`${name}　${totalGames} 局 · ${H(totalSec).toFixed(0)} 小时 · ${activeDays}/${axis.length} 天有打`);
