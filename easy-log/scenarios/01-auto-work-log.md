# 场景 1：每日工作日志自动填报

监控项目文件夹，每天下班自动根据文件改动生成日志。一次性配好项目+文件夹+工时，之后不再问。

## 一次性配置

1. `read_me_slim_users_me_slim_get` 拿 `user_id`。
2. `list_projects_project_list_get` 让用户挑目标项目。
3. 用户指定文件夹绝对路径（如 `d:\项目A\`）和默认工时（如 4 小时）。
4. 配置写入 workspace 的 `.workbuddy/memory/auto_log_config.json`：

```json
{
  "user_id": 70,
  "project_id": 1,
  "folder_path": "d:\\项目A",
  "default_hours": 10
}
```

## 每日自动流程

1. 读配置里的 `folder_path`，找过去 24 小时内修改过的文件。
2. 根据文件数量和类型生成摘要：
   - 0 个文件 → 跳过，不建日志。
   - 1-4 个 → 摘要写文件列表。
   - ≥5 个 → 摘要写"今日完成 N 项更新，涉及 xxx 类型文件"。
3. `create_work_log_work_log_create_post`：`user_id`、`project_id`、`work_on=今天`、`duration=默认工时`、`task=摘要`、`status=0`。
4. 成功输出"日志 id=N，N 个文件改动，项目 xxx"。失败记错误不中断。
5. 全程不问用户。

## automation 配置

- `scheduleType=recurring`，`rrule=FREQ=DAILY;BYHOUR=18;BYMINUTE=0`
- `prompt`：读 auto_log_config.json → 扫文件夹 24h 修改 → 生成摘要 → 创建暂存日志。不要向用户提问。
- `cwds`：包含项目文件夹所在 workspace。

## 异常处理

- 文件夹不存在或无权限：记告警，跳过当日。
- 项目失效（`get_project` 404 或 `is_used=false`）：跳过，记"项目 xx 不可用，请更新配置"。
- 单日改动超过 50 个文件：只取前 20 个写摘要。

## 切换 / 关闭

说"取消自动日志"或"切换到项目 B"就更新/删除配置。
