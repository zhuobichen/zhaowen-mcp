/**
 * 纯逻辑自测（不需要设备）：uiautomator XML 解析、坐标换算、文字查找、输出格式。
 * 由 selftest.mjs 通过 tsx 拉起——直接 node 跑不了 .ts。
 */
import { parseUiXml, formatNodes, findByText, centerOf } from "./lib/uiautomator.js";

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
  </node>
</hierarchy>`;

console.log("uiautomator 解析");
const nodes = parseUiXml(SAMPLE);
check("剔除无信息节点后剩 4 个", nodes.length === 4, `实际 ${nodes.length}`);
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

console.log("");
if (failed) {
  console.error(`✗ ${failed} 项失败`);
  process.exit(1);
}
console.log("✓ 纯逻辑全部通过");
