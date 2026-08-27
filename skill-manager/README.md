# skill-manager MCP

盘点本地 Claude Code skill + 一键发布到 GitHub（`zhuobichen/zhaowen-skill` 仓库）。

## 工具

| 工具 | 功能 |
|------|------|
| `list_skills(root?)` | 盘点本地所有 skill：路径、有 SKILL.md？、已入 GitHub 仓库？、已注册 INDEX？ |
| `check_sensitive(path, pattern?)` | 检测敏感信息（密码/账号/API key/token/内网 IP/域名/.env 凭据文件） |
| `publish_skill(skill_dir, new_name?, check_sensitive?, sensitive_action?)` | 规范化命名（`ylx_用途_名称`）→ 复制到仓库 → 敏感检查/脱敏 → 更新 README → commit + push。**唯一 push 入口，显式调用才执行** |
| `get_config()` | 查看当前配置 |

## 配置（环境变量，均有默认值）

| 变量 | 说明 | 默认 |
|------|------|------|
| `SKILL_ROOT_DIRS` | 扫描的 skill 根目录（`;` 分隔） | 全局 skills + `.agents` + `.opencode` + `ClaudeRoom` + `OpenClaw` |
| `SKILL_REPO_URL` | GitHub 仓库远程地址 | `git@github.com:zhuobichen/zhaowen-skill.git` |
| `SKILL_REPO_DIR` | 仓库本地工作副本 | `E:\CodeProject\其余工程\浏览器自动化操作\zhaowen-skill` |
| `SKILL_INDEX_PATH` | 本地 INDEX.md 路径 | `C:\Users\chenlizhuo\.claude\skills\INDEX.md` |
| `SKILL_NAMESPACE` | 命名前缀 | `ylx` |

## 注册示例（`~/.claude.json` 顶层 `mcpServers`）

```json
"skill-manager": {
  "type": "stdio",
  "command": "cmd",
  "args": ["/c", "node", "E:/CodeProject/node_modules/tsx/dist/cli.mjs", "E:/CodeProject/mcp-server/skill-manager/index.ts"],
  "cwd": "E:\\CodeProject",
  "env": {
    "SKILL_REPO_DIR": "E:\\CodeProject\\其余工程\\浏览器自动化操作\\zhaowen-skill",
    "SKILL_NAMESPACE": "ylx"
  }
}
```

> 修改注册配置后需重启 Claude Code 生效。

## 设计要点

- **push 守卫**：`gitPush` 仅被 `publish_skill` 调用，服务本身无任何自动推送路径。
- **敏感检测**：默认命中即 `abort`；传 `sensitive_action='mask'` 只对**仓库副本**脱敏为 `<占位符>`，本地原文件不动。
- **命名规范**：`ylx_用途_名称`（`ylx` 为来源标记前缀），发布时同步改写副本 SKILL.md frontmatter 的 `name`。
- **失败安全**：push 失败返回"已本地提交、可手动 push"，不自动回滚。

## License

MIT
