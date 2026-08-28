# onehub-monitor MCP

监测 one-hub / OpenAI 兼容中转的 API 用量：实时总额度 / 已用 / 剩余（美元 + 人民币），并按日快照记账，输出每日、每月花费。

> 依赖 one-hub 提供的 OpenAI 兼容 billing 接口（`/v1/dashboard/billing/subscription`、`/v1/dashboard/billing/usage`、`/api/status`）。`total_usage` 单位按美分换算为美元，汇率从 `/api/status` 的 `PaymentUSDRate` 动态读取。

## 工具

| 工具 | 功能 |
|------|------|
| `check_usage` | 实时查询总额度 / 已使用 / 剩余（美元 + 人民币）、使用率 |
| `daily_snapshot` | 记录今日用量快照到本地账本，返回每日（近 30 天）与每月花费 |
| `usage_history` | 读取本地账本，返回历史每日花费 |

## 配置（环境变量）

| 变量 | 说明 |
|------|------|
| `ONEMONITOR_API_KEY` | API Key（必填，fallback `ONEHUB_API_KEY`） |
| `ONEMONITOR_URL` | one-hub 根地址，默认 `https://one-hub.hycx-gd.cn` |
| `ONEMONITOR_HISTORY` | 本地账本 JSON 路径，默认与 `cost_stats.py` 共享 `cost_stats_history.json` |

> ⚠️ one-hub 的 billing 接口忽略日期参数、只能返回累计总量；按天 / 按月花费依赖本地每日快照（`daily_snapshot`），历史无法回溯，需从配置那天起每天记录。

## 快速开始

```sh
cd onehub-monitor && npm install

# 注册到 Claude Code（~/.claude.json 的 mcpServers）
# env: { "ONEMONITOR_API_KEY": "sk-xxx", "ONEMONITOR_URL": "https://one-hub.hycx-gd.cn" }
```

重启 Claude Code 后即可调用 `check_usage` / `daily_snapshot` / `usage_history`。

## 每日定时

`daily_snapshot` 需每天执行一次以累积每日差值。可在 Claude Code 会话内用定时任务（如每天 21:07 触发）调用该工具，或自行挂系统计划任务。
