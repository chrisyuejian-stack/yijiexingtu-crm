# 艺界星途 v0.5 后端交付

基于已融合最终前端的 v0.4.1，实现 doc v2、旧方案转换、模板库、相似方案结构检索、长输入 AI 卡组、独立加密原文及公众号 inline 格式。前端由 Claude 制作，本轮未改 src/tenant、src/console、src/ui。

当前资料从 [docs/v05/README.md](docs/v05/README.md) 开始阅读；旧阶段说明作为历史记录保留。

Node.js 24+。**完整测试前必须先构建**：

```sh
npm run build
npm test
TEST_BUNDLE=1 npm test
```

所有验证使用本地模拟，不访问真实 Cloudflare、DeepSeek 或线上数据。数据库仅新增 0028 附属表，0001–0027 原样保留。当前前端仍为已验收 v0.4.1，须等待 Claude 合入 v0.5 界面并联合验收后上线；不要把 v2 编辑数据直接投给旧编辑器。
