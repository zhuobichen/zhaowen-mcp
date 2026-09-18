/** 选人阶段队友侦察 CLI
 *  npm run team:scout                      # 只读：把队友近期战绩整理给你看
 *  npm run team:say -- --yes "文本"         # 发一条（内容你定，--yes 为显式确认）
 */
import { resolveMe } from "./identity.js";
import { scoutTeammates, sendChampSelectMessage } from "./teammates.js";

const args = process.argv.slice(2);
if (args[0] === "say") {
  const yes = args.includes("--yes");
  const text = args.filter((a) => a !== "--yes" && a !== "say").join(" ");
  console.log(await sendChampSelectMessage({ text, confirm: yes }));
} else {
  const me = await resolveMe();
  const r = await scoutTeammates({ myPuuid: me?.puuid ?? null, games: 100 });
  console.log(r.text);
}
