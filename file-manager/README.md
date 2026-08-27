# 文件管理 Skill v2.3

> 本地文件管理 + 通过 SSH 免密管理 Ubuntu 服务器文件。
> **完整 MCP 协议支持**,Claude Code / WorkBuddy / QoderWork / KIMIWork 等任意 MCP 客户端可用。

[![Node](https://img.shields.io/badge/node-%E2%89%A518-blue)](#) [![License](https://img.shields.io/badge/license-MIT-blue)](#)

---

## 核心能力

| 类别 | 功能 |
|------|------|
| **本地文件** | 搜索、重命名、整理、统计 |
| **远程 CRUD** | 创建/读取/更新/删除/上传/下载 |
| **远程批量** | 模式匹配 + 大小过滤 + 内容搜索 |
| **文件共享** | ACL 三级权限(read / readwrite / admin) |
| **沙箱安全** | Home 锁死 + 系统目录黑名单 + 命令黑名单 + 二次确认 |
| **自动审计** | JSONL 格式,记录所有敏感/危险操作 |
| **即插即用** | 向导 + 配置文件 + doctor 自检 + 友好错误 |

## 平台支持

- ✅ Windows(开发机)
- ✅ Linux(服务器/桌面)
- ❌ macOS(不在测试矩阵)

---

## 5 分钟上手

### 1. 安装依赖(一次性,持久化到 `~/.file-manager/lib/`)

```bash
node scripts/install.js
```

### 2. 绑定服务器(交互式向导)

```bash
node scripts/ssh-ops.js init
```

按提示输入 server-id / IP / 端口 / 账号 / 密码,完成后自动生成 4096 位 RSA 密钥对并注入公钥。

**或命令行**:

```bash
node scripts/ssh-ops.js bind --server prod --host 1.2.3.4 --user dcm --password YOUR_PASSWORD
```

### 3. 自检

```bash
node scripts/ssh-ops.js doctor
```

### 4. 开始使用

```bash
node scripts/ssh-ops.js exec --server prod --cmd "ls -lah ~/projects"
```

---

## MCP 接入(适配各 Agent)

`mcp/server.js` 暴露 **25 个 tools + 2 个 resources**,任何 MCP 客户端都能用。

### Claude Code

`.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "file-manager": {
      "command": "node",
      "args": ["<skill>/mcp/server.js"]
    }
  }
}
```

### WorkBuddy(腾讯云)

`%USERPROFILE%\.workbuddy\mcp.json`:

```json
{
  "mcpServers": {
    "file-manager": {
      "command": "C:\\Users\\<user>\\.workbuddy\\binaries\\node\\versions\\22.22.2\\node.exe",
      "args": ["<skill>/mcp/server.js"],
      "env": {
        "FM_HOME": "C:\\Users\\<user>\\.file-manager"
      }
    }
  }
}
```

> ⚠️ `command` 必须用沙箱内置 `node.exe` **绝对路径**,不能用 `node`(PATH 不一定对)

### QoderWork(阿里)

`settings.json`:

```json
{
  "mcp.servers": {
    "file-manager": {
      "command": "node",
      "args": ["<skill>/mcp/server.js"],
      "env": { "FM_HOME": "<USER_HOME>/.file-manager" }
    }
  }
}
```

### KIMIWork(月之暗面)

`~/.kimi/config.json`:

```json
{
  "mcpServers": {
    "file-manager": {
      "command": "node",
      "args": ["<skill>/mcp/server.js"],
      "env": { "FM_HOME": "<USER_HOME>/.file-manager" }
    }
  }
}
```

---

## 用户数据布局

所有 agent **共用** `~/.file-manager/`,在一处 `bind`,处处可用:

```
~/.file-manager/
├── lib/node_modules/ssh2/    # 持久化依赖
├── keys/                      # 永久密钥对(<server-id>_key)
├── servers.json               # 服务器配置
├── shares/                    # 共享元数据
└── audit.log                  # JSONL 审计
```

---

## 常用命令

### 初始化

```bash
node scripts/ssh-ops.js install                              # 装依赖
node scripts/ssh-ops.js init                                 # 向导
node scripts/ssh-ops.js init --config ./import.json          # 批量绑定
node scripts/ssh-ops.js doctor                               # 自检
```

### 服务器

```bash
node scripts/ssh-ops.js bind    --server prod --host H --user U --password P
node scripts/ssh-ops.js unbind  --server prod
node scripts/ssh-ops.js servers list
```

### CRUD

```bash
node scripts/ssh-ops.js exec     --server prod --cmd "ls ~/projects"
node scripts/ssh-ops.js upload   --server prod --local ./f --remote ~/
node scripts/ssh-ops.js download --server prod --remote ~/f --local ./
node scripts/ssh-ops.js mkdir    --server prod --path ~/new
node scripts/ssh-ops.js write    --server prod --path ~/n.txt --content "hi"
node scripts/ssh-ops.js rm       --server prod --path ~/old --recursive
node scripts/ssh-ops.js chmod    --server prod --path ~/s --mode 755
node scripts/ssh-ops.js mv       --server prod --from ~/a --to ~/b
```

### 批量

```bash
node scripts/ssh-ops.js find --server prod --path ~/p --name "*.log"
node scripts/ssh-ops.js grep --server prod --path ~/p --pattern "TODO"
node scripts/ssh-ops.js batch delete --server prod --path ~/tmp --pattern "*.tmp"
node scripts/ssh-ops.js batch chmod  --server prod --path ~/s --pattern "*.sh" --mode 755
node scripts/ssh-ops.js stat  --server prod --path ~/p
```

### 共享(父链 traverse 自动授权)

```bash
# 默认:自动给父链加 --x(推荐)
node scripts/ssh-ops.js share add    --server prod --path ~/test --to lisi --perm read

# 关闭自动父链(谨慎;父目录须已 traverse)
node scripts/ssh-ops.js share add    --server prod --path ~/test --to lisi --perm read --no-traverse

node scripts/ssh-ops.js share list   --server prod
node scripts/ssh-ops.js share revoke --server prod --path ~/r.pdf --to alice
node scripts/ssh-ops.js share sync   --server prod
```

**v2.4 共享机制**:

- `share add` 默认自动扫描目标路径的所有父目录,给 grantee 加最小 `--x`(只 x,不给 r,无侧信道)
- 已有 traverse 的层(ACL 或 other-mode 自带)跳过,不会重复授权
- `share revoke` 自动清理"孤儿 traverse":某层 traverse 若仅为此分享而设,且不再被其他分享需要,一并清掉
- 中间层是 700 且无 ACL → 抛 `PARENT_TOO_RESTRICTIVE`,提示手动处理或换路径
- `init` 向导新选项:把 Agent home chmod 751(推荐),跨账号共享直接生效,无需父链处理

### 审计

```bash
node scripts/ssh-ops.js audit --limit 50
node scripts/ssh-ops.js audit --type share.add
```

---

## 安全模型

### 三层防线

1. **路径沙箱**:所有路径必须落在 home,越界需 `--allow-escape`
2. **系统目录黑名单**:`/etc` `/usr` `/var` 等始终禁止
3. **命令黑名单**:`sudo` / `rm -rf /` / `mkfs` / `dd` / `curl|sh` 等拦截

### 二次确认

以下操作需在 stdin 输入 `YES`:

- `rm --recursive` 递归删除
- `batch delete` 批量删除
- `mv` 覆盖目标

### 服务端加固(推荐)

绑定后,在服务器上手工加固:

```bash
# 禁用 Agent 账号 sudo
echo "claude_agent ALL=(ALL) !ALL" | sudo tee /etc/sudoers.d/claude_agent
sudo chmod 440 /etc/sudoers.d/claude_agent

# 关闭 Agent 账号密码登录
sudo passwd -l claude_agent

# 安装 ACL 工具(共享功能依赖)
sudo apt install acl
```

---

## 注意事项

- ⚠️ **凭证目录固定**:`~/.file-manager/`,跨 agent / 跨 session 持久
- ⚠️ **不要**把 `servers.json` / `keys/` 放工作目录(每次 session 重建会丢)
- ⚠️ **MCP 调 `init` 不支持交互式**,改用 `bind --password` 命令式
- ⚠️ **WorkBuddy 沙箱 ≠ 真隔离**,`safety.safeCmd` 是命令拦截的唯一防线
- ⚠️ **init 向导**走 readline,在 Claude Code / WorkBuddy 透传 stdin 的环境可用

---

## 错误码速查

| 错误码 | 含义 | 解决 |
|--------|------|------|
| `NEED_INSTALL` | ssh2 未装 | `node scripts/install.js` |
| `SSH_FAIL` / `AUTH_FAIL` | 连接/认证失败 | 检查 IP / 端口 / 密码 / 防火墙 |
| `KEY_LOGIN_FAIL` | 免密登录失败 | 检查服务端 `~/.ssh/authorized_keys` |
| `PATH_BLOCKED` | 路径越界 | 用 `~/` 开头或加 `--allow-escape` |
| `SYSTEM_PATH_BLOCKED` | 系统目录 | 不能访问 `/etc` `/usr` 等 |
| `CMD_BLOCKED` | 危险命令 | 加 `--allow-sudo` 或拆分命令 |
| `SERVER_NOT_FOUND` | server 未绑定 | `init` 或 `bind` |
| `ACL_FAILED` | setfacl 失败 | `sudo apt install acl` |
| `PARENT_TOO_RESTRICTIVE` | 父目录 700 阻挡 traverse | 所有者手动加 `setfacl -m u:<grantee>:--x <dir>` 或换路径 |
| `BIND_PARAMS_MISSING` | 缺参数 | 检查 `--server/--host/--user/--password` |

---

## 版本

- 当前版本:**2.4.0**
- 基于:Node.js ≥ 18, ssh2 ≥ 1.17
- License:MIT