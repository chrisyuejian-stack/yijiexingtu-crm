// 艺界星途 · 阶段 3 机构设置前端（Claude）
// 挂在“机构设置”页左侧分类下：学科模板、课程与价目、阶段与规则、节点日历、成长报告班型、机构档案、图库、修改卡片。
// 接口见冻结约定 v0.3.4 §4.1；集合类设置整体保存并带 version，冲突时刷新为最新内容。
// 约束同 yx.js：只用 DOM 构造与 textContent，不写内联 style。

const YXS_SUBJECT = { music_interest: "音乐 · 兴趣", music_exam: "音乐 · 艺考", art_interest: "美术 · 兴趣", art_exam: "美术 · 艺考" };
const YXS_FORM = { one_to_one: "一对一", small_class: "小班", group: "集体课", package: "课包", camp: "集训营" };
const YXS_MODE = { per_unit: "按课时", per_term: "按期", per_semester: "按学期", per_month: "按月", package: "按课包" };
const YXS_ANCHOR = { start: "起步阶段", normal: "常规阶段", on_node: "落在节点上", before_node: "节点前", after_node: "节点后" };
const YXS_RULES = [
  ["exam_sprint_before_grade", "考级前 2 个月自动切成冲刺阶段，并加冲刺课"],
  ["insert_holiday_camp", "寒暑假自动插入集训阶段"],
  ["art_exam_end_after_school_exam", "艺考：校考后方案收尾，提示文化课不排课"],
  ["art_transition_stage", "美术：8–10 岁从创意美术转素描色彩时加过渡阶段"],
  ["mock_exam_schedule", "艺考：每阶段末 1 次模拟考，统考冲刺期每月 1 次"],
];
const YXS_OPTIONS = [
  ["compare_previous", "和上一期对比"],
  ["mock_exam", "包含模拟考成绩"],
  ["require_artwork", "必须附作品"],
  ["renewal_suggestion", "允许附续报建议"],
];
const YXS_STATS = [
  ["lessons", "上课次数"],
  ["attendance", "出勤次数"],
  ["repertoire_done", "完成曲目 / 作品"],
  ["camp_days", "集训天数（需在课程库关联集训排课课程）"],
  ["mock_count", "模拟考次数"],
  ["days_to_exam", "距统考天数（需在节点日历填统考精确日期）"],
];
const YXS_SECTIONS = [
  ["yx_subjects", "学科模板"],
  ["yx_courses", "课程与价目"],
  ["yx_stages", "阶段与规则"],
  ["yx_calendar", "节点日历"],
  ["yx_reports", "成长报告班型"],
  ["yx_profile", "机构档案"],
  ["yx_gallery", "图库"],
  ["yx_changes", "修改卡片"],
];
const YXS_HINT = {
  yx_subjects: "导入学科模板会把课程、阶段、节点、报告维度和内容结构放进本机构。不带价格；已有同名项目不会被覆盖，可以放心重复导入。",
  yx_courses: "这里是给家长报价、写课程方案用的课程库，和排课用的课程分开保存。价格留空表示还没定价。",
  yx_stages: "课程方案会按这些阶段和规则自动排出学习路径。",
  yx_calendar: "考级季、集训、统考这些节点决定冲刺和集训阶段落在哪几个月。",
  yx_reports: "每个班型有自己的打分维度。维度改名不影响历史报告；删掉的维度编号不能再用。",
  yx_profile: "课程方案只用这里填写的事实；写招生文案时 AI 可以自由发挥，但价格、日期、老师等具体信息仍以这里为准，没有就留“【待填】”。",
  yx_gallery: "图片只在本机构内使用。打上“家长已同意展示”标签的作品，才会出现在报告和宣传里。",
  yx_changes: "AI 提出的设置修改会先变成卡片，主管批准后才生效；批准后还能撤回。",
};

// 机构设置顶部页签原有 4 个，再加 8 个放不下；艺界星途的设置合成一个“招生工具”页签，里面再分小页签。
var yxsSub = "yx_subjects";
function yxSettingsSections() {
  // 设计稿 v3：这些设置已拆到“课程与教室”“机构设置”的分页里（见 yx-home.js 的 yxNavRework）。
  return [];
}
// 报价课程页顶部的学科包（设计稿 v3）
async function yxsSubjectBar(box, again) {
  const list = await api("settings/subjects").catch(() => []);
  const row = el("div", null, { class: "yxs-subjectbar" });
  row.append(el("span", "学科包", { class: "v-muted" }));
  for (const x of list) {
    const t = el("span", YXS_SUBJECT[x.key] || x.key, { class: "yxs-subject is-on" });
    t.title = "模板版本 " + x.pack_version;
    row.append(t);
  }
  row.append(globalThis.ChannelV2.link("＋ 添加学科包", () => (location.hash = "inst-subjects")));
  box.append(row);
}
// 旧的跳转键（yx_profile 等）转成“招生工具”页签下对应的小页签。
function yxSettingsRoute(section) {
  if (YXS_SECTIONS.some((x) => x[0] === section)) {
    yxsSub = section;
    return "yx";
  }
  return section;
}

// ---------- 通用 ----------
function yxsV() {
  return globalThis.ChannelV2;
}
function yxsTable(head, rows) {
  const t = el("table", null, { class: "v-table yxs-table" }),
    tr = el("tr");
  for (const h of head) tr.append(el("th", h));
  const thead = el("thead");
  thead.append(tr);
  const tbody = el("tbody");
  for (const r of rows) {
    const line = el("tr");
    for (const cell of r) {
      const td = el("td");
      if (cell instanceof Node) td.append(cell);
      else td.textContent = cell ?? "";
      line.append(td);
    }
    tbody.append(line);
  }
  t.append(thead, tbody);
  const wrap = el("div", null, { class: "yxs-table-wrap" });
  wrap.append(t);
  return wrap;
}
function yxsSelect(form, label, name, options, value, required = true) {
  const wrap = el("label", label, { class: "field" }),
    s = el("select", null, { name });
  if (!required) s.append(el("option", "（不选）", { value: "" }));
  for (const [v, t] of options) s.append(el("option", t, { value: v }));
  if (value !== undefined && value !== null) s.value = value;
  wrap.append(s);
  form.append(wrap);
  return s;
}
function yxsCheck(parent, label, name, checked, hint) {
  const line = el("label", null, { class: "yxs-check" }),
    input = el("input", null, { type: "checkbox", name });
  input.checked = !!checked;
  line.append(input, el("span", label));
  if (hint) line.append(el("small", hint));
  parent.append(line);
  return input;
}
function yxsLines(v) {
  return String(v || "")
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
function yxsPrice(p) {
  if (!p) return "未定价";
  const amount = "¥" + Number(p.amount).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  if (p.mode === "package") return amount + " / " + (p.units_per_package || "?") + " 课时包";
  return amount + " " + (p.unit_label ? "/ " + p.unit_label : YXS_MODE[p.mode] || "");
}
// 保存时如遇版本冲突：提示并重新载入当前分类。
async function yxsSave(fn, again) {
  try {
    const r = await fn();
    notice("已保存", "success");
    await again();
    return r;
  } catch (e) {
    if (e.code === "version_conflict") {
      notice("已被别人修改，已刷新为最新内容，请重新确认后再保存。");
      await again();
      return null;
    }
    throw e;
  }
}
async function yxsUpload(path, data) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.append(k, v);
  const res = await fetch(base + "api/" + path, { method: "POST", body: fd, credentials: "same-origin" });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = Error(result.message || result.error || "上传失败");
    e.code = result.message ? result.error : result.code;
    e.details = result.details;
    throw e;
  }
  apiCache?.clear?.();
  return result;
}
// 机构设置页的入口：返回 true 表示已由本文件渲染。
async function yxSettingsSection(body, head, section, again) {
  const draw = {
    yx_subjects: yxsSubjects,
    yx_courses: yxsCourses,
    yx_stages: yxsStages,
    yx_calendar: yxsCalendar,
    yx_reports: yxsReports,
    yx_profile: yxsProfile,
    yx_gallery: yxsGallery,
    yx_changes: yxsChanges,
  }[section === "yx" ? yxsSub : section];
  if (!draw) return false;
  if (section === "yx") {
    section = yxsSub;
    head.querySelector("h2").textContent = YXS_SECTIONS.find((x) => x[0] === section)[1];
    const sub = el("div", null, { class: "yxs-subnav", role: "tablist", "aria-label": "招生工具设置" });
    for (const [k, t] of YXS_SECTIONS) {
      const b = button(t, () => {
        yxsSub = k;
        again();
      });
      b.classList.add("yxs-tab");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(k === section));
      b.setAttribute("aria-pressed", String(k === section));
      sub.append(b);
    }
    head.before(sub);
  }
  if (YXS_HINT[section]) head.after(el("p", YXS_HINT[section], { class: "v-muted v-set-hint" }));
  await draw(body, again);
  return true;
}

// ---------- 学科模板 ----------
async function yxsSubjects(body, again) {
  const list = await api("settings/subjects");
  const done = new Map(list.map((x) => [x.key, x]));
  const grid = el("div", null, { class: "yxs-cards" });
  for (const [key, name] of Object.entries(YXS_SUBJECT)) {
    const card = el("div", null, { class: "v-panel yxs-card" + (done.has(key) ? " is-on" : "") });
    card.append(el("strong", name));
    if (done.has(key)) card.append(el("p", "已导入 · 模板版本 " + done.get(key).pack_version, { class: "v-muted" }));
    else card.append(el("p", "未导入", { class: "v-muted" }));
    card.append(
      button(done.has(key) ? "重新导入（补齐缺少的项目）" : "导入模板", async () => {
        await api("settings/subjects", "POST", { key });
        notice("已导入 " + name, "success");
        await again();
      }, done.has(key) ? "" : "primary"),
    );
    grid.append(card);
  }
  body.append(
    el("div", null, { class: "yxs-bar" }),
  );
  body.lastChild.append(
    globalThis.ChannelV2.link("← 返回报价课程与价目表", () => (location.hash = "courses-quote")),
  );
  body.append(grid, el("p", "只能导入平台为本机构开通的学科；需要开通其他学科请联系平台。", { class: "v-muted" }));
}

// ---------- 课程与价目 ----------
const yxsCourseState = { subject: "", q: "", inactive: false, limit: 50 };
async function yxsCourses(body, again) {
  const st = yxsCourseState,
    V = yxsV();
  const qs = new URLSearchParams({ limit: String(st.limit), offset: "0", include_inactive: st.inactive ? "1" : "0" });
  if (st.subject) qs.set("subject", st.subject);
  if (st.q) qs.set("q", st.q);
  const data = await api("settings/courses?" + qs);
  const all = data.items || [];
  // 课程组页签（设计稿 v3）：全部 + 各课程组，带数量
  const groups = [...new Set(all.map((c) => c.group || "其他"))];
  if (st.group && !groups.includes(st.group)) st.group = "";
  const panel = el("div", null, { class: "v-panel yxs-course-panel" });
  const bar = el("div", null, { class: "yxv-filter" });
  const tabs = el("div", null, { class: "yxv-seg" });
  for (const g of ["", ...groups]) {
    const n = g ? all.filter((c) => (c.group || "其他") === g).length : all.length;
    const b = el("button", null, { type: "button", "aria-pressed": String((st.group || "") === g) });
    b.append((g || "全部") + " ", el("span", String(n), { class: "v-muted" }));
    b.addEventListener("click", () => ((st.group = g), again()));
    tabs.append(b);
  }
  const q = el("input", null, { type: "search", placeholder: "搜课程名称", "aria-label": "搜索课程", class: "yxs-search" });
  q.value = st.q;
  q.addEventListener("change", () => ((st.q = q.value.trim()), again()));
  const tools = el("div", null, { class: "yxs-tools" });
  const inactive = yxsCheck(tools, "显示已停用", "inactive", st.inactive);
  inactive.addEventListener("change", () => ((st.inactive = inactive.checked), again()));
  bar.append(tabs, el("span", null, { class: "v-spacer" }), q, tools);
  const top = el("div", null, { class: "yxs-course-top" });
  top.append(el("span", null, { class: "v-spacer" }), button("导入 Excel", () => yxsImport(again)), button("＋ 新增课程", () => yxsCourseForm(null, again), "primary"));
  body.append(top, panel);
  panel.append(bar);
  const items = all.filter((c) => !st.group || (c.group || "其他") === st.group);
  if (!items.length) {
    panel.append(el("p", all.length ? "这个课程组里没有课程。" : "还没有课程。可以先添加学科包，或者点“新增课程”。", { class: "v-muted v-pad" }));
    return;
  }
  const rows = items.map((c) => {
    const name = el("div", null, { class: "yxs-name" });
    name.append(el("span", c.name));
    if (c.optional) name.append(el("span", "可选费用", { class: "yxv-tag" }));
    if (!c.active) name.append(el("span", "已停用", { class: "yxv-tag" }));
    const ops = el("div", null, { class: "yxs-ops" });
    ops.append(V.link("编辑", () => yxsCourseForm(c, again)));
    if (c.active)
      ops.append(
        V.link("停用", async () => {
          if (!(await UI.confirm({ title: "停用“" + c.name + "”？", consequence: "新方案不能再选它；已有方案和历史价格保留。", danger: true }))) return;
          await yxsSave(() => api("settings/courses/" + encodeURIComponent(c.id), "DELETE", { version: c.version }), again);
        }),
      );
    const priced = "pricing" in c;
    const p = c.pricing;
    const amt = p ? "¥" + Number(p.amount).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "";
    const price = !priced ? "—" : p ? amt + " / " + (p.mode === "package" ? (p.units_per_package || "?") + " 课时包" : p.unit_label || { per_unit: "课时", per_term: "期", per_semester: "学期", per_month: "月" }[p.mode] || "") : el("span", "未定价", { class: "yx-dot is-bad" });
    const grp = el("span", c.group || "—", { class: "v-muted" });
    return [name, grp, YXS_FORM[c.form] || c.form, c.minutes ? c.minutes + "′" : c.duration_text || "—", priced && c.pricing ? YXS_MODE[c.pricing.mode] || "" : "—", price, YXS_SUBJECT[c.subject] || c.subject, ops];
  });
  const t = yxsTable(["课程", "课程组", "形式", "时长", "计价方式", "价格", "学科", ""], rows);
  t.classList.add("yxv-table");
  panel.append(t);
  if (data.next_offset != null) panel.append(button("显示更多（共 " + data.total + " 门）", () => ((st.limit += 50), again())));
  panel.append(el("p", "没定价的课程 AI 不会选。价格只有主管能改。这里是做方案用的报价课程，和排课用的“排课课程”分开管理。", { class: "yxs-foot-note" }));
}
function yxsCourseForm(c, again) {
  const { panel, close } = drawer(c ? "编辑课程" : "新增课程"),
    form = el("form");
  yxsSelect(form, "学科", "subject", Object.entries(YXS_SUBJECT), c?.subject);
  field(form, "课程组（如：主修、基础乐科、可选费用）", "group", "text", c?.group || "主修");
  field(form, "课程名称", "name", "text", c?.name || "");
  yxsSelect(form, "上课形式", "form", Object.entries(YXS_FORM), c?.form || "one_to_one");
  const minutes = field(form, "每节时长（分钟，15–480）", "minutes", "number", c?.minutes ?? "", false);
  minutes.min = "15";
  minutes.max = "480";
  field(form, "或者时长说明（如“半天”“全天”）", "duration_text", "text", c?.duration_text || "", false);
  const priced = "pricing" in (c || { pricing: null });
  if (priced) {
    yxsSelect(form, "计价方式", "mode", [["", "未定价"], ...Object.entries(YXS_MODE)], c?.pricing?.mode || "", true);
    field(form, "金额（元，最多两位小数）", "amount", "number", c?.pricing?.amount ?? "", false).step = "0.01";
    field(form, "每包课时（按课包计价时填）", "units", "number", c?.pricing?.units_per_package ?? "", false);
    field(form, "计价单位（可选，如“节”“期”）", "unit_label", "text", c?.pricing?.unit_label || "", false);
  }
  const opt = yxsCheck(form, "这是可选费用（教材、考级报名费等）", "optional", c?.optional);
  // 集训课关联排课课程：成长报告“集训天数”只统计这样关联过的课（接口 v0.3.7 §4.1.2）。
  const link = el("label", null, { class: "field" });
  const linkSel = el("select", null, { name: "course_type_id" });
  linkSel.append(el("option", "不关联", { value: "" }));
  link.append(el("span", "对应的排课课程（集训课填写后，成长报告才能统计集训天数）"), linkSel);
  form.append(link);
  api("data/course_types?limit=200")
    .then((r) => {
      for (const t of r.items || []) linkSel.append(el("option", t.name, { value: t.id }));
      linkSel.value = c?.course_type_id || "";
    })
    .catch(() => link.remove());
  const syncLink = () => (link.hidden = form.elements.form.value !== "camp" && !linkSel.value);
  form.elements.form.addEventListener("change", syncLink);
  syncLink();
  submit(form, "保存", async (d) => {
    const doc = {
      subject: d.subject,
      group: d.group.trim(),
      name: d.name.trim(),
      form: d.form,
      minutes: d.minutes === "" ? null : Number(d.minutes),
      duration_text: d.duration_text.trim() || null,
      optional: opt.checked,
      course_type_id: linkSel.value || null,
      active: c ? c.active : true,
    };
    if (priced) {
      if (!d.mode) doc.pricing = null;
      else {
        if (d.amount === "") throw Error("请填写金额，或把计价方式选为“未定价”");
        doc.pricing = { mode: d.mode, amount: Number(d.amount) };
        if (d.mode === "package") doc.pricing.units_per_package = Number(d.units);
        if (d.unit_label.trim()) doc.pricing.unit_label = d.unit_label.trim();
      }
    } else if (c) doc.pricing = undefined;
    await yxsSave(
      () => (c ? api("settings/courses/" + encodeURIComponent(c.id), "PUT", { ...doc, id: c.id, version: c.version }) : api("settings/courses", "POST", doc)),
      async () => {
        await close();
        await again();
      },
    );
  });
  panel.append(form);
}
function yxsImport(again) {
  const { panel, close } = drawer("Excel 导入课程与价格"),
    box = el("div", null, { class: "yxs-import" });
  box.append(
    el("p", "表头：学科、课程组、课程名称、形式、时长分钟、时长说明、计价方式、金额、每包课时（可选列：排课课程ID、可选费用）。先预览，确认无误再导入；一次最多 200 行。", { class: "muted" }),
  );
  const form = el("form"),
    file = el("input", null, { type: "file", name: "file", accept: ".xlsx", required: "", "aria-label": "选择 Excel 文件" });
  const result = el("div");
  const pick = el("label", "Excel 文件（.xlsx）", { class: "field" });
  pick.append(file);
  form.append(pick);
  box.append(form, result);
  submit(form, "检查文件", async () => {
    if (!file.files?.[0]) throw Error("请选择 Excel 文件");
    result.replaceChildren(el("p", "正在检查…", { class: "muted" }));
    try {
      const p = await yxsUpload("settings/courses/import", { file: file.files[0] });
      result.replaceChildren();
      const bad = p.rows.filter((r) => r.errors?.length);
      result.append(el("p", "共 " + p.rows.length + " 行" + (bad.length ? "，其中 " + bad.length + " 行有问题，需要改好后重新上传" : "，全部可以导入"), { class: bad.length ? "yxs-warn" : "" }));
      result.append(
        yxsTable(
          ["行", "课程", "价格", "问题"],
          p.rows.map((r) => [String(r.row), r.course ? (YXS_SUBJECT[r.course.subject] || "") + " · " + r.course.name : "—", r.course ? yxsPrice(r.course.pricing) : "—", (r.errors || []).map((e) => e.message || e).join("；") || "✓"]),
        ),
      );
      if (p.can_commit)
        result.append(
          button("确认导入 " + p.rows.length + " 门课程", async () => {
            const r = await yxsUpload("settings/courses/import", { preview_id: p.preview_id, confirm: "true" });
            notice("已导入 " + r.imported + " 门课程", "success");
            await close();
            await again();
          }, "primary"),
        );
    } catch (e) {
      result.replaceChildren(el("p", e.message, { class: "yxs-warn" }));
    }
  });
  panel.append(box);
}

// ---------- 阶段与规则 ----------
async function yxsStages(body, again) {
  const V = yxsV();
  const [types, rules, courseRules, calendar] = await Promise.all([
    api("settings/stage-types?limit=200"),
    api("settings/stage-rules"),
    api("settings/course-rules"),
    api("settings/calendar"),
  ]);
  const nodeName = Object.fromEntries((calendar.items || []).map((x) => [x.key, x.name]));
  const p1 = V.panel("阶段类型", [el("span", null, { class: "v-spacer" }), V.link("＋ 新增阶段", () => yxsStageForm(null, calendar, again))]);
  const items = types.items || [];
  if (!items.length) p1.append(el("p", "还没有阶段。先在“学科模板”里导入。", { class: "v-muted v-pad" }));
  else
    p1.append(
      yxsTable(
        ["学科", "阶段", "时长", "位置", "状态", ""],
        items.map((s) => {
          const where =
            s.anchor === "before_node" || s.anchor === "after_node"
              ? (nodeName[s.anchor_node] || s.anchor_node) + (s.anchor === "before_node" ? " 前 " : " 后 ") + Math.abs(s.offset_months) + " 个月"
              : s.anchor === "on_node"
                ? "落在“" + (nodeName[s.anchor_node] || s.anchor_node) + "”"
                : YXS_ANCHOR[s.anchor];
          const ops = el("div", null, { class: "yxs-ops" });
          ops.append(V.link("编辑", () => yxsStageForm(s, calendar, again)));
          if (s.active)
            ops.append(
              V.link("停用", () =>
                yxsSave(() => api("settings/stage-types", "DELETE", { id: s.id, version: s.version }), again),
              ),
            );
          return [YXS_SUBJECT[s.subject] || s.subject, s.name, s.default_months.min + "–" + s.default_months.max + " 个月", where, s.active ? V.chip("启用", "ok") : V.chip("已停用", "muted"), ops];
        }),
      ),
    );
  // 自动规则：5 个开关整体保存。
  const p2 = V.panel("自动规则"),
    f2 = el("form", null, { class: "yxs-pad" });
  for (const [key, label] of YXS_RULES) yxsCheck(f2, label, key, rules.rules?.[key]);
  submit(f2, "保存规则", () =>
    yxsSave(
      () =>
        api("settings/stage-rules", "PUT", {
          version: rules.version,
          rules: Object.fromEntries(YXS_RULES.map(([k]) => [k, !!f2.elements[k].checked])),
        }),
      again,
    ),
  );
  p2.append(f2);
  // 选课规则
  const stageName = Object.fromEntries(items.map((s) => [s.id, s.name]));
  const p3 = V.panel("选课规则", [el("span", null, { class: "v-spacer" }), V.link("＋ 新增规则", () => yxsCourseRuleForm(null, courseRules, items, again))]);
  const cr = courseRules.items || [];
  if (!cr.length) p3.append(el("p", "还没有选课规则：每个阶段必选哪些课、推荐哪些课、课时范围。", { class: "v-muted v-pad" }));
  else {
    const all = await api("settings/courses?limit=200&include_inactive=1");
    const cname = Object.fromEntries((all.items || []).map((c) => [c.id, c.name]));
    const names = (ids) => ids.map((id) => cname[id] || id).join("、") || "—";
    p3.append(
      yxsTable(
        ["阶段", "必选", "推荐", "课时", ""],
        cr.map((r, i) => {
          const ops = el("div", null, { class: "yxs-ops" });
          ops.append(
            V.link("编辑", () => yxsCourseRuleForm(i, courseRules, items, again)),
            V.link("删除", () =>
              yxsSave(() => api("settings/course-rules", "PUT", { version: courseRules.version, items: cr.filter((_, j) => j !== i) }), again),
            ),
          );
          return [stageName[r.stage_type_id] || r.stage_type_id, names(r.required), names(r.recommended), r.units ? r.units.min + "–" + r.units.max : "—", ops];
        }),
      ),
    );
  }
  body.append(p1, p2, p3);
}
function yxsStageForm(s, calendar, again) {
  const { panel, close } = drawer(s ? "编辑阶段" : "新增阶段"),
    form = el("form");
  yxsSelect(form, "学科", "subject", Object.entries(YXS_SUBJECT), s?.subject);
  field(form, "阶段名称", "name", "text", s?.name || "");
  field(form, "最短（月）", "min", "number", s?.default_months?.min ?? 1);
  field(form, "最长（月）", "max", "number", s?.default_months?.max ?? 3);
  const anchor = yxsSelect(form, "位置", "anchor", Object.entries(YXS_ANCHOR), s?.anchor || "normal");
  const node = yxsSelect(form, "关联节点", "anchor_node", (calendar.items || []).map((x) => [x.key, x.name]), s?.anchor_node, false);
  const offset = field(form, "相差几个月（节点前后时填）", "offset", "number", Math.abs(s?.offset_months || 0), false);
  field(form, "排序（数字小的在前）", "order", "number", s?.order ?? 50);
  const sync = () => {
    const needNode = anchor.value.endsWith("_node");
    node.closest("label").hidden = !needNode;
    offset.closest(".field").hidden = !["before_node", "after_node"].includes(anchor.value);
  };
  anchor.addEventListener("change", sync);
  sync();
  submit(form, "保存", async (d) => {
    const needNode = d.anchor.endsWith("_node");
    if (needNode && !d.anchor_node) throw Error("请选择关联节点");
    const n = Math.abs(Number(d.offset || 0));
    const doc = {
      subject: d.subject,
      name: d.name.trim(),
      default_months: { min: Number(d.min), max: Number(d.max) },
      anchor: d.anchor,
      anchor_node: needNode ? d.anchor_node : null,
      offset_months: d.anchor === "before_node" ? -n : d.anchor === "after_node" ? n : 0,
      order: Number(d.order),
      active: s ? s.active : true,
    };
    await yxsSave(
      () => (s ? api("settings/stage-types", "PUT", { ...doc, id: s.id, version: s.version }) : api("settings/stage-types", "POST", doc)),
      async () => {
        await close();
        await again();
      },
    );
  });
  panel.append(form);
}
async function yxsCourseRuleForm(index, all, stages, again) {
  const cur = index === null ? null : all.items[index];
  const { panel, close } = drawer(cur ? "编辑选课规则" : "新增选课规则"),
    form = el("form");
  const used = new Set(all.items.map((r, i) => (i === index ? null : r.stage_type_id)));
  const stage = yxsSelect(form, "阶段", "stage", stages.filter((s) => s.active && !used.has(s.id)).map((s) => [s.id, (YXS_SUBJECT[s.subject] || "") + " · " + s.name]), cur?.stage_type_id);
  const pick = el("div", null, { class: "yxs-pick" });
  form.append(pick);
  const draw = async () => {
    const s = stages.find((x) => x.id === stage.value);
    const list = await api("settings/courses?limit=200" + (s ? "&subject=" + s.subject : ""));
    pick.replaceChildren();
    const req = el("fieldset", null, { class: "yxs-group" }),
      rec = el("fieldset", null, { class: "yxs-group" });
    req.append(el("legend", "必选课程"));
    rec.append(el("legend", "推荐课程"));
    for (const c of list.items || []) {
      yxsCheck(req, c.name, "req_" + c.id, cur?.required?.includes(c.id));
      yxsCheck(rec, c.name, "rec_" + c.id, cur?.recommended?.includes(c.id));
    }
    pick.append(req, rec);
  };
  stage.addEventListener("change", draw);
  await draw();
  field(form, "最少课时", "umin", "number", cur?.units?.min ?? "", false);
  field(form, "最多课时", "umax", "number", cur?.units?.max ?? "", false);
  submit(form, "保存", async (d) => {
    const ids = (p) => [...form.querySelectorAll("input[name^=" + p + "]:checked")].map((x) => x.name.slice(4));
    const item = {
      stage_type_id: d.stage,
      required: ids("req_"),
      recommended: ids("rec_"),
      exclusive: cur?.exclusive || [],
      ...(d.umin !== "" && d.umax !== "" ? { units: { min: Number(d.umin), max: Number(d.umax) } } : {}),
    };
    const items = [...all.items];
    if (cur) items[index] = item;
    else items.push(item);
    await yxsSave(
      () => api("settings/course-rules", "PUT", { version: all.version, items }),
      async () => {
        await close();
        await again();
      },
    );
  });
  panel.append(form);
}

// ---------- 节点日历 ----------
async function yxsCalendar(body, again) {
  const cal = await api("settings/calendar");
  const items = (cal.items || []).map((x) => ({ ...x, months: [...x.months] }));
  const form = el("form", null, { class: "v-panel yxs-pad yxs-cal" });
  const region = field(form, "机构所在地（只用于显示，如“上海”）", "region", "text", cal.region || "", false);
  const list = el("div", null, { class: "yxs-cal-list" });
  form.append(list);
  const draw = () => {
    list.replaceChildren();
    const hr = el("div", null, { class: "yxs-cal-row is-head" });
    const ms = el("div", null, { class: "yxs-gantt-head" });
    for (let m = 1; m <= 12; m++) ms.append(el("span", m === 1 ? "1 月" : String(m)));
    hr.append(el("span", "节点", { class: "v-muted" }), ms, el("span", "精确日期", { class: "v-muted" }), el("span"), el("span"));
    list.append(hr);
    items.forEach((x, i) => {
      const row = el("div", null, { class: "yxs-cal-row" });
      const name = el("input", null, { type: "text", "aria-label": "节点名称", value: x.name });
      name.addEventListener("input", () => (x.name = name.value));
      const months = el("div", null, { class: "yxs-months yxs-gantt is-c" + (i % 5), role: "group", "aria-label": x.name + " 月份（点格子选月份）" });
      for (let m = 1; m <= 12; m++) {
        const b = el("button", null, { type: "button", class: "yxs-month", "aria-pressed": String(x.months.includes(m)), "aria-label": m + "月", title: m + "月" });
        b.addEventListener("click", () => {
          x.months = x.months.includes(m) ? x.months.filter((y) => y !== m) : [...x.months, m].sort((a, c) => a - c);
          b.setAttribute("aria-pressed", String(x.months.includes(m)));
        });
        months.append(b);
      }
      const next = el("label", null, { class: "yxs-check is-inline" }),
        nb = el("input", null, { type: "checkbox" });
      nb.checked = !!x.next_year;
      nb.addEventListener("change", () => (x.next_year = nb.checked));
      next.append(nb, el("span", "在第二年"));
      const del = button("删除", () => {
        items.splice(i, 1);
        draw();
      });
      const exact = el("input", null, { type: "date", "aria-label": x.name + " 精确日期（可选）", value: x.exact_date || "" });
      exact.title = "精确日期（可选）：填了统考日期，成长报告才会显示“距统考”天数";
      exact.addEventListener("change", () => (x.exact_date = exact.value || null));
      row.append(name, months, exact, next, del);
      list.append(row);
    });
  };
  draw();
  form.append(
    button("＋ 新增节点", () => {
      items.push({ key: "node_" + Date.now().toString(36), name: "新节点", months: [] });
      draw();
    }),
  );
  submit(form, "保存日历", async () => {
    for (const x of items) if (!x.name.trim() || !x.months.length) throw Error("每个节点都要填名称并至少选一个月");
    await yxsSave(
      () =>
        api("settings/calendar", "PUT", {
          version: cal.version,
          region: region.value.trim() || null,
          items: items.map((x) => ({ key: x.key, name: x.name.trim(), months: x.months, ...(x.note ? { note: x.note } : {}), ...(x.next_year ? { next_year: true } : {}), ...(x.exact_date ? { exact_date: x.exact_date } : {}) })),
        }),
      again,
    );
  });
  body.append(form, el("p", "被阶段引用的节点不能直接删除，请先改掉对应阶段的“关联节点”。日期框可填精确日期（如统考那天），成长报告会据此显示“距统考”天数。", { class: "v-muted" }));
}

// ---------- 成长报告班型 ----------
// 成长报告维度（设计稿 v3）：左班型列表，中间维度与快捷词，右边顶部数字和显示选项；一起保存。
const yxsDimState = { sel: null, draft: null };
async function yxsReports(body, again) {
  const st = yxsDimState;
  const data = await api("settings/report-classes?limit=200");
  const items = data.items || [];
  if (!items.length) {
    const bar = el("div", null, { class: "yxs-bar" });
    bar.append(el("span", null, { class: "v-spacer" }), button("＋ 新增班型", () => yxsReportForm(null, again), "primary"));
    return body.append(bar, UI.empty({ text: "还没有成长报告班型。先添加学科包，或点“新增班型”。" }));
  }
  if (!items.some((x) => x.id === st.sel)) {
    st.sel = items[0].id;
    st.draft = null;
  }
  const cur = items.find((x) => x.id === st.sel);
  if (!st.draft || st.draft.id !== cur.id || st.draft.version !== cur.version) st.draft = yxClone(cur);
  const d = st.draft;
  const wrap = el("div", null, { class: "yxs-dims" });
  body.append(wrap);
  // 左：班型
  const left = el("div", null, { class: "yxs-dims-left" });
  left.append(el("p", "班型 · 老师打分用哪一套维度", { class: "v-muted yxs-dims-cap" }));
  for (const r of items) {
    const b = el("button", null, { type: "button", class: "yxs-dims-class" + (r.id === st.sel ? " is-on" : "") + (r.active ? "" : " is-off"), "aria-pressed": String(r.id === st.sel) });
    b.append(el("strong", r.name), el("small", r.dimensions.length + " 个维度" + (r.options?.mock_exam ? " + 模拟考" : "") + " · " + (YXS_SUBJECT[r.subject] || r.subject) + (r.active ? "" : " · 已停用"), { class: "v-muted" }));
    b.addEventListener("click", async () => {
      if (r.id === st.sel) return;
      if (yxsDimDirty(st, items) && !(await UI.confirm({ title: "有未保存的修改，确定切换？", consequence: "切换后这些修改会丢失。", danger: true }))) return;
      st.sel = r.id;
      st.draft = null;
      again();
    });
    left.append(b);
  }
  left.append(button("＋ 新增班型", () => yxsReportForm(null, again)));
  // 中：维度
  const mid = el("div", null, { class: "v-panel yxs-dims-mid" });
  const h = el("div", null, { class: "yxs-dims-h" });
  const ht = el("div");
  ht.append(el("h3", d.name + " · " + d.dimensions.length + " 个维度"), el("small", "每项 1–5 分，由老师打。用 ↑ 调整顺序。", { class: "v-muted" }));
  const dirty = () => {
    save.disabled = false;
    hint.hidden = false;
  };
  const save = button("保存修改", async () => {
    if (!d.dimensions.length || d.dimensions.some((x) => !String(x.name).trim())) throw Error("至少一个维度，且每个维度都要有名称");
    const doc = { subject: d.subject, name: d.name, active: d.active, dimensions: d.dimensions.map((x, i) => ({ key: x.key, name: String(x.name).trim(), order: i + 1, feedback_tags: x.feedback_tags || [] })), options: d.options || {} };
    await yxsSave(() => api("settings/report-classes", "PUT", { ...doc, id: d.id, version: d.version }), async () => ((st.draft = null), again()));
  }, "primary");
  save.disabled = !yxsDimDirty(st, items);
  const hint = el("span", "有未保存的修改", { class: "yxv-saved is-dirty" });
  hint.hidden = save.disabled;
  const more = UI.actionMenu({
    label: "更多",
    items: [
      { label: "改名称和学科", onSelect: () => yxsReportForm(cur, again) },
      ...(cur.active ? [{ label: "停用这个班型", danger: true, onSelect: () => yxsSave(() => api("settings/report-classes", "DELETE", { id: cur.id, version: cur.version }), again) }] : []),
    ],
  }).element;
  h.append(ht, el("span", null, { class: "v-spacer" }), hint, button("＋ 维度", () => {
    d.dimensions.push({ key: "k" + Date.now().toString(36), name: "新维度", order: d.dimensions.length + 1, feedback_tags: [] });
    dirtyRedraw();
  }), save, more);
  mid.append(h);
  const table = el("div", null, { class: "yxs-dims-table" });
  const th = el("div", null, { class: "yxs-dim-row is-head" });
  th.append(el("span"), el("span", "维度"), el("span", "手机端写反馈时的快捷词"), el("span"));
  table.append(th);
  const rows = el("div");
  table.append(rows);
  const dirtyRedraw = () => {
    dirty();
    drawRows();
  };
  const drawRows = () => {
    rows.replaceChildren();
    d.dimensions.forEach((x, i) => {
      const row = el("div", null, { class: "yxs-dim-row" });
      const up = el("button", "↑", { type: "button", class: "yxs-dim-up", "aria-label": "上移 " + x.name, title: "上移" });
      up.disabled = !i;
      up.addEventListener("click", () => {
        [d.dimensions[i - 1], d.dimensions[i]] = [d.dimensions[i], d.dimensions[i - 1]];
        dirtyRedraw();
      });
      const name = el("input", null, { type: "text", value: x.name, "aria-label": "维度名称", maxlength: "20" });
      name.addEventListener("input", () => ((x.name = name.value), dirty()));
      const tags = el("div", null, { class: "yxs-dim-tags" });
      for (const t of x.feedback_tags || []) {
        const c = el("button", null, { type: "button", class: "yxg-chip", title: "点一下去掉", "aria-label": "去掉快捷词 " + t });
        c.append(t, el("span", " ×", { class: "v-muted" }));
        c.addEventListener("click", () => {
          x.feedback_tags = x.feedback_tags.filter((y) => y !== t);
          dirtyRedraw();
        });
        tags.append(c);
      }
      const add = el("button", "＋ 加一个", { type: "button", class: "yxg-chip is-add" });
      add.addEventListener("click", () =>
        yxgAsk(add, "快捷词，如“节奏稳”", (v) => {
          x.feedback_tags = [...new Set([...(x.feedback_tags || []), v.slice(0, 12)])];
          dirtyRedraw();
        }),
      );
      tags.append(add);
      const del = el("button", "删除", { type: "button", class: "yxs-dim-del" });
      del.addEventListener("click", async () => {
        if (!(await UI.confirm({ title: "删除维度“" + x.name + "”？", consequence: "已发出的报告不受影响；删掉的维度编号不能再用。", danger: true }))) return;
        d.dimensions.splice(i, 1);
        dirtyRedraw();
      });
      row.append(up, name, tags, del);
      rows.append(row);
    });
  };
  drawRows();
  mid.append(table);
  // 右：顶部数字 + 显示选项
  const right = el("div", null, { class: "yxs-dims-right" });
  const s1 = el("section", null, { class: "yxs-assist" });
  s1.append(el("h3", "报告顶部的三个数字"));
  d.options ||= {};
  const stats = new Set(d.options.stats || []);
  for (const [k, t] of YXS_STATS) {
    const row = el("label", null, { class: "yxs-stat-pick" + (stats.has(k) ? " is-on" : "") });
    const ck = el("input", null, { type: "checkbox" });
    ck.checked = stats.has(k);
    ck.addEventListener("change", () => {
      if (ck.checked && stats.size >= 3) {
        ck.checked = false;
        return notice("最多选 3 个");
      }
      ck.checked ? stats.add(k) : stats.delete(k);
      d.options.stats = YXS_STATS.map(([y]) => y).filter((y) => stats.has(y));
      if (!d.options.stats.length) delete d.options.stats;
      row.classList.toggle("is-on", ck.checked);
      dirty();
    });
    row.append(ck, el("span", t), el("span", ["lessons", "attendance"].includes(k) ? "CRM" : k === "repertoire_done" ? "曲目单" : "自动", { class: "yxe-src" }));
    s1.append(row);
  }
  s1.append(el("p", "不选则用学科默认。艺考班型可换成集训天数、模拟考次数、距统考天数。", { class: "v-muted yxs-assist-note" }));
  const s2 = el("section", null, { class: "yxs-assist" });
  s2.append(el("h3", "报告里显示什么"));
  for (const [k, t] of YXS_OPTIONS) {
    const row = el("label", null, { class: "yxs-switch" });
    const ck = el("input", null, { type: "checkbox", role: "switch" });
    ck.checked = !!d.options[k];
    ck.addEventListener("change", () => ((d.options[k] = ck.checked), dirty()));
    row.append(el("span", t), ck);
    s2.append(row);
  }
  const s3 = el("section", null, { class: "yxs-assist" });
  s3.append(el("h3", "改维度会影响什么"), el("p", "已发出的报告保留当时的维度名。每个维度有固定编号，改名后雷达图仍能和上一期对比；删掉的编号不能再用。", { class: "v-muted yxs-assist-note" }));
  right.append(s1, s2, s3);
  wrap.append(left, mid, right);
}
function yxsDimDirty(st, items) {
  const cur = items.find((x) => x.id === st.sel);
  return !!(st.draft && cur && JSON.stringify(st.draft) !== JSON.stringify(cur));
}
function yxsReportForm(r, again) {
  const { panel, close } = drawer(r ? "编辑班型" : "新增班型"),
    form = el("form");
  yxsSelect(form, "学科", "subject", Object.entries(YXS_SUBJECT), r?.subject);
  field(form, "班型名称", "name", "text", r?.name || "");
  const dims = (r?.dimensions || []).map((x) => ({ ...x }));
  const box = el("fieldset", null, { class: "yxs-group" });
  box.append(el("legend", "打分维度（1–5 分）"));
  const list = el("div");
  box.append(list);
  const draw = () => {
    list.replaceChildren();
    dims.forEach((d, i) => {
      const row = el("div", null, { class: "yxs-dim" });
      const name = el("input", null, { type: "text", value: d.name, "aria-label": "维度名称" });
      name.addEventListener("input", () => (d.name = name.value));
      const up = button("↑", () => {
        if (i) [dims[i - 1], dims[i]] = [dims[i], dims[i - 1]];
        draw();
      });
      up.setAttribute("aria-label", "上移");
      const del = button("删除", () => {
        dims.splice(i, 1);
        draw();
      });
      row.append(name, up, del);
      list.append(row);
    });
  };
  draw();
  box.append(
    button("＋ 新增维度", () => {
      dims.push({ key: "k" + Date.now().toString(36), name: "", order: dims.length + 1, feedback_tags: [] });
      draw();
    }),
  );
  form.append(box);
  const opts = el("fieldset", null, { class: "yxs-group" });
  opts.append(el("legend", "报告选项"));
  for (const [k, t] of YXS_OPTIONS) yxsCheck(opts, t, "opt_" + k, r?.options?.[k]);
  form.append(opts);
  const sbox = el("fieldset", null, { class: "yxs-group" });
  sbox.append(el("legend", "报告顶部的统计数字（最多 3 个，不选则用学科默认）"));
  const statOn = new Set(r?.options?.stats || []);
  for (const [k, t] of YXS_STATS) {
    const ck = yxsCheck(sbox, t, "stat_" + k, statOn.has(k));
    ck.addEventListener("change", () => {
      if (ck.checked && sbox.querySelectorAll("input:checked").length > 3) {
        ck.checked = false;
        notice("最多选 3 个");
      }
    });
  }
  form.append(sbox);
  submit(form, "保存", async (d) => {
    if (!dims.length || dims.some((x) => !x.name.trim())) throw Error("至少一个维度，且每个维度都要有名称");
    const doc = {
      subject: d.subject,
      name: d.name.trim(),
      active: r ? r.active : true,
      dimensions: dims.map((x, i) => ({ key: x.key, name: x.name.trim(), order: i + 1, feedback_tags: x.feedback_tags || [] })),
      options: Object.fromEntries(YXS_OPTIONS.map(([k]) => [k, !!form.elements["opt_" + k].checked])),
    };
    const stats = YXS_STATS.map(([k]) => k).filter((k) => form.elements["stat_" + k].checked);
    if (stats.length) doc.options.stats = stats;
    await yxsSave(
      () => (r ? api("settings/report-classes", "PUT", { ...doc, id: r.id, version: r.version }) : api("settings/report-classes", "POST", doc)),
      async () => {
        await close();
        await again();
      },
    );
  });
  panel.append(form);
}

// ---------- 机构档案 ----------
async function yxsProfile(body, again) {
  const [p, teachers] = await Promise.all([api("settings/profile"), api("data/teachers?limit=200").catch(() => ({ items: [] }))]);
  const tlist = teachers.items || teachers.records || [];
  const form = el("form", null, { class: "v-panel yxs-pad yxs-profile" });
  field(form, "机构介绍", "introduction", "textarea", p.introduction || "", false);
  field(form, "特色（每行一条）", "features", "textarea", (p.features || []).join("\n"), false);
  field(form, "卖点（每行一条，AI 写文案时会用）", "selling_points", "textarea", (p.selling_points || []).join("\n"), false);
  field(form, "地址", "address", "text", p.address || "", false);
  field(form, "上课时间", "class_hours", "text", p.class_hours || "", false);
  field(form, "咨询电话", "contact_phone", "tel", p.contact_phone || "", false);
  const tbox = el("fieldset", null, { class: "yxs-group" });
  tbox.append(el("legend", "老师介绍（会用在课程方案和招生文案里）"));
  const rows = (p.teachers || []).map((t) => ({ ...t }));
  const list = el("div");
  tbox.append(list);
  const tname = Object.fromEntries(tlist.map((t) => [t.id, t.name]));
  const draw = () => {
    list.replaceChildren();
    rows.forEach((t, i) => {
      const row = el("div", null, { class: "yxs-teacher" });
      const sel = el("select", null, { "aria-label": "老师" });
      for (const x of tlist) sel.append(el("option", x.name, { value: x.id }));
      if (!tname[t.teacher_id]) sel.append(el("option", t.teacher_id, { value: t.teacher_id }));
      sel.value = t.teacher_id;
      sel.addEventListener("change", () => (t.teacher_id = sel.value));
      const intro = el("textarea", null, { rows: "2", "aria-label": "介绍" });
      intro.value = t.introduction || "";
      intro.addEventListener("input", () => (t.introduction = intro.value));
      row.append(sel, intro, button("删除", () => (rows.splice(i, 1), draw())));
      list.append(row);
    });
  };
  draw();
  if (tlist.length) tbox.append(button("＋ 添加老师", () => (rows.push({ teacher_id: tlist[0].id, introduction: "" }), draw())));
  else tbox.append(el("p", "先在“老师”里建好老师档案。", { class: "v-muted" }));
  form.append(tbox);
  submit(form, "保存档案", (d) =>
    yxsSave(
      () =>
        api("settings/profile", "PUT", {
          version: p.version,
          introduction: d.introduction.trim(),
          features: yxsLines(d.features),
          selling_points: yxsLines(d.selling_points),
          address: d.address.trim(),
          class_hours: d.class_hours.trim(),
          contact_phone: d.contact_phone.trim(),
          teachers: rows.map((t) => ({ teacher_id: t.teacher_id, introduction: (t.introduction || "").trim() })),
        }),
      again,
    ),
  );
  body.append(form);
}

// ---------- 图库 ----------
const yxsGalleryState = { tag: "" };
const YXS_CONSENT = "家长已同意展示";
async function yxsGallery(body, again) {
  const st = yxsGalleryState,
    V = yxsV();
  const data = await api("gallery?limit=200" + (st.tag ? "&tag=" + encodeURIComponent(st.tag) : ""));
  const bar = el("div", null, { class: "yxs-bar" });
  const tag = el("input", null, { type: "search", placeholder: "按标签筛选，如“作品”", "aria-label": "按标签筛选" });
  tag.value = st.tag;
  tag.addEventListener("change", () => ((st.tag = tag.value.trim()), again()));
  // v0.4.1：每个机构有图库容量（默认 500MB），接口带 storage 时显示用量。
  const sto = data.storage,
    mb = (n) => (n / 1048576 >= 100 ? Math.round(n / 1048576) : (n / 1048576).toFixed(1)) + " MB";
  const usage = !sto ? null : !sto.complete ? el("span", "正在统计容量…", { class: "yxs-storage" }) : el("span", sto.limit ? "已用 " + mb(sto.used || 0) + " / " + mb(sto.limit) : "图库暂不允许上传新图片", { class: "yxs-storage" + (!sto.limit || sto.used >= sto.limit * 0.9 ? " is-warn" : "") });
  const full = sto && sto.complete && sto.used >= sto.limit;
  // 旧图分批统计：没统计完时过几秒再取一次（每次后端最多核对 20 张）。
  if (sto && !sto.complete) setTimeout(() => document.contains(bar) && again(), 2500);
  bar.append(tag, el("span", null, { class: "v-spacer" }), ...(usage ? [usage] : []), button("上传图片", () => (full ? notice("图库已满：请先删除不用的图片，或联系平台扩容") : yxsUploadForm(again)), "primary"));
  body.append(bar);
  const items = data.items || [];
  if (!items.length) return body.append(UI.empty({ text: st.tag ? "没有这个标签的图片。" : "还没有图片。支持 PNG、JPG、WebP，单张不超过 2MB。" }));
  const grid = el("div", null, { class: "yxs-gallery" });
  for (const g of items) {
    const card = el("figure", null, { class: "yxs-photo" });
    card.append(el("img", null, { src: g.url, alt: g.tags.join("、") || "图库图片", loading: "lazy", decoding: "async" }));
    const cap = el("figcaption");
    const tags = el("div", null, { class: "yxs-tags" });
    for (const t of g.tags) tags.append(V.chip(t, t === YXS_CONSENT ? "ok" : "muted"));
    const ops = el("div", null, { class: "yxs-ops" });
    ops.append(
      V.link("改标签", () => yxsTagForm(g, again)),
      V.link("删除", async () => {
        if (!(await UI.confirm({ title: "删除这张图片？", consequence: "如果品牌、方案或报告已经用到它，只会从图库隐藏，已用到的地方不受影响。", danger: true }))) return;
        const r = await api("gallery/" + encodeURIComponent(g.id), "DELETE", { version: g.version });
        notice(r.hidden ? "已从图库隐藏（仍被引用）" : "已删除", "success");
        await again();
      }),
    );
    cap.append(tags, el("small", g.width + "×" + g.height, { class: "v-muted" }), ops);
    card.append(cap);
    grid.append(card);
  }
  body.append(grid);
}
function yxsUploadForm(again) {
  const { panel, close } = drawer("上传图片"),
    form = el("form");
  const file = el("input", null, { type: "file", name: "file", accept: "image/png,image/jpeg,image/webp", required: "", "aria-label": "选择图片" });
  const pick = el("label", "图片（PNG、JPG、WebP，不超过 2MB）", { class: "field" });
  pick.append(file);
  form.append(pick);
  field(form, "标签（用逗号分隔，如“作品，素描”）", "tags", "text", yxsGalleryState.tag, false);
  const consent = yxsCheck(form, "家长已同意展示（报告、宣传可以使用这张图）", "consent", false);
  submit(form, "上传", async (d) => {
    const f = file.files?.[0];
    if (!f) throw Error("请选择图片");
    if (f.size > 2 * 1024 * 1024) throw Error("图片不能超过 2MB");
    const tags = yxsLines(d.tags.replace(/[,，]/g, "\n"));
    if (consent.checked) tags.push(YXS_CONSENT);
    await yxsUpload("gallery", { file: f, tags: JSON.stringify(tags) });
    notice("已上传", "success");
    await close();
    await again();
  });
  panel.append(form);
}
function yxsTagForm(g, again) {
  const { panel, close } = drawer("图片标签"),
    form = el("form");
  const other = g.tags.filter((t) => t !== YXS_CONSENT);
  field(form, "标签（用逗号分隔）", "tags", "text", other.join("，"), false);
  const consent = yxsCheck(form, "家长已同意展示（报告、宣传可以使用这张图）", "consent", g.parent_consent_media);
  submit(form, "保存", (d) => {
    const tags = yxsLines(d.tags.replace(/[,，]/g, "\n"));
    if (consent.checked) tags.push(YXS_CONSENT);
    return yxsSave(() => api("gallery/" + encodeURIComponent(g.id), "PATCH", { version: g.version, tags }), async () => {
      await close();
      await again();
    });
  });
  panel.append(form);
}

// ---------- 品牌（主色与咨询二维码）----------
// 由“机构信息”分类调用：名称、Logo、登录背景由平台维护，机构只改主色和二维码。
async function yxsBrandEditor(body, again) {
  let b;
  try {
    b = await api("settings/brand");
  } catch (e) {
    const errBox = el("div", null, { class: "v-panel yxs-pad" });
    errBox.append(
      UI.empty({
        text: e?.message || "品牌设置载入失败，请稍后重试。",
        action: { label: "重新加载", onSelect: () => again() },
      }),
    );
    body.append(errBox);
    return;
  }
  const form = el("form", null, { class: "v-panel yxs-pad" });
  form.append(el("h3", "主色与咨询二维码"));
  const color = field(form, "主色", "primary_color", "color", /^#[0-9a-f]{6}$/i.test(b.primary_color || "") ? b.primary_color : "#6A35B8", false);
  color.classList.add("yxs-color");
  const pickRow = el("div", null, { class: "yxs-qr" });
  const initialQr = b.qr_image_id || null;
  let qr = initialQr;
  const preview = el("div", null, { class: "yxs-qr-preview" });
  let clearBtn;
  const showQr = (url) => {
    preview.replaceChildren(url ? el("img", null, { src: url, alt: "咨询二维码" }) : el("span", "未设置", { class: "v-muted" }));
    if (clearBtn) clearBtn.hidden = !qr;
  };
  pickRow.append(
    preview,
    button("从图库选择", async () => {
      const list = await api("gallery?limit=200");
      const { panel, close } = drawer("选择咨询二维码");
      const grid = el("div", null, { class: "yxs-gallery is-pick" });
      for (const g of list.items || []) {
        const x = el("button", null, { type: "button", class: "yxs-photo" });
        x.append(el("img", null, { src: g.url, alt: g.tags.join("、") || "图片" }));
        x.addEventListener("click", async () => {
          qr = g.id;
          showQr(g.url);
          await close();
        });
        grid.append(x);
      }
      if (!list.items?.length) grid.append(el("p", "图库里还没有图片，请先到“机构设置 › 品牌与图库”上传二维码图片。", { class: "v-muted" }));
      panel.append(grid);
    }),
  );
  clearBtn = button("清除二维码", () => {
    qr = null;
    showQr(null);
  });
  pickRow.append(clearBtn);
  showQr(b.qr_url);
  const qrField = el("div", null, { class: "ui-field field" });
  qrField.append(el("span", "咨询二维码", { class: "ui-field-label" }), pickRow);
  form.append(qrField);
  submit(form, "保存", () =>
    yxsSave(() => {
      const patch = { version: b.version, primary_color: color.value.toUpperCase() };
      if (qr !== initialQr) patch.qr_image_id = qr;
      return api("settings/brand", "PATCH", patch);
    }, again),
  );
  body.append(form);
}

// ---------- 修改卡片 ----------
const yxsChangeState = { status: "pending" };
const YXS_ENTITY = { course: "课程", price: "价格", stage_type: "阶段", stage_rule: "自动规则", calendar: "节点日历", course_rule: "选课规则", report_class: "成长报告班型" };
function yxsShow(v) {
  if (v === null || v === undefined) return "空";
  if (typeof v === "boolean") return v ? "开" : "关";
  if (Array.isArray(v)) return v.join("、");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
async function yxsChanges(body, again) {
  const st = yxsChangeState,
    V = yxsV();
  const tabs = el("div", null, { class: "yxs-bar", role: "tablist" });
  for (const [k, t] of [["pending", "待审批"], ["approved", "已批准"], ["rejected", "已拒绝"], ["reverted", "已撤回"]]) {
    const b = button(t, () => ((st.status = k), again()));
    b.setAttribute("aria-pressed", String(st.status === k));
    b.classList.add("yxs-tab");
    tabs.append(b);
  }
  body.append(tabs);
  const data = await api("settings/changes?status=" + st.status + "&limit=50");
  const items = data.items || [];
  if (!items.length) return body.append(UI.empty({ text: st.status === "pending" ? "没有待审批的修改。" : "没有记录。" }));
  for (const ch of items) {
    const card = V.panel("修改建议 · " + new Date(ch.created_at).toLocaleString("zh-CN", { hour12: false }));
    const list = el("ul", null, { class: "yxs-ops-list" });
    for (const op of ch.payload?.ops || [])
      list.append(el("li", (YXS_ENTITY[op.entity] || op.entity) + (op.key ? "“" + op.key + "”" : "") + " · " + op.field + "：" + yxsShow(op.from) + " → " + yxsShow(op.to)));
    card.append(list);
    for (const s of ch.payload?.side_effects || []) card.append(el("p", "提示：" + (s.message || s.text || yxsShow(s)), { class: "v-muted v-pad" }));
    const ops = el("div", null, { class: "yxs-ops yxs-pad" });
    const act = (label, path, kind, ask) =>
      button(label, async () => {
        if (ask && !(await UI.confirm(ask))) return;
        try {
          await api("settings/changes/" + encodeURIComponent(ch.id) + "/" + path, "POST", {});
          notice("已" + label, "success");
        } catch (e) {
          if (e.code === "change_stale") notice("相关设置已被修改过，这张卡片不能再" + label + "。");
          else throw e;
        }
        await again();
      }, kind);
    if (ch.status === "pending") ops.append(act("批准", "approve", "primary"), act("拒绝", "reject"));
    if (ch.status === "approved") ops.append(act("撤回", "revert", "", { title: "撤回这次修改？", consequence: "相关设置回到修改前的内容。之后如果有人又改过，就不能撤回。", danger: true }));
    if (ops.children.length) card.append(ops);
    body.append(card);
  }
}

// ---------- 用一句话改设置（设计稿 v3，接口 ai/settings/propose → settings/changes） ----------
// AI 只给“修改卡片”；主管点“确认写入”才生效，其他人提交后等主管在“修改记录”里确认。
const yxsAssistState = { res: null, ask: "" };
function yxsAssist(again) {
  const st = yxsAssistState;
  const box = el("section", null, { class: "yxs-assist" });
  const head = el("div", null, { class: "yxv-ai-head" });
  const t = el("div");
  t.append(el("strong", "用一句话改设置"), el("small", "艺界星途 AI · 主管确认后才生效", { class: "v-muted" }));
  head.append(el("span", "✦", { class: "yxv-ai-logo yxs-assist-logo", "aria-hidden": "true" }), t);
  box.append(head);
  const isBoss = me.user.roles.includes("supervisor");
  const body = el("div", null, { class: "yxs-assist-body" });
  box.append(body);
  const draw = () => {
    body.replaceChildren();
    if (st.ask && st.res) body.append(el("p", "“" + st.ask + "”", { class: "yxs-assist-quote" }));
    if (st.res) {
      const w = yxAiWarnings(st.res.warnings);
      if (w) body.append(w);
      if (!st.res.suggestions.length) body.append(el("p", "这次没有能直接写入的修改。换个说法，写清楚改哪一项、改成多少。", { class: "v-muted" }));
      for (const sg of st.res.suggestions) {
        const card = el("div", null, { class: "yxs-change" });
        const h = el("div", null, { class: "yxs-change-h" });
        h.append(el("strong", "修改卡片"), el("span", isBoss ? "确认后写入" : "提交后等待主管确认", { class: "yx-dot is-warn" }));
        card.append(h);
        for (const op of sg.payload.ops || []) {
          const r = el("div", null, { class: "yxs-change-row" });
          const v = el("span");
          v.append(el("del", yxsShow(op.from)), " 改为 ", el("b", yxsShow(op.to)));
          r.append(el("span", (YXS_ENTITY[op.entity] || op.entity) + (op.key ? " · " + op.key : "") + " · " + op.field, { class: "v-muted" }), v);
          card.append(r);
        }
        for (const s of sg.payload.side_effects || []) {
          const r = el("div", null, { class: "yxs-change-row" });
          r.append(el("span", "影响", { class: "v-muted" }), el("span", s.message || s.text || yxsShow(s)));
          card.append(r);
        }
        const basis = (sg.basis || []).filter((b) => b.quote || b.text).slice(0, 2);
        if (basis.length) {
          const r = el("div", null, { class: "yxs-change-row" });
          r.append(el("span", "依据", { class: "v-muted" }), el("span", basis.map((b) => b.quote || b.text).join("；")));
          card.append(r);
        }
        const acts = el("div", null, { class: "yxv-row" });
        acts.append(
          button(isBoss ? "确认写入" : "提交给主管", async () => {
            const ch = await api("settings/changes", "POST", { suggestion_id: sg.id, payload: sg.payload });
            if (isBoss) {
              try {
                await api("settings/changes/" + encodeURIComponent(ch.id) + "/approve", "POST", {});
              } catch (e) {
                if (e.code === "change_stale") throw Error("相关设置刚被修改过，请重新说一次");
                throw e;
              }
            }
            st.res = null;
            st.ask = "";
            notice(isBoss ? "已写入，可在“机构设置 · 修改记录”里撤回" : "已提交，主管确认后生效", "success");
            await again();
          }, "primary"),
          button("改一下再写", () => {
            input.value = st.ask;
            input.focus();
          }),
          button("不要", () => ((st.res = null), draw())),
        );
        card.append(acts);
        body.append(card);
      }
    }
  };
  const row = el("div", null, { class: "yxv-row yxs-assist-ask" });
  const input = el("input", null, { type: "text", placeholder: "比如：寒假集训营改成 12 天", "aria-label": "用一句话改设置", maxlength: "500" });
  row.append(
    input,
    yxAiButton("发送", async () => {
      const v = input.value.trim();
      if (!v) return notice("先写一句要改什么");
      st.ask = v;
      st.res = await yxAi("settings/propose", { instruction: v });
      input.value = "";
      draw();
    }),
  );
  draw();
  const note = el("p", "顾问和教务可以提出修改。每次修改都记在修改记录里，可以撤回。", { class: "v-muted yxs-assist-note" });
  note.append(" ", yxsV().link("查看修改记录", () => (location.hash = "inst-changes")));
  box.append(row, note);
  return box;
}
function yxsPriceLegend() {
  const box = el("section", null, { class: "yxs-assist yxs-legend" });
  box.append(el("h3", "五种计价方式"));
  for (const [k, t] of [["按课时", "单价 × 课时数"], ["按期", "每期价 × 期数，如集训营"], ["按学期", "每学期价 × 学期数"], ["按月", "每月价 × 月数，如艺考集训"], ["课包", "每包价 × 包数，包内课时固定"]]) {
    const r = el("div", null, { class: "yxs-change-row" });
    r.append(el("b", k), el("span", t, { class: "v-muted" }));
    box.append(r);
  }
  return box;
}
