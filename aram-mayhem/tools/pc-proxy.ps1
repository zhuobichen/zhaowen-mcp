# 开关 Windows 系统代理（只改 HKCU，当前用户；关闭时还原成开启前的值）
# 用法: powershell -File tools/pc-proxy.ps1 on|off|status
param([string]$action = "status")
$key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
$backup = Join-Path $env:TEMP "mayhem-proxy-backup.txt"

switch ($action) {
  "on" {
    $cur = Get-ItemProperty -Path $key
    if (-not (Test-Path $backup)) {
      $line = "" + $cur.ProxyEnable + "|" + $cur.ProxyServer + "|" + $cur.ProxyOverride
      Set-Content -Path $backup -Value $line -Encoding UTF8
      Write-Host "[OK] 已备份原代理设置到 $backup"
    }
    Set-ItemProperty -Path $key -Name ProxyServer -Value "127.0.0.1:8080"
    Set-ItemProperty -Path $key -Name ProxyEnable -Value 1
    Set-ItemProperty -Path $key -Name ProxyOverride -Value "<-loopback>"
    Write-Host "[OK] 系统代理已指向 127.0.0.1:8080"
  }
  "off" {
    if (Test-Path $backup) {
      $parts = (Get-Content $backup -Raw).Trim() -split "\|"
      Set-ItemProperty -Path $key -Name ProxyEnable -Value ([int]$parts[0])
      Set-ItemProperty -Path $key -Name ProxyServer -Value $parts[1]
      Set-ItemProperty -Path $key -Name ProxyOverride -Value $parts[2]
      Remove-Item $backup
      Write-Host "[OK] 已还原系统代理设置"
    } else {
      Set-ItemProperty -Path $key -Name ProxyEnable -Value 0
      Write-Host "[OK] 没有备份，已直接把代理关掉"
    }
  }
  default {
    $cur = Get-ItemProperty -Path $key
    Write-Host ("ProxyEnable=" + $cur.ProxyEnable + "  ProxyServer=" + $cur.ProxyServer)
  }
}
