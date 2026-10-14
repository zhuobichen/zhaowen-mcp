@echo off
rem 启动一个「带调试端口的豆包桌面版」实例，供 image-vision 的生图后端驱动。
rem
rem 为什么要独立 user-data-dir：调试端口等于给这个进程开了个本地后门
rem （本机任何进程都能驱动它），所以**别拿日常那个豆包去开端口**。
rem 这个实例只用来生图，丢了也不影响日常对话。
rem
rem 首次使用：启动后在那个窗口里扫码登录一次（登录态存在下面这个 profile 里，之后不用再扫）。
rem
rem 端口改了的话，记得同步设 DOUBAO_CDP_URL（默认就是 9333）。

setlocal
set PORT=9333
rem profile 放在**仓库外**的工作区数据目录：它实测有 1.9 GB，放仓库里会被误提交。
rem 已经登录过，搬到别处的话登录态会丢（要重新扫码）。
set PROFILE=D:\github_project\ZhaoWen_GitHub维护\_doubao-profile
set EXE=D:\豆包\Doubao\app\Doubao.exe

if not exist "%EXE%" (
  echo [x] 找不到豆包: %EXE%
  echo     装到别处的话改这一行。
  exit /b 1
)

if not exist "%PROFILE%" mkdir "%PROFILE%"

echo [i] 启动豆包（调试端口 %PORT%，profile: %PROFILE%）
start "" "%EXE%" --remote-debugging-port=%PORT% --user-data-dir="%PROFILE%" --no-first-run

echo [i] 等它起来...
timeout /t 8 /nobreak >nul

echo [i] 探测 http://127.0.0.1:%PORT%/json/version
curl -s -m 5 "http://127.0.0.1:%PORT%/json/version" >nul 2>&1
if errorlevel 1 (
  echo [x] 调试端口没通。可能：
  echo     - 豆包启动较慢，等几秒再试
  echo     - 那个端口被占了，改上面的 PORT
  exit /b 1
)

echo [✓] 通了。下一步：在那个豆包窗口里扫码登录一次。
echo     登录后 image-vision 设 IMAGE_PROVIDER=doubao 即可用它生图。
endlocal
