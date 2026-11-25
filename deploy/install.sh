#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo '请在腾讯云网页终端使用 root 运行安装脚本。'; exit 1; }
source /etc/os-release
case "${ID:-}" in tencentos|tencent|tlinux) ;; *) echo '仅支持方案确认的 TencentOS Server 3，请勿在其他系统直接执行。'; exit 1;; esac
[[ ${VERSION_ID:-} == 3* ]] || { echo '需要 TencentOS 3。'; exit 1; }
SOURCE_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if [[ -e /opt/yijiexingtu/current || -L /opt/yijiexingtu/current ]]; then
    echo '检测到已安装版本，请使用 deploy/update.sh，不能用初次安装脚本绕过快照和迁移。'
    exit 1
fi
export NODE_OPTIONS=--max-old-space-size=768
dnf install -y curl ca-certificates tar gzip unzip git nginx firewalld httpd-tools openssl policycoreutils-python-utils cronie
dnf module disable -y nodejs || true
curl --fail --proto '=https' --tlsv1.2 -o /etc/pki/rpm-gpg/NODESOURCE-GPG-SIGNING-KEY-EL https://rpm.nodesource.com/gpgkey/ns-operations-public.key
cat > /etc/yum.repos.d/nodesource-nodejs.repo <<'REPO'
[nodesource-nodejs]
name=NodeSource Node.js 24
baseurl=https://rpm.nodesource.com/pub_24.x/nodistro/nodejs/$basearch
enabled=1
gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/NODESOURCE-GPG-SIGNING-KEY-EL
module_hotfixes=1
REPO
dnf install -y nodejs
[[ $(node -p 'process.versions.node.split(".")[0]') -ge 24 ]] || exit 1
getent passwd yxt >/dev/null || useradd --system --home-dir /var/lib/yijiexingtu --shell /sbin/nologin yxt
install -d -m 0750 -o root -g nginx /etc/yijiexingtu
install -d -m 0700 /etc/yijiexingtu/tls
install -d -m 0700 -o yxt -g yxt /var/lib/yijiexingtu
install -d -m 0700 -o root -g root /var/lib/yijiexingtu-deploy
install -d -m 0750 -o root -g yxt /opt/yijiexingtu/releases
if ! swapon --show=NAME --noheadings | grep -Fxq /swapfile_yxt; then
    if [[ ! -e /swapfile_yxt ]]; then
        fallocate -l 2G /swapfile_yxt || dd if=/dev/zero of=/swapfile_yxt bs=1M count=2048 status=progress
        chmod 600 /swapfile_yxt
        mkswap /swapfile_yxt
    fi
    [[ $(stat -c %s /swapfile_yxt) -eq 2147483648 ]] || { echo '已有 /swapfile_yxt 大小不是2GB，请核对。'; exit 1; }
    swapon /swapfile_yxt
fi
grep -Fq '/swapfile_yxt none swap sw 0 0' /etc/fstab || echo '/swapfile_yxt none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/90-yijiexingtu.conf
sysctl --system >/dev/null
if [[ -f "$SOURCE_DIR/release.json" && -f "$SOURCE_DIR/SHA256SUMS" ]]; then
    cd "$SOURCE_DIR"
    node deploy/release-package.mjs verify-dir "$SOURCE_DIR" >/dev/null
    RELEASE_VERSION=$(node -p 'JSON.parse(require("fs").readFileSync("release.json","utf8")).version')
    APP_RELEASE="/opt/yijiexingtu/releases/$RELEASE_VERSION"
    [[ ! -e "$APP_RELEASE" ]] || { echo '版本目录已存在，停止安装。'; exit 1; }
    install -d -m 0750 "$APP_RELEASE"
    tar -C "$SOURCE_DIR" --exclude='./node_modules' --exclude='./deploy/npm/node_modules' -cf - . | tar -C "$APP_RELEASE" -xf -
else
    cd "$SOURCE_DIR"
    RELEASE_VERSION="0.5.0-tencent.$(date -u +%Y%m%dT%H%M%SZ)"
    PACKAGE_TEMP=$(mktemp -d)
    trap 'rm -rf "$PACKAGE_TEMP"' EXIT
    npm run package:tencent -- --version "$RELEASE_VERSION" --output "$PACKAGE_TEMP/release.zip"
    APP_RELEASE="/opt/yijiexingtu/releases/$RELEASE_VERSION"
    node deploy/release-package.mjs extract "$PACKAGE_TEMP/release.zip" "$APP_RELEASE" >/dev/null
fi
cd "$APP_RELEASE"
npm ci --prefix deploy/npm --omit=dev --ignore-scripts --no-audit --no-fund --registry="${NPM_REGISTRY:-https://mirrors.cloud.tencent.com/npm/}"
if [[ ! -f /etc/yijiexingtu/app.env ]]; then install -m 0600 deploy/app.env.example /etc/yijiexingtu/app.env; fi
install -m 0644 deploy/yijiexingtu*.service deploy/yijiexingtu*.timer /etc/systemd/system/
install -m 0644 deploy/nginx-proxy.conf /etc/nginx/yijiexingtu-proxy.conf
install -m 0644 deploy/nginx.conf /etc/yijiexingtu/nginx.conf.pending
install -d /etc/systemd/journald.conf.d
install -d -m 2755 -o root -g systemd-journal /var/log/journal
printf '[Journal]\nStorage=persistent\nSystemMaxUse=1G\nRuntimeMaxUse=100M\nMaxRetentionSec=30day\n' > /etc/systemd/journald.conf.d/yijiexingtu.conf
systemctl restart systemd-journald
if command -v selinuxenabled >/dev/null && selinuxenabled; then setsebool -P httpd_can_network_connect 1; fi
systemctl enable --now crond
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=ssh
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload
chown -R root:yxt "$APP_RELEASE"
find "$APP_RELEASE" -type d -exec chmod 0750 {} +
find "$APP_RELEASE" -type f -exec chmod 0640 {} +
find "$APP_RELEASE/deploy" -maxdepth 1 -type f \( -name "*.sh" -o -name "*.command" \) -exec chmod 0750 {} +
if [[ -e /opt/yijiexingtu/current && ! -L /opt/yijiexingtu/current ]]; then echo '/opt/yijiexingtu/current 不是软链接，请人工核对。'; exit 1; fi
ln -sfn "$APP_RELEASE" /opt/yijiexingtu/current
systemctl daemon-reload
echo '安装已完成，服务尚未启动。请按 deploy/README.md 填写原密钥、导入测试库、设置证书和 Basic Auth，再预演。'
