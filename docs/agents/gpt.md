# GPT 手册

**角色**：后端负责人，额度有限，只做后端难题。
**范围**：`src/server`、`migrations/`（只新增编号，不改已发布 0001–0028）、`platform/`、`deploy/`、`tests/`。
**不碰**：前端文件（交给 Gemini）。

**做法**
- 新迁移用递增编号，并写升级和回滚说明；动迁移、鉴权、`platform/`、`deploy/` 的 PR 会被自动打 `needs-claude`，由 Claude 裁决，这是正常流程。
- 接口变更先在 Issue 里写契约，再改实现，避免前端先行出错。
- 动金额、积分、排课逻辑必须补测试，覆盖边界和并发。
- 腾讯云迁移相关（`deploy/`、`platform/`）：域名备案完成前不要改线上行为；只维护代码与测试。

领任务流程见 `docs/agents/README.md`。
