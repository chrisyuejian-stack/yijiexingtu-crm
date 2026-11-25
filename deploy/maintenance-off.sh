#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || exit 1
systemctl start yijiexingtu
curl --fail --silent --show-error --retry 40 --retry-delay 1 --retry-connrefused --max-time 5 --header 'Host: edu.yijiexingtu.com' --header 'X-Real-IP: 127.0.0.1' http://127.0.0.1:8787/login -o /dev/null
rm -f /etc/yijiexingtu/maintenance.flag
echo '本机检查通过，已解除腾讯云入口维护。'
