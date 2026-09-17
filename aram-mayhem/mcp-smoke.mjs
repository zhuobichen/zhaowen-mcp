// 临时脚本：用真实 MCP stdio 协议连一次服务，验证 initialize / tools/list / tools/call
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "index.ts"],
  cwd: new URL(".", import.meta.url).pathname.replace(/^\//, ""),
});
const client = new Client({ name: "smoke", version: "0" }, { capabilities: {} });
await client.connect(transport);
console.log("已连接:", client.getServerVersion());

const tools = await client.listTools();
console.log(`工具数: ${tools.tools.length}`);
console.log(tools.tools.map((t) => t.name).join(", "));

const cases = [
  { name: "get_data_info", args: {} },
  { name: "search_augments", args: { query: "雪球", limit: 3 } },
  { name: "get_augment", args: { name: "史上最大雪球" } },
  { name: "analyze_synergy", args: { augments: ["升级：雪球", "神圣雪球"] } },
  { name: "get_champion_guide", args: { champion: "提莫", limit: 2 } },
  { name: "list_synergy_sets", args: { query: "雪" } },
  { name: "compare_patches", args: {} },
  { name: "list_champions", args: { tier: "S+", limit: 3 } },
  { name: "get_my_account_status", args: {} },
  { name: "get_my_recent_games", args: { limit: 5 } },
  { name: "analyze_my_augments", args: { limit: 5 } },
  { name: "list_my_friends", args: {} },
  { name: "get_friend_stats", args: { friend: "丁ding" } },
];
for (const c of cases) {
  const r = await client.callTool({ name: c.name, arguments: c.args });
  const t = r.content?.[0]?.text ?? JSON.stringify(r);
  console.log(`\n----- ${c.name} -----\n${t.split("\n").slice(0, 14).join("\n")}`);
  if (r.isError) console.log("!! 该调用报错");
}
await client.close();
console.log("\nOK");
