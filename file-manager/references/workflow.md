# 工作流参考

完整 CLI 命令清单,所有命令通过 `node scripts/ssh-ops.js <cmd>` 调用。

## 1. 初始化(首次)

```bash
# 1. 安装 ssh2 依赖(一次性,持久化)
node scripts/install.js

# 2. 启动向导(交互式)
node scripts/ssh-ops.js init

# 或使用配置文件批量绑定
node scripts/ssh-ops.js init --config ./import.json
```

## 2. 服务器绑定

```bash
# 单个绑定(已有账号)
node scripts/ssh-ops.js bind --server prod --host 1.2.3.4 --user root --password xxx

# 列出已绑定
node scripts/ssh-ops.js servers list

# 解绑(密钥保留)
node scripts/ssh-ops.js unbind --server prod

# 检测 ACL 工具
node scripts/ssh-ops.js check-acl --server prod
```

## 3. CRUD 操作

```bash
# 通用 exec(带沙箱)
node scripts/ssh-ops.js exec --server prod --cmd "ls -lah ~/projects"

# 创建
node scripts/ssh-ops.js mkdir --server prod --path ~/projects/new-app
node scripts/ssh-ops.js write --server prod --path ~/notes.txt --content "hello"

# 读
node scripts/ssh-ops.js find --server prod --path ~/projects --name "*.log"
node scripts/ssh-ops.js grep --server prod --path ~/src --pattern "TODO"

# 改
node scripts/ssh-ops.js chmod --server prod --path ~/script.sh --mode 755
node scripts/ssh-ops.js mv    --server prod --from ~/old.txt --to ~/new.txt

# 删
node scripts/ssh-ops.js rm    --server prod --path ~/old.txt
node scripts/ssh-ops.js rm    --server prod --path ~/legacy/ --recursive  # 二次确认

# 上传下载
node scripts/ssh-ops.js upload   --server prod --local ./local.tar.gz --remote ~/uploads/
node scripts/ssh-ops.js upload   --server prod --local ./dist --remote ~/app/ --recursive
node scripts/ssh-ops.js download --server prod --remote ~/data.json --local ./data.json
node scripts/ssh-ops.js download --server prod --remote ~/logs --local ./logs --tar
```

## 4. 批量操作

```bash
# 查找
node scripts/ssh-ops.js find --server prod --path ~/var --size +10M
node scripts/ssh-ops.js grep --server prod --path ~/src --pattern "TODO" --include "*.js"

# 批量改
node scripts/ssh-ops.js batch chmod  --server prod --path ~/scripts --pattern "*.sh" --mode 755

# 批量删(二次确认)
node scripts/ssh-ops.js batch delete --server prod --path ~/tmp --pattern "*.tmp"

# 统计
node scripts/ssh-ops.js stat --server prod --path ~/projects
```

## 5. 文件共享(三级权限)

```bash
# 共享
node scripts/ssh-ops.js share add --server prod --path ~/reports/q2.pdf --to alice --perm read
node scripts/ssh-ops.js share add --server prod --path ~/data --to bob --perm readwrite --recursive
node scripts/ssh-ops.js share add --server prod --path ~/projects --to carol --perm admin

# 查看
node scripts/ssh-ops.js share list --server prod

# 撤销
node scripts/ssh-ops.js share revoke --server prod --path ~/reports/q2.pdf --to alice

# 同步(检测外部变更)
node scripts/ssh-ops.js share sync --server prod
```

权限级别:

| 级别 | 列表 | 读取 | 创建/修改/删除 | 转授 |
|------|------|------|--------------|------|
| read | ✓ | ✓ | ✗ | ✗ |
| readwrite | ✓ | ✓ | ✓ | ✗ |
| admin | ✓ | ✓ | ✓ | ✓ |

## 6. 审计

```bash
# 最近 50 条
node scripts/ssh-ops.js audit --limit 50

# 筛选
node scripts/ssh-ops.js audit --type share.add --limit 20
```

## 7. 环境变量

| 变量 | 含义 | 默认 |
|------|------|------|
| FM_HOME | 凭证目录 | `~/.file-manager` |
| FM_CONFIG | 配置文件路径 | 自动发现 |
| FM_DEFAULT_SERVER | 默认 server-id | 从 servers.json |

## 8. 详细文档

- [credentials.md](credentials.md) - 凭证与密钥管理
- [safety.md](safety.md) - 沙箱与危险操作
- [sharing.md](sharing.md) - 共享与 ACL 详解
- [errors.md](errors.md) - 错误码表
- [audit.md](audit.md) - 审计日志格式