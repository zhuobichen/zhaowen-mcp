import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sanitizeCell, summarize, upsertReadmeRow } from "../lib/readme.ts";

const REAL_README = "E:/CodeProject/其余工程/浏览器自动化操作/zhaowen-skill/README.md";

/** 复刻 zhaowen-skill README 的分区骨架 */
const FIXTURE = `# zhaowen-skill

## 带来源前缀（作者标明归属）

| Skill | 目录 | 用途 |
|-------|------|------|
| one-hub 用量监测（ylx） | [\`ylx_onehub_usage_monitor/\`](ylx_onehub_usage_monitor/) | 监测 one-hub API 用量 |

## 其他自制 Skill（无前缀）

| Skill | 目录 | 用途 |
|-------|------|------|
| 概念问答沉淀 | [\`kb-capture/\`](kb-capture/) | 说一句「存知识库」即沉淀 |

## 使用方式

每个 skill 目录内含 SKILL.md。
`;

function rowsOf(readme, dir) {
  return readme.split(/\r?\n/).filter((line) => line.includes(`[\`${dir}/\`]`));
}

test("sanitizeCell 折叠多行与连续空白，并转义竖线", () => {
  assert.equal(sanitizeCell("第一行\n第二行\t结束"), "第一行 第二行 结束");
  assert.equal(sanitizeCell("a | b"), "a \\| b");
});

test("summarize 取首个中文句末标点，多句时不吞后面", () => {
  assert.equal(summarize("第一句。第二句。第三句。"), "第一句。");
  assert.equal(summarize("没有句末标点的一段描述"), "没有句末标点的一段描述");
  assert.equal(summarize("叹号结束！后面还有"), "叹号结束！");
});

test("summarize 超长截断补省略号", () => {
  const out = summarize("啊".repeat(300), 120);
  assert.equal(out.length, 121);
  assert.ok(out.endsWith("…"));
});

test("多行 description 只写出一行，不撑破表格", () => {
  const desc = summarize("A 读——把长输出逐级升级。\nB 讲——反过来让你输出。", 120);
  const { content } = upsertReadmeRow(FIXTURE, "layered-explainer", "真正搞懂", desc, {
    prefixed: false,
  });
  const rows = rowsOf(content, "layered-explainer");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].split("|").length, 5); // 首尾空档 + 3 列
});

test("无前缀 skill 落到「其他自制」分区，而不是第一个表", () => {
  const { content } = upsertReadmeRow(FIXTURE, "cnki-search", "CNKI 基础搜索", "关键词检索", {
    prefixed: false,
  });
  const lines = content.split("\n");
  const at = lines.findIndex((line) => line.includes("[`cnki-search/`]"));
  const prefixedHeading = lines.findIndex((line) => /^##\s+带来源前缀/.test(line));
  const plainHeading = lines.findIndex((line) => /^##\s+其他自制/.test(line));
  assert.ok(at > plainHeading, "应插在「其他自制」标题之后");
  assert.ok(at > prefixedHeading + 6, "不应插在第一个表里");
});

test("带前缀 skill 落到「带来源前缀」分区", () => {
  const { content } = upsertReadmeRow(FIXTURE, "ylx_new_thing", "新东西（ylx）", "说明", {
    prefixed: true,
  });
  const lines = content.split("\n");
  const at = lines.findIndex((line) => line.includes("[`ylx_new_thing/`]"));
  const plainHeading = lines.findIndex((line) => /^##\s+其他自制/.test(line));
  assert.ok(at > 0 && at < plainHeading, "应插在第一个表内");
});

test("显式 section 关键词可指定任意分区", () => {
  const { content } = upsertReadmeRow(FIXTURE, "browser-skill", "Browser Skill", "驱动浏览器", {
    section: "其他自制",
  });
  const lines = content.split("\n");
  const at = lines.findIndex((line) => line.includes("[`browser-skill/`]"));
  const plainHeading = lines.findIndex((line) => /^##\s+其他自制/.test(line));
  assert.ok(at > plainHeading);
});

test("已有行原地替换，不重复插入", () => {
  const first = upsertReadmeRow(FIXTURE, "kb-capture", "概念问答沉淀 v2", "新说明", {
    prefixed: false,
  });
  assert.equal(first.changed, true);
  const second = upsertReadmeRow(first.content, "kb-capture", "概念问答沉淀 v2", "新说明", {
    prefixed: false,
  });
  assert.equal(second.changed, false, "内容一致时不应再改");
  assert.equal(rowsOf(first.content, "kb-capture").length, 1);
});

test("不传 opts 时保持旧行为（首个表头之后）", () => {
  const { content } = upsertReadmeRow(FIXTURE, "legacy-skill", "旧调用", "说明");
  const lines = content.split("\n");
  const at = lines.findIndex((line) => line.includes("[`legacy-skill/`]"));
  const plainHeading = lines.findIndex((line) => /^##\s+其他自制/.test(line));
  assert.ok(at < plainHeading, "旧调用仍插在第一个表内");
});

test("真实仓库 README：browser-skill 仍落在「借鉴自腾讯」分区且为单行", async () => {
  let readme;
  try {
    readme = await readFile(REAL_README, "utf8");
  } catch {
    return; // 仓库副本不在本机则跳过
  }
  const { content } = upsertReadmeRow(
    readme,
    "browser-skill",
    "Browser Skill",
    summarize("在独立 Agent Window 里驱动已登录的 Chrome/Edge。借用标签页需确认。"),
    { section: "借鉴自腾讯" }
  );
  const lines = content.split("\n");
  const at = lines.findIndex((line) => line.includes("[`browser-skill/`]"));
  assert.equal(rowsOf(content, "browser-skill").length, 1);
  const tencentHeading = lines.findIndex((line) => /^##\s+借鉴自腾讯/.test(line));
  const usageHeading = lines.findIndex((line) => /^##\s+使用方式/.test(line));
  assert.ok(at > tencentHeading && at < usageHeading, "应落在「借鉴自腾讯」分区内");
});
