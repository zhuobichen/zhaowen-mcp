/**
 * 队列 id → 中文名。
 *
 * 首选客户端自带的 `/lol-game-data/assets/v1/queues.json`（官方本地化，最准）；
 * 客户端没开时退回下面这张手工对照表（覆盖常见队列，标注为手工维护，可能滞后）。
 */
import { lcuGet } from "./lcu.js";

/** 手工维护兜底表（国服队列名，2026-09 实测） */
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
  900: "无限火力",
  1020: "克隆模式",
  1090: "云顶之弈（匹配）",
  1100: "云顶之弈（排位）",
  1110: "云顶之弈（教程）",
  1160: "云顶之弈（双人排位）",
  1210: "云顶之弈（恭喜发财）",
  1700: "斗魂竞技场",
  1900: "无限乱斗",
  2400: "海克斯大乱斗",
  6110: "星神（匹配）",
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
