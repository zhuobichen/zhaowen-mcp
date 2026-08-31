# 一次性操作速查

对话里临时填条日志、传张发票，不用任何配置。直接说就行。

项目匹配策略：用户说项目名称就行（"无人机噪声监测""空气质量预报"），不用查 ID。WorkBuddy 调 `list_projects_project_list_get` 在客户端做模糊匹配，0 个或 ≥2 个命中时再问。

别名缓存：每次成功解析项目后写入 workspace 的 `.workbuddy/memory/project_aliases.json`。后续同项目直接命中缓存，同轮对话复用不重复确认。切换项目或项目失效时删对应条目。

## 1. 填一条日志

**你说：**"填条日志：无人机噪声监测项目，今天，任务'项目例会'，2 小时"

**步骤：**
1. `read_me_slim_users_me_slim_get` 拿 `user_id`。
2. 查别名缓存 → 有就用，没有就模糊匹配 → 首次确认后回写缓存。
3. `create_work_log_work_log_create_post`，`status=0`。
4. 返回日志 ID + 摘要，你去网站提交。

## 2. 传一张发票

**你说：**"这张发票挂空气质量预报项目：`d:\发票\滴滴-0810.pdf`"

**步骤：**
1. 拿 `user_id`，匹配项目（同上）。
2. CLI `upload` → 拿文件 ID。
3. CLI `parse` → 拿发票字段。金额异常或缺关键字段时先跟你核对。
4. `create_invoice_invoice_create_post`，`status=0`，关联文件 ID。
5. 要补行程单/收据：CLI `add-attachment <发票ID> <文件>`。
6. 返回发票 ID + 摘要。

## 3. 补附件

**你说：**"把 `d:\发票\行程单.pdf` 挂到发票 156"

**步骤：**CLI `add-attachment 156 <文件>`，完事。

## 4. 改暂存记录

**你说：**"发票 156 金额改成 58，备注加'含税'"

> ⚠️ update 是全量替换，不传的字段会丢。改之前先 `get_invoice` 读出当前值，把所有要保留的字段一起传回去。

**步骤：**
1. `get_invoice_invoice_get__invoice_id__get` 读出当前值。
2. `update_invoice_invoice_update__invoice_id__post`，保持 `status=0`，把要改的改了、要留的保留。
3. 返回更新结果。

已提交的记录（status≥1）原则上不改，提醒用户走撤回流程。

## 5. 查状态

**你说：**"发票 156 什么状态？"

**步骤：**
- 发票：`get_invoice_invoice_get__invoice_id__get` 直接返回详情。
- 日志：用 `list_work_logs_work_log_list_get` 按用户、项目、日期、状态过滤定位。

状态码对照：0 暂存 / 1 已提交 / 2 财务通过 / 3 审核通过 / 4 退回。
