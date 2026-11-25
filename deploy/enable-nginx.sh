#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || exit 1
cd /opt/yijiexingtu/current
for file in /etc/yijiexingtu/tls/fullchain.pem /etc/yijiexingtu/tls/key.pem /etc/yijiexingtu/ops.htpasswd; do
    [[ -s $file ]] || { echo "缺少 $file，请先完成证书或Basic Auth。"; exit 1; }
done
for file in /etc/nginx/conf.d/*.conf; do
    [[ ! -e $file || $file == /etc/nginx/conf.d/yijiexingtu.conf || $file == /etc/nginx/conf.d/default.conf ]] || { echo '发现其他站点配置，先由负责人核对，未替换Nginx主配置。'; exit 1; }
done
cp -a /etc/nginx/nginx.conf "/etc/nginx/nginx.conf.pre-yxt-$(date +%s)"
if [[ -f /etc/nginx/conf.d/default.conf ]]; then mv /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.pre-yxt; fi
install -m 0644 deploy/nginx-main.conf /etc/nginx/nginx.conf
install -m 0644 deploy/nginx.conf /etc/nginx/conf.d/yijiexingtu.conf
install -m 0644 deploy/nginx-proxy.conf /etc/nginx/yijiexingtu-proxy.conf
chown root:nginx /etc/yijiexingtu /etc/yijiexingtu/ops.htpasswd
chmod 0750 /etc/yijiexingtu
chmod 0640 /etc/yijiexingtu/ops.htpasswd
nginx -t
systemctl enable --now nginx
systemctl reload nginx
