/**
 * 排位段位 / 战绩（来自本地客户端，只读）。
 *
 * 已实测可用：`/lol-ranked/v1/current-ranked-stats` 返回当前登录账号的段位、
 * 每个队列的 LP 与胜负。好友的排位数据客户端不一定给（试 /ranked-stats/{puuid}，
 * 拿不到就如实说拿不到，不编）。
 */
import { clientStatus, getSummoner, lcuGet } from "./lcu.js";
import { resolveAccountByName, resolveMe } from "./identity.js";
import { loadProfile } from "./profile.js";

export interface RankedEntry {
  queueType: string;
  queueCn: string;
  tier: string;
  division: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  streak: number | null;
}

const QUEUE_CN: Record<string, string> = {
  RANKED_SOLO_5x5: "单双排",
  RANKED_FLEX_SR: "灵活组排",
  RANKED_FLEX_TT: "3v3",
  RANKED_TFT: "云顶排位",
  RANKED_TFT_DOUBLE_UP: "云顶双人",
  CHERRY: "斗魂竞技场",
};

const TIER_CN: Record<string, string> = {
  IRON: "黑铁",
  BRONZE: "青铜",
  SILVER: "白银",
  GOLD: "黄金",
  PLATINUM: "铂金",
  EMERALD: "翡翠",
  DIAMOND: "钻石",
  MASTER: "大师",
  GRANDMASTER: "宗师",
  CHALLENGER: "王者",
  UNRANKED: "未定级",
};

const tierCn = (t: string) => TIER_CN[String(t).toUpperCase()] ?? t;

function parseQueues(raw: any): RankedEntry[] {
  const queues = raw?.queues ?? raw?.rankedStats ?? [];
  return (Array.isArray(queues) ? queues : [])
    .filter((q: any) => q && (q.tier || q.queueType))
    .map((q: any) => ({
      queueType: String(q.queueType ?? q.queue ?? "?"),
      queueCn: QUEUE_CN[String(q.queueType ?? "")] ?? String(q.queueType ?? "?"),
      tier: String(q.tier ?? "UNRANKED"),
      division: String(q.division ?? ""),
      leaguePoints: Number(q.leaguePoints ?? q.lp ?? 0),
      wins: Number(q.wins ?? 0),
      losses: Number(q.losses ?? 0),
      streak: typeof q.currentStreak === "number" ? q.currentStreak : null,
    }));
}

async function fetchRankedFor(puuid: string | null, isSelf: boolean): Promise<RankedEntry[] | null> {
  const paths = isSelf
    ? ["/lol-ranked/v1/current-ranked-stats"]
    : [`/lol-ranked/v1/ranked-stats/${encodeURIComponent(puuid!)}`];
  for (const p of paths) {
    try {
      const raw = await lcuGet<any>(p);
      const entries = parseQueues(raw);
      if (entries.length) return entries;
      return []; // 拿到了但没有排位数据（未定级）
    } catch {
      /* 下一个 */
    }
  }
  return null;
}

function renderEntries(name: string, entries: RankedEntry[], source: string): string {
  if (!entries.length) {
    return `${name} 的排位数据：客户端返回为空（大概率是本赛季还没打定级赛）。\n数据来源：${source}`;
  }
  const fmt = (e: RankedEntry) => {
    const total = e.wins + e.losses;
    const wr = total ? ` · 胜率 ${((e.wins / total) * 100).toFixed(0)}%（${e.wins}胜${e.losses}负）` : "";
    const streak = e.streak ? ` · 近期${e.streak > 0 ? `${e.streak} 连胜` : `${Math.abs(e.streak)} 连败`}` : "";
    const div = e.division && e.division !== "NA" ? e.division : "";
    const lp = e.tier.toUpperCase() === "UNRANKED" ? "" : ` ${e.leaguePoints} LP`;
    return `  · ${e.queueCn}：${tierCn(e.tier)}${div}${lp}${wr}${streak}`;
  };
  return [`${name} 的排位：`, ...entries.map(fmt), `数据来源：${source}`].join("\n");
}

export async function myRanked(args: { friend?: string } = {}): Promise<string> {
  const status = await clientStatus();
  if (!status.reachable) {
    const p = loadProfile();
    return [
      "读不到排位数据：客户端没开（排位信息只能从客户端实时读，本地归档里不存段位）。",
      p ? `（上次固定下来的账号是 ${p.summonerName}，${new Date(p.updatedAt).toLocaleString("zh-CN", { hour12: false })} 保存）` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (args.friend) {
    const r = await resolveAccountByName(args.friend);
    const target = r.matches[0];
    if (!target) return `没找到「${args.friend}」——${r.note}。`;
    if (r.matches.length > 1) {
      return `「${args.friend}」匹配到多个账号：${r.matches.slice(0, 6).map((m) => m.name).join("、")}`;
    }
    const entries = await fetchRankedFor(target.puuid, false);
    if (entries === null) {
      return [
        `客户端没有提供 ${target.name} 的排位数据（接口只给当前登录账号的段位）。`,
        "想看的话：让 TA 在自己客户端里看，或者用掌盟等官方渠道。",
      ].join("\n");
    }
    return renderEntries(target.name, entries, "本地客户端");
  }

  const me = await getSummoner();
  const name = me.displayName || me.gameName || "（未命名）";
  const entries = await fetchRankedFor(me.puuid ?? null, true);
  if (entries === null) return "客户端没返回排位数据（接口可能变了）。";
  return renderEntries(name, entries, "本地客户端 current-ranked-stats");
}
