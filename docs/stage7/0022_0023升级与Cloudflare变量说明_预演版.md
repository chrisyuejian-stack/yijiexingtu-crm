> 历史预演资料。最终版现已补齐0024，请按《逐步上线清单.md》和deployment/final操作；下文“待协议确认”等为当时状态。0022/0023原件和预演证据仍保留。

# 0022、0023数据库升级与Cloudflare变量说明（预演版）

2026-11-16。适用当前已验收阶段6及其前端融合版。**阶段7新平台协议尚待补齐，本说明是提前整理的升级资料，不是阶段7已上线证明。** 用户不需要打开终端、安装开发工具或编写SQL；检查和迁移已提供完整文件供网页复制执行。本轮没有访问Cloudflare账号、创建远程资源、修改线上数据库或调用真实AI。

## 一、先分清新建和升级

| 当前情况 | 需要的数据库操作 |
| --- | --- |
| 新建艺界星途独立空数据库 | 按顺序完成0001–0023全部迁移，不能只执行0022/0023；阶段7最终版还需其后新增迁移 |
| 艺界星途数据库已经完整到0021 | 依次执行0022，再执行0023 |
| 已完整到0022 | 只执行0023 |
| 已完整到0023 | 不重复执行0022或0023，本次前端补丁不需要数据库升级 |
| 不确定版本、迁移只做了一半 | 先保留现状和最后成功步骤，由后端核对后决定接着哪一步；不要删除表、重复从头跑或关闭约束 |

原枫琴/渠道CRM的生产库、桶、账号和密钥继续独立。艺界星途使用自己的D1和两个私有R2桶。下面所有操作都只针对已确认的艺界星途数据库。

## 二、0022、0023对已有数据的影响

0022新增招生内容、内容修订、AI设置/配额/请求/预占/用量等表，并新增“简洁文章”风格。默认AI额度是fast 80、deep 50；模型名称初始为空，需要在平台页面填写。它不改原学员、排课、财务、报价、方案或已发送版本。

0023新增曲目、报告批次/报告/修订、复制事件和通知等6个实体表；给原lesson_submissions增加personal_json，给原lesson_comments增加feedback_versions_json，默认都是空数组。growth_feedback是读取这两个扩展字段的视图，不是第二套提交或销课流程。它不回写旧点评、不重新扣课，不更改旧方案价格快照，并新增独立“成长书册”风格；旧风格版本保留。

本轮用含学员、老师、课次、课时包、已确认点评和人工放入的旧方案/修订/分享测试记录的0021本地库演练。执行0022和0023后，逐项核对112张原表、98条原记录的全部原列值，保持一致；外键检查无错误、完整性检查通过。原方案JSON、价格快照和修订未变。源码/打包两种处理器下分别验证通过。这是本地证据，不冒充线上数据库验证。

## 三、通过Cloudflare网页执行升级

最终上线前先安排短暂停写窗口，保留升级前成功备份和该库的可用恢复时间点，记录数据库名称/ID和升级前时间。暂停备份定时任务，完成数据库升级及备份Worker更新后再恢复。

1. 在Cloudflare控制台进入D1 SQL Database，选择确认过的艺界星途数据库，打开Console。先核对名称和ID，保存升级前页面信息。
2. 打开本包deployment/upgrade-0022-0023/01_升级前结构检查.sql，复制只读检查内容到Console执行。plans应已存在；检查content_items/ai_requests等0022对象、growth_reports/growth_feedback等0023对象，以及两张旧表的新增列。不能只凭一个表存在就认定某次迁移全部完成。
3. 已确认是完整0021时，再运行02_升级前后业务数量对照.sql并保存结果。已有0022/0023的库按上表选择后续步骤。
4. **0022目录有18步，0023目录有17步。** 按目录内01.sql、02.sql……的顺序逐份打开、完整复制到Console执行。先做完0022，再做0023；已完成0022的只做0023。每次确认成功后记录编号，再进行下一步。每个文件只有一个完整SQL语句，触发器的BEGIN到END在同一文件内，不能自行按分号拆开。
5. 任一步报错，保留错误和最后成功编号，暂停后续操作。迁移原件保持原样，不添加IF NOT EXISTS掩盖半迁移状态，不删表重做。由后端核对后继续或用升级前恢复点处理。
6. 完成后执行03_升级后完整性检查.sql。missing_object应没有结果；新增列应存在；quick_check为ok；foreign_key_check没有结果。再次执行02数量对照，与升级前保存的结果比较，原业务表数量应相同。
7. 数据库完整后再发布匹配的Pages代码和备份Worker；配置下节变量、绑定和域名。恢复备份定时任务并核对一次新备份成功，再结束停写窗口。

拆分文件只从未修改的0022/0023原件生成，不是另一份迁移。单语句执行与原整文件顺序执行的结构相同，已经在本地校验。正式部署时会结合新增0024及后续实际编号补齐最终步骤和验收结果，当前不要把本资料当作阶段7全量上线包。

## 四、资源绑定与普通变量

在Pages项目的Settings中配置。Binding选择资源；Variables and Secrets设置普通文本或Secret。保存后重新部署，使配置进入新部署。正式环境与Preview分别配置，测试库/桶/密钥与生产分开。

| 名称 | 类型 | Pages | 备份Worker | 值与用途 |
| --- | --- | --- | --- | --- |
| CHANNEL_DB | D1绑定 | 必需 | 必需 | 同一套艺界星途D1；不是把数据库ID当普通文本 |
| CHANNEL_MEDIA | R2绑定 | 必需 | 必需 | 艺界星途私有媒体桶；备份Worker也清理过期媒体 |
| CHANNEL_BACKUPS | R2绑定 | 必需 | 必需 | 艺界星途私有加密备份桶 |
| TENANT_HOST | 文本变量 | 必需 | 不需要 | edu.yijiexingtu.com，只填主机名，不带https或斜杠；与已绑定域名一致 |
| CONSOLE_HOST | 文本变量 | 必需 | 不需要 | ops.yijiexingtu.com，与机构域名不同 |
| ACCESS_MODE | 文本变量 | 必需 | 不需要 | 生产按on配置 |
| ACCESS_ISSUER | 文本变量 | Access启用时必需 | 不需要 | Cloudflare Access团队签发地址 |
| ACCESS_AUD | 文本变量 | Access启用时必需 | 不需要 | 平台入口Access应用的Audience值 |
| ACCESS_EMAILS | 文本变量 | Access启用时必需 | 不需要 | 允许的平台管理员邮箱，多个以英文逗号分隔 |
| TURNSTILE_MODE | 文本变量 | 必需 | 不需要 | 生产按on配置 |
| TURNSTILE_SITE_KEY | 文本变量 | Turnstile启用时必需 | 不需要 | 对应正式登录主机名的Site Key |
| REFERRALS_MODE | 文本变量 | 保持off | 不需要 | 保留现有合作升学开关，不因本轮开启 |

平台入口保留Access及现有平台登录/TOTP两层校验。Turnstile按已绑定域名设置，不把预览测试值填到正式环境。资源建议名称仍见deployment/resources.template.json，其中null表示尚未创建或填写，不能直接当作真实绑定。

## 五、Secret清单，重点是DEEPSEEK_API_KEY

在Variables and Secrets选择加密/Encrypt后保存Secret，不能当作前端配置，也不放进源码、上传ZIP或公开截图。

| Secret | Pages | 备份Worker | 格式与说明 |
| --- | --- | --- | --- |
| FIELD_KEY | 必需 | 不需要 | 32字节随机值的标准Base64，原业务字段加密 |
| BACKUP_KEY | 必需 | 必需 | 同一个32字节Base64值，供两者加密/解密备份 |
| HMAC_KEY | 必需 | 不需要 | 至少32字符；手机号等索引，独立生成 |
| PW_PEPPER | 必需 | 不需要 | 至少32字符；密码校验，独立生成 |
| PLATFORM_SETUP_KEY | 必需 | 不需要 | 至少32字符；平台首次初始化，独立生成 |
| PLATFORM_PHONE_HMAC_KEY | 必需 | 不需要 | 至少32字符；根登录平台手机号索引，与HMAC_KEY分开 |
| TURNSTILE_SECRET | Turnstile启用时必需 | 不需要 | Turnstile服务端Secret，不能填Site Key |
| **DEEPSEEK_API_KEY** | **启用AI新增** | **不需要** | 从DeepSeek账号取得，填Pages的加密Secret；只在服务器调用模型时使用 |

**已有艺界星途项目从0021升级时，保留原来的FIELD_KEY、HMAC_KEY、PW_PEPPER、BACKUP_KEY、PLATFORM_PHONE_HMAC_KEY等值。** 换掉这些值会使原字段解密、密码/手机号索引或旧备份失效；数据库升级不要求换密钥。全新独立项目与原枫琴项目使用新生成且分别保管的密钥。

启用AI还要在平台现有“AI模型”页填写fast_model、deep_model和默认次数。模型名称使用DeepSeek账号当前可用的准确名称；模型和次数存在数据库，不需要新增FAST_MODEL、DEEP_MODEL或FAST_DAILY_LIMIT等环境变量。没有密钥或模型名时AI返回503，旧CRM业务不因此停用。

AI_PROVIDER是本地测试注入函数，生产不配置。测试账号、预览脚本、SQL迁移和密钥生成器不进入Pages站点资源。

## 六、备份Worker与发布包

最终Pages上传ZIP根目录直接含_worker.js、_routes.json、HTML和静态资源目录；源码ZIP、SQL迁移文件和测试日志不上传到Pages站点。当前仍为12个dist文件。Cloudflare支持Direct Upload上传预构建ZIP及_worker.js；已有Git集成项目的上传方式按其项目类型处理，不在本次改换架构。

备份Worker使用单独交付的backup-worker.js，绑定上表3个艺界星途资源，并填写同一个BACKUP_KEY。定时规则为：0 19 * * *（UTC每日19:00，即北京时间次日03:00启动每日备份）和*/5 * * * *（每5分钟续跑、清理过期预占及临时媒体）。按当前实际代码，两条都需要配置。

本轮只验证本地编译产物和备份调度，没有发布到真实Cloudflare。阶段7最终包还要包含其新平台功能、实际新增迁移、线上资源核对和上线验收；收到冻结补充后继续。

## 七、官方操作依据

2026-11-16查阅公开文档，没有使用登录账号或连接业务资源：

- [D1 SQL与控制台、受支持PRAGMA](https://developers.cloudflare.com/d1/sql-api/sql-statements/)：网页Console支持SQL；线上检查采用quick_check和foreign_key_check。
- [Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)：支持预构建ZIP和_worker.js；不在网页编译functions目录。
- [Pages资源绑定、变量与Secrets](https://developers.cloudflare.com/pages/functions/bindings/)：绑定和变量保存在项目设置，敏感值加密，配置后重新部署。
- [D1 Time Travel与备份](https://developers.cloudflare.com/d1/reference/time-travel/)：升级前记录当前库可用恢复时间点，实际恢复范围以本库控制台为准。
