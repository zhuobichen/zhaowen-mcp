# 沙箱与安全

## 三层防线

### 第 1 层:路径沙箱(Home Lockdown)

所有路径操作必须落在 home 目录内,否则抛出 `PATH_BLOCKED`:

```javascript
const abs = safety.safePath('/home/alice', '~/projects/app');
// → '/home/alice/projects/app' ✓

safety.safePath('/home/alice', '/etc/passwd');
// → throws PATH_BLOCKED ✗
```

**支持的输入格式**:
- `~/xxx` → 展开为 `/home/<user>/xxx`
- `~` → home 根目录
- 绝对路径 `/xxx/yyy` → 直接检查是否在 home 内

**显式开关**: `--allow-escape`

```bash
# 默认越界被拒
fm exec --server prod --cmd "ls /tmp/shared"

# 显式允许
fm exec --server prod --cmd "ls /tmp/shared" --allow-escape
```

### 第 2 层:系统目录黑名单

即便在 home 内,以下路径始终禁止:

```
/etc /usr /var /boot /proc /sys /dev /sbin /bin /lib /lib64 /opt /root /run
```

任何对系统目录的请求直接抛出 `SYSTEM_PATH_BLOCKED`,不允许越界。

### 第 3 层:命令黑名单

以下命令模式被拦截:

| 模式 | 风险 |
|------|------|
| `sudo ...` | 提权(需 `--allow-sudo`) |
| `su ...` | 切换用户 |
| `rm -rf /` | 删根 |
| `mkfs ...` | 格式化 |
| `dd if=...` | 写磁盘 |
| `chmod -R 777` | 全局可写 |
| `curl ... | sh` | 远程执行 |
| `wget ... | sh` | 远程执行 |
| `:(){ :\|:& };:` | fork 炸弹 |
| `nc -l` | 反弹 shell 监听 |
| `bash -i >& /dev/tcp/...` | 反弹 shell |

**显式开关**: `--allow-sudo`

```bash
fm exec --server prod --cmd "sudo systemctl restart nginx" --allow-sudo
```

## 二次确认

以下操作需要从 stdin 输入 `YES` 才执行:

| 操作 | 命令 |
|------|------|
| 递归删除 | `fm rm ... --recursive` |
| 批量删除 | `fm batch delete ...` |
| 覆盖移动 | `fm mv ...`(目标存在时) |

示例:

```
$ fm rm --server prod --path ~/legacy/ --recursive
⚠️ 将递归删除 /home/alice/legacy/ 及其所有内容,无法恢复
请输入 YES 继续: _
```

输入非 `YES` 即取消。

## exec 沙箱模式(--sandbox)

`exec` 默认**不做路径检查**,因为它是"通用命令",用户自负责任。

如果需要在 `exec` 中也启用路径沙箱,加 `--sandbox`:

```bash
# 默认:不拦截路径
fm exec --server prod --cmd "cat /etc/passwd"
# ⚠️ 输出内容,不拦截

# --sandbox:扫描命令中的路径,越界则拦截
fm exec --server prod --cmd "cat /etc/passwd" --sandbox
# ❌ SYSTEM_PATH_BLOCKED

fm exec --server prod --cmd "ls /tmp" --sandbox
# ❌ PATH_BLOCKED

fm exec --server prod --cmd "cat /home/alice/data.txt" --sandbox
# ✓ 正常输出(因为在 home 内)
```

`--sandbox` 会:
- 扫描命令中的 `/xxx`、`~/xxx`、`./xxx` 路径
- 跳过可执行命令路径(`/usr/bin/cat`、`/bin/ls` 等)
- 对每个数据路径调用 `safePath` 检查
- 写入审计日志 `action: exec.sandbox`

## 审计日志

所有敏感/危险操作自动写入 `~/.file-manager/audit.log`:

```json
{"ts":"2026-07-01T10:30:00Z","server":"prod","action":"rm.recursive","actor":"claude_agent","target":"/home/alice/legacy/","result":"ok","trace":"cli"}
```

详见 [audit.md](audit.md)。

## 推荐:服务端加固

除客户端拦截外,建议在服务端也加固(在 `init` 时执行):

```bash
# 1. 限制 Agent 账号不能 sudo
echo "claude_agent ALL=(ALL) !ALL" | sudo tee /etc/sudoers.d/claude_agent
sudo chmod 440 /etc/sudoers.d/claude_agent

# 2. 禁用 Agent 账号的密码登录
sudo passwd -l claude_agent

# 3. home 目录权限加固
sudo chmod 750 /home/claude_agent
```

这样即便客户端拦截被绕过,服务端仍是安全的。