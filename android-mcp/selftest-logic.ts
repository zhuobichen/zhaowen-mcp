/**
 * 纯逻辑自测（不需要设备）：uiautomator XML 解析、坐标换算、文字查找、输出格式。
 * 由 selftest.mjs 通过 tsx 拉起——直接 node 跑不了 .ts。
 */
import { parseUiXml, formatNodes, findByText, centerOf } from "./lib/uiautomator.js";
import { checkGuardrails, checkForeground } from "./lib/guardrails.js";
import { isAsciiText } from "./lib/input.js";

let failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) console.log("  ✓", name);
  else {
    console.error("  ✗", name, detail);
    failed++;
  }
};

const SAMPLE = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" bounds="[0,0][1080,1920]" clickable="false">
    <node index="1" text="登录" resource-id="com.demo:id/login_title" class="android.widget.TextView" bounds="[40,200][1040,280]" clickable="false" />
    <node index="2" text="" resource-id="com.demo:id/login_btn" class="android.widget.Button" content-desc="登录按钮" bounds="[40,300][1040,400]" clickable="true" enabled="true" />
    <node index="3" text="记住我" resource-id="com.demo:id/remember" class="android.widget.CheckBox" bounds="[40,450][300,510]" clickable="true" checked="true" />
    <node index="4" text="" resource-id="" class="android.view.View" bounds="[0,520][1080,1920]" clickable="false" />
    <node index="5" text="A &amp; B &lt;ok&gt;" class="android.widget.TextView" bounds="[40,600][500,660]" clickable="false" />
    <node index="6" text="换行&#10;表情&#128552;" class="android.widget.TextView" bounds="[40,700][500,760]" clickable="false" />
  </node>
</hierarchy>`;

console.log("uiautomator 解析");
const nodes = parseUiXml(SAMPLE);
check("剔除无信息节点后剩 5 个", nodes.length === 5, `实际 ${nodes.length}`);
check("保留可点击节点", nodes.some((n) => n.clickable && n.id.includes("login_btn")));
check("保留勾选状态", nodes.some((n) => n.checked && n.text === "记住我"));
check("实体解码 & < >", nodes.some((n) => n.text === "A & B <ok>"));
check("class 简写", nodes.some((n) => n.cls === "Button"));

console.log("坐标换算");
check("centerOf 取中点", JSON.stringify(centerOf("[40,300][1040,400]")) === JSON.stringify({ x: 540, y: 350 }));
check("centerOf 非法输入不炸", JSON.stringify(centerOf("bad")) === JSON.stringify({ x: 0, y: 0 }));
const btn = nodes.find((n) => n.id.includes("login_btn"));
check("按钮中心点", !!btn && btn.x === 540 && btn.y === 350);

console.log("按文字查找");
check("完全匹配", findByText(nodes, "登录", true).length === 1);
check("包含匹配命中 desc", findByText(nodes, "登录").length >= 1);
check("查不到返回空", findByText(nodes, "不存在的按钮").length === 0);
check("匹配 content-desc", findByText(nodes, "登录按钮", true).length === 1);
check("忽略大小写与空格", findByText(nodes, " 记住我 ", true).length === 1);

console.log("输出格式");
const out = formatNodes(nodes);
check("行数与节点数一致", out.split("\n").length === nodes.length);
check("含 clickable 标记", out.includes("[clickable"));
check("含坐标", out.includes("@540,350"));

console.log("数字字符实体（表情/换行）");
// 只解五个命名实体的版本会把 &#128552; 原样留在输出里 —— 实测踩过，dump 里看到过「这大骨这么大&#128552;」
check("十进制实体解成真字符", nodes.some((n) => n.text === `换行\n表情${String.fromCodePoint(0x1f628)}`));
check("十六进制实体也解", parseUiXml(`<node text="&#x4F60;&#x597D;" class="android.widget.TextView" bounds="[0,0][10,10]"/>`)[0].text === "你好");
check(
  "非法码点不炸、并按空节点被过滤",
  parseUiXml(`<node text="&#xDFFFFFFFFF;" class="android.widget.TextView" bounds="[0,0][10,10]"/>`).length === 0
);
// 输出是"一行一个节点"，所以真实换行必须在展示层转义掉，否则一条节点会撑成好几行
check("单行输出里没有裸换行", out.split("\n").length === nodes.length);
check("换行被显示成 \\n", out.includes("\\n"));

console.log("禁区（guardrails）");
check("QQ 里点「空间」被拦", !!checkGuardrails({ action: "tap", packageName: "com.tencent.mobileqq", nodeText: "空间" }));
check("QQ 里点「我的空间」被拦", !!checkGuardrails({ action: "tap", packageName: "com.tencent.mobileqq", nodeText: "我的空间" }));
// 精确匹配的意义：别把「存储空间」这种正常入口一起误伤
check("「存储空间」不误伤", !checkGuardrails({ action: "tap", packageName: "com.tencent.mobileqq", nodeText: "存储空间" }));
check("别的 app 里点「空间」不拦", !checkGuardrails({ action: "tap", packageName: "com.android.settings", nodeText: "空间" }));
check("前台认不出来时按保守处理（仍拦）", !!checkGuardrails({ action: "tap", nodeText: "空间" }));
check("命令里出现 QZone 地址被拦", !!checkGuardrails({ action: "shell", command: "am start -a android.intent.action.VIEW -d https://h5.qzone.qq.com/x" }));
check("正常 shell 命令不拦", !checkGuardrails({ action: "shell", command: "getprop sys.boot_completed" }));
check("正常启动别的 app 不拦", !checkGuardrails({ action: "launch_app", targetPackage: "com.android.settings" }));
check("前台判断：qzone 页面拦住查看", !!checkForeground("com.tencent.mobileqq", "com.tencent.mobileqq/.qzone.activity.QZoneFeedsActivity"));
check("前台判断：普通页面放行", !checkForeground("com.android.settings", "com.android.settings/.Settings"));

console.log("输入分流");
check("纯 ASCII 走设备原生通道", isAsciiText("hello world") && isAsciiText("a1!@#"));
check("含中文不走原生通道", !isAsciiText("你好"));
check("空串不算 ASCII", !isAsciiText(""));
check("含控制字符不算 ASCII", !isAsciiText("a\nb"));

console.log("");
if (failed) {
  console.error(`✗ ${failed} 项失败`);
  process.exit(1);
}
console.log("✓ 纯逻辑全部通过");
