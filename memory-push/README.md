# memory-kb — 知识库读写 MCP（目录名仍为 memory-push）

面向 [`zhuobichen/ZhaoWen_KnowledgeBase`](https://github.com/zhuobichen/ZhaoWen_KnowledgeBase) 知识库仓库（Obsidian Vault）的读写入口，供 Claude Code 与 Codex 各自在自己的会话里调用。

两类用途：
1. **概念问答沉淀**（主用途）—— 把对话里的概念性问答写成 Evergreen 原子卡片，写入即 push；
2. **零散文档推送**（原有用途）—— 把本地文档/目录复制进仓库。

## 工具

| 工具 | 说明 |
|---|---|
| `list_docs` | 列出仓库目录结构（可选 `path` 下钻，如 `OUTPUT/Evergreen`） |
| `search_docs` | 搜索现有笔记，**写入前判重**；返回 `candidates`（可能同一概念的既有卡） |
| `read_doc` | 读指定笔记全文 + 解析 frontmatter + 卡片规范校验结果 |
| `write_docs` | **批量原子写入 + 单次 commit + push**（LLM 写库主入口） |
| `publish_doc` | 把本地文件/目录复制进仓库并 push（原有能力） |

## 概念卡片沉淀流程

```
search_docs(query="<概念名>")           # 判重
  ├─ 有候选 → read_doc(候选路径) → 合并改写 → mode="overwrite"
  └─ 无候选 → 新建                          → mode="create"
write_docs(files=[N张卡 + index.md + Categories + log.md])   # 一次调用，一个 commit
```

**为什么必须一次调用**：全部校验在落盘前完成，保证要么全成、要么全不成；且 `index.md` 不会出现指向尚不存在卡片的「幻链」。

### `write_docs` 的四道护栏

| 护栏 | 行为 |
|---|---|
| 路径越界 | 拒绝 `..`、绝对路径、`.git/` |
| 撞库 | `mode="create"` 且目标已存在 → **整批中止**，提示改用 `overwrite`（防止未读旧卡就覆盖） |
| 卡片规范 | `OUTPUT/Evergreen/` 下的文件校验 frontmatter、`tags` 含 `0🌲`、**`status` 不被 `[[]]` 包裹**（死链根因）、正文单 H1、有 `## 来源` |
| 敏感信息 | 写盘**前**扫内存，命中即整批中止（或 `sensitive_action="mask"` 替换为占位符） |

### 其他保证

- **绝不 `git add -A`** —— 只暂存本批文件，不会卷进仓库里无关的未提交改动
- **提交前 `git pull --rebase`**（脏树自动 stash），避免副本落后导致 push 被拒；push 失败会再重试一次
- **remote 守卫** —— 工作副本 remote 与 `MEMORY_REPO_URL` 不一致时拒绝写入，防止写到错误副本
- **占位符展开** —— 内容里的 `{{TODAY}}`、`{{SESSION_ID}}` 自动替换为当天日期 / 当前会话短 id
- 返回值 = 首行人话摘要 + `---JSON---` + 结构化 JSON（含 `ok`/`files[].action`/`commitHash`/`pushed`）

## 知识库结构

两层体系（详见仓库内 `CLAUDE.md` 与 `OUTPUT/Templates/SCHEMA.md`）：

- **原始沉淀层**（只增不减）：`AI参考资料/`、`Agent工作流/`、`AI项目生成文档_AI对话沉淀/` 等 → 零散文档放这层
- **OUTPUT 精炼层**（LLM 维护）：`Sources/` → `Evergreen/` → `Categories/`，另有 `index.md` / `log.md`
  - 概念问答卡片落在 `OUTPUT/Evergreen/概念卡片/`

> ⚠️ 仓库用 **Git LFS** 管理 `*.rsm` / `*.csv`。推这类大文件需本地已装 `git-lfs`；推 Markdown 不受影响。

## 配置（环境变量，均有默认值）

| 变量 | 默认 |
|---|---|
| `MEMORY_REPO_URL` | `git@github.com:zhuobichen/ZhaoWen_KnowledgeBase.git` |
| `MEMORY_REPO_DIR` | `E:\CodeProject\ZhaoWen_KnowledgeBase`（工作副本，不存在会自动 clone） |
| `MEMORY_WIKI_ROOT` | `OUTPUT`（wiki 层相对根，搜索范围默认值） |
| `GIT_BIN` | `git` |

## 注册

**Claude Code**（`~/.claude.json`）：

```json
"memory-push": {
  "type": "stdio",
  "command": "cmd",
  "args": ["/c", "node", "E:/CodeProject/node_modules/tsx/dist/cli.mjs", "E:/CodeProject/mcp-server/memory-push/index.ts"],
  "cwd": "E:\\CodeProject"
}
```

**Codex**（`~/.codex/config.toml`）：

```toml
[mcp_servers.memory-kb]
command = 'C:\Program Files\nodejs\node.exe'
args = ["E:\\CodeProject\\node_modules\\tsx\\dist\\cli.mjs",
        "E:\\CodeProject\\mcp-server\\memory-push\\index.ts"]
startup_timeout_sec = 60

[mcp_servers.memory-kb.env]
MEMORY_REPO_DIR = 'E:\CodeProject\ZhaoWen_KnowledgeBase'
MEMORY_REPO_URL = 'git@github.com:zhuobichen/ZhaoWen_KnowledgeBase.git'
```

依赖 tsx 与 @modelcontextprotocol/sdk（已装在 `E:/CodeProject/node_modules`），无需单独 install。

> 目录名沿用 `memory-push` 以免改动已注册的路径；服务握手名与 Codex 注册名均为 `memory-kb`。
