# android-mcp

在本机测试安卓 App：起模拟器、装包、截图、读界面层级、按文字点击、**输入中文**、logcat 调试、一条命令构建 APK。改完代码还能一键跑设备冒烟测试。

设计目标是让 agent 能**自己完成「构建 → 安装 → 操作 → 看结果 → 读日志」整条闭环**，而不是每一步都要人手动接管。

## 前置条件

本 MCP 只是 ADB 的一层封装，**不自带 SDK**，需要机器上有：

| 需要 | 用途 | 缺失后果 |
|------|------|---------|
| Android SDK Platform-Tools（`adb`） | 所有设备操作 | 全部工具不可用（`android_status` 会明确告诉你） |
| Android SDK Emulator + 一个 AVD | 模拟器 | 只能用真机；`android_start_emulator` 不可用 |
| JDK 17 | `android_build` 走 gradlew | 无法构建 APK，其余工具照常可用 |
| **设备侧输入法（ADBKeyboard）** | 输入非 ASCII（中文） | 中文退化成"宿主机剪贴板 + 粘贴"，**只对模拟器有效** |

前三个装好后建议设环境变量（Windows 尤其需要）：

```powershell
$env:ANDROID_SDK_ROOT = "C:\Users\<你>\AppData\Local\Android\Sdk"
$env:ADB_PATH = "$env:ANDROID_SDK_ROOT\platform-tools\adb.exe"   # 可选，PATH 里已有 adb 就不必
```

查找顺序：`ADB_PATH` → `PATH` 里的 `adb` → `ANDROID_SDK_ROOT` / `ANDROID_HOME` /
`%LOCALAPPDATA%\Android\Sdk` 下的 `platform-tools\adb.exe`。

第四个（中文输入法）用一条命令装：

```bash
node scripts/setup-input-ime.mjs --serial <serial>
```

它做三件事：下载 **ADBKeyboard v2.5-dev**（带重试，本机实测 GitHub 约一半请求会超时）→ 校验 sha256
→ 装到设备并确认输入法已注册。脚本把包缓存在 `$ANDROID_SDK_ROOT/../adb-mcp-cache/`。

**为什么必须 v2.5-dev**：v2.4-dev 在 Android 16（API 36）上不可用，v2.5-dev 这个 pre-release 的存在理由就是修它。
**为什么 APK 不进仓库**：它的许可是 GPL-2.0，把二进制放进仓库会牵扯 GPL 的分发义务 —— 所以按需下载 + 校验值钉死版本。

## 接入

```json
{
  "mcpServers": {
    "android": {
      "command": "cmd",
      "args": [
        "/c", "node",
        "<仓库路径>/android-mcp/node_modules/tsx/dist/cli.mjs",
        "<仓库路径>/android-mcp/index.ts"
      ],
      "env": {
        "ANDROID_SDK_ROOT": "D:\\Android\\Sdk",
        "ANDROID_AVD_HOME": "D:\\Android\\avd"
      },
      "startup_timeout_sec": 60
    }
  }
}
```

或者直接 `npx tsx index.ts`。

> **改完代码要重连 MCP**：工具清单是连接那一刻定下的 —— 新增/改名工具必须重连（改实现不用）。

## 工具（28 个）

### 环境与设备

| 工具 | 说明 |
|------|------|
| `android_status` | **先跑这个**。adb / 在线设备 / AVD，**外加当前生效的禁区规则** |
| `android_device_info` | 型号 / Android 版本 / SDK / ABI / 分辨率 / 密度 / 电量 |
| `android_foreground` | 当前前台是哪个包、哪个 activity。「我现在到底在哪一页」用它 |
| `android_prepare` | 关三个动效缩放 + 亮屏解锁。**开工前跑一次**，后面能省掉一堆 sleep |
| `android_start_emulator` | 启动 AVD 并等开机完成，返回 serial |
| `android_stop_emulator` | `adb emu kill` 关机 |

### 看屏幕

| 工具 | 说明 |
|------|------|
| `android_screenshot` | 截图存 PNG 返回路径；传 `inline=true` 直接把图作为图片内容返回（省一轮） |
| `android_dump_ui` | dump 界面层级成紧凑节点列表；`format="json"` 给机器消费 |
| `android_wait_idle` | **等界面稳定**（连续两次 dump 一致才返回）。用它替掉 `sleep` |

### 操作

| 工具 | 说明 |
|------|------|
| `android_tap` | 点坐标，或 `text="登录"` 自动定位中心点（命中多个会列出让你消歧） |
| `android_long_press` | 长按，同样支持 `text=` |
| `android_double_tap` | 双击（AOSP 无 doubletap 子命令，实现是连点两次） |
| `android_swipe` | 滑动 / 翻页 / 下拉刷新 |
| `android_drag` | 拖拽（按住再移动，走 `input draganddrop`） |
| `android_input_text` | 输入文字，**中文可用**（见下节）；`clear=true` 先清空 |
| `android_press_key` | 键位别名（`back`/`home`/…）、`KEYCODE_XXX`，**或直接写数字 keycode** |
| `android_wait_for_text` | 轮询等某段文字出现；`gone=true` 则等它消失 |

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

## 中文输入是怎么打进去的

`adb shell input text` 对非 ASCII 会直接抛 `NullPointerException`（Android 16 实测），汉字一个都进不去。
所以含非 ASCII 的文字走**设备侧的广播式输入法**：

1. 记下当前默认输入法 → 切到 `com.android.adbkeyboard/.AdbIME`；
2. **把输入框重新点一次**（见下面的坑）；
3. `am broadcast -a ADB_INPUT_B64 --es msg <base64(utf8)>`；
4. 读回输入框内容校验；
5. 把输入法切回原来那个。

`android_input_text` 的返回里会写明**这次实际走了哪条路**（`input text` / ADBKeyboard / 剪贴板），因为三者适用范围完全不同：

- `input text`：纯 ASCII，最快；
- ADBKeyboard：任意 Unicode，**真机也能用**；
- 剪贴板 + `KEYCODE_PASTE`：设备上没装上面那个时的回退，**只对模拟器成立**（真机没有剪贴板互通），返回文案里会标明。

**实测踩到的坑**：`ime set` 会让当前输入框丢掉输入连接 —— 切完输入法直接广播，文字哪儿也不去。
必须先把输入框重新点一次再广播；而且广播返回 `result=0` 只说明"发到了"，**不代表字进去了**，所以这里一律以读回校验为准。

## 禁区（guardrails）

把「哪些地方不许碰」做成配置，在工具层强制检查 —— 不靠模型记性，换会话也生效。

- 随服务走的 `guardrails.json`（可提交，放通用规则）
- 用户级 `~/.claude/android-guardrails.json`（放不想上库的规则，两条叠加）
- 任一份里写 `"disabled": ["规则id"]` 可关掉某条

规则支持的字段：`denyPackages` / `denyActivities` / `denyUrlPatterns` / `denyTapText`（**精确**匹配，
避免误伤「存储空间」这类复合词）/ `denyTapTextContains` / `denyTapTextInPackages`（限定这些规则只在某些 app 里生效）/
`denyShellPatterns` / `denyForegroundPatterns`。

**在哪些地方拦**：

| 动作 | 检查 |
|------|------|
| `tap` / `long_press` / `double_tap` | 要点的文字 + 当前前台包名 |
| `launch_app` | 目标包名 / activity 串 |
| `shell` | 命令原文 |
| `input_text` | 当前前台 |
| `dump_ui` / `screenshot` / `wait_idle` / `wait_for_text` | 当前前台（"看"也要拦，否则人已经点进去了，我还在把内容读出来） |

命中就**拒绝执行**并报出是哪条规则、为什么。**前台识别不出来时按保守处理**（当作在禁区内）——
这是隐私边界，宁可多拦一次让人来解释。

内置一条默认规则 `qq-qzone`：QQ / 微信里的「空间」入口与 QZone 地址一律不碰。

**诚实的边界**：按坐标点、以及在 app 内用 WebView 打开的页面，靠文字/包名不一定认得出来。
配置能拦住"点进去"和"已知的地址"，但**真正的保证是"从不点进去"**。

## 典型闭环

    android_status()                                  # 环境 + 当前禁区规则
    android_prepare()                                 # 关动效，省掉后面一堆 sleep
    android_build(project_dir="D:/proj/TiebaTS")
      → android_install(apk=<产物路径>)
      → android_launch_app(package=...)
      → android_wait_idle()                           # 别 sleep 硬等
      → android_dump_ui()                             # 找按钮
      → android_tap(text="设置")
      → android_screenshot(inline=true)               # 确认长对了
      → android_logcat(min_level="error")             # 有 crash 就看这里

## 几个刻意的设计选择

- **不用 shell 拼接**。全部 `spawn` + 参数数组。`input text "a;b"` 这种拼法在设备 shell 里
  `;` `&` `|` 全有效，等于开了命令注入的口子。
- **截图必须走 `exec-out`**。`adb shell screencap` 会被换行符污染成非法 PNG，所以单独走
  二进制通道并校验 PNG 魔数 —— 拿到脏数据时直接报错，而不是把坏图存成文件骗过调用方。
- **多设备不猜**。检测到多台在线设备时报错并列出 serial，要求显式指定。
  猜错 = 把测试操作打到别人的手机上，这是危险的静默失败。
- **UI dump 要过滤**。原始 XML 三千多行、几万 token，真正有用的只有「哪些能点、上面写了什么」，
  这里砍掉 70~80% 并给每个节点算好中心点坐标。
- **禁区写在配置里**，而不是写进 prompt。规矩要能被别人审计、能改、能在换会话后依然生效。
- **输入分行，并把"走了哪条路"写进返回**。三条路的前提和副作用都不一样，不说清楚调用方会误判。
- **缺 adb 不崩服务**。启动时没有 adb 也照样起来，`android_status` 返回可读的安装指引。

## 已知限制

- **中文依赖设备侧的 ADBKeyboard**。没装也不会报错，会退到剪贴板路径并明确标注"只对模拟器有效"。
- `uiautomator dump` 拿不到 Canvas / Surface / WebView 内部结构，这些页面只能靠截图 + 坐标点击。
- 模拟器冷启动慢，`android_start_emulator` 默认给 180s；超时会如实告诉你当前 adb 设备清单，
  而不是假装成功。（判据是"出现一台**新**设备"，所以本机已有设备在线时也能正确工作。）
- `android_drag` 依赖设备支持 `input draganddrop`，不支持时会明确告诉你，可退用 `android_swipe`。

## 自测

```bash
npm install
npm test              # 纯逻辑 + stdio 协议，都不需要设备
npm run typecheck
npm run setup:ime     # 一次性：给设备装中文输入法（需要设备在线）
npm run smoke         # 设备冒烟：把工具面在真机上挨个跑一遍（需要设备在线）
```

`npm test` 与 `npm run smoke` 分工明确：前者不碰设备，新机器/CI 上都能跑；后者专门回答
"改完之后真机还灵不灵"，包括中文输入这种只有真机能验的项。
