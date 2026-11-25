# 2026-11-25 v0.5 编辑器修复

基线为 8c2c8b8，按用户实际浏览器复测的十项清单收敛。本轮没有数据库迁移，没有放宽未定价价目表课程的服务端校验，没有运行腾讯云部署。

## 契约与行为

1. **模板实例化**：保留模板学科；选择模板时同步学科选项，提交时再校验一致性。预览中的不可用课程须用户明确确认后转为自由课程、价格另议，并保留原数量及课程来源。取消则不创建；其他阻断项仍阻止创建，不能未经处理直接提交。
2. **二维码**：文档渲染同时支持服务端给出的 brand.qr_url 和编辑器使用的 qr_image_id，覆盖导出渲染数据与分享页共用的渲染器。
3. **元信息**：v2 新建、保存、发送、改价、恢复、复制、转学员、签约、归档响应统一补齐完整编辑器数据；前端保存时合并元信息。读取响应包含 price_list_rev，打开编辑器即可初始化价格修订。
4. **Escape**：更多菜单消费 Escape 并恢复触发器焦点；方案、内容、报告编辑器忽略已经处理的事件、子弹层和输入态。
5. **自由课程确认**：可选自由课程也参加发送/导出前的人工价格确认，与服务端一致。
6. **教学周数**：增加手填周数说明字段，服务端必填规则保持。
7. **快速保存**：不依赖 800ms 试算先返回；保存取消待发试算并使旧请求失效，后到的旧试算不能覆盖新文档和价格修订。
8. **分期与阶段**：切换比例分期默认一期 100%；输入时提示零比例和总和错误，保存前拦截。阶段仍有课程时拒绝删除；可删除时清理课程组、stage_settings、due_dates，附加费和分期改为未分阶段以保留金额，不静默删除费用；附加费提供“未分阶段”选项。
9. **模板管理**：机构模板支持改名和另存；平台示例只读但可另存机构副本。控制台学科包支持查看、改名/说明、导入或替换可移植示例文件、从草稿移除示例；沿用服务端隐私、稳定 key、学科引用、版本及发布校验。
10. **内容与收尾**：空白 inline 标记按 trim 判断；列表/表格输入同步更新正文预览且不重建输入控件；hash 导航清理全屏编辑器及其试算。将 yx-plan2.js 纳入 XSS/CSP 静态检查。

## 校验与历史资料

SHA256SUMS.txt 更新为本轮真实构建的两个 Worker 哈希。两个平台用例原先硬编码 2026-11-18 Worker 哈希，现改为核对仓库的当前 SHA256SUMS.txt；篡改包、路径穿越、回滚、全量加密备份等原断言保留。平台 HTTP 测试输出改到忽略的 work/platform/verification/，不覆盖历史 deploy/verification/platform-e2e.json。

原附件的历史验证、哈希和“前端待合入”等描述按日期阅读；代码中已含 v0.5 前端实现。根 README 和开发日志已更正初次导入时对前端状态的误判。SHA256SUMS_v0.5合并.txt、deploy/baseline-sha256.json 等为旧交付基准，不是本轮修改后的完整源码清单。

## 本轮实际结果

Node.js v24.22.3、npm 11.19.1，先构建再验证：

| 检查 | 结果 |
| --- | --- |
| 构建及 SHA256SUMS.txt | 通过，两个 Worker 校验通过 |
| npm test | 611/611；原 608 项加本轮 3 项接口回归 |
| TEST_BUNDLE=1 npm test | 611/611 |
| npm run test:platform | 50/50 |
| Chromium 组件回归 | 11/11，390px，含二维码双路径、弹层 Escape、模板确认/取消/学科保护、可选课程确认、周数说明、阶段引用清理、分期、快速保存、旧试算回写、inline 和列表表格预览、浮层清理 |
| 真实构建页面流程 | 通过：平台模板 → 确认转自由课程 → 创建 201 → 保存 200 → 优秀方案菜单保留 → Escape 保留编辑器 → hash 导航清理 |

三个 Node 套件失败、取消、跳过均为 0，命令退出码均为 0。完整日志、真实 HTTP/备份证据和机器摘要见 [verification-20261125/](verification-20261125/summary.json)。首次平台复跑的两个失败均为旧哈希断言，修订后已完整复跑通过，没有删除失败用例或关闭校验。原始测试输出保留尾随空白，源码和新增 Markdown/JSON 的空白检查通过。

新增管理入口已有构建/语法与相关服务端模板 CRUD、平台发布及隐私校验覆盖；控制台完整管理页面尚未逐项做浏览器验收。未验证真实打印出的 PDF 文件，二维码回归覆盖其共用渲染器和服务端渲染数据。

## 复现命令

Node.js 24+，先安装运行层的锁定依赖：

```sh
npm ci --prefix deploy/npm --omit=dev --ignore-scripts --no-audit --no-fund --cache /tmp/yxt-npm-cache
npm run build
sha256sum -c SHA256SUMS.txt
npm test
TEST_BUNDLE=1 npm test
npm run test:platform
```

浏览器脚本需要 package.json 中的 @playwright/test 开发依赖及 Chromium；在有系统 Chromium 的机器可指定路径：

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/e2e/v05-ui-regressions.mjs
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/e2e/v05-plan-workflow.mjs
```

第一个脚本检查真实前端组件代码，第二个脚本使用真实构建页面、构建 Worker、真实本机 HTTP 和一次性 SQLite/R2/身份夹具。两者均使用 390px 视口。它们不代表真实云服务、PDF 文件打印、全套 AI 流程或所有控制台页面的浏览器验收。
