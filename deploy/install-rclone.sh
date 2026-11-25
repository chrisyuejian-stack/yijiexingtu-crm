#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || exit 1
if command -v rclone >/dev/null; then rclone version; exit 0; fi
case $(uname -m) in x86_64) ARCH=amd64;; aarch64) ARCH=arm64;; *) echo '不支持的架构'; exit 1;; esac
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
curl --fail --proto '=https' --tlsv1.2 -o "$TMP_DIR/rclone.zip" "https://downloads.rclone.org/rclone-current-linux-$ARCH.zip"
unzip -q "$TMP_DIR/rclone.zip" -d "$TMP_DIR"
install -m 0755 "$TMP_DIR"/rclone-*-linux-"$ARCH"/rclone /usr/local/bin/rclone
rclone version
