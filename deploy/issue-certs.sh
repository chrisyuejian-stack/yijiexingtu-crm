#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || exit 1
[[ -f /etc/yijiexingtu/cert.env ]] || { echo '先建立权限600的cert.env，填写专用DNSPod API token的DP_Id、DP_Key和ACME_EMAIL。'; exit 1; }
: "${DP_Id:?DP_Id required}" "${DP_Key:?DP_Key required}" "${ACME_EMAIL:?ACME_EMAIL required}"
umask 077
install -d -m 0700 /etc/yijiexingtu/tls /opt/yijiexingtu/acme
if [[ ! -x /root/.acme.sh/acme.sh ]]; then
    [[ -f /opt/yijiexingtu/acme/acme.sh ]] || { echo '请先按README获取并审阅acme.sh官方脚本。'; exit 1; }
    cd /opt/yijiexingtu/acme
    bash acme.sh --install --accountemail "$ACME_EMAIL"
fi
/root/.acme.sh/acme.sh --set-default-ca --server letsencrypt
/root/.acme.sh/acme.sh --issue --dns dns_dp -d edu.yijiexingtu.com -d ops.yijiexingtu.com --keylength ec-256
/root/.acme.sh/acme.sh --install-cert --ecc -d edu.yijiexingtu.com --key-file /etc/yijiexingtu/tls/key.pem --fullchain-file /etc/yijiexingtu/tls/fullchain.pem --reloadcmd 'if systemctl is-active --quiet nginx; then nginx -t && systemctl reload nginx; fi'
chmod 0600 /etc/yijiexingtu/tls/key.pem /etc/yijiexingtu/cert.env
echo '证书已安装；acme.sh已建立自动续期任务。首次启用Nginx请按README操作。'
