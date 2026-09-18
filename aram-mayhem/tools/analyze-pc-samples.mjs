#!/usr/bin/env node
/**
 * 分析 PC 抓包样本（data/pc-samples/*.json），找出哪个接口是「对局记录」。
 *
 * 用法：npm run pc:analyze
 *
 * 判定依据（按权重打分）：
 *   · 响应里出现的对局字段：gameId / championId / battleId / participants / queueId / kills / assists
 *   · URL 里的关键词：battle / match / history / record
 *   · 响应大小（战绩列表通常几 KB 以上）
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIR = path.join(ROOT, "data", "pc-samples");

const GAME_KEYS = [
  ["gameId", 5],
  ["battleId", 4],
  ["championId", 4],
  ["participants", 3],
  ["queueId", 3],
  ["kills", 2],
  ["assists", 2],
  ["gameMode", 3],
  ["sgameId", 3],
];
const URL_KEYS = [/battle/i, /match/i, /history/i, /record/i, /score/i];

if (!existsSync(DIR)) {
  console.log("还没有抓包样本。先跑：npm run pc:capture，然后打开 WeGame 的「我的战绩」翻一翻。");
  process.exit(0);
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
if (!files.length) {
  console.log("样本目录是空的。确认抓包窗口开着、且确实点了「我的战绩」。");
  process.exit(0);
}

const rows = [];
for (const f of files) {
  let s;
  try {
    s = JSON.parse(readFileSync(path.join(DIR, f), "utf8"));
  } catch {
    continue;
  }
  const body = String(s.response ?? "");
  let score = 0;
  const hits = [];
  for (const [k, w] of GAME_KEYS) {
    if (body.includes(`"${k}"`)) {
      score += w;
      hits.push(k);
    }
  }
  for (const re of URL_KEYS) if (re.test(s.url ?? "")) score += 2;
  if (body.length > 4000) score += 1;
  if (s.status && s.status < 300) score += 1;
  rows.push({ file: f, url: s.url, status: s.status, size: body.length, score, hits, snippet: body.replace(/\s+/g, " ").slice(0, 160) });
}

rows.sort((a, b) => b.score - a.score);
console.log(`样本 ${rows.length} 个，按「像对局记录」排序：\n`);
for (const r of rows.slice(0, 15)) {
  console.log(`[${String(r.score).padStart(3)} 分] ${r.status} · ${r.size} 字 · 命中 ${r.hits.join(",") || "—"}`);
  console.log(`      ${(r.url ?? "").slice(0, 150)}`);
  console.log(`      ${r.snippet}`);
  console.log(`      文件：${r.file}`);
  console.log("");
}
const best = rows[0];
if (best && best.score >= 8) {
  console.log(`→ 最像对局接口的是：${best.url}`);
  console.log("  把这个结果告诉 Claude，就能接着写解析与接入。");
} else {
  console.log("→ 没有明显像对局记录的响应。可能：WeGame 没走系统代理、或用了证书固定（pinning）。");
  console.log("  可以让 Claude 看样本细节，或换一条路（掌盟 + 模拟器）。");
}
