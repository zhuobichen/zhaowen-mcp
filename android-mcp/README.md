# android-mcp

在本机测试安卓 App：起模拟器、装包、截图、读界面层级、按文字点击、logcat 调试、一条命令构建 APK。

设计目标是让 agent 能**自己完成「构建 → 安装 → 操作 → 看结果 → 读日志」整条闭环**，
而不是每一步都要人手动接管。

## 前置条件

本 MCP 只是 ADB 的一层封装，**不自带 SDK**，需要机器上有：

| 需要 | 用途 | 缺失后果 |
|------|------|---------|
| Android SDK Platform-Tools（`adb`） | 所有设备操作 | 全部工具不可用（`android_status` 会明确告诉你） |
| Android SDK Emulator + 一个 AVD | 模拟器 | 只能用真机；`android_start_emulator` 不可用 |
| JDK 17 | `android_build` 走 gradlew | 无法构建 APK，其余工具照常可用 |

装好后建议设一下环境变量（Windows 尤其需要，否则找不到 SDK）：

```powershell
$env:ANDROID_SDK_ROOT = "C:\Users\<你>\AppData\Local\Android\Sdk"
$env:ADB_PATH = "$env:ANDROID_SDK_ROOT\platform-tools\adb.exe"   # 可选，PATH 里已有 adb 就不必
```

查找顺序：`ADB_PATH` → `PATH` 里的 `adb` → `ANDROID_SDK_ROOT` / `ANDROID_HOME` /
`%LOCALAPPDATA%\Android\Sdk` 下的 `platform-tools\adb.exe`。

## 接入

```json
{
  "mcpServers": {
    "android": {
      "command": "node",
      "args": [
        "C:\\Users\\<你>\\node_modules\\tsx\\dist\\cli.mjs",
        "E:\\CodeProject\\mcp-server\\zhaowen-mcp\\android-mcp\\index.ts"
      ],
      "startup_timeout_sec": 60
    }
  }
}
```

或者跑 `npx tsx index.ts`。

## 工具（22 个）

### 环境与设备

| 工具 | 说明 |
|------|------|
| `android_status` | **先跑这个**。adb 是否可用、在线设备、可用 AVD 一览 |
| `android_device_info` | 型号 / Android 版本 / SDK / ABI / 分辨率 / 密度 / 电量 |
| `android_start_emulator` | 启动 AVD 并等开机完成，返回 serial |
| `android_stop_emulator` | `adb emu kill` 关机 |

### 看屏幕（两种，别混用）

| 工具 | 说明 |
|------|------|
| `android_screenshot` | 截图存 PNG，返回绝对路径 → 用图片工具打开**肉眼/多模态**看 |
| `android_dump_ui` | dump 界面层级 → 紧凑节点列表（文字/类型/坐标/可点击标记），**精确且省 token** |

选哪个：想知道「长什么样」→ 截图；想「找到那个按钮的坐标」或判断某个元素在不在 → dump_ui。
Canvas/Surface 自绘的页面（游戏、地图、部分视频页）dump 出来是空的，只能靠截图。

### 操作

| 工具 | 说明 |
|------|------|
| `android_tap` | 点坐标，或 `text="登录"` 自动定位中心点 |
| `android_swipe` | 滑动 / 翻页 / 下拉刷新 |
| `android_input_text` | 输入文字（空格自动转 `%s`） |
| `android_press_key` | 键位，支持 `back`/`home`/`enter` 等别名 |
| `android_wait_for_text` | 轮询等某段文字出现 —— 处理异步跳转比 sleep 靠谱得多 |

### 应用管理

| 工具 | 说明 |
|------|------|
| `android_build` | 跑项目自带 gradlew（默认 `assembleDebug`），返回 APK 路径 |
| `android_list_apks` | 列项目下已构建的 APK |
| `android_install` | 装 APK（默认 `-r` 覆盖，可选 `-g` 授权限 / `-d` 降级） |
| `android_launch_app` | 启动应用（默认走 launcher intent，可指定 activity） |
| `android_force_stop` | 强杀应用 |
| `android_uninstall` | 卸载（破坏性，需 `confirm=true`） |
| `android_list_packages` | 列已安装包，支持子串过滤 |
| `android_app_info` | 版本号 / 安装更新时间 / targetSdk / 已授权限数 |

### 调试

| 工具 | 说明 |
|------|------|
| `android_logcat` | 读最近日志（`-d` 非阻塞），支持 tag / 级别过滤 |
| `android_clear_logcat` | 清缓冲区（复现问题前先清） |
| `android_shell` | 直通 `adb shell` 逃生舱，上面没有的用这个兜底 |

## 典型闭环

    android_build(project_dir="E:/CodeProject/TiebaTS")
      → android_install(apk=<产物路径>)
      → android_launch_app(package=...)
      → android_wait_for_text(text="首页")      # 别 sleep 硬等
      → android_dump_ui()                        # 找按钮
      → android_tap(text="设置")
      → android_screenshot()                      # 确认长对了
      → android_logcat(min_level="error")        # 有 crash 就看这里

## 几个刻意的设计选择

- **不用 shell 拼接**。全部 `spawn` + 参数数组。`input text "a;b"` 这种拼法在设备 shell 里
  `;` `&` `|` 全有效，等于开了命令注入的口子。
- **截图必须走 `exec-out`**。`adb shell screencap` 会被换行符污染成非法 PNG，所以单独走
  二进制通道并校验 PNG 魔数 —— 拿到脏数据时直接报错，而不是把坏图存成文件骗过调用方。
- **多设备不猜**。检测到多台在线设备时**报错并列出 serial**，要求显式指定。
  猜错 = 把测试操作打到别人的手机上，这是危险的静默失败。
- **UI dump 要过滤**。一个普通页面原始 XML 三千多行、几万 token，且真正有用的只有
  「哪些能点、上面写了什么」。这里只保留有文字 / 有 content-desc / 可点击 / 被勾选的节点，
  实测砍掉 70~80%，并给每个节点算好中心点坐标。
- **按文字点击会回溯可点祖先**。安卓里按钮文字常在不可点的 `TextView` 上，真正可点的是
  包着它的 `Button`。所以 `text=` 命中不可点节点时，会自动找包含它的最小可点控件。
- **缺 adb 不崩服务**。启动时没有 adb 也照样起来，`android_status` 返回可读的安装指引。
  （不少 MCP 启动即抛，用户只看到 "server failed to start"。）

## 已知限制

- `android_input_text` 走的是 ADB 的 ASCII 注入，**中文输不进去**。要输中文得走
  ADBKeyboard 之类的输入法 APK，或 `android_shell` 自己处理。
- `uiautomator dump` 拿不到 Canvas / Surface / WebView 内部结构，这些页面只能靠截图
  + 坐标点击。
- 模拟器冷启动慢，`android_start_emulator` 默认给 180s；超时后会如实告诉你
  「已上线但 boot 未完成」而不是假装成功。

## 自测

    npm install
    npm test          # 纯逻辑 + stdio 协议，都不需要设备
    npm run typecheck
