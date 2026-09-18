/**
 * 各 MCP 工具的具体实现（返回给人看的文本）。
 * 纯查询逻辑，不联网、不写文件（refreshData 工具除外）。
 */
import {
  RARITY_CN,
  augmentDetail,
  augmentLine,
  availabilityCn,
  championNamesFor,
  cleanDesc,
  cnStatsLine,
  comboCardLine,
  findChampions,
  loadData,
  loadSnapshot,
  normalize,
  pct,
  rarityCn,
  searchAugments,
} from "./store.js";
import type { Augment, Champion, Combo } from "./types.js";

const TIER_ORDER: Record<string, number> = { "S+": 0, S: 1, A: 2, B: 3, C: 4 };

type Scope = "live" | "unknown" | "retired" | "all";

function inScope(a: Augment, scope: Scope): boolean {
  return scope === "all" ? true : a.availability === scope;
}

function scopeHint(scope: Scope, all: Augment[]): string {
  if (scope === "all") return "";
  const hidden = all.filter((a) => !inScope(a, scope)).length;
  return hidden
    ? `\n（已过滤掉 ${hidden} 条非「${scope === "live" ? "在池" : availabilityCn({ availability: scope } as Augment)}」的符文；要看全部传 scope="all"）`
    : "";
}

function tierRank(t: string | null): number {
  return TIER_ORDER[t ?? ""] ?? 9;
}

// ---------------------------------------------------------------- 数据概况

export function dataInfo(): string {
  const d = loadData();
  const { meta } = d;
  const v = meta.validation;
  const lines = [
    `=== 海克斯大乱斗数据（补丁 ${meta.patch}）===`,
    `数据更新时间：${meta.updatedAt}`,
    "",
    `符文 ${d.augments.length} 条：在池 ${d.augments.filter((a) => a.availability === "live").length} · 已下架 ${d.augments.filter((a) => a.availability === "retired").length} · 状态未知 ${d.augments.filter((a) => a.availability === "unknown").length}`,
    `  其中有中文说明 ${d.augments.filter((a) => a.desc).length} 条，有强度数据 ${d.augments.filter((a) => a.stats).length} 条`,
    `英雄 ${d.champions.length} 个 · 羁绊 ${d.synergySets.length} 套 · 英雄×符文搭配 ${d.combos.length} 条`,
    `本地已归档补丁快照：${d.patches.length ? d.patches.join("、") : "无"}`,
    "",
    "数据来源（都是公开静态文件）：",
    `  · 符文说明/羁绊/搭配（社区站·全球口径）：${meta.sources.mayhemSearchIndex}`,
    `  · 在池 live/retired 标记：${meta.sources.mayhemAugmentsPage}`,
    `  · 单件评价卡片（神级/陷阱等标签）：${meta.sources.comboIndex}`,
    `  · 国服胜率/选取率（aramgg 聚合的腾讯样本）：${meta.sources.cnAugmentStats} · ${meta.sources.cnChampionStats}`,
    `  · 官方中文名/品质/图标/模式清单：${meta.sources.riotAugments} · ${meta.sources.riotAugmentLists}`,
    `  · 官方符文说明原文＋中文文本：${meta.sources.riotKiwiAugments} · ${meta.sources.riotStringtable}`,
    "",
    "数据说明：",
    ...meta.notes.map((n) => `  · ${n}`),
    "",
    "构建时发现的数据出入（已按各来源保留，未做臆测合并）：",
    `  · 官方名与社区站名不一致 ${v.nameConflicts.length} 条${v.nameConflicts.length ? `：${v.nameConflicts.join("；")}` : ""}`,
    `  · 品质不一致 ${v.rarityConflicts.length} 条${v.rarityConflicts.length ? `：${v.rarityConflicts.join("；")}` : ""}`,
    `  · 只有官方数据、没有中文说明 ${v.officialOnly.length} 条`,
    `  · 官方文件里同名不同 id（已去重）${v.duplicateOfficialNames.length} 条`,
    `  · 羁绊里未能解析的符文名 ${v.unresolvedSynergyAugments.length} 条${v.unresolvedSynergyAugments.length ? `：${v.unresolvedSynergyAugments.join("；")}` : ""}`,
    `  · 官方定义里没取到中文说明 ${v.officialDescMissing.length} 条`,
    `  · 单件评价卡片里未解析的符文 ${v.unresolvedComboCards.length} 条${v.unresolvedComboCards.length ? `：${v.unresolvedComboCards.slice(0, 8).join("；")}` : ""}`,
    ...(v.dataSourceIssues.length ? [`  ⚠ 数据源问题：${v.dataSourceIssues.join("；")}`] : []),
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------- 符文搜索

export interface SearchArgs {
  query?: string;
  rarity?: string;
  mode?: string;
  scope?: Scope;
  limit?: number;
  sort?: "rank" | "name";
}

export function searchAugmentsTool(args: SearchArgs): string {
  const d = loadData();
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
  const scope: Scope = (args.scope as Scope) ?? (args.query ? "all" : "live");
  const rarity = args.rarity ? normalize(args.rarity) : "";
  const mode = args.mode ?? "";

  let hits: Augment[];
  let howNote = "";
  if (args.query) {
    const matches = searchAugments(args.query, { limit: 200 });
    hits = matches.map((m) => m.augment);
    // 命中原因只对前几条有意义，给个整体概括
    const hows = new Set(matches.map((m) => m.how));
    if (hows.size) howNote = `匹配方式：${[...hows].join("/")}`;
  } else {
    hits = [...d.augments];
  }

  hits = hits.filter((a) => inScope(a, scope));
  if (rarity) {
    const want = Object.entries(RARITY_CN).find(([, cn]) => normalize(cn) === rarity)?.[0] ?? rarity;
    hits = hits.filter((a) => a.rarity === want);
  }
  if (mode) hits = hits.filter((a) => a.modes.some((m) => m.includes(mode)));

  const total = hits.length;
  if (args.sort !== "name") {
    hits.sort((x, y) => (x.stats?.rank ?? 9999) - (y.stats?.rank ?? 9999) || x.name.localeCompare(y.name, "zh-Hans-CN"));
  } else {
    hits.sort((x, y) => x.name.localeCompare(y.name, "zh-Hans-CN"));
  }
  const shown = hits.slice(0, limit);

  const head = args.query
    ? `搜索「${args.query}」命中 ${total} 条${rarity ? `（品质：${args.rarity}）` : ""}${howNote ? `，${howNote}` : ""}`
    : `符文列表：共 ${total} 条（${scope === "live" ? "默认只看在池" : scope === "all" ? "全部" : scope}）`;
  const body = shown.map((a, i) => augmentLine(a, i + 1));
  const tail: string[] = [];
  if (total > shown.length) tail.push(`…还有 ${total - shown.length} 条，可用 limit / rarity / query 收窄`);
  if (!total) {
    tail.push(args.query ? "没找到匹配的符文。可以试试：中文名、英文名，或只输入名称里的一两个字。" : "没有符合条件的符文。");
  }
  const hint = args.query ? "" : scopeHint(scope, d.augments);
  return [head, "", ...body, ...(tail.length ? ["", ...tail] : [])].join("\n") + (hint ? "\n" + hint : "");
}

export function getAugmentTool(args: { name: string }): string {
  const matches = searchAugments(args.name, { limit: 10 });
  if (!matches.length) {
    return `没找到「${args.name}」。可以试试：中文名（如 坦克引擎）、英文名（tank engine）、或名称里的几个字。`;
  }
  const exact = matches.filter((m) => m.how === "完全同名");
  if (!exact.length && matches.length > 1) {
    const list = matches.map((m, i) => `${i + 1}. ${m.augment.name}（${rarityCn(m.augment)}·${availabilityCn(m.augment)}）`).join("\n");
    return `「${args.name}」匹配到多个符文，请指明具体是哪个：\n${list}`;
  }
  const target = (exact[0] ?? matches[0]).augment;
  const d = loadData();
  const out = [augmentDetail(target)];

  const sets = d.synergySets.filter((s) => s.augmentIds.includes(target.id));
  if (sets.length) {
    out.push("", "所属羁绊：");
    for (const s of sets) out.push(`  · ${s.name}（需 ${s.augmentIds.length} 件）：${s.desc ? cleanDesc(s.desc) : "无说明"}`);
  }
  const cards = d.comboCards
    .filter((c) => c.augmentId === target.id)
    .sort((x, y) => tierRank(x.tier) - tierRank(y.tier));
  if (cards.length) {
    out.push("", `英雄单件评价（社区站收录 ${cards.length} 条，按档位排序）：`);
    for (const c of cards.slice(0, 6)) out.push(comboCardLine(c, true));
    if (cards.length > 6) out.push(`  …还有 ${cards.length - 6} 条`);
  }
  const combos = d.combos.filter((c) => c.augmentIds.includes(target.id));
  if (combos.length) {
    const top = combos.filter((c) => tierRank(c.tier) <= 2).slice(0, 4);
    if (top.length) {
      out.push("", "多件搭配（社区站）：");
      for (const c of top) out.push(`  · ${c.championName}（${c.tier}）：${c.augmentNames.join(" + ")}${c.desc ? ` —— ${c.desc}` : ""}`);
    }
  }
  if (matches.length > 1) {
    out.push("", `（另有 ${matches.length - 1} 条相近结果：${matches.slice(1, 6).map((m) => m.augment.name).join("、")}）`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- 羁绊

export function listSynergySets(args: { query?: string } = {}): string {
  const d = loadData();
  const q = args.query ? normalize(args.query) : "";
  const sets = q
    ? d.synergySets.filter(
        (s) =>
          normalize(s.name).includes(q) ||
          (s.desc && normalize(s.desc).includes(q)) ||
          s.augmentNames.some((n) => normalize(n).includes(q))
      )
    : d.synergySets;
  if (!sets.length) return `没找到匹配「${args.query}」的羁绊。`;

  const out: string[] = [`羁绊（套装）共 ${d.synergySets.length} 套${q ? `，命中 ${sets.length} 套` : ""}：`];
  for (const s of sets) {
    const items = s.augmentIds.map((id) => {
      const a = d.augmentById.get(id);
      return a ? `${a.name}（${rarityCn(a)}${a.availability === "live" ? "" : "·" + availabilityCn(a)}）` : id;
    });
    out.push("", `【${s.name}】需要 ${s.augmentIds.length} 件`);
    if (s.desc) out.push(`  效果：${cleanDesc(s.desc)}`);
    out.push(`  组成：${items.join(" + ")}`);
    if (s.unresolved.length) out.push(`  （有 ${s.unresolved.length} 件社区站给了名字但本地没匹配到：${s.unresolved.join("、")}）`);
  }
  out.push("", "提示：用 analyze_synergy 传入你已拿到（或正在考虑）的符文，可以算出能凑出哪些羁绊、还差几件。");
  return out.join("\n");
}

export function analyzeSynergy(args: { augments: string[] | string }): string {
  const d = loadData();
  const raw = Array.isArray(args.augments) ? args.augments : String(args.augments ?? "").split(/[,，、;；\n]/);
  const inputs = raw.map((s) => String(s).trim()).filter(Boolean);
  if (!inputs.length) return "请提供至少 1 个符文名称（多个用逗号分隔），例如：坦克引擎, 珠光护手";

  const resolved: Augment[] = [];
  const unmatched: string[] = [];
  for (const name of inputs) {
    const m = searchAugments(name, { limit: 5 });
    const exact = m.find((x) => x.how === "完全同名") ?? (m.length === 1 ? m[0] : null);
    if (exact) {
      if (!resolved.some((r) => r.id === exact.augment.id)) resolved.push(exact.augment);
    } else if (m.length > 1) {
      unmatched.push(`${name}（可能是：${m.slice(0, 3).map((x) => x.augment.name).join(" / ")}）`);
    } else {
      unmatched.push(name);
    }
  }

  const out: string[] = [];
  out.push(`识别到 ${resolved.length} 个符文：${resolved.map((a) => a.name).join("、") || "无"}`);
  if (unmatched.length) out.push(`未能确定 ${unmatched.length} 个输入：${unmatched.join("、")}`);
  if (!resolved.length) {
    out.push("", "没有可分析的符文。可以用 search_augments 先确认名称。");
    return out.join("\n");
  }

  const rows = d.synergySets
    .map((s) => {
      const have = s.augmentIds.filter((id) => resolved.some((r) => r.id === id));
      return { set: s, have };
    })
    .filter((r) => r.have.length > 0)
    .sort((a, b) => b.have.length / b.set.augmentIds.length - a.have.length / a.set.augmentIds.length || b.have.length - a.have.length);

  if (!rows.length) {
    out.push("", "这些符文凑不出任何羁绊（本地羁绊库共 " + d.synergySets.length + " 套）。");
    return out.join("\n");
  }

  out.push("", `命中 ${rows.length} 套羁绊：`);
  for (const { set, have } of rows) {
    const need = set.augmentIds.length;
    const complete = have.length === need;
    const haveNames = have.map((id) => d.augmentById.get(id)?.name ?? id);
    const missing = set.augmentIds
      .filter((id) => !have.includes(id))
      .map((id) => d.augmentById.get(id))
      .filter((a): a is Augment => !!a);
    out.push("", `【${set.name}】${have.length}/${need} ${complete ? "✅ 已凑齐" : `—— 还差 ${missing.length} 件`}`);
    if (set.desc) out.push(`  效果：${cleanDesc(set.desc)}`);
    out.push(`  已拿：${haveNames.join("、")}`);
    if (missing.length) {
      const live = missing.filter((a) => a.availability === "live");
      out.push(
        `  还差：${missing.map((a) => `${a.name}（${rarityCn(a)}·${availabilityCn(a)}）`).join("、")}`
      );
      if (live.length) out.push(`  其中当前在池的有：${live.map((a) => a.name).join("、")}`);
    }
  }

  // 品质/名次层面的补充信息
  const liveCount = resolved.filter((a) => a.availability === "live").length;
  out.push(
    "",
    `补充：输入里 ${liveCount}/${resolved.length} 个是当前在池符文；羁绊效果与需求件数来自社区站，样本有限，仅供参考。`
  );
  return out.join("\n");
}

// ---------------------------------------------------------------- 英雄

export function listChampions(args: { tier?: string; sort?: "winRate" | "tier"; limit?: number } = {}): string {
  const d = loadData();
  const limit = Math.min(Math.max(args.limit ?? 25, 1), 200);
  let list = [...d.champions];
  if (args.tier) list = list.filter((c) => (c.tier ?? "").toUpperCase() === args.tier!.toUpperCase());
  if (args.sort === "tier") list.sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || (b.winRate ?? "").localeCompare(a.winRate ?? ""));
  else list.sort((a, b) => (b.winRate ?? "").localeCompare(a.winRate ?? ""));
  const shown = list.slice(0, limit);
  return [
    `英雄梯队（共 ${d.champions.length} 个${args.tier ? `，${args.tier} 档 ${list.length} 个` : ""}，按胜率排序）：`,
    "",
    ...shown.map((c, i) => {
      const cn =
        c.cnWinRate != null
          ? ` · 国服胜率 ${pct(c.cnWinRate)}${c.cnRank != null ? `（第 ${c.cnRank} 名）` : ""}`
          : "";
      return `${i + 1}. ${c.name}（${c.epithet}）${c.tier ? ` ${c.tier}` : ""}${c.winRate ? ` 全球胜率 ${c.winRate}` : ""}${cn}`;
    }),
    list.length > shown.length ? `\n…还有 ${list.length - shown.length} 个，可用 limit 调整` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function championGuide(args: { champion: string; limit?: number }): string {
  const d = loadData();
  const matches = findChampions(args.champion);
  if (!matches.length) {
    return `没找到英雄「${args.champion}」。可以试：常用名（亚索/火男）、称号（疾风剑豪）、英文名（Yasuo）。`;
  }
  const c = matches[0];
  const limit = Math.min(Math.max(args.limit ?? 8, 1), 30);
  const out: string[] = [
    `【${c.name}】${c.epithet}${c.aliases.length ? ` · 别称：${c.aliases.join("/")}` : ""}`,
    `梯队 ${c.tier ?? "无数据"}${c.winRate ? ` · 胜率 ${c.winRate}` : ""}（社区站·全球口径）`,
    c.cnWinRate != null
      ? `国服口径：胜率 ${pct(c.cnWinRate)}${c.cnPickRate != null ? ` · 选取率 ${pct(c.cnPickRate)}` : ""}${c.cnRank != null ? ` · 国服第 ${c.cnRank} 名` : ""}（aramgg 聚合的腾讯样本）`
      : "",
    c.icon ? `图标：${c.icon}` : "",
    "",
  ].filter(Boolean);

  // 单件评价卡片：带 神级/陷阱 等标签，最有用的一层
  const cards = [...(d.cardsByChampion.get(c.id) ?? [])].sort((a, b) => {
    const trap = (x: typeof a) => (x.types.includes("陷阱") ? 1 : 0);
    return trap(a) - trap(b) || tierRank(a.tier) - tierRank(b.tier);
  });
  if (cards.length) {
    const gods = cards.filter((x) => x.types.includes("神级") || x.types.includes("强力"));
    const traps = cards.filter((x) => x.types.includes("陷阱"));
    out.push(`符文评价（社区站收录 ${cards.length} 条，带标签）：`);
    for (const card of cards.filter((x) => x.types.includes("神级")).slice(0, limit)) out.push(comboCardLine(card));
    for (const card of cards.filter((x) => x.types.includes("强力")).slice(0, Math.max(0, limit - gods.length))) {
      out.push(comboCardLine(card));
    }
    if (traps.length) {
      out.push("", `⚠ 社区站标注的陷阱符文（${traps.length} 条，慎拿）：`);
      for (const card of traps.slice(0, 5)) out.push(comboCardLine(card));
    }
    const others = cards.filter((x) => !x.types.length);
    if (others.length) {
      out.push("", `其余评价（${others.length} 条，前 4）：`);
      for (const card of others.slice(0, 4)) out.push(comboCardLine(card));
    }
  }

  const combos = [...(d.combosByChampion.get(c.id) ?? [])].sort(
    (a, b) => tierRank(a.tier) - tierRank(b.tier)
  );
  if (combos.length) {
    out.push("", `多件搭配（社区站收录 ${combos.length} 条，按档位排序）：`);
    for (const combo of combos.slice(0, limit)) {
      out.push(`  · ${describeCombo(combo, d.augmentById)}`);
    }
    if (combos.length > limit) out.push(`  …还有 ${combos.length - limit} 条`);
  } else {
    out.push("", "社区站没有收录该英雄的多件搭配。");
  }

  // 反向：该英雄进了哪些符文的强势英雄榜
  const names = new Set(championNamesFor(c).map(normalize));
  const strong = d.augments
    .filter((a) => a.stats?.topChampions.some((n) => names.has(normalize(n))))
    .sort((x, y) => (x.stats?.rank ?? 9999) - (y.stats?.rank ?? 9999));
  if (strong.length) {
    out.push("", `该英雄进入强度榜前列的符文（${strong.length} 条，前 10）：`);
    for (const a of strong.slice(0, 10)) {
      out.push(`  · ${a.name}（${rarityCn(a)}·${availabilityCn(a)}${a.stats?.rank ? `·综合第${a.stats.rank}名` : ""}${a.stats?.winRate ? `·胜率${a.stats.winRate}` : ""}）`);
    }
  }

  const sets = d.synergySets.filter((s) => combos.some((cb) => s.augmentIds.some((id) => cb.augmentIds.includes(id))));
  if (sets.length) {
    out.push("", `相关羁绊：${sets.map((s) => `${s.name}(${s.augmentIds.length}件)`).join("、")}`);
  }
  return out.join("\n");
}

function describeCombo(combo: Combo, byId: Map<string, Augment>): string {
  const names = combo.augmentIds.map((id) => {
    const a = byId.get(id);
    return a ? `${a.name}${a.availability === "live" ? "" : `(${availabilityCn(a)})`}` : id;
  });
  return `${combo.tier ?? "?"} 档：${names.join(" + ")}${combo.desc ? ` —— ${combo.desc}` : ""}`;
}

// ---------------------------------------------------------------- 版本对比

export function comparePatches(args: { base?: string; target?: string } = {}): string {
  const d = loadData();
  if (!d.patches.length) return "还没有归档任何补丁快照。先运行 npm run refresh 生成快照。";
  const target = args.target ?? d.patches[d.patches.length - 1];
  const base = args.base ?? d.patches[d.patches.length - 2];
  if (!base) {
    return `目前只有 1 个快照（${target}），无法对比。每次 npm run refresh 在新补丁下会各存一份快照，攒够两个版本就能比。`;
  }
  const A = loadSnapshot(base);
  const B = loadSnapshot(target);
  if (!A || !B) return `快照读取失败：${!A ? base : ""} ${!B ? target : ""} 不存在。`;

  const out: string[] = [`补丁对比：${base} → ${target}`, `快照时间：${A.updatedAt} → ${B.updatedAt}`, ""];
  const aMap = new Map(A.augments.map((x) => [x.id, x]));
  const bMap = new Map(B.augments.map((x) => [x.id, x]));
  const added = B.augments.filter((x) => !aMap.has(x.id));
  const removed = A.augments.filter((x) => !bMap.has(x.id));
  const changedDesc = B.augments.filter((x) => aMap.has(x.id) && aMap.get(x.id)!.descHash !== x.descHash);
  const changedRarity = B.augments.filter((x) => aMap.has(x.id) && aMap.get(x.id)!.rarity !== x.rarity);
  const changedRank = B.augments.filter(
    (x) => aMap.has(x.id) && aMap.get(x.id)!.rank !== x.rank && (x.rank || aMap.get(x.id)!.rank)
  );

  out.push(`符文：${A.augments.length} → ${B.augments.length}`);
  out.push(`  新增 ${added.length} 条${added.length ? `：${added.map((x) => x.name).join("、")}` : ""}`);
  out.push(`  移除 ${removed.length} 条${removed.length ? `：${removed.map((x) => x.name).join("、")}` : ""}`);
  out.push(`  说明改动 ${changedDesc.length} 条${changedDesc.length ? `：${changedDesc.map((x) => x.name).join("、")}` : ""}`);
  if (changedRarity.length)
    out.push(
      `  品质改动 ${changedRarity.length} 条：${changedRarity
        .map((x) => `${x.name} ${RARITY_CN[aMap.get(x.id)!.rarity] ?? aMap.get(x.id)!.rarity}→${RARITY_CN[x.rarity] ?? x.rarity}`)
        .join("、")}`
    );
  const rankMoves = changedRank
    .map((x) => ({ name: x.name, from: aMap.get(x.id)!.rank, to: x.rank }))
    .filter((m) => m.from && m.to)
    .sort((p, q) => Math.abs((q.from! - q.to!)) - Math.abs((p.from! - p.to!)));
  if (rankMoves.length) {
    out.push(`  名次变动 ${rankMoves.length} 条（波动最大的前 8）：`);
    for (const m of rankMoves.slice(0, 8)) out.push(`    · ${m.name}：${m.from} → ${m.to}`);
  }

  const aChamp = new Map(A.champions.map((x) => [x.id, x]));
  const tierChanged = B.champions.filter((x) => aChamp.has(x.id) && aChamp.get(x.id)!.tier !== x.tier);
  out.push("", `英雄：${A.champions.length} → ${B.champions.length}`);
  out.push(`  梯队变动 ${tierChanged.length} 个${tierChanged.length ? `：${tierChanged.map((x) => `${x.id} ${aChamp.get(x.id)!.tier ?? "?"}→${x.tier ?? "?"}`).join("、")}` : ""}`);

  const aSet = new Map(A.synergySets.map((x) => [x.id, x]));
  const setAdded = B.synergySets.filter((x) => !aSet.has(x.id));
  const setRemoved = A.synergySets.filter((x) => !B.synergySets.some((y) => y.id === x.id));
  out.push("", `羁绊：${A.synergySets.length} → ${B.synergySets.length}`);
  if (setAdded.length) out.push(`  新增：${setAdded.map((x) => x.name).join("、")}`);
  if (setRemoved.length) out.push(`  移除：${setRemoved.map((x) => x.name).join("、")}`);

  out.push("", "说明：快照记录的是各来源当时的数据，说明文字是否改动用哈希比对；名次/胜率变动只反映社区站统计，不代表官方改动。");
  return out.join("\n");
}

// ---------------------------------------------------------------- 输出给 index.ts 的汇总

export function rarityOptions(): string {
  return Object.values(RARITY_CN).join(" / ");
}

export type { Champion };

/**
 * 符文详情 + **本机实证**（异步版）。
 *
 * 社区站的胜率是全服口径，跟本机这批对局未必可比；这里再补一段：
 * 「在你归档的这几千把里，这个符文多少局、胜率多少；和谁一起拿更好、和谁一起拿更差」。
 * 数据来自本地归档，扫一遍约 150ms，所以直接在详情里带上，不用另开工具。
 */
export async function getAugmentToolAsync(args: { name: string; empirical?: boolean }): Promise<string> {
  const base = getAugmentTool(args);
  // 没解析出唯一目标（没找到 / 命中多个）就别硬加，免得张冠李戴
  const matches = searchAugments(args.name, { limit: 10 });
  const exact = matches.filter((m) => m.how === "完全同名");
  if (!matches.length || (!exact.length && matches.length > 1)) return base;
  const target = (exact[0] ?? matches[0]).augment;
  if (target.officialId == null) {
    return base + "\n\n本机实证：这条符文没有官方数字 id（对局记录里认不出来），无法统计。";
  }
  if (args.empirical === false) return base;

  try {
    const { augmentEmpirical } = await import("./empirical.js");
    const e = await augmentEmpirical(target.officialId);
    const out = [base, "", "本机实证（数据来自本地归档，非社区站口径）："];
    if (e.self) {
      out.push(
        `  · 在你归档的对局里被拿到 ${e.self.games} 次，胜率 ${e.self.winRate.toFixed(1)}%` +
          `（比全体基准 ${e.self.delta >= 0 ? "+" : ""}${e.self.delta.toFixed(1)} 个百分点）`
      );
    } else {
      out.push("  · 归档里几乎没有它的记录（样本不足），不下结论。");
    }
    if (e.topPairs.length) {
      out.push("  · 一起拿最赚的：" + e.topPairs.map((p) => `${p.with}（${p.games} 局 ${p.winRate.toFixed(0)}%，协同 ${p.synergy >= 0 ? "+" : ""}${p.synergy.toFixed(1)}）`).join("、"));
    }
    if (e.worstPairs.length) {
      out.push("  · 一起拿最亏的：" + e.worstPairs.map((p) => `${p.with}（${p.games} 局 ${p.winRate.toFixed(0)}%，协同 ${p.synergy >= 0 ? "+" : ""}${p.synergy.toFixed(1)}）`).join("、"));
    }
    out.push(`  · ${e.note}`);
    return out.join("\n");
  } catch (err: any) {
    // 归档为空等情况下静默降级：详情本身仍然可用，不因为补不上实证就报错
    return base;
  }
}
