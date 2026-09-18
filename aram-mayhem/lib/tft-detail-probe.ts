/** 手动跑云顶棋子/装备分析：npx tsx lib/tft-detail-probe.ts [账号名] */
import { tftDetailText } from "./tft-detail.js";

const who = process.argv[2];
tftDetailText(who ? { who } : {})
  .then((t) => console.log(t))
  .catch((e) => {
    console.error("失败：", e?.message ?? e);
    process.exit(1);
  });
