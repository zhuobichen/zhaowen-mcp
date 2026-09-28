# -*- coding: utf-8 -*-
"""生成 WeGame 官方数据补充报告 HTML。"""
import pathlib
import json, os

BASE = str(pathlib.Path(__file__).resolve().parent.parent.parent)
D = json.load(open(os.path.join(BASE, 'reports', '_wgreport.json'), encoding='utf-8'))
OUT = os.path.join(BASE, 'reports', '海斗WeGame官方数据-自己的丁ding.html')
JSON_DATA = json.dumps(D, ensure_ascii=False, separators=(',', ':'))

TEMPLATE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WeGame 官方数据 · 自己的丁ding#66595</title>
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
.hero{position:relative;margin:0 -20px;padding:52px 40px 40px;overflow:hidden;
  background:linear-gradient(135deg,#1baf7a 0%,#2a78d6 60%,#4a3aa7 100%);color:#fff}
.hero::after{content:"";position:absolute;inset:0;
  background:radial-gradient(900px 340px at 88% -30%,rgba(255,255,255,.26),transparent 62%);pointer-events:none}
.hero h1{margin:0 0 8px;font-size:30px;letter-spacing:-.02em;font-weight:680}
.hero .sub{opacity:.92;font-size:14.5px;margin:0}
.hero .kpis{display:flex;gap:34px;flex-wrap:wrap;margin-top:26px}
.hero .kpi b{font-size:36px;font-weight:680;line-height:1.05;letter-spacing:-.02em;display:block}
.hero .kpi span{font-size:12.5px;opacity:.85}
h2{font-size:21px;margin:52px 0 6px;letter-spacing:-.01em}
h2 .num{display:inline-flex;width:28px;height:28px;border-radius:8px;margin-right:9px;
  background:linear-gradient(135deg,#1baf7a,#2a78d6);color:#fff;font-size:15px;
  align-items:center;justify-content:center;vertical-align:1px}
h3{font-size:15.5px;margin:28px 0 4px;color:var(--ink)}
.card{background:var(--surf);border:1px solid var(--border);border-radius:14px;
  padding:20px 22px;margin:14px 0;box-shadow:var(--shadow);
  transition:transform .18s ease,box-shadow .18s ease}
.card:hover{transform:translateY(-2px);box-shadow:var(--shadow2)}
.note{font-size:13.5px;color:var(--ink2);margin:8px 0 0}
.warn{background:var(--warnbg);border:1px solid var(--warnbd);border-radius:12px;
  padding:14px 16px;font-size:13.5px;margin:16px 0;box-shadow:var(--shadow)}
ul,ol{margin:8px 0;padding-left:22px} li{margin:6px 0}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--grid)}
th{color:var(--ink2);font-weight:600;font-size:12.5px;white-space:nowrap}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.chart{width:100%;height:auto;display:block;margin:8px 0 0;overflow:visible}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--ink2);margin:8px 0 0}
.legend i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media (max-width:780px){.grid2{grid-template-columns:1fr}}
#tip{position:fixed;pointer-events:none;background:var(--ink);color:var(--page);
  padding:7px 11px;border-radius:8px;font-size:12.5px;line-height:1.55;opacity:0;
  transition:opacity .12s;z-index:99;max-width:300px;box-shadow:0 8px 24px rgba(0,0,0,.3)}
.mvp{display:inline-block;padding:1px 8px;border-radius:20px;font-size:11.5px;font-weight:700;
  background:rgba(237,161,0,.2);color:#8a5a00;margin-left:4px}
.svp{display:inline-block;padding:1px 8px;border-radius:20px;font-size:11.5px;font-weight:700;
  background:rgba(74,58,167,.16);color:#4a3aa7;margin-left:4px}
footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--grid);
  font-size:12.5px;color:var(--muted);line-height:1.8}
.toggle{position:fixed;top:16px;right:18px;z-index:100;background:rgba(255,255,255,.16);
  border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:9px;padding:7px 13px;
  font-size:13px;cursor:pointer;font-family:inherit;backdrop-filter:blur(6px)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-top:14px}
.mini{background:var(--card2);border-radius:11px;padding:13px 15px}
.mini .t{font-size:13px;color:var(--ink2);margin-bottom:5px}
.mini .v{font-size:23px;font-weight:680;letter-spacing:-.01em}
.mini .d{font-size:12px;color:var(--muted);margin-top:3px}
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
    <h1>WeGame 官方数据 · 补充报告</h1>
    <p class="sub" id="head"></p>
    <div class="kpis">
      <div class="kpi"><b id="k-n"></b><span>局数</span></div>
      <div class="kpi"><b id="k-wr"></b><span>胜率</span></div>
      <div class="kpi"><b id="k-s"></b><span>官方均分</span></div>
      <div class="kpi"><b id="k-mvp"></b><span>MVP / SVP</span></div>
    </div>
  </div>
</div>

<div class="wrap">
<div class="warn">
<b>这份数据和主报告不是一回事。</b>它来自 <b>WeGame（腾讯）</b>的官方接口，只有 <b id="w1"></b> 局、
跨度 <span id="w2"></span>；主报告用的是本地归档（SGP）的 1002 局，能追到 2025-11。
<br><b>WeGame 独有价值</b>：官方 <code>game_score</code>、<b>MVP/SVP</b>、<b>官方组队人数</b>（<code>team_made_size</code>）——这三样归档里没有。
<br><b>代价</b>：只有最近约 3.7 个月。
</div>

<h2><span class="num">1</span>我的官方评分</h2>
<div class="cards" id="kpi-cards"></div>
<h3>1.1 分数分布</h3>
<div id="c-hist"></div>
<p class="note" id="hist-note"></p>

<h3>1.2 逐月走势</h3>
<div id="c-month"></div>
<p class="note" id="month-note"></p>

<h2><span class="num">2</span>组队人数（官方字段 team_made_size）</h2>
<div id="c-party"></div>
<p class="note" id="party-note"></p>

<h2><span class="num">3</span>队友的官方表现</h2>
<p class="note">下面这些是 <b>他们在「和你同队的那几局里」</b>的官方分，不是他们自己的全部历史。</p>
<div id="c-mates-score"></div>
<h3>3.1 MVP / SVP 榜</h3>
<div id="c-mates-mvp"></div>
<p class="note" id="mates-note"></p>

<h3>3.2 我打过的英雄</h3>
<div id="c-heroes"></div>
<p class="note">气泡大小 = 该英雄的官方均分。只列 ≥8 局的英雄。</p>

<h2><span class="num">4</span>这套评分是怎么算的（实测反推）</h2>
<div class="card">
<p class="note" style="margin-top:0">腾讯没有公开公式，GitHub / 网上也没有完整逆向。我用你这 500 局 × 10 人 = 5000 条真实数据做了回归，结论如下。</p>
<ul>
<li><b>MVP = 胜方 <code>game_score</code> 最高</b>（500/500 命中，100%）</li>
<li><b>SVP = 败方 <code>game_score</code> 最高</b>（499/500 命中，99.8%）</li>
</ul>
<p class="note">所以 MVP/SVP 没有额外算法，纯粹是分数排名。</p>
</div>
<h3>4.1 各项指标的实际权重</h3>
<div id="c-weights"></div>
<p class="note" id="weights-note"></p>
<h3>4.2 为什么只能推到 65%</h3>
<div class="card">
<p class="note" style="margin-top:0">我用「相对本局均值」的模型可以解释 <b>63–65%</b> 的分数方差（5 折分组交叉验证，没有过拟合）。各种尝试都推不上去：</p>
<table>
<thead><tr><th>方法</th><th class="num">CV R²</th></tr></thead>
<tbody>
<tr><td>绝对量线性（KDA/经济/伤害/承伤/治疗…）</td><td class="num">0.521</td></tr>
<tr><td>分均化（分均经济/分均伤害…）</td><td class="num">0.545</td></tr>
<tr><td><b>相对本局均值</b></td><td class="num"><b>0.634</b></td></tr>
<tr><td>再加二次项 + 交互项（8→29 个特征）</td><td class="num">0.646</td></tr>
<tr><td>再加正弦映射（腾讯专利里提到的那种）</td><td class="num">0.647</td></tr>
<tr><td>按英雄分别拟合</td><td class="num">0.516（反而更差）</td></tr>
</tbody></table>
<p class="note"><b>剩下的 35% 大概率不在单局数据里。</b>腾讯专利 CN108392828B 明确写了两个系数：
<b>α＝英雄熟练度校正系数</b>（按该英雄胜率 vs 玩家总胜率算）、<b>β＝位置折扣因子</b>——这两个都依赖<b>玩家历史</b>，
单局记录里根本没有。所以哪怕把 115 个字段全用上，也补不回这一块。</p>
</div>
<h3>4.3 一个副产品：挂机也有基础分</h3>
<p class="note">500 局里有 <b>20 条</b> KDA 全 0、伤害全 0 的记录（掉线/挂机），它们的均分是
<b>71260</b>，而正常局是 <b>93250</b>。说明这套评分有一个不低的基础分，不是从 0 起算。</p>

<h2><span class="num">5</span>与归档的交叉验证</h2>
<div class="card">
<p class="note" style="margin-top:0">WeGame 的 500 局和归档的 1002 局有 <b>468 局重叠</b>，逐局比对：</p>
<table>
<thead><tr><th>检查项</th><th>结果</th></tr></thead>
<tbody>
<tr><td>KDA 完全一致</td><td><b>468 / 468（100%）</b></td></tr>
<tr><td>胜负一致</td><td>463 / 468（98.9%）</td></tr>
</tbody></table>
<p class="note">5 局胜负差异是 WeGame 把失败细分为 <code>LeaverFail</code>（挂机判负），归档只有 win 布尔值所以统一记成 Fail —
不是数据错误，是 WeGame 更细。这 5 局 KDA 全是 0/0/0（没打成）。</p>
</div>

<h2><span class="num">6</span>怎么用这份数据</h2>
<div class="card">
<ul>
<li><b>可信的用法</b>：MVP/SVP 统计、官方组队人数、官方评分走势。这些是 WeGame 直接给的，没有推测成分。</li>
<li><b>要小心的用法</b>：<b>别用官方分给队友排名</b>。样本只有 9 个队友、每人 8–248 局，
而且「官方分」衡量的是个人数据（KDA/经济），和「一起能不能赢」是两回事 —— 见下。</li>
<li><b>不能用的用法</b>：拿它去推算归档那 1002 局的 MVP/SVP。我试过，命中率只有 73%/64%，每四局错一局。</li>
</ul>
</div>

<footer>
数据源：WeGame Pallas 接口（<code>GetBattleList</code> / <code>GetBattleDetail</code>），500 局，官方 <code>game_score</code> 口径<br>
交叉验证基准：本地归档海斗对局（SGP）1002 局 · 本次分析脚本见同目录 <code>_wg*.py</code>
</footer>
</div>
<div id="tip"></div>

<script>
const D = __DATA__;
const $ = s => document.querySelector(s);
const fmt = (v,d=1) => v===null||v===undefined||v==='' ? '—' : Number(v).toFixed(d);
let UID = 0;
const tip = $('#tip');
function bindTip(el, html){
  el.addEventListener('mousemove', e=>{
    tip.innerHTML = html; tip.style.opacity = 1;
    const w=tip.offsetWidth, hh=tip.offsetHeight;
    let x=e.clientX+14, y=e.clientY+14;
    if(x+w>innerWidth-8) x=e.clientX-w-14;
    if(y+hh>innerHeight-8) y=e.clientY-hh-14;
    tip.style.left=x+'px'; tip.style.top=y+'px';
  });
  el.addEventListener('mouseleave', ()=> tip.style.opacity = 0);
}
function svgEl(w,h){
  const s=document.createElementNS('http://www.w3.org/2000/svg','svg');
  s.setAttribute('viewBox','0 0 '+w+' '+h); s.setAttribute('class','chart'); s._uid='g'+(++UID);
  const df=document.createElementNS('http://www.w3.org/2000/svg','defs'); s.appendChild(df); s._defs=df;
  return s;
}
function grad(svg,id,cssVar,o2){
  const g=document.createElementNS('http://www.w3.org/2000/svg','linearGradient');
  g.setAttribute('id',svg._uid+'-'+id);
  g.setAttribute('x1','0');g.setAttribute('y1','0');g.setAttribute('x2','0');g.setAttribute('y2','1');
  [[0,1],[100,o2===undefined?0.7:o2]].forEach(function(p){
    const st=document.createElementNS('http://www.w3.org/2000/svg','stop');
    st.setAttribute('offset',p[0]+'%');
    st.setAttribute('style','stop-color:'+cssVar+';stop-opacity:'+p[1]);
    g.appendChild(st);
  });
  svg._defs.appendChild(g); return 'url(#'+svg._uid+'-'+id+')';
}
function mk(svg,tag,attrs){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const k in attrs)e.setAttribute(k,attrs[k]); svg.appendChild(e); return e;}
function txt(svg,x,y,s,attrs){
  const a=Object.assign({x:x,y:y,'font-size':12,fill:'var(--ink2)','font-family':'inherit'},attrs||{});
  const e=mk(svg,'text',a); e.textContent=s; return e;}

$('#head').textContent = '自己的丁ding#66595 · '+D.meta.first+' ~ '+D.meta.last+' · '+D.meta.n+' 局';
$('#k-n').textContent = D.meta.n;
$('#k-wr').textContent = fmt(D.meta.wr)+'%';
$('#k-s').textContent = D.meta.avgScore;
$('#k-mvp').textContent = D.meta.mvp+' / '+D.meta.svp;
$('#w1').textContent = D.meta.n;
$('#w2').textContent = D.meta.first+' ~ '+D.meta.last;

// KPI 卡片
$('#kpi-cards').innerHTML = [
  ['官方均分', D.meta.avgScore, '范围 '+D.meta.minScore+' ~ '+D.meta.maxScore],
  ['MVP', D.meta.mvp, D.meta.mvpRate+'% 的局'],
  ['SVP', D.meta.svp, D.meta.svpRate+'% 的局'],
  ['胜局均分', D.winLoss.win, '输局均分 '+D.winLoss.lose],
  ['分位数 P25/P50/P75', D.meta.q[1]+' / '+D.meta.q[2]+' / '+D.meta.q[3], 'P5 '+D.meta.q[0]+' · P95 '+D.meta.q[4]],
].map(function(x){
  return '<div class="mini"><div class="t">'+x[0]+'</div><div class="v">'+x[1]+'</div><div class="d">'+x[2]+'</div></div>';
}).join('');

// 1.1 直方图
(function(){
  const ax=D.hist.axis, cs=D.hist.counts;
  const W=900,H=300,x0=64,x1=860,y0=46,yb=232, mx=Math.max.apply(null,cs);
  const s=svgEl(W,H);
  const g=grad(s,'h','var(--s1)',0.72);
  const step=(x1-x0)/cs.length;
  for(let k=0;k<=4;k++){
    const y=yb-(yb-y0)*k/4, v=Math.round(mx*k/4);
    mk(s,'line',{x1:x0,y1:y,x2:x1,y2:y,stroke:'var(--grid)','stroke-width':1});
    txt(s,x0-8,y+4,String(v),{'font-size':11,fill:'var(--muted)','text-anchor':'end'});
  }
  cs.forEach(function(c,i){
    const x=x0+step*i, h=c/mx*(yb-y0);
    const b=mk(s,'rect',{x:x+2,y:yb-h,width:step-4,height:Math.max(2,h),rx:5,fill:g});
    txt(s,x+step/2,yb-h-7,String(c),{'font-size':11.5,fill:'var(--ink)','text-anchor':'middle','font-weight':600});
    bindTip(b,'分数 ≈ '+ax[i]+'<br>'+c+' 局');
  });
  D.meta.q.forEach(function(q){
    if(q<ax[0]||q>ax[ax.length-1]) return;
    const x=x0+(q-ax[0])/(ax[ax.length-1]-ax[0]+1)*(x1-x0);
    mk(s,'line',{x1:x,y1:y0,x2:x,y2:yb,stroke:'var(--axis)','stroke-width':1.5,'stroke-dasharray':'5 4'});
  });
  txt(s,x0,18,'横轴：官方 game_score　纵轴：局数　虚线 = P25/P50/P75',{'font-size':12,fill:'var(--muted)'});
  $('#c-hist').appendChild(s);
})();
$('#hist-note').innerHTML = '中位数 <b>'+D.meta.q[2]+'</b>，一半的局落在 <b>'+D.meta.q[1]+' ~ '+D.meta.q[3]+'</b> 之间。'
  + '赢局均分 <b>'+D.winLoss.win+'</b> vs 输局 <b>'+D.winLoss.lose+'</b> —— 差 '+Math.abs(D.winLoss.win-D.winLoss.lose)
  + ' 分，<b>不大</b>。这印证了评分主要看个人数据而不是胜负。';

// 1.2 月度
(function(){
  const ms=D.months;
  const W=900,H=320,x0=70,x1=830,y0=56,yb=250;
  const s=svgEl(W,H);
  const gA=grad(s,'ar','var(--s1)',0.07);
  const mn=Math.min.apply(null,ms.map(m=>m.wr))-8, mx=Math.max.apply(null,ms.map(m=>m.wr))+8;
  for(let k=0;k<=4;k++){
    const v=mn+(mx-mn)*k/4, y=yb-(v-mn)/(mx-mn)*(yb-y0);
    mk(s,'line',{x1:x0,y1:y,x2:x1,y2:y,stroke:'var(--grid)','stroke-width':1});
    txt(s,x0-8,y+4,fmt(v,0)+'%',{'font-size':11,fill:'var(--muted)','text-anchor':'end'});
  }
  const step=ms.length>1?(x1-x0)/(ms.length-1):0;
  let line='',area='';
  ms.forEach(function(m,i){
    const x=x0+step*i,y=yb-(m.wr-mn)/(mx-mn)*(yb-y0);
    line+=(i?' L':'M')+x+' '+y; area+=(i?' L':'M')+x+' '+y;
  });
  area+=' L'+x1+' '+yb+' L'+x0+' '+yb+' Z';
  mk(s,'path',{d:area,fill:gA,stroke:'none'});
  mk(s,'path',{d:line,fill:'none',stroke:'var(--s1)','stroke-width':2.6,'stroke-linejoin':'round'});
  ms.forEach(function(m,i){
    const x=x0+step*i,y=yb-(m.wr-mn)/(mx-mn)*(yb-y0);
    const c=mk(s,'circle',{cx:x,cy:y,r:6,fill:'var(--s1)',stroke:'var(--surf)','stroke-width':2.5});
    txt(s,x,y-15,fmt(m.wr)+'%',{'font-size':13,fill:'var(--ink)','text-anchor':'middle','font-weight':650});
    txt(s,x,yb+20,m.m.slice(2)+'月',{'font-size':12,fill:'var(--ink)','text-anchor':'middle'});
    txt(s,x,yb+36,m.n+' 局',{'font-size':11,fill:'var(--muted)','text-anchor':'middle'});
    txt(s,x,yb+52,'均分 '+m.score,{'font-size':11,fill:'var(--muted)','text-anchor':'middle'});
    bindTip(c,m.m+'<br>'+m.n+' 局 · 胜率 '+fmt(m.wr)+'%<br>官方均分 '+m.score+'<br>MVP '+m.mvp+' · SVP '+m.svp);
  });
  txt(s,x0,18,'横轴：月份　纵轴：胜率（下方标注官方均分）',{'font-size':12,fill:'var(--muted)'});
  $('#c-month').appendChild(s);
})();
(function(){
  const ms=D.months, a=ms[0], b=ms[ms.length-1];
  $('#month-note').innerHTML = '胜率从 '+a.m.slice(2)+'月的 <b>'+fmt(a.wr)+'%</b> 一路降到 '+b.m.slice(2)+'月的 <b>'+fmt(b.wr)+'%</b>，'
    + '但<b>官方均分几乎没动</b>（'+a.score+' → '+b.score+'）。'
    + '<b>这个组合很说明问题</b>：分数衡量的是个人数据，胜率衡量的是输赢 —— 你这几个月个人数据没退步，但赢的次数变少了。';
})();

// 2 组队人数（子弹图）
(function(){
  const ps=D.party;
  const rowH=52, top=52, W=900, lab=110, padR=210, x0=lab, x1=W-padR;
  const s=svgEl(W,H=top+ps.length*rowH+30);
  const ymax=80;
  const px=v=>x0+v/ymax*(x1-x0);
  for(let k=0;k<=4;k++){
    const v=ymax*k/4,x=px(v);
    mk(s,'line',{x1:x,y1:top-10,x2:x,y2:top+ps.length*rowH-10,stroke:'var(--grid)','stroke-width':1});
    txt(s,x,top-16,fmt(v,0)+'%',{'font-size':11,fill:'var(--muted)','text-anchor':'middle'});
  }
  const bx=px(D.meta.wr);
  mk(s,'line',{x1:bx,y1:top-10,x2:bx,y2:top+ps.length*rowH-10,stroke:'var(--axis)','stroke-width':2,'stroke-dasharray':'5 4'});
  txt(s,W-8,top-16,'整体胜率 '+fmt(D.meta.wr)+'%',{'font-size':11.5,fill:'var(--ink2)','text-anchor':'end'});
  ps.forEach(function(p,i){
    const y=top+i*rowH;
    txt(s,0,y+26,p.size+' 人排',{'font-size':13.5,fill:'var(--ink)','font-weight':600});
    mk(s,'rect',{x:x0,y:y+10,width:x1-x0,height:22,rx:6,fill:'var(--grid)','fill-opacity':0.35});
    const w=Math.max(3,px(p.wr)-x0);
    const b=mk(s,'rect',{x:x0,y:y+10,width:w,height:22,rx:6,
      fill: p.wr>=D.meta.wr?'var(--up)':'var(--down)','fill-opacity':0.85});
    txt(s,x0+w+10,y+26,fmt(p.wr)+'%',{'font-size':15,fill:'var(--ink)','font-weight':680});
    txt(s,x1+14,y+19,'官方均分 '+p.score,{'font-size':11.5,fill:'var(--ink2)'});
    txt(s,x1+14,y+34,p.mvp+' MVP · '+p.svp+' SVP · '+p.n+' 局',{'font-size':10.5,fill:'var(--muted)'});
    bindTip(b,p.size+' 人排<br>'+p.n+' 局 · 胜率 '+fmt(p.wr)+'%<br>我的官方均分 '+p.score+'<br>MVP '+p.mvp+' · SVP '+p.svp);
  });
  $('#c-party').appendChild(s);
})();
(function(){
  const ps=D.party, best=ps.reduce((a,b)=>a.wr>b.wr?a:b), worst=ps.reduce((a,b)=>a.wr<b.wr?a:b);
  $('#party-note').innerHTML = '官方字段 <code>team_made_size</code> 直接给出每局几个人一起排。<b>'
    + best.size+' 人排胜率最高（'+fmt(best.wr)+'%）</b>，'+worst.size+' 人排最低（'+fmt(worst.wr)+'%）。'
    + '<br>注意两点：① 曲线<b>不单调</b>；② 4 人排和 5 人排只有 '+ps[3].n+' / '+ps[4].n+' 局，噪声很大。'
    + '另外<b>人越多，我自己的官方均分越低</b>（'+ps[0].score+' → '+ps[ps.length-1].score+'）—— 人多了自然有人分数据。';
})();

// 3 队友（棒棒糖）
function lollipop(host, items, o){
  const rowH=o.rowH||34, top=44, W=900, lab=o.lab||140, padR=o.padR||70;
  const x0=lab, x1=W-padR;
  const s=svgEl(W,H=top+items.length*rowH+30);
  const mx=Math.max.apply(null,items.map(d=>Math.abs(d.diff)).concat([1]));
  const VW=o.VW||230;
  const S=Math.max(60,(x1-x0-2*VW)/2), scale=S/mx, cx=x0+VW+S;
  mk(s,'line',{x1:cx,y1:top-12,x2:cx,y2:top+items.length*rowH-10,stroke:'var(--axis)','stroke-width':1.5});
  txt(s,cx,16,o.centerLabel||'全队平均',{'font-size':11.5,fill:'var(--muted)','text-anchor':'middle'});
  items.forEach(function(d,i){
    const y=top+i*rowH, w=Math.abs(d.diff)*scale;
    const ex=d.diff>=0?cx+w:cx-w;
    mk(s,'line',{x1:cx,y1:y,x2:ex,y2:y,stroke:d.diff>=0?'var(--up)':'var(--down)','stroke-width':2.5,'stroke-linecap':'round'});
    const c=mk(s,'circle',{cx:ex,cy:y,r:6,fill:d.diff>=0?'var(--up)':'var(--down)',stroke:'var(--surf)','stroke-width':2});
    txt(s,0,y+5,d.label,{'font-size':12.5,fill:'var(--ink)'});
    const anchor=d.diff>=0?'start':'end';
    const tx=d.diff>=0?cx+w+11:cx-w-11;
    txt(s,tx,y+1,d.main,{'font-size':12,fill:'var(--ink)','font-weight':650,'text-anchor':anchor});
    txt(s,tx,y+14,d.sub||'',{'font-size':10.5,fill:'var(--muted)','text-anchor':anchor});
    bindTip(c,d.tip||d.label);
  });
  if(o.title) txt(s,0,16,o.title,{'font-size':12,fill:'var(--muted)'});
  host.appendChild(s);
}
(function(){
  const ms=D.mates;
  const avg=Math.round(ms.reduce((a,m)=>a+m.avgScore*m.n,0)/ms.reduce((a,m)=>a+m.n,0));
  lollipop($('#c-mates-score'), ms.map(function(m){
    const dd=m.avgScore-avg;
    return {label:m.name, diff:dd, main:String(m.avgScore),
      sub:'较中位 '+(dd>0?'+':'')+dd+' · 同队 '+m.n+' 局 · 胜率 '+fmt(m.wr)+'%',
      tip:m.name+'<br>同队 '+m.n+' 局 · 胜率 '+fmt(m.wr)+'%<br>官方均分 '+m.avgScore+'<br>MVP '+m.mvp+' · SVP '+m.svp+'<br>KDA '+m.kda+' · 场均伤害 '+m.dmg};
  }), {centerLabel:'这些队友的均分中位', lab:140, rowH:36, VW:240,
       title:'官方均分（相对这批队友的平均）'});
})();
(function(){
  const ms=D.mates.slice().sort((a,b)=>b.rate-a.rate);
  lollipop($('#c-mates-mvp'), ms.map(function(m){
    const a=Math.max(0, m.mvp-m.svp), b=Math.max(0, m.svp-m.mvp);
    return {label:m.name, diff:(a>0?1:-1)*Math.max(a,b,1), main:'MVP '+m.mvp+' · SVP '+m.svp,
      sub:m.rate+'% 的局拿到 MVP 或 SVP',
      tip:m.name+'<br>同队 '+m.n+' 局<br>MVP '+m.mvp+' 次 · SVP '+m.svp+' 次<br>合计 '+m.rate+'%'};
  }), {centerLabel:'MVP/SVP 数量对比', lab:140, rowH:34, VW:250,
       title:'蓝色向外 = MVP 多，红色向外 = SVP 多'});
})();
(function(){
  const ms=D.mates, top=ms[0];
  $('#mates-note').innerHTML = '官方均分最高的是 <b>'+top.name+'</b>（'+top.avgScore+'，同队 '+top.n+' 局），'
    + '但他的同队胜率只有 <b>'+fmt(top.wr)+'%</b>。'
    + '<br><b>这批队友里，「官方均分」和「同队胜率」的相关系数是 r = '+D.corr+'（负相关）</b> —— '
    + '分越高的人，和你一起赢的次数反而越少。'
    + '<br>原因是这套评分<b>几乎只看个人数据</b>（KDA + 经济占 67%），资源有限时一个人拿高分就意味着另一个人被挤压。'
    + '⚠ 但只有 '+ms.length+' 个队友、样本 8–248 局，<b>这个负相关不显著</b>，当线索看。';
})();

// 4.1 权重
(function(){
  const W=[['相对 KDA',34.4],['相对经济',32.7],['相对承伤',11.9],['相对治疗',7.2],
           ['胜负',6.2],['相对控制时间',5.1],['相对伤害',1.5],['推塔',1.0]];
  const rowH=38, top=50, Wd=900, lab=150, padR=90;
  const x0=lab, x1=Wd-padR;
  const s=svgEl(Wd,H=top+W.length*rowH+24);
  const g=grad(s,'w','var(--s1)',0.7);
  const gd=grad(s,'wd','var(--down)',0.75);
  W.forEach(function(d,i){
    const y=top+i*rowH, w=d[1]/35*(x1-x0);
    const isKey=d[1]>=5;
    const b=mk(s,'rect',{x:x0,y:y,width:Math.max(3,w),height:20,rx:5,
      fill: d[0].indexOf('伤害')>=0?gd:g});
    txt(s,0,y+15,d[0],{'font-size':13,fill:'var(--ink)'});
    txt(s,x0+w+9,y+15,fmt(d[1])+'%',{'font-size':13,fill:isKey?'var(--ink)':'var(--muted)','font-weight':isKey?650:400});
    bindTip(b,d[0]+' 权重 '+fmt(d[1])+'%');
  });
  txt(s,0,18,'标准化后的相对权重（把分数解释掉的方差里，各占多少）',{'font-size':12,fill:'var(--muted)'});
  $('#c-weights').appendChild(s);
})();
$('#weights-note').innerHTML = '<b>只看个人数据的这套评分里，伤害几乎不计分（1.5%）。</b>'
  + 'KDA + 经济合起来占 67%，而「承伤 + 治疗 + 控制时间」合计 24% —— 这些辅助向的指标比伤害重要 16 倍。'
  + '<br>这也解释了为什么血魔战士 / 半肉容易拿高分，而纯输出和纯坦克都吃亏。';

// 5 英雄（散点）
(function(){
  const hs=D.heroes;
  if(!hs.length){ return; }
  const W=900,H=380,x0=80,x1=840,y0=50,yb=320;
  const s=svgEl(W,H);
  const ns=hs.map(h=>h.n), ws=hs.map(h=>h.wr), ss=hs.map(h=>h.score);
  const nmn=Math.min.apply(null,ns)*0.8, nmx=Math.max.apply(null,ns)*1.1;
  const wmn=Math.min.apply(null,ws)-5, wmx=Math.max.apply(null,ws)+5;
  const px=v=>x0+(v-nmn)/(nmx-nmn)*(x1-x0);
  const py=v=>yb-(v-wmn)/(wmx-wmn)*(yb-y0);
  for(let k=0;k<=4;k++){
    const v=wmn+(wmx-wmn)*k/4, y=py(v);
    mk(s,'line',{x1:x0,y1:y,x2:x1,y2:y,stroke:'var(--grid)','stroke-width':1});
    txt(s,x0-9,y+4,fmt(v,0)+'%',{'font-size':11,fill:'var(--muted)','text-anchor':'end'});
  }
  const yB=py(D.meta.wr);
  mk(s,'line',{x1:x0,y1:yB,x2:x1,y2:yB,stroke:'var(--axis)','stroke-width':2,'stroke-dasharray':'5 4'});
  txt(s,x1,yB-6,'整体胜率 '+fmt(D.meta.wr)+'%',{'font-size':11.5,fill:'var(--ink2)','text-anchor':'end'});
  const smn=Math.min.apply(null,ss), smx=Math.max.apply(null,ss);
  hs.forEach(function(h){
    const r=6+ (h.score-smn)/(smx-smn+1)*12;
    const up=h.wr>=D.meta.wr;
    const c=mk(s,'circle',{cx:px(h.n),cy:py(h.wr),r:r,
      fill:up?'var(--up)':'var(--down)','fill-opacity':0.4,
      stroke:up?'var(--up)':'var(--down)','stroke-width':2});
    txt(s,px(h.n),py(h.wr)-r-6,h.name,{'font-size':11,fill:'var(--ink)','text-anchor':'middle','font-weight':600});
    bindTip(c,h.name+'（ID '+h.champ+'）<br>'+h.n+' 局 · 胜率 '+fmt(h.wr)+'%<br>官方均分 '+h.score);
  });
  txt(s,x0,18,'横轴：这个英雄打了几局　纵轴：胜率　气泡大小 = 官方均分',{'font-size':12,fill:'var(--muted)'});
  $('#c-heroes').appendChild(s);
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
