/** 手动跑一下对位分析（免开 MCP）：npx tsx lib/matchups-probe.ts [账号名] */
import { matchupsText } from "./matchups.js";

const who = process.argv[2];
matchupsText(who ? { who } : {})
  .then((t) => console.log(t))
  .catch((e) => {
    console.error("失败：", e?.message ?? e);
    process.exit(1);
  });
