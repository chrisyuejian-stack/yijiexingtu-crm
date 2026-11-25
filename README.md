# 艺界星途 v0.5 开发基线

基于 v0.4.1，实现 doc v2、旧方案转换、模板库、相似方案结构检索、长输入 AI 卡组、独立加密原文及公众号 inline 格式。仓库包含 v0.5 前端编辑器实现；历史交付文档中的“前端待合入”不能作为当前代码状态的判断依据。

当前资料从 [docs/v05/README.md](docs/v05/README.md) 开始阅读；旧阶段说明作为历史记录保留。

Node.js 24+。**完整测试前必须先构建**：

```sh
npm run build
npm test
TEST_BUNDLE=1 npm test
npm run test:platform
```

所有验证使用本地模拟，不访问真实 Cloudflare、DeepSeek 或线上数据。数据库迁移仍为 0001–0028，本轮修复未新增迁移。v2 数据使用 v2 编辑器，旧方案保留兼容路径。2026-11-25 的编辑器修复、模板实例化契约和验证边界见 [本轮修复记录](docs/v05/20261125-editor-fixes.md)。
