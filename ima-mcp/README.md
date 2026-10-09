# ima MCP Server

把腾讯 [ima](https://ima.qq.com) 的知识库和笔记接进 MCP，基于**官方 OpenAPI**，不走 Cookie、不逆向客户端。

接口规格来自官方 skill 包 `ima-skills-1.1.10`（`knowledge-base/references/api.md` + `notes/references/api.md`），
另外通过服务端路由探测 + 参数校验报错反推，额外挖出 5 个**官方文档未公开**的接口（见下方「未公开接口」章节）。

## 凭证

到 [ima.qq.com/agent-interface](https://ima.qq.com/agent-interface) 申请 Client ID + API Key，然后任选一种方式配置：

```bash
# 1. 环境变量
export IMA_CLIENT_ID=xxx
export IMA_API_KEY=xxx

# 2. 本目录 .env（复制 .env.example）

# 3. 官方约定的文件位置
~/.config/ima/client_id
~/.config/ima/api_key
```

读取优先级：环境变量 → 本服务目录 `.env` → 仓库根 `.env` → `~/.config/ima/`。

## 启动

在本仓库根目录（依赖装在根 `node_modules`）：

```bash
npx tsx ima-mcp/index.ts
```

自检（验握手 + 工具清单 + 一次只读实调，不改动任何 ima 数据）：

```bash
npm test
```

## 注册到 MCP 客户端

```json
{
  "mcpServers": {
    "ima": {
      "command": "npx",
      "args": ["tsx", "ima-mcp/index.ts"],
      "cwd": "<本仓库根目录>"
    }
  }
}
```

## 工具（22 个）

### 知识库 `/openapi/wiki/v1`

| 工具 | 底层接口 | 说明 |
| --- | --- | --- |
| `ima_search_knowledge_bases` | `search_knowledge_base` | 搜知识库列表 |
| `ima_list_addable_knowledge_bases` | `get_addable_knowledge_base_list` | 列出可写入的知识库 |
| `ima_get_knowledge_base` | `get_knowledge_base` | 知识库信息 + 推荐问题 |
| `ima_list_knowledge` | `get_knowledge_list` | 浏览文件夹（逐级下钻） |
| `ima_search_knowledge` | `search_knowledge` | 库内搜索，返回高亮片段 |
| `ima_check_repeated_names` | `check_repeated_names` | 上传前查重 |
| `ima_import_urls` | `import_urls` | 导入网页 / 公众号文章 |
| `ima_upload_file` | `create_media` + COS PUT + `add_knowledge` | 本地文件一步入库 |
| `ima_add_knowledge` | `add_knowledge` | 加入网页 / 笔记 / AI 会话 |
| `ima_get_media_info` | `get_media_info` | 取原文链接或笔记 ID |
| `ima_read_media` | `get_media_info` + 抓取 / `get_doc_content` | 直接读正文 |

### 笔记 `/openapi/note/v1`

| 工具 | 底层接口 |
| --- | --- |
| `ima_list_notebooks` | `list_notebook` |
| `ima_list_notes` | `list_note` |
| `ima_search_notes` | `search_note` |
| `ima_get_note_content` | `get_doc_content` |
| `ima_create_note` | `import_doc` |
| `ima_append_note` | `append_doc` |

### 未公开接口（探测得出）

| 工具 | 底层接口 | 说明 |
| --- | --- | --- |
| `ima_create_knowledge_base` | `wiki/v1/create_knowledge_base` | 新建知识库 |
| `ima_create_folder` | `wiki/v1/create_folder` | 知识库内新建文件夹 |
| `ima_rename_knowledge` | `wiki/v1/rename_knowledge` | 重命名条目 / 文件夹 |
| `ima_move_knowledge` | `wiki/v1/move_knowledge` | 移动条目（⚠️ 见下方限制） |
| `ima_update_note` | `note/v1/update_note` | 按块编辑笔记（⚠️ 见下方限制） |

## 未公开接口的坑（实测）

这几个接口不在官方文档里，行为只能靠实调确认，踩过的坑记录在这里：

- **`wiki` 用 snake_case，`note` 用 camelCase。** 同一套风格混用会被服务端**静默忽略**（不报错，就是不生效），极难排查。
- **`rename_knowledge` 的参数是 `media_id`，不是 `knowledge_id`。** 传错会得到 `220001`，而不是「找不到条目」。
- **`move_knowledge` 的 `media_ids` 是 repeated string**，不是「数组套对象」。
- **`move_knowledge` 是个空操作桩**：同库换文件夹、跨库移动、移进文件夹，全部返回 `code=0` 但 `move_results:{}`，条目原地不动。工具描述里已标注不要依赖它做归档。
- **`update_note` 写配额独立且极低**：稳定返回 `code=200001`（频率超限），而同服务的 `append_note` 完全正常 —— 说明是该新接口自身的配额限制。`APPEND / DELETE / EDIT` 三个 action 已确认存在（反序列化器会拒绝其它值），但具体字段组合仍被限流挡住，需要用时先小步试。

> 这几个接口随时可能变更或下线。`move_knowledge` 的工具描述里带了 `effect_verified:false` 标注，方便调用方判断可信度。

### 删除 / 回收站：确认不存在

**OpenAPI 侧没有任何删除能力**，已系统性探测确认：

- 37 个删除类候选路由全部返回 404，覆盖 `delete_` / `remove_` / `destroy_` / `discard_` / `clear_` / `trash_` / `recycle_` / `restore_` / `move_to_trash` 等动词变体，以及 `delete_note` / `delete_doc` / `delete_media` / `batch_delete_knowledge` 等跨实体与批量命名。
- 官方文档里删除只以**错误码**形式出现（`100006 笔记已删除`、`210006 NOTE_IS_DELETE`、`210012 USER_IS_DELETE`），没有任何删除或移动接口的定义。
- 这与 `move_knowledge` 是空操作桩是一致的：ima 只放开写入，不开放破坏性操作。

结论：**MCP 写入的内容无法通过 API 删掉**，误建的知识库/条目只能在 ima 客户端手动清理。反过来说，MCP 也不会误删你的库内容。

## 关键约束

- **没有问答接口。** 官方 OpenAPI 只覆盖知识库/笔记的**查询与写入**（无删除），**不提供 RAG 问答**。想让 AI「问 ima 问题」只能自己在 MCP 外面拼检索流程。
- 根目录的 `folder_id` 等于 `knowledge_base_id`；`import_urls` 的 `folder_id` 必填，不传时工具会自动用 `knowledge_base_id`兜底。
- 上传大小限制：Excel/TXT/Xmind/MD/HTML 10MB，图片 30MB，EPUB 50MB，PDF/Word/PPT/音频 200MB。超限在本地就拦掉，不发请求。
- 视频链接（B站/YouTube）不支持通过 API 入库，只能在 ima 桌面端手动添加。
- 频控错误码（110021/ 20002）和下游网络错误（110010 / 210003）自动重试 2 次。

## 类型检查

```bash
npx tsc -p ima-mcp/tsconfig.json
```

## License

MIT
