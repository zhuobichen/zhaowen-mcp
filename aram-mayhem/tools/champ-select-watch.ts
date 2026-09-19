/**
 * 盯梢选人阶段：轮询客户端阶段，一进 ChampSelect 就抓会话、拉队友战绩。
 *
 * 为什么要有它：`get_champ_select_teammates` 本身没问题（读 /lol-champ-select/v1/session，
 * 不分队列，海斗照样走这条路），但**得掐着点喊它** —— 选人窗口只有几十秒，
 * 而且切进对局的那一瞬会话会被清空成 `{}`，工具就会判定「不是选人会话」。
 * 这个脚本把「等」自动化：它一直看着，会话一出现就抓，你只管打。
 *
 * 跑：npm run champ:watch        （Ctrl+C 退出）
 *     npm run champ:watch -- --once   抓到一次就退出
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clientStatus, lcuGet } from "../lib/lcu.js";
import { scoutTeammates } from "../lib/teammates.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLL_MS = Number(process.env.CHAMP_WATCH_INTERVAL ?? 2000);
const ONCE = process.argv.includes("--once");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });

console.log(`盯梢中：每 ${POLL_MS / 1000} 秒查一次客户端阶段。进选人就抓，Ctrl+C 退出。`);
console.log("（选人窗口通常几十秒，脚本自动抓，不用你掐点。）\n");

let lastPhase: string | null = null;

/**
 * 一直等到会话里有真正的队友。
 * 刚进选人时 myTeam 可能还是空的 —— 那一刻抓会得到一份空报告。
 */
async function waitForPopulatedSession(maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const s: any = await lcuGet<any>("/lol-champ-select/v1/session");
      const team: any[] = s?.myTeam ?? [];
      if (team.length) return { ok: true, team, noPuuid: !team.some((m) => m?.puuid) };
    } catch {
      /* 会话还没建好，接着等 */
    }
    await sleep(700);
  }
  return { ok: false, team: [], noPuuid: false };
}

for (;;) {
  const st = await clientStatus();
  if (!st.reachable) {
    console.log(`[${stamp()}] 客户端没连上（${String(st.error).slice(0, 60)}）。继续等……`);
    await sleep(Math.max(POLL_MS, 5000));
    continue;
  }

  let phase: string | null = null;
  try {
    phase = await lcuGet<string>("/lol-gameflow/v1/gameflow-phase");
  } catch {
    /* 取不到就下一轮 */
  }

  if (phase !== lastPhase) {
    console.log(`[${stamp()}] 阶段：${phase}`);
    lastPhase = phase;
  }

  if (phase === "ChampSelect") {
    const got = await waitForPopulatedSession();
    if (got.ok) {
      const who = got.team.map((m: any) => m.gameName || m.summonerName || `位置${m.cellId}`).join("、");
      console.log(`[${stamp()}] 抓到选人会话（${got.team.length} 人）：${who}`);
      if (got.noPuuid) {
        console.log("  ⚠ 会话里没有 puuid —— 拿得到名字，但拉不到战绩。（这一点原先没验证过，现在算确认了）");
      }

      const r = await scoutTeammates({});
      const dir = path.join(ROOT, "reports");
      if (!existsSync(dir)) mkdirSync(dir);
      const f = path.join(dir, `选人侦察-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.txt`);
      writeFileSync(f, r.text, "utf8");
      console.log(r.text);
      console.log(`\n已存到：${f}`);
      if (ONCE) process.exit(0);

      // 这局盯完了，等离开选人再继续看下一局
      for (;;) {
        await sleep(1500);
        try {
          const p = await lcuGet<string>("/lol-gameflow/v1/gameflow-phase");
          if (p !== "ChampSelect") {
            console.log(`[${stamp()}] 已离开选人（${p}），继续盯下一局。`);
            lastPhase = p;
            break;
          }
        } catch {
          break;
        }
      }
    } else {
      console.log(`[${stamp()}] 在 ChampSelect 但会话一直没建好，跳过这次。`);
    }
  }

  await sleep(POLL_MS);
}
