// 艺界星途 · 工作台与导航入口（Claude）
// 左侧“日常”下加一组“招生工具”：工作台、招生内容、课程方案、课后反馈（老师）、成长报告。

// 设计稿 v3：不再单独设“招生工具”分组，入口由 yxNavRework 挂到原有分组里。
function yxNavGroups() {
  return [];
}
// 设计稿 v3 的导航：
// 招生：线索 · 推广中心 · 招生内容 · 课程方案 · 成长报告（老师另有课后反馈）
// 课程与教室：排课课程与教室 · 报价课程与价目表 · 阶段与节点
// 机构设置：机构档案 · 品牌与图库 · 成长报告维度 · AI 用量 · 学科模板 · 修改卡片 · 基本设置
const YX_SETTING_ROUTE = {
  yx_courses: "courses-quote",
  yx_stages: "courses-stages",
  yx_calendar: "courses-stages",
  yx_profile: "inst-profile",
  yx_gallery: "inst-brand",
  yx_reports: "inst-dims",
  yx_subjects: "inst-subjects",
  yx_changes: "inst-changes",
};
function yxNavRework(daily, manage, register) {
  const find = (list, k) => list.find((g) => g && g.key === k);
  const yx = [
    register("yx-content", "招生内容", "content", (c) => yxContentPage(c)),
    register("yx-plans", "课程方案", "plans", (c) => yxPlansPage(c)),
    yxIsTeacher() ? register("yx-feedback", "课后反馈", "schedule", (c) => yxFeedbackPage(c)) : null,
    register("yx-reports", "成长报告", yxIsTeacher() ? "schedule" : "growth_reports", (c) => yxReportsPage(c)),
  ].filter(Boolean);
  register("yx-home", "工作台", "home", (c) => yxWorkbench(c)); // 保留地址，不放导航
  const enrol = find(daily, "enrol");
  if (enrol) enrol.tabs.push(...yx);
  else if (yx.length) daily.splice(1, 0, { key: "enrol", label: "招生", icon: "link", tabs: yx });
  const courses = find(manage, "courses");
  if (courses) {
    if (courses.tabs[0]) courses.tabs[0].label = "排课课程与教室";
    courses.tabs.push(
      register("courses-quote", "报价课程与价目表", "settings", (c) => yxSettingsPage(c, ["yx_subjects_bar", "yx_courses", "yx_assist", "yx_price_legend"])),
      register("courses-stages", "阶段与节点", "settings", (c) => yxSettingsPage(c, ["yx_stages", "yx_calendar", "yx_assist"])),
    );
  }
  const inst = find(manage, "institution");
  if (inst) {
    const base = inst.tabs[0];
    if (base) base.label = "基本设置";
    inst.tabs.splice(
      0,
      0,
      register("inst-profile", "机构档案", "settings", (c) => yxSettingsPage(c, ["yx_profile"])),
      register("inst-brand", "品牌与图库", "settings", (c) => yxSettingsPage(c, ["yx_gallery"])),
      register("inst-dims", "成长报告维度", "settings", (c) => yxSettingsPage(c, ["yx_reports"])),
      enabled("ai", "use") ? register("inst-ai", "AI 用量", "settings", (c) => yxAiUsagePage(c)) : null,
    );
    // 修改记录不占页签（设计稿 v3 只有 4 个）：从“用一句话改设置”和设置提醒进入。
    register("inst-changes", "修改记录", "settings", (c) => yxSettingsPage(c, ["yx_changes"]));
    // 学科模板不占页签：从“报价课程与价目表”顶部的“添加学科包”进入。
    register("inst-subjects", "学科模板", "settings", (c) => yxSettingsPage(c, ["yx_subjects"]));
  }
}
// 一个导航页里放一个或几个设置区块。
async function yxSettingsPage(c, keys) {
  c.replaceChildren(UI.tableSkeleton());
  const again = () => yxSettingsPage(c, keys);
  const frag = [],
    side = [];
  for (const k of keys) {
    const box = el("section", null, { class: "yxs-page-sec" });
    if (k === "yx_subjects_bar") {
      await yxsSubjectBar(box, again);
      frag.push(box);
      continue;
    }
    // 右栏：用一句话改设置（设计稿 v3）、计价方式说明
    if (k === "yx_assist") {
      if (enabled("ai", "use") && enabled("settings", "propose")) side.push(yxsAssist(again));
      continue;
    }
    if (k === "yx_price_legend") {
      side.push(yxsPriceLegend());
      continue;
    }
    const head = el("div", null, { class: "v-set-head" });
    head.append(el("h2", (YXS_SECTIONS.find((x) => x[0] === k) || [, ""])[1]));
    box.append(head);
    frag.push(box);
    await yxSettingsSection(box, head, k, again);
  }
  if (side.length) {
    const grid = el("div", null, { class: "yxs-split" });
    const main = el("div", null, { class: "yxs-split-main" }),
      aside = el("div", null, { class: "yxs-split-side" });
    const bar = frag[0]?.querySelector?.(".yxs-subjectbar") ? frag.shift() : null;
    main.append(...frag);
    aside.append(...side);
    grid.append(main, aside);
    c.replaceChildren(...(bar ? [bar] : []), grid);
  } else c.replaceChildren(...frag);
  c.classList.add("yx-page");
}
// AI 用量（机构设置 · 设计稿 v3）
async function yxAiUsagePage(c) {
  const V = globalThis.ChannelV2;
  const st = (c.__yxu ||= { date: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }) });
  const u = await apiRequest("ai/usage?date=" + st.date);
  c.replaceChildren();
  c.classList.add("yx-page");
  const bar = el("div", null, { class: "yxs-bar" });
  const d = el("input", null, { type: "date", value: st.date, "aria-label": "日期" });
  d.addEventListener("change", () => ((st.date = d.value), yxAiUsagePage(c)));
  bar.append(d, el("span", "每天北京时间 0 点重新计数；快速和深度分开计算。", { class: "v-muted" }));
  c.append(bar);
  const meters = el("div", null, { class: "yxu-meters" });
  for (const [k, t] of [["fast", "快速"], ["deep", "深度"]]) {
    const m = el("div", null, { class: "v-panel yxu-meter" });
    m.append(el("small", t, { class: "v-muted" }));
    const n = el("p");
    n.append(el("b", String(u[k].used), { class: "yx-num" }), " / " + u[k].limit);
    const track = el("div", null, { class: "yxh-progress" }),
      fill = el("span");
    fill.style.setProperty("width", Math.min(100, (u[k].used / Math.max(1, u[k].limit)) * 100) + "%");
    track.append(fill);
    m.append(n, track);
    meters.append(m);
  }
  c.append(meters);
  const tools = { plans: "课程方案", content: "招生内容", feedback: "课后反馈", growth_reports: "成长报告", settings: "设置" };
  if (u.by_tool?.length) {
    const p = V.panel("按工具");
    p.append(yxsTable(["工具", "快速", "深度"], u.by_tool.map((x) => [tools[x.tool] || x.tool, String(x.fast), String(x.deep)])));
    c.append(p);
  }
  if (u.by_user?.length) {
    const p = V.panel("按账号");
    p.append(yxsTable(["账号", "快速", "深度"], u.by_user.map((x) => [x.name || x.user_id, String(x.fast), String(x.deep)])));
    c.append(p);
  }
}
function yxGoSettings(section) {
  location.hash = YX_SETTING_ROUTE[section] || "settings-institution";
}

// ---------- 工作台（设计稿 03） ----------
async function yxWorkbench(c) {
  const V = globalThis.ChannelV2;
  c.replaceChildren(UI.tableSkeleton());
  const safe = (p, fb) => p.catch(() => fb);
  const canPlans = enabled("plans"),
    canContent = enabled("content"),
    canGrowth = enabled("growth_reports") || yxIsTeacher(),
    canSet = enabled("settings");
  const month = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }).slice(0, 7);
  const [plans, contents, batches, scenes, subjects, profile, gallery, courses, accounts, names] = await Promise.all([
    canPlans ? safe(api("plans?limit=200"), { items: [] }) : { items: [] },
    canContent ? safe(api("content?limit=50"), { items: [], total: 0 }) : { items: [], total: 0 },
    canGrowth ? safe(api("report-batches?limit=50"), { items: [] }) : { items: [] },
    canContent ? safe(api("content/scenes"), { items: [] }) : { items: [] },
    canSet ? safe(api("settings/subjects"), []) : [],
    canSet ? safe(api("settings/profile"), {}) : {},
    canSet ? safe(api("gallery?limit=1"), { total: 0 }) : { total: 0 },
    canSet ? safe(api("settings/courses?limit=200"), { items: [] }) : { items: [] },
    enabled("accounts") ? safe(api("accounts?limit=200"), { items: [] }) : { items: [] },
    canPlans ? yxrNames() : new Map(),
  ]);
  c.replaceChildren();
  c.classList.add("yxh-page");
  const items = plans.items || [];
  const thisMonth = items.filter((p) => String(p.updated_at).startsWith(month));
  const follow = items.filter((p) => p.status === "sent");
  const reports = (batches.items || []).flatMap((b) => b.reports || []);
  const toWrite = reports.filter((r) => r.progress === "not_started" || r.progress === "draft").length;
  const toPublish = reports.filter((r) => r.progress === "ready").length;
  const ready = (contents.items || []).filter((x) => x.status === "ready").length;
  // 问候 + 今天要做的事
  const hour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Shanghai" }));
  const todo = [toWrite && toWrite + " 份成长报告待完成", toPublish && toPublish + " 份报告待发布", ready && ready + " 篇招生内容待发布", follow.length && follow.length + " 份方案待跟进"].filter(Boolean);
  const head = el("div", null, { class: "yxh-head" });
  const hello = el("div", null, { class: "yxh-hello" });
  hello.append(el("h2", (hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好") + "，" + me.user.name), el("p", todo.length ? "今天有 " + todo.join("，") + "。" : "今天想先做什么？", { class: "v-muted" }));
  const chips = el("div", null, { class: "yxh-chips" });
  if (enabled("ai", "use") || yxIsTeacher()) chips.append(yxAiUsageChip());
  head.append(hello, chips);
  c.append(head);
  // 三个工具卡片：整张卡片可点
  const tools = el("div", null, { class: "yxh-tools" });
  const tool = (tone, ic, title, text, extra, go, can) => {
    const card = el(can ? "button" : "div", null, { class: "yxh-tool is-" + tone + (can ? "" : " is-soon"), ...(can ? { type: "button" } : {}) });
    const h = el("div", null, { class: "yxh-tool-head" });
    const i = el("span", null, { class: "yxh-icon" });
    i.append(UI.icon(ic));
    h.append(i, el("strong", title));
    card.append(h, el("p", text, { class: "v-muted" }));
    if (extra) card.append(extra);
    if (!can) card.append(el("span", "没有权限", { class: "yxh-soon" }));
    else card.addEventListener("click", go);
    tools.append(card);
  };
  const sc = el("div", null, { class: "yxh-scenes" });
  for (const x of (scenes.items || []).filter((x) => x.subject).slice(0, 3)) sc.append(el("span", x.name.split(" / ")[0], { class: "yxh-scene" }));
  tool("coral", "edit", "招生内容助手", "公众号、朋友圈、小红书、海报文字、家长群通知", sc.childElementCount ? sc : null, () => (location.hash = "yx-content"), canContent);
  const s1 = el("p", null, { class: "yxh-stat" });
  s1.append("本月已出 ", el("b", String(thisMonth.length)), " 份 · ", el("b", String(follow.length)), " 份待跟进");
  tool("violet", "book", "课程方案与报价", "试听或咨询后，几分钟给家长出一份带阶段、课程和价格的方案", s1, () => (location.hash = "yx-plans"), canPlans);
  const s2 = el("p", null, { class: "yxh-stat" });
  s2.append("阶段报告待写 ", el("b", String(toWrite)), " 份 · 待发布 ", el("b", String(toPublish)), " 份");
  tool("teal", "arrow-up", "学员成长报告", "老师写几句要点，AI 整理成课后反馈和阶段报告发给家长", s2, () => (location.hash = yxIsTeacher() && !enabled("growth_reports") ? "yx-reports" : "yx-reports"), canGrowth);
  c.append(tools);
  const cols = el("div", null, { class: "yxh-cols" });
  // 最近内容：招生内容和方案混排，按更新时间
  if (canPlans || canContent) {
    const box = V.panel("最近内容");
    const rows = [
      ...(contents.items || []).map((x) => ({ kind: "content", at: x.updated_at, title: x.title, meta: yxcTypeName(x.type) + " · " + (YXC_STATUS[x.status] || [x.status])[0], open: () => yxContentEditor(x.id, () => yxWorkbench(c)) })),
      ...items.map((p) => ({ kind: "plan", at: p.updated_at, title: (names.get(p.student_id) ? names.get(p.student_id) + " · " : "") + p.title, meta: (YXP_STATUS[p.status] || [p.status])[0], open: () => yxPlanEditor(p.id, () => yxWorkbench(c)) })),
    ]
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 6);
    if (!rows.length) box.append(el("p", "还没有内容。点上面的工具开始。", { class: "v-muted v-pad" }));
    for (const r of rows) {
      const line = el("button", null, { type: "button", class: "yxh-recent" });
      line.append(el("span", r.kind === "content" ? "招生" : "方案", { class: "yxh-tag is-" + r.kind }), el("span", r.title, { class: "yxh-recent-title" }), el("small", r.meta + " · " + yxhAgo(r.at), { class: "v-muted" }));
      line.addEventListener("click", r.open);
      box.append(line);
    }
    cols.append(box);
  }
  // 开通进度
  if (canSet) {
    const steps = [
      ["选择学科模板", subjects.length > 0, "yx_subjects"],
      ["填写机构档案", !!String(profile.introduction || "").trim(), "yx_profile"],
      ["上传咨询二维码和常用照片", (gallery.total || 0) > 0, "yx_gallery"],
      ["填写课程价目表", (courses.items || []).some((x) => x.pricing), "yx_courses"],
      ["邀请老师和同事", (accounts.items || []).length > 1, null],
    ];
    const done = steps.filter((x) => x[1]).length;
    const box = V.panel("开通进度", [el("span", null, { class: "v-spacer" }), el("span", done + " / " + steps.length, { class: "v-muted" })]);
    const bar = el("div", null, { class: "yxh-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(steps.length), "aria-valuenow": String(done) });
    const fill = el("span");
    fill.style.setProperty("width", (done / steps.length) * 100 + "%");
    bar.append(fill);
    box.append(bar);
    const ul = el("ul", null, { class: "yxh-steps" });
    for (const [t, ok, sec] of steps) {
      const li = el("li", null, { class: ok ? "is-done" : "" });
      li.append(el("span", ok ? "✓" : "", { class: "yxh-dot", "aria-hidden": "true" }), el("span", t));
      if (!ok) li.append(V.link("去填写", () => (sec ? yxGoSettings(sec) : (location.hash = "settings-accounts"))));
      ul.append(li);
    }
    box.append(ul);
    cols.append(box);
  }
  c.append(cols);
}
function yxhAgo(at) {
  const d = String(at || "").slice(0, 10),
    today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  if (d === today) return "今天";
  const days = Math.round((new Date(today) - new Date(d)) / 864e5);
  return days === 1 ? "昨天" : days > 1 && days < 7 ? days + " 天前" : d.slice(5).replace("-", "/");
}
function yxhPlanRow(p, again, names) {
  const V = globalThis.ChannelV2;
  const st = YXP_STATUS[p.status] || [p.status, "muted"];
  const line = el("button", null, { type: "button", class: "yxp-item" }),
    who = el("span", null, { class: "yxp-item-main" });
  const who2 = p.party_name || names?.get(p.student_id);
  const strong = el("strong", (who2 ? who2 + " · " : "") + p.title);
  if (p.party === "prospect" || p.party === "lead") strong.append(el("span", p.party === "lead" ? "线索" : "意向", { class: "yxh-party" }));
  who.append(strong, el("small", yxpMoney(p.total?.amount) + " · 更新于 " + String(p.updated_at || "").slice(0, 10), { class: "v-muted" }));
  line.append(who, V.chip(st[0], st[1]));
  line.addEventListener("click", () => yxPlanEditor(p.id, again, { party: p.party, party_name: p.party_name }));
  return line;
}

// 新建方案（v0.4.0）：三种来源——已有学员 / 已有线索 / 新的意向学员（可同时生成线索）。
// 一般是先咨询出方案、签约后才建档，所以默认“新意向”。
async function yxhTemplateDoc(pv, subject) {
  if (subject !== pv.doc.subject) throw Error("模版学科与所选学科不一致，请选择模版对应的学科。");
  const doc = yxClone(pv.doc);
  const blocking = pv.checks?.blocking || [];
  if (blocking.some(x => x.code !== "course_unavailable")) throw Error(blocking.map(x => x.text).join("；"));
  if (blocking.length) {
    const ids = new Set(blocking.map(x => x.line_id));
    const lines = doc.modules.courses.lines.filter(x => ids.has(x.line_id));
    if (!(await UI.confirm({ title: "确认将不可用课程改为自由课程？", consequence: lines.map(x => x.name || "未命名课程").join("、") + "：本机构尚未启用或定价。继续会将这些课程明确改为自由课程并标记“价格另议”，保留数量；请在编辑器核对。也可取消，先在课程设置中启用并定价。" }))) return null;
    for (const line of lines) {
      line.origin_course_id = line.course_id;
      line.pricing_source = "manual";
      line.course_id = null;
      line.manual_unit_price = null;
      line.price_tbd = true;
      delete line.snapshot;
    }
  }
  return doc;
}

async function yxhNewPlan(again) {
  const { panel, close } = drawer("新建课程方案"),
    form = el("form", null, { class: "yxh-newplan" });
  const [students, leads, subjects] = await Promise.all([
    api("data/students?limit=1000").catch(() => ({ items: [] })),
    enabled("leads") ? api("tools/leads?offset=0").catch(() => ({ items: [] })) : { items: [] },
    api("settings/subjects").catch(() => []),
  ]);
  if (!subjects.length) return panel.append(el("p", "还没有可用的学科。请先在“机构设置 › 课程与教室 › 报价课程与价目表”里导入学科包，再来建方案。", { class: "v-muted" }));
  const list = students.items || students.records || [],
    leadList = (leads.items || []).filter((x) => x.stage !== "enrolled" && x.stage !== "lost" && !x.student_id);
  const modes = [["prospect", "新的意向学员"], ...(leadList.length ? [["lead", "从线索选"]] : []), ...(list.length ? [["student", "已有学员"]] : [])];
  let mode = "prospect";
  const seg = el("div", null, { class: "yxh-seg", role: "radiogroup", "aria-label": "方案给谁" });
  const parts = {};
  const sync = () => {
    for (const [k] of modes) {
      seg.querySelector('[data-k="' + k + '"]').setAttribute("aria-checked", String(k === mode));
      parts[k].hidden = k !== mode;
      for (const i of parts[k].querySelectorAll("input,select,textarea")) i.disabled = k !== mode;
    }
  };
  for (const [k, t] of modes) {
    const b = el("button", t, { type: "button", role: "radio", "data-k": k, class: "yxh-seg-b" });
    b.addEventListener("click", () => ((mode = k), sync()));
    seg.append(b);
  }
  form.append(seg);
  // 新意向
  parts.prospect = el("div", null, { class: "yxh-part" });
  field(parts.prospect, "学员姓名", "p_name", "text", "");
  field(parts.prospect, "年级", "p_grade", "text", "", false);
  field(parts.prospect, "家长称呼", "p_parent_name", "text", "", false);
  field(parts.prospect, "家长手机", "p_parent_phone", "tel", "", false);
  field(parts.prospect, "意向方向", "p_direction", "text", "", false);
  field(parts.prospect, "备注", "p_notes", "text", "", false);
  if (enabled("leads", "create")) yxsCheck(parts.prospect, "同时生成一条线索", "create_lead", true, "方便在“线索”里继续跟进；不勾选则只保存在这份方案里。");
  parts.prospect.append(el("p", "签约后可以在方案里一键“转为正式学员”。", { class: "v-muted yxh-hint" }));
  form.append(parts.prospect);
  if (leadList.length) {
    parts.lead = el("div", null, { class: "yxh-part" });
    yxsSelect(parts.lead, "线索", "lead_id", leadList.map((x) => [x.id, x.name + (x.grade ? " · " + x.grade : "") + (x.phone_last4 ? " · 尾号 " + x.phone_last4 : "")]), leadList[0].id);
    form.append(parts.lead);
  }
  if (list.length) {
    parts.student = el("div", null, { class: "yxh-part" });
    yxsSelect(parts.student, "学员", "student_id", list.map((s) => [s.id, s.name]), list[0].id);
    form.append(parts.student);
  }
  sync();
  yxsSelect(form, "学科", "subject", subjects.map((x) => [x.key, YXS_SUBJECT?.[x.key] || x.name || x.key]), subjects[0]?.key || "");
  field(form, "方案标题", "title", "text", "学习方案");
  // v0.5：可以从本机构模版或平台示例开始
  const tpls = await api("plan-templates?origin=all&limit=100").catch(() => ({ items: [] }));
  const tlist = tpls.items || [];
  if (tlist.length) yxsSelect(form, "从模版开始（可选）", "template_id", [["", "空白方案"], ...tlist.map((t) => [t.id, (t.origin === "platform" ? "示例 · " : "") + t.name + (t.applicability?.grades?.length ? " · " + t.applicability.grades.join("、") : "")])], "");
  form.elements.template_id?.addEventListener("change", () => {
    const subject = tlist.find(t => t.id === form.elements.template_id.value)?.applicability?.subject;
    if (subject) form.elements.subject.value = subject;
  });
  submit(form, "建好并打开", async (d) => {
    const body = { subject: d.subject, title: d.title.trim() || "学习方案" };
    let name = "";
    if (mode === "student") (body.student_id = d.student_id), (name = list.find((s) => s.id === d.student_id)?.name || "");
    else if (mode === "lead") (body.lead_id = d.lead_id), (name = leadList.find((x) => x.id === d.lead_id)?.name || "");
    else {
      name = d.p_name.trim();
      body.prospect = { name, grade: d.p_grade.trim(), parent_name: d.p_parent_name.trim(), parent_phone: d.p_parent_phone.replace(/\s+/g, ""), direction: d.p_direction.trim(), notes: d.p_notes.trim() };
      body.create_lead = d.create_lead === "on";
    }
    if (body.title === "学习方案" && name) body.title = name + " · 学习方案";
    let p;
    const tp = tlist.find((t) => t.id === d.template_id);
    if (tp) {
      // 模版实例化：先预览（价格按本机构当前价目表），再带着顾问确认的文档创建；身份信息放在 doc 里
      const pv = await api("plan-templates/" + encodeURIComponent(tp.id) + "/instantiate-preview", "POST", { version: tp.version, shift_months: 0, pricing: "current" });
      const doc = await yxhTemplateDoc(pv, d.subject);
      if (!doc) return;
      doc.title = body.title;
      if (name && doc.modules?.basic) doc.modules.basic.student_name = name;
      for (const k of ["student_id", "lead_id", "prospect", "create_lead"]) if (k in body) doc[k] = body[k];
      p = await api("plans", "POST", { template: { id: tp.id, version: tp.version, shift_months: 0, pricing: "current" }, doc, expected_price_list_rev: pv.price_list_rev });
      if (pv.checks?.blocking?.length || pv.warnings?.length) notice("模版里有课程需要确认（停用或未定价），请在“课程计划”里看一下");
    } else p = await api("plans", "POST", body);
    await close();
    await yxPlanEditor(p.id, again, { party: mode, party_name: name });
  });
  panel.append(form);
}

// ---------- 课程方案列表 ----------
const yxhPlanState = { status: "", q: "", party: "" };
async function yxPlansPage(c) {
  const st = yxhPlanState,
    V = globalThis.ChannelV2;
  const qs = new URLSearchParams({ limit: "200" });
  if (st.status) qs.set("status", st.status);
  if (st.q) qs.set("q", st.q);
  if (st.party) qs.set("party", st.party);
  const [data, names] = await Promise.all([api("plans?" + qs), yxrNames()]);
  c.replaceChildren();
  c.classList.add("yx-page");
  const bar = el("div", null, { class: "yxs-bar" });
  for (const [k, t] of [["", "全部"], ["draft", "草稿"], ["sent", "已发送"], ["signed", "已签约"], ["archived", "已归档"]]) {
    const b = button(t, () => ((st.status = k), yxPlansPage(c)));
    b.setAttribute("aria-pressed", String(st.status === k));
    b.classList.add("yxs-tab");
    bar.append(b);
  }
  const q = el("input", null, { type: "search", placeholder: "搜方案标题", "aria-label": "搜索方案" });
  q.value = st.q;
  q.addEventListener("change", () => ((st.q = q.value.trim()), yxPlansPage(c)));
  const who = el("select", null, { "aria-label": "方案对象", class: "yxh-party-filter" });
  for (const [k, t] of [["", "全部对象"], ["student", "正式学员"], ["lead", "线索"], ["prospect", "意向（未建档）"]]) who.append(el("option", t, { value: k }));
  who.value = st.party;
  who.addEventListener("change", () => ((st.party = who.value), yxPlansPage(c)));
  bar.append(el("span", null, { class: "v-spacer" }), who, q);
  if (enabled("plans", "write")) bar.append(button("模版库", () => yxhTemplates()), button("＋ 新建方案", () => yxhNewPlan(() => yxPlansPage(c)), "primary"));
  c.append(bar);
  const box = V.panel("课程方案 · " + (data.total ?? (data.items || []).length) + " 份");
  if (!data.items?.length) box.append(el("p", "没有符合条件的方案。", { class: "v-muted v-pad" }));
  for (const p of data.items || []) {
    box.append(yxhPlanRow(p, () => yxPlansPage(c), names));
  }
  c.append(box);
}

// ---------- 日期输入（v0.4.1）----------
// 浏览器自带的日期框年份可以敲 6 位，打快了会被夹到上限（2099），也不好手输。
// 这里把每个 <input type=date|month> 包一层：可见的是文本框，支持 20261117 / 2026-11-17 / 2026.11.17 / 11-17 / 2026年11月17日；
// 原来的日期框隐藏保留（名字、取值、事件都不变），右边的日历按钮打开它的选择器。2099 年及以后显示“长期有效”。
const YXDATE_FAR = "2099-01-01";
function yxDateParse(raw, month) {
  const s = String(raw || "").trim().replace(/[年月/.\s]/g, "-").replace(/日$/, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!s) return "";
  if (/^长期/.test(String(raw).trim())) return month ? "2099-12" : "2099-12-31";
  const y0 = new Date().getFullYear();
  let y, m, d;
  let r;
  if (month) {
    if ((r = /^(\d{4})-?(\d{1,2})$/.exec(s))) [y, m] = [+r[1], +r[2]];
    else if ((r = /^(\d{1,2})$/.exec(s))) [y, m] = [y0, +r[1]];
    else return null;
    if (m < 1 || m > 12 || y < 1900 || y > 2099) return null;
    return y + "-" + String(m).padStart(2, "0");
  }
  if ((r = /^(\d{4})(\d{2})(\d{2})$/.exec(s)) || (r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = /^(\d{1,2})-(\d{1,2})$/.exec(s)) || (r = /^(\d{2})(\d{2})$/.exec(s))) [y, m, d] = [y0, +r[1], +r[2]];
  else return null;
  if (y < 1900 || y > 2099 || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}
function yxDateShow(v) {
  return v && v >= (v.length === 7 ? "2099-01" : YXDATE_FAR) ? "长期有效" : v || "";
}
function yxDateEnhance(input) {
  if (input.dataset.yxDate || input.closest(".yx-date-off")) return;
  input.dataset.yxDate = "1";
  const month = input.type === "month";
  const wrap = document.createElement("span");
  wrap.className = "yx-date" + (input.closest(".ui-field, .field, label, .v-field") ? " is-block" : "");
  const text = document.createElement("input");
  text.type = "text";
  text.inputMode = "numeric";
  text.autocomplete = "off";
  text.className = input.className;
  text.placeholder = month ? "如 2026-11" : "如 2026-11-17";
  for (const a of ["aria-label", "aria-describedby", "title"]) if (input.hasAttribute(a)) text.setAttribute(a, input.getAttribute(a));
  if (input.id) {
    text.id = input.id;
    input.removeAttribute("id");
  }
  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "yx-date-pick";
  pick.setAttribute("aria-label", "打开日历");
  pick.textContent = "▾";
  input.parentNode.insertBefore(wrap, input);
  wrap.append(text, pick, input);
  input.classList.add("yx-date-native");
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");
  const syncAttrs = () => {
    text.disabled = input.disabled;
    text.readOnly = input.readOnly;
    pick.disabled = input.disabled || input.readOnly;
    if (input.required) {
      text.required = true;
      input.required = false;
    }
  };
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const show = () => {
    if (document.activeElement !== text) text.value = yxDateShow(desc.get.call(input));
  };
  Object.defineProperty(input, "value", {
    configurable: true,
    get() {
      return desc.get.call(this);
    },
    set(v) {
      desc.set.call(this, v);
      show();
    },
  });
  const commit = () => {
    const raw = text.value.trim();
    const v = yxDateParse(raw, month);
    if (v === null) {
      text.setCustomValidity(month ? "月份格式不对，请写成 2026-11" : "日期格式不对，请写成 2026-11-17 或 20261117");
      text.reportValidity();
      return;
    }
    const lo = input.min, hi = input.max;
    if (v && ((lo && v < lo) || (hi && v > hi && !v.startsWith("2099")))) {
      text.setCustomValidity("超出可选范围" + (lo ? "：最早 " + lo : "") + (hi ? "，最晚 " + hi : ""));
      text.reportValidity();
      return;
    }
    text.setCustomValidity("");
    if (v !== desc.get.call(input)) {
      desc.set.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    text.value = yxDateShow(v);
  };
  text.addEventListener("focus", () => {
    const v = desc.get.call(input);
    if (v && v >= (month ? "2099-01" : YXDATE_FAR)) text.value = "长期有效";
    text.select();
  });
  text.addEventListener("input", () => text.setCustomValidity(""));
  text.addEventListener("blur", commit);
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      commit();
      if (text.validationMessage) e.preventDefault();
    }
  });
  pick.addEventListener("click", () => {
    try {
      input.showPicker();
    } catch {
      text.focus();
    }
  });
  input.addEventListener("change", show);
  new MutationObserver(syncAttrs).observe(input, { attributes: true, attributeFilter: ["disabled", "readonly", "required"] });
  syncAttrs();
  show();
}
function yxDateScan(root) {
  if (root.nodeType !== 1) return;
  if (root.matches?.('input[type="date"], input[type="month"]')) yxDateEnhance(root);
  for (const x of root.querySelectorAll?.('input[type="date"], input[type="month"]') || []) yxDateEnhance(x);
}
if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  const go = () => {
    yxDateScan(document.body);
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) yxDateScan(n);
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) go();
  else document.addEventListener("DOMContentLoaded", go);
}

// v0.5 机构方案模版库：查看、改名、删除（平台示例只读）
async function yxhTemplates() {
  const { panel } = drawer("方案模版库");
  const draw = async () => {
    panel.replaceChildren(el("p", "在方案编辑器“更多 › 存为本机构模版”里添加。新建方案时可以从模版开始，AI 也会参考这些模版。", { class: "v-muted" }));
    const r = await api("plan-templates?origin=all&limit=100").catch((e) => ({ items: [], err: e.message }));
    if (r.err) return panel.append(el("p", r.err, { class: "v-muted" }));
    if (!r.items.length) return panel.append(UI.empty({ text: "还没有模版" }));
    for (const t of r.items) {
      const row = el("div", null, { class: "yxh-tpl" });
      const tx = el("div");
      tx.append(el("strong", t.name), el("small", [t.origin === "platform" ? "平台示例" : "本机构", t.applicability?.directions?.join("、"), t.applicability?.grades?.join("、"), t.updated_at ? String(t.updated_at).slice(0, 10) : ""].filter(Boolean).join(" · "), { class: "v-muted" }));
      if (t.description) tx.append(el("p", t.description, { class: "v-muted" }));
      row.append(tx);
      if (me?.capabilities?.plan_templates?.write !== false && enabled("plans", "write")) {
        const edit = (copy) => async () => {
          const current = (await api("plan-templates/" + encodeURIComponent(t.id))).template;
          const { panel: editor, close } = drawer(copy ? "另存为本机构模版" : "模版改名");
          const form = el("form");
          field(form, "模版名称", "name", "text", current.name + (copy ? "（副本）" : ""));
          submit(form, copy ? "另存模版" : "保存名称", async d => {
            const payload = { name: d.name.trim(), description: current.description, applicability: current.applicability, doc: current.doc };
            await api(copy ? "plan-templates" : "plan-templates/" + encodeURIComponent(t.id), copy ? "POST" : "PUT", { ...payload, ...(copy ? { source: { template_id: current.id, version: current.version } } : { version: current.version }) });
            await close();
            notice(copy ? "已另存为本机构模版" : "已改名", "success");
            await draw();
          });
          editor.append(form);
        };
        if (!t.readonly && t.origin !== "platform") row.append(button("改名", edit(false)));
        row.append(button("另存为本机构模版", edit(true)));
      }
      if (t.origin !== "platform" && !t.readonly && enabled("plans", "write"))
        row.append(
          button("删除", async () => {
            if (!(await UI.confirm({ title: "删除模版“" + t.name + "”？", consequence: "已经用这个模版做好的方案不受影响。", danger: true }))) return;
            await api("plan-templates/" + encodeURIComponent(t.id), "DELETE", { version: t.version });
            notice("已删除", "success");
            draw();
          }),
        );
      panel.append(row);
    }
  };
  await draw();
}
