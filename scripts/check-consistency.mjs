#!/usr/bin/env node
/**
 * 三处服务清单的一致性检查：README 服务表 ↔ mcp-catalog.json ↔ 实际目录。
 *
 * 为什么需要它：2026-09-26 加了 hot-trending 和 bilibili 两个服务，catalog 更新了
 * 但 README 忘了改，两边差了 2 个。**漏更新不是能力问题，是没有检查** —— 这个脚本
 * 就是那个检查。加完服务跑一下，不一致会直接报出来。
 *
 * 用法: node scripts/check-consistency.mjs   （退出码非 0 表示不一致）
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 不是 MCP 服务的顶层目录，扫描时排除
const NOT_SERVICES = new Set(["scripts", "node_modules", "docs", "dist"]);

function actualDirs() {
  return readdirSync(ROOT).filter((name) => {
    if (name.startsWith(".") || NOT_SERVICES.has(name)) return false;
    try {
      return statSync(join(ROOT, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

function fromCatalog() {
  const p = join(ROOT, "mcp-catalog.json");
  if (!existsSync(p)) return null;
  const d = JSON.parse(readFileSync(p, "utf8"));
  return new Set((d.services ?? []).map((s) => s.name));
}

function fromReadme() {
  const p = join(ROOT, "README.md");
  if (!existsSync(p)) return null;
  const text = readFileSync(p, "utf8");
  // 只认服务表里的 [`xxx/`](./xxx) 形式，避免匹配到正文里别处的链接
  const names = new Set();
  for (const m of text.matchAll(/^\|\s*\[`([a-z0-9-]+)\/`\]\(\.\/\1\)/gim)) {
    names.add(m[1]);
  }
  return names;
}

const dirs = new Set(actualDirs());
const cat = fromCatalog();
const readme = fromReadme();

console.log("服务清单一致性检查");
console.log("  实际目录 : %d 个", dirs.size);
console.log("  catalog  : %s", cat ? cat.size + " 个" : "(缺失)");
console.log("  README   : %s", readme ? readme.size + " 个" : "(缺失)");

let bad = 0;
const diff = (label, a, b, an, bn) => {
  const onlyA = [...a].filter((x) => !b.has(x));
  const onlyB = [...b].filter((x) => !a.has(x));
  if (onlyA.length) { console.log(`\n  ✗ ${label}: 只在${an}里有 → ${onlyA.join(", ")}`); bad++; }
  if (onlyB.length) { console.log(`\n  ✗ ${label}: 只在${bn}里有 → ${onlyB.join(", ")}`); bad++; }
};

if (cat) diff("目录 vs catalog", dirs, cat, "目录", "catalog");
if (readme) diff("catalog vs README", cat ?? dirs, readme, "catalog", "README");

// 入口文件是否存在。用 catalog 里的 entrypoint 字段判断，别硬编码 index.ts ——
// 本仓库的入口并不统一：index.ts（多数）、dist/index.js（minimax-video-mcp，
// TS 编译产物）、scripts/ssh-ops.js（file-manager）、easy-log 则根本没有
// package.json（它是 SKILL + 脚本，不算标准 MCP 服务）。
if (cat) {
  const byName = Object.fromEntries(
    (JSON.parse(readFileSync(join(ROOT, "mcp-catalog.json"), "utf8")).services ?? [])
      .map((s) => [s.name, s])
  );
  for (const d of dirs) {
    const ep = byName[d]?.entrypoint;
    if (!ep) {
      console.log(`\n  ⚠️ ${d}/ 在 catalog 里没有 entrypoint 字段`);
      continue;
    }
    if (!existsSync(join(ROOT, d, ep))) {
      console.log(`\n  ⚠️ ${d}/ 的 entrypoint「${ep}」不存在`);
    }
  }
}

console.log("");
if (bad) {
  console.log(`✗ 发现 ${bad} 处不一致 —— 加/删服务后记得同步 README 和 mcp-catalog.json`);
  process.exit(1);
}
console.log("✓ 三处一致");
