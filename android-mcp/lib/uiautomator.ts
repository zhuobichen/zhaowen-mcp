/**
 * uiautomator dump 的 XML → 紧凑可读列表。
 *
 * 为什么自己解析而不用 fast-xml-parser / xml2js：
 * uiautomator 的 XML 结构极扁（只有 <hierarchy> 下嵌套 <node>），正则逐节点抽属性
 * 就够，还省一个依赖。完整 XML 直接喂给模型是**行不通**的 —— 一个普通页面 3000+
 * 行、几万 token，且真正有用的只有"哪些能点、上面写了什么"。
 *
 * 过滤规则：只保留「有可见文字 / 有 content-desc / 可点击 / 可长按 / 有焦点 / 被勾选」的节点，
 * 其余（ViewGroup、装饰层、透明占位）丢掉。实测能砍掉 70~80% 的节点。
 */

export interface UiNode {
  index: number;
  text: string;
  desc: string;
  id: string;
  cls: string;
  clickable: boolean;
  longClickable: boolean;
  focused: boolean;
  checked: boolean;
  enabled: boolean;
  selected: boolean;
  bounds: string;
  /** 中心点，可直接喂给 input tap */
  x: number;
  y: number;
}

function attr(tag: string, name: string): string {
  // 匹配 node 标签上的 name="value"，value 里的 " 在 XML 里已被转义为 &quot;
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : "";
}

/**
 * XML 实体解码。
 *
 * 除了五个命名实体，**数字字符引用也必须解**：uiautomator 会把表情、换行写成
 * `&#128552;` / `&#10;` 这种形式，只解命名实体的话它们会原样漏进输出 ——
 * 实测看到过 dump 里写着「这大骨这么大&#128552;」，而同一屏截图里表情是正常渲染的。
 */
function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function fromCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

/** "[0,0][1080,1920]" → 中心点 */
export function centerOf(bounds: string): { x: number; y: number } {
  const m = bounds.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (!m) return { x: 0, y: 0 };
  const [, x1, y1, x2, y2] = m.map(Number);
  return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
}

const MAX_TEXT = 60;
const short = (s: string) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + "…" : s);

export function parseUiXml(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  const tags = xml.match(/<node\b[^>]*>/g) ?? [];
  for (const tag of tags) {
    const text = decode(attr(tag, "text"));
    const desc = decode(attr(tag, "content-desc"));
    const clickable = attr(tag, "clickable") === "true";
    const longClickable = attr(tag, "long-clickable") === "true";
    const focused = attr(tag, "focused") === "true";
    const checked = attr(tag, "checked") === "true";
    const enabled = attr(tag, "enabled") === "true";
    const selected = attr(tag, "selected") === "true";
    const bounds = attr(tag, "bounds");

    // 噪声过滤：什么都没暴露的容器不返回给模型。
    if (!text && !desc && !clickable && !longClickable && !focused && !checked) continue;
    const { x, y } = centerOf(bounds);
    nodes.push({
      index: nodes.length + 1,
      text: short(text),
      desc: short(desc),
      id: decode(attr(tag, "resource-id")),
      cls: attr(tag, "class").split(".").pop() ?? attr(tag, "class"),
      clickable,
      longClickable,
      focused,
      checked,
      enabled,
      selected,
      bounds,
      x,
      y,
    });
  }
  return nodes;
}

/** 文本进了单行输出前把控制字符转义掉，否则一条节点会占好几行、整个列表没法看。 */
const oneLine = (s: string) => s.replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");

export function formatNodes(nodes: UiNode[], max = 150): string {
  if (!nodes.length) return "（UI 层级为空 —— 可能页面是 Canvas/Surface 自绘，或应用刚启动还没渲染）";
  const lines: string[] = [];
  for (const n of nodes.slice(0, max)) {
    const label = oneLine(n.text || n.desc || (n.checked ? "[已勾选]" : ""));
    const flags: string[] = [];
    if (n.clickable) flags.push("clickable");
    if (n.longClickable) flags.push("long-clickable");
    if (n.focused) flags.push("focused");
    if (n.checked) flags.push("checked");
    if (n.selected) flags.push("selected");
    if (!n.enabled) flags.push("disabled");
    const idPart = n.id ? ` id=${n.id.replace(/^.*\//, "")}` : "";
    lines.push(
      `#${n.index} ${n.cls}${idPart}${label ? ` "${label}"` : ""} ` +
        `@${n.x},${n.y} bounds=${n.bounds}${flags.length ? ` [${flags.join(",")}]` : ""}`
    );
  }
  if (nodes.length > max) lines.push(`… 另有 ${nodes.length - max} 个节点未显示`);
  return lines.join("\n");
}

/** 给 android_wait_idle 用的界面指纹：连续两次算出同一个值 = 这一屏稳定了。 */
export function screenSignature(nodes: UiNode[]): string {
  return nodes.map((n) => `${n.cls}|${n.text}|${n.desc}|${n.bounds}`).join("\n");
}

/** 机器可消费的形态（text 保留真实换行，不转义）。 */
export function toJson(nodes: UiNode[]): string {
  return JSON.stringify(nodes, null, 2);
}

/**
 * 按文字找节点 → 返回中心坐标。
 * `exact=false` 时先找完全匹配，再退化到包含匹配（中文界面里"登录"和"登录账号"
 * 指向同一个按钮，包含匹配更抗改动，但命中多个要靠 exact 消歧）。
 */
export function findByText(nodes: UiNode[], needle: string, exact = false): UiNode[] {
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const target = norm(needle);
  const hits = (n: UiNode) => [n.text, n.desc].filter(Boolean).map(norm);
  const exactHits = nodes.filter((n) => hits(n).includes(target));
  if (exact || exactHits.length) return exactHits;
  return nodes.filter((n) => hits(n).some((h) => h.includes(target)));
}

