// 置信措辞审计（两层）：
//   第一层 · 样本量：结论说的「有多确定」，跟它点名的那个对象的**样本量**匹配吗？
//   第二层 · 效应 vs 噪声：那个差，比噪声大了吗？（样本够 ≠ 撑得住）
//
// 这是「结论有没有意义」里唯一能机器判的部分。别的（结论有不有用）要人看，
// 但**置信度与样本不匹配**是可查的，而且是真 bug：
//
//   结论：最吃力的是对面有 X（12 把，残差 -20.3）… 样本量够，这几条可以当真。
//
// 12 把的胜率 95% 区间大约 ±28 个百分点，残差 -20.3 跟 0 根本区分不开 ——
// 说「可以当真」是**超出数据撑得起的把握**。用户照着改出装，可能是在追噪声。
//
// 判据：从结论里抽出它点名的样本量（「N 把」），取最小值；
// 再看措辞是「强把握」还是「有保留」。强把握 + 样本小 = 过度声称。
//
// 阈值 30 的来由：这是本仓库各处用的「单个分组下结论」门槛量级
// （matchups 用 12、combat 用 15、trend 用 5 局/周但至少 2 周）——
// 对**被点名的单个对象**来说，30 以下都撑不起「可以当真」这种话。
//
// 第二层的来由：第一层只看样本量，漏得掉。tilt 就是漏网案例 —— 36 局 ≥ 30 放行，
// 可它的效应只有 6.0 个百分点，而 36 局的标准误就有 8.3 个百分点（0.7 倍）。
// 是先做「门槛扫描」（tools/thresholds-sweep.ts）偶然量出来的，不是这一层挡住的。
// 现在补上了：效应不到 2 倍标准误还说「明显」的，报 ⚠。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

// 强把握措辞：出现这些就等于在对用户说「信我」
const STRONG = /可以当真|够下结论|明显|确凿|确定是|样本量够|很稳|相当明显/;
// 有保留的措辞：出现这些说明工具自己已经打了折扣
const HEDGED = /样本少|样本不足|先当参考|仅供参考|不足以|可能|大概|谨慎|还不多|样本还/;

/**
 * 把**否定用法**的强把握词去掉再判。
 *
 * 起因：tilt 改成跟噪声比之后，结论里写「看不出**明显**的上头或越打越好」——
 * 那是在**不下判断**，可 STRONG 照样匹配到了「明显」，判据于是报它「说『明显』撑不住」。
 * 否定句里的「明显」不是主张，是「没有主张」，不能算数。
 *
 * 只处理紧挨着的否定（「看不出明显的」「没有明显」），不做通用否定识别 ——
 * 做宽了会把「没有明显影响，反而更稳」这种前半否定后半肯定的句子也吞掉。
 */
function stripNegated(t) {
  return t.replace(/(看不出|看不着|没有|未见|无)[^，。；、]{0,6}?(明显|确凿|很稳|相当明显)/g, "");
}

/** 判据本体（抽出来便于自测） */
export function overclaim(verdict) {
  if (HEDGED.test(verdict)) return null; // 自己已打折扣就不算过度声称
  const strongText = stripNegated(verdict);
  if (!STRONG.test(strongText)) return null; // 没有强把握措辞（否定用法不算）
  // 只数**样本量**。要排除「连输 3 把及以上」这种门槛数字 —— 那个 3 是连败计数，
  // 不是样本量（第一版把它当成样本，误报了 get_my_tilt）。
  const samples = [...verdict.matchAll(/(\d+)\s*(?:把|局|次)(?!及以上|以上)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n > 0);
  if (!samples.length) return null;
  const min = Math.min(...samples);
  if (min >= 30) return null;
  return `说「${(strongText.match(STRONG) ?? [""])[0]}」，但结论点名的对象最小的样本只有 ${min}（阈值 30）`;
}

/** 两个比例之差的标准误（百分点） */
function seOfDiff(n1, p1, n2, p2) {
  if (n1 < 1 || n2 < 1) return Number.NaN;
  return Math.sqrt((p1 * (100 - p1)) / n1 + (p2 * (100 - p2)) / n2);
}

/**
 * 第二层判据：**效应跟噪声分得开吗**。
 *
 * 上面那条只看样本量 —— 不够。这次 tilt 就是漏网案例：36 局 ≥ 30 所以放行，
 * 可它的效应只有 6.0 个百分点，而 36 局的标准误就有 8.3 个百分点（比值 0.7）。
 * 样本量够 ≠ 结论撑得住；还得看效应有没有超过噪声。
 *
 * 判据：从结论里抽出「N 局/把 · P%」这样的配对，
 *   · 有两组以上 → 拿差最大的那两组算两比例检验的 z；
 *   · 只有一组、且带「比整体 ±X」这类偏差 → 拿该组的 SE 当分母算 z。
 * z < 2（≈95%）还说「明显/确定」的，就是撑不住。
 *
 * 抽成函数便于自测，返回说明或 null。
 */
export function weakEffect(verdict) {
  if (HEDGED.test(verdict)) return null;
  const strongText = stripNegated(verdict);
  if (!STRONG.test(strongText)) return null;

  // 配对：N 局/把 … P%。
  // `(?!及以上|以上)` 不能省 —— 「连输 3 把及以上之后：36 局 47.2%」里那个 3 是连败计数，
  // 不是样本量。第一版没排除它，把 3 当成了样本，算出标准误 29.1、z=0.1：
  // 结论（该报）虽然对了，但理由是错的 —— 报错行说错原因比不报还坏。
  const pairs = [...verdict.matchAll(/(\d+)\s*(?:把|局)(?!及以上|以上)[^。；]{0,24}?(\d{1,3}\.\d)\s*%/g)].map((m) => ({
    n: Number(m[1]),
    p: Number(m[2]),
  }));
  const usable = pairs.filter((x) => x.n > 0 && x.p > 0 && x.p < 100);
  if (!usable.length) return null; // 抽不出配对就不判，宁可不报也别猜

  const seOf = (x) => Math.sqrt(Math.max(x.p * (100 - x.p), 1) / x.n);
  /** 括号里的偏差，如「（比整体 -6.0）」 */
  const bracketDelta = (t) => {
    const m = t.match(/[（(](?:比整体)?\s*([+-]\d+(?:\.\d+)?)\s*[）)]/);
    return m ? Math.abs(Number(m[1])) : null;
  };

  let z = Number.NaN;
  let desc = "";
  // 结论里**明说**的那个数才是它主张的效应 —— 优先用它，别自己挑两组去算
  const quoted = verdict.match(/(?:差|最多)\s*([+-]?\d+(?:\.\d+)?)\s*个百分点/);
  const twoPlus = usable.length >= 2;
  let bestPair = null;
  if (twoPlus) {
    for (let i = 0; i < usable.length; i++)
      for (let j = i + 1; j < usable.length; j++) {
        const d = Math.abs(usable[i].p - usable[j].p);
        if (!bestPair || d > bestPair.d) bestPair = { d, a: usable[i], b: usable[j] };
      }
  }

  if (quoted && twoPlus && bestPair) {
    // 明说了幅度 + 有对照组：用明说的那个数，对照度的分母取差最大的两组
    const se = seOfDiff(bestPair.a.n, bestPair.a.p, bestPair.b.n, bestPair.b.p);
    z = Math.abs(Number(quoted[1])) / se;
    desc = `${Math.abs(Number(quoted[1])).toFixed(1)} 个百分点（结论自己写的），标准误 ${se.toFixed(1)}`;
  } else if (twoPlus && bestPair) {
    const se = seOfDiff(bestPair.a.n, bestPair.a.p, bestPair.b.n, bestPair.b.p);
    z = bestPair.d / se;
    desc = `${bestPair.d.toFixed(1)} 个百分点（${bestPair.a.n} 局 ${bestPair.a.p}% vs ${bestPair.b.n} 局 ${bestPair.b.p}%），标准误 ${se.toFixed(1)}`;
  } else {
    // 单组：只能拿括号里那个「比整体 ±X」当主张的幅度
    const x = usable[0];
    const d = bracketDelta(verdict);
    if (d != null) {
      const se = seOf(x);
      z = d / se;
      desc = `${d.toFixed(1)} 个百分点（${x.n} 局 ${x.p}% 偏离基准），标准误 ${se.toFixed(1)}`;
    }
  }
  if (!Number.isFinite(z)) return null;
  if (z >= 2) return null;
  return (
    `说「${(strongText.match(STRONG) ?? [""])[0]}」，但效应只有 ${desc} —— ` +
    `只到噪声的 ${z.toFixed(2)} 倍（2 倍才算分得开）`
  );
}

if (process.argv.includes("--selftest")) {
  const cases = [
    ["结论：最吃力的是对面有 X（12 把，残差 -20.3）—— 样本量够，这几条可以当真。", true],
    ["结论：最近 4 个有效周 58 把 50.0%，之前 4 个 42 把 40.5% —— 最近好了 9.5 个百分点。", false],
    ["结论：连输 2 把及以上之后 71 局 49.3% —— 明显走低。", false],
    ["结论：你伤害全队第一时 110 局 61.8%，排到第三及以后 128 局 49.2% —— 差得明显。", false],
    ["结论：最吃力的是对面有 X（12 把）—— 但样本还不多，先当参考。", false],
    ["结论：输一把后 143 局 50.3%，连输 3 把及以上 36 局 47.2% —— 明显走低。", false],
  ];
  // 第二层判据的自测
  const weakCases = [
    // 样本够（36 ≥ 30）但效应撑不住 —— 这正是 tilt 漏网的那条
    [
      "结论：输一把之后打下一把：143 局 50.3%（比整体 -2.9）；连输 3 把及以上之后：36 局 47.2%（-6.0） —— 连败之后明显走低（最多 -6.0 个百分点）。",
      true,
    ],
    // 同样的措辞，样本大、效应也大 —— 该放过
    [
      "结论：伤害全队第一时 400 局 62.0%（比整体 +11.0），排到第三及以后时 420 局 48.0%（-4.0） —— 差得明显。",
      false,
    ],
    // 抽不出配对就不判（宁可不报也别猜）
    ["结论：样本量够，可以当真。", false],
    // 否定用法里的强把握词不算主张 —— tilt 改版后的真实形态。
    // 反证：去掉 stripNegated 之后，这条会被误报成「说『明显』撑不住」。
    [
      "结论：都在整体胜率附近波动：偏离最大的一档是 -6.0 个百分点（36 局 47.2%，比整体 -6.0），看不出明显的上头或越打越好。",
      false,
    ],
  ];
  let bad = 0;
  console.log("— 第一层：样本量 —");
  for (const [text, shouldCatch] of cases) {
    const hit = overclaim(text);
    const ok = shouldCatch ? !!hit : !hit;
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} ${shouldCatch ? "应报错" : "应放过"}：${text.slice(0, 66)}`);
    if (hit) console.log(`      → ${hit}`);
  }
  console.log("");
  console.log("— 第二层：效应 vs 噪声 —");
  for (const [text, shouldCatch] of weakCases) {
    const hit = weakEffect(text);
    const ok = shouldCatch ? !!hit : !hit;
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} ${shouldCatch ? "应报错" : "应放过"}：${text.slice(0, 66)}`);
    if (hit) console.log(`      → ${hit}`);
  }
  console.log("");
  console.log(bad ? `✗ 自测 ${bad} 条不通过` : `✓ 自测通过（${cases.length + weakCases.length} 条）`);
  process.exit(bad ? 1 : 0);
}

const CASES = [
  "get_my_trend", "get_my_tilt", "get_my_contribution", "get_my_patches",
  "get_enemy_comps", "get_combat_profile", "get_my_matchups", "get_my_checkup",
];

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

await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "conf", version: "1" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

let problems = 0;
let warnings = 0;
let checked = 0;
for (const tool of CASES) {
  const r = await send("tools/call", { name: tool, arguments: {} });
  const text = r.result?.content?.[0]?.text ?? "";
  const verdicts = text.split("\n").filter((l) => l.startsWith("结论：") || /：队内第一 .*差 .* 个百分点/.test(l));
  for (const v of verdicts) {
    checked++;
    const bad = overclaim(v);
    if (bad) {
      problems++;
      console.log(`✗ ${tool}\n    ${bad}\n    ${v.slice(0, 130)}`);
      continue; // 样本这层已经不合格，效应那层不必再说一遍
    }
    const weak = weakEffect(v);
    if (weak) {
      warnings++;
      console.log(`⚠ ${tool}\n    ${weak}\n    ${v.slice(0, 130)}`);
    }
  }
}
child.kill();

console.log("");
// 两层的严重程度不同，退出码也不同：
//   样本量不够还说满话 —— 硬失败，因为这是判据本身能一句话说死的事；
//   效应没超过噪声 —— 软提醒，因为它依赖**当前这份数据**：同一个工具换个人、
//   攒更多局就会变。让它硬失败的话，审计会随数据忽红忽绿。
if (problems) console.log(`✗ ${problems} 处结论的把握超出了样本撑得起的程度（共查 ${checked} 处）`);
else console.log(`✓ ${checked} 处结论的样本量都撑得起它的措辞`);
if (warnings) console.log(`⚠ ${warnings} 处措辞偏强：效应没到噪声的 2 倍却说「明显」（见上，需要人看一眼）`);
process.exit(problems ? 1 : 0);
