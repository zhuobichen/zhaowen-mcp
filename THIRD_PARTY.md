# 第三方内容

本仓库主体是自写的 MCP 服务（MIT，见根目录 [`LICENSE`](LICENSE)）。下面两个目录是**别人的项目**，
各自保留上游 `LICENSE`，版权归上游作者，**不适用根目录的 MIT**。

| 目录 | 上游 | 许可证（见目录内 LICENSE） | 本地改动 |
|---|---|---|---|
| `cloudmusic-desktop-mcp/` | [`Seraph310/cloudmusic-desktop-mcp`](https://github.com/Seraph310/cloudmusic-desktop-mcp) | MIT，Copyright (c) 2026 Seraph310 | 有：`server.py` 把写死的 webpack 模块号改成运行时解析（上游版本在网易云 3.1.41 上是坏的）。细节见目录内 `VENDOR-NOTES.md` |
| `file-manager/` | [`dcm-cmd/file-manager-skill`](https://github.com/dcm-cmd/file-manager-skill) | MIT，Copyright (c) 2026 dcm-cmd | 有：`mcp/server.js`、`SKILL.md`、`package.json` 相对上游有增补；上游的 `.gitignore`、`file-manager-skill使用手册.md` 未收录。**尚无本地改动说明**，补的时候按 cloudmusic 那份 `VENDOR-NOTES.md` 的格式写 |

其余目录（`agent-sessions`、`android-mcp`、`aram-mayhem`、`bilibili`、`code-review`、`codex-models`、
`deepseek-search`、`hot-trending`、`ima-mcp`、`image-vision`、`jd-price`、`meme-finder`、`memory-push`、
`minimax-image-mcp`、`minimax-video-mcp`、`onehub-monitor`、`other-projects`、`photo-scan`、`qqmail-mcp`、
`skill-manager`、`weather-mcp`、`xiaohongshu`）为自写，按根目录 MIT 授权。

## 规矩

- 往这里放第三方项目时：保留其 `LICENSE`、写一份 `VENDOR-NOTES.md`（上游、版本、抓取时间、本地改了什么），并在本表登记。
- 不要把第三方目录的代码改写成"看起来是本仓库原创"，也不要把它挪到根目录 MIT 的叙事里。
