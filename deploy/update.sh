#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo '请用root运行发布脚本。'; exit 1; }
[[ $# -eq 1 ]] || { echo '用法：bash deploy/update.sh /完整路径/部署包.zip'; exit 1; }
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
export NODE_OPTIONS=--max-old-space-size=768
export TZ=UTC
exec /usr/bin/node "$SCRIPT_DIR/update.mjs" update "$1"
