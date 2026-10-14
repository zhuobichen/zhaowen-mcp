/**
 * 冒烟测试：直接调模块（**不经 MCP**），验证豆包这条后端的**图生图**通。
 *
 * 为什么单开一个：`test-doubao-smoke.ts` 只盖「从零生图」。图生图多了一步"把底图送进对话"，
 * 而那一步的坑（附件怎么塞、怎么算就绪、回车为什么发不出去）全在 doubao.ts 的注释里，
 * 单靠读代码是验不到的 —— 必须真跑一次。
 *
 * 用法:  IMAGE_PROVIDER=doubao  npx tsx test-doubao-edit-smoke.ts [底图路径] [提示词] [输出路径]
 * 前提:  豆包桌面版带调试端口在跑、那个实例已登录（见 start-doubao-debug.cmd）
 */
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { editImage } from "./vision.js";

const md5 = (p: string) => createHash("md5").update(readFileSync(p)).digest("hex");

async function main() {
  process.env.IMAGE_PROVIDER = process.env.IMAGE_PROVIDER || "doubao";
  const img = process.argv[2] || "D:/tmp/mptpl/cover_900.jpg";
  const prompt = process.argv[3] || "把这张图的背景换成纯白色，把标题文字改成深红色，其他内容保持不变";
  const outputPath = process.argv[4] || "D:/tmp/mptpl/smoke_doubao_edit.png";

  console.log("[i] provider =", process.env.IMAGE_PROVIDER);
  console.log("[i] 底图     =", img);
  console.log("[i] prompt   =", prompt);
  const t0 = Date.now();

  const r = await editImage(prompt, { images: [img], outputPath });

  console.log("[✓] 用时 %ds", Math.round((Date.now() - t0) / 1000));
  console.log("    文件:", r.path);
  console.log("    回报模型:", r.model === null ? "(豆包不回报模型名 —— 未冒充)" : r.model);
  console.log("    请求模型:", r.requestedModel);
  console.log("    元数据:", r.metaPath);

  // ⚠️ 这条断言不是走过场，它拦的是一次真实事故：
  //   最早的成图判据只看"页面上自然尺寸 ≥ MIN_PX 的图"，送进去 2048×2048 的底图时
  //   会被它自己发的那张撞穿 —— 13 秒"成功"、产物与输入 **MD5 一字不差**，
  //   而整个过程不报任何错。所以这里**逐字节比对**：产物绝不可能等于输入。
  //   （尺寸、文件大小、肉眼都靠不住，只有哈希是确定的。）
  const hIn = md5(img);
  const hOut = md5(r.path);
  if (hIn === hOut) {
    console.error(`[x] 产物与输入图 MD5 相同（${hOut}）—— 抓到的根本不是生成结果，是送进去的底图！`);
    process.exit(2);
  }
  console.log(`    哈希校验: 输入 ${hIn.slice(0, 12)} ≠ 产物 ${hOut.slice(0, 12)} ✓`);
}

main().catch((e) => {
  console.error("[x]", e?.message || e);
  process.exit(1);
});
