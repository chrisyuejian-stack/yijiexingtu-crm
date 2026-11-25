# Cloudflare配置清单

最终版0024，2026-11-16。部署步骤见[逐步上线清单](逐步上线清单.md)。未创建真实资源，示例名称须换成自己的实际名称；生产与Preview分开。

| 名称 | 类型 | Pages | 备份Worker | 值 / 用途 |
| --- | --- | --- | --- | --- |
| CHANNEL_DB | D1绑定 | 必需 | 必需 | 同一个艺界星途正式数据库，完整到0024 |
| CHANNEL_MEDIA | R2绑定 | 必需 | 必需 | 同一个私有媒体桶，包含图库和风格图片 |
| CHANNEL_BACKUPS | R2绑定 | 必需 | 必需 | 同一个私有加密备份桶 |
| TENANT_HOST | 文本 | 必需 | 不需要 | 机构主机名，无协议或斜杠 |
| CONSOLE_HOST | 文本 | 必需 | 不需要 | 平台主机名，与机构不同 |
| ACCESS_MODE | 文本 | on | 不需要 | 保留Access校验 |
| ACCESS_ISSUER | 文本 | 必需 | 不需要 | 自己的Access团队签发地址 |
| ACCESS_AUD | 文本 | 必需 | 不需要 | 自己平台Access应用的Audience |
| ACCESS_EMAILS | 文本 | 必需 | 不需要 | 授权邮箱，多个用英文逗号 |
| TURNSTILE_MODE | 文本 | on | 不需要 | 正式开启验证 |
| TURNSTILE_SITE_KEY | 文本 | 必需 | 不需要 | Turnstile站点公钥，绑定正式机构域名 |
| REFERRALS_MODE | 文本 | off | 不需要 | 本轮不开放旧推广业务 |
| FIELD_KEY | Secret | 必需 | 不需要 | 32字节随机值标准Base64，旧环境保持原值 |
| BACKUP_KEY | Secret | 必需 | 必需 | 两处相同的32字节随机值Base64，旧环境保持原值 |
| HMAC_KEY | Secret | 必需 | 不需要 | 独立至少32字符，旧环境保持原值 |
| PW_PEPPER | Secret | 必需 | 不需要 | 独立至少32字符，旧环境保持原值 |
| PLATFORM_SETUP_KEY | Secret | 必需 | 不需要 | 独立至少32字符，首次超管初始化用 |
| PLATFORM_PHONE_HMAC_KEY | Secret | 必需 | 不需要 | 独立至少32字符，根手机号索引，旧环境保持原值 |
| TURNSTILE_SECRET | Secret | 必需 | 不需要 | Turnstile服务端密钥，不是Site Key |
| DEEPSEEK_API_KEY | Secret | 启用AI必需 | 不需要 | 自己DeepSeek账号取得，仅服务器使用 |

每个随机密钥独立生成，BACKUP_KEY只是在Pages与备份Worker之间共享。FIELD_KEY不能与BACKUP_KEY等复用。Secret在控制台选择Encrypt，不放进源码、HTML或上传包。随包离线生成器只用于全新环境；已有艺界星途升级时不重新生成旧密钥。

fast_model、deep_model、fast_daily_limit、deep_daily_limit在现有平台AI模型页面/GET和PUT /api/ops/ai/settings中配置；机构覆盖在PUT /api/ops/tenants/{id}/ai-override，null取消覆盖，0为禁用该档。两档模型名初始可为空，启用前填供应商当前准确名称。本包没有额外FAST_MODEL等环境变量，没有生产AI_PROVIDER。

相对已配置阶段6，0024无需新增任何变量、Secret、桶或绑定。相对旧CRM，AI需要新增DEEPSEEK_API_KEY；若根登录此前未配置，还需PLATFORM_PHONE_HMAC_KEY。变量更新后须重新部署。备份Worker只需三绑定及BACKUP_KEY；新表随新Worker进入完整备份。

Cron两条：0 19 * * * 与 */5 * * * *。前者北京时间次日03:00启动每日备份，后者续跑与清理。HTTP404是正常，不可据此认定定时备份成功。
