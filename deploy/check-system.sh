#!/usr/bin/env bash
set -euo pipefail
RESULT=0
node --max-old-space-size=768 deploy/check-backup.mjs || RESULT=1
if ! openssl x509 -in /etc/yijiexingtu/tls/fullchain.pem -checkend 1296000 -noout; then
    echo 'ERROR certificate expires within 15 days or cannot be read'
    RESULT=1
fi
exit "$RESULT"
