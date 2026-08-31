# 场景 3：月底暂存盘点

暂存记录（status=0）不会进任何统计和审核流，堆久了就忘了。每月月底提醒用户去网站提交。

## 盘点流程

1. `read_me_slim_users_me_slim_get` 拿 `user_id`。
2. **日志盘点：**
   - `list_work_logs_work_log_list_get`，`status=0`，`start_date=本月1日`，`end_date=今天`。
   - `get_total_hours_work_log_total_hours_get`，`status=0`，本月范围，看未提交工时。
   - `get_work_log_status_count_work_log_status_count_get` 看本月状态分布。
3. **发票盘点：**
   - `list_invoices_invoice_list_get`，`status=0`，本月范围。
   - `get_total_amount_invoice_total_amount_get`，`status=0`，本月范围，看未提交金额。
   - `get_invoice_status_count_invoice_stat_get` 看本月状态分布。
4. **输出盘点报告：**
   - 日志：N 条暂存、M 小时未提交、本月状态分布。
   - 发票：K 张暂存、¥X 未提交、本月状态分布。
   - 列出 ID 清单，提醒去网站提交，顺便清理不需要的测试数据。
5. 不替用户提交，只提醒。

## automation 配置

- `scheduleType=recurring`
- `rrule=FREQ=MONTHLY;BYMONTHDAY=28;BYHOUR=10;BYMINUTE=0`（每月 28 号 10:00，选 28 不选最后一天避免小月边界问题）
- `prompt`：扫当前用户本月 status=0 的日志和发票 → 输出盘点报告 → 提醒去网站提交。别替用户提交，别改 status。
- MCP 调用失败只记错误，不重试。

## 随时触发

对话里说"盘点我本月的暂存""看看哪些发票还没提交"就行，不用建 automation。

## 和其他场景的关系

- 场景 1 每天建暂存日志 → 月底本场景提醒提交。
- 场景 2 批量入库发票 → 月底本场景提醒提交。
- 每月 1 号场景 2(c) 入库前，先跑一遍盘点；或合并到同一天，先提交上月暂存再入库本月。
