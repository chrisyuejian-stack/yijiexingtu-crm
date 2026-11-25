# P4 审查复跑

需要 Node24+，`npm ci`，Chromium（可用 CHROME_PATH 调整的原 e2e 配置；本目录审查脚本默认 /usr/bin/chromium）。先 `npm run build`。常规六项新增测试由 `npm test` 和 `TEST_BUNDLE=1 npm test` 自动执行；`TEST_BUNDLE=1 npm run test:e2e` 覆盖最终 Pages 构建。

下面的长审查脚本不会自动加入单元回归。P4_BASELINE 指向另外解压的、不可修改的第五轮源码根目录，且其本地前端构建依赖可用。不要指向线上地址。默认报告写入 docs/p4，重复运行会覆盖相应原始记录；需要保留时设 P4_OUTPUT 到另一目录（页面/SQL/写操作脚本为固定 docs/p4）。所有测试控制接口都绑定 loopback 并要求每次随机的控制密钥，不进入 Pages 构建。

```bash
P4_BASELINE=/absolute/fifth/source node tests/p4/request-budget.mjs
P4_BASELINE=/absolute/fifth/source node tests/p4/modal-budget.mjs
P4_BASELINE=/absolute/fifth/source node tests/p4/large-query-plan.mjs
P4_BASELINE=/absolute/fifth/source node tests/p4/page-comparison.mjs
node tests/p4/write-profile.mjs
node tests/p4/payment-confirm-profile.mjs
node tests/p4/api-examples.mjs
```

modal-budget 可用 P4_ROLES（逗号分隔）、P4_ROUTES、P4_OUTPUT 缩小补测；P4_SERVER 可指向本目录 seeded-server.mjs 绝对路径；P4_KIND=attendance/makeup/scheduling 选择待确认销课、已确认请假、模板/预收种子。种子通过真实业务 API 建立，随后只打开/关闭页面，不点击保存或删除。脚本中的测试账户和图片都为虚构。

例如课程详情为个人内页，没有 role=dialog；脚本已改按 heading 和返回按钮验证。历史原始记录保留了此前脚本定位失败，最终有效预算表使用个人端补测成功结果，不把定位失败当产品缺陷。
