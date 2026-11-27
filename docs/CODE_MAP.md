# 代码地图（CODE_MAP）

> 用于按目录、模块、路由与符号快速定位代码，避免通读大文件。全仓路径均基于真实文件生成。

## 1. 顶层目录总览
- `src/server/`：Cloudflare Worker 服务端业务逻辑、路由分发、D1 仓库层、加解密、AI 代理与定时备份。
- `src/tenant/`：机构端租户工作台、老师/学员/家长移动端与旧/新版前端页面及样式。
- `src/console/`：平台管理控制台（机构生命周期、学科/风格包、AI 配额、推广中心、备份恢复）。
- `src/share/`：无需登录的课程方案公开分享落地页 HTML 壳（加载 `/assets/tenant.js` 渲染 `/s/{token}`）。
- `src/ui/`：无框架共享基础 UI 组件库（按钮、表单、抽屉、弹窗、日历、分页、表格与设计 Token）。
- `platform/`：腾讯云 CVM / Node 24 运行时适配层（SQLite/D1 兼容桥、COS 对象存储、调度与发布验证）。
- `deploy/`：腾讯云 CVM 安装、Nginx/Systemd 配置、灰度回滚与生产迁移部署脚本。
- `migrations/`：按编号递增的 D1/SQLite 数据库迁移脚本（`0001`–`0028`，已发布迁移只追加不修改）。
- `tests/`：Node 原生单元测试（源码与 `TEST_BUNDLE=1` 打包双模式）、`platform/` 平台测试与 `e2e/` Playwright 验收。
- `scripts/`：本地打包 (`build.mjs`)、前端资源清单 (`frontend-bundle.mjs`)、预览 (`dev.mjs`)、e2e 服务与巡检脚本。

## 2. 服务端模块（`src/server/`）
- `src/server/worker.js` (1227L)：Worker 入口、静态资源校验、控制台与租户路由分发及统一错误处理 | `default`
- `src/server/repo.js` (7663L)：D1/SQLite 数据访问与审计/事务封装仓库 | `repo`
- `src/server/auth.js` (385L)：租户 Cookie 会话、登录/改密、Cloudflare Access 与平台管理鉴权 | `cookieName, readCookie, sessionCookie, clearCookie, tenantSessionHash, authenticate, loginTenant, changeTenantPassword, requireAccess, platformCookie, authenticateAdmin, consultantEnrollment, platformAuth`
- `src/server/identity.js` (255L)：统一错误契约、多机构选区根登录与家长范围校验 | `ROOT_COOKIE, identityLabels, identityPath, identityErrorCode, identityRoot, clearRootCookie, identityTenant, identityParentScope, identityOps`
- `src/server/permissions.js` (324L)：模块定义、RBAC 权限矩阵校验与脱敏记录投影 | `modules, can, publicUser, projectRecord`
- `src/server/core.js` (172L)：HTTP 错误类型、时间戳、随机 ID、Base64/SHA 与基础输入校验 | `HttpError, fail, now, bytes, b64, unb64, randomId, textBytes, equal, sha, json, string, integer, phone`
- `src/server/crypto.js` (202L)：HMAC 手机号索引、AES 加解密、PBKDF2 密码摘要与 TOTP 验证 | `hmac, phoneIndex, platformPhoneIndex, encrypt, decrypt, digestPassword, newPassword, weakPasswordCount, validatePassword, temporaryPassword, base32, totp, verifyTotp`
- `src/server/security.js` (44L)：查询返回对象脱敏计数（不含金额与原文） | `responseRecordCount, readResponseCount, accountReadResponse`
- `src/server/accounts.js` (140L)：员工/管理员账号创建与重设密码校验 | `requireCan, rolesInput, createAccount, resetAccount`
- `src/server/tenant.js` (52L)：租户 slug 合法性校验与多路径/域名解析 | `validSlug, resolveTenant`
- `src/server/tenant-lifecycle.js` (113L)：机构停用、恢复与冷却期彻底删除命令 | `PURGE_COOLDOWN_MS, platformCommand, tenantLifecycle`
- `src/server/d1-limits.js` (104L)：D1 UTF-8 字节预算、审计分块与绑定数量守卫 | `D1_VALUE_BUDGET, D1_RECORD_BUDGET, AUDIT_PAIR_BUDGET, BRAND_IMAGE_BUDGET, MANIFEST_BUDGET, LEGACY_ROW_BUDGET, byteLength, boundedText, storedRecord, auditChunks, jsonChunks, checkBindings, assertPattern`
- `src/server/request-timing.js` (52L)：单请求 D1 SQL 次数/耗时与 `Server-Timing` 统计 | `measureDatabase, apiTiming`
- `src/server/numbers.js` (75L)：HTTP 边界元与分整数转换（库内统一整数分） | `moneyIn, quantityIn, moneyOut, multiplyCents`
- `src/server/read-batch.js` (34L)：租户端白名单并发读取合并执行器 | `validateReadPaths, readBatch`
- `src/server/scheduling.js` (1242L)：业务基础资源 CRUD、排课冲突检查、固定排课与补课规范化 | `resources, day, nextDay, occupiesSchedule, scheduleConflicts, conflicts, addStudentSummaries, fixedRulesView, scheduleView, reorderBusiness, businessApi, generateTemplates, normalizeMakeupLesson, prepareMakeupLesson`
- `src/server/absence.js` (24L)：缺勤默认扣课与计酬规则共用读取 | `DEFAULT_ABSENCE_POLICIES, effectivePolicies`
- `src/server/makeup-planning.js` (410L)：请假待补课智能时段推荐与冲突预查 | `makeupPlanning`
- `src/server/reviews.js` (604L)：教师点名/点评提案、教务确认退回与对外课表汇总 | `reviewApi, timetableApi`
- `src/server/credits.js` (1112L)：课时包、缴费分配、欠课回补与预收余额冲正/兑换 | `reconcileStatus, creditApi, reviewedAttendanceChanges, attendanceLockMonths, creditPreview`
- `src/server/credit-funds.js` (250L)：旧版收款兼容分配与预收资金流水操作 | `allocateLegacyPayment, fundsRoute, readFunds, changeFunds`
- `src/server/debt.js` (53L)：欠课上限与同范围欠课自动回补匹配 | `DEFAULT_MAX_DEBT_UNITS, maxDebtUnits, roundUnits, validForLesson, matchesDebtScope, repayDebts`
- `src/server/finance.js` (1223L)：月度课酬核算、锁月结算审批、其他成本与收入报表 | `monthIn, calculatePayroll, occurredReport, financeApi`
- `src/server/tools.js` (588L)：班级、线索、跟进任务、转介绍、续费提醒与系统消息 | `toolResources, LEAD_STAGES, RENEWAL_DEFAULTS, renewalSettings, toolsApi`
- `src/server/promo.js` (1083L)：平台推广中心、合作课报名与物料海报发放 | `PROMO_LABELS, promoTenant, promoConsole`
- `src/server/imports.js` (315L)：Excel 导入模板、预览校验与原子提交 | `IMPORT_HEADERS, importsApi`
- `src/server/legacy-import.js` (532L)：旧系统教育 JSON 业务数据迁移转换 | `LEGACY_TABLES, convertLegacy`
- `src/server/xlsx.js` (314L)：轻量 OOXML `.xlsx` 读写与公式注入防护 | `moneyCell, workbook, readWorkbook`
- `src/server/backup.js` (267L)：全库加密分段备份、校验清理与增量续传 | `backupConfig, seal, open, startBackup, continueBackup, backupManifest, backupPage, cleanupPromoUploads, default`
- `src/server/backup-model.js` (2601L)：全库表白名单、加密导出/恢复模型与旧表映射字典 | `CREDIT_TABLES, creditTables, backupTables, restoreTables, BUSINESS_SETTINGS, TABLE_LABELS, IMPORT_SHAPES, BACKUP_STATUS_LABELS`
- `src/server/admin-tools.js` (551L)：控制台机构导出作业、分批恢复与平台操作辅助 | `adminTools`
- `src/server/purge-schema.js` (80L)：彻底删机构时按外键子前父后顺序清理全表清单 | `PURGE_TABLES`
- `src/server/student-nickname.js` (13L)：学员复姓识别与默认隐私昵称生成 | `compoundSurnames, defaultNickname, studentNickname`
- `src/server/student-pinyin-data.js` (1131L)：汉字拼音与多音字静态查表（供排课选学员检索） | `PINYIN_PRIMARY, PINYIN_VARIANTS`
- `src/server/student-search.js` (67L)：学员姓名全拼/首字母检索键生成 | `studentSearchKeys, withStudentSearchKeys`
- `src/server/presentation.js` (118L)：状态中文标签、北京时间格式化与模块/操作字典 | `LESSON_LABELS, ATTENDANCE_LABELS, REVIEW_LABELS, SUBMISSION_GRACE_MS, lessonWindow, beijingTime, MODULE_LABELS, ACTION_LABELS, AUTH_EVENT_LABELS, EXPORT_KIND_LABELS, RATE_UNITS`
- `src/server/rebuild.js` (356L) & `src/server/rebuild3.js` (225L)：v2 工作台聚合读接口（`/api/c2/*` 与 `/api/c3/*`） | `rebuildApi`, `rebuild3Api`
- `src/server/plans.js` (963L)：课程方案 CRUD、发送/签约/归档、分享短链 `/s/{token}` 与家长端查看 | `planPath, plansPublic, plansApi`
- `src/server/plan-document.js` (399L)：v1 课程方案字段规范化、资源引用与数据准备 | `planIso, planText, planArray, stringList, requestedSources, preparePlan, planImages`
- `src/server/plan-math.js` (166L)：v1 方案周期月数与分整数计价汇总 | `planValidation, planDate, calendarWeeks, coveredMonths, quantityHundredths, planMoney, centsProduct, allocateCents, quantityKeys, computePlan, computedResponse`
- `src/server/plan-view.js` (141L)：v1 方案编辑态/渲染态投影与合规校验 | `editorPlan, renderPlan, planCheck`
- `src/server/plan-prospects.js` (39L)：未建档意向学员 (`prospect:`) 存取与转正数据映射 | `normalizeProspect, storedProspect, readProspect, prospectLead, conversionData`
- `src/server/plan-skeleton.js` (106L)：按阶段类型、节点日历与学员年龄生成阶段骨架 | `buildSkeleton`
- `src/server/plan-v2-schema.js` (5L) & `src/server/plan-v2-text.js` (5L)：v0.5 方案冻结结构契约与文本辅助 | `v2Shape, v2PortableShape`, `v2Text`
- `src/server/plan-v2-convert.js` (46L)：v1/v2 方案结构互转与空白 v2 模板初始化 | `v2Modules, v2Titles, canonical, blankV2, convertV1, reverseInitialV2`
- `src/server/plan-v2-fields.js` (23L) & `src/server/plan-v2-references.js` (16L)：v2 教师/图片/资料引用抽取 | `v2TeacherIds, v2Images, v2Sources, v2Declarations`, `structuralReferences`
- `src/server/plan-v2-dates.js` (17L) & `src/server/plan-v2-math.js` (71L)：v2 整体日期平移与 `price_tbd` 分期计算 | `shiftDate, shiftV2`, `computeV2`
- `src/server/plan-v2-document.js` (135L) & `src/server/plan-v2-view.js` (58L)：v2 文档校验、编辑投影、检查与渲染输出 | `validateV2Input, prepareV2, validateV2Shape, validatePortableShape`, `editorV2, checkV2, renderV2`
- `src/server/plan-v2-operations.js` (51L)：v2 `brief`/`reference`/`quote-preview`/`shift-dates` 扩展路由 | `v2ExtraPath, v2Hash, versionConflict, readBrief, readReference, v2EditorResponse, v2Extras`
- `src/server/plan-v2-ai.js` (117L) & `src/server/plan-v2-cards.js` (71L)：v2 方案 AI 上下文、建议卡解析与采用校验 | `planV2AiContext, planV2Protocol, budgetCandidate, filterPlanV2`, `cardFields, cardBefore, applyCard, verifyAdoptedCards`
- `src/server/plan-v2-templates.js` (110L) & `src/server/plan-v2-samples.js` (38L)：机构方案模板库及优秀示例转换 | `planTemplatePath, applicability, freshTemplateDoc, sanitizeTemplate, resolveTemplate, planTemplatesApi`, `validateSamplePlans, portableToDoc`
- `src/server/content.js` (120L)、`content-document.js` (178L)、`content-flags.js` (45L)、`content-inline.js` (29L)：招生内容列表 CRUD、块文档与广告法词汇提醒 | `contentPath, contentApi`, `prepareContent, contentDto`, `AD_TERMS, contentFlags`, `normalizeInline, inlinePlain, inlineText`
- `src/server/growth.js` (687L)、`growth-feedback.js` (135L)、`growth-ai.js` (405L)：课后反馈延伸、曲目单、成长报告批次与 AI 起草 | `growthPath, growthApi`, `feedbackAliases, feedbackPersonal`, `growthProtocol, growthAiBatch`
- `src/server/ai.js` (311L)、`ai-context.js` (196L)、`ai-filter.js` (519L)、`ai-policy.js` (30L)：租户 AI 统一入口、资料白名单上下文、安全与配额控制 | `aiPath, aiApi, aiOps`, `privateSafe, aiContext`, `normalizeContentPayload, filterAi`, `aiTimeoutMs, aiFault`
- `src/server/tool-settings.js` (889L)、`subject-packs.js` (202L)：学科模板包、报价课程、阶段规则、图库与一句话改设置 | `toolSettingsPath, toolSettingsApi, validateSettingProposal`, `stageRuleKeys, subjectPacks`
- `src/server/gallery-storage.js` (29L)：机构图库容量统计与配额校验 | `DEFAULT_GALLERY_LIMIT, storageFull, refreshGalleryStorage, requireGalleryCapacity`
- `src/server/style-assets.js` (45L)、`style-package.js` (191L)：风格包静态资源鉴权读取、ZIP 解析与对比度校验 | `styleAssetPath, styleAssetsApi`, `assetPath, contrast, stylePackage`
- `src/server/platform-ops.js` (469L)、`platform-validation.js` (141L)、`platform-preview-data.js` (147L)：控制台学科包/风格包发布与机构 AI 配额接口 | `styleImage, platformOps`, `docTypes, packVersion, subjectInput`, `planPreview`

## 3. 前端模块（`src/tenant/`、`src/console/`、`src/share/`、`src/ui/`）
- `src/tenant/index.html` (18L)：租户端页面入口骨架，挂载 `#root` 与 `#toast`。
- `src/tenant/app.js` (7731L)：租户端核心外壳、请求缓存合批、权限判断及业务页面（按功能分段）：
  - L1–L361：DOM 工具、请求队列合批 (`api`/`flushBatch`)、表单提交包装 (`submit`)
  - L362–L1365：登录入口 (`login`)、强制改密 (`changePassword`)、桌面/移动主壳导航路由 (`shell`)、全局搜索
  - L1366–L2638：旧版首页 (`home`)、账号/设备 (`accounts`/`devices`)、日志、档案与基础资料 CRUD (`recordsPage`/`recordForm`)
  - L2639–L3397：通用抽屉排版 (`standardForm`)、排课/冲突预查 (`lessonForm`/`liveConflicts`)、学员选择器、模板与设置入口
  - L3398–L4969：学员/课时包/缴费 (`creditPage`)、月结与财务记录 (`financePage`/`financeRecords`)、财务报表 (`reportsPage`)
  - L4970–L5955：个人端壳 (`personalShell`)、教师/学员旧课表与点名 (`reviewScreen`)、教师核对队列与对外课表图 (`timetableImage`)
  - L5956–L7731：班级 (`classesPage`)、合作升学推荐 (`referralsPage`)、续费提醒 (`renewalsPage`)、Excel 导入向导、推广中心 (`promoCenter`)
- `src/tenant/c2.js` (1837L)：十阶段前组件桥接 `ChannelRebuild`（L1–L745 课表/待办/点名卡片、L746–L1065 学员视角课程、L1066–L1735 待办与跟进分组、L1736–L1837 手工补课）。
- `src/tenant/c3.js` (2857L)：呈现层重组（L1–L425 招生统计与搜索框、L426–L1191 财务与课时包表格、L1192–L2303 设置目录与欠课配置、L2304–L2857 个人端与教师点名布局）。
- `src/tenant/calendar.js` (1519L)：时间表引擎 `timeGrid`（L1–L189 冲突重叠分道计算、L190–L613 周/日头部与课程卡片、L614–L1519 北京时间当前线与网格渲染）。
- `src/tenant/v2.js` (1129L)：第十阶段总装 `ChannelV2`（L47–L276 `today`、L277–L496 手机日课表、L497–L645 按学员课表、L646–L1129 课程点名销课面板）。
- `src/tenant/v2a.js` (597L)：账号与权限、角色矩阵、机构信息与筛选操作记录。
- `src/tenant/v2f.js` (758L)：财务模块（收款、课时包、月度结算、其他成本、确认收入/实收报表）。
- `src/tenant/v2m.js` (509L)：教师/学员端手机页面（今日课程、记录与个人中心）。
- `src/tenant/v2p.js` (1166L)：左列表右详情架构（L53–L746 学员详情含档案/课时/课表/方案标签、L747–L1073 教师档案、L1074–L1166 课酬标准）。
- `src/tenant/v2pay.js` (784L)：B1 收款分配抽屉、待核对处理与预收余额兑换。
- `src/tenant/v2promo.js` (972L)：机构端推广中心卡片流、课程长图与申请/海报工具。
- `src/tenant/v2s.js` (609L)：班级名单、固定排课周看板、排课课程与教室管理。
- `src/tenant/v2t.js` (1399L)：业务工作台页（L17–L332 续费提醒、L333–L392 请假待补课、L393–L536 招生线索看板、L537–L877 点名销课/跟进任务、L878–L1215 补课排课、L1216–L1399 线索详情）。
- `src/tenant/v2today.js` (539L)：新版“今天”首页（接下来要做 3 组待办、就地回访、今日课程与平台通知）。
- `src/tenant/yx.js` (590L)：v0.3+ 登录选区页 (`yxLoginPage`/`yxLoginForm`)、家长端壳 (`yxParentShell`) 与家长账号管理 (`yxGuardians`)。
- `src/tenant/yx-home.js` (614L)：招生工作台 `yxHome` 与员工端 `yxNavRework` / 设置子菜单挂载。
- `src/tenant/yx-settings.js` (1212L)：机构设置中心（L80 通用、L202 学科模板、L224 课程价目、L398 阶段规则、L567 节点日历、L633 成长报告维度、L871 档案/图库/主色二维码/修改卡片/一句话改设置）。
- `src/tenant/yx-plans.js` (1206L)：方案列表/编辑器壳（L21 档案页签、L55 编辑器、L562 保存/发送/签约/分享链操作、L819 v1 A4 排版与导出、L1153 家长查看、L1178 公开页 `/s/{token}`）。
- `src/tenant/yx-plan2.js` (1514L)：v2 方案编辑器（L176 左栏 11 板块手风琴、L795 平移日期/机构模板/优秀方案、L910 右栏 AI 方案助手、L1097 v2 A4 自动分页排版）。
- `src/tenant/yx-content.js` (1656L)：招生内容（L21 列表、L138 编辑器、L497 块级文章排版、L738 内容 AI 助手、L1216 导出长图、L1420 行内富文本、L1584 50 步撤销重做）。
- `src/tenant/yx-ai.js` (452L)：AI 共用卡片组件、请求轮询与方案 AI 辅助面板。
- `src/tenant/yx-growth.js` (485L)：老师手机端课后反馈、曲目单填写及家长端反馈/报告查看。
- `src/tenant/yx-reports.js` (864L)：成长报告批次管理、多维评分编辑器、雷达图排版与导出。
- `src/tenant/app.css` (4276L)、`rebuild.css` (1387L)、`polish.css` (904L)、`v2.css` (5060L)、`yx.css` (2738L)、`yx-theme.css` (1085L)：租户端分层样式表（分别对应基础、第十阶段重构、视觉微调、v2 页面、招生工具与 v3 设计系统）。
- `src/console/index.html` (17L) & `src/console/app.css` (848L)：平台控制台入口页与深蓝导航/表格样式。
- `src/console/app.js` (4072L)：控制台全功能实现（L1–L1906 鉴权/机构总览/公告/日志/安全告警/备份恢复工具、L1907–L2396 租户功能与风格包、L2397–L2748 学科模版包与图库/AI 配额、L2749–L4072 推广中心发布与顾问账号管理）。
- `src/share/index.html` (18L)：公开分享页 HTML 壳，通过 `/assets/tenant.js` 渲染只读学习方案。
- `src/ui/tokens.css` (110L)、`components.css` (1340L)、`icons.svg` (37L)：设计变量、基础组件样式与 SVG 图标雪碧图。
- `src/ui/components.js` (2017L)：共享 UI 组件（L24–L402 按钮/表单/提示/Toast、L403–L591 弹窗与抽屉、L592–L968 下拉/日历/分页、L969–L1684 增强数据列表 `dataList`、L1685–L2017 骨架/菜单/月选择器）。

## 4. API 路由速查（提取自 `src/server/worker.js`）
| 域 | 路径前缀/端点 | 方法 | 处理文件 |
|---|---|---|---|
| 控制台管理 | `/api/me`, `/api/logout`, `/api/platform/accounts`, `/api/platform/features/referrals`, `/api/logs`, `/api/alerts`, `/api/tenants/*` | GET/POST/PUT/PATCH | `src/server/worker.js` (`consoleApi`), `auth.js`, `accounts.js` |
| 控制台运营与数据 | `/api/promo/*`, `/api/backups/*`, `/api/announcements*`, `/api/referrals*`, `/api/subject-packs*`, `/api/style-packs*`, `/api/ai/*`, `/api/tenants/*/jobs*` | GET/POST/PUT/DELETE | `src/server/platform-ops.js`, `promo.js`, `admin-tools.js`, `backup.js` |
| 公开与分享页 | `/api/public/brand`, `/api/public/theme.css`, `/api/share/{token}*`, `/s/{token}*` | GET | `src/server/worker.js`, `plans.js` (`plansPublic`) |
| 统一身份与登录 | `/api/login`, `/api/auth/login`, `/api/auth/status`, `/api/auth/select`, `/api/parent/*` | GET/POST | `src/server/auth.js`, `identity.js` |
| 账号与合批 | `/api/me`, `/api/logout`, `/api/password`, `/api/accounts*`, `/api/rights`, `/api/settings`, `/api/logs`, `/api/sessions*`, `/api/read-batch` | GET/POST/PUT/DELETE | `src/server/worker.js`, `read-batch.js`, `accounts.js` |
| 排课与基础资料 | `/api/data/*`, `/api/schedule*`, `/api/schedule-templates`, `/api/schedule-next`, `/api/templates/generate`, `/api/reorder`, `/api/absence-policies` | GET/POST/PUT/PATCH/DELETE | `src/server/scheduling.js` |
| 点名审核与课表 | `/api/lessons/*`, `/api/submissions*`, `/api/brand-timetable` | GET/POST/PUT | `src/server/reviews.js` |
| 课时与财务 | `/api/credits/*`, `/api/finance/*`, `/api/export` | GET/POST/PUT/DELETE | `src/server/credits.js`, `credit-funds.js`, `finance.js` |
| 工具与推广导入 | `/api/tools/*`, `/api/system-messages*`, `/api/promo*`, `/api/imports/*`, `/api/c2/*`, `/api/c3/*` | GET/POST/PATCH/DELETE | `src/server/tools.js`, `promo.js`, `imports.js`, `rebuild.js`, `rebuild3.js` |
| 招生工具 & AI | `/api/plans*`, `/api/content*`, `/api/growth*`, `/api/ai/*`, `/api/settings/*`, `/api/gallery*`, `/api/styles/*` | GET/POST/PUT/PATCH/DELETE | `src/server/plans.js`, `content.js`, `growth.js`, `ai.js`, `tool-settings.js`, `style-assets.js` |

## 5. 数据库迁移（`migrations/` 0001–0028）
- **底座与权限**：`0001_foundation.sql`（租户/用户/会话/日志/平台管理员）、`0002_security_review.sql`（清理历史越权配置）。
- **排课与课消财务**：`0003_scheduling.sql`（学员/教师/课程/教室/排课模板/课次/课时包）、`0004_credits.sql`（分期/流水/缴费/补课/月结）、`0005_integer_money.sql`（金额转整数分）、`0006_finance.sql`（课酬标准/成本/结算快照）、`0007_settlement_fingerprint.sql`（锁月防竞态指纹）、`0008_mobile_reviews.sql`（点名提案与点评）、`0014_debt_and_balance.sql`（欠课与预收账本）、`0018_credit_income_and_schedule_guards.sql`（确认收入账目）。
- **运营工具、性能与生命周期**：`0009_tools.sql`（班级/线索/跟进/公告/备份恢复作业）、`0010_promo.sql` & `0011_promo_image_limits.sql`（推广中心/合作课/图片配额）、`0012_ui_rebuild.sql` & `0013_promo_rebuild.sql`（续费提醒/推广改版）、`0015_delete_capabilities.sql`（导出/彻删机构作业）、`0016_page_query_indexes.sql` & `0017_student_schedule_indexes.sql`（分页与学员课表索引）。
- **艺界星途 v0.3–v0.5**：`0019_identity_and_institutions.sql`（平台手机索引/家长关联/学科）、`0020_settings_and_templates.sql`（报价课程/阶段节点/图库/设置修改卡）、`0021_course_plans.sql` & `0026_plan_prospects.sql` & `0028_plan_v2.sql`（课程方案/分享链/风格包/纯意向/v2 方案模板）、`0022_content_and_ai.sql` & `0025_article_metadata.sql`（招生内容与 AI 配额）、`0023_feedback_and_growth_reports.sql`（反馈与成长报告）、`0024_platform_management.sql`（平台模板与风格包版本）、`0027_gallery_storage.sql`（图库容量统计）。

## 6. 测试索引（`tests/`）
- **浏览器端到端验收 (`tests/e2e/`)**：
  - `attendance.spec.mjs` (`SCN-001` 点名退回/重提/确认)、`makeup.spec.mjs` (`SCN-002` 请假补课闭环)、`scheduling.spec.mjs` (`SCN-003` 排课冲突与多端课表)、`payments.spec.mjs` (`SCN-004` 多包缴费与冲正)、`balance.spec.mjs` (`SCN-005` 预收兑换与退款)、`concurrency.spec.mjs` (`SCN-006` 并发预收竞态)、`settlement.spec.mjs` (`SCN-007` 月结锁月重审)、`reversal-used.spec.mjs` (`SCN-008` 已使用预收拦截)、`authentication.spec.mjs` (`SCN-009` 五类账号登录/首次改密/退出失效)。
- **平台与部署测试 (`tests/platform/`)**：`bridge-assets.test.mjs`, `cos.test.mjs`, `d1.test.mjs`, `e2e.test.mjs`, `migration.test.mjs`, `operations.test.mjs`, `releases.test.mjs`, `scheduler-config.test.mjs`。
- **接口与前端单元回归 (`tests/*.test.mjs`)**：
  - 鉴权/安全/隔离：`access-mode`, `turnstile-mode`, `identity-stage2`, `p3-auth`, `p3-relations`, `isolation`, `security`, `session-navigation`, `rights-batch`, `d1-limits`, `automerge-policy`。
  - 排课/财务/工具/推广：`scheduling`, `makeup-planning`, `student-schedule`, `credits`, `credits-budget`, `debt-and-balance`, `finance`, `finance-budget`, `tools`, `tools-budget`, `imports`, `backup`, `delete-capabilities`, `promo`, `promo-budget`, `promo-final`, `stage4-review`, `stage7`, `platform-stage7`, `platform-integrity-stage7`。
  - 艺界星途 v0.3–v0.5：`settings-stage3`, `plans-stage4`, `plans-stage4-integrity`, `plan-v2`, `plan-v2-templates`, `plan-v2-validation`, `plan-v2-ai`, `plan-v2-integrity`, `v05-editor-regressions`, `content-stage5`, `content-inline-v05`, `content-metadata-v039`, `content-ai-stage5-integrity`, `ai-stage5`, `ai-v041`, `feedback-stage6`, `growth-stage6`, `growth-ai-stage6`, `growth-integrity-stage6`, `growth-v041`, `storage-v041`, `v040`。
  - 前端 UI 与性能：`ui-foundation`, `ui-backend`, `ui-c1`, `ui-c2`, `ui-c3`, `ui-c-review`, `ui-stageb`, `ui-v2`, `console-v2`, `mobile`, `mobile-ui`, `yx-frontend-stage2`, `share-shell-stage5`, `skeleton-hints-stage5`, `page-performance`, `p4-performance`, `query-budget`, `speed-backend`, `misc-v041`。

## 7. 如何更新本文件
新增或重排文件、导出符号、接口或迁移后，运行下方自检脚本核对路径、分段行号与路由是否与仓库一致，并保持本文总行数 ≤ 600 行：
```sh
node -e 'const fs=require("fs");const t=fs.readFileSync("docs/CODE_MAP.md","utf8");console.log("lines:",t.split("\n").length);for(const m of t.matchAll(/`((?:src|migrations|tests|platform|deploy|scripts)\/[^`\s:*,)]+)`/g)){const p=m[1];if(!fs.existsSync(p)&&!p.includes("*"))console.error("MISSING:",p)}'
```
