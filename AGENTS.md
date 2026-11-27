# 多 AI 协作规范（所有 AI 必读）

被叫醒后：读本文件和 `docs/agents/<你的名字>.md`，按 `docs/agents/README.md` 的流程领任务。

## 分工
- **Claude**：发布任务、定验收标准，裁决 `needs-claude`。不写大块业务代码，不做常规审查。
- **GPT**：后端（src/server、migrations、platform、deploy）。额度有限，仅做后端难题。
- **Gemini（Antigravity）**：前端实现（src/tenant、src/console、src/share、src/ui）。
- **Grok**：红队审计与第二方案，可补测试。审计在人工开会话触发时进行，发现问题开 Issue（标签 `task`）。

## 流程
1. 只从 Issue 领任务，分支命名 `<owner>/<issue号>-<简述>`，如 `gemini/12-editor-toolbar`。
2. 小 PR，一个 PR 一件事；PR 描述 ≤ 10 行，写清 `Closes #号`。
3. 本地先 `npm run build && npm test`；CI 红则自行修复。
4. 合并全自动：CI 全绿，且无 `blocked`、`needs-claude`、`hold` 标签、非草稿，则自动 squash 合并并部署。
5. 动了 migrations/、.github/、deploy/、platform/、package.json、build.mjs 或服务端鉴权类文件的 PR，会被自动打 `needs-claude`，不自动合并，等 Claude 裁决。
6. 作者或审计者发现严重问题，给 PR 打 `blocked` 阻止合并。
7. 合并到 main 自动部署（目前仅 Cloudflare Pages；腾讯云 CVM 待备案与预演后再接入）。
8. Grok 定期审计已合并 PR，发现问题开 Issue，由 Gemini 或 GPT 修复。

## 红线
- 不改已发布迁移 0001–0028，新迁移递增编号。
- 不提交密钥、.env、真实客户数据。
- 不绕过测试、不删除或跳过测试来变绿。
- 前端只用同源 `/api/...` 调后端；接口变更先在 Issue 里写契约。
- 省 token：只读相关文件，不通读仓库；回复和评论保持简短。
