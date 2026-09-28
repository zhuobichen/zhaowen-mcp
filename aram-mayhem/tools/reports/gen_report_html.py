# -*- coding: utf-8 -*-
"""读 _report_data.json，生成 HTML 报告（v2）。"""
import pathlib
import json, os

BASE = str(pathlib.Path(__file__).resolve().parent.parent.parent)
D = json.load(open(os.path.join(BASE, 'reports', '_report_data.json'), encoding='utf-8'))
D['mate'] = json.load(open(os.path.join(BASE, 'reports', '_mate.json'), encoding='utf-8'))
D['mate2'] = json.load(open(os.path.join(BASE, 'reports', '_mate2.json'), encoding='utf-8'))
OUT = os.path.join(BASE, 'reports', '海斗深度分析-自己的丁ding-66595.html')
JSON_DATA = json.dumps(D, ensure_ascii=False, separators=(',', ':'))

TEMPLATE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>海斗深度分析 · 自己的丁ding#66595</title>
<style>
:root{
  color-scheme:light;
  --surf:#fcfcfb; --page:#f7f7f5; --card2:#f2f1ed;
  --ink:#0b0b0b; --ink2:#52514e; --muted:#898781;
  --grid:#e1e0d9; --axis:#c3c2b7; --border:rgba(11,11,11,0.10);
  --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100;
  --up:#2a78d6; --down:#e34948; --good:#006300;
  --warnbg:#fff6e5; --warnbd:#eda100;
  --shadow:0 1px 2px rgba(11,11,11,.05),0 8px 24px -12px rgba(11,11,11,.18);
  --shadow2:0 2px 4px rgba(11,11,11,.07),0 16px 32px -14px rgba(11,11,11,.25);
}
@media (prefers-color-scheme:dark){
  :root:where(:not([data-theme="light"])){
    color-scheme:dark;
    --surf:#1a1a19; --page:#0d0d0d; --card2:#232322;
    --ink:#fff; --ink2:#c3c2b7; --muted:#898781;
    --grid:#2c2c2a; --axis:#383835; --border:rgba(255,255,255,0.10);
    --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500;
    --up:#3987e5; --down:#e66767; --good:#0ca30c;
    --warnbg:#2a2313; --warnbd:#c98500;
    --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px -12px rgba(0,0,0,.7);
    --shadow2:0 2px 4px rgba(0,0,0,.5),0 16px 32px -14px rgba(0,0,0,.85);
  }
}
:root[data-theme="dark"]{
  color-scheme:dark;
  --surf:#1a1a19; --page:#0d0d0d; --card2:#232322;
  --ink:#fff; --ink2:#c3c2b7; --muted:#898781;
  --grid:#2c2c2a; --axis:#383835; --border:rgba(255,255,255,0.10);
  --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500;
  --up:#3987e5; --down:#e66767; --good:#0ca30c;
  --warnbg:#2a2313; --warnbd:#c98500;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px -12px rgba(0,0,0,.7);
  --shadow2:0 2px 4px rgba(0,0,0,.5),0 16px 32px -14px rgba(0,0,0,.85);
}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
  font-size:15px;line-height:1.7;-webkit-font-smoothing:antialiased}
.wrap{max-width:1020px;margin:0 auto;padding:0 20px 90px}

.hero{position:relative;margin:0 -20px 0;padding:52px 40px 40px;overflow:hidden;
  background:linear-gradient(135deg,var(--s1) 0%,#4a3aa7 100%);color:#fff}
.hero::after{content:"";position:absolute;inset:0;
  background:radial-gradient(900px 340px at 88% -30%,rgba(255,255,255,.28),transparent 62%);pointer-events:none}
.hero h1{margin:0 0 8px;font-size:30px;letter-spacing:-.02em;font-weight:680}
.hero .sub{opacity:.9;font-size:14.5px;margin:0}
.hero .kpis{display:flex;gap:34px;flex-wrap:wrap;margin-top:26px}
.hero .kpi{display:flex;flex-direction:column}
.hero .kpi b{font-size:36px;font-weight:680;line-height:1.05;letter-spacing:-.02em}
.hero .kpi span{font-size:12.5px;opacity:.85;margin-top:2px}

h2{font-size:21px;margin:52px 0 6px;letter-spacing:-.01em}
h2 .num{display:inline-flex;width:28px;height:28px;border-radius:8px;margin-right:9px;
  background:linear-gradient(135deg,var(--s1),#4a3aa7);color:#fff;font-size:15px;
  align-items:center;justify-content:center;vertical-align:1px}
h3{font-size:15.5px;margin:28px 0 4px;color:var(--ink)}
.card{background:var(--surf);border:1px solid var(--border);border-radius:14px;
  padding:20px 22px;margin:14px 0;box-shadow:var(--shadow);
  transition:transform .18s ease,box-shadow .18s ease}
.card:hover{transform:translateY(-2px);box-shadow:var(--shadow2)}
.note{font-size:13.5px;color:var(--ink2);margin:8px 0 0}
.warn{background:var(--warnbg);border:1px solid var(--warnbd);border-radius:12px;
  padding:14px 16px;font-size:13.5px;margin:16px 0;box-shadow:var(--shadow)}
ul,ol{margin:8px 0;padding-left:22px}
li{margin:6px 0}
b,strong{font-weight:680}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--grid)}
th{color:var(--ink2);font-weight:600;font-size:12.5px;white-space:nowrap}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
#gt td:nth-child(1),#gt td:nth-child(2),#gt td:nth-child(3){white-space:nowrap}
.tag{display:inline-block;background:var(--card2);color:var(--ink2);border-radius:5px;
  padding:1px 7px;font-size:11.5px;margin:1px 3px 1px 0}
.chart{width:100%;height:auto;display:block;margin:8px 0 0;overflow:visible}
.chart rect,.chart circle,.chart path{transition:filter .15s ease}
.chart rect:hover,.chart circle:hover{filter:brightness(1.18)}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--ink2);margin:8px 0 0}
.legend i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media (max-width:780px){.grid2{grid-template-columns:1fr}}
.pill{display:inline-block;padding:1px 9px;border-radius:20px;font-size:12px;font-weight:600}
.pill.w{background:rgba(42,120,214,.15);color:var(--up)}
.pill.l{background:rgba(227,73,72,.15);color:var(--down)}
.ctl{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}
input,select{background:var(--surf);color:var(--ink);border:1px solid var(--border);
  border-radius:9px;padding:7px 11px;font-size:13.5px;font-family:inherit;transition:border-color .15s}
input:focus,select:focus{outline:none;border-color:var(--s1)}
input{min-width:190px}
#tip{position:fixed;pointer-events:none;background:var(--ink);color:var(--page);
  padding:7px 11px;border-radius:8px;font-size:12.5px;line-height:1.55;opacity:0;
  transition:opacity .12s;z-index:99;max-width:300px;box-shadow:0 8px 24px rgba(0,0,0,.3)}
details{border:1px solid var(--border);border-radius:14px;background:var(--surf);
  box-shadow:var(--shadow);margin:16px 0;overflow:hidden}
details[open]{box-shadow:var(--shadow2)}
summary{cursor:pointer;padding:18px 22px;font-weight:650;font-size:15.5px;list-style:none;
  display:flex;align-items:center;gap:10px;user-select:none;transition:background .15s}
summary::-webkit-details-marker{display:none}
summary:hover{background:var(--card2)}
summary .chev{margin-left:auto;color:var(--muted);transition:transform .2s;font-size:13px}
details[open] summary .chev{transform:rotate(90deg)}
.body{padding:0 22px 22px}
footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--grid);
  font-size:12.5px;color:var(--muted);line-height:1.8}
.toggle{position:fixed;top:16px;right:18px;z-index:100;background:rgba(255,255,255,.16);
  border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:9px;padding:7px 13px;
  font-size:13px;cursor:pointer;font-family:inherit;backdrop-filter:blur(6px)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin-top:14px}
.mini{background:var(--card2);border-radius:11px;padding:13px 15px}
.mini .t{font-size:13px;color:var(--ink2);margin-bottom:5px}
.mini .v{font-size:23px;font-weight:680;letter-spacing:-.01em}
.mini .d{font-size:12px;color:var(--muted);margin-top:3px}
.hero-fade{animation:fade .5s ease both}
@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
</style>
</head>
<body>
<script>
window.addEventListener('error', function(ev){
  var d=document.createElement('div');
  d.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#d03b3b;color:#fff;padding:12px 16px;font-size:13px;z-index:9999;white-space:pre-wrap;font-family:monospace';
  d.textContent='JS ERROR: '+ev.message+' @'+ev.lineno+':'+ev.colno+'\n'+((ev.error&&ev.error.stack)||'');
  document.body.appendChild(d);
});
</script>
<button class="toggle" onclick="(function(){var d=document.documentElement;var c=d.getAttribute('data-theme');d.setAttribute('data-theme',c==='dark'?'light':(c==='light'?'dark':(matchMedia('(prefers-color-scheme: dark)').matches?'light':'dark')));})()">◐ 主题</button>

<div class="hero">
  <div class="wrap" style="padding:0">
    <h1>海克斯大乱斗 · 深度分析</h1>
    <p class="sub" id="head"></p>
    <div class="kpis">
      <div class="kpi"><b id="h-p"></b><span>总胜率</span></div>
      <div class="kpi"><b id="h-n"></b><span>样本局数</span></div>
      <div class="kpi"><b id="h-se"></b><span>标准误（±）</span></div>
      <div class="kpi"><b id="h-d"></b><span>场均死亡</span></div>
    </div>
  </div>
</div>

<div class="wrap">
<p class="note" id="h-note" style="margin-top:18px"></p>

<div class="warn" id="datawarn"></div>

<h2><span class="num">1</span>先说结论</h2>
<div class="card">
<ol>
<li><b>49.0% 就是「抛硬币」水平。</b>样本 1001 局、标准误 ±1.58 个百分点，与 50% 的差距（1.0pp）完全落在噪声里。海斗随机发牌，这个基线本身正常 —— 既不能说「打得差」，也没有证据说「本该更高」。</li>
<li><b>死亡是最强信号，而且扛得住「碾压局本来就短」这个反驳。</b>按时长切成三层后，<b>每一层里死得少的胜率都更高</b>：短局 +40.8pp、中局 +15.9pp、长局 +16.6pp。死亡 0–5 的 195 局胜率 66.7%（z=+4.95）。</li>
<li><b>「伤害队内第一 → 输」不是错觉，但它真正的名字是「用命换的伤害」。</b>同样是伤害第一：死亡 ≤5 时 66.7%，死亡 ≥12 时只有 33.3% —— 后者场均打 76.6k 伤害、局均 19.9 分钟。</li>
<li><b>助攻比伤害更能预告胜利。</b>中局里助攻 &lt;20 时 33%，助攻 36+ 时 77%。赢局相对输局助攻差 +5.5 次（+24%），而击杀只差 +1.2 次；补刀几乎无关。</li>
<li><b>类别上，「坦克/法师」是你最弱的两个定位</b>（43.8% / 47.6%），「战士/射手」最强（51.1% / 50.9%）。差异幅度 −5.2pp~+2.1pp，<b>都还没到统计显著</b>，但方向和他「死得多」的毛病一致。</li>
<li><b>装备与符文的胜率榜基本不可信。</b>装备 45 件、符文 68 件里，只有极少数样本够大；符文更是 <b>随机发的</b>，所以这部分只当「观察」看，别照着买/照着留。</li>
</ol>
<div class="note">全部为观察数据的相关性，不是因果实验。每张图都标了样本量与 z 值（|z|≥2 才在噪声之外）。</div>
</div>

<h2><span class="num">2</span>输的时候因为什么，赢的时候因为什么</h2>

<h3>2.1 赢局 vs 输局的逐项差距</h3>
<p class="note">同一场对局里，赢的一方与输的一方数据天然互相影响，所以这 8 项是「结果画像」而不是「原因清单」。真正能提供因果线索的是后面的分层分析。</p>
<div id="c-metrics"></div>

<h3>2.2 死亡：最强信号</h3>
<div id="c-death"></div>

<h3>2.3 排除「碾压局本来就短」—— 按时长分层后重看死亡</h3>
<p class="note">如果死亡少只是因为「局短」，那在同一时长层内死亡效应就该消失。事实相反：三层之内全部成立，短局层拉开到 40.8 个百分点。</p>
<div id="c-deathdur"></div>

<h3>2.4 助攻：第二个稳定信号，且完全单调</h3>
<p class="note">每一层时长内助攻越多胜率越高，没有反转。中局层 4 档差了 44 个百分点。<b>带 * 的格子 = 样本 &lt;25 局，只作参考</b>（例如「短局 + 助攻 36+」只有 14 局却显示 92.9%）。</p>
<div id="c-assistdur"></div>

<h3>2.5 「伤害队内第一」到底意味着什么</h3>
<div id="c-rank"></div>
<div id="c-firstdeath"></div>
<p class="note">上图：伤害排名越靠前胜率越低 —— 控制时长后这个负相关依然存在（短局 −12.2pp、中局 −13.5pp、长局 −5.5pp）。<br>
下图：把「伤害第一」这 128 局按死亡拆开后，负相关几乎完全被死亡解释 —— 死得少的伤害第一很强（66.7%，但只有 9 局），死得多的伤害第一最弱（33.3%，45 局）。</p>

<h3>2.6 同一个「伤害第一」，不同英雄含义相反</h3>
<div id="c-firsthero"></div>
<p class="note">条向左（红）= 这个英雄<b>一旦你打出全队最高伤害，胜率反而掉下来</b>。左侧这组正是问题所在。条向右（蓝）或接近 0 = 能不能 carry 与胜负无关，可以放心打输出。每格样本只有 5–20 局，方向比幅度更可信。</p>

<h3>2.7 英雄池：哪些英雄是真的能赢</h3>
<div id="c-heroes"></div>

<h3>2.8 月度：没有趋势性下滑</h3>
<div id="c-months"></div>
<p class="note">最近 4 个有效周 41.3% vs 之前 4 个 46.2%，差 4.9pp 而噪声 6.7pp —— 分不开。1 月的 59.3%（113 局）是样本里最好的月份，但同样可能只是波动。</p>

<h2><span class="num">3</span>什么类别的英雄胜率高</h2>

<h3>3.1 按官方定位（每个英雄取主定位）</h3>
<div id="c-roles"></div>
<div id="c-rolesDeath"></div>
<p class="note" id="rolesDeath-note"></p>
<p class="note" id="roles-note"></p>

<h3>3.2 多标签版（一个英雄有多个定位时，每个定位都算一份）</h3>
<div id="c-rolesMulti"></div>
<p class="note" id="rolesMulti-note"></p>

<h3>3.3 英雄画像：伤害 × 承伤（气泡 = 局数，颜色 = 胜率）</h3>
<div id="c-bubble"></div>
<p class="note">右上角 = 高伤害 + 高承伤（贴身肉搏型），右下 = 高伤害 + 低承伤（后排输出型），左上 = 低伤害 + 高承伤（纯肉）。<b>你的英雄池重心偏「低伤害高承伤」的左上区，那一片恰好是胜率偏低的区域。</b></p>

<h3>3.4 K-means 聚类（4 类，特征 = 伤害/承伤/死亡/时长）</h3>
<div id="c-cluster"></div>
<div class="cards" id="c-clusterCards"></div>
<p class="note" id="cluster-note"></p>

<h2><span class="num">4</span>装备：胜率榜（只算成装）</h2>
<p class="note">只统计<b>成装</b>：排除鞋、消耗品、饰品，且总价 ≥2200。同一局同一件装备只算一次。<b>这是相关性不是因果</b> —— 优势局本来就出得起贵的装备，而且「出某装备」往往是因为「这局顺」。</p>
<div id="c-items"></div>
<p class="note" id="items-note"></p>

<h2><span class="num">5</span>海克斯（符文）：胜率榜</h2>
<p class="note">同一局同一个符文只算一次，只列出现 ≥20 局的。<b>符文是随机发的</b>，所以「胜率高」多半是符文本身强度 + 运气，不是你「会用它」的证据。</p>
<div id="c-augRarity"></div>
<div id="c-augments"></div>
<div id="c-augBottom"></div>
<p class="note" id="aug-note"></p>

<h2><span class="num">6</span>和谁排、几人排</h2>
<p class="note">数据从归档里每局的 10 人名单现算（用 puuid 反查，不依赖工具的队友统计），覆盖你全部的 <span id="mate-n"></span> 局。同一个玩家改过名也认得出来。</p>

<div class="card">
<h3>这一段用的方法（不是简单排序）</h3>
<ul>
<li><b>Beta-Binomial 收缩</b>：先验强度按 20 局算 —— 样本越少的组合，胜率越会被拉回 49% 基准。这样「打了 2 把全胜」不会排到第一。</li>
<li><b>Wilson 得分下界</b>：取 95% 置信区间的<b>下端</b>作为保守排名，样本小自然往下沉。</li>
<li><b>Benjamini-Hochberg FDR</b>：从上万个组合里挑最大值，光靠运气就能造出很大的差距。BH 把多重比较压回去，<b>q&lt;0.05 才算真发现</b>。</li>
</ul>
<div class="note">为什么不直接按胜率排？因为你有 <span id="mate-distinct"></span> 个不同的同队玩家、上千个组合 —— 直接排序的话，第一名几乎一定是「某次随机匹配到一起、只打过 2 把且都赢了」的路人。</div>
</div>

<h3>6.1 有几个「常一起玩的人」在场</h3>
<div id="c-scale"></div>
<p class="note" id="scale-note"></p>

<h3>6.2 单个队友：胜率，以及他的个人表现</h3>
<div id="c-mates"></div>
<p class="note" id="mates-note"></p>
<p class="note">下面是同一个人的<b>个人表现分</b> —— 数据来自归档里每个人的完整 stats，不只是胜负。<b>「队内伤害名次」= 他那一局在 5 人队里伤害排第几的平均值（越小越强）。</b></p>
<div style="overflow-x:auto"><table id="perf-table">
<thead><tr><th>队友</th><th class="num">同队局数</th><th class="num">同队胜率</th><th class="num">KDA</th><th class="num">场均伤害</th><th class="num">场均死亡</th><th class="num">场均承伤</th><th class="num">队内伤害名次</th></tr></thead>
<tbody></tbody></table></div>
<p class="note" id="perf-note"></p>

<h3>6.3 控制共现：AQword 的高胜率，是不是今人带来的？</h3>
<p class="note">你提的这个问题很关键 —— 如果 AQword 每次都和今人一起出现，那他的胜率可能只是今人的。用「A 在场时，B 在不在场」的对照来拆。</p>
<div id="c-cond"></div>
<p class="note" id="cond-note"></p>

<h3>6.4 2 / 3 / 4 / 5 人排的最高组合</h3>
<div style="overflow-x:auto"><table id="party-table">
<thead><tr><th>排的人数</th><th>组合</th><th class="num">局数</th><th class="num">胜</th><th class="num">胜率</th><th class="num">收缩后</th><th class="num">Wilson 下界</th><th class="num">q 值</th></tr></thead>
<tbody></tbody></table></div>
<p class="note" id="party-note"></p>

<h3>6.5 谁最厉害，谁最菜</h3>
<div id="c-perfscatter"></div>
<p class="note" id="perfscatter-note"></p>

<h3>6.6 结论</h3>
<div class="card" id="mate-conclusion"></div>

<h2><span class="num">7</span>建议</h2>
<div class="card">
<h3>A. 把「少死」当唯一首要指标，而不是把伤害打上去</h3>
<ul>
<li>依据：死亡分桶是全局最强、且对时长稳健的信号；伤害第一反而是负相关。</li>
<li>可操作：场均 9.2 死。海斗里一次死亡给对面金币+经验+推进窗口。<b>每局结束问自己：这 10 次死里，有几次是可以不死的。</b></li>
<li>诚实边界：碾压局本来就死得少，不能承诺「死到 5 次就赢 66%」。站得住的说法是：<b>在你已经把伤害打出来的那些局里，死亡高低是胜负分水岭</b>。</li>
</ul>
<h3>B. 自我评估指标从「我伤害第几」改成「我助攻多少」</h3>
<ul>
<li>依据：助攻 36+ 的中局胜率 77%；助攻差（+5.5）远大于击杀差（+1.2）；补刀几乎无关（34.3 vs 33.7）。</li>
<li>追伤害第一会让你为了数字去打「打不死人的消耗」—— 这类伤害在数据上显眼、在胜负上几乎无用。</li>
</ul>
<h3>C. 认下这几个「危险英雄」，拿到时换打法</h3>
<ul>
<li>同一英雄内「伤害第一 vs 非第一」的胜率：雪原双子 <b>0.0%</b>(6) vs 54.2%(48) · 不祥之刃 <b>14.3%</b>(7) vs 53.1%(32) · 星籁歌姬 <b>14.3%</b>(7) vs 50.0%(20) · 死亡颂唱者 <b>25.0%</b>(8) vs 58.3%(12) · 铸星龙王 <b>37.5%</b>(8) vs 60.0%(30)。</li>
<li>这些正好也是你死得最多的英雄：死亡颂唱者 13.6 死/局、刀锋舞者 13.5、不祥之刃 12.0（账号均值 9.2）。<b>杀心重的英雄你控不住死亡。</b></li>
<li>反过来，复仇之矛（第一 55.0% vs 非第一 59.0%）、狂厄蔷薇（66.7% vs 68.2%）、瘟疫之源（57.1% vs 61.5%）第一与否几乎无差，可以放心 carry。</li>
</ul>
<h3>D. 定位上可以更偏向战士/射手，慎选纯坦克与法师</h3>
<ul>
<li>坦克 43.8%（105 局，z=−1.07）、法师 47.6%（267 局，z=−0.52）是你最差的两类；战士 51.1%、射手 50.9% 最好。<b>幅度都在噪声内，不要当成铁律</b>，但方向上和「坦克要贴脸、死得多」是一致的。</li>
<li>诚实边界：<b>我不确定海斗的英雄是纯随机还是可以重随</b>。能重随才有操作空间，否则这条只能变成「拿到坦克时改打法」。</li>
</ul>
<h3>E. 队友组合（证据较弱，只当线索）</h3>
<ul>
<li>两个主力队友占了 63% 场次：下棋高手 352 局共同胜率 47%、Ybac1 279 局 46%，都低于账号基准；加藤惠99（158 局 / 55%）、AQword（48 局 / 71%）更高。</li>
<li>诚实边界：共同胜率里混着你自己的水平，且「挑队友」有选择效应；48 局的 71% 尤其不稳。</li>
</ul>
<h3>F. 装备与符文：不构成建议</h3>
<ul>
<li>装备榜里只有育恩塔尔荒野箭（116 局）、虚空之杖（160 局）这类样本够大；巫妖之祸 22 局 77.3% 这种是噪声。<b>而且优势局才出得起成装，存在明确的反向因果</b>。</li>
<li>符文是随机发的，赢局/输局出现率差全在 ±3pp 内、还叠加多重比较 —— 从这个量级里挑「好符文」挑出来的多半是噪声。</li>
</ul>
<h3>G. 不需要担心的两件事</h3>
<ul>
<li><b>连胜连败没有影响</b>：输一把后下一把 49.2%（+0.3）、连输 3 把以上后 50.0%（+1.0）、赢了之后 48.6%（−0.4），全部在整体附近。没有上头迹象。</li>
<li><b>对面阵容不用针对性改</b>：唯一 z&lt;−2 的是「对面 3 个战士」39.8%，但「对面 4 个战士」是 70.0%（z=+2.31）—— 非单调，判定为噪声。</li>
</ul>
</div>

<h2><span class="num">8</span>这份分析的局限</h2>
<div class="card">
<ul>
<li><b>全部是观察数据，不是实验。</b>「少死→赢」里混着反向因果（碾压局双方死亡都少）。我用「控制时长分层」和「同一英雄内比较」削减了它，但消除不了。</li>
<li><b>单一账号的单人视角。</b>CSV 每行只有你自己，没有队友数据，「队友太弱」这类解释无法直接检验。</li>
<li><b>聚类是在 29 个英雄上做的</b>，样本小、对初始化敏感，簇的边界不稳定；它更适合当「英雄画像」，不要当分类学。</li>
<li><b>装备/符文的胜率榜有多重比较问题</b>：我从 45 件装备、68 个符文里挑极端值，光靠噪声就能造出很大的差距。</li>
<li><b>一处显示异常（不影响本报告）</b>：MCP 的贡献度工具在传 <code>who=自己的丁ding</code> 时返回标题写成了「今人不见古时月」。我用逐英雄场次核对（卡莉丝塔 59/34、努努 54/26、俄洛伊 41/22、卡特 39/18、悠米 38/19）与导出 CSV 完全一致，确认数据属于丁ding —— 是那个工具自己的标题渲染错了。</li>
<li><b>数据截止 2026-09-19</b>，来自本地归档（客户端当时未运行）。9 月只有 54 局。</li>
</ul>
</div>

<details>
<summary>📋 逐局明细 · 1001 局（点击展开）<span class="chev">▶</span></summary>
<div class="body">
<p class="note">全部可排序、可筛选。点表头下方的下拉排序，输入框可搜英雄/符文/装备。</p>
<div class="ctl">
  <input id="q" placeholder="搜英雄 / 符文 / 装备…">
  <select id="fres"><option value="">全部结果</option><option value="胜">只看赢</option><option value="负">只看输</option></select>
  <select id="fsort">
    <option value="0">按日期（新→旧）</option>
    <option value="6">按伤害（高→低）</option>
    <option value="5">按死亡（高→低）</option>
    <option value="4">按击杀（高→低）</option>
    <option value="11">按队内伤害名次</option>
  </select>
</div>
<div style="overflow-x:auto"><table id="gt"><thead></thead><tbody></tbody></table></div>
<p class="note" id="gcount"></p>
</div>
</details>

<footer>
数据源：本地归档海斗对局 1001 局（2025-11-16 ~ 2026-09-19）· 英雄定位标签来自 Riot Data Dragon · 装备/符文元数据来自项目 data/ 目录<br>
本报告所有统计由 CSV 逐局重算，未使用任何二手结论。z 值 = 与账号整体胜率的差 ÷ 标准误。
</footer>
</div>
<div id="tip"></div>

<script>
const D = __DATA__;
const P0 = D.meta.p0;
const $ = s => document.querySelector(s);
const fmt = (v,d=1) => v===null||v===undefined||v==='' ? '—' : Number(v).toFixed(d);
const clamp = (v,a,b) => Math.max(a, Math.min(b,v));

$('#head').textContent = D.meta.account+' · '+D.meta.first+' ~ '+D.meta.last+' · '+D.meta.n+' 局海斗';
$('#h-p').textContent = fmt(P0)+'%';
$('#h-n').textContent = D.meta.n;
$('#h-se').textContent = '±'+fmt(D.meta.se)+'pp';
$('#h-d').textContent = fmt(D.games.reduce((s,g)=>s+g[4],0)/D.games.length,1);
$('#h-note').innerHTML = '全报告共 '+D.meta.n+' 局：'+D.meta.wins+' 胜 / '+(D.meta.n-D.meta.wins)+' 负。';

$('#datawarn').innerHTML = '<b>先读这条：</b>本报告的所有「因为」都是<b>相关性</b>，不是因果。海斗随机发牌、队友随机，没有对照组。我用两种办法削弱虚假相关：① 按时长分层（排除「局短所以死得少」）② 同一英雄内比较（控制英雄差异）。每张图都带了样本量 n 与 z 值，<b>|z|≥2 才勉强算超出噪声</b>，而这是对单一假设的判断 —— 我从几十个维度里挑出这些，多重比较本身就会造出假阳性。请把结论当「值得去试的假设」，不要当定论。';

/* ---------- 基础 SVG ---------- */
const tip = $('#tip');
function bindTip(el, html){
  el.addEventListener('mousemove', e=>{
    tip.innerHTML = html; tip.style.opacity = 1;
    const w = tip.offsetWidth, hh = tip.offsetHeight;
    let x = e.clientX+14, y = e.clientY+14;
    if (x+w > innerWidth-8) x = e.clientX-w-14;
    if (y+hh > innerHeight-8) y = e.clientY-hh-14;
    tip.style.left = x+'px'; tip.style.top = y+'px';
  });
  el.addEventListener('mouseleave', ()=> tip.style.opacity = 0);
}
let UID = 0;
function svgEl(w,h){
  const s = document.createElementNS('http://www.w3.org/2000/svg','svg');
  s.setAttribute('viewBox','0 0 '+w+' '+h);
  s.setAttribute('class','chart');
  s._uid = 'g'+(++UID);
  const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
  s.appendChild(defs);
  s._defs = defs;
  return s;
}
function grad(svg, id, cssVar, o2){
  const g = document.createElementNS('http://www.w3.org/2000/svg','linearGradient');
  g.setAttribute('id', svg._uid+'-'+id);
  g.setAttribute('x1','0'); g.setAttribute('y1','0');
  g.setAttribute('x2','0'); g.setAttribute('y2','1');
  [[0,1],[100,o2===undefined?0.68:o2]].forEach(([off,op])=>{
    const st = document.createElementNS('http://www.w3.org/2000/svg','stop');
    st.setAttribute('offset', off+'%');
    st.setAttribute('style','stop-color:'+cssVar+';stop-opacity:'+op);
    g.appendChild(st);
  });
  svg._defs.appendChild(g);
  return 'url(#'+svg._uid+'-'+id+')';
}
function mk(svg,tag,attrs){
  const e = document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const k in attrs) e.setAttribute(k, attrs[k]);
  svg.appendChild(e); return e;
}
function txt(svg,x,y,s,attrs){
  const a = Object.assign({x:x,y:y,'font-size':12,fill:'var(--ink2)','font-family':'inherit'}, attrs||{});
  const e = mk(svg,'text',a); e.textContent = s; return e;
}
function varColor(v){ return v>=0 ? 'var(--up)' : 'var(--down)'; }

/* ================= 新图表类型 ================= */

/* ---- 哑铃图：两个值的对比 ---- */
function dumbbell(host, rows, o){
  const rowH=46, top=42, W=900, lab=o.lab||130, padR=o.padR||178;
  const x0=lab, x1=W-padR, H=top+rows.length*rowH+16;
  const s = svgEl(W,H);
  txt(s, x0, 20, o.aLabel||'赢局', {'font-size':12,fill:'var(--muted)'});
  txt(s, x0+86, 20, o.bLabel||'输局', {'font-size':12,fill:'var(--muted)'});
  txt(s, x1+14, 20, o.diffLabel||'差值', {'font-size':12,fill:'var(--muted)'});
  rows.forEach((r,i)=>{
    const y = top+i*rowH;
    const mn = Math.min(r.a,r.b), mx = Math.max(r.a,r.b);
    const span = (mx-mn)||1;
    const lo = mn - span*0.45, hi = mx + span*0.45;
    const px = v => x0 + (v-lo)/(hi-lo)*(x1-x0);
    txt(s, 0, y+21, r.label, {'font-size':13,fill:'var(--ink)'});
    mk(s,'line',{x1:x0,y1:y+16,x2:x1,y2:y+16,stroke:'var(--grid)','stroke-width':1});
    const ax = px(r.a), bx = px(r.b);
    const ln = mk(s,'line',{x1:Math.min(ax,bx),y1:y+16,x2:Math.max(ax,bx),y2:y+16,
      stroke:'var(--axis)','stroke-width':2.5,'stroke-linecap':'round'});
    const ca = mk(s,'circle',{cx:ax,cy:y+16,r:7,fill:'var(--s1)',stroke:'var(--surf)','stroke-width':2});
    const cb = mk(s,'circle',{cx:bx,cy:y+16,r:7,fill:'var(--s2)',stroke:'var(--surf)','stroke-width':2});
    const leftIsA = ax <= bx;
    txt(s, Math.min(ax,bx)-10, y+21, fmt(leftIsA?r.a:r.b, r.dec),
        {'font-size':12,fill:leftIsA?'var(--s1)':'var(--s2)','text-anchor':'end','font-weight':650});
    txt(s, Math.max(ax,bx)+10, y+21, fmt(leftIsA?r.b:r.a, r.dec),
        {'font-size':12,fill:leftIsA?'var(--s2)':'var(--s1)','text-anchor':'start','font-weight':650});
    const rel = (r.rel>0?'+':'')+fmt(r.rel)+'%';
    txt(s, x1+16, y+22, rel, {'font-size':14,fill:varColor(r.rel),'font-weight':680,'font-variant-numeric':'tabular-nums'});
    const th = r.label+'<br>赢局 '+r.a+'　输局 '+r.b+'<br>差 '+r.diff+'（'+rel+'）';
    bindTip(ca, th); bindTip(cb, th); bindTip(ln, th);
  });
  txt(s, x0, H-2, o.note||'每行按自己的取值范围独立缩放，只能看「两点离多远」，不能跨行比长度。',
      {'font-size':11.5,fill:'var(--muted)'});
  host.appendChild(s);
  const lg=document.createElement('div'); lg.className='legend';
  lg.innerHTML='<span><i style="background:var(--s1)"></i>'+(o.aLabel||'赢局')+'</span><span><i style="background:var(--s2)"></i>'+(o.bLabel||'输局')+'</span>';
  host.appendChild(lg);
}

/* ---- 棒棒糖图：排名 ---- */
function lollipop(host, items, o){
  const rowH=o.rowH||30, top=o.top||38, W=900, lab=o.lab||150, padR=o.padR||60;
  const x0=lab, x1=W-padR;
  const s = svgEl(W,H= top+items.length*rowH+30);
  const mx = Math.max(...items.map(d=>Math.abs(d.diff)),1);
  const VW=o.VW||200;
  const S=Math.max(60,(x1-x0-2*VW)/2), scale=S/mx, cx=x0+VW+S;
  mk(s,'line',{x1:cx,y1:top-12,x2:cx,y2:top+items.length*rowH-8,stroke:'var(--axis)','stroke-width':1.5});
  txt(s, cx, 16, '基准 '+fmt(P0)+'%', {'font-size':11.5,fill:'var(--muted)','text-anchor':'middle'});
  items.forEach((d,i)=>{
    const y=top+i*rowH, w=Math.abs(d.diff)*scale;
    const ex = d.diff>=0 ? cx+w : cx-w;
    mk(s,'line',{x1:cx,y1:y,x2:ex,y2:y,stroke:d.diff>=0?'var(--up)':'var(--down)','stroke-width':2.5,'stroke-linecap':'round'});
    const c = mk(s,'circle',{cx:ex,cy:y,r:6,fill:d.diff>=0?'var(--up)':'var(--down)',stroke:'var(--surf)','stroke-width':2});
    txt(s, 0, y+5, d.label, {'font-size':12.5,fill:'var(--ink)'});
    const anchor = d.diff>=0?'start':'end';
    const tx = d.diff>=0 ? cx+w+11 : cx-w-11;
    txt(s, tx, y+1, (d.diff>0?'+':'')+fmt(d.diff)+'pp', {'font-size':12,fill:'var(--ink)','font-weight':650,'text-anchor':anchor});
    txt(s, tx, y+14, d.sub || (fmt(d.p)+'% · '+d.n+'局'), {'font-size':10.5,fill:'var(--muted)','text-anchor':anchor});
    bindTip(c, d.tip || (d.label+'<br>'+fmt(d.p)+'% · '+d.n+' 局<br>相对基准 '+((d.diff)>0?'+':'')+fmt(d.diff)+'pp'));
  });
  if(o.title) txt(s, 0, 16, o.title, {'font-size':12,fill:'var(--muted)'});
  txt(s, x0, H-6, '← 低于基准（红）', {'font-size':11.5,fill:'var(--muted)'});
  txt(s, x1, H-6, '高于基准（蓝）→', {'font-size':11.5,fill:'var(--muted)','text-anchor':'end'});
  host.appendChild(s);
}

/* ---- 坡度图：跨档位的变化 ---- */
function slope(host, items, o){
  const W=900,H=o.H||340,x0=90,x1=820,y0=54,yb=o.yb||262;
  const s = svgEl(W,H);
  [0,25,50,75,100].forEach(v=>{
    const y=yb-v/100*(yb-y0);
    mk(s,'line',{x1:x0,y1:y,x2:x1,y2:y,stroke:'var(--grid)','stroke-width':1});
    txt(s, x0-9, y+4, v+'%', {'font-size':11,fill:'var(--muted)','text-anchor':'end'});
  });
  const yB=yb-P0/100*(yb-y0);
  mk(s,'line',{x1:x0,y1:yB,x2:x1,y2:yB,stroke:'var(--axis)','stroke-width':2,'stroke-dasharray':'6 4'});
  txt(s, x1+8, yB+4, '基准 '+fmt(P0)+'%', {'font-size':11.5,fill:'var(--ink2)'});
  const step=(x1-x0)/(items.length-1);
  let path='';
  items.forEach((d,i)=>{
    const x=x0+step*i, y=yb-d.p/100*(yb-y0);
    path += (i?' L':'M')+x+' '+y;
  });
  mk(s,'path',{d:path,fill:'none',stroke:'var(--s1)','stroke-width':3,'stroke-linejoin':'round'});
  items.forEach((d,i)=>{
    const x=x0+step*i, y=yb-d.p/100*(yb-y0);
    const c=mk(s,'circle',{cx:x,cy:y,r:7,fill: y>=yB?'var(--up)':'var(--down)',stroke:'var(--surf)','stroke-width':2.5});
    const first = i===0, lastP = i===items.length-1;
    txt(s, first?x+9:(lastP?x-9:x), y-16, fmt(d.p)+'%',
        {'font-size':14,fill:'var(--ink)','font-weight':680,
         'text-anchor': first?'start':(lastP?'end':'middle')});
    txt(s, x, yb+20, d.label, {'font-size':12.5,fill:'var(--ink)','text-anchor':'middle'});
    txt(s, x, yb+36, d.n+' 局', {'font-size':11,fill:'var(--muted)','text-anchor':'middle'});
    bindTip(c, d.label+'<br>'+d.n+' 局 · 胜率 '+fmt(d.p)+'%<br>相对基准 '+((d.p-P0)>0?'+':'')+fmt(d.p-P0)+'pp');
  });
  txt(s, x0, 18, o.title||'', {'font-size':12,fill:'var(--muted)'});
  host.appendChild(s);
}

/* ---- 热力图：二维交叉 ---- */
function heatmap(host, spec){
  const {rows, cols, cells, title} = spec;
  const cellW=spec.cellW||110, cellH=spec.cellH||54, labW=spec.labW||140, top=56;
  const W=labW+cols.length*cellW+20, H=top+rows.length*cellH+30;
  const s = svgEl(W,H);
  const mx = Math.max(...cells.map(c=>Math.abs(c.d - P0)), 1);
  cols.forEach((c,j)=>{
    txt(s, labW+j*cellW+cellW/2, top-24, c, {'font-size':12,fill:'var(--ink)','text-anchor':'middle'});
  });
  rows.forEach((r,i)=>{
    txt(s, labW-12, top+i*cellH+cellH/2+4, r, {'font-size':12.5,fill:'var(--ink)','text-anchor':'end'});
    cols.forEach((c,j)=>{
      const cell = cells[i*cols.length+j];
      const x=labW+j*cellW, y=top+i*cellH;
      if(!cell || cell.n===0){
        mk(s,'rect',{x:x,y:y,width:cellW-3,height:cellH-3,rx:7,fill:'var(--grid)','fill-opacity':0.3});
        txt(s, x+cellW/2-1, y+cellH/2+1, '—', {'font-size':13,fill:'var(--muted)','text-anchor':'middle'});
        return;
      }
      const t = clamp(Math.abs(cell.d-P0)/mx, 0, 1);
      const strong = Math.abs(cell.d-P0) >= mx*0.14;
      const rect = mk(s,'rect',{x:x,y:y,width:cellW-3,height:cellH-3,rx:7,
        fill: strong ? (cell.d>P0?'var(--up)':'var(--down)') : 'var(--grid)',
        'fill-opacity': strong ? (0.28+0.72*t) : 0.5});
      const lightOnDark = strong && (0.28+0.72*t) > 0.62;
      txt(s, x+cellW/2-1, y+cellH/2-2, fmt(cell.p)+'%',
          {'font-size':15,fill: lightOnDark?'#fff':'var(--ink)','text-anchor':'middle','font-weight':680});
      txt(s, x+cellW/2-1, y+cellH/2+14, cell.n+' 局'+(cell.n<25?'*':''),
          {'font-size':11,fill: lightOnDark?'rgba(255,255,255,.85)':'var(--muted)','text-anchor':'middle'});
      bindTip(rect, r+' × '+c+'<br>'+cell.n+' 局 · 胜率 '+fmt(cell.p)+'%<br>相对基准 '+((cell.d-P0)>0?'+':'')+fmt(cell.d-P0)+'pp');
    });
  });
  txt(s, 0, 16, title||'', {'font-size':12,fill:'var(--muted)'});
  txt(s, 0, H-6, '颜色越深 = 偏离基准越远（蓝=高、红=低）；数字是实际胜率，带 * 的格子样本 <25 局，只作参考。', {'font-size':11.5,fill:'var(--muted)'});
  host.appendChild(s);
}

/* ---- 子弹图：值 vs 基准 ---- */
function bullet(host, rows, o){
  const rowH=44, top=36, W=900, lab=o.lab||130, padR=o.padR||190;
  const x0=lab, x1=W-padR, H=top+rows.length*rowH+28;
  const s = svgEl(W,H);
  const ymax = o.ymax || 100;
  const px = v => x0 + v/ymax*(x1-x0);
  for(let k=0;k<=4;k++){
    const v = ymax*k/4, x = px(v);
    mk(s,'line',{x1:x,y1:top-8,x2:x,y2:top+rows.length*rowH-8,stroke:'var(--grid)','stroke-width':1});
    txt(s, x, top-14, fmt(v,0)+'%', {'font-size':11,fill:'var(--muted)','text-anchor':'middle'});
  }
  const bx = px(o.base!==undefined?o.base:P0);
  mk(s,'line',{x1:bx,y1:top-8,x2:bx,y2:top+rows.length*rowH-8,stroke:'var(--axis)','stroke-width':2,'stroke-dasharray':'5 4'});
  rows.forEach((r,i)=>{
    const y=top+i*rowH;
    txt(s, 0, y+22, r.label, {'font-size':13,fill:'var(--ink)'});
    mk(s,'rect',{x:x0,y:y+8,width:x1-x0,height:20,rx:6,fill:'var(--grid)','fill-opacity':0.35});
    const w = Math.max(3, r.v/ymax*(x1-x0));
    const b = mk(s,'rect',{x:x0,y:y+8,width:w,height:20,rx:6,
      fill: r.v >= (o.base!==undefined?o.base:P0) ? 'var(--up)' : 'var(--down)','fill-opacity':0.85});
    txt(s, x0+w+9, y+23, fmt(r.v,o.dec===undefined?1:o.dec)+(o.unit||''),
        {'font-size':14,fill:'var(--ink)','font-weight':680});
    txt(s, x1+12, y+16, r.right||'', {'font-size':11.5,fill:'var(--ink2)'});
    txt(s, x1+12, y+30, r.right2||'', {'font-size':10.5,fill:'var(--muted)'});
    bindTip(b, r.tip || (r.label+'：'+r.v));
  });
  if(o.title) txt(s, 0, 14, o.title, {'font-size':12,fill:'var(--muted)'});
  host.appendChild(s);
}

/* ---------- 图 2.1 指标对比（哑铃图） ---------- */
dumbbell($('#c-metrics'), D.metrics.map(r=>({
  label:r.label, a:r.win, b:r.los, dec:r.dec, diff:r.diff, rel:r.rel})),
  {aLabel:'赢局', bLabel:'输局', diffLabel:'赢 − 输', lab:128});

/* ---------- 通用：竖条 ---------- */
function bars(host, rows, opt){
  const o = opt||{};
  const W=900,H=o.H||300,x0=60,x1=o.x1||840,y0=46,yb=o.yb||232;
  const s = svgEl(W,H);
  const gUp = grad(s,'up','var(--up)',0.72), gDn = grad(s,'dn','var(--down)',0.72);
  const step=(x1-x0)/rows.length, bw=Math.min(o.maxBw||96, step*0.55);
  [0,25,50,75,100].forEach(v=>{
    const y = yb - v/100*(yb-y0);
    mk(s,'line',{x1:x0,y1:y,x2:x1,y2:y,stroke:'var(--grid)','stroke-width':1});
    txt(s, x0-8, y+4, v+'%', {'font-size':11,fill:'var(--muted)','text-anchor':'end'});
  });
  const yB = yb - P0/100*(yb-y0);
  mk(s,'line',{x1:x0,y1:yB,x2:x1,y2:yB,stroke:'var(--axis)','stroke-width':2,'stroke-dasharray':'6 4'});
  txt(s, W-8, yB-6, '基准 '+fmt(P0)+'%', {'font-size':11.5,fill:'var(--ink2)','text-anchor':'end'});
  rows.forEach((r,i)=>{
    const cx = x0+step*i+step/2, h = r.p/100*(yb-y0), y = yb-h;
    const b = mk(s,'rect',{x:cx-bw/2,y:y,width:bw,height:Math.max(3,h),rx:5,
      fill: r.p>=P0?gUp:gDn});
    txt(s, cx, y-9, fmt(r.p)+'%', {'font-size':14,fill:'var(--ink)','text-anchor':'middle','font-weight':680});
    txt(s, cx, yb+21, r.label, {'font-size':12.5,fill:'var(--ink)','text-anchor':'middle'});
    if(r.n!==undefined) txt(s, cx, yb+37, r.n+' 局', {'font-size':11.5,fill:'var(--muted)','text-anchor':'middle'});
    if(r.sub) txt(s, cx, yb+53, r.sub, {'font-size':11,fill:'var(--muted)','text-anchor':'middle'});
    if(r.z!==undefined) txt(s, cx, yb+69, 'z='+(r.z>0?'+':'')+fmt(r.z,2), {'font-size':11.5,
      'text-anchor':'middle', fill: Math.abs(r.z)>=2?'var(--down)':'var(--muted)'});
    bindTip(b, r.tip || (r.label+'<br>'+r.n+' 局 · 胜率 '+fmt(r.p)+'%<br>相对基准 '+((r.p-P0)>0?'+':'')+fmt(r.p-P0)+'pp'));
  });
  txt(s, x0, 16, o.title||'', {'font-size':12,fill:'var(--muted)'});
  host.appendChild(s);
}
bars($('#c-death'), D.death, {title:'横轴：每局死亡次数　纵轴：胜率'});
bars($('#c-firstdeath'), D.firstDeath.map(r=>({label:r.label,n:r.n,p:r.p,z:r.z,
  sub:'均 '+r.dmg+'k / '+r.dur+'分',
  tip:'伤害队内第一 & '+r.label+'<br>'+r.n+' 局 · 胜率 '+fmt(r.p)+'%<br>z='+fmt(r.z,2)+'<br>该组场均伤害 '+r.dmg+'k · 场均时长 '+r.dur+' 分'})),
  {title:'只看「伤害队内第一」的 128 局，再按死亡拆', maxBw:90});

/* ---------- 通用：分组竖条 ---------- */
function groupedBars(host, spec){
  const {cats, series, title, cnt} = spec;
  const W=900,H=330,x0=60,x1=860,y0=46,yb=240;
  const s = svgEl(W,H);
  const colors = ['var(--s1)','var(--s2)','var(--s3)','var(--s4)'];
  const grads = colors.map((c,i)=>grad(s,'c'+i,c,0.72));
  [0,25,50,75,100].forEach(v=>{
    const y = yb - v/100*(yb-y0);
    mk(s,'line',{x1:x0,y1:y,x2:x1,y2:y,stroke:'var(--grid)','stroke-width':1});
    txt(s, x0-8, y+4, v+'%', {'font-size':11,fill:'var(--muted)','text-anchor':'end'});
  });
  const yB = yb - P0/100*(yb-y0);
  mk(s,'line',{x1:x0,y1:yB,x2:x1,y2:yB,stroke:'var(--axis)','stroke-width':2,'stroke-dasharray':'6 4'});
  txt(s, W-8, yB-6, '基准 '+fmt(P0)+'%', {'font-size':11.5,fill:'var(--ink2)','text-anchor':'end'});
  const step=(x1-x0)/cats.length, ns=series.length, bw=Math.min(58, step*0.7/ns);
  cats.forEach((c,ci)=>{
    const cx = x0+step*ci+step/2;
    series.forEach((se,si)=>{
      const v = se.vals[ci].p, nv = se.vals[ci].n, thin = nv<25;
      const h = v/100*(yb-y0), bx = cx-(ns*bw)/2+si*bw+1;
      const b = mk(s,'rect',{x:bx,y:yb-h,width:bw-2,height:Math.max(3,h),rx:5,
        fill:grads[si], 'fill-opacity': thin?0.42:1});
      txt(s, bx+bw/2-1, yb-h-8, fmt(v)+'%'+(thin?'*':''), {'font-size':12,fill:'var(--ink)','text-anchor':'middle','font-weight':650});
      bindTip(b, c+'<br>'+se.name+'<br>'+nv+' 局 · 胜率 '+fmt(v)+'%<br>相对基准 '+((v-P0)>0?'+':'')+fmt(v-P0)+'pp'+(thin?'<br><b>只有 '+nv+' 局，样本太少</b>':''));
    });
    txt(s, cx, yb+21, c, {'font-size':12.5,fill:'var(--ink)','text-anchor':'middle'});
    if(cnt && cnt[ci]!==undefined) txt(s, cx, yb+37, cnt[ci]+' 局', {'font-size':11.5,fill:'var(--muted)','text-anchor':'middle'});
  });
  txt(s, x0, 16, title, {'font-size':12,fill:'var(--muted)'});
  host.appendChild(s);
  const lg=document.createElement('div'); lg.className='legend';
  lg.innerHTML = series.map((se,i)=>'<span><i style="background:'+colors[i]+'"></i>'+se.name+'</span>').join('');
  host.appendChild(lg);
}
/* 把「时长层 × 档位」的分组数据转成热力图格子（行优先） */
function xCells(spec){
  const out=[];
  for(let i=0;i<spec.cats.length;i++)
    for(let j=0;j<spec.series.length;j++){
      const v = spec.series[j].vals[i];
      out.push({p:v.p, n:v.n, d:v.p});
    }
  return out;
}
heatmap($('#c-deathdur'), {
  rows: D.deathDur.cats, cols: D.deathDur.series.map(s=>s.name),
  cells: xCells(D.deathDur), cellW: 320, cellH: 64, labW: 150,
  title:'行＝对局时长　列＝每局死亡次数　格子里的数字是该格的胜率'});
heatmap($('#c-assistdur'), {
  rows: D.assistDur.cats, cols: D.assistDur.series.map(s=>s.name),
  cells: xCells(D.assistDur), cellW: 180, cellH: 64, labW: 150,
  title:'行＝对局时长　列＝每局助攻次数　格子里的数字是该格的胜率'});

/* ---------- 通用：发散横条 ---------- */
function diverging(host, items, opts){
  const {title, W=900, lab=124, padR=16, VW=150} = opts||{};
  const rowH=42, top=40, x0=lab, x1=W-padR;
  const mx = Math.max(...items.map(d=>Math.abs(d.diff))) || 1;
  const S = Math.max(60,(x1-x0-2*VW)/2), scale = S/mx;
  const cx = x0+VW+S, H = top+items.length*rowH+30;
  const s = svgEl(W,H);
  const gUp = grad(s,'up','var(--up)',0.72), gDn = grad(s,'dn','var(--down)',0.72);
  mk(s,'line',{x1:cx,y1:top-12,x2:cx,y2:top+items.length*rowH-12,stroke:'var(--axis)','stroke-width':1.5});
  txt(s, cx, 15, '基准 '+fmt(P0)+'%', {'font-size':11.5,fill:'var(--muted)','text-anchor':'middle'});
  items.forEach((d,i)=>{
    const y = top+i*rowH;
    txt(s, 0, y+20, d.label, {'font-size':13,fill:'var(--ink)'});
    const w = Math.max(2, Math.abs(d.diff)*scale);
    const bx = d.diff>=0 ? cx : cx-w;
    const b = mk(s,'rect',{x:bx,y:y+8,width:w,height:16,rx:5,fill: d.diff>=0?gUp:gDn});
    const tx = d.diff>=0 ? cx+w+9 : cx-w-9, anchor = d.diff>=0?'start':'end';
    txt(s, tx, y+17, (d.diff>0?'+':'')+fmt(d.diff)+'pp', {'font-size':12.5,fill:'var(--ink)','text-anchor':anchor,'font-weight':650});
    txt(s, tx, y+31, d.sub2 || (fmt(d.p)+'% · '+d.n+'局 · z='+(d.z>0?'+':'')+fmt(d.z,2)),
        {'font-size':11,fill:'var(--muted)','text-anchor':anchor});
    bindTip(b, d.tip || (d.label+'<br>胜率 '+fmt(d.p)+'% · '+d.n+' 局<br>相对基准 '+((d.diff)>0?'+':'')+fmt(d.diff)+'pp<br>z='+fmt(d.z,2)));
  });
  txt(s, x0, H-6, '← 低于基准（红）', {'font-size':11.5,fill:'var(--muted)'});
  txt(s, x1, H-6, '高于基准（蓝）→', {'font-size':11.5,fill:'var(--muted)','text-anchor':'end'});
  if(title) txt(s, 0, 15, title, {'font-size':12,fill:'var(--muted)'});
  host.appendChild(s);
}
slope($('#c-rank'), D.rank.map(d=>({label:d.label,p:d.p,n:d.n})),
  {title:'伤害队内名次 → 胜率：名次越靠前，胜率越低'});
lollipop($('#c-firsthero'), D.firstHero.map(d=>({label:d.h,diff:d.gap,p:d.pa,n:d.na,
  sub: fmt(d.pa)+'% ('+d.na+') vs '+fmt(d.pb)+'% ('+d.nb+')',
  tip:d.h+'<br>伤害第一：'+fmt(d.pa)+'%（'+d.na+' 局）<br>非第一：'+fmt(d.pb)+'%（'+d.nb+' 局）<br>差 '+((d.gap)>0?'+':'')+fmt(d.gap)+'pp'})),
  {lab:104, rowH:33, VW:230, title:'同一英雄内：伤害第一 vs 未拿第一的胜率差'});
lollipop($('#c-heroes'), D.heroes.map(d=>({label:d.h,diff:d.diff,p:d.p,n:d.n,
  sub: d.n+'局 · 均'+d.dmg+'k/承'+d.tank+'k/死'+d.d,
  tip:d.h+'（'+d.cnRole+'）<br>胜率 '+fmt(d.p)+'% · '+d.n+' 局<br>相对基准 '+((d.diff)>0?'+':'')+fmt(d.diff)+'pp · z='+fmt(d.z,2)+'<br>场均伤害 '+d.dmg+'k · 承伤 '+d.tank+'k · 死亡 '+d.d})),
  {lab:104, rowH:31, VW:215, title:'英雄胜率相对基准（≥15 局，按局数排序）'});

/* ---------- 图 2.8 月度 ---------- */
(function(){
  const host = $('#c-months');
  const ms = D.months;
  const W=900,H=300,x0=64,x1=860,y0=46,yb=228;
  const s = svgEl(W,H);
  const gA = grad(s,'ar','var(--s1)',0.06);
  [0,25,50,75,100].forEach(v=>{
    const y = yb - v/100*(yb-y0);
    mk(s,'line',{x1:x0,y1:y,x2:x1,y2:y,stroke:'var(--grid)','stroke-width':1});
    txt(s, x0-8, y+4, v+'%', {'font-size':11,fill:'var(--muted)','text-anchor':'end'});
  });
  const yB = yb - P0/100*(yb-y0);
  mk(s,'line',{x1:x0,y1:yB,x2:x1,y2:yB,stroke:'var(--axis)','stroke-width':2,'stroke-dasharray':'6 4'});
  txt(s, W-8, yB-6, '基准 '+fmt(P0)+'%', {'font-size':11.5,fill:'var(--ink2)','text-anchor':'end'});
  const step = ms.length>1 ? (x1-x0)/(ms.length-1) : 0;
  let line='', area='';
  ms.forEach((d,i)=>{
    const x = x0+step*i, y = yb - d.p/100*(yb-y0);
    line += (i?' L':'M')+x+' '+y;
    area += (i?' L':'M')+x+' '+y;
  });
  area += ' L'+x1+' '+yb+' L'+x0+' '+yb+' Z';
  mk(s,'path',{d:area,fill:gA,stroke:'none'});
  mk(s,'path',{d:line,fill:'none',stroke:'var(--s1)','stroke-width':2.4,'stroke-linejoin':'round'});
  ms.forEach((d,i)=>{
    const x = x0+step*i, y = yb - d.p/100*(yb-y0);
    const c = mk(s,'circle',{cx:x,cy:y,r:5,fill:'var(--s1)',stroke:'var(--surf)','stroke-width':2});
    bindTip(c, d.m+'<br>'+d.n+' 局 · 胜率 '+fmt(d.p)+'%<br>场均伤害 '+d.dmg+'k · 场均死亡 '+d.d);
    txt(s, x, yb+19, d.m.slice(2), {'font-size':11,fill:'var(--muted)','text-anchor':'middle'});
  });
  txt(s, x0, 16, '横轴：月份　纵轴：该月胜率', {'font-size':12,fill:'var(--muted)'});
  host.appendChild(s);
  const lg=document.createElement('div'); lg.className='legend';
  lg.innerHTML = ms.map(d=>'<span>'+d.m.slice(2)+': '+fmt(d.p)+'% ('+d.n+')</span>').join('');
  host.appendChild(lg);
})();

/* ---------- 通用：任意数值竖条（带基准线） ---------- */
function numBars(host, rows, o){
  const W=900,H=o.H||320,x0=60,x1=860,y0=46,yb=238;
  const s = svgEl(W,H);
  const ymax = o.ymax;
  const step=(x1-x0)/rows.length, bw=Math.min(100, step*0.5);
  const nT = o.ticks || 4;
  for(let k=0;k<=nT;k++){
    const v = ymax*k/nT;
    const y = yb - v/ymax*(yb-y0);
    mk(s,'line',{x1:x0,y1:y,x2:x1,y2:y,stroke:'var(--grid)','stroke-width':1});
    txt(s, x0-8, y+4, fmt(v, o.dec===undefined?1:o.dec), {'font-size':11,fill:'var(--muted)','text-anchor':'end'});
  }
  if(o.base!==undefined){
    const yB = yb - o.base/ymax*(yb-y0);
    mk(s,'line',{x1:x0,y1:yB,x2:x1,y2:yB,stroke:'var(--axis)','stroke-width':2,'stroke-dasharray':'6 4'});
    txt(s, W-8, yB-6, o.baseLabel||'', {'font-size':11.5,fill:'var(--ink2)','text-anchor':'end'});
  }
  rows.forEach((r,i)=>{
    const cx = x0+step*i+step/2, h = r.v/ymax*(yb-y0), y = yb-h;
    const over = (o.base===undefined) || r.v > o.base;
    const b = mk(s,'rect',{x:cx-bw/2,y:y,width:bw,height:Math.max(3,h),rx:5,
      fill:grad(s,'nb'+i, over?'var(--s1)':'var(--down)',0.7)});
    txt(s, cx, y-9, fmt(r.v,o.dec===undefined?1:o.dec)+(o.unit||''), {'font-size':14,fill:'var(--ink)','text-anchor':'middle','font-weight':680});
    txt(s, cx, yb+21, r.label, {'font-size':12.5,fill:'var(--ink)','text-anchor':'middle'});
    if(r.n!==undefined) txt(s, cx, yb+37, r.n+' 局', {'font-size':11.5,fill:'var(--muted)','text-anchor':'middle'});
    bindTip(b, r.tip || (r.label+'：'+r.v));
  });
  txt(s, x0, 16, o.title||'', {'font-size':12,fill:'var(--muted)'});
  host.appendChild(s);
}

/* ---------- 图 3.1 定位：胜率 + 场均死亡 ---------- */
const OVERALL_D = D.games.reduce((a,g)=>a+g[4],0)/D.games.length;
bullet($('#c-roles'), D.roles.map(d=>({label:d.cn, v:d.p, dec:1, unit:'%',
  right:'场均死 '+d.d+' · z='+(d.z>0?'+':'')+fmt(d.z,2),
  right2:d.nh+' 个英雄 · '+d.n+' 局',
  tip:d.cn+'（主定位）<br>'+d.n+' 局 · 胜率 '+fmt(d.p)+'%<br>相对基准 '+((d.diff)>0?'+':'')+fmt(d.diff)+'pp · z='+fmt(d.z,2)+'<br>场均伤害 '+d.dmg+'k · 承伤 '+d.tank+'k · 死亡 '+d.d+'<br>英雄：'+d.heroes.join('、')})),
  {title:'各定位胜率 vs 账号基准（虚线）', base:P0, ymax:60, lab:110, padR:250});
$('#roles-note').innerHTML = '每个英雄只取<b>第一个</b>官方定位，所以各类之间不重叠、样本可以直接比。' +
  '差距最大的「战士 51.1%」与「坦克 43.8%」相差 7.3pp，但 105 局的坦克自身噪声就有 ±4.9pp，z=−1.07 —— <b>方向上一致、统计上还站不住</b>。';

numBars($('#c-rolesDeath'), D.roles.map(d=>({label:d.cn,v:d.d,n:d.n,
  tip:d.cn+'（主定位）<br>场均死亡 '+d.d+' 次 · '+d.n+' 局<br>账号整体 '+fmt(OVERALL_D)+' 次<br>场均伤害 '+d.dmg+'k'})),
  {title:'同一分组，换成「场均死亡」—— 死亡高 ≠ 胜率低', ymax:12, base:OVERALL_D,
   baseLabel:'账号均值 '+fmt(OVERALL_D), dec:1, unit:' 死'});
$('#rolesDeath-note').innerHTML = '<b>这两张图对不上，而且这个「对不上」本身就是结论：</b>战士场均死 10.7 次（最高）却是胜率最高的 51.1%；'
  + '坦克死 10.5 次、胜率垫底 43.8%；辅助只死 6.8 次，胜率 49.2% 也只是中游。'
  + '<b>所以「死亡」与「胜率」在定位层面并不单调。</b>这不矛盾 —— 战士要贴身缠斗、坦克要开团吃伤害，它们的「正常死亡率」天生就高。'
  + '结合第 2 章可以得到一个更准确的版本：<b>死亡是「同一个人、同一批英雄内部」的胜负信号，不能跨英雄类型直接比。</b>'
  + '所以第 7 章的建议是「在你玩的每个英雄内部压低死亡」，而不是「去选死亡率低的英雄」。';

lollipop($('#c-rolesMulti'), D.rolesMulti.map(d=>({label:d.cn,diff:d.p-P0,p:d.p,n:d.n,
  sub:d.n+' 局次 · z='+(d.z>0?'+':'')+fmt(d.z,2),
  tip:d.cn+'（多标签）<br>'+d.n+' 局次 · 胜率 '+fmt(d.p)+'%<br>z='+fmt(d.z,2)})),
  {lab:100, rowH:34, VW:210, title:'一个英雄有几个定位就算几份（局数会重复计）'});
$('#rolesMulti-note').innerHTML = '这一版把双定位英雄重复计入（例如「沙漠皇帝」同时算法师和射手），所以总局数大于 1001。<b>它更贴近「这个定位标签整体表现如何」，但不能和上图直接比样本量。</b>';

/* ---------- 图 3.3 英雄气泡 ---------- */
(function(){
  const pts = D.bubble;
  const W=900,H=460,x0=76,x1=860,y0=46,yb=400;
  const s = svgEl(W,H);
  const xmn = Math.min(...pts.map(p=>p.dmg))*0.88, xmx = Math.max(...pts.map(p=>p.dmg))*1.05;
  const ymn = Math.min(...pts.map(p=>p.tank))*0.85, ymx = Math.max(...pts.map(p=>p.tank))*1.08;
  const px = v => x0 + (v-xmn)/(xmx-xmn)*(x1-x0);
  const py = v => yb - (v-ymn)/(ymx-ymn)*(yb-y0);
  [0,0.25,0.5,0.75,1].forEach(f=>{
    const x = x0+f*(x1-x0), y = yb-f*(yb-y0);
    mk(s,'line',{x1:x,y1:y0,x2:x,y2:yb,stroke:'var(--grid)','stroke-width':1});
    mk(s,'line',{x1:x0,y1:y,x2:x1,y2:y,stroke:'var(--grid)','stroke-width':1});
    txt(s, x, yb+18, (xmn+f*(xmx-xmn)).toFixed(0)+'k', {'font-size':11,fill:'var(--muted)','text-anchor':'middle'});
    txt(s, x0-9, y+4, (ymn+f*(ymx-ymn)).toFixed(0)+'k', {'font-size':11,fill:'var(--muted)','text-anchor':'end'});
  });
  txt(s, (x0+x1)/2, H-6, '场均伤害 →', {'font-size':12,fill:'var(--ink2)','text-anchor':'middle'});
  txt(s, 14, (y0+yb)/2, '场均承伤 →', {'font-size':12,fill:'var(--ink2)','text-anchor':'middle',
      transform:'rotate(-90 14 '+((y0+yb)/2)+')'});
  const rmax = Math.max(...pts.map(p=>p.n));
  const shownPts = pts.filter(p=>Math.abs(p.p-P0)>=7 || p.n>=50)
    .sort((a,b)=> px(a.dmg)-px(b.dmg));
  shownPts.forEach((p,i)=>{
    p._show = true;
    p._above = (i>0 && Math.abs(px(p.dmg)-px(shownPts[i-1].dmg))<78)
      ? !shownPts[i-1]._above : true;
  });
  pts.forEach(p=>{
    const r = 6 + Math.sqrt(p.n/rmax)*16;
    const up = p.p >= P0;
    const c = mk(s,'circle',{cx:px(p.dmg),cy:py(p.tank),r:r,
      fill: up?'var(--up)':'var(--down)','fill-opacity':0.42,
      stroke: up?'var(--up)':'var(--down)','stroke-width':2});
    bindTip(c, p.h+'<br>'+p.n+' 局 · 胜率 '+fmt(p.p)+'%<br>场均伤害 '+p.dmg+'k · 承伤 '+p.tank+'k<br>死亡 '+p.d+' · 时长 '+p.dur+' 分<br>定位：'+(p.roles||[]).join('/'));
    if(p._show){
      const above = (p._above === undefined) ? true : p._above;
      txt(s, px(p.dmg), above ? py(p.tank)-r-6 : py(p.tank)+r+14, p.h,
          {'font-size':11,fill:'var(--ink)','text-anchor':'middle','font-weight':600});
    }
  });
  txt(s, x0, 16, '气泡大小 = 局数　蓝 = 高于基准胜率　红 = 低于基准', {'font-size':12,fill:'var(--muted)'});
  $('#c-bubble').appendChild(s);
})();

/* ---------- 图 3.4 K-means ---------- */
(function(){
  const pts = D.bubble, cl = D.clusters;
  const W=900,H=440,x0=76,x1=640,y0=46,yb=390;
  const s = svgEl(W,H);
  const colors = ['var(--s1)','var(--s2)','var(--s3)','var(--s4)'];
  const grads = colors.map((c,i)=>grad(s,'k'+i,c,0.55));
  const xmn = Math.min(...pts.map(p=>p.dmg))*0.88, xmx = Math.max(...pts.map(p=>p.dmg))*1.05;
  const ymn = Math.min(...pts.map(p=>p.tank))*0.85, ymx = Math.max(...pts.map(p=>p.tank))*1.08;
  const px = v => x0 + (v-xmn)/(xmx-xmn)*(x1-x0);
  const py = v => yb - (v-ymn)/(ymx-ymn)*(yb-y0);
  [0,0.25,0.5,0.75,1].forEach(f=>{
    const x = x0+f*(x1-x0), y = yb-f*(yb-y0);
    mk(s,'line',{x1:x,y1:y0,x2:x,y2:yb,stroke:'var(--grid)','stroke-width':1});
    mk(s,'line',{x1:x0,y1:y,x2:x1,y2:y,stroke:'var(--grid)','stroke-width':1});
    txt(s, x, yb+18, (xmn+f*(xmx-xmn)).toFixed(0)+'k', {'font-size':11,fill:'var(--muted)','text-anchor':'middle'});
    txt(s, x0-9, y+4, (ymn+f*(ymx-ymn)).toFixed(0)+'k', {'font-size':11,fill:'var(--muted)','text-anchor':'end'});
  });
  txt(s, (x0+x1)/2, H-8, '场均伤害 →', {'font-size':12,fill:'var(--ink2)','text-anchor':'middle'});
  txt(s, 14, (y0+yb)/2, '场均承伤 →', {'font-size':12,fill:'var(--ink2)','text-anchor':'middle',
      transform:'rotate(-90 14 '+((y0+yb)/2)+')'});
  const rmax = Math.max(...pts.map(p=>p.n));
  pts.forEach(p=>{
    const r = 6+Math.sqrt(p.n/rmax)*15;
    const c = mk(s,'circle',{cx:px(p.dmg),cy:py(p.tank),r:r,fill:grads[p.cl||0],
      stroke:colors[p.cl||0],'stroke-width':2});
    bindTip(c, '<b>簇 '+(p.cl+1)+'</b><br>'+p.h+'<br>'+p.n+' 局 · 胜率 '+fmt(p.p)+'%<br>伤害 '+p.dmg+'k · 承伤 '+p.tank+'k · 死亡 '+p.d);
    if(p._show){
      const above = (p._above === undefined) ? true : p._above;
      txt(s, px(p.dmg), above ? py(p.tank)-r-6 : py(p.tank)+r+14, p.h,
          {'font-size':11,fill:'var(--ink)','text-anchor':'middle','font-weight':600});
    }
  });
  const lx = 676;
  txt(s, lx, 30, '各簇画像', {'font-size':13.5,fill:'var(--ink)','font-weight':650});
  cl.forEach((c,i)=>{
    const yy = 56+i*(cl.length>3?82:88);
    mk(s,'rect',{x:lx,y:yy-14,width:13,height:13,rx:4,fill:grads[c.id],stroke:colors[c.id],'stroke-width':1.5});
    txt(s, lx+20, yy-3, '簇'+(c.id+1)+' · '+c.size+' 个英雄 · '+c.games+' 局', {'font-size':12.5,fill:'var(--ink)'});
    txt(s, lx+20, yy+14, '胜率 '+fmt(c.p)+'%  (z='+(c.z>0?'+':'')+fmt(c.z,2)+')', {'font-size':12,fill: c.z>=2?'var(--good)':(c.z<=-2?'var(--down)':'var(--muted)')});
    txt(s, lx+20, yy+30, '伤害'+c.prof['伤害']+'k 承伤'+c.prof['承伤']+'k', {'font-size':11,fill:'var(--muted)'});
    txt(s, lx+20, yy+44, '死亡'+c.prof['死亡']+' 时长'+c.prof['时长']+'分', {'font-size':11,fill:'var(--muted)'});
  });
  txt(s, x0, 16, '同一批英雄按「伤害/承伤/死亡/时长」四维聚类，投影到伤害×承伤平面', {'font-size':12,fill:'var(--muted)'});
  $('#c-cluster').appendChild(s);
  const host = $('#c-clusterCards');
  host.innerHTML = cl.map((c,i)=>{
    const col = colors[c.id];
    return '<div class="mini" style="border-left:4px solid '+col+'">'
      +'<div class="t">簇 '+(c.id+1)+' · '+c.size+' 个英雄 / '+c.games+' 局</div>'
      +'<div class="v" style="color:'+col+'">'+fmt(c.p)+'%</div>'
      +'<div class="d">场均伤害 '+c.prof['伤害']+'k · 承伤 '+c.prof['承伤']+'k<br>死亡 '+c.prof['死亡']+' · 时长 '+c.prof['时长']+' 分</div>'
      +'<div class="d" style="margin-top:6px">'+c.heroes.join('、')+'</div></div>';
  }).join('');
  const best = cl.reduce((a,b)=> a.p>b.p?a:b), worst = cl.reduce((a,b)=> a.p<b.p?a:b);
  $('#cluster-note').innerHTML = '簇是按四个特征自动分的，<b>我没有先告诉它谁是坦克谁是法师</b> —— 所以它反映的是「你在什么打法的英雄上更稳」。'
    + '最好的簇 '+(best.id+1)+'（'+fmt(best.p)+'%，'+best.size+' 个英雄）与最差的簇 '+(worst.id+1)+'（'+fmt(worst.p)+'%）相差 '+fmt(best.p-worst.p)+'pp，'
    + '但每簇只有 '+(cl.map(c=>c.size).join('/'))+' 个英雄、样本 114–251 局，<b>z 值全都没到 2，方向可信、幅度不可信</b>。'
    + '另外 29 个英雄做聚类本身就偏少，换个随机种子簇边界会动。';
})();

/* ---------- 图 4 装备 ---------- */
(function(){
  lollipop($('#c-items'), D.items.slice(0,20).map(d=>({label:d.name, diff:d.diff, p:d.p, n:d.n,
    sub:d.n+'局 · '+d.price+'金 · z='+(d.z>0?'+':'')+fmt(d.z,2),
    tip:d.name+'（'+d.price+'金）<br>'+d.n+' 局 · 胜率 '+fmt(d.p)+'%<br>相对基准 '+((d.diff)>0?'+':'')+fmt(d.diff)+'pp · z='+fmt(d.z,2)})),
    {lab:170, rowH:31, VW:225, title:'成装胜率相对基准（出现 ≥15 局，按差值排序前 20 件）'});
  $('#items-note').innerHTML = '共 <b>'+D.items.length+'</b> 件装备达到 15 局门槛。列在最上面的「'+D.items[0].name+'」只有 '+D.items[0].n+' 局，'
    + 'z='+fmt(D.items[0].z,2)+' —— 这个量级<b>和噪声区分不开</b>。真正样本够大的只有育恩塔尔荒野箭、虚空之杖等少数几件。'
    + (D.itemUnknown.length? '<br>未能匹配到装备库的名字：'+D.itemUnknown.map(x=>x[0]+'('+x[1]+')').join('、') : '');
})();

/* ---------- 图 5 符文 ---------- */
bullet($('#c-augRarity'), D.augRarity.map(d=>({label:d.cn, v:d.p, dec:1, unit:'%',
  right:d.n+' 次槽位',
  right2:'相对基准 '+((d.p-P0)>0?'+':'')+fmt(d.p-P0)+'pp',
  tip:d.cn+'符文<br>'+d.n+' 次槽位 · 胜率 '+fmt(d.p)+'%'})),
  {title:'按品质看（槽位加权）　虚线 = 账号基准', base:P0, ymax:60, lab:100, padR:230});

function augRows(arr){
  return arr.map(d=>({label:d.name, diff:d.diff, p:d.p, n:d.n,
    sub:d.rarity+' · '+d.n+'局'+(d.rank?' · 榜'+d.rank+'名':''),
    tip:d.name+'（'+d.rarity+'）<br>版本榜第 '+(d.rank||'—')+' 名'+(d.wr?'（版本胜率 '+d.wr+'）':'')
      +'<br>你 '+d.n+' 局 · 胜率 '+fmt(d.p)+'%<br>相对基准 '+((d.diff)>0?'+':'')+fmt(d.diff)+'pp · z='+fmt(d.z,2)}));
}
lollipop($('#c-augments'), augRows(D.augments.slice(0,18)),
  {lab:150, rowH:31, VW:215, title:'胜率高于基准的前 18 个（出现 ≥20 局）'});
lollipop($('#c-augBottom'), augRows(D.augments.slice(-14).reverse()),
  {lab:150, rowH:31, VW:215, title:'低于基准最多的 14 个（同样只作参考）'});
$('#aug-note').innerHTML = '共 <b>'+D.augments.length+'</b> 个符文达到 20 局门槛。'
  + '榜首「'+D.augments[0].name+'」只有 '+D.augments[0].n+' 局；而且我从 '+D.augments.length+' 个符文里挑极端值，'
  + '<b>多重比较本身就能造出 ±20pp 的假差距</b>。判断一个符文强不强，请优先看它的版本榜名次（社区站样本远大于你），'
  + '你个人的样本只够说明「你有没有用好它」。';

/* ---------- 第 6 章 队友与组队 ---------- */
(function(){
  const M = D.mate;
  $('#mate-n').textContent = M.meta.n;
  $('#mate-distinct').textContent = M.meta.distinctMates;

  bullet($('#c-scale'), M.scale.map(s=>({label:s.k+' 人', v:s.p, dec:1, unit:'%',
    right:'Wilson 下界 '+s.wilson+'%',
    right2:s.w+'/'+s.n+' 胜 · p='+s.pval,
    tip:'同队里有 '+s.k+' 个常一起玩的人<br>'+s.n+' 局 · '+s.w+' 胜 · '+fmt(s.p)+'%<br>Wilson 下界 '+s.wilson+'%<br>收缩后 '+s.shrunk+'%<br>二项检验 p='+s.pval})),
    {title:'同队里「常一起玩的人」的个数 → 胜率（虚线 = 账号基准）', base:P0, ymax:80, lab:90, padR:250});

  const last = M.scale[M.scale.length-1];
  $('#scale-note').innerHTML = '从 0 人到 4 人整体是<b>「熟人越多越好」</b>：'
    + last.k+' 人同行时 '+fmt(last.p)+'%（'+last.n+' 局），而 0–2 人时都在 45–49%。'
    + '但曲线<b>不单调</b> —— 2 人的 '+fmt(M.scale[2].p)+'% 比 0 人、1 人都低。'
    + '<b>更要紧的是方向可能是反的</b>：你们配合顺的时候才会一直一起排，'
    + '「熟人多」可能只是「这段时期你们状态好」的结果，不是原因。';

  const aq = M.mates.find(m=>m.name==='AQword');
  lollipop($('#c-mates'), M.mates.filter(m=>m.n>=20).map(m=>({label:m.name, diff:m.p-P0, p:m.p, n:m.n,
    sub:'Wilson 下界 '+m.wilson+'% · q='+m.q,
    tip:m.name+'<br>同队 '+m.n+' 局 · '+m.w+' 胜 · '+fmt(m.p)+'%<br>收缩后 '+m.shrunk+'%<br>Wilson 下界 '+m.wilson+'%<br>FDR q='+m.q})),
    {lab:130, rowH:32, VW:235, title:'常一起打的人（同队 ≥20 局，按局数排序）'});

  $('#mates-note').innerHTML = '看起来最高的 <b>'+ (aq?aq.name:'') +'</b>（'+ (aq?aq.n+' 局 '+fmt(aq.p)+'%':'') +'）'
    + '在「所有 '+M.meta.distinctMates+' 个同队过的玩家」这个候选范围里，校正后 <b>q='+(aq?aq.q:'—')+'，不显著</b>；'
    + '但如果只看<b>同队 ≥20 局的 '+D.mate2.perf.filter(x=>x.n>=20).length+' 个人</b>，同一个 AQword 的 q 会变成 <b>0.040，显著</b>。'
    + '<b>差别只在于你把多少个假设放进了多重比较</b> —— 两种口径都真实，所以都列出来。'
    + '<br>（图上很多条 q 值相同是 BH 的正常现象：它取「从该条往上累积的最小值」，不是某一条单独的显著性。）';

  /* ---- 6.2 表现分表 ---- */
  const P = D.mate2.perf.slice().sort((a,b)=> b.n-a.n);
  document.querySelector('#perf-table tbody').innerHTML = P.map(x=>
    '<tr><td>'+x.name+'</td><td class="num">'+x.n+'</td><td class="num">'+fmt(x.p)+'%</td>'
    +'<td class="num">'+fmt(x.kda,2)+'</td><td class="num">'+(x.dmg/1000).toFixed(1)+'k</td>'
    +'<td class="num">'+fmt(x.death)+'</td><td class="num">'+(x.tank/1000).toFixed(1)+'k</td>'
    +'<td class="num">'+fmt(x.teamRank,2)+'</td></tr>').join('');

  const byRank = P.slice().sort((a,b)=> a.teamRank-b.teamRank);
  const byWin = P.slice().sort((a,b)=> b.p-a.p);
  $('#perf-note').innerHTML =
    '<b>把「个人表现」和「跟他一起赢」两列并排看，是本报告最反直觉的一处：</b>'
    + '个人表现最强的三个是 '+byRank.slice(0,3).map(x=>x.name+'（名次 '+fmt(x.teamRank,2)+'）').join('、')
    + '；而<b>同队胜率</b>最高的三个是 '+byWin.slice(0,3).map(x=>x.name+'（'+fmt(x.p)+'%）').join('、')
    + '。<b>两份名单几乎不重合。</b>';

  /* ---- 6.3 控制共现（哑铃图） ---- */
  const C = D.mate2.cond.filter(c=>c.both.n>=5 || c.onlyA.n>=5);
  dumbbell($('#c-cond'), C.map(c=>({
    label: c.a.slice(0,6)+'×'+c.b.slice(0,5),
    a: c.both.p, b: c.onlyA.p, dec:1,
    diff: Math.round((c.both.p-c.onlyA.p)*10)/10,
    rel: c.onlyA.p ? Math.round((c.both.p-c.onlyA.p)/c.onlyA.p*1000)/10 : 0,
    tip: c.a+' 在场时<br>'+c.b+' 也在：'+c.both.n+' 局 '+fmt(c.both.p)+'%<br>'
       + c.b+' 不在：'+c.onlyA.n+' 局 '+fmt(c.onlyA.p)+'%'
  })), {aLabel:'两人都在', bLabel:'只有前者在场', diffLabel:'差值', lab:150, padR:170});

  const aqBoth = D.mate2.cond.find(c=>c.a==='AQword' && c.b==='今人不见古时月');
  const jrBoth = D.mate2.cond.find(c=>c.a==='今人不见古时月' && c.b==='AQword');
  $('#cond-note').innerHTML =
    '<b>答案和直觉相反：不是 AQword 搭了今人的车，是今人搭了 AQword 的车。</b>'
    + (aqBoth ? '<br>· AQword 在场时：今人<b>也在</b> '+aqBoth.both.n+' 局 '+fmt(aqBoth.both.p)+'%；今人<b>不在</b> '+aqBoth.onlyA.n+' 局 '+fmt(aqBoth.onlyA.p)+'%。' : '')
    + (jrBoth ? '<br>· 今人在场时：AQword <b>也在</b> '+jrBoth.both.n+' 局 '+fmt(jrBoth.both.p)+'%；AQword <b>不在</b> '+jrBoth.onlyA.n+' 局 '+fmt(jrBoth.onlyA.p)+'%。' : '')
    + '<br>今人自己单独在场时只有 47.8%（低于基准），和 AQword 一起时跳到 68.6%。'
    + '反过来 AQword 即使今人不在也有 76.9%（只有 13 局，样本小）。'
    + '<b>所以 AQword 的高胜率不是别人带来的</b>，而这一组数据也顺便说明：'
    + '<b>同一个人的胜率会随「场上还有谁」剧烈变化</b>，这就是为什么单看一个人的总胜率很容易误判。';

  /* ---- 6.4 各人数最佳组合 ---- */
  const PT = [];
  [['1','2 人排（我 + 1）'],['2','3 人排（我 + 2）'],['3','4 人排（我 + 3）'],['4','5 人排（我 + 4）']].forEach(function(pr){
    (D.mate2.best[pr[0]]||[]).slice(0,3).forEach(function(x){
      PT.push({lab:pr[1], names:x.names, n:x.n, w:x.w, p:x.p, shrunk:x.shrunk,
               wilson:x.wilson, q:x.q});
    });
  });
  document.querySelector('#party-table tbody').innerHTML = PT.map(r=>{
    const star = r.q<0.05 ? ' <b style="color:var(--good)">★</b>' : '';
    return '<tr><td>'+r.lab+'</td><td>'+r.names.join(' + ')+'</td>'
      +'<td class="num">'+r.n+'</td><td class="num">'+r.w+'</td>'
      +'<td class="num">'+fmt(r.p)+'%</td><td class="num">'+fmt(r.shrunk)+'%</td>'
      +'<td class="num">'+fmt(r.wilson)+'%</td><td class="num">'+r.q.toFixed(3)+star+'</td></tr>';
  }).join('');

  const b1 = (D.mate2.best['1']||[])[0], b2 = (D.mate2.best['2']||[])[0];
  const b3 = (D.mate2.best['3']||[])[0], b4 = (D.mate2.best['4']||[])[0];
  $('#party-note').innerHTML =
    '<b>★ = 通过 FDR 校正（q&lt;0.05）。</b>每个人数只列收缩后胜率最高的 3 组。'
    + '唯一带 ★ 的是 <b>2 人排的 '+ (b1?b1.names.join(' + '):'') +'</b>（'+ (b1?b1.n:'') +' 局 '+ (b1?fmt(b1.p):'') +'%，q='+ (b1?b1.q:'') +'）。'
    + '人数越多、组合越多，样本就被摊得越薄 —— 4 人排和 5 人排的每组只有 5–22 局，'
    + '<b>再怎么排序都分不出真假</b>。所以「凑齐四人更稳」这个说法，在修正计数之后<b>已经站不住了</b>。';

  /* ---- 6.5 表现 vs 胜率 散点 ---- */
  (function(){
    const rows = D.mate2.perf.slice().sort((a,b)=>b.n-a.n);
    const W=900,H=440,x0=90,x1=840,y0=56,yb=380;
    const s = svgEl(W,H);
    const rmn=1.7, rmx=3.8, pmn=40, pmx=76;
    const px = v => x0 + (v-rmn)/(rmx-rmn)*(x1-x0);
    const py = v => yb - (v-pmn)/(pmx-pmn)*(yb-y0);
    for(let k=0;k<=4;k++){
      const v = pmn + (pmx-pmn)*k/4, y = py(v);
      mk(s,'line',{x1:x0,y1:y,x2:x1,y2:y,stroke:'var(--grid)','stroke-width':1});
      txt(s, x0-9, y+4, v+'%', {'font-size':11,fill:'var(--muted)','text-anchor':'end'});
    }
    [2,2.5,3,3.5].forEach(v=>{
      const x = px(v);
      mk(s,'line',{x1:x,y1:y0,x2:x,y2:yb,stroke:'var(--grid)','stroke-width':1});
      txt(s, x, yb+19, fmt(v,1), {'font-size':11,fill:'var(--muted)','text-anchor':'middle'});
    });
    const yB = py(P0);
    mk(s,'line',{x1:x0,y1:yB,x2:x1,y2:yB,stroke:'var(--axis)','stroke-width':2,'stroke-dasharray':'6 4'});
    txt(s, x1, yB-6, '基准 '+fmt(P0)+'%', {'font-size':11.5,fill:'var(--ink2)','text-anchor':'end'});
    const rmax = Math.max(...rows.map(r=>r.n));
    rows.forEach(r=>{
      const rad = 7 + Math.sqrt(r.n/rmax)*17;
      const up = r.p >= P0;
      const c = mk(s,'circle',{cx:px(r.teamRank),cy:py(r.p),r:rad,
        fill: up?'var(--up)':'var(--down)','fill-opacity':0.4,
        stroke: up?'var(--up)':'var(--down)','stroke-width':2});
      txt(s, px(r.teamRank), py(r.p)-rad-6, r.name, {'font-size':11,fill:'var(--ink)','text-anchor':'middle','font-weight':600});
      bindTip(c, r.name+'<br>同队 '+r.n+' 局 · 胜率 '+fmt(r.p)+'%<br>KDA '+fmt(r.kda,2)
        +'<br>场均伤害 '+(r.dmg/1000).toFixed(1)+'k<br>队内伤害名次 '+fmt(r.teamRank,2));
    });
    txt(s, x0, 18, '横轴：他在队内的平均伤害名次（越靠左越强）　纵轴：和他同队的胜率　气泡 = 同队局数',
        {'font-size':12,fill:'var(--muted)'});
    txt(s, (x0+x1)/2, H-8, '← 个人表现更强　　个人表现更弱 →', {'font-size':11.5,fill:'var(--muted)','text-anchor':'middle'});
    $('#c-perfscatter').appendChild(s);
  })();

  const byRank2 = P.slice().sort((a,b)=> a.teamRank-b.teamRank);
  const byWin2 = P.slice().sort((a,b)=> b.p-a.p);
  const best = byRank2[0], worstRank = byRank2[byRank2.length-1];
  const bestP = byWin2[0], worstP = byWin2[byWin2.length-1];
  $('#perfscatter-note').innerHTML =
    '<b>看得最清楚的一对：</b>'
    + '<br>· <b>'+bestP.name+'</b> 个人数据最平庸（队内伤害名次 '+fmt(bestP.teamRank,2)
    + '，KDA '+fmt(bestP.kda,2)+'），但同队胜率<b>最高</b>（'+fmt(bestP.p)+'%，'+bestP.n+' 局）。'
    + '<br>· <b>'+best.name+'</b> 个人数据最亮眼（名次 '+fmt(best.teamRank,2)+'，KDA '+fmt(best.kda,2)
    + '），同队胜率只有 '+fmt(best.p)+'%。'
    + '<br><b>这不矛盾</b>：伤害/名次衡量的是「他能打出多少输出」，而一起赢不赢还取决于他做的是不是团队当下需要的事'
    + '（开团、保人、控图），这些不进伤害统计。'
    + '<br><b>所以「谁最厉害」有两个答案：</b>论个人数据是 <b>'+byRank2.slice(0,3).map(x=>x.name).join('、')
    + '</b>；论「跟他一起能赢」是 <b>'+byWin2.slice(0,3).map(x=>x.name).join('、')+'</b>。'
    + '<br><b>谁最菜</b>同样两说：个人数据最弱的是 '+worstRank.name+'（名次 '+fmt(worstRank.teamRank,2)+'）；'
    + '同队胜率最低的是 '+worstP.name+'（'+fmt(worstP.p)+'%，'+worstP.n+' 局）。'
    + '<br>⚠ 但这 18 个人里<b>没有一个人的胜率差异通过 FDR 校正</b> —— 上面的「最高/最低」都还在噪声范围内，'
    + '样本只有 16–353 局。<b>可以当成观察，不能当成结论。</b>';

  /* ---- 6.6 结论 ---- */
  $('#mate-conclusion').innerHTML =
    '<h3>A. 修正后，唯一通过统计检验的是 AQword（2 人排），不是「四人成行」</h3>'
    + '<ul><li>本报告第一版曾写「四人组合显著（q=0.013）」，那是<b>我自己的计数 bug</b>：'
    + '4 人组合的局数在循环里被重复累加了 4 次（例如「上杉+加藤+下棋+23岁」显示 44 局，实际只有 <b>11 局</b>），'
    + '样本虚高导致 z 值虚高。修正后<b>没有任何多人组合显著</b>。</li>'
    + '<li>修正后唯一 q&lt;0.05 的是 <b>'+(b1?b1.names.join(' + '):'')+'</b>（'
    + (b1?b1.n+' 局，'+fmt(b1.p)+'%，q='+b1.q:'')+'）。</li>'
    + '<li><b>而且这个「显著」还要打个折</b>：如果把候选范围从「常一起玩的 16 人」放宽到'
    + '「所有同队过的 '+M.meta.distinctMates+' 人」，同一个 AQword 的 q 就变成 0.333 —— '
    + '<b>不显著了</b>。多重比较的分母是你自己选的，这一点必须讲明白。</li></ul>'
    + '<h3>B. 关于你问的「谁最厉害 / 谁最菜」</h3>'
    + '<ul><li>个人数据最强：<b>'+byRank2.slice(0,3).map(x=>x.name).join('、')+'</b>；'
    + '同队胜率最高：<b>'+byWin2.slice(0,3).map(x=>x.name).join('、')+'</b>。两份名单几乎不重合。</li>'
    + '<li>个人数据最弱：<b>'+worstRank.name+'</b>；同队胜率最低：<b>'+worstP.name+'</b>。</li>'
    + '<li>但<b>没有一个人达到统计显著</b>，所以「谁最厉害/最菜」只能当观察，不能当结论。</li></ul>'
    + '<h3>C. 真正站得住的只有三条</h3>'
    + '<ul><li><b>AQword 的高胜率不是别人带来的</b> —— 今人不在时他 76.9%，今人单独时只有 47.8%。这是控制共现后的结果。</li>'
    + '<li><b>个人数据和团队胜率是两回事</b> —— 表现最好的人胜率不一定高，反之亦然。</li>'
    + '<li><b>你自己的样本量不够给朋友排名</b> —— 18 个常一起玩的人、每人 16–353 局，'
    + '要分辨 5 个百分点的差别需要上千局。想认真排，得攒更多数据。</li></ul>';
})();

/* ---------- 明细表 ---------- */
(function(){
  const G = D.games;
  const COLS = ['日期','英雄','结果','击杀','死亡','助攻','伤害','承伤','金币','补刀','时长','伤害名次','符文','装备'];
  const NUM = [3,4,5,6,7,8,9,10,11];
  const th = document.querySelector('#gt thead'), tb = document.querySelector('#gt tbody');
  th.innerHTML = '<tr>'+COLS.map((c,i)=>'<th class="'+(NUM.includes(i)?'num':'')+'">'+c+'</th>').join('')+'</tr>';
  const q=$('#q'), fres=$('#fres'), fsort=$('#fsort');
  function view(){
    const kw=q.value.trim(), rs=fres.value;
    let arr = G.filter(g=>{
      if(rs && g[2]!==rs) return false;
      if(kw && !(g[1].includes(kw)||g[12].includes(kw)||g[13].includes(kw))) return false;
      return true;
    });
    const sk = fsort.value;
    if(sk==='0') arr = arr.slice().sort((a,b)=> a[0]<b[0]?1:-1);
    else if(sk==='11') arr = arr.slice().sort((a,b)=> a[11]-b[11]);
    else arr = arr.slice().sort((a,b)=> b[+sk]-a[+sk]);
    const show = arr.slice(0,400);
    tb.innerHTML = show.map(g=>{
      const pill = g[2]==='胜'?'<span class="pill w">胜</span>':'<span class="pill l">负</span>';
      const augs = g[12]?g[12].split(' · ').map(a=>'<span class="tag">'+a+'</span>').join(''):'';
      const its = g[13]?g[13].split(' · ').map(a=>'<span class="tag">'+a+'</span>').join(''):'';
      return '<tr><td>'+g[0]+'</td><td>'+g[1]+'</td><td>'+pill+'</td>'
        +'<td class="num">'+g[3]+'</td><td class="num">'+g[4]+'</td><td class="num">'+g[5]+'</td>'
        +'<td class="num">'+(g[6]/1000).toFixed(1)+'k</td><td class="num">'+(g[7]/1000).toFixed(1)+'k</td>'
        +'<td class="num">'+g[8]+'</td><td class="num">'+g[9]+'</td><td class="num">'+g[10]+'</td>'
        +'<td class="num">'+g[11]+'</td><td>'+augs+'</td><td>'+its+'</td></tr>';
    }).join('');
    $('#gcount').textContent = '显示 '+show.length+' / 筛选出 '+arr.length+' 局（共 '+G.length+' 局，最多显示 400 行）';
  }
  q.addEventListener('input', view); fres.addEventListener('change', view); fsort.addEventListener('change', view);
  view();
})();
</script>
</body>
</html>
"""

HTML = TEMPLATE.replace('__DATA__', JSON_DATA)
open(OUT, 'w', encoding='utf-8').write(HTML)
print('written OK')
print('size KB:', round(len(HTML.encode('utf-8')) / 1024, 1))
print('target exists:', os.path.exists(OUT))
