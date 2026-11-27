# 自动化一次性配置（需仓库所有者在 GitHub 网页完成）

## Secrets（Settings → Secrets and variables → Actions）
| 名称 | 类型 | 用途 |
|---|---|---|
| CLOUDFLARE_API_TOKEN | secret | Pages 部署（权限：Cloudflare Pages Edit） |
| CLOUDFLARE_ACCOUNT_ID | secret | Cloudflare 账号 |
| CF_PAGES_PROJECT | variable | Pages 项目名 |
| MERGERS | variable | 有权打 ready 合并的账号，逗号分隔，如 `grok-acct,gemini-acct`（无空格） |
| AUTOMERGE_TOKEN | secret（可选） | 细粒度 PAT；用它合并才能触发后续 workflow |

## 仓库设置
1. Settings → General → 勾选 Allow auto-merge，勾选 Automatically delete head branches。
2. Settings → Branches → 给 main 加保护：Require status checks（test、e2e），Require PR。
3. 创建标签：task、ready、blocked、needs-claude。
4. 给 GPT / Gemini / Grok 的 GitHub 账号授予 Write 权限。

## 部署路线
- 现在：只部署 Cloudflare Pages（`_worker.js` 含前后端、D1、R2），在 Cloudflare 上继续迭代。
- 域名备案完成后：按 `deploy/reference/腾讯云迁移设计方案_20261118.md` 迁移到腾讯云 CVM（Nginx + Node + SQLite + COS），
  先做预演再切换；届时再新增 CVM 部署任务（CI 打 `npm run package:tencent`，SSH 到服务器运行 `update.sh`）。
- 切换前不要对 CVM 做自动部署，Cloudflare 与 CVM 不得同时对机构写入。
