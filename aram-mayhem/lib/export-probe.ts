/** 手动跑 CSV 导出：npx tsx lib/export-probe.ts [账号名] [kind] */
import { exportText } from "./export.js";

const who = process.argv[2];
const kind = process.argv[3] as "mayhem" | "lol" | "tft" | undefined;
exportText({ who, kind })
  .then((t) => console.log(t))
  .catch((e) => {
    console.error("失败：", e?.message ?? e);
    process.exit(1);
  });
