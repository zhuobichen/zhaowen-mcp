# 错误码表

所有错误码都有友好提示(标题 + 原因 + 修复建议)。

## 安装与环境

| 错误码 | 标题 | 原因 | 修复 |
|--------|------|------|------|
| `NEED_INSTALL` | ssh2 依赖未找到 | 首次使用前需安装 | 运行 `node scripts/install.js` |
| `NO_AUTH` | 服务器配置缺少 key 或 password | servers.json 配置不全 | 重新绑定 |
| `SERVERS_FILE_CORRUPT` | servers.json 文件损坏 | JSON 解析失败 | 检查或从备份恢复 |

## SSH 连接

| 错误码 | 标题 | 原因 | 修复 |
|--------|------|------|------|
| `SSH_FAIL` | SSH 连接失败 | 网络/防火墙/认证 | 检查 IP、sshd、防火墙、安全组 |
| `AUTH_FAIL` | 密码认证失败 | 密码错误或账号锁定 | 确认密码、确认账号可登录 |
| `KEY_LOGIN_FAIL` | 密钥登录失败 | 公钥未注入或权限错 | 重新绑定,检查 `~/.ssh` 权限 |

## 路径与命令

| 错误码 | 标题 | 原因 | 修复 |
|--------|------|------|------|
| `PATH_BLOCKED` | 路径越界 | Agent 账号被限制在 home | 改用 `~/`,或 `--allow-escape` |
| `SYSTEM_PATH_BLOCKED` | 系统目录禁止 | `/etc` 等始终禁 | 用管理员账号手动操作 |
| `CMD_BLOCKED` | 危险命令被拦截 | 匹配黑名单 | `--allow-sudo` / 拆分命令 |
| `PERMISSION_DENIED` | 文件权限不足 | 普通用户无权 | `chmod` / 联系所有者 |

## 服务器

| 错误码 | 标题 | 原因 | 修复 |
|--------|------|------|------|
| `SERVER_NOT_FOUND` | 服务器未绑定 | server-id 不存在 | 先 `init` 或 `bind` |
| `NO_DEFAULT_SERVER` | 未指定服务器 | `--server` 缺失 | `--server` 或 `FM_DEFAULT_SERVER` |

## 共享

| 错误码 | 标题 | 原因 | 修复 |
|--------|------|------|------|
| `ACL_FAILED` | ACL 操作失败 | setfacl 执行失败 | `apt install acl`,检查文件系统 ACL 支持 |
| `INVALID_PERM` | 无效权限级别 | perm 不在 read/readwrite/admin | 用合法值 |

## 通用

| 错误码 | 标题 | 原因 | 修复 |
|--------|------|------|------|
| `CONFIG_NOT_FOUND` | 配置文件不存在 | `--config` 路径错 | 检查路径 |
| `CONFIG_INVALID` | 配置文件格式错 | JSON 数组格式错 | 检查 JSON 语法 |
| `BIND_PARAMS_MISSING` | 绑定参数缺失 | `--server/--host/--user/--password` 缺一 | 补全参数 |
| `INJECT_FAILED` | 公钥注入失败 | 注入命令返回非 0 | 检查服务器权限、sshd_config |

## 调试技巧

### 1. 启用详细日志

```bash
DEBUG=1 fm exec --server prod --cmd "ls"
```

(Phase 1.5 暂未实现,Phase 2 引入)

### 2. 查看审计日志

```bash
fm audit --limit 100
```

### 3. 检查 SSH 原始连接

```bash
ssh -v -i ~/.file-manager/keys/prod_key claude_agent@1.2.3.4
```

### 4. 检查服务端 ACL 状态

```bash
ssh -i ~/.file-manager/keys/prod_key claude_agent@1.2.3.4 "getfacl /home/claude_agent/reports/q2.pdf"
```