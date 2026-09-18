/**
 * 选人阶段：侦察队友，并把他们的近期战绩整理成「评语」。
 *
 * 设计边界（重要）：
 *   · 默认只**读**，并把结果给你自己看 —— 不往任何频道自动发言；
 *   · `sendChampSelectMessage()` 只在你显式指定文本、且显式确认时发送一条，
 *     一次一条、内容由你决定（等价于你自己打字，只是快一点）；
 *   · 不提供「按队友自动生成锐评并批量发送」的功能：那是把自动生成的负面评价
 *     推给随机匹配的陌生人，既踩腾讯的重罚条款，也让不知情的人挨骂。
 *
 * 接口（均为客户端本地 LCU，只读为主）：
 *   · 读选人会话：GET /lol-champ-select/v1/session（含 myTeam 与 chatDetails.multiUserChatId）
 *   · 发一条消息：POST /lol-chat/v1/conversations/{multiUserChatId}/messages
 */
import { augmentIdsOf, clientStatus, isMayhemGame, lcuGet, myParticipantId } from "./lcu.js";
import { loadLolGames } from "./games.js";
import { loadData } from "./store.js";

export interface Teammate {
  cellId: number;
  puuid: string | null;
  summonerId: number | null;
  name: string;
  /** 已经锁定的英雄（没选就是 null） */
  championId: number | null;
  isMe: boolean;
}

export interface ChampSelectInfo {
  inProgress: boolean;
  myTeam: Teammate[];
  /** 选人频道的会话 id（发消息要用） */
  chatId: string | null;
  /** 当前处于哪个阶段，如 PLANNING / BAN_PICK / FINALIZATION */
  phase: string | null;
}

/** 读当前选人会话（不在选人阶段则返回 inProgress=false） */
export async function getChampSelect(myPuuid?: string | null): Promise<ChampSelectInfo> {
  try {
    const s: any = await lcuGet<any>("/lol-champ-select/v1/session");
    const myTeam: Teammate[] = (s?.myTeam ?? []).map((m: any) => ({
      cellId: m.cellId ?? 0,
      puuid: m.puuid ?? null,
      summonerId: m.summonerId ?? null,
      name: m.gameName || m.summonerName || m.displayName || `位置${m.cellId}`,
      championId: m.championId || null,
      isMe: !!myPuuid && m.puuid === myPuuid,
    }));
    return {
      inProgress: true,
      myTeam,
      chatId: s?.chatDetails?.multiUserChatId ?? null,
      phase: s?.timer?.phase ?? s?.phase ?? null,
    };
  } catch {
    return { inProgress: false, myTeam: [], chatId: null, phase: null };
  }
}

/** 单个队友的近期战绩摘要 */
export interface TeammateReport {
  name: string;
  isMe: boolean;
  champion: string | null;
  games: number;
  wins: number;
  winRate: number;
  topChampions: Array<{ name: string; games: number; wins: number }>;
  topAugments: Array<{ name: string; games: number; wins: number }>;
  /** 最近 20 把胜率，用来看「手热不热」 */
  recentWinRate: number | null;
  longestLossStreak: number;
  note: string;
}

/** 把一个 puuid 的近期海斗战绩整理成摘要 */
export async function reportFor(
  puuid: string,
  name: string,
  opts: { games?: number; isMe?: boolean; champion?: string | null } = {}
): Promise<TeammateReport> {
  const d = loadData();
  const res = await loadLolGames(puuid, opts.games ?? 100, name);
  const rows = res.games
    .filter(isMayhemGame)
    .map((g: any) => {
      const pid = myParticipantId(g, { puuid, name: name.split("#")[0] });
      const p = (g.participants ?? []).find((x: any) => x.participantId === pid) ?? (g.participants ?? [])[0];
      const s: any = p?.stats ?? {};
      const cid = d.championIds[String(p?.championId)];
      return {
        t: g.gameCreation,
        win: s.win === true,
        champ: cid ? d.championById.get(cid.id)?.name ?? cid.name : `英雄#${p?.championId}`,
        augments: augmentIdsOf(g, pid),
      };
    })
    .sort((a: any, b: any) => a.t - b.t);

  const n = rows.length;
  const wins = rows.filter((r) => r.win).length;
  const bucket = (key: (r: any) => string) => {
    const m = new Map<string, { games: number; wins: number }>();
    for (const r of rows) {
      const k = key(r);
      const c = m.get(k) ?? { games: 0, wins: 0 };
      c.games++;
      if (r.win) c.wins++;
      m.set(k, c);
    }
    return [...m.entries()].map(([k, v]) => ({ name: k, ...v })).sort((a, b) => b.games - a.games);
  };
  const augStat = new Map<number, { games: number; wins: number }>();
  for (const r of rows) {
    for (const id of r.augments) {
      const c = augStat.get(id) ?? { games: 0, wins: 0 };
      c.games++;
      if (r.win) c.wins++;
      augStat.set(id, c);
    }
  }
  const topAugments = [...augStat.entries()]
    .map(([id, v]) => ({ name: d.augments.find((a) => a.officialId === id)?.name ?? `#${id}`, ...v }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 3);

  const recent = rows.slice(-20);
  const recentWinRate = recent.length ? (recent.filter((r) => r.win).length / recent.length) * 100 : null;
  let longestLossStreak = 0;
  let cur = 0;
  for (const r of rows) {
    if (!r.win) {
      cur++;
      longestLossStreak = Math.max(longestLossStreak, cur);
    } else cur = 0;
  }

  const champCn = opts.champion ?? null;
  const parts: string[] = [];
  if (n) parts.push(`近期 ${n} 把海斗 ${((wins / n) * 100).toFixed(0)}% 胜率`);
  if (recentWinRate != null) parts.push(`最近 20 把 ${recentWinRate.toFixed(0)}%`);
  const top = bucket((r) => r.champ).slice(0, 3);
  if (top.length) parts.push(`常玩 ${top.map((t) => t.name).join("/")}`);

  return {
    name,
    isMe: !!opts.isMe,
    champion: champCn,
    games: n,
    wins,
    winRate: n ? (wins / n) * 100 : 0,
    topChampions: top,
    topAugments,
    recentWinRate,
    longestLossStreak,
    note: parts.join(" · ") || "没有可读到的海斗记录",
  };
}

export interface ScoutResult {
  champSelect: ChampSelectInfo;
  reports: TeammateReport[];
  text: string;
}

/**
 * 侦察当前选人阶段的所有队友（**只读**）。
 * 返回的报告是给你自己看的；要发给队友，请自己改写后手动发送。
 */
export async function scoutTeammates(opts: { games?: number; myPuuid?: string | null } = {}): Promise<ScoutResult> {
  const status = await clientStatus();
  if (!status.reachable) {
    return {
      champSelect: { inProgress: false, myTeam: [], chatId: null, phase: null },
      reports: [],
      text: `客户端没开，读不到选人会话（${String(status.error).slice(0, 80)}）。`,
    };
  }
  const cs = await getChampSelect(opts.myPuuid ?? null);
  if (!cs.inProgress) {
    return { champSelect: cs, reports: [], text: "当前不在选人阶段（或者这不是一场召唤师峡谷/海斗的选人会话）。" };
  }
  const d = loadData();
  const reports: TeammateReport[] = [];
  for (const m of cs.myTeam) {
    if (m.isMe || !m.puuid) continue;
    const champ = m.championId
      ? d.championIds[String(m.championId)]
        ? d.championById.get(d.championIds[String(m.championId)].id)?.name ?? `英雄#${m.championId}`
        : `英雄#${m.championId}`
      : null;
    reports.push(await reportFor(m.puuid, m.name, { games: opts.games ?? 100, champion: champ }));
  }
  const lines = [
    `选人阶段（${cs.phase ?? "未知阶段"}）· 队友 ${cs.myTeam.length} 人（含自己）`,
    "",
    ...reports.map((r) => {
      const champ = r.champion ? `【${r.champion}】` : "";
      return `· ${champ}${r.name}：${r.note}` + (r.longestLossStreak >= 5 ? `（有过 ${r.longestLossStreak} 连败）` : "");
    }),
    "",
    "⚠ 这份报告是给你自己看的。要发给别人，请自己改写后手动发送 —— 自动把评价推给陌生队友既容易挨举报，也不是我会做的功能。",
    `（要发的话：npm run team:say -- --yes "你的文本"，会发到当前选人频道${cs.chatId ? `（会话 ${cs.chatId}）` : ""}）`,
  ];
  return { champSelect: cs, reports, text: lines.join("\n") };
}

/**
 * 往当前选人频道发**一条**消息（内容由你指定，且需显式确认）。
 * 这是「你自己发言的加速器」，不是自动发言机器人：一次一条、文本由你决定。
 */
export async function sendChampSelectMessage(args: { text: string; confirm: boolean }): Promise<string> {
  if (!args.confirm) {
    return "没有发送：需要显式确认（CLI 里加 --yes，MCP 工具里传 confirm=true）。";
  }
  const text = String(args.text ?? "").trim();
  if (!text) return "文本为空，没发。";
  if (text.length > 200) return "文本超过 200 字，选人频道发不出去（也不该发这么长）。";

  const status = await clientStatus();
  if (!status.reachable) return `客户端没开，发不了（${String(status.error).slice(0, 80)}）。`;

  const cs = await getChampSelect();
  if (!cs.inProgress || !cs.chatId) {
    return "当前不在选人阶段（或拿不到选人频道会话 id），没发。";
  }
  const { lcuPost } = await import("./lcu.js");
  await lcuPost(`/lol-chat/v1/conversations/${encodeURIComponent(cs.chatId)}/messages`, {
    body: text,
    type: "chat",
  });
  return `已发送到选人频道（会话 ${cs.chatId}）：${text}`;
}
