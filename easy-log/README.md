# easy-log MCP

工作日志与发票填报工具。查项目、填暂存日志/发票、管理发票附件、跑统计、月底盘点未提交记录。

> 数据源：工作管理系统远程 MCP 服务（`https://ai-log.hycx-gd.cn/Log/api/mcp`），需在网站「我的信息 → MCP 密钥」创建 API Key。

## 组成

| 文件 | 说明 |
|------|------|
| `SKILL.md` | 使用指南：MCP 工具清单、CLI 用法、统计/盘点流程 |
| `scenarios/` | 场景手册：快速开始 / 自动工作日志 / 自动发票批量 / 月度提醒 |
| `scripts/invoice_api.py` | 发票处理 Python CLI（上传/解析/补附件），无需第三方依赖 |

## 配置

1. 登录工作系统网站，创建 MCP 密钥，得到 `$APIKEY`
2. **MCP 服务**（Claude Code `~/.claude.json` 的 `mcpServers`）：

```json
"easy-log-mcp": {
  "url": "https://ai-log.hycx-gd.cn/Log/api/mcp",
  "transport": "streamable-http",
  "headers": { "Authorization": "Bearer $APIKEY" },
  "connectionTimeoutMs": 10000,
  "requestTimeoutMs": 30000
}
```

3. **CLI**：复制 `scripts/.env.example` 为 `scripts/.env`，填 `WORK_MANAGEMENT_API_KEY`

## 注意

- 不要把含真实密钥的 `.env` 提交或打包；仓库仅含 `.env.example` 模板
- 发票最终提交需在网站完成（CLI 只负责暂存/解析/附件）
