/** 手动跑补丁维度：npx tsx lib/patches-probe.ts [账号名] [mayhem|tft] */
import { patchesText } from "./patches.js";

const who = process.argv[2] || undefined;
const kind = (process.argv[3] as "mayhem" | "tft" | undefined) ?? undefined;
patchesText({ who, kind })
  .then((t) => console.log(t))
  .catch((e) => {
    console.error("失败：", e?.message ?? e);
    process.exit(1);
  });
