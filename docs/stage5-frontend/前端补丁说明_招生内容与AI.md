# 前端补丁说明：招生内容助手与 AI 接入（阶段 5 前端）

基准：《艺界星途_阶段5_完整源码_20261114.zip》。本补丁是累积补丁，已包含《前端补丁_工作台与分享页_20261114》的全部内容（阶段 5 源码里还没有合入），按原路径覆盖即可。依据冻结接口 v0.3.6。

## 文件

| 文件 | 说明 |
| --- | --- |
| `src/tenant/yx-ai.js`（新） | AI 公共部分：幂等键（网络重试和重复点击复用同一键，“重新生成”换新键）、409 `in_progress` 自动等待取回、错误提示、今日用量、依据标签；课程方案编辑器右栏的 AI 助手 |
| `src/tenant/yx-content.js`（新） | 招生内容列表和三栏编辑器（写什么 / 正文 / AI 建议） |
| `src/tenant/yx-home.js`（新） | 工作台、“招生工具”导航（新增“招生内容”入口）、课程方案列表 |
| `src/tenant/yx-plans.js` | 三栏方案编辑器；接入 AI 面板；保存时带 `applied_suggestion_ids` 和 `expected_price_list_rev`；骨架 `hints` 单独显示为“顾问提示（家长看不到）”，不写回 `goals`、不随保存提交 |
| `src/tenant/yx.css` | 新增样式 |
| `src/tenant/app.js`、`src/tenant/v2a.js` | 同上一个补丁（导航插入、分享页启动、设置页跳转） |
| `src/share/index.html` | 同上一个补丁（加载机构端资源渲染真实分享页） |
| `src/console/app.js` | 平台后台新增“AI 模型”页，调用 `GET/PUT /api/ops/ai/settings`，只填模型名称和默认次数；密钥不在页面出现 |
| `scripts/frontend-bundle.mjs` | 打包末尾追加 `yx-ai.js`、`yx-content.js` |
| `scripts/yx-preview.mjs` | 本机预览用的 AI 桩（`env.AI_PROVIDER`），不进入 dist |
| `tests/yx-frontend-stage2.test.mjs` | 安全扫描加入 `yx-home.js`、`yx-ai.js`、`yx-content.js`；断言 `yxContentEditor`、`yxAi` 已打包 |
| `tests/share-shell-stage5.test.mjs` | 只改一条断言：外壳引用 `/assets/tenant.js` 且不含 `turnstile-key`（原为“不含 tenant.js”）；阶段 5 新增的媒体兼容断言全部保留 |

后端、迁移、构建脚本（build.mjs）都没改；dist 仍为 12 个文件。

## 前端行为要点

- 采用才写入：所有 AI 建议都要人点“采用 / 用这个版本 / 替换”，写进页面后再由人点“保存”；每次采用可撤销。保存请求带采纳的建议 ID。
- AI 调用前：方案要求先保存（AI 读的是库里的工作稿）；招生内容会自动先保存再调用。
- 内容块保存前去掉 AI 的 `basis` 等临时字段，只提交七种块的冻结字段。
- `unsupported` 依据单独列出“资料里找不到依据，请人工核对”，超过 3 条时折叠。
- 课程配法采用时，旧行按 `line_id` 合并原快照，新行保留 `tmp_` ID，`price_list_rev` 作为 `expected_price_list_rev` 随下一次保存提交。
- 错误：429 额度满 / 并发、502 不计次、503 `configuration_missing`（提示“AI 还没开通”）、403 `tenant_expired` 进入停用页。

## 验证

阶段 5 源码 + 本补丁：`npm run build` 通过；`npm test`、`TEST_BUNDLE=1 npm test` 均为 421/422，唯一失败为下面这条依赖时刻的旧测试（北京时间 11-15 晚运行）。

另发现一条与本补丁无关、依赖当前时刻的旧测试：`tests/stage4-review.test.mjs`「第四阶段复核 P1：本月出勤/标准/成本/课程/调整/学费变化均使指纹失效」。它在“今天 09:00”建课，北京时间 9 点以后运行时会先报“已开始但仍有学员待销课”，断言失败。阶段 4 原版源码在同一时刻也失败。建议后端在测试里固定时钟或把课程放到未来时刻。
