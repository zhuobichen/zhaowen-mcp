#!/usr/bin/env bash
# mitmproxy CA 证书的安装 / 卸载（当前用户证书库，可随时撤销）
# 用法: bash tools/pc-ca.sh install | uninstall | status
set -u
CA="$USERPROFILE/.mitmproxy/mitmproxy-ca-cert.cer"
[ -f "$CA" ] || CA="/c/Users/Administrator/.mitmproxy/mitmproxy-ca-cert.cer"

case "${1:-status}" in
  install)
    if [ ! -f "$CA" ]; then echo "找不到 CA（先跑一次 npm run pc:capture 让它生成）：$CA"; exit 1; fi
    certutil -addstore -user Root "$(cygpath -w "$CA" 2>/dev/null || echo "$CA")" | tail -3
    echo "已安装到【当前用户】受信任根证书。用完可撤销：bash tools/pc-ca.sh uninstall"
    ;;
  uninstall)
    certutil -delstore -user Root "mitmproxy" | tail -3
    echo "已从当前用户证书库移除 mitmproxy 证书。"
    ;;
  *)
    certutil -store -user Root 2>/dev/null | grep -i -A2 mitmproxy | head -8 || echo "当前用户证书库里没有 mitmproxy 证书"
    ;;
esac
