/**
 * 冒烟测试：直接调模块（**不经 MCP**），验证 IMAGE_PROVIDER=doubao 这条后端通。
 *
 * 为什么要有它：image-vision 在多数会话里不会被加载成工具，所以「改完代码」没法靠
 * 调工具来验；而自测脚本又容易漏掉真实工具路径。这个文件的价值是**至少把模块层走通**，
 * 剩下的「MCP 工具层」需要重启会话才能验（stdio MCP 改代码不用重启，但新增工具要）。
 *
 * 用法:  IMAGE_PROVIDER=doubao  npx tsx test-doubao-smoke.ts [提示词] [输出路径]
 * 前提:  豆包桌面版带调试端口在跑、那个实例已登录（见 start-doubao-debug.cmd）
 */
import { generateImage } from "./vision.js";

async function main() {
  process.env.IMAGE_PROVIDER = process.env.IMAGE_PROVIDER || "doubao";
  const prompt = process.argv[2] || "画一个红色的圆，纯白背景，极简";
  const outputPath = process.argv[3] || "D:/tmp/mptpl/smoke_doubao.png";

  console.log("[i] provider =", process.env.IMAGE_PROVIDER);
  console.log("[i] prompt   =", prompt);
  const t0 = Date.now();

  const r = await generateImage(prompt, { outputPath });

  console.log("[✓] 用时 %ds", Math.round((Date.now() - t0) / 1000));
  console.log("    文件:", r.path);
  console.log("    回报模型:", r.model === null ? "(豆包不回报模型名 —— 未冒充)" : r.model);
  console.log("    请求模型:", r.requestedModel);
  console.log("    元数据:", r.metaPath);
}

main().catch((e) => {
  console.error("[x]", e?.message || e);
  process.exit(1);
});
