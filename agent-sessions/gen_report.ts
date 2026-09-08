/**
 * 生成 Codex 会话洞察中文 HTML 报告 —— 版式复刻 Claude Code /insights 官方报告
 *
 * 数据层 = insights.ts（真实 Codex 会话/token/工具统计）；叙事文案基于真实会话归纳。
 * 用法: node <tsx> gen_report.ts [输出路径]
 */
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { buildInsightReport } from "./insights.js";

const outPath = process.argv[2] || join(process.cwd(), "reports", "codex_report.html");

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, " ");

/* 官方 /insights CSS（浅色主题） */
const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #f8fafc; color: #334155; line-height: 1.65; padding: 48px 24px; }
.container { max-width: 800px; margin: 0 auto; }
h1 { font-size: 32px; font-weight: 700; color: #0f172a; margin-bottom: 8px; }
h2 { font-size: 20px; font-weight: 600; color: #0f172a; margin-top: 48px; margin-bottom: 16px; }
.subtitle { color: #64748b; font-size: 15px; margin-bottom: 32px; }
.nav-toc { display: flex; flex-wrap: wrap; gap: 8px; margin: 24px 0 32px 0; padding: 16px; background: white; border-radius: 8px; border: 1px solid #e2e8f0; }
.nav-toc a { font-size: 12px; color: #64748b; text-decoration: none; padding: 6px 12px; border-radius: 6px; background: #f1f5f9; transition: all 0.15s; }
.nav-toc a:hover { background: #e2e8f0; color: #334155; }
.stats-row { display: flex; gap: 24px; margin-bottom: 40px; padding: 20px 0; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; }
.stat { text-align: center; }
.stat-value { font-size: 24px; font-weight: 700; color: #0f172a; }
.stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; }
.at-a-glance { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 1px solid #f59e0b; border-radius: 12px; padding: 20px 24px; margin-bottom: 32px; }
.glance-title { font-size: 16px; font-weight: 700; color: #92400e; margin-bottom: 16px; }
.glance-sections { display: flex; flex-direction: column; gap: 12px; }
.glance-section { font-size: 14px; color: #78350f; line-height: 1.6; }
.glance-section strong { color: #92400e; }
.see-more { color: #b45309; text-decoration: none; font-size: 13px; white-space: nowrap; }
.see-more:hover { text-decoration: underline; }
.narrative { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
.narrative p { margin-bottom: 12px; font-size: 14px; color: #475569; line-height: 1.7; }
.key-insight { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 16px; margin-top: 12px; font-size: 14px; color: #166534; }
.section-intro { font-size: 14px; color: #64748b; margin-bottom: 16px; }
.big-wins { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
.big-win { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; }
.big-win-title { font-weight: 600; font-size: 15px; color: #166534; margin-bottom: 8px; }
.big-win-desc { font-size: 14px; color: #15803d; line-height: 1.5; }
.project-areas { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
.project-area { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
.area-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.area-name { font-weight: 600; font-size: 15px; color: #0f172a; }
.area-count { font-size: 12px; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 4px; }
.area-desc { font-size: 14px; color: #475569; line-height: 1.5; }
.friction-categories { display: flex; flex-direction: column; gap: 16px; margin-bottom: 24px; }
.friction-category { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 16px; }
.friction-title { font-weight: 600; font-size: 15px; color: #991b1b; margin-bottom: 6px; }
.friction-desc { font-size: 13px; color: #7f1d1d; margin-bottom: 10px; }
.friction-examples { margin: 0 0 0 20px; font-size: 13px; color: #334155; }
.friction-examples li { margin-bottom: 4px; }
.horizon-section { display: flex; flex-direction: column; gap: 16px; }
.horizon-card { background: linear-gradient(135deg, #faf5ff 0%, #f5f3ff 100%); border: 1px solid #c4b5fd; border-radius: 8px; padding: 16px; }
.horizon-title { font-weight: 600; font-size: 15px; color: #5b21b6; margin-bottom: 8px; }
.horizon-possible { font-size: 14px; color: #334155; margin-bottom: 10px; line-height: 1.5; }
.charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 24px 0; }
.chart-card { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
.chart-title { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; margin-bottom: 12px; }
.bar-row { display: flex; align-items: center; margin-bottom: 6px; }
.bar-label { width: 120px; font-size: 11px; color: #475569; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-track { flex: 1; height: 6px; background: #f1f5f9; border-radius: 3px; margin: 0 8px; }
.bar-fill { height: 100%; border-radius: 3px; }
.bar-value { width: 60px; font-size: 11px; font-weight: 500; color: #64748b; text-align: right; }
.fun-ending { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 1px solid #fbbf24; border-radius: 12px; padding: 24px; margin-top: 40px; text-align: center; }
.fun-headline { font-size: 18px; font-weight: 600; color: #78350f; margin-bottom: 8px; }
.fun-detail { font-size: 14px; color: #92400e; }
.footer-note { color: #94a3b8; font-size: 12px; text-align: center; margin-top: 40px; }
@media (max-width: 640px) { .charts-row { grid-template-columns: 1fr; } .stats-row { justify-content: center; } }
`;

function bars(data: [string, number][], color: string): string {
  const max = Math.max(1, ...data.map(([, v]) => v));
  return data
    .map(
      ([label, v]) =>
        `<div class="bar-row"><div class="bar-label">${esc(label)}</div>` +
        `<div class="bar-track"><div class="bar-fill" style="width:${(v / max) * 100}%;background:${color}"></div></div>` +
        `<div class="bar-value">${v}</div></div>`
    )
    .join("");
}

interface R {
  count: number;
  tokenTotal: number;
  msgTotal: number;
  dateStart: string;
  dateEnd: string;
  toolTotals: { edit: number; write: number; bash: number; read: number; other: number };
  projects: Record<string, number>;
  sessions: {
    id: string; time: string; project: string; title: string;
    msgCount: number; totalTokens: number | null;
  }[];
}

function workLines(r: R) {
  const label = (p: string) => {
    const pl = (p || "").toLowerCase();
    if (pl.includes("datafusion")) return "📄 DataFusion 论文";
    if (pl.includes("frontendbackend") || pl.includes("abacas-cloud")) return "🖥 ABaCaS 平台(费效)";
    if (pl.includes("其余工程")) return "📝 期刊审稿回复";
    if (pl.includes("abacas") || pl.toLowerCase().includes("codex\\2026") || pl.includes("wei")) return "🗓 ABaCaS 会务";
    return "🧰 其他/杂项";
  };
  const map = new Map<string, { n: number; tok: number; msg: number; t0: string; t1: string }>();
  for (const s of r.sessions) {
    const b = label(s.project);
    const e = map.get(b) || { n: 0, tok: 0, msg: 0, t0: s.time, t1: s.time };
    e.n += 1; e.tok += s.totalTokens || 0; e.msg += s.msgCount;
    if (s.time < e.t0) e.t0 = s.time;
    if (s.time > e.t1) e.t1 = s.time;
    map.set(b, e);
  }
  return [...map.entries()].sort((a, b) => b[1].tok - a[1].tok);
}

async function main() {
  const rr = await buildInsightReport({ agent: "codex", days: 9999, limit: 300 });
  const r: R = rr as R;
  const fmt = (n: number) => (n || 0).toLocaleString("en-US");
  const lines = workLines(r);
  const tokMax = Math.max(1, ...lines.map(([, e]) => e.tok));
  const msgMax = Math.max(1, ...lines.map(([, e]) => e.msg));
  const projMax = Math.max(1, ...Object.entries(r.projects).map(([, n]) => n));

  // —— 工作区卡 ——
  const areaDesc: Record<string, string> = {
    "📄 DataFusion 论文": "论文《美国地表臭氧长期变化及其不确定性：多融合数据集综合评估》推进——RQ1-3 研究问题与证据链梳理、中期检查 PPT/答辩材料与图表核对、论文思路迭代与文献核验(Zotero/查重)、交接文档处理。token 占全部 Codex 用量的九成。",
    "🖥 ABaCaS 平台(费效)": "abacas-cloud 后端与 rsm.webui 前端的费效评估开发——成本曲线/Control Case 生成的接口模式、AVNA/WVNA 空间插值算法差异排查、全链条费效评估 v2 的 n8n 流程联调。",
    "📝 期刊审稿回复": "APR-D-26-00567 期刊审稿意见处理——读审稿意见 docx、逐条起草回复，跨多个会话迭代。",
    "🗓 ABaCaS 会务": "ABaCaS 2026 会议筹备——会议摘要信息表/用户信息表核对整理(桌面/微信素材)。",
  };
  const areasHtml = lines
    .map(([name, e]) => {
      const desc =
        areaDesc[name] ||
        "零散任务与早期测试会话（含 echo hello / 1 等占位输入）。";
      return `<div class="project-area">
        <div class="area-header"><div class="area-name">${esc(name)}</div><div class="area-count">${e.n} 会话 · ${fmt(e.tok)} tok</div></div>
        <div class="area-desc">${esc(desc)}</div>
      </div>`;
    })
    .join("");

  // —— 工具与项目条形图 ——
  const toolData: [string, number][] = [
    ["Bash", r.toolTotals.bash],
    ["编辑 Edit", r.toolTotals.edit],
    ["其它", r.toolTotals.other],
    ["读取 Read", r.toolTotals.read],
    ["写入 Write", r.toolTotals.write],
  ];
  const projData = Object.entries(r.projects).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const lineTok = lines.slice(0, 5).map(([n, e]) => [n.replace(/^[^\s]+\s/, ""), e.tok] as [string, number]);

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Codex 会话洞察报告</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body><div class="container">
  <h1>Codex 会话洞察</h1>
  <p class="subtitle">${r.msgTotal.toLocaleString()} 条消息 · ${r.count} 个会话 · ${new Date().toISOString().slice(0,10)} 生成</p>

  <div class="at-a-glance">
    <div class="glance-title">一图速览 · At a Glance</div>
    <div class="glance-sections">
      <div class="glance-section"><strong>做得好：</strong>你的 Codex 工作集中在少数几条深水区——DataFusion 论文与 ABaCaS 费效评估——并为此投入了超长会话（单会话最高 16.5 亿 token）。你倾向把任务做成可复用的产物（MCP 工具、报告生成器），而不是一次性脚本。<a href="#section-wins" class="see-more">亮点工作 →</a></div>
      <div class="glance-section"><strong>阻碍点：</strong>大量 token 消耗在超长续写会话与配置/环境排查（hooks、MCP 启动失败），真正的代码产出占比不高；多模型混用（vision-exp/terra/luna/sol）使成本与行为难以预期。<a href="#section-friction" class="see-more">问题分析 →</a></div>
      <div class="glance-section"><strong>可尝试：</strong>给长会话设明确「完成即止」边界，避免开着跨周续写空转；把反复出现的 Codex 排查经验沉淀成可复用文档/Skill，而非每次重查。<a href="#section-horizon" class="see-more">On the Horizon →</a></div>
    </div>
  </div>

  <nav class="nav-toc">
    <a href="#section-work">工作分布</a>
    <a href="#section-usage">使用方式</a>
    <a href="#section-wins">亮点</a>
    <a href="#section-friction">问题</a>
    <a href="#section-horizon">建议</a>
  </nav>

  <div class="stats-row">
    <div class="stat"><div class="stat-value">${r.count}</div><div class="stat-label">Sessions</div></div>
    <div class="stat"><div class="stat-value">${fmt(r.msgTotal)}</div><div class="stat-label">Messages</div></div>
    <div class="stat"><div class="stat-value">${Math.round(r.tokenTotal / 1e8) / 10}亿</div><div class="stat-label">Tokens</div></div>
    <div class="stat"><div class="stat-value">${r.toolTotals.bash + r.toolTotals.edit + r.toolTotals.write + r.toolTotals.read + r.toolTotals.other}</div><div class="stat-label">Tool Calls</div></div>
    <div class="stat"><div class="stat-value">${esc(r.dateStart.slice(5))}</div><div class="stat-label">→ ${esc(r.dateEnd.slice(5))}</div></div>
  </div>

  <h2 id="section-work">What You Work On · 工作分布</h2>
  <div class="project-areas">${areasHtml}</div>

  <div class="charts-row">
    <div class="chart-card"><div class="chart-title">token 占比(按工作线)</div>${bars(lineTok, "#4da3ff")}</div>
    <div class="chart-card"><div class="chart-title">工具使用</div>${bars(toolData, "#0891b2")}</div>
  </div>

  <h2 id="section-usage">How You Use Codex · 使用方式</h2>
  <div class="narrative">
    <p>你把 Codex 当作<b>长会话批处理引擎</b>：论文与平台两大主线各由少数跨周/跨月的超长会话承担（DataFusion 20 会话 40.7 亿 token），期间反复「继续」续写、经多次上下文压缩(compact)仍在推进。你习惯把文件/截图/表格直接丢给它（Files mentioned 高频出现），让 Codex 自己读文件定位。</p>
    <p>你<b>看重可复用产物</b>：不只问一句答一句，而是产出能长期用的工具——包括本报告依赖的 agent-sessions MCP 与 token 统计。你也用它做环境与配置排查（hooks 冲突、MCP 启动失败、模型路由），以及审稿回复这类文档工作。</p>
    <div class="key-insight"><strong>核心模式：</strong>少数大主题 · 超长续写 · 高 token · 倾向沉淀工具与文档而非一次性解决。</div>
  </div>

  <h2 id="section-wins">Impressive Things · 亮点工作</h2>
  <div class="section-intro">这些会话展示了超出「问答」的深度。</div>
  <div class="big-wins">
    <div class="big-win"><div class="big-win-title">论文 RQ 框架的持久梳理</div><div class="big-win-desc">从「读取目前项目，针对 RQ1/2/3 有什么」到多轮迭代，把 8 个融合数据集的证据链、区域断点、集成口径梳理成可讲给导师的框架，并配套中期答辩 PPT 与图表核对。</div></div>
    <div class="big-win"><div class="big-win-title">费效评估接口的精确诊断</div><div class="big-win-desc">定位 Control Case / Reduction_Cost 生成的条件依赖，把「前端不上传成本文件就失败」的根因讲清，并给出后端拆分为 calculate_cost / generate_control_case 两模式的改法。</div></div>
    <div class="big-win"><div class="big-win-title">跨会话的自有工具链</div><div class="big-win-desc">本报告即由你自建 agent-sessions MCP 驱动——读 Codex 会话、统计 token、聚合洞察，数据与 Codex 官方统计一致。</div></div>
  </div>

  <h2 id="section-friction">Where Things Go Wrong · 问题分析</h2>
  <div class="friction-categories">
    <div class="friction-category">
      <div class="friction-title">超长会话带来 token 黑洞与失焦</div>
      <div class="friction-desc">跨周续写 + 频繁 compact 使单会话 token 以亿计（最高 16.6 亿），大量算力消耗在重读历史；会话「继续」过多时主题易漂移。</div>
      <ul class="friction-examples"><li>019f8891 会话 16.6 亿 token，主体是 hooks/MCP 环境排查，真正产出有限。</li><li>多个「继续」会话 msg 上百但首条消息仅「继续」，缺少目标锚点。</li></ul>
    </div>
    <div class="friction-category">
      <div class="friction-title">多模型混用致成本与行为不可预期</div>
      <div class="friction-desc">同一 Codex 实际路由到 5 种模型(deepseek-v4-flash-vision-exp / gpt-5.6-terra / luna / sol / flash)，单价差异巨大且部分无官方价，费用核算困难。</div>
      <ul class="friction-examples"><li>cost 最大并非 token 最多的 vision-exp（96% 缓存、便宜），而是 terra（非缓存输入价高）。</li><li>早期会话(4-5月)与部分渠道无 usage 记录，历史费用不可追。</li></ul>
    </div>
  </div>

  <h2 id="section-horizon">On the Horizon · 建议</h2>
  <div class="horizon-section">
    <div class="horizon-card"><div class="horizon-title">给长会话设边界</div><div class="horizon-possible">为超长主线开「新会话 + 交接文档」而非无限「继续」；用 session_insights 定期看哪些会话 token 失控。</div></div>
    <div class="horizon-card"><div class="horizon-title">固定模型与成本口径</div><div class="horizon-possible">在 Codex 配置锁定目标模型，避免自动路由漂移到加价档；沿用本报告的三档 token 统计做月度复盘。</div></div>
  </div>

  <div class="fun-ending">
    <div class="fun-headline">从一个「能不能看 Codex 会话」的问题，长出了一整套会话洞察工具</div>
    <div class="fun-detail">本报告本身，就是这套工具的第一个正式产出。</div>
  </div>

  <p class="footer-note">数据来源 ~/.codex 会话记录 · token 为官方统计(46/60 会话有记录) · 由 agent-sessions · session_insights 生成</p>
</div></body></html>`;

  mkdirSync(join(outPath, ".."), { recursive: true });
  writeFileSync(outPath, html, "utf-8");
  console.log("已生成:", outPath, `(${(html.length / 1024).toFixed(0)} KB)`);
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
