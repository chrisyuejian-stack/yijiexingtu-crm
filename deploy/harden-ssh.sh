#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || exit 1
[[ ${KEY_LOGIN_CONFIRMED:-} == yes && -s /root/.ssh/authorized_keys ]] || { echo '先保留当前会话，在第二窗口验证 root 密钥登录，再按 README 运行；现在未更改 SSH。'; exit 1; }
install -d -m 0755 /etc/ssh/sshd_config.d
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPubkeyAuthentication yes\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/00-yijiexingtu-keys.conf
sshd -t
systemctl reload sshd
echo '已禁止SSH密码登录；请在关闭当前窗口前再次验证密钥登录。'
