# feishu-mcp — 飞书官方 MCP（npx 直连）

> [larksuite/lark-openapi-mcp](https://github.com/larksuite/lark-openapi-mcp)，npm 包 `@larksuiteoapi/lark-mcp`（**Beta**）。本目录**不含自研代码**，是官方包的接入档案：怎么建应用、开什么权限、怎么选工具预设、客户端怎么配。

## 接通四步

1. **建应用**：[飞书开放平台](https://open.feishu.cn/) → 创建**企业自建应用** → 记下 App ID / App Secret
2. **开权限并发布**（按需勾选，改完要点"发布版本"才生效）：
   - IM 收发：`im:message`（读写）、`im:chat`
   - 文档：`docx:document:readonly`、`docx:document`（导入）、`wiki:wiki:readonly`、`drive:drive`
   - 多维表格：`bitable:app` ｜ 日历：`calendar:calendar` ｜ 任务：`task:task`
3. **配客户端**（~/.claude.json 的 mcpServers，凭证只存本地不入仓库）：

```json
"feishu": {
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@larksuiteoapi/lark-mcp", "mcp", "-a", "<APP_ID>", "-s", "<APP_SECRET>", "-t", "preset.default"]
}
```

4. **用户身份（可选）**：要访问"我"的私聊/个人文档时，先
   `npx -y @larksuiteoapi/lark-mcp login -a <ID> -s <SECRET>`（OAuth 回调 `http://localhost:3000/callback`，需在后台配置重定向 URL），
   启动参数再加 `--oauth --token-mode user_access_token`（不加会用应用身份，读不到私有数据）。

## 工具预设（`-t`，逗号可组合）

| preset | 工具数 | 覆盖 |
|---|---|---|
| `preset.light` | 10 | 最小集：消息收发、表格记录、文档读取、联系人 |
| `preset.default` | 20 | 默认全集：IM + 多维表格 + 文档 + 权限 + wiki + 联系人 |
| `preset.im.default` | 5 | 群与消息 |
| `preset.base.default` / `preset.base.batch` | 8 / 7 | 多维表格（batch 含批量写） |
| `preset.doc.default` | 6 | 文档 / wiki |
| `preset.task.default` | 4 | 任务创建/更新/加人/提醒 |
| `preset.calendar.default` | 5 | 日程创建/改/查、忙闲查询 |

## 官方已知限制

- 暂不支持文件上传/下载
- 暂不支持直接编辑云文档正文（仅导入与读取）
- 非预设 API 未经官方兼容性测试，AI 调用效果可能不稳

---
2026-10-25 建档。包处 Beta 期，升级前看官方 changelog。
