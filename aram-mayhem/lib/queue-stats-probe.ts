/** 手动跑队列拆分：npx tsx lib/queue-stats-probe.ts [账号名] [lol|tft] */
import { queueStatsText } from "./queue-stats.js";

const who = process.argv[2] || undefined;
const kind = (process.argv[3] as "lol" | "tft" | undefined) ?? undefined;
queueStatsText({ who, kind })
  .then((t) => console.log(t))
  .catch((e) => {
    console.error("失败：", e?.message ?? e);
    process.exit(1);
  });
