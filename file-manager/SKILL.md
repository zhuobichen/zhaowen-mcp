---
name: file-manager
description: 文件管理 Skill。提供本地文件管理 + 通过 SSH 免密管理 Ubuntu 服务器文件(上传/下载/CRUD/批量/权限/共享)。当用户提到"上传到服务器""从服务器下载""删除服务器文件""修改服务器权限""远程文件管理""共享文件给""服务器文件搜索"等场景时使用。Windows + Linux 双平台,基于 Node.js ssh2,支持交互式向导、批量绑定、ACL 共享三级权限(parent traverse 自动授权)、home 沙箱、自动审计。v2.5 三层独立授权(容器/子项/未来项)——被分享者可查看目录列表,但增删改与文件内容均需分享者显式分配。
---

# 文件管理 Skill v2.5

Claude Code 原生文件管理 skill,覆盖**本地 + 远程**两类场景。

## 能力速览

| 类别 | 功能 |
|------|------|
| **本地** | 搜索、重命名、整理、统计(基于原生 bash/PowerShell) |
| **远程 CRUD** | 创建/读取/更新/删除/上传/下载,基于 SSH + SFTP |
| **远程批量** | 按名称/大小/内容查找、批量改权限、批量删除 |
| **远程共享** | **v2.5 三层独立授权**(容器/子项/未来项),容器 4 档(none/list/traverse/full),子项可按文件/通配符/子目录精细授权,`--level` 快捷等级 |
| **凭证** | 永久密钥(按 server-id 命名),IP 变化不影响复用 |
| **沙箱** | 默认锁死在 home,`--allow-escape`/`--allow-sudo` 显式开关;`--sandbox` 为 exec 启用路径检查 |
| **审计** | JSONL 格式,自动记录所有敏感/危险操作 |
| **即插即用** | 向导模式 + 配置文件批量 + `doctor` 自检 + 友好错误 |

## 触发场景

- "上传 ./local.tar.gz 到 prod 服务器"
- "从 staging 服务器下载 ~/logs 目录"
- "把 ~/reports/q2.pdf 共享给 alice"
- "删除服务器上 ~/old-data/ 整个目录"
- "在 ~/projects 下找所有 TODO 标记"
- "服务器 ~/scripts 下所有 .sh 改 755 权限"
- "绑定新服务器 1.2.3.4"
- "查看最近的共享操作记录"
- "把 test 目录分享给 lisi,他能看文件列表但不能改"
- "让 lisi 读 test 下的 .log 文件"

## 环境要求

- Node.js ≥ 18(Claude Code 内置)
- ssh2(由 `node scripts/install.js` 自动持久化)
- Windows / Linux 双平台(macOS 不在测试矩阵)

## 凭证目录

`~/.file-manager/`

```
~/.file-manager/
├── lib/node_modules/ssh2/    # 持久化依赖
├── keys/                      # 各 server 密钥对
├── servers.json               # 服务器配置
├── shares/                    # 共享元数据(v2.5)
└── audit.log                  # 审计日志
```

## 快速开始

### 1. 首次安装

```bash
node scripts/install.js
```

### 2. 绑定服务器(向导)

```bash
node scripts/ssh-ops.js init
```

### 3. 或批量绑定(配置文件)

```bash
node scripts/ssh-ops.js init --config ./import.json
```

### 4. 自检

```bash
node scripts/ssh-ops.js doctor
```

### 5. 开始使用

```bash
# SSH 命令
node scripts/ssh-ops.js exec --server prod --cmd "ls -lah ~/projects"

# CRUD
node scripts/ssh-ops.js upload   --server prod --local ./local.tar.gz --remote ~/uploads/
node scripts/ssh-ops.js download --server prod --remote ~/data.json --local ./data.json

# 共享(v2.5 三层独立授权)
node scripts/ssh-ops.js share add --server prod --path ~/test --to lisi
node scripts/ssh-ops.js share grant --server prod --path ~/test/a.txt --to lisi --perm read
node scripts/ssh-ops.js share grant-container --server prod --path ~/test --to lisi --perm full
node scripts/ssh-ops.js share set-default --server prod --path ~/test --to lisi --perm readwrite

# 审计
node scripts/ssh-ops.js audit --limit 50
```

## 共享模型速览(v2.5)

| 维度 | 默认 | 显式分配方式 |
|------|------|------------|
| **容器(目录本身)** | `list`(r-x,可 ls 不可改) | `share grant-container --perm {none\|list\|traverse\|full}` |
| **子项(现有文件/子目录)** | 无权限 | `share grant --perm {read\|readwrite\|admin}` 或 `--pattern '*.log'` |
| **未来项(以后新建)** | 无权限 | `share set-default --perm {read\|readwrite\|admin}` |

`--level` 快捷:
- `--level read`:仅看列表(默认行为)
- `--level readwrite`:可读写所有现有 + 未来文件
- `--level full`:完全管理(⚠️ 需输入 SHARE_FULL 二次确认)

## 完整命令清单

参见 [references/workflow.md](references/workflow.md)。

## 安全模型

| 层 | 措施 |
|----|------|
| **路径沙箱** | 所有路径必须落在 `~/`,越界需 `--allow-escape` |
| **系统目录黑名单** | `/etc` `/usr` `/var` 等始终禁止 |
| **命令黑名单** | `sudo`/`rm -rf /`/`mkfs`/`dd`/`curl\|sh` 等拦截 |
| **二次确认** | 递归删除、批量删除、覆盖移动、`--level full` 容器授权 |
| **服务端加固** | 建议禁用 Agent 账号 sudo、关闭密码登录 |
| **v2.5 共享安全** | 容器默认无 w,grantee 永远不能 rm/mv/touch,即使文件被显式 grant rwx |

详见 [references/safety.md](references/safety.md)、[references/sharing.md](references/sharing.md)。

## 文档结构

- [SKILL.md](SKILL.md) - 本文件(Claude Code 入口)
- [README.md](README.md) - 项目说明
- [references/workflow.md](references/workflow.md) - 完整命令清单
- [references/credentials.md](references/credentials.md) - 凭证与密钥管理
- [references/safety.md](references/safety.md) - 沙箱与安全
- [references/sharing.md](references/sharing.md) - 文件共享(ACL,v2.5 三层独立授权)
- [references/errors.md](references/errors.md) - 错误码表
- [references/audit.md](references/audit.md) - 审计日志格式
- [docs/PHASE_1.5_PLAN.md](docs/PHASE_1.5_PLAN.md) - 改造方案
- [docs/FEATURES.md](docs/FEATURES.md) - 功能清单

## 环境变量

| 变量 | 含义 | 默认 |
|------|------|------|
| `FM_HOME` | 凭证目录 | `~/.file-manager` |
| `FM_CONFIG` | 配置文件路径 | 自动发现 |
| `FM_DEFAULT_SERVER` | 默认 server-id | 从 servers.json |

## 平台支持

- ✅ Windows(开发机)
- ✅ Linux(服务器/桌面)
- ❌ macOS(不在测试矩阵)

## 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026/06/30 | 初版:本地文件管理 |
| v2 | 2026/07/01 | 整合远程文件管理(workbuddy Node.js 22.22.2 + ssh2);模糊化敏感信息 |
| v2.3 | 2026/07/01 | Claude Code 原生化:持久化安装、永久密钥、home 沙箱、ACL 三级共享、自动审计;即插即用增强(向导 + 配置 + doctor + 友好错误) |
| v2.4 | 2026/07/03 | 父目录 traverse 自动授权,`--no-traverse` 关闭 |
| v2.5 | 2026/07/06 | **三层独立授权重构**:容器(none/list/traverse/full)/子项/未来项分离;`--level {read\|readwrite\|full}` 快捷;`share grant/grant-container/grant-dir/set-default` 精细控制;`full` 等级二次确认 |
| v2.5.1 | 2026/07/06 | **`share add` 默认给所有现有文件 `r--`**(开箱即可读);`share grant/grant-dir` 不传 `--perm` 默认 `read`;**全程无 w 权限** |