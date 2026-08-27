# 审计日志

## 文件位置

`~/.file-manager/audit.log`

## 格式

JSONL(每行一条 JSON),便于用 `jq` 处理:

```jsonl
{"ts":"2026-07-01T10:30:00.123Z","server":"prod","action":"share.add","actor":"claude_agent","target":"/home/claude_agent/reports/q2.pdf","grantee":"alice","perm":"read","result":"ok","trace":"cli"}
{"ts":"2026-07-01T10:31:00.456Z","server":"prod","action":"rm.recursive","actor":"claude_agent","target":"/home/claude_agent/legacy/","result":"ok","trace":"cli"}
```

## 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ts` | string(ISO 8601) | ✓ | 时间戳 |
| `server` | string | ✓ | server-id |
| `action` | string | ✓ | 操作类型 |
| `actor` | string | ✓ | 操作用户(server username) |
| `target` | string | 视操作 | 操作对象(文件/路径/命令) |
| `grantee` | string | 视操作 | 被共享用户(仅 share) |
| `perm` | string | 视操作 | 权限级别(仅 share) |
| `result` | string | ✓ | `ok` / `fail` |
| `trace` | string | ✓ | 调用来源,如 `cli` |
| `count` | number | 视操作 | 同步数量等 |

## 记录的操作类型

仅记录**敏感/危险**操作:

| action | 说明 |
|--------|------|
| `bind` | 服务器绑定 |
| `unbind` | 服务器解绑 |
| `share.add` | 添加共享 |
| `share.revoke` | 撤销共享 |
| `share.sync` | 同步共享状态 |
| `rm.recursive` | 递归删除 |
| `batch.delete` | 批量删除 |
| `chmod.recursive` | 递归改权限 |
| `chown` | 改所有者 |
| `exec.allowSudo` | 带 `--allow-sudo` 的 exec |
| `exec.allowEscape` | 带 `--allow-escape` 的 exec |
| `mv.overwrite` | 覆盖移动 |

## 查询

### 查看最近 50 条

```bash
fm audit --limit 50
```

### 按类型筛选

```bash
fm audit --type share.add --limit 20
```

### 直接读取日志

```bash
cat ~/.file-manager/audit.log | tail -20

# 用 jq 格式化
cat ~/.file-manager/audit.log | jq -r '.ts + " " + .action + " " + .target'

# 统计某操作次数
cat ~/.file-manager/audit.log | jq -r '.action' | sort | uniq -c
```

## 保留与轮换

- 默认无限追加,文件可能持续增长
- 建议每月归档一次:

```bash
# 归档
mv ~/.file-manager/audit.log ~/.file-manager/audit-$(date +%Y%m).log
gzip ~/.file-manager/audit-$(date +%Y%m).log

# 新日志会自动创建
```

- Phase 2 将支持按大小/天数自动轮换

## 隐私注意

- **不在日志中记录密码、私钥原文**
- 不记录普通命令(`ls`/`cat`/`mkdir`)——只记录敏感操作
- 不记录 stdin 输入内容