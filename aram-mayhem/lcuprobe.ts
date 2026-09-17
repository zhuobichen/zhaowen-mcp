// 临时探测脚本：检查本地客户端能不能连、对局记录里有哪些字段（用完即删）
import { clientStatus, getRecentGames, isMayhemGame, getSummoner, augmentIdsOf, myParticipantId } from "./lib/lcu.js";
import { loadData } from "./lib/store.js";

const s = await clientStatus();
console.log("客户端状态:", JSON.stringify(s, null, 1));
if (!s.reachable) process.exit(0);

const me = await getSummoner();
console.log("账号:", me.displayName || me.gameName, "| puuid:", me.puuid, "| 等级:", me.summonerLevel);

const games = await getRecentGames(20);
console.log("最近对局数:", games.length, "| 海斗:", games.filter(isMayhemGame).length);

const d = loadData();
const pidOf = (g: any) => myParticipantId(g, { puuid: me.puuid, name: (me.displayName || me.gameName || "").split("#")[0] });

for (const g of games.slice(0, 5)) {
  const pid = pidOf(g);
  const ids = augmentIdsOf(g, pid);
  const names = ids.map((id) => {
    const a = d.augments.find((x) => x.officialId === id);
    return a ? `${a.name}(#${id})` : `未知#${id}`;
  });
  const p = (g.participants ?? []).find((x) => x.participantId === pid) ?? (g.participants ?? [])[0];
  const c = d.championIds[String(p?.championId)];
  console.log(
    `gameId ${g.gameId} | ${g.gameMode} | 我=${pid} | 英雄=${c ? d.championById.get(c.id)?.name ?? c.name : p?.championId} | 胜=${p?.stats?.win} | 符文: ${names.join("、") || "无"}`
  );
}

const allIds = new Set<number>();
for (const g of games) for (const id of augmentIdsOf(g, pidOf(g))) allIds.add(id);
const unknown = [...allIds].filter((id) => !d.augments.some((a) => a.officialId === id));
console.log(`\n统计到的符文 id 去重后 ${allIds.size} 个，本地符文库认不出的 ${unknown.length} 个`, unknown.length ? `：${unknown.join(",")}` : "");
