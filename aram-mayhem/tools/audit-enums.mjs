// 枚举/封闭词表审计。
//
// 背景：这类参数写错的后果是「静默给出错的答案」，比报错危险得多。实测过 ——
// `search_augments({rarity:"传说"})` 在加参数校验之前回的是「共 0 条」，
// 看起来像「确实没有传说符文」；模型会把它当事实讲给用户。
//
// 三条独立的判据：
//
//   A. handler 里按**字面量**比对的参数（`args.X === "…"`）必须有 enum，
//      且每个被比对的字面量都在 enum 里。
//   B. `rarity` 的 enum 值必须都在 RARITY_CN 里（键或值）—— 因为 lib/tools.ts
//      是拿 RARITY_CN 把中文名归一成英文键、找不到就**原样**拿去比。
//      写错一个品质名，用户传进去就是静默 0 条。
//   C. `tier` 的 enum 值必须都是 data/champions.json 里真实出现过的档位。
//
// ⚠ 覆盖边界（别把它当万能）：A 只看 index.ts 的 dispatch。**rarity 这种
// 「handler 只是把值透传给 lib/、过滤发生在别处」的参数 A 查不到** ——
// 这次 rarity 缺 enum 就是 A 漏掉、靠 B 才拦住的。B/C 是逐个点名写的交叉核对，
// 新增同类参数时得照着加一条，不会自动覆盖。
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
// 仓库是 CRLF —— 不归一化的话按行切分拿到的行尾带 \r，下面的行内匹配会变得很脆
const src = readFileSync(path.join(ROOT, "index.ts"), "utf8").replace(/\r\n/g, "\n");
const lines = src.split("\n");

// ---- 1. 收每个工具的 inputSchema.properties（只收单行声明的，多行的靠下面兜底）
/** tool → { param → Set(enum 值) | null（无 enum） } */
const schemas = new Map();
let tool = null;
let inSchema = false;
for (let i = 0; i < lines.length; i++) {
  const tm = lines[i].match(/^        name: "([a-z_]+)",/);
  if (tm) {
    tool = tm[1];
    schemas.set(tool, new Map());
    inSchema = false;
    continue;
  }
  if (/^        inputSchema: \{/.test(lines[i])) {
    inSchema = true;
    continue;
  }
  if (inSchema && /^        \},/.test(lines[i])) {
    inSchema = false;
    continue;
  }
  if (!inSchema || !tool) continue;

  // 单行：param: { type: "string", enum: [...] }
  const one = lines[i].match(/^            (\w+): \{ (.*?) \},?$/);
  if (one) {
    const enumRaw = one[2].match(/enum: ([A-Za-z_][\w]*|\[[^\]]*\])/);
    let values = null;
    if (enumRaw) {
      const lit = enumRaw[1];
      if (lit.startsWith("[")) values = [...lit.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
      else {
        // enum: SCOPES —— 引用常量，回源码里找它的定义
        const def = src.match(new RegExp(`const ${lit} = \\[([^\\]]*)\\]`));
        values = def ? [...def[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]) : [];
      }
    }
    schemas.get(tool).set(one[1], values);
    continue;
  }
  // 多行：param: {\n  type: "string",\n  enum: [...],\n  ...
  const multi = lines[i].match(/^            (\w+): \{$/);
  if (multi) {
    let j = i + 1;
    let body = "";
    while (j < lines.length && !/^            \},?$/.test(lines[j])) {
      body += lines[j] + "\n";
      j++;
    }
    const enumRaw = body.match(/enum: \[([\s\S]*?)\]/);
    schemas.get(tool).set(multi[1], enumRaw ? [...enumRaw[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]) : null);
    i = j;
  }
}

// ---- 2. 收 handler 里对 args.X 的字面量比对
/** tool → param → Set(被比对过的字面量) */
const compared = new Map();
let curTool = null;
for (let i = 0; i < lines.length; i++) {
  const cm = lines[i].match(/^        case "([a-z_]+)":/);
  if (cm) {
    curTool = cm[1];
    if (!compared.has(curTool)) compared.set(curTool, new Map());
    continue;
  }
  if (/^        default:/.test(lines[i])) {
    curTool = null;
    continue;
  }
  if (!curTool) continue;
  for (const m of lines[i].matchAll(/args\.(\w+)\s*[!=]==?\s*"([^"]*)"/g)) {
    const [, param, lit] = m;
    const per = compared.get(curTool);
    per.set(param, (per.get(param) ?? new Set()).add(lit));
  }
}

// ---- 3. 比对
const missingEnum = [];
const shortEnum = [];
let checkedParams = 0;
for (const [t, params] of compared) {
  const schema = schemas.get(t) ?? new Map();
  for (const [param, lits] of params) {
    if (!schema.has(param)) continue; // 没声明的参数由别的检查管
    checkedParams++;
    const en = schema.get(param);
    if (!en) {
      missingEnum.push(`${t}.${param}（handler 比对了 ${[...lits].map((x) => `"${x}"`).join(" / ")}）`);
      continue;
    }
    const absent = [...lits].filter((l) => !en.includes(l));
    if (absent.length) shortEnum.push(`${t}.${param}：enum 里少了 ${absent.map((x) => `"${x}"`).join(" / ")}（枚举当前是 ${en.join(" / ")}）`);
  }
}

console.log(`A. 扫描 ${compared.size} 个 case 分支，其中 ${checkedParams} 个参数是「按字面量比对」的`);
for (const m of missingEnum) console.log(`  ✗ ${m}`);
for (const m of shortEnum) console.log(`  ✗ ${m}`);
if (!missingEnum.length && !shortEnum.length) console.log(`  ✓ 都声明了完整的 enum`);

// ---- B. rarity 的 enum 值必须都在 RARITY_CN 里（键或值）
const storeSrc = readFileSync(path.join(ROOT, "lib/store.ts"), "utf8").replace(/\r\n/g, "\n");
const rcBlock = storeSrc.match(/RARITY_CN: Record<string, string> = \{([\s\S]*?)\n\};/);
let rarityProblems = [];
if (!rcBlock) {
  rarityProblems = ["lib/store.ts 里找不到 RARITY_CN —— 判据失效，不是通过"];
} else {
  const pairs = [...rcBlock[1].matchAll(/(\w+):\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]);
  const known = new Set(pairs.flat());
  const declared = schemas.get("search_augments")?.get("rarity");
  if (!declared) rarityProblems = ["search_augments.rarity 没声明 enum"];
  else {
    const unknown = declared.filter((v) => !known.has(v));
    if (unknown.length) rarityProblems = [`enum 里这些值 RARITY_CN 里没有（传进去会静默 0 条）：${unknown.join("、")}`];
    // 反向：RARITY_CN 的键（英文品质）一个都没声明，说明漏了
    const keysNotDeclared = pairs.map(([k]) => k).filter((k) => !declared.includes(k) && dataHasRarity(k));
    if (keysNotDeclared.length) rarityProblems.push(`数据里存在的品质没进 enum：${keysNotDeclared.join("、")}`);
  }
}
function dataHasRarity(key) {
  try {
    const aug = JSON.parse(readFileSync(path.join(ROOT, "data/augments.json"), "utf8"));
    return aug.some((a) => a.rarity === key);
  } catch {
    return false;
  }
}
console.log(`\nB. rarity 的 enum 对不对（交叉核对 lib/store.ts 的 RARITY_CN + data/augments.json）`);
for (const p of rarityProblems) console.log(`  ✗ ${p}`);
if (!rarityProblems.length) console.log(`  ✓ enum 值与 RARITY_CN、数据里的品质都对得上`);

// ---- C. tier 的 enum 值必须都是数据里真实出现过的档位
let tierProblems = [];
try {
  const champs = JSON.parse(readFileSync(path.join(ROOT, "data/champions.json"), "utf8"));
  const inData = new Set(champs.map((c) => c.tier).filter(Boolean));
  const declared = schemas.get("list_champions")?.get("tier");
  if (!declared) tierProblems = ["list_champions.tier 没声明 enum"];
  else {
    const ghosts = declared.filter((t) => !inData.has(t));
    if (ghosts.length) tierProblems = [`enum 里这些档位数据里没有：${ghosts.join("、")}（数据里是 ${[...inData].sort().join("/")}）`];
    const missing = [...inData].filter((t) => !declared.includes(t));
    if (missing.length) tierProblems.push(`数据里有但 enum 没声明：${missing.join("、")}`);
  }
} catch (e) {
  tierProblems = [`读 data/champions.json 失败：${e.message}`];
}
console.log(`\nC. tier 的 enum 对不对（交叉核对 data/champions.json）`);
for (const p of tierProblems) console.log(`  ✗ ${p}`);
if (!tierProblems.length) console.log(`  ✓ enum 值与数据里出现的档位一致`);

// 收尾结论行：健康报告按这一行的前缀分档（✓ 通过 / ⚠ 注意 / ✗ 失败）
const bad = missingEnum.length + shortEnum.length + rarityProblems.length + tierProblems.length;
console.log("");
console.log(
  bad
    ? `✗ 封闭词表声明有 ${bad} 处问题`
    : `✓ 字面量比对的参数都有 enum；rarity / tier 的值与数据源对得上`
);
process.exit(bad ? 1 : 0);
