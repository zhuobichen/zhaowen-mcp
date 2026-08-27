# Agent 接入适配

> 各 agent 通过 **MCP 协议** 接入,共享同一份 `mcp/server.js` 和同一份凭证目录 `~/.file-manager/`。
> 详细 MCP 配置见 [../README.md](../README.md#mcp-接入适配各-agent)。

## 已支持

| Agent | 厂商 | 接入方式 |
|-------|------|---------|
| Claude Code | Anthropic | MCP + CLI + Slash |
| WorkBuddy | 腾讯云 | MCP + 沙箱 |
| QoderWork | 阿里云 | MCP + IDE |
| KIMIWork | 月之暗面 | MCP |

## 凭证共享

所有 agent 共用 `~/.file-manager/`,在一处 `bind`,其他 agent 都能 `exec` / `upload` / `share`。

## MCP 暴露的能力

`mcp/server.js` 提供:

- **25 个 tools**:`exec` / `upload` / `download` / `share_add` / `audit_list` 等
- **2 个 resources**:`file-manager://servers`、`file-manager://audit`

详见 [../mcp/server.js](../mcp/server.js)。