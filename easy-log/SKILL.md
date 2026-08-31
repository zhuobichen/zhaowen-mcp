---
name: easy-log
description: 工作日志和发票填报。查项目、填暂存日志/发票、管发票附件、跑统计。发票文件用内置 Python CLI 处理，最终提交在网站完成。
agent_created: true
---
# 能干什么

- 填工作日志（暂存）
- 上传发票、解析发票、创建暂存发票、补附件
- 改暂存记录
- 按日期/项目/状态查日志和发票
- 统计工时、发票金额、状态分布
- 月底盘点：看看还有哪些暂存的没提交

## 前置准备：获取 API Key

1. 登录工作管理系统网站：[https://ai-log.hycx-gd.cn/Log](https://ai-log.hycx-gd.cn/Log)。
2. 点击左下角头像 → **我的信息** → **MCP 密钥**。
3. 点击 **创建密钥**，复制生成的 Key。
4. 把 Key 配到两个地方（**只需填 API Key**，服务地址已固定，无需其他改动）：

   - **MCP 服务**：在 `mcpServers` 中加入以下配置，把 `$APIKEY` 替换为你的密钥：

     ```json
     "easy-log-mcp": {
       "url": "https://ai-log.hycx-gd.cn/Log/api/mcp",
       "transport": "streamable-http",
       "headers": {
         "Authorization": "Bearer $APIKEY"
       },
       "connectionTimeoutMs": 10000,
       "requestTimeoutMs": 30000,
       "disabled": false
     }
     ```

     保存后，在连接器管理处点击「信任」启用该服务。
   - **CLI**：写到 `scripts/.env`（参考 `scripts/.env.example`），仅需 API Key：

     ```
     WORK_MANAGEMENT_API_KEY=<你的密钥>
     WORK_MANAGEMENT_TIMEOUT=60
     ```

     使用时先加载环境变量再运行脚本（详见文末加载示例）。

## MCP 工具

### 用户与项目

- 当前用户：`read_me_slim_users_me_slim_get`
- 项目列表：`list_projects_project_list_get`
- 项目详情：`get_project_project_get__project_id__get`

### 工作日志

- 创建：`create_work_log_work_log_create_post`
- 修改：`update_work_log_work_log_update__work_log_id__post`
- 列表：`list_work_logs_work_log_list_get`
- 状态列表：`get_work_log_statuses_work_log_status_list_get`
- 状态统计：`get_work_log_status_count_work_log_status_count_get`
- 总工时：`get_total_hours_work_log_total_hours_get`
- 用户工时分布：`get_user_hours_work_log_user_hours_get`

### 发票

- 创建：`create_invoice_invoice_create_post`
- 修改：`update_invoice_invoice_update__invoice_id__post`
- 按 ID 查：`get_invoice_invoice_get__invoice_id__get`
- 列表：`list_invoices_invoice_list_get`
- 附件列表：`list_invoice_attachments_invoice_attachments__invoice_id__get`
- 状态列表：`get_invoice_statuses_invoice_status_list_get`
- 状态统计（含金额）：`get_invoice_status_count_invoice_stat_get`
- 总金额：`get_total_amount_invoice_total_amount_get`
- 用户金额分布：`get_user_amount_invoice_user_amount_get`

## Python 发票 CLI

脚本：`scripts/invoice_api.py`

从环境变量读配置：

- `WORK_MANAGEMENT_API_KEY`
- `WORK_MANAGEMENT_TIMEOUT`（可选，默认 60s）

服务地址已固定在脚本内：`https://ai-log.hycx-gd.cn/Log/api`（无需配置）。

三个命令：

```bash
python invoice_api.py upload <发票文件>      # 上传，返回文件 ID
python invoice_api.py parse <发票文件>       # 解析，返回发票字段
python invoice_api.py add-attachment <发票ID> <附件文件>  # 给发票补附件
```

输出都是 JSON。脚本不自动读 `.env`，用前先在 shell 里加载环境变量。

**Windows PowerShell：**

```powershell
$envFile = "实际路径\scripts\.env"
Get-Content $envFile | Where-Object { $_ -and -not $_.StartsWith('#') } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), 'Process')
}
```

**bash：**

```bash
set -a; . ./scripts/.env; set +a
```

## 项目怎么匹配

用户说的通常是项目名称（"无人机噪声监测""空气质量预报"这种），不是 ID。按以下流程把名称变成 `project_id`：

1. 先查 `project_aliases.json`（如果有的话），命中就直接用。
2. 没命中 → 调 `list_projects_project_list_get` 拉项目列表，在客户端做名称模糊匹配：
   - 命中 1 个 → 确认一下："XX 项目（id=N），填这里对吧？"确认后写入别名缓存。
   - 命中 0 个 → 列出前 10 个项目，让用户选。
   - 命中 ≥2 个 → 列出候选项，让用户选。
3. 同一轮对话里确认过的项目，后面不再问。

别名缓存放在 workspace 的 `.workbuddy/memory/project_aliases.json`，格式：

```json
{
  "无人机噪声监测": {
    "project_id": 1,
    "official_name": "无人机噪声监测与评估重点研发项目",
    "confirmed_at": "2026-08-11T17:25:00Z"
  }
}
```

key 用口语化称呼，多存几种写法也没问题。项目失效或用户说换项目时删掉对应条目。

## 填日志

1. `read_me_slim_users_me_slim_get` 拿 `user_id`。
2. 按上节流程匹配项目，拿到 `project_id`。
3. `create_work_log_work_log_create_post`，`status=0`（暂存）。
4. 改暂存日志用 `update_work_log_work_log_update__work_log_id__post`，保持 `status=0`。

> ⚠️ **update 是全量替换**，不传的字段会被清空。改之前先用 list 或 get 读出当前值，把要保留的字段也一起传回去。

5. 查日志用 `list_work_logs_work_log_list_get`，按用户、项目、日期、状态过滤。
6. 统计用状态统计、总工时、用户工时分布三个工具。

## 填发票

1. `read_me_slim_users_me_slim_get` 拿 `user_id`。
2. 项目匹配同上。
3. CLI `upload <文件>` → 拿到文件 ID。
4. CLI `parse <文件>` → 拿到发票代码、号码、金额、日期等。
5. `create_invoice_invoice_create_post`，`status=0`，关联文件 ID。
6. 要补行程单/收据：CLI `add-attachment <发票ID> <文件>`。
7. 查发票详情：`get_invoice_invoice_get__invoice_id__get`。
8. 查附件：`list_invoice_attachments_invoice_attachments__invoice_id__get`。
9. 改暂存发票用 `update_invoice_invoice_update__invoice_id__post`，保持 `status=0`。

> ⚠️ **update 是全量替换**，不传的字段（包括 `attachment_id`）会被清空。改之前先 `get_invoice` 读出当前值，把所有要保留的字段原样传回去。

10. 统计用状态统计（含金额）、总金额、用户金额分布。

## 状态码

| 状态 | 日志     | 发票     |
| ---- | -------- | -------- |
| 0    | 暂存     | 暂存     |
| 1    | 已提交   | 已提交   |
| 2    | 财务通过 | 财务通过 |
| 3    | 审核通过 | 审核通过 |
| 4    | 退回     | 退回     |

`status=0` 的记录不计入审核统计。月底记得去网站提交。

## 自动化场景

三个自动化场景 + 一个速查，详细步骤在 `scenarios/` 目录：

- [速查：一次性操作](./scenarios/00-quick-start.md) — 临时填日志、传发票、补附件、改记录、查状态
- [场景 1：每日自动日志](./scenarios/01-auto-work-log.md) — 监控文件夹修改，自动生成日志
- [场景 2：发票自动入库](./scenarios/02-auto-invoice-batch.md) — 出差/月度/临时批量处理发票
- [场景 3：月底盘点提醒](./scenarios/03-monthly-reminder.md) — 每月提醒提交暂存记录

启用时告诉我"启用场景 X，项目=xxx，文件夹=xxx，工时=N"。

## 边界

- 所有创建和修改默认 `status=0`，不替你在网站提交。
- 发票文件操作统一走 CLI，不直接调文件 API。
- API Key 只从环境变量读，不写进任何文件或回复。
- 项目不明确时问清楚，别猜。
- 批量处理时单条失败跳过，记到"待人工处理"清单，不中断流程。
- 出差/月度 automation 的项目归属已预设好，不逐张问；其他场景保留确认环节。
