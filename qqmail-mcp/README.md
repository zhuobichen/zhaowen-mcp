# qqmail-mcp

只读查询**自己的 QQ 邮箱**（`mail.qq.com`）：列文件夹、列最近邮件、按关键词搜索、读正文与附件清单。

**不发信、不删信、不改已读、不移动。** 这不是"约定不做"，而是代码里没有这些能力——见下面「只读是怎么保证的」。

> 注意与 [`agently-mail`](https://agent.qq.com) 的区别：那个操作的是 **agent.qq.com 的 Agent Mail**，本服务操作的是你**日常那个 QQ 邮箱**。

## 工具

| 工具 | 作用 |
| --- | --- |
| `check_status` | 检查配置与连通性、能否登录、默认文件夹有多少封。排障先跑这个 |
| `list_folders` | 列出所有文件夹（含已发送、草稿等），用于确定 `folder` 参数 |
| `list_recent` | 列某文件夹最近 N 封（主题/发件人/时间/未读/有无附件），只取头部 |
| `search` | 按关键词搜（多词空格分隔，全部命中）。可加日期范围、只看未读 |
| `read_message` | 读一封的正文（纯文本）与附件清单。需要 `uid` + `folder` |

## 只读是怎么保证的

三道，且都有测试盯着（`selftest.mjs` 的静态审计部分）：

1. **每个邮箱都用 `readOnly: true` 打开**——即便调用方写错也不会改动服务器上的邮件；
2. **不实现任何变动接口**：没有 SMTP、没有删除/标已读/移动/追加。测试会扫源码，
   一旦出现 `messageDelete` / `messageFlagsAdd` / `append` / `mailboxCreate` / `expunge` / `nodemailer`
   之类的方法调用就判失败；
3. **授权码不打进任何输出**：所有返回文本过一层 `redact()`，测试断言授权码不出现在任何工具结果里。

## 为什么搜索不用 IMAP 的 `SEARCH`

IMAP 的文本搜索对非 ASCII 要 `CHARSET UTF-8`，**QQ 邮箱支持得不好——中文关键词经常安静地返回空**（不报错，就是搜不到）。

所以 `search` 改成：**取最近 N 封的头部，在本地做子串匹配**。中文没问题，代价是要多拉一点数据。
`scan_limit` 默认 300，可调（上限 2000）。**它扫的不是全邮箱**，这一点会在结果里明确写出来，不会让你误以为"搜不到就是没有"。

## 配置

### 1. 拿授权码（只能你自己做）

QQ 邮箱网页版 → 设置 → 账户 → 找到「IMAP/SMTP服务」→ **开启**（需短信验证）→ **生成授权码**（16 位）。

⚠️ 用**授权码**，不是你 QQ 登录密码。拿到它等于拿到邮箱的**完全访问权**——所以它绝不能进 git、不能贴给别人。

### 2. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `QQMAIL_USER` | 无（必填） | 你的 QQ 邮箱地址 |
| `QQMAIL_AUTH_CODE` | 无（必填） | 上一步生成的 16 位授权码 |
| `QQMAIL_IMAP_HOST` | `imap.qq.com` | 服务器 |
| `QQMAIL_IMAP_PORT` | `993` | 端口 |
| `QQMAIL_IMAP_SECURE` | `true` | 是否 TLS |
| `QQMAIL_FOLDER` | `INBOX` | 默认文件夹 |
| `QQMAIL_SCAN_LIMIT` | `300` | 搜索时扫最近多少封 |
| `QQMAIL_MAX_RESULTS` | `50` | 单次返回条数上限 |
| `QQMAIL_MAX_BODY_CHARS` | `4000` | 正文截断长度 |
| `QQMAIL_TIMEOUT_MS` | `20000` | 连接/套接字超时 |

## 开发

```bash
npm install
npm run typecheck
npm test          # 静态只读审计 + 协议层；有凭据时自动加跑真实邮箱联调
```

不带凭据时 `npm test` 会跑前两项并 **跳过** 联调（打印 `[SKIP]`，不是静默通过）。

## 注册示例（`~/.claude.json` 顶层 `mcpServers`）

```json
"qqmail-mcp": {
  "type": "stdio",
  "command": "cmd",
  "args": ["/c", "node",
    "D:/github_project/ZhaoWen_GitHub维护/qqmail-mcp/node_modules/tsx/dist/cli.mjs",
    "D:/github_project/ZhaoWen_GitHub维护/qqmail-mcp/index.ts"],
  "env": {
    "QQMAIL_USER": "你的QQ号@qq.com",
    "QQMAIL_AUTH_CODE": "16位授权码"
  }
}
```

改完**要重连**（重启 Claude Code 或重开会话）——工具清单在连接那一刻定下。

## 已知限制

- **搜索范围是最近 N 封，不是全邮箱**（见上）。要搜很久以前的，把 `scan_limit` 调大，或指定具体文件夹。
- **不解析 HTML 正文**。只有 HTML 没有纯文本的邮件，正文位置会明确写「这封信没有纯文本正文」，不会把 HTML 标签糊出来。
- **不下载附件**，只列文件名/大小/类型。
- **每次工具调用新建一条 IMAP 连接**。偶尔用一次的场景下这是对的取舍（避免连接池的状态泄漏），代价是每次多 1~2 秒握手。
- **不写本地缓存**：每封都现取。邮箱是活的，缓存会让"刚到的信看不到"。
