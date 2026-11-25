#!/bin/bash
set -euo pipefail
umask 077
cd "$(dirname "$0")"
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
    echo '这台Mac还没有Node.js。请先安装Node.js 24 LTS，再双击本文件。'
    read -r -p '按回车关闭。' _
    exit 1
fi
read -r -p '数据库名称（直接回车用 yijiexingtu-crm-prod）：' DB_NAME
DB_NAME=${DB_NAME:-yijiexingtu-crm-prod}
OUTPUT_FILE="$PWD/d1-$(date +%Y%m%d-%H%M%S).sql"
echo '接下来打开Cloudflare官方登录；请在浏览器确认自己的账号。'
npx --yes wrangler@4.50.0 login
npx --yes wrangler@4.50.0 d1 export "$DB_NAME" --remote --output "$OUTPUT_FILE"
chmod 600 "$OUTPUT_FILE"
echo "导出完成：$OUTPUT_FILE"
echo '此文件包含机构数据，请只上传到迁移服务器的受保护目录，不发到聊天或公开网盘。'
read -r -p '按回车关闭。' _
