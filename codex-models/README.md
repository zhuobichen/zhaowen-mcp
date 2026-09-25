# codex-models — 管理 Codex 模型配置的 MCP

增删改 Codex 的模型配置，不用再手改几十个字段的 `models.json`。

## 工具

| 工具 | 说明 |
|---|---|
| `list_models` | 列出已配置的模型 + 当前选中（从 `config.toml` 读） |
| `list_available` | 拉 one-hub 可用模型，标出**尚未配置**的（可直接 add） |
| `add_model` | 新增模型：自动按 slug 匹配最相似的现有模型作模板，深拷贝字段后覆盖 slug/显示名/上下文等；写入前**自动备份** |
| `remove_model` | 删除模型（会拒绝删除当前正在使用的那个） |
| `set_model` | 切换当前模型（改 `config.toml` 的顶层 `model`），写入前备份 |

## 用法

```
list_models                                  # 看现有 19 个模型 + 当前用哪个
list_available                               # 看 one-hub 上还有哪些没配（当前 49 个）
add_model slug="claude-opus-5"               # 自动匹配模板（claude-opus-4-8）并新增
add_model slug="gpt-5.7-sol" template="gpt-5.6-sol" context_window=2000000
add_model slug="xxx" dry_run=true            # 只预览要写入的条目
set_model slug="claude-opus-5"               # 切换当前模型（重启 Codex 生效）
remove_model slug="claude-opus-5"
```

## 自动模板匹配规则

按 slug 关键词匹配现有模型作为字段模板（避免手填 ~40 个字段）：

| slug 特征 | 模板 |
|---|---|
| `gpt-5.6-sol` / `gpt-5.x` | `gpt-5.6-sol` |
| `claude-*-opus` | `claude-opus-4-8` |
| `claude-*` | `claude-sonnet-5` |
| `gemini-*` | `gemini-3.8-flash` |
| `deepseek-*pro` | `deepseek-v4-pro` |
| `deepseek-*` | `deepseek-v4-flash` |
| `grok-*` | `grok-4.6` |
| `minimax-*` | `MiniMax-M3` |
| 其它 | `gpt-5.6-sol`（兜底） |

也可用 `template=` 显式指定。

## 涉及的文件

| 文件 | 作用 |
|---|---|
| `~/.codex/models.json` | 模型目录（`model_catalog_json`） |
| `~/.codex/config.toml` | 当前模型选择（顶层 `model` / `model_provider`） |
| `models.json.bak.<时间戳>` | 每次写入前的自动备份（最多保留 10 份） |

## 配置（环境变量，均有默认值）

| 变量 | 默认 |
|---|---|
| `CODEX_DIR` | `~/.codex` |
| `ONEHUB_API_KEY` | 从 `~/.claude.json` 的 code-review env 读 |
| `ONEHUB_API_URL` | 同上（默认 one-hub 地址） |

## 注册（~/.claude.json）

```json
"codex-models": {
  "type": "stdio",
  "command": "cmd",
  "args": ["/c", "node", "D:/github_project/ZhaoWen_GitHub维护/zhaowen-mcp/codex-models/node_modules/tsx/dist/cli.mjs", "D:/github_project/ZhaoWen_GitHub维护/zhaowen-mcp/codex-models/index.ts"],
  "cwd": "E:\\CodeProject"
}
```

依赖 tsx 与 @modelcontextprotocol/sdk，在**本目录** `npm install` 一次即可（各服务各自一份 `node_modules`，不共用）。
