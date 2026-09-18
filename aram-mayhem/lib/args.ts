/**
 * 调用参数校验：按工具自己声明的 inputSchema 检查实参。
 *
 * 为什么要有它 —— 这个服务是**被模型调用的**，模型传参出错是常态。
 * 加这个之前实测过一轮（tools/probe-badargs.mjs），发现的问题分两类，
 * **第二类比第一类危险得多**：
 *
 *   ① 坏值漏进输出：`get_game_detail({index:"第三把"})` → 「没有第 NaN 把」；
 *      `get_empirical_augments({min_games:"很多"})` → 「只列出现 ≥NaN 次的符文」
 *   ② 静默给出错的答案（不报错、看起来像正常结果）：
 *      `search_augments({rarity:"传说"})` → 「共 0 条」，像是真的没有传说符文；
 *      `get_my_trend({kind:"nonsense"})` → 当作没传，按海斗算；
 *      `search_augments({limit:"abc"})` → 当没传，按默认 20 条返回
 *
 * ②之所以更糟：模型拿到「共 0 条」会当成事实去回答用户，而没有任何迹象表明参数写错了。
 * 所以宁可明确报错，也不要一个看起来正常的错答案。
 *
 * 校验完全从 inputSchema 派生（不另写一份规则表，否则两边会漂）。
 * 由 tools/audit-wiring.mjs 的另一节保证「handler 读的每个 args.X 都声明在 schema 里」——
 * 有那条保证，「未知参数一律报错」才是安全的。
 */

/** inputSchema 里单个参数的样子 */
export interface ParamSpec {
  type?: string;
  enum?: unknown[];
  /** 数字参数的上下界。声明了才查 —— 不声明就不猜（猜错了会拒掉合法调用） */
  minimum?: number;
  maximum?: number;
  /**
   * enum 比对是否忽略大小写。**按参数单独声明，不做全局默认** ——
   * 只有 handler 自己明确做了大小写归一（如 list_champions 的 tier 两边都 toUpperCase）
   * 才该开；对 handler 大小写敏感的参数（如 scope），放宽了反而会把
   * `"LIVE"` 放进去、然后被静默当成没传 —— 那正是本模块要消灭的那类错。
   */
  enumIgnoreCase?: boolean;
  description?: string;
}

/** inputSchema 本身 */
export interface ToolSchema {
  type?: string;
  properties?: Record<string, ParamSpec>;
  required?: string[];
}

/** 值的实际类型名（给人看的） */
function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "数组";
  switch (typeof v) {
    case "number":
      return Number.isFinite(v) ? "数字" : "非有限数字（NaN/Infinity）";
    case "string":
      return "字符串";
    case "boolean":
      return "布尔";
    case "object":
      return "对象";
    default:
      return typeof v;
  }
}

function typeMatches(want: string | undefined, v: unknown): boolean {
  switch (want) {
    case undefined:
      return true; // 没声明类型就管不着
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "string":
      return typeof v === "string";
    case "boolean":
      return typeof v === "boolean";
    case "array":
      return Array.isArray(v);
    case "object":
      return v !== null && typeof v === "object" && !Array.isArray(v);
    default:
      return true;
  }
}

/** 给一个参数写一句「正确用法」，用来拼错误提示 —— 报错得让人知道怎么改 */
function signature(name: string, spec: ParamSpec): string {
  const t = spec.type ?? "any";
  const en = spec.enum?.length ? `，可选：${spec.enum.map(String).join(" / ")}` : "";
  const range =
    spec.minimum !== undefined && spec.maximum !== undefined
      ? `，${spec.minimum}~${spec.maximum}`
      : spec.minimum !== undefined
        ? `，≥${spec.minimum}`
        : spec.maximum !== undefined
          ? `，≤${spec.maximum}`
          : "";
  return `${name}: ${t}${en}${range}`;
}

/**
 * 校验一次调用的实参。
 * @returns 问题描述清单；空数组 = 通过。
 */
export function validateArgs(
  toolName: string,
  schema: ToolSchema | undefined,
  args: Record<string, unknown>
): string[] {
  const problems: string[] = [];
  const props = schema?.properties ?? {};

  // 参数本身必须是个对象。MCP 协议下一般不会出错，但 `arguments: null` 是可能的
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return [`arguments 必须是一个对象，收到的是 ${typeName(args)}`];
  }

  // 缺必填
  for (const key of schema?.required ?? []) {
    if (args[key] === undefined) {
      const spec = props[key];
      problems.push(`缺少必填参数 ${spec ? signature(key, spec) : key}`);
    }
  }

  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue; // 显式 undefined 当作没传
    const spec = props[key];
    if (!spec) {
      // 未知参数一律报错，不静默忽略 —— `minGames` / `min_games` 这种写错会
      // 悄悄按默认值算出一个看着正常的答案，是最难发现的一类错。
      const known = Object.keys(props);
      problems.push(
        `不认识参数「${key}」` + (known.length ? `；${toolName} 接受的参数：${known.join("、")}` : `；${toolName} 不接受任何参数`)
      );
      continue;
    }
    if (!typeMatches(spec.type, value)) {
      problems.push(`${key} 应该是${spec.type === "number" ? "数字" : spec.type === "string" ? "字符串" : spec.type === "boolean" ? "布尔值" : String(spec.type)}，收到的是${typeName(value)}`);
      continue;
    }
    if (spec.enum?.length) {
      const hit = spec.enum.some((e) =>
        spec.enumIgnoreCase && typeof e === "string" && typeof value === "string"
          ? e.toLowerCase() === value.toLowerCase()
          : e === value
      );
      if (!hit) {
        problems.push(`${key} 只能是 ${spec.enum.map(String).join(" / ")} 之一，收到的是「${String(value)}」`);
        continue;
      }
    }
    // 范围。声明了才查 —— 不声明就别猜，猜错会拒掉合法调用。
    // 不管的后果实测过：`limit: -5` 会走到 `.slice()` / 循环里，产出一个
    // 「看着正常但其实不是你要求的」结果，而不是报错。
    if (typeof value === "number") {
      if (spec.minimum !== undefined && value < spec.minimum) {
        problems.push(`${key} 不能小于 ${spec.minimum}，收到的是 ${value}`);
      } else if (spec.maximum !== undefined && value > spec.maximum) {
        problems.push(`${key} 不能大于 ${spec.maximum}，收到的是 ${value}`);
      }
    }
  }

  return problems;
}

/**
 * 把问题清单拼成给模型看的回复。
 * 刻意把「这个工具接受什么」也带上 —— 模型拿到具体签名就知道该怎么重发，
 * 只回一句「参数错了」它只能猜。
 */
export function argsErrorText(toolName: string, schema: ToolSchema | undefined, problems: string[]): string {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const lines = [`参数不对，这次调用没有执行：`, ...problems.map((p) => `  · ${p}`), ""];
  const keys = Object.keys(props);
  if (keys.length) {
    lines.push(`${toolName} 的参数：`);
    for (const k of keys) {
      const spec = props[k];
      lines.push(`  ${signature(k, spec)}${required.has(k) ? "（必填）" : ""}${spec.description ? ` —— ${spec.description}` : ""}`);
    }
  } else {
    lines.push(`${toolName} 不接受任何参数。`);
  }
  lines.push("", "改好参数名/类型再调一次就行。");
  return lines.join("\n");
}
