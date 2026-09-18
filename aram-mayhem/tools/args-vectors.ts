/**
 * lib/args.ts 的判据自测：拿合成的 schema + 实参直接喂 validateArgs，看判对没有。
 *
 * 为什么要单独来一份，而不是只靠 audit-args.mjs 的行为测试：
 * 行为测试要经过真服务，能表达的输入有限 —— `arguments` 是 null、参数是 NaN、
 * 数字正好压在上下界上、显式传 undefined 这些，走 MCP 那条路很难构造，
 * 而它们恰恰是判据最容易写错的地方（本仓库的判据已经错过好几次，都是靠合成用例抓的）。
 *
 * 跑：npm run audit:args:vectors
 */
import { validateArgs } from "../lib/args.js";
import type { ToolSchema } from "../lib/args.js";

interface Case {
  why: string;
  schema: ToolSchema;
  args: Record<string, unknown>;
  /** 期望的问题条数；-1 表示「至少 1 条」 */
  want: number;
}

const schema: ToolSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    limit: { type: "number", minimum: 1, maximum: 100 },
    kind: { type: "string", enum: ["mayhem", "tft"] },
    tier: { type: "string", enum: ["S+", "S"], enumIgnoreCase: true },
    tags: { type: "array" },
    confirm: { type: "boolean" },
    opt: { type: "string" },
  },
  required: ["name"],
};

const CASES: Case[] = [
  // ---- 正常：一条都不该报
  { why: "必填给了、类型都对", schema, args: { name: "亚索" }, want: 0 },
  { why: "只给必填、其它全省略", schema, args: { name: "x", limit: 20 }, want: 0 },
  { why: "数字压在上下界上（闭区间，不许误判越界）", schema, args: { name: "x", limit: 1 }, want: 0 },
  { why: "上界也一样", schema, args: { name: "x", limit: 100 }, want: 0 },
  { why: "enum 命中", schema, args: { name: "x", kind: "tft" }, want: 0 },
  { why: "enumIgnoreCase 命中（大小写不同也算）", schema, args: { name: "x", tier: "s+" }, want: 0 },
  { why: "数组参数给数组", schema, args: { name: "x", tags: ["a"] }, want: 0 },
  { why: "布尔给布尔", schema, args: { name: "x", confirm: true }, want: 0 },
  { why: "显式 undefined 当作没传", schema, args: { name: "x", limit: undefined }, want: 0 },
  { why: "空数组也是合法数组", schema, args: { name: "x", tags: [] }, want: 0 },

  // ---- 必填
  { why: "缺必填", schema, args: {}, want: -1 },
  { why: "必填给了 undefined（等于没给）", schema, args: { name: undefined }, want: -1 },

  // ---- 类型
  { why: "字符串参数给了数字", schema, args: { name: 123 }, want: -1 },
  { why: "数字参数给了字符串", schema, args: { name: "x", limit: "20" }, want: -1 },
  { why: "布尔参数给了字符串 'true'（真值判断的经典坑）", schema, args: { name: "x", confirm: "true" }, want: -1 },
  { why: "数组参数给了字符串", schema, args: { name: "x", tags: "a,b" }, want: -1 },
  { why: "数字给了 NaN", schema, args: { name: "x", limit: Number.NaN }, want: -1 },
  { why: "数字给了 Infinity", schema, args: { name: "x", limit: Number.POSITIVE_INFINITY }, want: -1 },
  { why: "参数给了 null（不是对象就是错）", schema, args: { name: null }, want: -1 },

  // ---- 范围
  { why: "低于下界", schema, args: { name: "x", limit: 0 }, want: -1 },
  { why: "低于下界（负）", schema, args: { name: "x", limit: -5 }, want: -1 },
  { why: "高于上界", schema, args: { name: "x", limit: 101 }, want: -1 },

  // ---- 枚举
  { why: "enum 不在词表里", schema, args: { name: "x", kind: "nonsense" }, want: -1 },
  { why: "enum 大小写不敏感**只对声明了的参数生效**（kind 没声明，'TFT' 该被拒）", schema, args: { name: "x", kind: "TFT" }, want: -1 },
  { why: "enum 给了数字", schema, args: { name: "x", kind: 1 }, want: -1 },

  // ---- 未知参数
  { why: "完全不认识的参数名", schema, args: { name: "x", nonsense: 1 }, want: -1 },
  { why: "驼峰/下划线写混（本仓库真实踩过的）", schema, args: { name: "x", minGames: 5 }, want: -1 },

  // ---- arguments 本身不是对象
  { why: "arguments 是 null", schema, args: null as unknown as Record<string, unknown>, want: -1 },
  { why: "arguments 是数组", schema, args: [] as unknown as Record<string, unknown>, want: -1 },
  { why: "arguments 是字符串", schema, args: "x" as unknown as Record<string, unknown>, want: -1 },

  // ---- 没有 schema 时不该乱拒
  { why: "schema 是 undefined（拿不到声明就别管）", schema: undefined as unknown as ToolSchema, args: { 任意: 1 }, want: 0 },
  { why: "schema 没有 properties", schema: { type: "object" }, args: { 任意: 1 }, want: -1 },
];

let bad = 0;
for (const c of CASES) {
  const got = validateArgs("t", c.schema, c.args).length;
  const pass = c.want === -1 ? got >= 1 : got === c.want;
  if (!pass) bad++;
  const exp = c.want === -1 ? "至少 1 个问题" : `${c.want} 个问题`;
  console.log(`${pass ? "✓" : "✗"} 期望${exp}，得到 ${got} —— ${c.why}`);
  if (!pass) {
    const p = validateArgs("t", c.schema, c.args);
    if (p.length) console.log(`      → ${p[0]}`);
  }
}

console.log("");
console.log(bad ? `✗ 自测 ${bad}/${CASES.length} 条不通过` : `✓ 自测通过（${CASES.length} 条）`);
process.exit(bad ? 1 : 0);
