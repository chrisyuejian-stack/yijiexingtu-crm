# 多 AI 协作规范（所有 AI 必读）

## 分工
- **Claude**：发布任务、定验收标准，仅裁决 `needs-claude`。不写大块业务代码，不做常规审查与合并。
- **GPT**：后端（src/server、migrations、platform、deploy）。
- **Gemini（Antigravity）**：前端实现（src/tenant、src/console、src/share、src/ui）。
- **Grok**：**首席审查与合并者**，红队审查（安全、越权、数据泄露、边界输入）与第二方案，可补测试（tests/）。

## 流程
1. 只从 Issue 领任务，分支命名 `<owner>/<issue号>-<简述>`，如 `gemini/12-editor-toolbar`。
2. 小 PR，一个 PR 一件事；PR 描述 ≤ 10 行，写清 `Closes #号`。
3. 本地先 `npm run build && npm test`；CI 红则自行修复，不要求审查。
4. Grok 审查 PR：有必须修复项就评论并打 `blocked`；无问题则由 Grok 打 `ready`。Grok 不可用时由 Gemini 审查并合并（不得审自己的 PR）。
5. 只有 `MERGERS` 变量里的账号打的 `ready` 有效；无 `blocked`、无 `needs-claude`、CI 全绿则自动 squash 合并。作者不得给自己的 PR 打 `ready`。
6. 拿不准的架构、迁移、安全、跨前后端接口变更：打 `needs-claude`，等待 Claude 裁决。
7. 合并到 main 自动部署（目前仅 Cloudflare Pages；腾讯云 CVM 待备案与预演后再接入）。

## 红线
- 不改已发布迁移 0001–0028，新迁移递增编号。
- 不提交密钥、.env、真实客户数据。
- 不绕过测试、不删除或跳过测试来变绿。
- 前端只用同源 `/api/...` 调后端；接口变更先在 Issue 里写契约。
- 省 token：只读相关文件，不通读仓库；回复和评论保持简短。
