# v0.5 前端（Claude，2026-11-18）

基准：GPT v0.5 完整源码。只改了以下前端文件，后端、迁移和测试都没有动：

- src/tenant 下 5 个文件，其中 yx-plan2.js 是新增的 v2 方案编辑器和排版
- scripts/frontend-bundle.mjs：把 yx-plan2.js 加入打包

验证结果：
- `_worker.js` 和 GPT 交付的相同（e2f05982…）
- `npm test` 和 `TEST_BUNDLE=1 npm test` 都是 608/608

请注意：`tests/yx-frontend-stage2.test.mjs` 的文件清单里还没有 `yx-plan2.js`。该文件已经按同样的规则自查过（不用 innerHTML，不写内联 style 属性）。下一版可以把它加进清单。

下一版以这些文件为准。
