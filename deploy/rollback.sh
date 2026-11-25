#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo '请用root运行回滚脚本。'; exit 1; }
[[ $# -eq 0 ]] || { echo '用法：bash deploy/rollback.sh'; exit 1; }
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
export NODE_OPTIONS=--max-old-space-size=768
export TZ=UTC
exec /usr/bin/node "$SCRIPT_DIR/update.mjs" rollback
