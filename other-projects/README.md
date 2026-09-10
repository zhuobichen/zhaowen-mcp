# other-projects — 把「帮别人做的任务」发布到 GitHub 的 MCP

把本地为他人完成的任务目录,一键发布到 [`zhuobichen/Other_Projects`](https://github.com/zhuobichen/Other_Projects) 仓库的同名子目录。
**只有你显式说"推送"时才会 push。**

## 工具

| 工具 | 说明 |
|---|---|
| `list_projects` | 列出仓库中现有的项目子目录 |
| `publish_project` | 把本地任务目录发布到仓库同名子目录并 push（支持 `dry_run` 预览） |

## 用法

```
publish_project src_dir="E:/CodeProject/其余工程/APR-D-26-00796_审稿意见"
publish_project src_dir="..." name="自定义目录名" message="feat: xxx"
publish_project src_dir="..." dry_run=true          # 只预览，不推送
```

## 流程

1. 校验源目录（存在、非空）
2. 复制到仓库 `Other_Projects/<name>/`（排除 `node_modules`、`__pycache__`、`.git`、`.venv` 等）
3. **敏感检查**（密码/API key/内网 IP/凭据文件名）—— 默认命中即中止，可 `sensitive_action="mask"` 仅提示
4. `git add` + `commit` + `push`（分支自动识别）

## 配置（环境变量，均有默认值）

| 变量 | 默认 |
|---|---|
| `OTHER_REPO_URL` | `git@github.com:zhuobichen/Other_Projects.git` |
| `OTHER_REPO_DIR` | `E:\CodeProject\mcp-server\Other_Projects`（工作副本，不存在会自动 clone） |
| `GIT_BIN` | `git` |

## 注册（~/.claude.json）

```json
"other-projects": {
  "type": "stdio",
  "command": "cmd",
  "args": ["/c", "node", "E:/CodeProject/node_modules/tsx/dist/cli.mjs", "E:/CodeProject/mcp-server/other-projects/index.ts"],
  "cwd": "E:\\CodeProject"
}
```

依赖 tsx 与 @modelcontextprotocol/sdk（已装在 `E:/CodeProject/node_modules`），无需单独 install。
