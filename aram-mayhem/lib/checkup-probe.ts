/** 手动跑一键体检：npx tsx lib/checkup-probe.ts [账号名] */
import { checkupText } from "./checkup.js";

const who = process.argv[2] || undefined;
checkupText(who ? { who } : {})
  .then((t) => console.log(t))
  .catch((e) => {
    console.error("失败：", e?.message ?? e);
    process.exit(1);
  });
