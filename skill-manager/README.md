# skill-manager MCP

用于盘点、校验和发布本地 Skill/MCP 目录。默认只读检查；只有显式调用发布工具时才会提交或推送。

## 工具

- `list_skills`：扫描配置的 Skill 根目录，显示 `SKILL.md`、仓库和索引状态。
- `validate_skill`：检查 frontmatter、目录名一致性、本地引用和 `agents/openai.yaml`。
- `validate_mcp`：检查 MCP 的 `package.json`、入口、README、SDK 依赖、工具注册和 `tools/call` 处理器。
- `check_sensitive`：扫描密码、Token、私网地址和凭据文件名。
- `publish_skill`：敏感检查、复制、更新 Skill README 后提交并推送。
- `publish_mcp`：复制 MCP 服务、更新集合 README；支持 `dry_run=true`。
- `sync_self`：同步当前 `skill-manager` 到 MCP 集合仓库。
- `get_config`：查看当前路径和仓库配置。

## 配置

默认路径适合原开发机。迁移到其他工作区时通过环境变量覆盖：

```text
SKILL_ROOT_DIRS=C:\path\to\skills;D:\path\to\other-skills
SKILL_REPO_DIR=D:\path\to\zhaowen-skill
MCP_REPO_DIR=D:\path\to\zhaowen-mcp
SKILL_INDEX_PATH=C:\path\to\INDEX.md
```

`SKILL_ROOT_DIRS` 使用分号分隔。发布前建议先调用 `validate_skill` 和 `check_sensitive`，再使用 `publish_mcp` 的 `dry_run=true` 预览变更。

## 本地校验

```bash
npm install
npm run typecheck
npm test
npm audit
```
