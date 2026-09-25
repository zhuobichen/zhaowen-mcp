# memory-push — 把零散文档推送到 MEMORY 知识库的 MCP

把本地零散的文档资料（单个文件或整个目录）推送到 [`zhuobichen/MEMORY`](https://github.com/zhuobichen/MEMORY) 知识库仓库。
**只有你显式说"推送"时才会 push。**

## 工具

| 工具 | 说明 |
|---|---|
| `list_docs` | 列出 MEMORY 仓库顶层目录结构（帮助选择目标子目录） |
| `publish_doc` | 把本地文件/目录推送到 MEMORY 指定子目录并 push（支持 `dry_run` 预览） |

## 用法

```
# 先看仓库结构，选目标子目录
list_docs

# 推送单个文件
publish_doc src="E:/某处/笔记.md" subdir="AI参考资料"

# 推送整个目录
publish_doc src="E:/某处/我的资料夹" subdir="Agent工作流"

# 只预览不推送
publish_doc src="..." subdir="..." dry_run=true
```

## 流程

1. 校验源（文件或目录）
2. 复制到 `<仓库>/<subdir>/`（**合并语义**：同名文件覆盖，不删除目标中已有文件）
3. **敏感检查**（密码/API key/内网 IP/凭据文件名）—— 默认命中即中止，可 `sensitive_action="mask"`
4. `git add` + `commit` + `push`

## MEMORY 仓库说明

两层体系（详见仓库内 `CLAUDE.md`）：

- **原始沉淀层**（只增不减）：`AI参考资料/`、`Agent工作流/`、`待办-已办提示词工作流/`、`AI项目生成文档_AI对话沉淀/` 等 → **零散文档一般放这层**
- **OUTPUT 层**：精炼知识库（`Sources/` → `Evergreen/` → `Categories/`），由 LLM 维护

> ⚠️ 仓库用 **Git LFS** 管理 `*.rsm` / `*.csv`。推送这类大文件需本地已装 `git-lfs`；推 Markdown 文档不受影响。

## 配置（环境变量，均有默认值）

| 变量 | 默认 |
|---|---|
| `MEMORY_REPO_URL` | `git@github.com:zhuobichen/MEMORY.git` |
| `MEMORY_REPO_DIR` | `E:\CodeProject\mcp-server\MEMORY`（工作副本，不存在会自动 clone） |
| `GIT_BIN` | `git` |

## 注册（~/.claude.json）

```json
"memory-push": {
  "type": "stdio",
  "command": "cmd",
  "args": ["/c", "node", "D:/github_project/ZhaoWen_GitHub维护/zhaowen-mcp/memory-push/node_modules/tsx/dist/cli.mjs", "D:/github_project/ZhaoWen_GitHub维护/zhaowen-mcp/memory-push/index.ts"],
  "cwd": "E:\\CodeProject"
}
```

依赖 tsx 与 @modelcontextprotocol/sdk，在**本目录** `npm install` 一次即可（各服务各自一份 `node_modules`，不共用）。
