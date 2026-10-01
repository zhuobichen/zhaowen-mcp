# meme-finder

按主题词找表情包合集：搜 GitHub 上的图集仓库、在巨型仓库里按目录名匹配、把找到的位置登记到本地清单，并能把图下载下来。

依托 **`gh` CLI**（本机已登录 `zhuobichen`），不需要自己管 token。

## 工具

| 工具 | 作用 |
| --- | --- |
| `search_packs` | 按主题词找合集。先搜裸关键词，再用「表情包/memes/sticker/BQB」补充；同时扫几个巨型图集仓库的目录名。只返回位置，不下图 |
| `list_pack` | 列出某仓库（或子目录）里的图片，返回**可直接用的链接** |
| `save_pack` | 把找到的合集登记到本地清单（路径/标题/备注/示例链接） |
| `list_saved` | 列出/搜索已登记的合集 |
| `remove_saved` | 从清单移除一条 |
| `fetch_pack` | 把图下载到本地目录，如实报告成功/失败张数 |

## 两条重要实现约定

**1. 图片链接一律改写成 jsdelivr。**

`api.github.com` 返回的 `download_url` 全指向 `raw.githubusercontent.com`，而该域名在本机**时通时不通**（两次实测结论相反：一次 20 秒超时 0 字节，一次 200 正常）。所以默认改写为：

```
https://cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/{path}
```

无需认证、有 CDN、对中文/emoji 路径做 URL 编码后正常。备用：`https://ghfast.top/<原 raw url>`。

**2. 搜索必须先搜裸关键词。**

GitHub 的仓库搜索对多个词是 **AND** 关系。实测「蓝色大肥鱼」给 10 个结果，而「蓝色大肥鱼 表情包」只给 1 个。所以后缀只作为补充合并，不让它决定结果集。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `GH_PATH` | `C:\Program Files\GitHub CLI\gh.exe`（不存在则用 PATH 里的 `gh`） | gh 可执行文件 |
| `MEME_FINDER_HOME` | `~/.meme-finder` | 清单与下载的根目录 |
| `MEME_FINDER_DOWNLOAD_DIR` | `<HOME>/downloads` | 默认下载目录 |
| `MEME_FINDER_GH_TIMEOUT_MS` | `60000` | 单次 gh 调用超时 |
| `MEME_FINDER_MAX_IMAGES` | `200` | 单次返回图片数上限 |

登记簿落在 `<MEME_FINDER_HOME>/packs.json`。

## 开发

```bash
npm install
npm run typecheck
npm test          # selftest.mjs：真的把服务拉起来走 stdio JSON-RPC 调工具
```

`selftest.mjs` 会起一个临时 `MEME_FINDER_HOME`，不污染真实清单。

## 注册示例（`~/.claude.json` 顶层 `mcpServers`）

```json
"meme-finder": {
  "type": "stdio",
  "command": "cmd",
  "args": ["/c", "node",
    "D:/github_project/ZhaoWen_GitHub维护/meme-finder/node_modules/tsx/dist/cli.mjs",
    "D:/github_project/ZhaoWen_GitHub维护/meme-finder/index.ts"],
  "env": {}
}
```

改完**要重连**（重启 Claude Code 或重开会话）——工具清单在连接那一刻定下，旧会话里还留着旧清单。

## 已知限制

- 只覆盖 GitHub。中文社区（微博/小红书/贴吧）**没有现成通路拿到图片直链**，接进来要另写且涉及各家风控。
- `search_packs` 的巨型仓库目录匹配只认**目录名里出现该词**。目录名是英文或拼音时会漏（例如「蓝色大肥鱼」匹配不到 `blue-fish-archive` 里的英文目录）——这时要靠仓库搜索那条路。
- GitHub 搜索有配额（本机实测 search 30 次/分钟、core 5000 次/小时）。`search_packs` 一次会发 5 个查询。
- 索引类仓库（如 `deepseek-chan-meme-pack`）本身只有少量预览图，真正的图热链在外部图床（Supabase 等）。这类仓库 `list_pack` 只能列出预览图，工具不会去追外部图床。
