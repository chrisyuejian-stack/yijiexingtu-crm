# 自动化一次性配置（需仓库所有者在 GitHub 网页完成）

## Secrets（Settings → Secrets and variables → Actions）
| 名称 | 类型 | 用途 |
|---|---|---|
| CLOUDFLARE_API_TOKEN | secret | Pages 部署（权限：Cloudflare Pages Edit） |
| CLOUDFLARE_ACCOUNT_ID | secret | Cloudflare 账号 |
| CF_PAGES_PROJECT | variable | Pages 项目名 |
| EDGEONE_API_TOKEN | secret | EdgeOne Pages 部署令牌 |
| EDGEONE_PROJECT | variable | EdgeOne Pages 项目名 |
| AUTOMERGE_TOKEN | secret（可选） | 细粒度 PAT；用它合并才能触发后续 workflow |

## 仓库设置
1. Settings → General → 勾选 Allow auto-merge，勾选 Automatically delete head branches。
2. Settings → Branches → 给 main 加保护：Require status checks（test、e2e），Require PR。
3. 创建标签：task、ready、blocked、needs-claude。
4. 给 GPT / Gemini / Grok 的 GitHub 账号授予 Write 权限。

## 待定设计
EdgeOne 只托管静态前端；前端用同源 `/api`，需在 EdgeOne 配规则把 `/api/*` 反代到 Cloudflare Worker 域名。
