#!/usr/bin/env npx tsx
/**
 * 冒烟测试：不经过 MCP 协议，直接调用各工具实现，检查输出是否正常。
 * 用法：npx tsx smoke.ts
 */
import { cleanDesc, loadData } from "./lib/store.js";
import {
  analyzeSynergy,
  championGuide,
  comparePatches,
  dataInfo,
  getAugmentTool,
  listChampions,
  listSynergySets,
  searchAugmentsTool,
} from "./lib/tools.js";

const hr = (t: string) => console.log(`\n${"=".repeat(12)} ${t} ${"=".repeat(12)}`);

const d = loadData();

hr("数据结构抽查");
const withMarkup = d.augments.filter((a) => a.desc && /[\[<]/.test(cleanDesc(a.desc)));
console.log(`说明清洗后仍残留标记的符文：${withMarkup.length} 条`);
if (withMarkup.length) {
  for (const a of withMarkup.slice(0, 5)) console.log(`  · ${a.name}: ${cleanDesc(a.desc!)}`);
}
const sample = d.augments.find((a) => a.stats?.rank === 1);
console.log(`强度榜第一：${sample?.name} ${sample?.stats?.winRate}`);
console.log(`无说明的符文：${d.augments.filter((a) => !a.desc).length} 条`);

hr("get_data_info");
console.log(dataInfo());

hr("search_augments（关键词）");
console.log(searchAugmentsTool({ query: "坦克", limit: 5 }));

hr("search_augments（棱彩品质、按名次）");
console.log(searchAugmentsTool({ rarity: "prismatic", limit: 5 }));

hr("search_augments（空查询，默认在池）");
console.log(searchAugmentsTool({ limit: 5 }));

hr("get_augment");
console.log(getAugmentTool({ name: "循环往复" }));

hr("list_synergy_sets");
console.log(listSynergySets({}).slice(0, 1200));

hr("analyze_synergy");
const set = d.synergySets[0];
console.log(`（用例：取「${set.name}」羁绊里的前两件）`);
console.log(analyzeSynergy({ augments: set.augmentNames.slice(0, 2) }));

hr("analyze_synergy（完全凑不齐 / 错误输入）");
console.log(analyzeSynergy({ augments: ["不存在的符文名xyz"] }));

hr("list_champions");
console.log(listChampions({ limit: 5 }));

hr("get_champion_guide");
console.log(championGuide({ champion: "火男", limit: 5 }));
console.log("\n--- 亚索 ---");
console.log(championGuide({ champion: "Yasuo", limit: 4 }));

hr("compare_patches");
console.log(comparePatches({}));
