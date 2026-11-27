# 协作流程与标签

GitHub 是唯一协作面：任务 = Issue，交付 = PR，状态 = 标签。聊天里说过的话不算数，要写进 Issue 或 PR。
一个 PR 只做一件事，一个角色只改自己的目录。

## 标签
| 标签 | 含义 | 谁打 |
|---|---|---|
| `task` | 任务 Issue | Claude |
| `role:claude` `role:gemini` `role:grok` `role:gpt` | 谁来做 | Claude |
| `in-progress` | 已被认领 | 认领者 |
| `risk:high` | 高风险：钱、权限、工作流、生产、数据库结构、域名 | 分流自动打 |
| `needs-claude` | 等待 Claude 裁决，不自动合并 | 分流自动打，或任何人 |
| `blocked` | 发现严重问题，阻止合并（必须评论原因） | 作者或审计者 |
| `hold` | 暂缓合并 | 你 |

## 合并规则（`scripts/automerge-policy.mjs`，带测试，默认不合并）
以下任一情况都不自动合并：草稿、CI 未通过、带 `blocked`/`needs-claude`/`hold`/`risk:high` 标签、
改动了高风险路径（迁移、工作流、部署、平台层、依赖、构建脚本、鉴权类服务端文件）、改动文件列表取不到。
其余 CI 全绿的 PR 自动 squash 合并并部署。

## 独立性
实现者不能验收自己的 PR：`blocked`/审计结论应由实现者以外的角色给出。
目前所有 AI 共用同一个 GitHub 身份，此条先作为约定遵守。

## 唤醒方式
- Gemini：没有 GitHub 触发入口，由主人说“做 issue #N”，或它自己读 `GEMINI.md`。
- Grok、GPT：若有 Cursor 云端代理或 Codex，可在 Issue/PR 评论里 `@cursor`、`@codex` 加任务；否则由主人说一句话。
- Claude：订阅 PR 事件，被叫醒后自己处理。
