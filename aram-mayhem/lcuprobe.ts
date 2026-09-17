// 临时探测脚本：检查本地客户端能不能连、对局记录里有哪些字段（用完即删）
import { clientStatus, getRecentGames, isMayhemGame, getSummoner } from "./lib/lcu.js";

const s = await clientStatus();
console.log("客户端状态:", JSON.stringify(s, null, 1));
if (s.reachable) {
  const me = await getSummoner();
  console.log("账号:", me.displayName, "| puuid:", me.puuid, "| 等级:", me.summonerLevel);
  const games = await getRecentGames(20);
  console.log("最近对局数:", games.length);
  const modes: Record<string, number> = {};
  for (const g of games) modes[String(g.gameMode)] = (modes[String(g.gameMode)] ?? 0) + 1;
  console.log("模式分布:", JSON.stringify(modes));
  console.log("识别为海斗的对局:", games.filter(isMayhemGame).length);
  const g = games[0];
  if (g) {
    console.log("单局顶层字段:", Object.keys(g).join(","));
    const p = (g.participants ?? [])[0];
    console.log("participants[0] 字段:", Object.keys(p ?? {}).join(","));
    const stats = p?.stats ?? {};
    console.log("stats 字段:", Object.keys(stats).join(","));
    const augFields = Object.keys(stats).filter((k) => /augment/i.test(k));
    console.log("stats 里的 augment 字段:", augFields.length ? augFields.join(",") : "无");
    console.log("单局摘要样例:", {
      gameMode: g.gameMode,
      queueId: g.queueId,
      championId: p?.championId,
      win: (stats as Record<string, unknown>).win,
      kills: (stats as Record<string, unknown>).kills,
    });
  }
}
