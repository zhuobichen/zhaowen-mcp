/**
 * 队列 id → 中文名。
 *
 * 首选客户端自带的 `/lol-game-data/assets/v1/queues.json`（官方本地化，最准）；
 * 客户端没开时退回下面这张手工对照表（覆盖常见队列，标注为手工维护，可能滞后）。
 */
import { lcuGet } from "./lcu.js";

/**
 * 手工维护兜底表（名称取自客户端 queues.json 实测，2026-09-18 核对）
 * 客户端在线时优先用实时队列表；这张表保证离线也有名字可显示。
 */
export const QUEUE_FALLBACK: Record<number, string> = {
  0: "自定义/训练",
  400: "普通匹配（征召）",
  420: "单双排",
  430: "普通匹配（盲选）",
  440: "灵活组排",
  450: "极地大乱斗",
  700: "斗魂竞技场（旧）",
  720: "冠军杯赛",
  830: "人机（入门）",
  840: "人机（新手）",
  850: "人机（一般）",
  900: "无限乱斗",
  1020: "克隆模式",
  1090: "云顶之弈（自然之力 匹配 BETA测试）",
  1100: "云顶之弈 (自然之力 排位 BETA测试)",
  1160: "云顶之弈 (自然之力 双人作战 BETA测试)",
  1210: "云顶之弈 (英雄联盟传奇 恭喜发财)",
  1700: "斗魂竞技场",
  1900: "无限乱斗（旧）",
  2400: "海克斯大乱斗",
  2410: "海克斯大乱斗 巅峰赛",
  2450: "海克斯大乱斗 经典模式版",
  3140: "多人 训练模式 自定义",
  3270: "海克斯大乱斗（自定义）",
  6100: "恭喜发财 天下无双格斗大赛",
  6110: "星神 匹配",
  // 4310：客户端队列表里**没有名称**，但实测 gameMode=KIWI（即海斗）。
  // 保留此条目并标注清楚，避免它被当成"未知队列"反复提示。
  4310: "（队列 4310，官方无名称；实测 gameMode=KIWI，按海斗计入）",
};

let cache: Map<number, string> | null = null;

/** 客户端队列表（拿不到就返回空表，由调用方退回 QUEUE_FALLBACK） */
export async function clientQueueNames(): Promise<Map<number, string>> {
  if (cache) return cache;
  const map = new Map<number, string>();
  try {
    const raw: any = await lcuGet<any>("/lol-game-data/assets/v1/queues.json");
    const list: any[] = Array.isArray(raw) ? raw : Object.values(raw ?? {});
    for (const q of list) {
      if (q && typeof q.id === "number") map.set(q.id, String(q.name ?? q.shortName ?? q.id).trim());
    }
  } catch {
    /* 客户端没开：下面用兜底表 */
  }
  cache = map;
  return map;
}

/** 单个队列名：客户端优先，其次兜底表，最后显示 id */
export async function queueName(id: number | undefined | null): Promise<string> {
  if (id == null) return "未知队列";
  const map = await clientQueueNames();
  return map.get(id) ?? QUEUE_FALLBACK[id] ?? `队列 ${id}`;
}

/** 排位判定：队列名带「排位」，或命中已知排位 id */
export function isRankedQueue(id: number | undefined | null, name?: string): boolean {
  if (id == null) return false;
  if ([1100, 1160].includes(id)) return true;
  const n = name ?? QUEUE_FALLBACK[id] ?? "";
  return /排位/.test(n);
}


/**
 * 哪些队列算「海克斯大乱斗」（实测国服 2026-09）：
 *   2400 = 海克斯大乱斗（普通）
 *   2410 = 海克斯大乱斗 巅峰赛
 *   2450 = 海克斯大乱斗 经典模式版
 *   3270 = 海斗自定义（社区实现里提到）
 * 另外客户端对局摘要里的 gameMode 是 KIWI / KIWI_JADE / JADE —— 两种判据都要用，
 * 因为 SGP 记录里 gameMode 未必填、LCU 记录里 queueId 一定在。
 */
export const MAYHEM_QUEUE_IDS = [2400, 2410, 2450, 3270];

export function isMayhemQueue(queueId: number | null | undefined): boolean {
  return queueId != null && MAYHEM_QUEUE_IDS.includes(queueId);
}


/**
 * 自检：数据里出现过、但我们**连名字都不知道**的队列（不在 QUEUE_FALLBACK 里）。
 * 用途：万一官方以后新增海斗队列（比如又一个"XX 版"），识别会静默漏判 ——
 * 这个方法把"未知队列"揪出来，让漏判变成可见提示，而不是悄悄少算几局。
 */
export function unknownQueues(queueIds: Iterable<number>): number[] {
  const out: number[] = [];
  for (const id of new Set(queueIds)) {
    if (id && !(id in QUEUE_FALLBACK)) out.push(id);
  }
  return out.sort((a, b) => a - b);
}
