# 文件共享(ACL) - v2.5 三层独立授权

## v2.5.1 默认值变更

**核心变更:`share add` 不传 `--file-perm` 时,默认给所有现有文件 `r--`(开箱即读)。**

| 维度 | v2.5.0 默认 | v2.5.1 默认 |
|------|------------|------------|
| 容器 | `list`(r-x) | `list`(r-x)(不变) |
| 子项(现有文件) | **无 ACL**(必须 share grant) | **`r--`**(开箱即读) |
| 未来项 | 无 | 无(不变) |
| `share grant` perm | 必填 | **不传默认 `read`** |
| `share grant-dir` perm | 必填 | **不传默认 `read`** |

**关键安全保证**:**没有任何对象给 w 权限** —— lisi 不能 rm/mv/touch/mkdir/echo>>/改任何文件。

**典型用法**:
```bash
# 一步分享:lisi 立即可读,不能改
fm share add --server prod --path ~/test --to lisi

# 让 lisi 写某个文件(显式)
fm share grant --server prod --path ~/test/a.txt --to lisi --perm readwrite

# 让 lisi 未来也能写新文件
fm share set-default --server prod --path ~/test --to lisi --perm readwrite
```

## 设计理念

把"分享一个目录"拆成**三个独立维度**,每个维度由分享者显式分配:

```
zhangsan/test/
  ├── 1. 容器(test/ 本身)        — 默认 list(r-x),可显式改 none/traverse/full
  ├── 2. 子项(现有文件/子目录)   — 默认无权限,必须 share grant 显式分配
  └── 3. 未来项(以后新建)        — 默认无,必须 share set-default 显式开启
```

### 防御原理(为什么默认安全)

Linux 删除/重命名一个文件,实际修改的是**父目录的目录项**,需要父目录的 `w` 权限。
容器默认 `list`(r-x)**没有 w**,所以被分享者 **永远不能**:

- 在 test/ 下 mkdir / touch
- 在 test/ 下 rm / mv / 改名任何文件
- 删除 test/ 本身

即使 zhangsan 显式把某个文件 grant 给 lisi 让其 `cat`,lisi 仍然无法 `rm` 该文件(因为父目录没 w)。

---

## 三层模型详解

### 1. 容器权限(目录本身)4 档

| perm 值 | 实际 ACL | grantee 行为 |
|---------|---------|-------------|
| `none` | 不设 ACL | 啥也做不了(即使有 grant 也访问不到) |
| `list`(默认) | `r-x` | 可 ls/cd,可读子目录列表 |
| `traverse` | `--x` | 仅按已知路径进入,不能 ls |
| `full` | `rwx` | 可增删改目录项(rm/mv/touch) |

### 2. 子项权限(现有文件/子目录)

| perm 值 | 文件 ACL | grantee 行为 |
|---------|---------|-------------|
| `read`(默认) | `r--` | 可读 |
| `readwrite` | `rw-` | 可读可写 |
| `admin` | `rwx` | 可读可写可执行(配合 chmod +x) |

**v2.5.1 默认行为**:`share add` 不传 `--file-perm` 时,自动给**所有现有文件** `r--`(开箱即可读)。

### 3. 未来项(default ACL)

| perm 值 | 效果 |
|---------|------|
| `none`(默认) | zhangsan 以后新建的文件 lisi 无权限 |
| `read` / `readwrite` / `admin` | 新文件自动继承对应权限 |

---

## `--level` 快捷等级

| `--level` | 容器 | 子项 | 未来项 | 二次确认 |
|-----------|------|------|--------|---------|
| `read`(默认) | `list` | 全部 `read`(r--) | 无 | ❌ |
| `readwrite` | `list` | 全部 `readwrite` | `readwrite` | ❌ |
| `full` | `full` | 全部 `readwrite` | `readwrite` | ⚠️ 需输入 `SHARE_FULL` |

`--level` 是**展开**为下方 3 个独立参数,不是黑盒。CLI 优先看 `--level`,若与 `--container`/`--file-perm`/`--default-perm` 同时存在则报错 `LEVEL_CONFLICT`。

---

## 命令清单

### 创建分享

```bash
# 最简:仅声明分享关系(默认 read = 仅看列表)
fm share add --server prod --path ~/test --to lisi

# 快捷等级
fm share add --server prod --path ~/test --to lisi --level read       # = 默认
fm share add --server prod --path ~/test --to lisi --level readwrite  # 现有+未来文件 rw-
fm share add --server prod --path ~/test --to lisi --level full        # 完全管理(需确认)

# 细粒度分步
fm share add --server prod --path ~/test --to lisi \
  --container list \
  --file-perm readwrite \
  --default-perm readwrite

# 单个文件
fm share add --server prod --path ~/reports/q2.pdf --to alice --file-perm read
```

### 显式分配子项

```bash
# 单文件
fm share grant --server prod --path ~/test/a.txt --to lisi --perm read

# 通配符(只对匹配文件)
fm share grant --server prod --path ~/test --to lisi --perm read --pattern '*.log'

# 容器内所有现有文件
fm share grant --server prod --path ~/test --to lisi --perm readwrite --all

# 整个子目录内的文件
fm share grant-dir --server prod --path ~/test/logs --to lisi --perm readwrite
```

### 调整容器权限

```bash
fm share grant-container --server prod --path ~/test --to lisi --perm full
fm share grant-container --server prod --path ~/test --to lisi --perm list
fm share grant-container --server prod --path ~/test --to lisi --perm none
fm share grant-container --server prod --path ~/test --to lisi --perm traverse
```

### 调整未来项

```bash
fm share set-default --server prod --path ~/test --to lisi --perm readwrite
fm share set-default --server prod --path ~/test --to lisi --perm none   # 关闭
```

### 撤销

```bash
# 整个分享(含所有 grant + default + 容器 ACL)
fm share revoke --server prod --path ~/test --to lisi

# 撤销单文件授权(保留分享关系)
fm share revoke-grant --server prod --path ~/test/a.txt --to lisi

# 撤销容器权限(降级为 none,grant 保留)
fm share revoke-container --server prod --path ~/test --to lisi

# 撤销 default ACL
fm share revoke-default --server prod --path ~/test --to lisi
```

### 查看

```bash
fm share list --server prod
```

输出示例(每个分享一条记录,内嵌 grants):

```json
[
  {
    "id": "share-1720000000000-123",
    "path": "/home/zhangsan/test",
    "grantee": "lisi",
    "target_type": "DIR",
    "container_perm": "list",
    "file_perm": null,
    "default_perm": "readwrite",
    "grants": [
      { "path": "/home/zhangsan/test/a.txt", "perm": "readwrite", "granted_at": "..." },
      { "path": "/home/zhangsan/test",       "perm": "read",      "pattern": "*.log" }
    ],
    "traverse_grants": ["/home/zhangsan"],
    "created_at": "...",
    "granted_by": "zhangsan",
    "level": null
  }
]
```

---

## 实战场景对照

| 场景 | 命令序列 |
|------|---------|
| lisi 只能看 test 列表 | `share add --path ~/test --to lisi` |
| lisi 读 a.txt 不可删 | `share add` + `share grant --path ~/test/a.txt --perm read` |
| lisi 读所有 .log | `share add` + `share grant --path ~/test --perm read --pattern '*.log'` |
| lisi 写新文件,不能删旧的 | `share add --level readwrite`(容器 list 仍无 w) |
| lisi 完全管理 test/ | `share add --level full`(需确认) |
| zhangsan 新建文件 lisi 自动能读 | `share add` + `share set-default --perm read` |

---

## 父目录 traverse 自动授权(v2.4 保留)

`fm share add` 会自动给目标路径的**所有父目录**加 `u:<grantee>:--x`,使被分享人能穿透 home 链。

```bash
# 默认开启 traverse 自动授权(推荐)
fm share add --server prod --path ~/test --to lisi

# 关闭(谨慎,要求父目录已具备 traverse)
fm share add --server prod --path ~/test --to lisi --no-traverse
```

若中间某层是 700 且无 ACL,会抛 `PARENT_TOO_RESTRICTIVE`。

---

## 元数据持久化

`~/.file-manager/shares/<server-id>.json`:

```json
{
  "version": "2.5",
  "server": "prod",
  "items": [
    {
      "id": "share-...",
      "path": "/home/zhangsan/test",
      "grantee": "lisi",
      "target_type": "DIR",
      "container_perm": "list",
      "file_perm": null,
      "default_perm": "readwrite",
      "grants": [ ... ],
      "traverse_grants": ["/home/zhangsan"],
      "created_at": "...",
      "granted_by": "zhangsan"
    }
  ]
}
```

---

## 限制

1. **共享用户必须存在于服务器**:grantee 必须是合法的 Linux 账号
2. **不支持组共享**:后续版本通过 `g:<group>:...` 扩展
3. **不支持 URL 分享**:需要 HTTP 服务
4. **不支持授权密钥共享**:v2.5 只做 ACL