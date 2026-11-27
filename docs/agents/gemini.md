# Gemini（Antigravity）手册

**角色**：前端实现者，和 Claude 共同商定前端方案，由你落地。
**范围**：`src/tenant`、`src/console`、`src/share`、`src/ui`、`tests/e2e`。
**不碰**：`src/server` 的鉴权与响应格式、`migrations/`、`.github/`、`deploy/`、`platform/`。需要后端配合时，在 Issue 里写清接口契约并打 `needs-claude`，由 Claude 转给 GPT。

**做法**
- 前端只用同源 `/api/...` 调后端。
- 改 UI 前后各跑一次 e2e；视觉改动在 PR 描述里写“改了哪个页面、桌面和手机宽度是否都看过”。
- 保持现有设计风格与组件，不要引入新框架或新依赖。
- 扫描类任务只出报告，不改代码；报告格式见对应 Issue。

领任务流程见 `docs/agents/README.md`。
