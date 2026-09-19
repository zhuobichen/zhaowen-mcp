// 结论方向审计：结论说的方向，跟数字的方向一致吗？
//
// audit-verdict 查的是「结论引用的数字在不在明细里」——那是**引对没有**。
// 这个查的是**说反没有**：
//   · 方向词与数字符号不一致（说「变强了」但差值是负的）
//   · 点名的对象不是极值（说「最吃力的是 X」，但 X 的残差不是最低的）
//
// 这类错误比数字抄错更严重 —— 数字错了读者能自己看出来，方向说反了读者会直接信。
//
// 判据完全基于工具自己的输出：从结论行取方向词，从输出里取数字，比符号。
// 不依赖任何外部真值，所以以后改了算法这个检查依然有效。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

// 方向词表：看到这些词，结论就在断言某个方向
const UP_WORDS = /变强|好了|有所提升|赢了更多|赢面更大|更高|更稳|进步/;
const DOWN_WORDS = /变差|差了|下滑|走低|掉了|更低|没找到手感|退步/;
const FLAT_WORDS = /基本持平|看不出|没有明显影响|差不多|没有趋势/;

const CASES = [
  { tool: "get_my_trend", args: {} },
  { tool: "get_my_tilt", args: {} },
  { tool: "get_my_contribution", args: {} },
  { tool: "get_my_patches", args: {} },
  { tool: "get_enemy_comps", args: {} },
  { tool: "get_combat_profile", args: {} },
  { tool: "get_my_matchups", args: {} },
];

/**
 * 判据本体：给一句结论，返回矛盾说明或 null。
 * 抽成函数是为了能自测 —— **一个从没报过错的检查等于没有检查**，
 * 得先确认它真的会为矛盾的说法报警，再去信它的「全部通过」。
 */
function contradiction(v) {
  // 先把**被明确标注为噪声/标准误**的数字剔掉，再取幅度。
  //
  // 起因：tilt 改成跟噪声比之后，结论里会出现「那一档只有 36 局，它自己的噪声
  // （一个标准误）就有 ±8.3 个百分点，两者分不开」。而本判据取的是**最后一个**百分数
  // 当幅度 —— 于是把「噪声有多大」当成了「结论主张了多大的差」，误报成
  // 「说『差不多』但幅度到了 8.3」。
  //
  // 只剔「明说是噪声」的那一小句，不放松别处：真正自相矛盾的
  // 「两人基本持平（差 12.0 个百分点）」里没有噪声字样，照样会被抓（自测里有这条）。
  const denoised = v.replace(/[（(]?[^。；，]*?(噪声|标准误)[^。；]*?个百分点/g, "");
  const pctMatches = [...denoised.matchAll(/([+-]?\d{1,3}\.\d)\s*个百分点/g)];
  if (!pctMatches.length) return null;
  const delta = Number(pctMatches[pctMatches.length - 1][1]);
  const hasUp = UP_WORDS.test(v);
  const hasDown = DOWN_WORDS.test(v);
  const hasFlat = FLAT_WORDS.test(v);
  if (hasUp && !hasDown && delta < 0) return `说「${(v.match(UP_WORDS) ?? [""])[0]}」但幅度是负的（${delta}）`;
  if (hasDown && !hasUp && delta > 0) return `说「${(v.match(DOWN_WORDS) ?? [""])[0]}」但幅度是正的（${delta}）`;
  if (hasFlat && Math.abs(delta) >= 8) {
    // 例外：文本里**自己给出了噪声**、而且噪声不比自己小 —— 那「分不开」就是有依据的，
    // 幅度大不代表效应大（trend 会写「差 10.3 个百分点，噪声 9.8 个百分点，两者分不开」）。
    // 没有噪声数字时的「基本持平（差 12.0 个百分点）」照样会被抓。
    //
    // 判据要跟**工具自己的标准**对齐，而不是「差值 ≥ 噪声就算矛盾」——
    // 工具几轮前就改成按**2 倍标准误**判了（不到 2 倍就说「分不开」），
    // 而这条老规则还停在「差值 ≥ 噪声」。结果：
    //   · trend  差 10.3 / 噪声 9.8（1.05 倍）→ 工具说「分不开」是对的，却被判矛盾
    //   · patches 差 27.8 / 噪声 14.2（1.95 倍）→ 同上
    //   · combat 差 9.4（1.13 倍，正文只给倍数不给噪声值）→ 同上
    // 三处都是**审计判据过期**，不是工具错。三处一起报出来才发现的。
    // 噪声值的写法不止「噪声 9.8 个百分点」一种 —— 也写成「噪声约 14.2，1.95 倍」
    // （**没有「个百分点」后缀**）。只认带后缀的那种会漏掉后者（自测里那条就是这么失败的）。
    // 后面紧跟「倍」的不要（那是倍数，不是噪声值）。
    const noises = [...v.matchAll(/(?:噪声|标准误)[^。；]*?([\d.]+)(?!\s*倍)/g)].map((m) => Number(m[1]));
    if (noises.some((n) => Number.isFinite(n) && Math.abs(delta) < 2 * n)) return null;
    // 正文只给倍数、不给噪声值时（如「约是噪声的 1.13 倍」），也一样认
    const mults = [...v.matchAll(/噪声的\s*([\d.]+)\s*倍/g)].map((m) => Number(m[1]));
    if (mults.some((m) => Number.isFinite(m) && m < 2)) return null;
    return `说「差不多/没有影响」但幅度到了 ${delta} 个百分点`;
  }
  return null;
}

// 自测：合成的矛盾句必须被抓住，正常的必须放过
if (process.argv.includes("--selftest")) {
  const cases = [
    ["结论：最近好了 -9.5 个百分点，是在变强。", true],
    ["结论：状态在下滑，差了 +4.0 个百分点。", true],
    ["结论：两人基本持平（差 12.0 个百分点）。", true],
    ["结论：最近好了 +9.5 个百分点，是在变强。", false],
    ["结论：状态在下滑，差了 -4.0 个百分点。", false],
    ["结论：基本持平（差 1.2 个百分点）。", false],
    ["结论：对面阵容构成对你没有明显影响：极差只有 3.0 个百分点。", false],
    // 噪声标注过的数字不算「主张的幅度」—— tilt 改版后就是这个形状。
    // 这条是**反证**：去掉 denoised 那步之后它会误报，所以留着守住那个修复。
    // 用**真实文案**（从 lib/tilt.ts 跑出来那句照抄），不要自己缩写 ——
    // 第一版我截断成「…两者分不开。」，漏掉了触发 flat 判据的「没有额外影响」，
    // 于是这条用例在反证里照样通过，等于没测到东西。
    [
      "结论：都在整体胜率附近波动：偏离最大的一档是 -6.0 个百分点，而那一档只有 36 局，它自己的噪声（一个标准误）就有 ±8.3 个百分点，两者分不开 —— 看不出明显的上头或越打越好。注意胜率本来就会向 50% 回归，所以「接近基准」本身就说明没有额外影响。",
      false,
    ],
    // 但「明说是噪声」不能成为挡箭牌：同一条结论里真主张了大差，照样要报。
    // 这条刻意只用 flat 措辞（不出现「差了/走低」这类方向词），
    // 否则会被方向那条规则先抓住、验不到「剔噪声之后幅度判据还灵不灵」。
    [
      "结论：两者基本持平，噪声约 ±2.0 个百分点，而极差有 12.0 个百分点。",
      true,
    ],
    // 文本自己给出了噪声、且噪声不比幅度小时，「分不开」是有依据的 —— 该放过。
    // 反证：去掉那条例外（noises.some(...)）之后，这条会被误报成「幅度到了 9.5」。
    [
      "结论：最近 4 个有效周 58 把 50.0%，之前 4 个有效周 42 把 40.5% —— 两者分不开（差 9.5 个百分点，噪声（一个标准误）10.0 个百分点），看不出趋势性变化。",
      false,
    ],
    // 但**噪声比自己小**时不算数：差 12.0 > 噪声 2.0，还是矛盾
    [
      "结论：两者基本持平 —— 差 12.0 个百分点，噪声 2.0 个百分点。",
      true,
    ],
    // 下面三条是 2026-09-19 跑审计时**真实报出来的**（工具判据早就改成 2 倍标准误，
    // 而这条老规则还停在「差值 ≥ 噪声」，于是把三处正确的结论判成了矛盾）。
    // 抄进自测，防止它再退回去。
    [
      "结论：最近 4 个有效周 65 把 50.8%，之前 4 个有效周 42 把 40.5% —— 两者分不开（差 10.3 个百分点，噪声（一个标准误）9.8 个百分点），看不出趋势性变化。",
      false,
    ],
    [
      "结论：当前补丁 16.18=26.18：18 局 72.2%；上一个补丁 16.16=26.16：27 局 44.4% —— 基本持平（差 27.8 个百分点，噪声约 14.2，1.95 倍）。",
      false,
    ],
    [
      "结论：控制时间（有值行数占比 93%）：队内第一 50.0%（48 局） / 第 4 名及以后合并 59.4%（138 局），差 -9.4 个百分点（约是噪声的 1.13 倍） —— 看不出这项与胜负有关。",
      false,
    ],
  ];
  let bad = 0;
  for (const [text, shouldCatch] of cases) {
    const hit = contradiction(text);
    const ok = shouldCatch ? !!hit : !hit;
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} ${shouldCatch ? "应报错" : "应放过"}：${text}`);
    if (hit) console.log(`      → ${hit}`);
  }
  console.log("");
  console.log(bad ? `✗ 自测 ${bad} 条不通过 —— 判据本身有问题` : `✓ 自测通过（${cases.length} 条）`);
  process.exit(bad ? 1 : 0);
}

const child = spawn(process.execPath, [TSX, path.join(ROOT, "index.ts")], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, MAYHEM_NO_WRITES: "1" } });
let buf = "";
const pending = new Map();
let nextId = 1;
child.stdout.on("data", (d) => {
  buf += d.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const m = JSON.parse(line);
      const r = pending.get(m.id);
      if (r) {
        pending.delete(m.id);
        r(m);
      }
    } catch {
      /* 忽略 */
    }
  }
});
child.stderr.on("data", () => {});
const send = (method, params, timeoutMs = 180000) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => reject(new Error("超时")), timeoutMs);
    pending.set(id, (m) => {
      clearTimeout(t);
      resolve(m);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "dir", version: "1" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

let problems = 0;
let checked = 0;

for (const { tool, args } of CASES) {
  let text = "";
  try {
    const r = await send("tools/call", { name: tool, arguments: args });
    text = r.result?.content?.[0]?.text ?? "";
  } catch {
    continue;
  }
  const lines = text.split("\n");
  const verdicts = lines.filter((l) => l.startsWith("结论：") || /：队内第一 .*差 .* 个百分点/.test(l));
  if (!verdicts.length) continue;

  for (const v of verdicts) {
    // 结论里最后出现的那个「X 个百分点」是它给出的关键幅度
    checked++;
    const bad = contradiction(v);
    if (bad) {
      problems++;
      console.log(`✗ ${tool}`);
      console.log(`    ${bad}`);
      console.log(`    结论：${v.slice(0, 120)}`);
    }
  }
}

// 结构性检查：点名的对象是不是极值
{
  const r = await send("tools/call", { name: "get_my_matchups", arguments: {} });
  const text = r.result?.content?.[0]?.text ?? "";
  const verdict = text.split("\n").find((l) => l.startsWith("结论："));
  if (verdict) {
    checked++;
    // 列表行形如：  · 对面有 X：12 把 · ... → 残差 -20.3
    const rows = [...text.matchAll(/对面有\s*(\S+?)：(\d+)\s*把[\s\S]*?残差\s*([+-]?\d+\.\d)/g)].map((m) => ({
      champ: m[1],
      residual: Number(m[3]),
    }));
    const namedWorst = /最吃力的是对面有\s*(\S+?)（/.exec(verdict)?.[1];
    const namedBest = /最稳的是对面有\s*(\S+?)（/.exec(verdict)?.[1];
    if (rows.length > 1) {
      const minR = Math.min(...rows.map((x) => x.residual));
      const maxR = Math.max(...rows.map((x) => x.residual));
      const worstRow = rows.find((x) => x.champ === namedWorst);
      const bestRow = rows.find((x) => x.champ === namedBest);
      let bad = null;
      if (worstRow && namedWorst && worstRow.residual !== minR) {
        bad = `点名「最吃力」是 ${namedWorst}（残差 ${worstRow.residual}），但列表里最低的是 ${minR}`;
      }
      if (bestRow && namedBest && bestRow.residual !== maxR) {
        bad = `点名「最稳」是 ${namedBest}（残差 ${bestRow.residual}），但列表里最高的是 ${maxR}`;
      }
      if (bad) {
        problems++;
        console.log(`✗ get_my_matchups（点名与极值不符）\n    ${bad}`);
      } else {
        console.log(`✓ get_my_matchups：点名的克星/提款机确实是列表里的两个极值（${minR} / ${maxR}）`);
      }
    }
  }
}
child.kill();

console.log("");
console.log(
  problems
    ? `✗ ${problems} 处结论的方向与数字对不上`
    : `✓ 检查了 ${checked} 处结论，方向词与数字符号全部一致`
);
process.exit(problems ? 1 : 0);
