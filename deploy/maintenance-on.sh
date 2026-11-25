#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || exit 1
install -m 0644 /dev/null /etc/yijiexingtu/maintenance.flag
systemctl stop yijiexingtu
echo '腾讯云入口已维护503，Node已停止并checkpoint；现在可以做停写导出。'
