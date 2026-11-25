import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tenantAssets } from "../scripts/frontend-bundle.mjs";

test("UI重构v2：新页面并入既有两条静态路径，样式最后加载；无内联HTML/样式/原生弹窗/外部字体", async () => {
  const js = await readFile("src/tenant/v2.js", "utf8"),
    css = await readFile("src/tenant/v2.css", "utf8"),
    assets = await tenantAssets();
  assert.ok(assets.js.indexOf("ChannelV2") > assets.js.indexOf("ChannelRebuild"));
  assert.ok(assets.css.trimEnd().endsWith(css.trimEnd()));
  assert.doesNotMatch(js, /\.innerHTML\s*=|\.style\.|setAttribute\(["']style["']/);
  // 只允许共享弹窗 UI.confirm，不允许浏览器原生 alert/prompt/confirm。
  assert.ok(!/(?<![.\w])(?:alert|prompt|confirm)\(/.test(js));
  assert.doesNotMatch(js + css, /fonts\.googleapis|cdn\.jsdelivr|unpkg\.com/);
  assert.ok(!js.includes("toFixed(2)"));
  // 动效规则：只用 transform/opacity，高度动画不新增；有减少动态效果的回退。
  assert.doesNotMatch(css, /transition:[^;]*\bheight\b/);
  assert.match(css, /prefers-reduced-motion/);
});

test("UI重构v2：弹层规则（抽屉560、弹窗480、手机底部升起）与手机五个底部标签", async () => {
  const css = await readFile("src/tenant/v2.css", "utf8"),
    app = await readFile("src/tenant/app.js", "utf8");
  assert.match(css, /\.ui-c1-drawer \.ui-sheet \{\s*width: min\(560px, 100vw\);/);
  assert.match(css, /\.ui-overlay--modal \.ui-sheet \{\s*width: min\(480px/);
  assert.match(css, /max-height: 92dvh;/);
  assert.match(app, /const primaryKeys = \["today", "schedule", "students", "todo"\];/);
  assert.match(app, /el\("span", "更多"\)/);
  // 头像菜单只留修改密码、登录设备、退出。
  const menu = app.slice(app.indexOf("const avatar = UI.actionMenu"), app.indexOf("avatar.element.classList"));
  assert.deepEqual([...menu.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]), ["修改密码", "登录设备", "退出登录"]);
});

test("UI重构v2：今天页与点名面板只调用既有接口，销课/撤销沿用原写入路径", async () => {
  const js = await readFile("src/tenant/v2.js", "utf8");
  const calls = [...js.matchAll(/api\(\s*"([a-z0-9/_-]+)/g)].map((m) => m[1]);
  for (const path of calls)
    assert.ok(
      [
        "c2/home",
        "schedule?from=",
        "finance/receivable-summary",
        "finance/payroll?month=",
        "data/lessons/",
        "lessons/",
        "c2/lessons/",
        "students/",
      ].some((p) => path.startsWith(p.replace(/\?.*/, ""))),
      path,
    );
  assert.match(js, /creditWrite\("lessons\/" \+ data\.id \+ "\/attendance"/);
  assert.match(js, /creditWrite\("lessons\/" \+ data\.id \+ "\/undo"/);
});

test("UI重构v2：续费按“学员+课程”分组选择，复制文字/下载图片后登记提醒（B2/B3 对接）", async () => {
  const app = await readFile("src/tenant/app.js", "utf8"),
    v2 = await readFile("src/tenant/v2.js", "utf8");
  assert.doesNotMatch(app, /selected\.(?:add|delete|has)\((?:row|x)\.package_id\)/);
  assert.match(app, /selected\.add\(row\.id\)/);
  const remind = app.slice(app.indexOf("async function renewalRemind"), app.indexOf("async function renewalNotice"));
  assert.match(remind, /api\("renewals\/remind", "POST"/);
  assert.match(remind, /package_ids: row\.package_ids/);
  assert.match(remind, /row\.reminder_course_type_id/);
  assert.match(app, /renewalRemind\(row, "text"\)/);
  assert.match(app, /renewalRemind\(row, "image"\)/);
  assert.match(v2, /"课时已用完",\s*String\(counts\.renewal_zero\)/);
  assert.ok(!v2.includes("renewal_used_up"));
});

test("UI重构v2：学员/教师页（左列表右详情）只读既有接口，写入沿用原表单；无内联样式", async () => {
  const js = await readFile("src/tenant/v2p.js", "utf8"),
    assets = await tenantAssets();
  assert.ok(assets.js.indexOf("ChannelV2People") > assets.js.indexOf("ChannelV2 ="));
  assert.doesNotMatch(js, /\.innerHTML\s*=|\.style\.|setAttribute\(["']style["']/);
  assert.ok(!/(?<![.\w])(?:alert|prompt|confirm)\(/.test(js));
  const calls = [...js.matchAll(/api\(\s*"([a-z0-9/_-]+)/g)].map((m) => m[1]);
  for (const path of calls)
    assert.ok(
      ["c2/students", "credits/packages", "data/students/", "data/teachers/", "c3/teachers", "schedule", "finance/payroll", "renewal-brand", "tools/followup_tasks/", "accounts/", "finance/rates"].some((p) =>
        path.startsWith(p),
      ),
      path,
    );
  // 写入只有：学员状态/删除、教师删除、跟进完成、联系方式查看、重置密码——均为原有接口。
  for (const m of js.matchAll(/api\(\s*"([^"]+)"[^)]*?"(PATCH|DELETE|POST)"/g))
    assert.ok(/^(data\/students\/|data\/teachers\/|tools\/followup_tasks\/|accounts\/|finance\/rates\/)/.test(m[1]), m[1]);
  // 课酬标准分页：新增/修改沿用原课酬表单，删除沿用原 finance/rates/:id DELETE。
  for (const form of ["recordForm(", "creditForm(", "followupForm(", "renewalNotice(", "timetableImage(", "lessonForm(", 'financeRecordForm(sink(again), "rates"'])
    assert.ok(js.includes(form), form);
  // 手机详情：返回、四个分页（上课记录/课时与缴费/跟进/学习阶段），默认上课记录。
  assert.match(js, /backRow\(\s*"学员"/);
  assert.match(js, /x\[0\] === "overview" \|\| x\[0\] === "more"/);
});

test("UI重构v2：编辑学员/教师时不把打码手机号回填进表单（留空=保留原号码）", async () => {
  const js = await readFile("src/tenant/v2p.js", "utf8");
  assert.match(js, /const unmask = \(row\) => \(\{ \.\.\.row, phone: "", parent_phone: "" \}\)/);
  assert.doesNotMatch(js, /recordForm\([^)]*"(?:students|teachers)", (?:row|rec)\)/);
});

test("UI重构v2：待办角标只算最近30天请假待补课（后端给 makeup_recent 时用它，没给时退回原总数）", async () => {
  const js = await readFile("src/tenant/app.js", "utf8");
  assert.match(js, /"todo-makeup": todoCounts\.makeup_recent \?\? todoCounts\.makeup_pending/);
  assert.match(js, /\(counts\.makeup_recent \?\? counts\.makeup_pending \?\? 0\)/);
  assert.doesNotMatch(js, /\(counts\.makeup_pending \|\| 0\)/);
});

test("UI重构v2：细节打磨——联系方式整段换行、号码原位显示；悬停只在可悬停设备；按压动效有减少动态兜底", async () => {
  const js = await readFile("src/tenant/v2p.js", "utf8"),
    css = await readFile("src/tenant/v2.css", "utf8");
  assert.match(js, /class: "v-detail-sub v-csegs"/);
  assert.match(js, /parentNo\.textContent = r\.parent_phone/);
  const polish = css.slice(css.indexOf("细节打磨"));
  assert.ok(polish.length > 100);
  // 悬停规则全部包在 (hover: hover) 里；过渡只用 transform
  for (const m of polish.matchAll(/^(?! )([^@\n{]*:hover[^{]*)\{/gm)) assert.fail("悬停规则未包在 hover:hover 里：" + m[1]);
  for (const m of polish.matchAll(/transition(?:-property)?:\s*([^;]+);/g))
    for (const part of m[1].split(/,(?![^(]*\))/)) assert.match(part.trim(), /^(transform|opacity|none)\b/, m[1]);
  assert.match(polish, /prefers-reduced-motion: reduce/);
});

test("UI重构v2 第4组：待办（续费、补课）与招生看板只读既有接口，写入沿用原路径与原表单；无内联样式/原生弹窗", async () => {
  const js = await readFile("src/tenant/v2t.js", "utf8"),
    assets = await tenantAssets();
  assert.ok(assets.js.indexOf("ChannelV2Todo") > assets.js.indexOf("ChannelV2People"));
  assert.doesNotMatch(js, /\.innerHTML\s*=|\.style\.|setAttribute\(["']style["']/);
  assert.ok(!/(?<![.\w])(?:alert|prompt|confirm)\(/.test(js));
  for (const m of js.matchAll(/(?:api|take)\(\s*"([a-z0-9/_-]+)/g))
    // 跟进任务改版与点名销课合页只用原有读接口：todo/summary、followup-assignees、c2/followups、tools/followup_notes。
    assert.ok(["c2/renewals", "renewal-brand", "renewal-settings", "c2/makeups", "data/lessons/", "tools/leads", "c3/leads-summary", "todo/summary", "followup-assignees", "c2/followups", "tools/followup_notes", "tools/followup_tasks/", "data/teachers", "data/locations"].some((p) => m[1].startsWith(p)), m[1]);
  const writes = [...js.matchAll(/api\(\s*"([^"]+)"[^)]*?"(PATCH|DELETE|POST|PUT)"/g)].map((m) => m[1] + " " + m[2]);
  // 跟进任务的完成/改期/转交/删除与记一笔，沿用原跟进页的写入路径。
  assert.deepEqual(writes.sort(), ["renewal-settings PUT", "tools/leads/ PATCH", "tools/leads/ POST", "tools/followup_tasks/ PATCH", "tools/followup_tasks/ DELETE", "tools/followup_notes POST", "c2/makeups/ POST", "tools/leads/ PATCH", "tools/leads/ POST", "tools/leads/ POST"].sort());
  // 线索详情改版：阶段/回访/备注沿用 tools/leads/:id PATCH；查看号码 /contact、转正 /convert 沿用原 POST。
  // c2/makeups/:id/check 是只读预查（POST 但不写任何数据）；正式保存仍走 creditWrite("makeups")。
  for (const form of ["renewalNotice(", "followupForm(", "creditForm(", "makeupForm(", "leadForm(", "ChannelC3.leadDetail("])
    assert.ok(js.includes(form), form);
  // 续费：一行一组，按 id 去重，状态优先级 用完 > 快用完 > 即将到期；“全部”不含已过期仍有余额。
  assert.match(js, /if \(!byId\.has\(row\.id\)\) byId\.set\(row\.id, \{ \.\.\.row, state: key \}\)/);
  assert.match(js, /\["zero", "已用完", "bad"\],\s*\["low", "快用完", "warn"\],\s*\["expiring", "即将到期", "info"\]/);
  assert.match(js, /rState\.filter === "all" \? r\.state !== "expired"/);
  // 提醒登记后重新读服务器，不在前端改“上次提醒”。
  assert.match(js, /await original\(row, channel\);\s*await remindHook\?\.\(row\);/);
  assert.doesNotMatch(js, /last_reminded_at\s*=/);
  // 补课：最近 30 天与更早分开。
  assert.match(js, /const cut = dateShift\(todayBJ\(\), -30\)/);
  // 招生：阶段固定 5 个，标签取服务器；拖动沿用 leadMoveAllowed。
  assert.match(js, /const STAGES = \["new", "contacted", "trial", "enrolled", "lost"\]/);
  assert.match(js, /UI\.leadMoveAllowed\(row\.stage, stage\)/);
  assert.doesNotMatch(js, /已约试听/);
});

test("UI重构v2：顶栏分页≥4个时搜索收成放大镜，标题与新建不换行", async () => {
  const css = await readFile("src/tenant/v2.css", "utf8");
  assert.match(css, /\.v-head:has\(\.v-head-tabs > :nth-child\(4\)\) \.v-search \{ display: none; \}/);
  assert.match(css, /\.v-head-tools \.ui-button-face \{ white-space: nowrap; \}/);
});

test("UI重构v2 第5组：财务五个分页只读既有接口，写入沿用原表单/原路径；报表收入默认确认口径并区分 null", async () => {
  const js = await readFile("src/tenant/v2f.js", "utf8"),
    css = await readFile("src/tenant/v2.css", "utf8"),
    assets = await tenantAssets();
  assert.ok(assets.js.indexOf("ChannelV2Finance") > assets.js.indexOf("ChannelV2Todo"));
  assert.doesNotMatch(js, /\.innerHTML\s*=|\.style\.|setAttribute\(["']style["']/);
  assert.ok(!/(?<![.\w])(?:alert|prompt|confirm)\(/.test(js));
  for (const m of js.matchAll(/(?:api|take)\(\s*"([a-z0-9/_-]+)/g))
    assert.ok(["credits/payments", "credits/packages", "credits/transactions", "c3/receipts", "finance/payroll", "finance/settlement", "finance/settlements/", "finance/costs", "finance/tuition/", "c3/costs-summary", "c3/report"].some((p) => m[1].startsWith(p)), m[1]);
  const writes = [...js.matchAll(/api\(\s*"([^"]+)"[^)]*?"(PATCH|DELETE|POST|PUT)"/g)].map((m) => m[1] + " " + m[2]);
  assert.deepEqual(writes.sort(), ["finance/costs/ DELETE", "finance/settlements/ POST", "finance/tuition/ PATCH"].sort());
  for (const form of ["creditForm(", "adjustForm(", "transferForm(", "financeRecordForm(", "settlementForm(", "payrollDetail(", "exportLink("])
    assert.ok(js.includes(form), form);
  // 只接管页面主体；抽屉、学员详情里的同名调用走原实现。
  assert.match(js, /const inPage = \(c\) => !!c\?\.closest\?\.\("\.v-content"\) && !c\.closest\(/);
  assert.match(js, /return old\.creditPage\(c, kind, studentId, \.\.\.args\)/);
  // B1：默认确认收入；旧锁月 earned 为 null 时显示“—”并说明，不当成 0。
  assert.match(js, /basis: "earned"/);
  assert.match(js, /earnedMissing = basis === "earned" && data\.earned_amount === null/);
  assert.match(js, /raw === null \|\| raw === undefined \? 0/);
  // 手机：财务表格变卡片，不横向滑动。
  assert.match(css, /\.v-fin-table \.v-table td::before \{ content: attr\(data-label\);/);
});

test("UI重构v2 第6组：班级（B6 名单）、固定排课看板、课程与教室只读既有接口，写入沿用原表单/原路径", async () => {
  const js = await readFile("src/tenant/v2s.js", "utf8"),
    assets = await tenantAssets();
  assert.ok(assets.js.indexOf("ChannelV2Setup") > assets.js.indexOf("ChannelV2Finance"));
  assert.doesNotMatch(js, /\.innerHTML\s*=|\.style\.|setAttribute\(["']style["']/);
  assert.ok(!/(?<![.\w])(?:alert|prompt|confirm)\(/.test(js));
  for (const m of js.matchAll(/(?:api|take)\(\s*"([a-z0-9/_-]+)/g))
    assert.ok(["tools/classes", "tools/class_members", "c3/classes/", "data/schedule_templates", "data/schedule_enrollments", "data/course_types", "data/course_categories", "data/teachers", "data/locations", "data/"].some((p) => m[1].startsWith(p)), m[1]);
  const writes = [...js.matchAll(/api\(\s*"([^"]+)"[^)]*?"(PATCH|DELETE|POST|PUT)"/g)].map((m) => m[1] + " " + m[2]);
  // 学员报名并入固定排课详情：退出报名沿用原删除接口（data/schedule_enrollments/:id DELETE）。
  assert.deepEqual(writes.sort(), ["data/ DELETE", "data/schedule_enrollments POST", "data/schedule_enrollments/ DELETE", "data/schedule_templates/ DELETE", "tools/class_members/ DELETE", "tools/classes/ POST"].sort());
  for (const form of ["classForm(", "lessonForm(", "recordForm(", "recordForm(P().sink(reopen), \"schedule_enrollments\"", "old.templatesPage(box)"])
    assert.ok(js.includes(form), form);
  // B6：名单读 roster 接口，余额字段缺失时不显示数字。
  assert.match(js, /api\("c3\/classes\/" \+ cls\.id \+ "\/roster"\)/);
  assert.match(js, /roster\.items\.some\(\(r\) => "balance" in r\)/);
  // 保存班级后仍在页面里、选中原班级。
  assert.match(js, /if \(selected\) cState\.selected = selected;/);
});

test("UI重构v2：B7 教师表单可关闭“对外课表图显示”，保存为 0/1", async () => {
  const js = await readFile("src/tenant/app.js", "utf8");
  assert.match(js, /text\("对外课表图显示这位老师的课", "show_in_timetable", "checkbox", "1"\)/);
  assert.match(js, /shown\.checked = row\.show_in_timetable !== 0;/);
  assert.match(js, /d\.show_in_timetable = form\.elements\.show_in_timetable\.checked \? 1 : 0;/);
});

test("UI重构v2 第7组：账号、机构设置、操作记录（B8 筛选）只读既有接口，写入沿用原路径/原表单", async () => {
  const js = await readFile("src/tenant/v2a.js", "utf8"),
    s = await readFile("src/tenant/v2s.js", "utf8"),
    assets = await tenantAssets();
  assert.ok(assets.js.indexOf("ChannelV2Admin") > assets.js.indexOf("ChannelV2Setup"));
  assert.doesNotMatch(js, /\.innerHTML\s*=|\.style\.|setAttribute\(["']style["']/);
  assert.ok(!/(?<![.\w])(?:alert|prompt|confirm)\(/.test(js));
  for (const m of js.matchAll(/api\(\s*"([a-z0-9/_-]+)/g))
    assert.ok(["accounts", "rights", "renewal-brand", "logs"].some((p) => m[1].startsWith(p)), m[1]);
  const writes = [...js.matchAll(/api\(\s*"([^"]+)"[^)]*?"(PATCH|DELETE|POST|PUT)"/g)].map((m) => m[1] + " " + m[2]);
  // 角色权限：一项用原格式，多项一次提交（同一路径 rights PUT）。
  assert.deepEqual(writes.sort(), ["accounts/ POST", "accounts/ POST", "rights PUT", "rights PUT"].sort());
  for (const form of ["newAccount(", "editAccount(", "devices(", "showSecret(", "old.settingsPage(temp"])
    assert.ok(js.includes(form), form);
  // B8：模块、动作作为查询参数传给 logs（只对操作记录）；登录记录不带这两个参数。
  assert.match(js, /if \(lState\.kind === "audit"\) for \(const k of \["module", "action"\]\) if \(lState\[k\]\) q\.set\(k, lState\[k\]\);/);
  assert.match(js, /\["export", "只看导出"\]/);
  // 日期筛选默认为空，不显示成“今天”。
  assert.match(js, /allowEmpty: true/);
  // 机构设置与课程与教室分开：课程与教室只剩 3 项。
  assert.match(js, /location\.hash === "#settings-institution" \? institution\(c, section\)/);
  assert.doesNotMatch(s.slice(s.indexOf("const SETTING_NAV"), s.indexOf("const FORMAT")), /absence|personal/);
});

test("UI重构v2 第8组：教师端/学员端手机页只读既有接口；点名、改密码等沿用原页面；标签按权限显示", async () => {
  const js = await readFile("src/tenant/v2m.js", "utf8"),
    css = await readFile("src/tenant/v2.css", "utf8"),
    assets = await tenantAssets();
  assert.ok(assets.js.indexOf("ChannelV2Mobile") > assets.js.indexOf("ChannelV2Admin"));
  assert.doesNotMatch(js, /\.innerHTML\s*=|\.style\.|setAttribute\(["']style["']/);
  assert.ok(!/(?<![.\w])(?:alert|prompt|confirm)\(/.test(js));
  for (const m of js.matchAll(/(?:api|take|R3take)\(\s*"([a-z0-9/_-]+)/g))
    assert.ok(["finance/payroll", "schedule-next", "credits/packages", "credits/payments", "credits/transactions", "credits/makeups", "logout"].some((p) => m[1].startsWith(p)), m[1]);
  const writes = [...js.matchAll(/api\(\s*"([^"]+)"[^)]*?"(PATCH|DELETE|POST|PUT)"/g)].map((m) => m[1] + " " + m[2]);
  assert.deepEqual(writes, ["logout POST"]);
  for (const reuse of ["reviewScreen(c, row.id, back)", "personalPartner(c, row, back)", "personalPay(c)", "changePassword(", "devices()", "C3().teacherStudents(content)", "scheduleRows("])
    assert.ok(js.includes(reuse), reuse);
  // 教师：课表/我的学生/课酬/我的；学员：课表/上课记录/课时缴费/我的。没有权限的标签不显示。
  assert.match(js, /\["pay", "wallet", "课酬", \(\) => teacherPay\(content\), enabled\("teacher_pay"\)\]/);
  assert.match(js, /\["balance", "wallet", "课时缴费", \(\) => studentBalance\(content\), enabled\("packages"\) \|\| enabled\("tuition"\)\]/);
  assert.match(js, /const shown = views\.filter\(\(v\) => v\[4\]\);/);
  // 课酬明细只算已计酬的课，待销课、未来课单独说明。
  assert.match(js, /l\.status !== "planned" && Number\(l\.amount\) !== 0/);
  // 手机：原表格组件的卡片模式不被旧的 680px 最小宽度撑开。
  assert.match(css, /\.ui-table--responsive \{ min-width: 0; \}/);
});

test("UI重构v2：教师手机课程详情/点名页只重排原页面——原提交按钮与原接口不变，只在个人端生效；提交栏停在底部导航上方", async () => {
  const js = await readFile("src/tenant/v2m.js", "utf8"),
    css = await readFile("src/tenant/v2.css", "utf8");
  // 先跑原页面，再只在个人端重排；管理端（抽屉）里的点评页不受影响。
  assert.match(js, /const oldReview = reviewScreen;/);
  assert.match(js, /await oldReview\(c, id, back\);\s*if \(!c\.closest\?\.\("\.v-personal"\)\) return;/);
  // “全部出勤”逐个点原来的出勤按钮，不另写接口；提交仍是原来的按钮（只改文字并移入提交栏）。
  assert.match(js, /row\.querySelector\('\[data-attendance="attended"\]'\)\?\.click\(\)/);
  assert.match(js, /提交出勤与点评/);
  assert.match(js, /提交后由教务确认，确认后扣课时、计课酬/);
  // 状态与课表列表同一口径。
  assert.match(js, /if \(st === "pending"\) return \["待教务确认", "warn"\];/);
  assert.match(js, /if \(st === "returned"\) return \["已退回", "bad"\];/);
  // 提交栏贴在底部导航上方，不被遮住。
  assert.match(css, /\.v-m-submitbar \{[^}]*position: sticky; bottom: calc\(65px \+ max\(8px, env\(safe-area-inset-bottom, 0px\)\)\)/);
  assert.match(css, /\.v-personal:has\(\.v-m-submitbar\) \{ padding-bottom: 0; \}/);
});
test("推广中心改版（机构端）：只读既有推广接口，申请/名单/上传沿用原表单；会议信息只在员工页面；下载文件名为英文", async () => {
  const js = await readFile("src/tenant/v2promo.js", "utf8"),
    assets = await tenantAssets();
  // 推广文件排在手机端之后（v2.js、app.js 里只有带 ?. 的调用）。
  assert.ok(assets.js.lastIndexOf("ChannelV2Promo") > assets.js.lastIndexOf("ChannelV2Mobile"));
  assert.doesNotMatch(js, /\.innerHTML\s*=|\.style\.|setAttribute\(["']style["']/);
  assert.ok(!/(?<![.\w])(?:alert|prompt|confirm)\(/.test(js));
  for (const m of js.matchAll(/api\(\s*"([a-z0-9/_?=-]+)/g)) assert.ok(m[1].startsWith("promo") || m[1].startsWith("system-messages"), m[1]);
  const writes = [...js.matchAll(/api\(\s*"([^"]+)"[^)]*?"(PATCH|DELETE|POST|PUT)"/g)].map((m) => m[1] + " " + m[2]);
  assert.deepEqual([...new Set(writes)].sort(), ["promo/ POST", "promo/assets PUT", "system-messages/ POST"].sort());
  for (const reuse of ["promoApplication(", "promoRoster(", "promoUpload(", "promoCachedImage(", "promoContain("]) assert.ok(js.includes(reuse), reuse);
  // 同一张图整个使用过程只下载一次（账号每分钟请求数有上限）；合成好的海报也复用。
  assert.match(js, /const load = \(id, fallback\) => promoCachedImage\(id, fallback\);/);
  assert.match(js, /if \(composed\.has\(key\)\) return promoCacheTouch\(composed, key\);/);
  // 下载文件名不用中文（部分浏览器会改成 download）。
  assert.match(js, /download: kind \+ "-" \+ \+\+saved \+ "-" \+ day \+ "\.png"/);
  // 免费、讲座、应付金额、已收款、二维码旁文字：后端字段有就显示，没有就不显示。
  assert.match(js, /row\.is_free === 1 \|\| row\.is_free === true/);
  assert.match(js, /row\.format === "lecture"/);
  assert.match(js, /a\.amount_due \?\?/);
  assert.match(js, /if \(a\.paid !== undefined\)/);
  // 二维码旁文字（0013 起总有该字段）：没上传过素材也能填，最多 12 个字。
  assert.match(js, /if \(\[\.\.\.text\]\.length > 12\) return notice/);
  // 只接管页面主体里的推广中心。
  assert.match(js, /promoCenter = \(c, type, offset\) => \(inPage\(c\) \? home\(c, type\) : oldCenter\(c, type, offset\)\)/);
});
test("推广推送（P7/P8）：今天页枫琴推荐一次一条可“不再提示”；铃铛分“来自枫琴/系统”；招生旁“新 N”；合作升学按平台开关隐藏", async () => {
  const js = await readFile("src/tenant/v2promo.js", "utf8"),
    v2 = await readFile("src/tenant/v2.js", "utf8"),
    app = await readFile("src/tenant/app.js", "utf8"),
    css = await readFile("src/tenant/v2.css", "utf8");
  // 推荐卡：读 promo/recommend，“不再提示”写 promo/:id/dismiss；只对有推广权限的人放进今天页右栏。
  assert.match(js, /api\("promo\/recommend"\)/);
  assert.match(js, /api\("promo\/" \+ item\.id \+ "\/dismiss", "POST", \{\}\)/);
  assert.match(v2, /if \(enabled\("promo"\) && globalThis\.ChannelV2Promo\?\.recommend\) side\.append/);
  // 截止提醒用后端给的 reason，不自己猜。
  assert.match(js, /item\.reason === "deadline"/);
  // 铃铛：按 source 分组；横幅等旧用法仍走原函数。
  assert.match(js, /items\.filter\(\(x\) => x\.source === "fengqin"\)/);
  assert.match(js, /if \(banner \|\| !\(panel \|\| inPage\(c\)\)\) return oldMessages\(c, banner, offset\);/);
  assert.match(js, /systemMessages = messages;/);
  // “新 N”来自铃铛同一份数据（已按权限裁剪），刷新角标时一起更新。
  assert.match(js, /x\.source === "fengqin" && !x\.is_read/);
  assert.match(app, /globalThis\.ChannelV2Promo\?\.navBadge\?\.\(data\);/);
  // 合作升学推荐：平台开关关闭时，所有入口（菜单、学员详情）统一隐藏。
  assert.match(app, /if \(module === "referrals" && me\.features\?\.referrals === false\) return false;/);
  // 推荐卡低调：浅底、无红色；离开动效只用透明度/位移，并有减少动态兜底。
  assert.match(css, /\.v-pr-rec \{[^}]*background: var\(--ui-page\)/);
  assert.match(css, /\.v-pr-rec\.is-leaving \{ opacity: 0; transform: translateY\(-4px\); \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.v-pr-rec \{ transition: none; \}/);
  assert.match(css, /@media \(hover: hover\) \{\s*\.v-msg:hover/);
});

test("提速：同页内切换只换变化的区域；请求并行；字典缓存遇写即清；静态文件带内容版本号", async () => {
  const app = await readFile("src/tenant/app.js", "utf8"),
    v2p = await readFile("src/tenant/v2p.js", "utf8"),
    c2 = await readFile("src/tenant/c2.js", "utf8"),
    v2t = await readFile("src/tenant/v2t.js", "utf8"),
    css = await readFile("src/tenant/v2.css", "utf8"),
    build = await readFile("scripts/build.mjs", "utf8");
  // 请求层：同址并发合并；缓存五类选项名单；写操作只作废相关选项，明确未保存时不作废；预览类 POST 不清；共享结果给拷贝。
  assert.match(app, /API_CACHE_RULES = \[/);
  for (const kind of ["teachers", "locations", "course_types", "course_categories", "students", "student_schedule_blocks", "followup-assignees", "renewal-brand", "rates"])
    assert.match(app, new RegExp('\\{ kind: "' + kind + '", re: '));
  assert.match(app, /const kinds = apiAffects\(path\);\s*\/\/[^\n]*\n\s*apiInvalidate\(kinds\);/);
  assert.match(app, /if \(result\?\.committed !== false\) \{\s*apiInvalidate\(kinds\);\s*viewCache\.clear\(\);\s*apiWriteSeq\+\+;/);
  assert.match(app, /if \(apiInflight\.has\(key\)\) return structuredClone\(await apiInflight\.get\(key\)\);/);
  assert.match(app, /if \(kind && \(apiEpoch\.get\(kind\) \|\| 0\) === epoch\) apiCache\.set\(key,/);
  assert.match(app, /if \(method !== "GET" && \/\\\/preview\$\/\.test\(path\)\) return apiRequest\(path, method, data\);/);
  // 路由：页面声明 __soft 时不清空整页、不闪骨架。
  assert.match(app, /if \(current\?\.__soft\?\.\(key\)\) \{/);
  // 学员：换学员/分页只换右侧；筛选只换列表并保留搜索框；基本资料一次并行取回；整页刷新清缓存。
  assert.match(v2p, /swapDetail\(c, r\[0\], r\[1\]\);\s*return true;/);
  assert.match(v2p, /oldList\.querySelector\("\.v-list-rows"\)\.replaceWith\(fresh\.querySelector\("\.v-list-rows"\)\);/);
  assert.match(v2p, /oldSplit\.querySelector\(":scope > \.v-list \.v-list-rows"\)\?\.replaceWith\(listRows\);/);
  assert.match(v2p, /const p = Promise\.all\(\[\s*api\("data\/students\/" \+ key\),\s*api\("c2\/students\/" \+ key\),/);
  assert.match(v2p, /if \(force\) dCache\.clear\(\);/);
  assert.match(v2p, /hit\.writes === apiWriteSeq/);
  assert.match(v2p, /jobs\.push\(creditPage\(a, "packages", id\)\);/);
  // 学员、教师首次进入：先显示列表，详情随后补上。
  assert.match(v2p, /if \(pick\) await swapDetail\(c, pick, tab\);/);
  assert.match(v2p, /split\.lastElementChild\.replaceWith\(d\);/);
  // 教师：同一次访问内复用名单与课表；课酬标准和在读学员只取一次。
  assert.match(v2p, /let data = reuse && tState\.data;/);
  assert.match(v2p, /tState\.shared\.rates \?\?= R\(\)\.take\("finance\/rates"\)/);
  // 待办：跟进四组与负责人一次并行；续费四组与设置并行。
  assert.match(c2, /const \[people, \.\.\.lists\] = await Promise\.all\(\[/);
  assert.match(v2t, /const \[settingsData, \.\.\.pages\] = await Promise\.all\(\[/);
  // 等待时旧内容变淡：只用透明度过渡、120ms 内的响应不闪，并有减少动态兜底。
  assert.match(css, /opacity: 0\.5;\s*transition: opacity 0\.15s ease 0\.12s;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.v-detail\.is-loading/);
  // 打包：HTML 中的静态文件地址带内容哈希版本号，找不到引用时构建失败。
  assert.match(build, /html = html\.replace\(`"\$\{file\}"`, `"\$\{file\}\?v=\$\{hash\}"`\);/);
  assert.match(build, /if \(html === before\) throw Error\("HTML 中找不到 " \+ file\);/);
  try {
    const page = await readFile("dist/tenant.html", "utf8");
    assert.match(page, /\/assets\/tenant\.js\?v=[a-f0-9]{12}"/);
    assert.match(page, /\/assets\/tenant\.css\?v=[a-f0-9]{12}"/);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
});

test("二级页面改版·通用：顶栏全局区常驻、本页按钮单独一行、左侧小菜单提为顶部分页；菜单贴按钮、按钮等待不转圈、铃铛先开再填", async () => {
  const app = await readFile("src/tenant/app.js", "utf8"),
    css = await readFile("src/tenant/v2.css", "utf8"),
    ui = await readFile("src/ui/components.js", "utf8");
  // 顶栏只放标题、分页、全局区；本页按钮和筛选在顶栏下面一行。
  assert.match(app, /header\.append\(headTitle, headTabs, el\("div", null, \{ class: "v-spacer" \}\), tools\);/);
  assert.match(app, /main\.append\(header, toolbar, content\);/);
  assert.match(app, /toolbar\.append\(barLeft, headActions\);/);
  assert.doesNotMatch(css, /\.v-head-actions:not\(:empty\) ~ \.v-head-tools/);
  assert.match(css, /\.v-toolbar:has\(> \.v-toolbar-left:empty\):has\(> \.v-head-actions:empty\) \{\s*display: none;/);
  // 页面里的左侧小菜单：组内没有分页时提到顶栏，有分页时放到按钮行左边。
  assert.match(app, /content\.querySelector\("\.c3-settings > nav:not\(\[data-hoisted\]\)"\)/);
  assert.match(css, /\.c3-settings\.is-hoisted \{\s*display: block;/);
  // 按钮：不再插入转圈符号；0.3 秒后才变浅，保存类文字换成“…中…”。
  assert.doesNotMatch(ui, /class: "ui-spinner"/);
  assert.match(ui, /if \(verb && text\.isConnected\) text\.textContent = verb \+ "中…";\s*\}, 300\);/);
  // 菜单：贴着触发按钮，默认向左展开，放不下就翻转；不支持锚点定位的浏览器居中显示。
  assert.match(css, /position-area: block-end span-inline-start;\s*position-try-fallbacks: flip-block, flip-inline, flip-block flip-inline;/);
  assert.match(css, /\.ui-root\.ui-more-menu > \.ui-button--danger > \.ui-button-face \{\s*color: var\(--ui-error\);/);
  // 铃铛：先显示占位并打开，再取数据。
  assert.match(app, /messagePanel\.replaceChildren\(skel\);\s*messagePanel\.showPopover\(\{ source: bell \}\);/);
});

test("二级页面改版·表单：侧边栏表单分组、两列、必填 *、排序收进高级设置、保存取消固定底部；学员叫姓名、颜色用色块、新建不提示留空", async () => {
  const app = await readFile("src/tenant/app.js", "utf8"),
    css = await readFile("src/tenant/v2.css", "utf8"),
    ui = await readFile("src/ui/components.js", "utf8");
  assert.match(app, /students: "姓名",\s*teachers: "姓名",\s*course_categories: "大类名称",/);
  assert.doesNotMatch(app, /留空保留/);
  assert.match(app, /if \(row\.id\)\s*input\.closest\("\.ui-field"\)\?\.append\(\s*el\("p", "已有号码不显示；不改就留空"/);
  assert.match(app, /students: \{\s*groups: \[\s*\["基本信息", \["name", "status", "school", "grade", "direction"\]\],/);
  assert.match(app, /advanced: \["sort_order"\]/);
  assert.match(app, /box\.append\(el\("summary", "高级设置"\)\);/);
  assert.match(app, /if \(control\.required && control\.name\) holderOf\(control\.name\)\?\.classList\.add\("is-required"\);/);
  assert.match(app, /if \(!form\.classList\?\.contains\("v-std-form"\) && form\.closest\?\.\("\.business-drawer"\)\)\s*standardForm\(form\);/);
  assert.match(app, /colorField\(\s*"课程颜色",/);
  assert.match(css, /\.v-form-foot \{\s*position: sticky;\s*bottom: 0;/);
  assert.match(css, /\.v-std-form \.is-required > label:first-child::after \{\s*content: " \*";/);
  assert.match(css, /\.v-swatch-8 \{ background: var\(--ui-category-8\); \}/);
  // 日期/时间控件内部的小标签只给读屏，界面上不再重复。
  assert.match(ui, /wrapped\.classList\.add\("ui-inner-pick"\);/);
});

test("二级页面改版·待办与排课：未销课+教师提交合为“点名销课”；跟进任务分组列表+详情；学员报名并入固定排课并可按天快速添加；课酬标准成为教师页分页", async () => {
  const app = await readFile("src/tenant/app.js", "utf8"),
    v2t = await readFile("src/tenant/v2t.js", "utf8"),
    v2s = await readFile("src/tenant/v2s.js", "utf8"),
    v2p = await readFile("src/tenant/v2p.js", "utf8"),
    cal = await readFile("src/tenant/calendar.js", "utf8");
  // 点名销课：一个分页两个小分页；旧地址 #todo-teacher 跳到第二个小分页。
  assert.match(app, /register\("todo-unchecked", "点名销课", "schedule"/);
  assert.doesNotMatch(app, /register\(\s*"todo-teacher"/);
  assert.match(app, /if \(key === "todo-teacher"\) \{\s*pageHooks\.pickCheckin\?\.\("teacher"\);/);
  assert.match(v2t, /if \(cState\.tab === "teacher"\) await submissionQueue\(c\);\s*else await R\(\)\.unchecked\(c\);/);
  // 跟进任务：四组一次并行；系统提醒合成一行；学员档案里的跟进仍走原页面。
  assert.match(v2t, /\.\.\.FU_GROUPS\.map\(\(\[g\]\) => api\("c2\/followups\?group=" \+ g \+ "&owner=" \+ encodeURIComponent\(owner\)\)\),/);
  assert.match(v2t, /"学习阶段到期 · " \+ stages\.length \+ " 位学员"/);
  assert.match(v2t, /followupPage = \(c, studentId = null, \.\.\.rest\) => \(studentId \? legacyFollowup\(c, studentId, \.\.\.rest\) : followups\(c\)\);/);
  assert.match(v2t, /api\("tools\/followup_notes", "POST", \{ student_id: row\.student_id, at: now, content: text \}\)/);
  // 固定排课：没有“学员报名”整页入口；每列底部“＋ 在周X添加”；详情里加学员/退出；不限日期写“长期”。
  assert.doesNotMatch(v2s, /button\("学员报名"/);
  assert.match(v2s, /recordForm\(P\(\)\.sink\(again\), "schedule_templates", \{ weekday: i \}\)/);
  assert.match(v2s, /addEnrollees\(r, who, reopen\)/);
  assert.match(v2s, /api\("data\/schedule_enrollments", "POST", \{ template_id: r\.id, student_id: id/);
  assert.match(v2s, /const isOpenEnd = \(d\) => !d \|\| d >= "2099-01-01";/);
  assert.match(cal, /if \(enabled\("templates"\) && !pageHead0\)/);
  // 课酬标准：教师组第二个分页，按老师分组。
  assert.match(app, /"teachers-rates",\s*"课酬标准",\s*"teacher_pay",/);
  assert.doesNotMatch(v2p, /课酬标准总表/);
  assert.match(v2p, /async function ratesPage\(c\) \{/);
});

test("二级页面改版·角色权限：整张表勾选、一次保存；默认值与服务端一致；教师只看自己（固定说明）；推广中心财务不适用", async () => {
  const v2a = await readFile("src/tenant/v2a.js", "utf8"),
    server = await readFile("src/server/permissions.js", "utf8"),
    app = await readFile("src/tenant/app.js", "utf8");
  // 前端默认值逐项对照服务端 defaults（账号模块不可委派，不在表里）。
  const pick = (src, role) => {
    const block = src.slice(src.indexOf(role + ": {"), src.indexOf("}", src.indexOf(role + ": {")));
    return Object.fromEntries(
      [...block.matchAll(/(\w+): \[([^\]]*)\]/g)]
        .filter((m) => !["accounts", "logs", "profile"].includes(m[1]))
        .map((m) => [m[1], m[2].replace(/\s/g, "")]),
    );
  };
  for (const role of ["academic", "finance"]) assert.deepEqual(pick(v2a, role), pick(server, role), role);
  assert.match(app, /roles\.includes\("supervisor"\)\s*\? register\("settings-rights", "角色权限", "accounts"/);
  assert.match(v2a, /if \(changes\.length === 1\) await api\("rights", "PUT", changes\[0\]\);\s*else await api\("rights", "PUT", \{ changes \}\);/);
  assert.match(v2a, /教师账号：默认只能看到自己的学生和自己的课/);
  assert.match(v2a, /if \(module === "promo" && role === "finance"\) \{/);
  assert.doesNotMatch(v2a, /rightsDrawer/);
});

test("二级页面改版·补课面板：自选时间在最上（当天时间轴＋实时冲突检查），推荐居中带理由，加入已有课在最后；时间块用类名定位、不写行内样式", async () => {
  const v2t = await readFile("src/tenant/v2t.js", "utf8"),
    css = await readFile("src/tenant/v2.css", "utf8");
  assert.match(v2t, /body\.append\(secCustom, secSug, secJoin\);/);
  assert.match(v2t, /api\("c2\/makeups\/" \+ pid \+ "\/suggestions"\)/);
  assert.match(v2t, /api\("c2\/makeups\/" \+ pid \+ "\/day\?date=" \+ st\.date\)/);
  assert.match(v2t, /api\("c2\/makeups\/" \+ pid \+ "\/check", "POST", \{/);
  assert.match(v2t, /el2\.classList\.add\("tl-s-" \+ a, "tl-w-" \+ \(b - a\)\);/);
  assert.match(v2t, /makeupForm = \(c, data, part\) => \(enabled\("lessons", "create"\) \? makeupPanel\(c, data, part\) : c2Makeup\(c, data, part\)\);/);
  // 保存沿用原补课写入；推荐与自选都带同样的老师、教室、时长。
  assert.match(v2t, /creditWrite\("makeups", \{\s*original_participant_id: pid,/);
  assert.match(css, /\.tl-s-53 \{ grid-column-start: 53; \}/);
  assert.match(css, /\.tl-w-52 \{ grid-column-end: span 52; \}/);
  assert.match(css, /\.v-tl-axis,\s*\.v-tl-track \{\s*display: grid;\s*grid-template-columns: repeat\(52, minmax\(0, 1fr\)\);/);
});

test("二级页面改版·财务与导入导出：月份切换放到按钮行；月度结算不再有第三层整排分页、课酬标准移走；长表格每次 50 行；导出集中成一个分页", async () => {
  const v2f = await readFile("src/tenant/v2f.js", "utf8"),
    v2a = await readFile("src/tenant/v2a.js", "utf8"),
    app = await readFile("src/tenant/app.js", "utf8");
  assert.match(v2f, /if \(vHead\?\.bar && inPage\(c\)\) vHead\.bar\(bar\);\s*else c\.append\(bar\);/);
  assert.match(v2f, /tabs\.push\(\["adjustments", "课酬调整"\], \["payments", "付款记录"\]\);/);
  assert.doesNotMatch(v2f, /\["rates", "课酬标准"\]/);
  assert.match(v2f, /const PAGE_ROWS = 50;/);
  assert.match(v2f, /"再显示 " \+ Math\.min\(PAGE_ROWS, rows\.length - shown\) \+ " 条/);
  assert.match(app, /register\("settings-export", "导出", "exports", \(c\) =>/);
  assert.match(v2a, /href: base \+ "api\/export\?kind=" \+ kind \+ "&month=" \+ month,/);
});

test("二级页面改版·线索详情与周课表：线索详情有阶段进度、一键改回访、直接改备注；周课表“＋N 节”改为贴着按钮的小列表", async () => {
  const v2t = await readFile("src/tenant/v2t.js", "utf8"),
    cal = await readFile("src/tenant/calendar.js", "utf8");
  assert.match(v2t, /if \(globalThis\.ChannelC3\) globalThis\.ChannelC3\.leadDetail = leadDetailV;/);
  // 改阶段/回访/备注时带上全部原字段，只改需要改的，不动手机号。
  assert.match(v2t, /api\("tools\/leads\/" \+ row\.id, "PATCH", \{\s*name: row\.name,/);
  assert.doesNotMatch(v2t.slice(v2t.indexOf("function leadDetailV"), v2t.indexOf("leadDetail = leadDetailV")), /phone: /);
  assert.match(v2t, /for \(const \[t, d\] of \[\["明天", 1\], \["3 天后", 3\], \["下周", 7\]\]\)/);
  assert.match(cal, /pop\.showPopover\(\{ source: more \}\);/);
  assert.doesNotMatch(cal, /title: UI\.fmt\.day\(group\.date\) \+ " · 同时段课程"/);
});

test("QA-01/02/03 前端：待确认出勤提交的课不能走普通销课；控制台日志不撑宽；机构设置不露平台品牌", async () => {
  const v2 = await readFile("src/tenant/v2.js", "utf8"),
    c2 = await readFile("src/tenant/c2.js", "utf8"),
    v2a = await readFile("src/tenant/v2a.js", "utf8"),
    con = await readFile("src/console/app.js", "utf8"),
    css = await readFile("src/console/app.css", "utf8");
  // 课程面板：有待确认出勤提交时不显示逐人出勤按钮、确认销课、教师请假/机构取消。
  assert.match(v2, /canMark = planned && enabled\("attendance", "update"\) && !pendingAtt;/);
  assert.match(v2, /if \(planned && enabled\("attendance", "update"\) && !pendingAtt\)/);
  assert.match(v2, /enabled\("attendance", "update"\) && !pendingAtt && \(planned \|\| data\.status === "completed"\)/);
  assert.match(v2, /button\("去确认"/);
  assert.match(c2, /老师已提交，去确认/);
  // 控制台日志：中文操作名、机构名、长内容在日志区域内换行并可展开。
  assert.match(con, /const LOG_ACTIONS = \{/);
  assert.match(con, /names\.get\(item\.tenant_id\)/);
  assert.match(css, /\.log-full\{[^}]*overflow-wrap:anywhere/);
  assert.doesNotMatch(con.slice(con.indexOf("async function logs"), con.indexOf("async function boot")), /item\.action \+ " · "/);
  // 机构设置：中性文案。
  assert.doesNotMatch(v2a, /由枫琴在平台后台统一设置/);
  assert.match(v2a, /机构品牌信息由管理员统一维护，如需修改请联系管理员。/);
});

test("B1 前端：登记缴费可分多个课时包、剩余进预收、其他收入；待核对逐条处理；预收兑换；欠课时显示与超限只拦本人", async () => {
  const pay = await readFile("src/tenant/v2pay.js", "utf8"),
    v2 = await readFile("src/tenant/v2.js", "utf8"),
    v2f = await readFile("src/tenant/v2f.js", "utf8"),
    v2t = await readFile("src/tenant/v2t.js", "utf8"),
    c3 = await readFile("src/tenant/c3.js", "utf8"),
    bundle = await readFile("scripts/frontend-bundle.mjs", "utf8");
  assert.match(bundle, /src\/tenant\/v2pay\.js/);
  assert.match(pay, /api\("credits\/payments", "POST", body\)/);
  assert.match(pay, /kind: "other_income"|body\.other_category = cat\.value/);
  assert.match(pay, /new_package: \{\s*course_type_id: r\.course\.value,/);
  assert.match(pay, /"credits\/payments\/" \+ r\.id \+ "\/resolve", "POST", \{ version: r\.version, action: "to_balance"/);
  assert.match(pay, /action: "link", allocations: items/);
  assert.match(pay, /action: "other_income", other_category: cat\.value/);
  assert.match(pay, /api\("credits\/balance\/redeem", "POST"/);
  assert.match(pay, /api\("credits\/balance\/adjust", "POST"/);
  assert.match(pay, /"credits\/payments\/" \+ row\.id \+ "\/reverse"/);
  assert.match(pay, /api\("credits\/packages\/" \+ p\.id, "PATCH", \{ version: p\.version, amount:/);
  // 所有“登记缴费”入口走新表单。
  assert.match(pay, /creditForm = async \(c, kind, row = \{\}\) => \{\s*if \(kind !== "payments" \|\| row\.id\) return oldCreditForm/);
  assert.match(v2f, /\["pending", "待核对", m\.unresolved \|\| 0/);
  assert.match(v2f, /\["balance", "预收余额", null\]/);
  // 销课：上限内欠课照常销；超限只拦本人并提示。
  assert.match(v2, /preview\?\.blocked\?\.some\(\(x\) => x\.participant_id === p\.id\)/);
  assert.match(v2, /超过欠课上限，仍待销课/);
  assert.doesNotMatch(v2, /到课后无法扣课/);
  assert.match(v2t, /\["debt", "欠课时", "bad"\]/);
  assert.match(c3, /key: "max_debt_units", value: Number\(v\)/);
});

test("D1 前端与界面修复：删除按钮、机构停用/彻底删除、公告撤回；空日期从今天开始；排课选学员改为搜索+卡片；强制保存只在冲突后出现", async () => {
  const app = await readFile("src/tenant/app.js", "utf8"),
    ui = await readFile("src/ui/components.js", "utf8"),
    con = await readFile("src/console/app.js", "utf8"),
    v2f = await readFile("src/tenant/v2f.js", "utf8"),
    v2t = await readFile("src/tenant/v2t.js", "utf8"),
    v2s = await readFile("src/tenant/v2s.js", "utf8"),
    c2 = await readFile("src/tenant/c2.js", "utf8"),
    c3 = await readFile("src/tenant/c3.js", "utf8"),
    cal = await readFile("src/tenant/calendar.js", "utf8");
  assert.match(v2f, /path: "data\/packages\/" \+ r\.id/);
  assert.match(c3, /path: "credits\/stages\/" \+ r\.id/);
  assert.match(v2t, /path: "tools\/leads\/" \+ row\.id/);
  assert.match(v2s, /path: "tools\/classes\/" \+ cls\.id/);
  assert.match(con, /"tenants\/" \+ t\.id \+ "\/disable"/);
  assert.match(con, /"tenants\/" \+ t\.id \+ "\/purge\/step"/);
  assert.match(con, /"announcements\/" \+ row\.id \+ "\/withdraw"/);
  assert.match(con, /api\("promo\/" \+ id, "DELETE"/);
  assert.match(ui, /active = selected \|\| today;/);
  assert.match(ui, /popup\.classList\.toggle\("is-end"/);
  assert.match(app, /function studentPicker\(form, \{ students, selected = \[\], locked = false/);
  assert.doesNotMatch(app.slice(app.indexOf("async function lessonForm"), app.indexOf("function studentPicker")), /for \(const student of students\.filter/);
  assert.match(app, /forceBox\.hidden = true;/);
  assert.match(app, /register\("finance-rates", "课酬标准", "teacher_pay"/);
  assert.match(app, /const COST_TYPES = \[/);
  assert.match(c2, /加入已有课程补课/);
  assert.doesNotMatch(c2.slice(c2.indexOf("async function manualMakeup"), c2.indexOf("async function manualMakeup") + 4000), /target_mode/);
  assert.match(cal, /pageHead\.bar\(toolbar\)/);
});

test("今天页（设计稿 10）：接下来要做分三组、类型筛选、我的/全部、记录回访就地填写、明天再说", async () => {
  const td = await readFile("src/tenant/v2today.js", "utf8"),
    bundle = await readFile("scripts/frontend-bundle.mjs", "utf8");
  assert.match(bundle, /src\/tenant\/v2today\.js/);
  assert.match(td, /\["now", "现在就做 · 已经过时间"\]/);
  assert.match(td, /\["later", "可以晚点"\]/);
  assert.match(td, /\["mine", "我的"\]/);
  assert.match(td, /"保存，下一条"/);
  assert.match(td, /api\("tools\/followup_notes", "POST"/);
  assert.match(td, /"明天再说"/);
  assert.match(td, /if \(finance\) return oldHome\(c\);/);
});

test("选项缓存：同一份名单的不同写法算一份；写操作只作废相关名单", async () => {
  const app = await readFile("src/tenant/app.js", "utf8");
  const pick = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));
  const rules = app.slice(app.indexOf("  MIN = 60 * 1000,"), app.indexOf("  // 切换页面先显示上次画好的内容"));
  const code =
    "const " + rules.trim().replace(/,$/, ";") + "\n" +
    pick("const apiRule", "function apiInvalidate") +
    "\nreturn { apiKey, apiAffects };";
  const { apiKey, apiAffects } = new Function(code)();
  assert.equal(apiKey("data/teachers?offset=0&q="), apiKey("data/teachers?offset=0"));
  assert.equal(apiKey("data/students?offset=0&q=%E5%BC%A0"), "data/students?offset=0&q=%E5%BC%A0");
  assert.equal(apiKey("data/students/abc"), "data/students/abc");
  assert.deepEqual(apiAffects("data/students/abc"), ["students"]);
  assert.deepEqual(apiAffects("data/teachers"), ["teachers"]);
  assert.deepEqual(apiAffects("data/lessons"), []);
  assert.deepEqual(apiAffects("credits/payments"), []);
  assert.deepEqual(apiAffects("accounts/1/reset-password"), ["teachers", "students", "followup-assignees"]);
  assert.deepEqual(apiAffects("data/student_schedule_blocks/x"), ["student_schedule_blocks"]);
  assert.deepEqual(apiAffects("finance/rates/x"), ["rates"]);
  assert.deepEqual(apiAffects("renewal-settings"), ["renewal-brand"]);
  assert.equal(apiKey("data/student_schedule_blocks?offset=0&q="), "data/student_schedule_blocks?offset=0");
  assert.equal(apiAffects("imports/abc/commit"), null);
  assert.equal(apiAffects("reorder"), null);
  assert.equal(apiAffects("settings"), null);
});
