/**
 * 导出 CSV：把你（或好友）的对局明细导成表格，方便自己丢进 Excel / pandas 再看。
 *
 * 只导出归档 + 接口能读到的字段，读不到的列留空而不是填 0 —— 空 = 没有这个数据，
 * 0 = 真的是 0，这两件事在那张表里必须能分开。
 *
 * 文件写到仓库的 reports/ 目录（已在 .gitignore 排除，不会上传）。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLolGames, loadTftGames } from "./games.js";
import { resolveAccountByName, resolveMe } from "./identity.js";
import { isMayhemGame } from "./lcu.js";
import { queueName } from "./queues.js";
import { loadData } from "./store.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPORTS_DIR = path.join(ROOT, "reports");

/** CSV 单元格转义：含分隔符/引号/换行就加引号；null/undefined 一律空串 */
function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const row = (cells: unknown[]) => cells.map(cell).join(",");

export type ExportKind = "mayhem" | "lol" | "tft";

export interface ExportResult {
  path: string;
  rows: number;
  columns: string[];
  kind: ExportKind;
  who: string;
  /** 前几行预览（含表头），给工具输出用 */
  preview: string;
  note: string;
}

/**
 * 队列名解析是异步的（要先问客户端拿一次队列表），
 * 所以先在循环外把出现过的队列 id 一次性解析成 map，循环里同步取 —— 顺便避免每行重复查。
 */
async function queueNameMap(games: any[]): Promise<(id: number | null | undefined) => string> {
  const ids = [...new Set(games.map((g) => g.queueId).filter((x): x is number => typeof x === "number"))];
  const map = new Map<number, string>();
  await Promise.all(ids.map(async (id) => map.set(id, await queueName(id))));
  return (id) => (typeof id === "number" ? map.get(id) ?? `队列 ${id}` : "");
}

const fmtTime = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
};

export async function exportCsv(
  opts: { who?: string; kind?: ExportKind; out?: string; minDuration?: number } = {}
): Promise<ExportResult> {
  let puuid: string;
  let name: string;
  if (opts.who) {
    const r = await resolveAccountByName(opts.who);
    if (!r.matches.length) throw new Error(`没找到「${opts.who}」——${r.note}`);
    puuid = r.matches[0].puuid;
    name = r.matches[0].name;
  } else {
    const me = await resolveMe();
    if (!me) throw new Error("客户端没开且没有固定过账号：先在线跑一次 get_my_account_status。");
    puuid = me.puuid;
    name = me.name;
  }

  const kind: ExportKind = opts.kind ?? "mayhem";

  if (kind === "tft") {
    const res = await loadTftGames(puuid, name);
    const header = ["日期", "时间", "队列", "名次", "等级", "最后一轮", "淘汰人数", "对玩家伤害", "时长(分)", "羁绊", "棋子"];
    const d = loadData();
    const lines = [row(header)];
    // 时间倒序 → CSV 里按时间正序更好用
    const games = [...res.games].sort((a, b) => (a.gameCreation ?? 0) - (b.gameCreation ?? 0));
    const qn = await queueNameMap(games);
    for (const g of games) {
      const p = (g.participants ?? []).find((x: any) => x.puuid === puuid);
      if (!p) continue;
      const { date, time } = fmtTime(g.gameCreation ?? 0);
      const traits = (p.traits ?? [])
        .filter((t: any) => (t.num_units ?? 0) >= 2)
        .sort((a: any, b: any) => (b.num_units ?? 0) - (a.num_units ?? 0))
        .map((t: any) => `${d.tftNames.traits[t.name] ?? t.name}${t.num_units}`)
        .join(" ");
      const units = (p.units ?? [])
        .map((u: any) => `${d.tftNames.champions[u.character_id] ?? u.character_id}${u.tier ? `★${u.tier}` : ""}`)
        .join(" ");
      lines.push(
        row([
          date,
          time,
          qn(g.queueId),
          p.placement,
          p.level,
          p.last_round,
          p.players_eliminated,
          p.total_damage_to_players,
          Math.round((g.gameDuration ?? 0) / 60),
          traits,
          units,
        ])
      );
    }
    return await finish(lines, header, kind, name, opts.out, res.note);
  }

  const res = await loadLolGames(puuid, 2000, name);
  const all = kind === "mayhem" ? res.games.filter(isMayhemGame) : res.games;
  const header = [
    "日期", "时间", "队列", "英雄", "结果", "击杀", "死亡", "助攻", "KDA",
    "伤害", "承伤", "金币", "补刀", "时长(分)", "等级",
    "双杀", "三杀", "四杀", "五杀", "首杀",
    "符文1", "符文2", "符文3", "符文4", "符文5", "符文6",
    "装备1", "装备2", "装备3", "装备4", "装备5", "装备6",
    // 队内名次（伤害）与对面阵容构成，方便自己在 Excel 里做交叉切片
    "队内伤害名次", "对面坦克", "对面战士", "对面刺客", "对面法师", "对面射手", "对面辅助",
  ];
  const d = loadData();
  // 少数 id 在本地符文库里查不到（实测是已轮换掉/别的不在池列表里的符文）——如实标成「未知符文#id」而不是留空
  const augName = (id: number | null | undefined) =>
    id ? d.augments.find((a) => a.officialId === id)?.name ?? `未知符文#${id}` : "";
  const itemName = (id: number | null | undefined) => (id ? d.items[String(id)]?.name ?? `未知装备#${id}` : "");

  const lines = [row(header)];
  const games = [...all].sort((a, b) => (a.gameCreation ?? 0) - (b.gameCreation ?? 0));
  const qn = await queueNameMap(games);
  let skipped = 0;
  for (const g of games) {
    const p = (g.participants ?? []).find((x: any) => x.puuid === puuid);
    if (!p) {
      skipped++;
      continue;
    }
    const s: any = p.stats ?? {};
    const { date, time } = fmtTime(g.gameCreation ?? 0);
    const k = Number(s.kills ?? 0),
      dd = Number(s.deaths ?? 0),
      a = Number(s.assists ?? 0);

    // 队内伤害名次（只在有队友数据时才算，LCU 那种只有自己一行的局留空）
    const mates = (g.participants ?? []).filter(
      (x: any) => x.teamId === p.teamId && x.puuid !== puuid
    );
    const myDmg = Number(s.totalDamageDealtToChampions ?? 0);
    const dmgRank =
      mates.length >= 2
        ? 1 + mates.filter((x: any) => Number((x.stats as any)?.totalDamageDealtToChampions ?? 0) > myDmg).length
        : "";

    // 对面阵容构成（按 Riot 官方定位标签数人头；一名英雄可挂多个标签）
    const foeRoles: Record<string, number> = {};
    if (mates.length) {
      for (const x of g.participants ?? []) {
        if (x.teamId === p.teamId || !x.championId) continue;
        const cid = d.championIds[String(x.championId)];
        const roles = cid ? d.championById.get(cid.id)?.roles ?? [] : [];
        for (const r of new Set(roles)) foeRoles[r] = (foeRoles[r] ?? 0) + 1;
      }
    }
    const foeCols = ["tank", "fighter", "assassin", "mage", "marksman", "support"].map((r) =>
      mates.length ? foeRoles[r] ?? 0 : ""
    );
    const augs = [1, 2, 3, 4, 5, 6].map((i) => augName(s[`playerAugment${i}`]));
    const items = [0, 1, 2, 3, 4, 5].map((i) => itemName(s[`item${i}`]));
    lines.push(
      row([
        date,
        time,
        qn(g.queueId),
        d.championIds[String(p.championId)]?.name ?? (p.championId ? `英雄#${p.championId}` : ""),
        s.win === true ? "胜" : s.win === false ? "负" : "",
        k, dd, a, ((k + a) / Math.max(dd, 1)).toFixed(2),
        s.totalDamageDealtToChampions, s.totalDamageTaken, s.goldEarned,
        s.totalMinionsKilled, Math.round((g.gameDuration ?? 0) / 60), s.champLevel,
        s.doubleKills, s.tripleKills, s.quadraKills, s.pentaKills,
        // 只在这条记录确实带这个字段时才写 0/1；没这个字段就留空（空≠没有首杀）
        s.firstBloodKill === undefined ? "" : s.firstBloodKill ? 1 : 0,
        ...augs,
        ...items,
        dmgRank,
        ...foeCols,
      ])
    );
  }

  const out = await finish(lines, header, kind, name, opts.out, res.note);
  if (skipped) out.note += `；有 ${skipped} 局的记录里没有你的参与行（LCU 摘要格式），已跳过`;
  return out;
}

async function finish(
  lines: string[],
  header: string[],
  kind: ExportKind,
  name: string,
  outArg: string | undefined,
  sourceNote: string
): Promise<ExportResult> {
  const safe = name.replace(/[\\/:*?"<>|]/g, "_");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const label = kind === "tft" ? "云顶" : kind === "mayhem" ? "海斗" : "全部模式";
  const out = outArg ?? path.join(REPORTS_DIR, `${label}对局明细-${safe}-${stamp}.csv`);
  await mkdir(path.dirname(out), { recursive: true });
  // 带 BOM：Excel 打开中文才不乱码
  await writeFile(out, "﻿" + lines.join("\r\n") + "\r\n", "utf8");
  return {
    path: out,
    rows: lines.length - 1,
    columns: header,
    kind,
    who: name,
    preview: lines.slice(0, 4).join("\n"),
    note: sourceNote,
  };
}

/** 给人看的文本输出 */
export async function exportText(opts: { who?: string; kind?: ExportKind; out?: string } = {}): Promise<string> {
  let r: ExportResult;
  try {
    r = await exportCsv(opts);
  } catch (e: any) {
    return `导出失败：${e?.message ?? e}`;
  }
  return [
    `已导出 ${r.rows} 行到：${r.path}`,
    `账号 ${r.who} · ${r.columns.length} 列`,
    "",
    "前几行：",
    r.preview,
    "",
    `数据来源：${r.note}`,
    "说明：读不到的字段留空（空 = 没有这项数据，和 0 不是一回事）；文件带 BOM，Excel 直接打开中文不乱码。",
  ].join("\n");
}
