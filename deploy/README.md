# 艺界星途腾讯云迁移：服务器操作说明

2026-11-18。依据《腾讯云迁移设计方案》§1–7，以§9为优先。基准是用户提供的 **v0.5 完整源码（20261118）**，已含 Claude 前端。本文准备命令和脚本，**本轮没有连接腾讯云、Cloudflare、DeepSeek 或操作线上数据**。

控制台点击教程由 Claude 在部署时提供：上海 COS 两私有桶、备份桶版本控制、实例角色、带宽、安全组、DNS 和 R2 令牌。本文负责服务器命令。正式切换前必须完成一次完整预演，包括回滚。

## 先准备好这些

- 实例 ins-f5ui1gyv，上海八区，TencentOS Server 3.3，2核2GB、50GB盘，IP **101.43.112.196**。
- 先按 Claude 教程调整带宽：建议按流量计费、上限30Mbps，或带宽包月至少5Mbps；费用看控制台实时价格。现在的1Mbps会明显拖慢页面和图片。
- 两个上海 `ap-shanghai` 私有桶：媒体、备份。备份桶开启版本控制；同时配置非当前版本/删除标记生命周期，避免旧版本无限累计。逻辑备份30天、文件快照14天，版本历史需在 COS 侧另设清理。
- 为实例绑定角色 `yxt-cos-role`。授权模板为 cam-role-policy.template.json，信任策略为 cam-role-trust.json。只授权两个桶的对象读写删和列举；GetObject 覆盖对象内容和头信息读取，DeleteObject 覆盖批量删除的对象权限。**不使用主账号密钥**。
- 五个原密钥必须原样保留：FIELD_KEY、BACKUP_KEY、HMAC_KEY、PW_PEPPER、PLATFORM_PHONE_HMAC_KEY。新配置助手只新建 PLATFORM_SETUP_KEY；因为超管已初始化，不会改变已有账号。DeepSeek Key 可沿用，也可按§9新建。
- Cloudflare 源系统已是 **v0.5 且数据库到0028**。若尚未完成，请先按上一轮资料升级，不能把0027库当作本次迁移输入。
- 保留原 v0.5 Pages 包、D1/R2资源、旧部署编号、原绑定和密钥记录。

## 1. 首次上传并安装（只在这台新服务器操作）

在实例详情的“文件上传”或网页终端“文件管理”入口，把本次完整迁移源码 ZIP 上传到 `/root/yxt-upload`。进入 root 网页终端，一整段复制：

```bash
mkdir -p /root/yxt-upload/source
dnf install -y unzip
unzip /root/yxt-upload/艺界星途_v0.5_腾讯云版本化发布完整源码_20261118.zip -d /root/yxt-upload/source
bash /root/yxt-upload/source/deploy/install.sh
```

安装会：安装 Node 24、Nginx、firewalld、cronie；使用锁定的 COS SDK；从完整源码先构建并生成固定发布包（使用运行包时直接校验安装预构建产物）；创建非root用户 yxt、2GB交换空间；设置 Node 768MB堆上限；配置持久 journald（1GB、30天）；按 SELinux 状态启用反代；放行 SSH/HTTP/HTTPS。**不会初始化业务库，不会启动空系统，不会自动切 DNS。**

当前版本目录通过 `/opt/yijiexingtu/current` 指向实际发布目录。只运行一个 systemd 主服务，不开 pm2 cluster，不手动启动第二份 Node 写同一个库。安装脚本不允许在其他系统直接执行。它已做语法检查，但没有在真实 TencentOS 上运行。

## 2. 填配置（密钥不会显示在终端输入区）

```bash
cd /opt/yijiexingtu/current
node deploy/setup-env.mjs
```

按提示输入五个原密钥、DeepSeek Key、两个完整桶名（含 `-APPID`）。配置保存在 `/etc/yijiexingtu/app.env`，root所有、权限600。模板在 app.env.example。默认两个域名、两个关闭开关、上海实例角色、8787端口都已填好。不要设置 AI_PROVIDER。

助手重新运行会先保存一份权限600的旧配置。它不替换那五个原密钥；是否填对必须由后面的解密、登录及备份恢复验证。不要把完成的配置文件、导出SQL或密钥发到聊天。

COS备用密钥模式仅在实例角色无法使用且负责人决定切换时使用：把 COS_AUTH 改为 keys，并填写 CAM 子用户的 COS_SECRET_ID/COS_SECRET_KEY；正常 role 模式不填写它们。角色临时凭据仅存在内存，到期前5分钟更新。

如需生成填好桶名的授权JSON（不含密钥），复制下面命令并把两个桶名改为实际值：

```bash
cd /opt/yijiexingtu/current
node deploy/render-cam-policy.mjs 媒体桶完整名称-APPID 备份桶完整名称-APPID
```

## 3. HTTPS 和平台额外保护

先安装专用 DNSPod API Token（仅用于证书，不是 COS 密钥；不要用主账号密钥）。在网页文件编辑器新建 `/etc/yijiexingtu/cert.env`：

```text
DP_Id="替换为专用DNSPod Token ID"
DP_Key="替换为专用DNSPod Token Key"
ACME_EMAIL="替换为证书通知邮箱"
```

然后复制：

```bash
chmod 600 /etc/yijiexingtu/cert.env
mkdir -p /opt/yijiexingtu/acme
curl --fail --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/acmesh-official/acme.sh/master/acme.sh -o /opt/yijiexingtu/acme/acme.sh
cd /opt/yijiexingtu/current
node deploy/with-env.mjs --file /etc/yijiexingtu/cert.env -- bash deploy/issue-certs.sh
```

该步骤通过 DNS 验证签发两个域名的证书，尚未切换网站 DNS 也可以执行。acme.sh 会建立自动续期任务。脚本只从文件按字面读取环境值，不把密钥作为 shell 代码执行。

为 ops 域名建立独立 Basic Auth 用户；密码交互输入，不写进命令：

```bash
if [ -f /etc/yijiexingtu/ops.htpasswd ]; then
  htpasswd -B /etc/yijiexingtu/ops.htpasswd opsgate
else
  htpasswd -Bc /etc/yijiexingtu/ops.htpasswd opsgate
fi
cd /opt/yijiexingtu/current
bash deploy/enable-nginx.sh
```

登录平台需要先过 Nginx Basic Auth，再过原平台账号密码和验证器。不存在的域名返回404，所有请求都反代到本机 Node，包括JS/CSS/HTML；Nginx不直接出业务静态文件。上传32MiB、读取超时200秒、登录按IP每分钟20次（允许10次突发），真实IP由Nginx覆盖。原业务自己的细化限流仍保留。

该实例须为本项目专用。启用脚本会备份 Nginx 主配置，发现其他站点配置就停止；不要覆盖其他项目。证书或 Basic Auth 文件缺失时也会停止。

## 4. 导出 Cloudflare 数据（在 Mac 上）

把 deploy/export-d1.command 单独下载到 Mac，首次可在终端整段复制下面两行赋予双击权限；其中路径可把文件拖进终端替换：

```bash
chmod +x ~/Downloads/export-d1.command
open ~/Downloads/export-d1.command
```

之后双击即可。Mac需有Node.js 24；脚本会打开 Cloudflare 官方授权页，默认导出 `yijiexingtu-crm-prod` 到旁边带时间的SQL文件，权限600。wrangler固定4.50.0。此脚本只导出，不删除或修改远端数据。

在**同一冻结导出窗口**，把 `d1-row-counts-single-line.sql` 全行复制到 D1 Console。它返回140张业务表行数的一个JSON对象；复制 counts 内容保存为 `source-counts.json`。备用行表版本为 d1-row-counts-rows.sql。源库在此期间不能变化，否则必须重新导出并重新计数。

## 5. 导入新的本机库（预演）

把 d1.sql、source-counts.json 上传到 `/root/yxt-migration`。输入文件名不同就先在文件管理中改成这两个名字。复制：

```bash
mkdir -p /root/yxt-migration
chmod 700 /root/yxt-migration
chmod 600 /root/yxt-migration/d1.sql /root/yxt-migration/source-counts.json
cd /opt/yijiexingtu/current
node deploy/import-d1.mjs /root/yxt-migration/d1.sql /var/lib/yijiexingtu/rehearsal.sqlite
chown yxt:yxt /var/lib/yijiexingtu/rehearsal.sqlite
chmod 600 /var/lib/yijiexingtu/rehearsal.sqlite
```

导入脚本永不覆盖已有输出文件。它跳过 `_cf_*` 等平台内部对象，在一个事务中恢复表、数据、视图、索引、触发器，避免导入数据时误触发业务触发器；通过 integrity_check、foreign_key_check 才发布新文件。不重新运行旧迁移，不关闭外键，不会改旧SQL。

## 6. 复制媒体并核对

按 Claude 教程建只读 R2 API Token，把 rclone.conf.example 改好后保存到 `/etc/yijiexingtu/rclone.conf`，权限600。这里的 R2 Key 是临时迁移凭据；COS Key 不填进文件，实例角色由包装器注入子进程内存，并在长时间复制时刷新、增量续跑。

安装 rclone：

```bash
cd /opt/yijiexingtu/current
bash deploy/install-rclone.sh
chmod 600 /etc/yijiexingtu/rclone.conf
```

下面各命令中，把 `R2_MEDIA_BUCKET` 和 `COS_MEDIA_BUCKET-APPID` 改成实际桶名，保留 `r2:`、`cos:`：

```bash
cd /opt/yijiexingtu/current
bash deploy/run-env.sh node deploy/rclone-role.mjs copy r2:R2_MEDIA_BUCKET cos:COS_MEDIA_BUCKET-APPID --config /etc/yijiexingtu/rclone.conf --progress
bash deploy/run-env.sh node deploy/rclone-role.mjs size r2:R2_MEDIA_BUCKET --config /etc/yijiexingtu/rclone.conf --json > /root/yxt-migration/r2-size.json
bash deploy/run-env.sh node deploy/rclone-role.mjs size cos:COS_MEDIA_BUCKET-APPID --config /etc/yijiexingtu/rclone.conf --json > /root/yxt-migration/cos-size.json
node deploy/compare-object-counts.mjs /root/yxt-migration/r2-size.json /root/yxt-migration/cos-size.json
bash deploy/run-env.sh node deploy/rclone-role.mjs check r2:R2_MEDIA_BUCKET cos:COS_MEDIA_BUCKET-APPID --config /etc/yijiexingtu/rclone.conf --size-only
```

第一次复制应在空媒体桶完成，之后正式切换只做增量。不要用 sync 或清空桶来掩盖不一致。对象数、总字节和逐路径大小检查均要通过。

历史备份也要保留时（本迁移建议完成，避免新后台历史记录缺原件），在同一只读令牌增加原备份桶的读取权限，复制到COS备份桶：

```bash
cd /opt/yijiexingtu/current
bash deploy/run-env.sh node deploy/rclone-role.mjs copy r2:R2_BACKUP_BUCKET cos:COS_BACKUP_BUCKET-APPID --config /etc/yijiexingtu/rclone.conf --progress
bash deploy/run-env.sh node deploy/rclone-role.mjs size r2:R2_BACKUP_BUCKET --config /etc/yijiexingtu/rclone.conf --json > /root/yxt-migration/r2-backups-size.json
bash deploy/run-env.sh node deploy/rclone-role.mjs size cos:COS_BACKUP_BUCKET-APPID --config /etc/yijiexingtu/rclone.conf --json > /root/yxt-migration/cos-backups-size.json
node deploy/compare-object-counts.mjs /root/yxt-migration/r2-backups-size.json /root/yxt-migration/cos-backups-size.json
bash deploy/run-env.sh node deploy/rclone-role.mjs check r2:R2_BACKUP_BUCKET cos:COS_BACKUP_BUCKET-APPID --config /etc/yijiexingtu/rclone.conf --size-only
```

桶名需替换实际值。两桶复制通过后，按操作单记录预演前清单；在Node还未开放客户写入的预演期间，才可以用清单清理新增测试对象。正式系统已使用后不得运行预演清理。


## 7. 校验和预演登录

```bash
cd /opt/yijiexingtu/current
bash deploy/run-env.sh node deploy/verify.mjs /var/lib/yijiexingtu/rehearsal.sqlite --counts /root/yxt-migration/source-counts.json
```

应见 ok=true、表行数无差异、解密失败0、图片缺失0。加密字段随机最多20条，不输出明文；图库随机最多20张，数量少则查全部。五个原密钥还需靠真实登录及备份解密一起验证，不能把只解开 FIELD_KEY 当成五个都验证过。

预演必须让服务用预演库：在网页文件编辑器把 app.env 的 DB_PATH 临时改为 `/var/lib/yijiexingtu/rehearsal.sqlite`，其他值不变。然后：

```bash
systemctl start yijiexingtu
systemctl status yijiexingtu --no-pager
journalctl -u yijiexingtu -n 30 --no-pager
curl --fail --resolve edu.yijiexingtu.com:443:101.43.112.196 https://edu.yijiexingtu.com/login -o /dev/null
```

启动日志应有 migration=0028、两个原Worker哈希和cosAuth=role。没有迁移台账的旧库是通过必需0028表/触发器及0027列确认，而非给旧库伪造版本号。启动时检查SQLite完整性、外键、COS列举及不存在对象head。失败就不监听服务。

浏览器通过 hosts 把两个域名指到新IP，按 Claude 教程操作（只影响预演电脑，其他机构仍走原站）。验证机构登录、平台Basic Auth+账号+验证器、学员/财务、方案AI、转学员、图片、公众号导出、家长与分享。**不使用裸IP作为正式登录地址**。

预演结束后停止服务，保留预演库及核对报告，按操作单重新导出正式库，不把预演时产生的测试记录带进正式数据。

## 8. 正式切换、定时任务和核对

完整清单见《预演与正式切换操作单》。本节命令在最终源数据已冻结、正式导入和媒体核对完成后使用。

```bash
systemctl stop yijiexingtu
cd /opt/yijiexingtu/current
node deploy/import-d1.mjs /root/yxt-migration/d1-final.sql /var/lib/yijiexingtu/crm.sqlite
chown yxt:yxt /var/lib/yijiexingtu/crm.sqlite
chmod 600 /var/lib/yijiexingtu/crm.sqlite
```

输出文件存在会拒绝覆盖。若已存在正式库，先停服务并保留旧库及WAL/SHM，由负责人确认新文件名；不要删除后盲目重跑。把 app.env 的 DB_PATH 改回 `/var/lib/yijiexingtu/crm.sqlite`，重新运行 verify，使用同一次最终导出的计数。通过后：

```bash
systemctl enable --now yijiexingtu
systemctl enable --now yijiexingtu-snapshot.timer yijiexingtu-backup-check.timer
systemctl status yijiexingtu --no-pager
systemctl list-timers 'yijiexingtu-*' --all
```

由 Claude 带用户改DNS（edu、ops→A记录101.43.112.196，TTL600）。验收后再恢复客户写入，然后启用公网健康检查：

```bash
systemctl enable --now yijiexingtu-health.timer
```

Node进程固定TZ=UTC以保持原Worker环境，业务北京时间仍由原代码处理。进程内原两条UTC任务原样运行：每日19:00 UTC（北京时间03:00）启动逻辑备份，每5分钟续跑和清理。19:00先日备份后清理，不重入，不补跑启动前错过的分钟。文件快照20:00 UTC（北京时间04:00），使用SQLite backup()一致性复制、gzip、以原BACKUP_KEY派生密钥再加密并上传 `files/`，保留14天。恢复工具为 restore-file-snapshot.mjs；原逻辑备份格式没有改变。

首次可手动验证一次文件快照（这不会启动额外的主服务进程）：

```bash
systemctl start yijiexingtu-snapshot.service
journalctl -u yijiexingtu-snapshot -n 20 --no-pager
journalctl -u yijiexingtu -n 30 --no-pager
```

等到下一次03:00确认逻辑备份最终completed（初始running不是成功），再在受保护的本机用原BACKUP_KEY解密验证。平台原备份记录仍可查看。backup-check在最近26小时没有completed时写ERROR；证书15天内到期也写ERROR；公网拨测连续3次失败写ERROR。**日志输出不等于短信已接通**，告警通知渠道和日志采集/规则由 Claude 控制台教程完成，并安排一次测试告警。

## 9. SSH加固（最后做，避免锁住自己）

先绑定SSH密钥，在第二个独立窗口验证root密钥登录成功，保留当前窗口。确认后复制：

```bash
cd /opt/yijiexingtu/current
KEY_LOGIN_CONFIRMED=yes bash deploy/harden-ssh.sh
```

脚本发现没有authorized_keys或没有确认标记就不改配置；通过sshd语法检查才reload。安全组和firewalld有效入口只保留22、80、443；8787仅本机监听，不要开公网8787。

## 10. 回滚和日常查看

回滚步骤见《回滚操作单》，恢复写入后必须迁回数据库**和新增媒体**，不能只改DNS。保留Cloudflare资源和原配置至少7天；导出窗口暂停旧Cron是临时冻结，配置保留，回滚时恢复；不能同时让两边对客户写入。

日常查看只需复制：

```bash
systemctl status yijiexingtu --no-pager
journalctl -u yijiexingtu -n 50 --no-pager
journalctl -u yijiexingtu-snapshot -n 20 --no-pager
free -h
df -h /var/lib/yijiexingtu
firewall-cmd --list-all
```

不要在这里打印app.env或数据库明文。没有配置过的真实CAM权限、COS内网连通、证书签发、TencentOS安装、DNS、短信告警和真实DeepSeek效果都必须在预演/上线时验证；本地测试不能替代这些检查。


## 11. 后续更新与代码回滚

新增操作单见《版本化发布与回滚.md》。部署包由 `npm run package:tencent` 生成，使用 `deploy/update.sh <部署包.zip>` 一键更新，`deploy/rollback.sh` 回到台账中的上一版。保留最近5个代码版本；停写前先做SQLite在线快照，停服务后再做冻结快照；全部新迁移在一个事务内执行。健康失败自动切回代码，数据库不自动恢复。已安装current时不要重复运行install.sh。无新增云绑定、变量、Secret或DeepSeek设置。首次接入旧版没有update.sh时，按新操作单使用root解压目录里的更新器。
