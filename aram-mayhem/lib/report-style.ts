/**
 * 报告共享样式与图件规范（海斗报告 / 云顶报告共用）。
 *
 * 设计取向偏「科研图」：
 *   · 矢量内联 SVG（可直接截图/另存进论文）；
 *   · 图编号 + 题注在下（期刊惯例：Figure N. 说明）；
 *   · 数字一律 tabular-nums，等宽对齐全表；
 *   · 网格/轴线克制（hairline），墨色只有三档（主/次/弱）；
 *   · 深色模式是**选中**的（同一套色阶换面），不是自动翻转；
 *   · 印刷/导出 PDF 友好：白底、图不跨页断开、隐藏交互控件。
 * 配色沿用可视化基线（浅 #2a78d6/#eb6834、深 #3987e5/#d95926、背离蓝↔红），已跑过色盲与对比度校验。
 */

export const REPORT_CSS = `
  :root {
    color-scheme: light;
    --surface-1: #fcfcfb; --page: #f9f9f7;
    --text-primary: #0b0b0b; --text-secondary: #52514e; --muted: #898781;
    --grid: #e1e0d9; --baseline: #c3c2b7; --border: rgba(11,11,11,0.10);
    --pos: #2a78d6; --neg: #e34948; --accent: #eb6834;
    --good: #0ca30c; --critical: #d03b3b;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      color-scheme: dark;
      --surface-1: #1a1a19; --page: #0d0d0d;
      --text-primary: #ffffff; --text-secondary: #c3c2b7; --muted: #898781;
      --grid: #2c2c2a; --baseline: #383835; --border: rgba(255,255,255,0.10);
      --pos: #3987e5; --neg: #e66767; --accent: #d95926;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --surface-1: #1a1a19; --page: #0d0d0d;
    --text-primary: #ffffff; --text-secondary: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --baseline: #383835; --border: rgba(255,255,255,0.10);
    --pos: #3987e5; --neg: #e66767; --accent: #d95926;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 20px 72px;
    background: var(--page); color: var(--text-primary);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    line-height: 1.6; -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1000px; margin: 0 auto; }

  /* 页头 */
  header.hero { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-end; justify-content: space-between; margin-bottom: 4px; }
  .hero h1 { font-size: 21px; margin: 0 0 6px; font-weight: 650; letter-spacing: -0.01em; }
  .hero .meta { color: var(--text-secondary); font-size: 12.5px; font-variant-numeric: tabular-nums; }
  .hero .hero-num { font-size: 52px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .hero .hero-num small { font-size: 15px; font-weight: 500; color: var(--text-secondary); margin-left: 8px; letter-spacing: 0; }

  /* 指标卡 */
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 10px; margin: 22px 0 10px; }
  .tile { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
  .tile-label { font-size: 11.5px; color: var(--text-secondary); letter-spacing: 0.01em; }
  .tile-value { font-size: 23px; font-weight: 650; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .tile-sub { font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; }

  /* 区块 */
  section { background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px; padding: 22px 24px; margin-top: 18px; }
  section > h2 { font-size: 15.5px; margin: 0 0 4px; font-weight: 650; letter-spacing: -0.005em; }
  section > h2 .num { color: var(--muted); font-weight: 600; margin-right: 6px; }

  /* 图件：期刊式——图在上、题注在下 */
  figure.chart { margin: 22px 0 0; break-inside: avoid; page-break-inside: avoid; }
  figure.chart + figure.chart { margin-top: 26px; }
  figure.chart svg { width: 100%; height: auto; display: block; }
  figcaption { font-size: 12px; color: var(--text-secondary); margin-top: 8px; line-height: 1.5; }
  figcaption .fignum { color: var(--text-primary); font-weight: 650; margin-right: 4px; }
  .legend { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; font-size: 12px; color: var(--text-secondary); margin: 12px 0 2px; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 11px; height: 11px; border-radius: 2.5px; display: inline-block; }

  /* 图形元素 */
  .grid { stroke: var(--grid); stroke-width: 1; }
  .baseline { stroke: var(--baseline); stroke-width: 1; stroke-dasharray: 4 4; }
  .axis-label { fill: var(--muted); font-size: 10.5px; font-variant-numeric: tabular-nums; }
  .series-line { fill: none; stroke: var(--pos); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .crosshair { stroke: var(--text-secondary); stroke-width: 1; opacity: .5; }
  .row-label { fill: var(--text-primary); font-size: 12px; }
  .row-sub { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .row-value { fill: var(--text-primary); font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .tick { stroke: var(--text-primary); stroke-width: 2; }
  .bar:hover { opacity: .85; }
  .streak-band { fill: var(--neg); opacity: .10; }
  .streak-label { fill: var(--neg); font-size: 10px; font-weight: 600; }

  /* 正文结论 */
  ul.findings { margin: 14px 0 0; padding-left: 18px; }
  ul.findings li { margin-bottom: 9px; }
  ul.findings li:last-child { margin-bottom: 0; }

  /* 表格 */
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; margin-top: 12px; }
  caption { text-align: left; font-size: 11.5px; color: var(--text-secondary); margin-bottom: 6px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; }
  th { color: var(--text-secondary); font-weight: 550; font-size: 11.5px; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.win { color: var(--good); font-weight: 600; }
  td.lose { color: var(--critical); font-weight: 600; }
  details { margin-top: 14px; }
  summary { cursor: pointer; color: var(--text-secondary); font-size: 12.5px; }

  footer { margin-top: 22px; color: var(--text-secondary); font-size: 12px; }
  footer li { margin-bottom: 4px; }
  #tip {
    position: fixed; pointer-events: none; z-index: 9; display: none;
    background: var(--surface-1); color: var(--text-primary); border: 1px solid var(--border);
    border-radius: 8px; padding: 8px 10px; font-size: 12px; box-shadow: 0 6px 20px rgba(0,0,0,.16); max-width: 320px;
  }
  #tip .t1 { font-weight: 600; }
  #tip .t2 { color: var(--text-secondary); margin-top: 2px; }
  .toggle { border: 1px solid var(--border); background: var(--surface-1); color: var(--text-secondary);
            border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer; }

  /* 印刷 / 导出 PDF：白底、图不断页、隐藏交互 */
  @media print {
    :root { --page: #ffffff; --surface-1: #ffffff; --grid: #e6e5df; --border: rgba(0,0,0,0.12); }
    body { background: #ffffff; padding: 0; }
    section { border: none; padding: 0; margin-top: 22px; break-inside: auto; }
    figure.chart { break-inside: avoid; page-break-inside: avoid; }
    .toggle, #tip, details > summary { display: none !important; }
    details { display: block; }
    details[open] > table, details > table { display: table; }
    header.hero .hero-num { font-size: 44px; }
  }
`;

/** 期刊式图注：图 N. 说明 */
/**
 * 把「题注在上」的图重排成期刊式「图在上、题注在下」，并统一编号（图 1、图 2 …）。
 * 图表函数本身不用改：只要它们按 `<figure class="chart">…<figcaption>说明</figcaption>…<svg>…</svg></figure>` 输出。
 */
export function reflowFigures(html: string): string {
  let n = 0;
  return html.replace(
    /<figure class="chart">([\s\S]*?)<figcaption>([\s\S]*?)<\/figcaption>([\s\S]*?)<\/figure>/g,
    (_m, before: string, caption: string, after: string) => {
      n += 1;
      const cap = caption.trim();
      return `<figure class="chart">${before}${after}<figcaption><span class="fignum">图 ${n}.</span>${cap}</figcaption></figure>`;
    }
  );
}
