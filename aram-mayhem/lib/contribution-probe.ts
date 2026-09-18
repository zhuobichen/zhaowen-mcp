/** 手动跑贡献度分析：npx tsx lib/contribution-probe.ts [账号名] */
import { contributionText } from "./contribution.js";

const who = process.argv[2] || undefined;
contributionText(who ? { name: who } : {})
  .then((t) => console.log(t))
  .catch((e) => {
    console.error("失败：", e?.message ?? e);
    process.exit(1);
  });
