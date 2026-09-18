/** 手动跑周趋势：npx tsx lib/trend-probe.ts [账号名] [mayhem|tft] */
import { trendText } from "./trend.js";

const who = process.argv[2] || undefined;
const kind = (process.argv[3] as "mayhem" | "tft" | undefined) ?? undefined;
trendText({ who, kind })
  .then((t) => console.log(t))
  .catch((e) => {
    console.error("失败：", e?.message ?? e);
    process.exit(1);
  });
