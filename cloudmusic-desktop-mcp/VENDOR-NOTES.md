# 来源与本地改动说明

这是 **vendored 的第三方项目**，不是我们写的。放在这里是为了有一份可维护的副本。

| 项 | 值 |
|---|---|
| 上游 | https://github.com/Seraph310/cloudmusic-desktop-mcp |
| 抓取时间 | 2026-10-17 |
| 上游版本 | v0.2.0（`pyproject.toml` 的 `version`），`git clone --depth 1` |
| 许可 | MIT（见 `LICENSE`） |
| 本机客户端 | 网易云 `3.1.41.205529`（`D:\网易云\CloudMusic\cloudmusic.exe`） |

## 它做什么

让 AI 控制**官方桌面客户端**：搜索、点播、读/改播放队列、切播放模式、调音量、桌面歌词。
播放交给客户端自己，不另起播放进程。

## 原理（读 `server.py` 得来）

客户端是 Electron。启动时加调试端口：

```
cloudmusic.exe --remote-debugging-address=127.0.0.1 --remote-debugging-port=9223
```

然后 CDP 连上去，找 **URL 以 `orpheus://` 开头的那个 page**，**劫持客户端自己的 webpack
`require`**（塞一个假模块把 `require` 捞到 `window.__gpt_cm_require__`），再用它调用客户端
自己的内部模块：搜索、`getStore()` 读状态、`getDispatch()` 派发内部 action。
单次点播走 `orpheus://<base64>` 协议。播放/音量/歌词另走 `SendInput` 全局热键。

**全程不读 cookie / 账号 / 凭据** —— 借的是已登录客户端进程自己的身份。

## 本地改动：store 模块号改成运行时解析

**上游原版在本机客户端上是坏的。** 它写死了 webpack 模块号：

```python
__gpt_cm_require__(12).a.getStore()      # 3.1.24 上 store 是 12
__gpt_cm_require__(14).V(params)         # 3.1.24 上搜索是 14
```

而客户端升级会**重排模块号**：3.1.41 上 store 变成了 **8**。失败方式很坏 —— 不是报"版本
不兼容"，而是每个有状态工具都甩 `TypeError: ... .a.getStore is not a function`
（`queue_control_ready` 却仍然是 `true`，容易误判成通了）。

**改法**：拆出 `_cdp_send()`（原样发送），新增 `_resolve_module_placeholders()` ——
**运行时扫模块，找那个同时暴露 `getStore()` 和 `getDispatch()` 的**，把表达式里的
`__gpt_cm_require__(12)` 替换掉。一处改动覆盖全部 11 个调用点，而且**下次客户端升级不用再改**。

调用点本身一个字没动，仍然是 `__gpt_cm_require__(12)`（占位符）。

## 实测（2026-10-17，客户端 3.1.41.205529）

| 能力 | 结果 |
|---|---|
| `get_netease_status` | `queue_control_ready: true`；自解析出 store 模块 = 8 |
| `get_netease_queue` | ✅ 读到当前曲、播放模式、音量、621 首队列 |
| `set_netease_volume` | ✅ 写路径（`getDispatch`）通 |
| `search_music` | ✅ 有结果（走的是 HTTPS 兜底，见下） |
| 改队列 / 切播放模式 / 桌面歌词 | ⚠️ **未实测** —— 会真实改变播放状态，没动 |

## 已知未解决

1. **客户端内搜索函数没定位到。** 上游用的模块 14 在 3.1.41 上变成了模块 15，但 15 是
   **请求工厂层**（370+ 个导出，每个是一个预绑定 url 的请求函数，`V` 只是其一），盲扫会撞
   CDP 的 20 秒 websocket 超时。目前搜索走匿名 HTTPS 兜底
   `music.163.com/api/search/get/web` —— 能用，但**只能搜到匿名可见的结果**
   （实测搜「晴天」回来的全是翻唱，没有原版）。要彻底修得逐批扫模块 15 的导出，
   找那个返回 `{result:{songs}}` 的。
2. **使用上很别扭**：必须带调试端口启动客户端，否则 CDP 那半边全废。而
   `launch_netease_music` 拒绝杀已运行的进程 —— 所以每次得**先手动关掉**再让它启。
3. 本改动**未提交上游**。作者若更新客户端版本也会踩同一个坑，`_resolve_module_placeholders`
   这个思路可以提 PR。
