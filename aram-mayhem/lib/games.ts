/**
 * 统一的对局取数入口：客户端在线就走客户端（并顺手并入本地归档），
 * 客户端没开就退回归档，并在输出里如实说明数据来源与截止时间。
 *
 * 所有分析（海斗/云顶/报告）都从这里取数，这样：
 *   · 归档会随每次查询自动积累，时间跨度可以超过接口窗口上限（海斗 200 局 / 云顶 20 局）；
 *   · 客户端没开时依然能出分析，标注清楚「这是归档数据」。
 */
import { archivedGamesFor, archiveStats, mergeIntoArchive, type ArchiveKind } from "./archive.js";
import { clientStatus, getMatchHistory } from "./lcu.js";
import { clientQueueNames, QUEUE_FALLBACK } from "./queues.js";

export interface GamesResult {
  /** 客户端摘要形态的对局（可能来自归档），时间倒序 */
  games: any[];
  /** 本次从客户端实时读到的局数 */
  fresh: number;
  /** 本次新并入归档的局数 */
  added: number;
  /** 归档里属于该账号的总局数 */
  archivedTotal: number;
  clientOnline: boolean;
  /** 一句话数据来源说明，直接放进工具输出 */
  note: string;
}

/**
 * 哪些工具依赖「我的对局数据」—— 它们在冷启动（还没绑定账号 / 没有归档）时
 * 需要补一句「怎么办」，否则返回的是空壳，看起来像装坏了。
 *
 * 这份清单是**唯一来源**：index.ts 用它决定加不加提示，
 * tools/audit-coldstart.mjs 也直接问代码要这份清单来检查 ——
 * 之前审计里自己抄了一份，结果两边漂移、互相矛盾（审计说 12 个没提示，
 * 其中一半根本不需要提示）。
 */
export const TOOLS_NEEDING_MY_DATA = [
  "analyze_my_augments", "analyze_my_playstyle",
  "get_my_teammates", "get_my_builds", "get_my_matchups", "get_my_contribution",
  "get_my_tilt", "get_my_trend", "get_my_checkup", "get_my_patches",
  "get_friend_leaderboard", "compare_accounts",
  "get_combat_profile", "get_counter_items", "get_enemy_comps",
  "get_tft_detail", "get_empirical_augments", "get_augment_pairs",
  "check_synergy_sets", "get_game_detail", "get_queue_stats",
  "export_games_csv", "export_compare_report", "export_self_compare_report",
  "export_report_markdown",
];

/**
 * 这些工具**自己的输出已经把情况说清楚了**（比如「客户端没开，本地归档里也没有该账号的对局」），
 * 不需要再补统一提示。列在这里而不是靠关键词判断 —— 之前用
 * `/客户端没开/` 之类的正则去猜，结果长文里提到一次就被误判成「已有说明」，
 * 于是真正的空壳工具（export_games_csv）反而没补上。
 */
export const TOOLS_WITH_OWN_EMPTY_MESSAGE = [
  "analyze_my_augments",
  "analyze_my_playstyle",
  "compare_accounts",
  "export_report_markdown",
  "export_compare_report",
  // 它自己就说「归档里没有样本 ≥10 局的账号（先跑 npm run archive:sync…）」
  "get_friend_leaderboard",
];

/**
 * 还没有数据时该说的话。
 *
 * 为什么单独抽出来：冷启动审计（tools/audit-coldstart.mjs）发现，第一次装上、
 * 客户端也没开的用户调用这些分析工具时，看到的是**空壳** —— 标题、空表格、
 * 口径说明，就是没有「你该做什么」。那看起来像装坏了。
 * 这句话由 index.ts 在分发层统一补上（见 withNoDataHint）。
 */
export const NO_DATA_HINT =
  "还没有可分析的对局数据。两个办法（选一个即可）：\n" +
  "  ① 打开英雄联盟客户端（进到大厅）后重新调用 —— 会实时读你最近的对局；\n" +
  "  ② 命令行跑 npm run archive:sync（加 --friends 连好友一起）把历史并进本地归档。\n" +
  "说明：本工具的数据分两部分 —— 符文/英雄图鉴是随包自带的（现在就能用），" +
  "个人战绩需要绑定本机账号后才有的读。";

const fmtDate = (t: number | null | undefined) =>
  t ? new Date(t).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—";

/**
 * 海斗/召唤师峡谷：**SGP 长历史 + LCU 细节**双源。
 *   · SGP（腾讯后端）支持 startIndex 真翻页，能给到远超 200 局的广度；
 *   · LCU 给最近 200 局，但带符文（playerAugment1..6）等细节。
 * 两者按 gameId 合并进归档；同一局若 LCU 那份更全，会覆盖 SGP 的摘要。
 */
export async function loadLolGames(puuid: string, limit = 200, name?: string | null): Promise<GamesResult> {
  return await load("lol", puuid, limit, async () => {
    const out: Array<{ games: any[]; source: string }> = [];
    // 先 SGP（深）
    try {
      const { getSgpContext, fetchSgpHistory, sgpToGame } = await import("./sgp.js");
      const ctx = await getSgpContext();
      const games = await fetchSgpHistory(ctx, puuid, { pageSize: 100, maxGames: 2000 });
      if (games.length) out.push({ source: "sgp", games: games.map((g) => sgpToGame(g, puuid)) });
    } catch {
      /* SGP 不通就只靠 LCU */
    }
    // 再 LCU（细节全）
    try {
      const { games } = await getMatchHistory(200, puuid);
      if (games.length) out.push({ source: "lcu", games });
    } catch {
      /* 忽略 */
    }
    return out;
  }, name);
}

/** 云顶：客户端最多给最近 20 局 */
export async function loadTftGames(puuid: string, name?: string | null): Promise<GamesResult> {
  return await load("tft", puuid, 2000, async () => {
    const out: Array<{ games: any[]; source: string }> = [];
    // SGP：云顶也能分页（实测 684 局），远深于客户端的 20 局
    try {
      const { getSgpContext, fetchSgpHistory, sgpTftToGame } = await import("./sgp.js");
      const ctx = await getSgpContext();
      const games = await fetchSgpHistory(ctx, puuid, { pageSize: 100, maxGames: 2000, product: "tft" });
      if (games.length) out.push({ source: "sgp", games: games.map((g) => sgpTftToGame(g, puuid)) });
    } catch {
      /* SGP 不通就只靠 LCU */
    }
    try {
      const { getTftGames } = await import("./tft.js");
      const games = await getTftGames(puuid);
      if (games.length) out.push({ source: "lcu", games });
    } catch {
      /* 忽略 */
    }
    return out;
  }, name);
}

async function load(
  kind: ArchiveKind,
  puuid: string,
  limit: number,
  fetchFresh: () => Promise<Array<{ games: any[]; source: string }>>,
  name?: string | null
): Promise<GamesResult> {
  const status = await clientStatus();
  let fresh = 0;
  let added = 0;
  let fetchError: string | null = null;

  if (status.reachable) {
    try {
      for (const batch of await fetchFresh()) {
        fresh += batch.games.length;
        const merged = await mergeIntoArchive(kind, batch.games, puuid, name ?? null, batch.source);
        added += merged.added;
      }
    } catch (e: any) {
      fetchError = e?.message ?? String(e);
    }
  }

  const archived = await archivedGamesFor(kind, puuid);
  const stats = await archiveStats(kind, puuid);
  let games = archived;
  if (!games.length) games = [];

  if (!games.length) {
    return {
      games: [],
      fresh,
      added,
      archivedTotal: 0,
      clientOnline: status.reachable,
      note: status.reachable
        ? "客户端在线，但这次没读到对局记录（可能是新账号或记录还没同步）。"
        : `客户端没开，本地归档里也没有该账号的对局 —— ${status.error}`,
    };
  }

  const noteParts: string[] = [];
  if (status.reachable) {
    noteParts.push(`客户端在线，本次读到 ${fresh} 局（新并入归档 ${added} 局）`);
  } else {
    noteParts.push(`⚠ 客户端没开，以下用的是**本地归档**（${fetchError ? `实时读取失败：${fetchError}` : status.error}）`);
  }
  noteParts.push(
    `归档共 ${stats.total} 局，覆盖 ${fmtDate(stats.from)} ~ ${fmtDate(stats.to)}` +
      (stats.updatedAt ? `，最后更新 ${new Date(stats.updatedAt).toLocaleString("zh-CN", { hour12: false })}` : "")
  );
  if (games.length > limit) {
    // 归档比窗口更全时，如实说明
    noteParts.push(`归档比接口窗口更全（接口上限 ${kind === "lol" ? 200 : 20} 局），分析用的是归档全量`);
  }

  return {
    games: games.slice(0, Math.max(limit, games.length)),
    fresh,
    added,
    archivedTotal: stats.total,
    clientOnline: status.reachable,
    note: noteParts.join("；"),
  };
}

/** 归档概览文本（给 get_archive_info 用） */
export async function archiveInfo(): Promise<string> {
  const lol = await archiveStats("lol");
  const tft = await archiveStats("tft");
  const fmt = (t: number | null) => (t ? new Date(t).toLocaleString("zh-CN", { hour12: false, dateStyle: "short" }) : "—");
  const status = await clientStatus();
  // 客户端队列表只取一次（它是权威来源），下面两个 kind 共用；
  // 客户端没开时拿到空表，判断会退回内置兜底表 —— 那时偏保守，宁可多报也不漏。
  const clientQueues = await clientQueueNames();
  const unknownOf = (byQueue: Record<string, number> | undefined) =>
    [...new Set(Object.keys(byQueue ?? {}).map(Number))]
      .filter((q) => q && !clientQueues.has(q) && !(q in QUEUE_FALLBACK))
      .sort((a, b) => a - b);
  const kindLines = (label: string, st: Awaited<ReturnType<typeof archiveStats>>) => [
    `${label}：${st.total} 局`,
    `  覆盖面 ${fmt(st.from)} ~ ${fmt(st.to)}${st.updatedAt ? `（最后更新 ${fmt(Date.parse(st.updatedAt))}）` : ""}`,
    st.total
      ? `  按模式：${Object.entries(st.byMode)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k} ${v}`)
          .join(" · ")}`
      : "  （空）",
    st.accounts.length
      ? `  账号：${st.accounts.slice(0, 6).map((a) => `${a.name ?? a.puuid.slice(0, 8)}（${a.games} 局）`).join("、")}`
      : "",
    st.total ? `  来源：${Object.entries(st.bySource ?? {}).map(([k, v]) => `${k} ${v}`).join(" · ")}` : "",
    (() => {
      const unknown = unknownOf(st.byQueue);
      return unknown.length
        ? `  ⚠ 未登记队列（可能是新队列，识别会漏判）：${unknown.map((q) => `${q}（${st.byQueue[String(q)]} 局）`).join("、")}`
        : "";
    })(),
  ].filter(Boolean);
  return [
    "=== 本地对局归档 ===",
    `客户端状态：${status.reachable ? "在线" : "离线"}`,
    "",
    ...kindLines("海斗/英雄联盟", lol),
    "",
    ...kindLines("云顶之弈", tft),
    "",
    "归档是只增不减的：每次用账号/好友/云顶战绩功能查询时，读到的新对局都会按 gameId 并进来，",
    "所以攒得越久，覆盖时间越长（可以超过接口窗口上限：海斗 200 局、云顶 20 局）。",
    "客户端没开时，分析会改用归档数据，并在输出里标注来源与截止时间。",
    "文件：data/archive/lol-matches.json、data/archive/tft-matches.json（已在 .gitignore 排除，不上传）。",
  ].join("\n");
}
