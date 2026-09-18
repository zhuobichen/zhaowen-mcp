/** 手动跑 Markdown 小结：npx tsx lib/report-md-probe.ts [账号名] */
import { reportMarkdownText } from "./report-md.js";

const who = process.argv[2] || undefined;
reportMarkdownText(who ? { who } : {})
  .then((t) => console.log(t))
  .catch((e) => {
    console.error("失败：", e?.message ?? e);
    process.exit(1);
  });
