#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo '需要 root 读取受保护的配置。'; exit 1; }
cd /opt/yijiexingtu/current
export NODE_OPTIONS=--max-old-space-size=768
export TZ=UTC
exec /usr/bin/node deploy/with-env.mjs -- "$@"
