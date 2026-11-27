// 艺界星途 · 阶段 4 课程方案前端（Claude）
// 学员档案「课程方案」页签 → 全屏编辑器（阶段、课程、费用、评估、风格）→ 检查 / 历史 / 发送 / 签约 / 分享 / 打印。
// 金额只显示服务器 computed（R2）；新阶段、新课程行用 tmp_ 临时 ID，保存后以服务器返回为准。
// 约束同 yx.js：DOM 构造、textContent；颜色变量用 CSSOM（style.setProperty），不写 style 属性。

const YXP_STATUS = { draft: ["草稿", "muted"], sent: ["已发送", "info"], signed: ["已签约", "ok"], archived: ["已归档", "muted"] };
const YXP_QTY = { per_unit: ["units", "课时"], per_term: ["terms", "期"], per_semester: ["semesters", "学期"], per_month: ["months", "个月"], package: ["packages", "包"] };
const YXP_MODULES = [["cover", "封面"], ["assessment", "评估"], ["path", "学习路径"], ["courses", "课程安排"], ["fees", "费用"], ["teachers", "老师介绍"], ["about", "关于机构"]];

function yxpMoney(v) {
  return "¥" + Number(v || 0).toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function yxpTmp(p) {
  return "tmp_" + p + "_" + Math.random().toString(36).slice(2, 9);
}
function yxpMonthLabel(s, e) {
  const f = (d) => (d ? d.slice(0, 7).replace("-", ".") : "");
  return f(s) + (e ? " – " + f(e) : "");
}

// ---------- 学员档案页签 ----------
async function yxPlansTab(body, studentId, row, again) {
  const V = globalThis.ChannelV2;
  const data = await api("plans?student_id=" + encodeURIComponent(studentId) + "&limit=50");
  const box = V.panel("课程方案", [el("span", null, { class: "v-spacer" }), enabled("plans", "write") ? V.link("＋ 新建方案", () => yxpCreate(studentId, row, again)) : null].filter(Boolean));
  const items = data.items || [];
  if (!items.length) box.append(el("p", "还没有方案。新建后可以先用“自动排阶段”生成学习路径，再选课程。", { class: "v-muted v-pad" }));
  for (const p of items) {
    const line = el("button", null, { type: "button", class: "yxp-item" });
    const st = YXP_STATUS[p.status] || [p.status, "muted"];
    const who = el("span", null, { class: "yxp-item-main" });
    who.append(el("strong", p.title), el("small", (p.total?.units ? p.total.units + " 课时 · " : "") + yxpMoney(p.total?.amount) + " · 更新于 " + String(p.updated_at || "").slice(0, 10), { class: "v-muted" }));
    line.append(who, V.chip(st[0], st[1]));
    line.addEventListener("click", () => yxPlanEditor(p.id, again));
    box.append(line);
  }
  body.append(box);
}
async function yxpCreate(studentId, row, again) {
  const subjects = await api("settings/subjects").catch(() => []);
  if (!subjects.length) return notice("先在“机构设置 → 学科模板”导入学科，才能建方案");
  const { panel, close } = drawer("新建课程方案"),
    form = el("form");
  yxsSelect(form, "学科", "subject", subjects.map((s) => [s.key, s.name]));
  field(form, "方案标题", "title", "text", (row?.name ? row.name + " · " : "") + "学习方案");
  submit(form, "创建并打开", async (d) => {
    const p = await api("plans", "POST", { student_id: studentId, subject: d.subject, title: d.title.trim() });
    await close();
    await again();
    yxPlanEditor(p.id, again);
  });
  panel.append(form);
}

// ---------- 编辑器 ----------
async function yxPlanEditor(id, onClose, hint) {
  yxDisposeEditors();
  const shell = el("div", null, { class: "yxp-editor yxv-editor ui-root", role: "dialog", "aria-modal": "true", "aria-label": "课程方案" });
  document.body.append(shell);
  shell.append(UI.tableSkeleton());
  const st = { doc: null, dirty: false, courses: [], types: [], calendar: { items: [] }, teachers: [], styles: [] };
  shell.yxDispose = () => {
    st.closed = true;
    clearTimeout(st.qTimer);
    st.qSeq = (st.qSeq || 0) + 1;
  };
  const close = async () => {
    if (st.dirty && !(await UI.confirm({ title: "有未保存的修改，确定离开？", consequence: "离开后这些修改会丢失。", danger: true }))) return;
    shell.yxDispose?.();
    shell.remove();
    await onClose?.();
  };
  shell.addEventListener("keydown", (e) => yxEditorEscape(e, shell) && close());
  try {
    st.doc = await api("plans/" + encodeURIComponent(id));
    const subject = st.doc.subject;
    const [courses, types, cal, teachers, styles, gallery] = await Promise.all([
      api("settings/courses?subject=" + subject + "&limit=200").catch(() => ({ items: [] })),
      api("settings/stage-types?limit=200").catch(() => ({ items: [] })),
      api("settings/calendar").catch(() => ({ items: [] })),
      api("data/teachers?limit=200").catch(() => ({ items: [] })),
      api("styles?doc_type=plan").catch(() => ({ items: [] })),
      api("gallery?limit=200").catch(() => ({ items: [] })),
    ]);
    st.gallery = gallery.items || [];
    st.courses = courses.items || [];
    st.types = (types.items || []).filter((t) => t.subject === subject && t.active);
    st.calendar = cal;
    st.teachers = teachers.items || teachers.records || [];
    st.styles = styles.items || [];
    if (st.doc.student_id)
      st.student = await api("data/students/" + encodeURIComponent(st.doc.student_id))
        .then((x) => x.record || x)
        .catch(() => null);
    else await yxpParty(st, hint);
  } catch (e) {
    shell.replaceChildren(UI.empty({ text: e.message, action: { label: "关闭", onSelect: close } }));
    return;
  }
  st.checkCount = await api("plans/" + encodeURIComponent(id) + "/check")
    .then((r) => (r.blocking?.length || 0) + (r.warnings?.length || 0))
    .catch(() => 0);
  if (st.doc.doc_version === 2) await yxp2Open(st);
  const render = () => shell.isConnected && (st.v2 ? yxp2Render : yxpRender)(shell, st, close, render);
  render();
}
// 还没建档的方案（线索 / 意向）：取对象名字，用于顶栏和“转为正式学员”。
async function yxpParty(st, hint) {
  st.party = st.doc.source_lead_id ? "lead" : "prospect";
  st.partyName = hint?.party_name || "";
  if (st.partyName) return;
  if (st.party === "lead")
    st.partyName = await api("tools/leads/" + encodeURIComponent(st.doc.source_lead_id))
      .then((x) => x.record?.name || "")
      .catch(() => "");
  else
    st.partyName = await api("plans?party=prospect&limit=200")
      .then((x) => (x.items || []).find((p) => p.id === st.doc.id)?.party_name || "")
      .catch(() => "");
}
function yxpLocked(doc) {
  return doc.status === "signed" || doc.status === "archived";
}
function yxpRender(shell, st, close, rerender) {
  const V = globalThis.ChannelV2,
    doc = st.doc,
    locked = yxpLocked(doc) || !enabled("plans", "write");
  let timer = 0;
  const mark = () => {
    st.dirty = true;
    saveBtn.disabled = false;
    saved.textContent = "有未保存的修改";
    saved.classList.add("is-dirty");
    clearTimeout(timer);
    timer = setTimeout(drawPreview, 400);
  };
  shell.classList.add("yxv-editor", "yxv-plan");
  shell.replaceChildren(yxvRail(close));
  const main = el("div", null, { class: "yxv-main" });
  shell.append(main);
  // 顶栏（设计稿 v3）：面包屑 · 标题 · 状态 · 来源与保存时间；右侧 检查 / 导出 PDF / 发送给家长
  const bar = el("header", null, { class: "yxp-bar yxv-bar" });
  const crumbs = el("nav", null, { class: "yxv-crumbs", "aria-label": "位置" });
  const back = button("‹ 返回", close);
  back.classList.add("yxv-back");
  crumbs.append(back);
  for (const x of [V.link("招生", close), el("span", "›", { "aria-hidden": "true" }), V.link("课程方案", close), el("span", "›", { "aria-hidden": "true" })]) {
    x.classList.add("yxv-crumb");
    crumbs.append(x);
  }
  const title = el("input", null, { type: "text", class: "yxv-title-input", "aria-label": "方案标题", value: doc.title, maxlength: "60" });
  title.disabled = locked;
  title.addEventListener("input", () => ((doc.title = title.value), mark()));
  crumbs.append(title);
  const s = YXP_STATUS[doc.status] || [doc.status, "muted"];
  const who0 = st.student?.name || (st.partyName ? st.partyName + (st.party === "lead" ? "（线索）" : "（意向）") : "");
  const who = who0 ? who0 + " · " + (YXS_SUBJECT?.[doc.subject] || doc.subject || "") : "";
  const canConvert = !doc.student_id && enabled("plans", "write") && enabled("students", "create");
  const saved = el("span", st.dirty ? "有未保存的修改" : [who, doc.updated_at ? "已保存 " + String(doc.updated_at).slice(11, 16) : ""].filter(Boolean).join(" · "), { class: "yxv-saved" + (st.dirty ? " is-dirty" : "") });
  const saveBtn = button("保存", () => yxpSave(st, rerender));
  saveBtn.disabled = !st.dirty;
  const check = button(st.checkCount ? "检查 · " + st.checkCount + " 项" : "检查", () => yxpCheck(st));
  if (st.checkCount) check.classList.add("yxv-warn-btn");
  const more = UI.actionMenu({
    label: "更多",
    items: [
      { label: "历史版本", onSelect: () => yxpRevisions(st, rerender) },
      ...(locked ? [] : [{ label: "价格刷新", onSelect: () => yxpReprice(st, rerender) }]),
      ...(doc.sent_revision_id ? [{ label: "分享链接", onSelect: () => yxpShare(st) }] : []),
      ...(doc.status === "sent" && enabled("plans", "write") ? [{ label: "签约", onSelect: () => yxpSign(st, rerender) }] : []),
      ...(canConvert ? [{ label: "转为正式学员", onSelect: () => yxpConvert(st, rerender) }] : []),
      ...(enabled("plans", "write") ? [{ label: "复制为新方案", onSelect: () => yxpDuplicate(st, shell, close) }] : []),
      ...(!locked ? [{ label: "归档", onSelect: () => yxpArchive(st, rerender) }] : []),
      ...(doc.status === "draft" && !doc.sent_revision_id ? [{ label: "删除草稿", danger: true, onSelect: () => yxpDelete(st, shell, close) }] : []),
    ],
  }).element;
  const send = !locked ? button(doc.sent_revision_id ? "重新发送给家长" : "发送给家长", () => yxpSend(st, rerender), "primary") : null;
  const convert = canConvert && doc.status === "signed" ? button("转为正式学员", () => yxpConvert(st, rerender), "primary") : null;
  bar.append(crumbs, el("span", s[0], { class: "yx-dot is-" + s[1] }), saved, el("span", null, { class: "v-spacer" }), ...(convert ? [convert] : []), ...(locked ? [] : [saveBtn]), check, button("导出 PDF", () => yxpExport(st)), ...(send ? [send] : []), more);
  main.append(bar);
  if (locked) main.append(el("p", doc.status === "signed" ? "方案已签约，不能再修改。需要调整请“复制为新方案”。" : doc.status === "archived" ? "方案已归档，不能再修改。" : "你只有查看权限。", { class: "yxp-locked" }));
  const body = el("div", null, { class: "yxv-body" });
  const left = el("div", null, { class: "yxv-left", role: "region", "aria-label": "方案内容" }),
    mid = el("div", null, { class: "yxv-mid yxp-a4", role: "main", "aria-label": "家长看到的样子" }),
    right = el("div", null, { class: "yxv-ai", role: "complementary", "aria-label": "方案助手" });
  body.append(left, mid, right);
  main.append(body);

  // 中间：A4 分页预览，上方页码条，点页码跳到那一页
  const strip = el("div", null, { class: "yxv-insert yxp-strip" });
  const pagesBox = el("div", null, { class: "yxp-pages" });
  mid.append(strip, pagesBox);
  const drawPreview = () => {
    const d = yxPlanDocument(yxpPreviewData(st), yxpManifest(st), (id) => base + "api/gallery/" + encodeURIComponent(id) + "/file");
    pagesBox.replaceChildren(d);
    const pages = [...d.querySelectorAll(".yxp-page")];
    strip.replaceChildren(el("span", "A4 · 共 " + pages.length + " 页", { class: "v-muted" }));
    pages.forEach((p, i) => {
      const b = el("button", String(i + 1), { type: "button", class: "yxp-thumb", "aria-label": "第 " + (i + 1) + " 页" });
      b.addEventListener("click", () => p.scrollIntoView({ behavior: "smooth", block: "start" }));
      strip.append(b);
    });
    strip.append(el("span", st.dirty ? "金额保存后更新" : "与发送内容一致", { class: "v-muted" }));
  };

  // 左栏：内容 / 样式
  const tabs = el("div", null, { class: "yxv-seg yxv-seg-full", role: "tablist" });
  for (const [k, t] of [["content", "内容"], ["style", "样式"]]) {
    const b = el("button", t, { type: "button", role: "tab", "aria-selected": String((st.tab || "content") === k), "aria-pressed": String((st.tab || "content") === k) });
    b.addEventListener("click", () => ((st.tab = k), rerender()));
    tabs.append(b);
  }
  left.append(tabs);
  const inp = (parent, label, value, onInput, type = "text", attrs = {}) => {
    const w = el("label", label, { class: "yxp-field" }),
      i = type === "textarea" ? el("textarea", null, { rows: "3", ...attrs }) : el("input", null, { type, ...attrs });
    i.value = value ?? "";
    i.disabled = locked;
    i.addEventListener("input", () => (onInput(i.value), mark()));
    w.append(i);
    parent.append(w);
    return i;
  };
  const lines = (parent, label, arr, set) => inp(parent, label + "（每行一条）", (arr || []).join("\n"), (v) => set(yxsLines(v)), "textarea");
  if ((st.tab || "content") === "style") yxpStyleTab(left, st, locked, mark, rerender);
  else {
    const m = doc.meta,
      stages = doc.modules.path.stages,
      comp = Object.fromEntries((doc.computed?.stages || []).map((x) => [x.key, x])),
      tot = doc.computed?.total || {};
    st.open ||= "courses";
    let n = 0;
    // 手风琴：一次只展开一个模块，其余显示一句摘要和“给家长显示”的眼睛开关
    const item = (key, name, summary, build) => {
      n++;
      const mod = doc.modules[key];
      const open = st.open === key;
      const box = el("section", null, { class: "yxp-acc" + (open ? " is-open" : "") + (mod && mod.visible === false ? " is-hidden" : "") });
      const head = el("div", null, { class: "yxp-acc-head" });
      const tgl = el("button", null, { type: "button", class: "yxp-acc-btn", "aria-expanded": String(open) });
      tgl.append(el("span", String(n), { class: "yx-num" }), el("strong", name), el("span", mod && mod.visible === false ? "不显示" : summary, { class: "v-muted" }));
      tgl.addEventListener("click", () => ((st.open = open ? "" : key), rerender()));
      head.append(tgl);
      if (mod && "visible" in mod) {
        const eye = el("button", null, { type: "button", class: "yxp-eye", "aria-pressed": String(mod.visible !== false), "aria-label": (mod.visible === false ? "给家长显示" : "不给家长显示") + "：" + name, title: mod.visible === false ? "家长看不到，点一下显示" : "家长能看到，点一下隐藏" });
        eye.append(UI.icon("eye"));
        eye.disabled = locked;
        eye.addEventListener("click", () => ((mod.visible = mod.visible === false), mark(), rerender()));
        head.append(eye);
      }
      box.append(head);
      if (open) {
        const inner = el("div", null, { class: "yxp-acc-body" });
        build(inner);
        box.append(inner);
      }
      left.append(box);
    };
    const pack = st.styles.find((p) => p.id === doc.style.pack_id);
    item("cover", "封面", [pack?.name, doc.modules.cover.subtitle ? "有副标题" : ""].filter(Boolean).join(" · ") || "默认", (b) => {
      inp(b, "封面副标题", doc.modules.cover.subtitle, (v) => (doc.modules.cover.subtitle = v));
      b.append(el("p", "主图、模版和封面文字在“样式”里改。", { class: "v-muted" }));
    });
    const a = doc.modules.assessment;
    item("assessment", "现状评估", a.text ? a.source_note || "已填写" : "还没填", (b) => {
      inp(b, "现状评估", a.text, (v) => (a.text = v), "textarea");
      lines(b, "优势", a.strengths, (v) => (a.strengths = v));
      lines(b, "需要加强", a.gaps, (v) => (a.gaps = v));
      lines(b, "目标", a.goals, (v) => (a.goals = v));
      inp(b, "评估依据（如“2026.11 试听课 + 家长访谈”）", a.source_note, (v) => (a.source_note = v));
    });
    const span = stages.length ? stages.length + " 段 · " + String(stages[0].start || "").slice(0, 7).replace("-", ".") + " – " + String(stages[stages.length - 1].end || "").slice(0, 7).replace("-", ".") : "还没排阶段";
    item("path", "学习路径", span, (b) => {
      const g1 = el("div", null, { class: "yxp-grid" });
      inp(g1, "开始月份", m.start_month, (v) => (m.start_month = v), "month");
      const tw = el("label", "目标节点", { class: "yxp-field" }),
        ts = el("select");
      ts.append(el("option", "（不设）", { value: "" }));
      for (const x of st.calendar.items || []) ts.append(el("option", x.name, { value: x.key }));
      ts.value = m.target?.node_key || "";
      ts.disabled = locked;
      ts.addEventListener("change", () => ((m.target = { ...(m.target || {}), node_key: ts.value || null }), mark()));
      tw.append(ts);
      g1.append(tw);
      inp(g1, "目标月份", m.target?.month || "", (v) => (m.target = { ...(m.target || {}), month: v || null }), "month");
      inp(g1, "费用上限（元，可空）", m.budget_cap ?? "", (v) => (m.budget_cap = v === "" ? null : Number(v)), "number", { min: "0", step: "1" });
      b.append(g1);
      inp(b, "目标说明（如“2027 年 7 月考钢琴 6 级”）", m.target?.text || "", (v) => (m.target = { ...(m.target || {}), text: v }));
      if (!locked) {
        const tools = el("div", null, { class: "yxv-btnrow" });
        tools.append(
          button("自动排阶段", () => yxpSkeleton(st, mark, rerender)),
          button("＋ 加阶段", () => {
            const last = stages[stages.length - 1];
            const t = st.types[0];
            stages.push({ key: yxpTmp("stage"), stage_type_id: t?.id || null, name: t?.name || "新阶段", start: last ? yxpNextDay(last.end) : (m.start_month || "2026-12") + "-01", end: "", teaching_weeks: null, weeks_note: "", goals: [], node_tags: [] });
            mark();
            rerender();
          }),
        );
        b.append(tools, el("p", "自动排阶段按开始月份、目标节点和机构规则排出，不选课程、不扣 AI 次数。", { class: "v-muted" }));
      }
      stages.forEach((sg, i) => {
        const card = el("div", null, { class: "yxp-stage" });
        const head = el("div", null, { class: "yxp-stage-head" });
        head.append(el("span", "①②③④⑤⑥⑦⑧⑨"[i] || String(i + 1), { class: "yxp-num" }));
        const nm = el("input", null, { type: "text", value: sg.name, "aria-label": "阶段名称", class: "yxp-stage-name" });
        nm.disabled = locked;
        nm.addEventListener("input", () => ((sg.name = nm.value), mark()));
        head.append(nm);
        if (!locked)
          head.append(
            button("删除", async () => {
              if (doc.modules.courses.lines.some((l) => l.stage_key === sg.key) && !(await UI.confirm({ title: "删除阶段“" + sg.name + "”？", consequence: "这个阶段里的课程也会一起删除。", danger: true }))) return;
              doc.modules.courses.lines = doc.modules.courses.lines.filter((l) => l.stage_key !== sg.key);
              stages.splice(i, 1);
              mark();
              rerender();
            }),
          );
        card.append(head);
        if (st.hints?.[sg.key]) card.append(el("p", "顾问提示（家长看不到）：" + st.hints[sg.key].join("；"), { class: "yxp-hint" }));
        const g = el("div", null, { class: "yxp-grid" });
        inp(g, "开始", sg.start, (v) => (sg.start = v), "date");
        inp(g, "结束", sg.end, (v) => (sg.end = v), "date");
        inp(g, "教学周（可空）", sg.teaching_weeks ?? "", (v) => (sg.teaching_weeks = v === "" ? null : Number(v)), "number", { min: "1", step: "1" });
        inp(g, "教学周原因", sg.weeks_note, (v) => (sg.weeks_note = v));
        card.append(g);
        inp(card, "阶段目标（每行一条）", (sg.goals || []).join("\n"), (v) => (sg.goals = yxsLines(v)), "textarea");
        b.append(card);
      });
    });
    const bundles = tot.bundles?.length ? " + " + tot.bundles.join("、") : "";
    item("courses", "课程安排", (tot.units || 0) + " 课时" + bundles, (b) => {
      if (!stages.length) return b.append(el("p", "先在“学习路径”里排好阶段。", { class: "v-muted" }));
      st.stageSel = Math.min(st.stageSel || 0, stages.length - 1);
      const pills = el("div", null, { class: "yxp-pills" });
      stages.forEach((sg, i) => {
        const on = i === st.stageSel;
        const p = el("button", "①②③④⑤⑥⑦⑧⑨"[i] + (on ? " " + sg.name : ""), { type: "button", "aria-pressed": String(on), title: sg.name });
        p.addEventListener("click", () => ((st.stageSel = i), rerender()));
        pills.append(p);
      });
      b.append(pills);
      const sg = stages[st.stageSel];
      const list = el("div", null, { class: "yxp-lines" });
      for (const ln of doc.modules.courses.lines.filter((l) => l.stage_key === sg.key)) list.append(yxpLine(st, ln, locked, mark, rerender));
      b.append(list);
      const foot = el("div", null, { class: "yxp-lines-foot" });
      if (!locked) {
        const pick = el("select", null, { "aria-label": "从报价课程添加" });
        pick.append(el("option", "＋ 从报价课程添加", { value: "" }));
        for (const c of st.courses.filter((c) => c.active)) pick.append(el("option", (c.optional ? "[可选] " : "") + c.name + (c.pricing ? " · " + yxsPrice(c.pricing) : " · 未定价"), { value: c.id }));
        pick.addEventListener("change", () => {
          const c = st.courses.find((x) => x.id === pick.value);
          if (!c) return;
          if (!c.pricing) {
            pick.value = "";
            return notice("这门课还没定价，先在“报价课程与价目表”里填价格");
          }
          const [k] = YXP_QTY[c.pricing.mode] || ["units"];
          doc.modules.courses.lines.push({ line_id: yxpTmp("line"), stage_key: sg.key, course_id: c.id, qty: { [k]: 1 }, frequency_text: "", note: "", includes: [] });
          mark();
          rerender();
        });
        foot.append(pick);
      }
      const c = comp[sg.key];
      foot.append(el("strong", c ? "本段 " + c.units + " 课时 · " + yxpMoney(c.amount) : "保存后计算", { class: "yxp-stage-sum" }));
      b.append(foot, el("p", "紫色格子是 AI 填的，可以直接改。金额由程序按加入时的价格计算。", { class: "v-muted" }));
    });
    const f = doc.modules.fees;
    const nIns = f.installments === "custom" ? (f.custom || []).length : stages.length;
    item("fees", "费用与分期", nIns + " 期 · " + (doc.style.show_unit_price ? "显示单价" : "不显示单价"), (b) => {
      const mode = el("div", null, { class: "yxv-seg yxv-seg-full", role: "radiogroup", "aria-label": "分期方式" });
      for (const [k, t] of [["per_stage", "按阶段付"], ["custom", "自定义分期"]]) {
        const r = el("button", t, { type: "button", role: "radio", "aria-checked": String(f.installments === k), "aria-pressed": String(f.installments === k) });
        r.disabled = locked;
        r.addEventListener("click", () => {
          f.installments = k;
          f.custom = k === "custom" ? (f.custom?.length ? f.custom : [{ stage_key: null, label: "一次付清", due: null, ratio_bps: 10000 }]) : [];
          mark();
          rerender();
        });
        mode.append(r);
      }
      b.append(mode);
      if (f.installments === "per_stage") {
        const g = el("div", null, { class: "yxp-grid" });
        for (const sg of stages) inp(g, sg.name + " 付款日", f.due_dates?.[sg.key] || "", (v) => (f.due_dates = { ...(f.due_dates || {}), [sg.key]: v || null }), "date");
        b.append(g);
      } else {
        const sum = el("p", "", { class: "yxp-sum" });
        const upd = () => {
          const t = f.custom.reduce((acc, x) => acc + (x.ratio_bps || 0), 0);
          sum.textContent = "合计 " + t / 100 + "%" + (t === 10000 ? "" : "，需要正好 100%");
          sum.classList.toggle("yxs-warn", t !== 10000);
        };
        f.custom.forEach((x, i) => {
          const row = el("div", null, { class: "yxp-grid is-inst" });
          inp(row, "名称", x.label, (v) => (x.label = v), "text", { maxlength: "30" });
          inp(row, "比例 %", x.ratio_bps / 100, (v) => ((x.ratio_bps = Math.round(Number(v) * 100) || 0), upd()), "number", { min: "0.01", max: "100", step: "0.01" });
          inp(row, "付款日", x.due || "", (v) => (x.due = v || null), "date");
          const del = button("删除", () => (f.custom.splice(i, 1), mark(), rerender()));
          del.disabled = locked || f.custom.length < 2;
          row.append(del);
          b.append(row);
        });
        if (!locked)
          b.append(
            button("＋ 加一期", () => {
              if (f.custom.length === 1 && f.custom[0].label === "一次付清") f.custom[0].label = "第1期";
              f.custom.push({ stage_key: null, label: "第" + (f.custom.length + 1) + "期", due: null, ratio_bps: 0 });
              mark();
              rerender();
            }),
          );
        b.append(sum);
        upd();
      }
      inp(b, "费用说明（如“考级报名费由考级机构收取”）", f.note, (v) => (f.note = v), "textarea");
    });
    const tm = doc.modules.teachers;
    const tnames = st.teachers.filter((t) => tm.teacher_ids.includes(t.id)).map((t) => t.name);
    item("teachers", "授课老师", tnames.join(" · ") || "还没选", (b) => {
      if (!st.teachers.length) b.append(el("p", "还没有老师档案。", { class: "v-muted" }));
      const tg = el("div", null, { class: "yxp-flags" });
      for (const t of st.teachers) {
        const c = yxsCheck(tg, t.name, "t_" + t.id, tm.teacher_ids.includes(t.id));
        c.disabled = locked;
        c.addEventListener("change", () => ((tm.teacher_ids = c.checked ? [...tm.teacher_ids, t.id] : tm.teacher_ids.filter((x) => x !== t.id)), mark()));
      }
      b.append(tg, el("p", "介绍文字只取自“机构设置 · 机构档案”，AI 不会编写。", { class: "v-muted" }));
    });
    item("about", "机构介绍与成果", "取自机构档案", (b) => b.append(el("p", "显示机构档案里的介绍和特色。", { class: "v-muted" })));
  }
  // 右栏：方案助手
  yxpAiBox(right, st, locked, mark, rerender);
  drawPreview();
}
// 样式页签（设计稿 v3）：模版、封面主图、封面文字、显示开关
function yxpStyleTab(left, st, locked, mark, rerender) {
  const doc = st.doc,
    sty = doc.style;
  const s1 = yxcSection(left, "模版", el("small", "全部 " + st.styles.length + " 套", { class: "v-muted" }));
  const grid = el("div", null, { class: "yxv-styles is-3" });
  for (const p of st.styles) {
    const on = sty.pack_id === p.id;
    const b = el("button", null, { type: "button", class: "yxv-style" + (on ? " is-on" : ""), "aria-pressed": String(on) });
    const sw = el("span", null, { class: "yxv-style-sw" });
    const col = p.manifest?.tokens?.color || {};
    for (const k of ["paper", "ink", "primary"]) {
      const i = el("i");
      i.style.setProperty("background", col[k] || "#ddd");
      sw.append(i);
    }
    b.append(sw, el("span", p.name + (on ? " · 当前" : "")));
    b.disabled = locked;
    b.addEventListener("click", () => {
      if (on) return;
      sty.pack_id = p.id;
      sty.pack_version = p.version;
      mark();
      rerender();
    });
    grid.append(b);
  }
  s1.append(grid, el("p", "平台新上架的模版会自动出现在这里。已发送的方案锁定当时的模版版本。", { class: "v-muted" }));
  const s2 = yxcSection(left, "封面主图");
  const img = st.gallery.find((g) => g.id === sty.cover_image_id);
  const row = el("div", null, { class: "yxv-kv" });
  row.append(el("span", img ? "图库 · " + (img.tags || []).slice(0, 2).join(" · ") : sty.cover_image_id ? "已选图片" : "未选", { class: img || sty.cover_image_id ? "" : "v-muted" }));
  const btns = el("div", null, { class: "yxv-btnrow" });
  if (!locked) {
    btns.append(button("从图库选", () => yxcPickImage(st, (id) => ((sty.cover_image_id = id), mark(), rerender()))));
    if (sty.cover_image_id) btns.append(button("去掉", () => ((sty.cover_image_id = null), mark(), rerender())));
  }
  row.append(btns);
  s2.append(row);
  const s3 = yxcSection(left, "封面文字怎么处理");
  const seg = el("div", null, { class: "yxv-seg yxv-seg-full", role: "radiogroup", "aria-label": "封面文字" });
  for (const [k, t] of [["auto", "自动"], ["dark", "深色字"], ["light", "白字"], ["panel", "加底板"]]) {
    const on = (sty.text_mode || "auto") === k;
    const b = el("button", t, { type: "button", role: "radio", "aria-checked": String(on), "aria-pressed": String(on) });
    b.disabled = locked;
    b.addEventListener("click", () => ((sty.text_mode = k), (sty.text_mode_resolved = null), mark(), rerender()));
    seg.append(b);
  }
  s3.append(seg, el("p", "有主图时选“自动”会按图片明暗决定字色；看不清就选“加底板”。", { class: "v-muted" }));
  const s4 = yxcSection(left, "显示");
  const kv = el("div", null, { class: "yxv-kv" });
  const sw = el("span", null, { class: "yxv-swatch" });
  sw.style.setProperty("background", brand?.theme_color || "#6a35b8");
  const lab = el("span", null, { class: "yxv-brandrow" });
  lab.append(sw, "主色");
  kv.append(lab, el("small", "来自机构品牌包", { class: "v-muted" }));
  s4.append(kv);
  for (const [k, t] of [["show_unit_price", "显示每门课的单价"], ["show_latin_eyebrow", "显示英文小标"], ["show_consultant", "封面显示顾问姓名"]]) {
    const c = yxsCheck(s4, t, "yxp_" + k, !!sty[k]);
    c.disabled = locked;
    c.addEventListener("change", () => ((sty[k] = c.checked), mark()));
  }
}
function yxpManifest(st) {
  const p = st.styles.find((x) => x.id === st.doc.style.pack_id);
  return p ? { ...p.manifest, asset_base: p.asset_base } : st.doc.manifest || null;
}
function yxpPreviewData(st) {
  const d = st.doc;
  const pid = st.student;
  const lines = (d.modules.courses.lines || []).map((l) => {
    if (l.snapshot) return l;
    const c = st.courses.find((x) => x.id === l.course_id);
    return { ...l, snapshot: { name: c?.name || "", optional: !!c?.optional, pricing: { mode: c?.pricing?.mode || "per_unit" } } };
  });
  return {
    ...d,
    modules: { ...d.modules, courses: { ...d.modules.courses, lines } },
    brand: { name: brand?.display_name, logo: brand?.logo, primary_color: brand?.theme_color },
    student: { display_name: pid ? (pid.parent_consent_media ? pid.name : pid.nickname || pid.name) : "" },
    consultant: { name: me.user.name },
    teachers: st.teachers.filter((t) => d.modules.teachers.teacher_ids.includes(t.id)).map((t) => ({ name: t.name, introduction: "" })),
  };
}
function yxpNextDay(d) {
  if (!d) return "";
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
function yxpLine(st, ln, locked, mark, rerender) {
  const row = el("div", null, { class: "yxp-line" });
  const c = st.courses.find((x) => x.id === ln.course_id);
  const snap = ln.snapshot;
  const name = snap?.name || c?.name || ln.course_id;
  const mode = snap?.pricing?.mode || c?.pricing?.mode || "per_unit";
  const [k, unit] = YXP_QTY[mode] || ["units", "课时"];
  const left = el("div", null, { class: "yxp-line-name" });
  left.append(el("strong", name));
  const price = snap?.pricing?.amount_cents != null ? yxpMoney(snap.pricing.amount_cents / 100) : c?.pricing ? yxpMoney(c.pricing.amount) : "";
  left.append(el("small", (price ? price + " / " + (mode === "package" ? "包" : unit) : "") + (snap?.optional || c?.optional ? " · 可选" : ""), { class: "v-muted" }));
  if (snap && c && c.pricing && Math.round(c.pricing.amount * 100) !== snap.pricing?.amount_cents) left.append(el("small", "价目表已变价，可在“更多 → 价格刷新”更新", { class: "yxs-warn" }));
  const q = el("input", null, { type: "number", min: "0.01", step: "0.01", value: ln.qty?.[k] ?? "", "aria-label": name + " 数量", class: "yxp-qty" });
  q.disabled = locked;
  q.addEventListener("input", () => ((ln.qty = { [k]: Number(q.value) }), mark()));
  const qw = el("label", null, { class: "yxp-qtyw" });
  qw.append(q, el("span", unit));
  const fr = el("input", null, { type: "text", value: ln.frequency_text || "", placeholder: "频率，如“每周 1 次”", "aria-label": "频率" });
  fr.disabled = locked;
  fr.addEventListener("input", () => ((ln.frequency_text = fr.value), mark()));
  row.append(left, qw, fr);
  if (!locked)
    row.append(
      button("删除", () => {
        st.doc.modules.courses.lines = st.doc.modules.courses.lines.filter((x) => x !== ln);
        mark();
        rerender();
      }),
    );
  return row;
}
// ---------- 动作 ----------
async function yxpSave(st, rerender) {
  try {
    // 采用过 AI 建议时带上建议 ID；采用了 AI 配课时带上当时的价目表版本（只校验新加的行）。
    const body = { ...st.doc, applied_suggestion_ids: [...new Set([...(st.doc.applied_suggestion_ids || []), ...(st.applied || [])])] };
    if (st.priceRev != null) body.expected_price_list_rev = st.priceRev;
    const r = await api("plans/" + encodeURIComponent(st.doc.id), "PUT", body);
    st.doc = r;
    st.dirty = false;
    st.applied = [];
    st.undo = [];
    st.priceRev = null;
    notice("已保存", "success");
  } catch (e) {
    if (e.code === "version_conflict") {
      if (await UI.confirm({ title: "方案已被别人修改", consequence: "要载入最新内容吗？你这次的修改会丢失。", danger: true })) {
        st.doc = await api("plans/" + encodeURIComponent(st.doc.id));
        st.dirty = false;
        st.applied = [];
        st.undo = [];
        st.priceRev = null;
      } else return;
    } else if (e.code === "price_changed") {
      // 采用 AI 配课后价目表又改过：显示按最新价格重算的总价，顾问确认后用最新版本号再保存。
      const d = e.details || {};
      if (d.price_list_rev == null) return notice("价目表刚更新过，新加课程的价格变了，请检查后再保存。");
      const ok = await UI.confirm({
        title: "价目表刚更新过",
        consequence: "按最新价格，方案总价从 " + yxpMoney(st.doc.computed?.total?.amount) + " 变为 " + yxpMoney(d.computed?.total?.amount) + "。确定按新价格保存？",
      });
      if (!ok) return;
      st.priceRev = d.price_list_rev;
      if (d.computed) st.doc.computed = d.computed;
      return yxpSave(st, rerender);
    } else throw e;
  }
  rerender();
}
async function yxpSkeleton(st, mark, rerender) {
  const doc = st.doc;
  if (!doc.meta.start_month) return notice("先填开始月份");
  if (!doc.meta.target?.month) return notice("先填目标月份（如考级或比赛的月份）");
  if (doc.modules.path.stages.length && !(await UI.confirm({ title: "用自动排出的阶段替换现有阶段？", consequence: "现有阶段和其中的课程会被替换。", danger: true }))) return;
  const r = await api("plans/" + encodeURIComponent(doc.id) + "/skeleton", "POST", {
    start_month: doc.meta.start_month,
    target: { node_key: doc.meta.target?.node_key || null, month: doc.meta.target?.month || null },
    options: {},
  });
  // 顾问提示（hints）只给顾问看：单独存放，不写进方案、不给家长。
  st.hints = {};
  doc.modules.path.stages = (r.stages || []).map(({ hints, ...s }) => {
    if (hints?.length) st.hints[s.key] = hints;
    return s;
  });
  doc.modules.courses.lines = [];
  mark();
  rerender();
  notice("已排出 " + doc.modules.path.stages.length + " 个阶段，请给每个阶段加课程", "success");
}
async function yxpCheck(st) {
  if (st.dirty) return notice("先保存，再检查");
  const r = await api("plans/" + encodeURIComponent(st.doc.id) + "/check");
  st.checkCount = (r.blocking?.length || 0) + (r.warnings?.length || 0);
  const view = UI.drawer({ title: "方案检查" });
  const group = (title, items, tone) => {
    if (!items?.length) return;
    view.body.append(el("h3", title, { class: "yxp-check-h is-" + tone }));
    const ul = el("ul", null, { class: "yxp-check" });
    for (const x of items) ul.append(el("li", x.text));
    view.body.append(ul);
  };
  group("必须处理（不能发送）", r.blocking, "bad");
  group("建议检查", r.warnings, "warn");
  group("已通过", r.passed, "ok");
}
async function yxpSend(st, rerender) {
  if (st.dirty) return notice("先保存，再发送");
  if (!(await UI.confirm({ title: "发送给家长？", consequence: "家长端会看到这一版。之后再修改，需要重新发送家长才能看到。" }))) return;
  try {
    const ack = await yxp2Ack(st);
    if (ack === null) return;
    await api("plans/" + encodeURIComponent(st.doc.id) + "/send", "POST", { version: st.doc.version, ...ack });
    st.doc = await api("plans/" + encodeURIComponent(st.doc.id));
    notice("已发送", "success");
    rerender();
  } catch (e) {
    if (e.code === "check_failed") {
      notice(e.message);
      await yxpCheck(st);
    } else throw e;
  }
}
async function yxpSign(st, rerender) {
  if (!(await UI.confirm({ title: "标记为已签约？", consequence: "签约的是最近发送给家长的版本。签约后方案锁定，不能再修改；不会自动生成收费或排课。" }))) return;
  await api("plans/" + encodeURIComponent(st.doc.id) + "/sign", "POST", {});
  st.doc = await api("plans/" + encodeURIComponent(st.doc.id));
  notice("已签约", "success");
  rerender();
}
// 转为正式学员（v0.4.0 §B3）：只建档，不生成报名、课时或收费。同名且手机尾号相同 → 让顾问选“关联已有”或“仍然新建”。
async function yxpConvert(st, rerender) {
  if (st.dirty) return notice("请先保存方案，再转为正式学员");
  const { panel, close } = drawer("转为正式学员"),
    form = el("form");
  form.append(el("p", "用咨询时登记的信息建学员档案，方案会挂到这位学员名下，分享链接照常可用。" + (st.party === "lead" ? "线索会标记为“已报名”。" : "") + "不会自动生成报名、课时或收费，签约收费请在学员档案里另行办理。", { class: "v-muted" }));
  form.append(el("p", "下面留空的项沿用登记信息；需要更正时再填。", { class: "v-muted" }));
  field(form, "学员姓名", "name", "text", st.partyName || "", false);
  field(form, "年级", "grade", "text", "", false);
  field(form, "家长称呼", "parent_name", "text", "", false);
  field(form, "家长手机", "parent_phone", "tel", "", false);
  const go = async (extra) => {
    const overrides = {};
    for (const k of ["name", "grade", "parent_name", "parent_phone"]) {
      const v = String(form.elements[k].value || "").replace(k === "parent_phone" ? /\s+/g : /^\s+|\s+$/g, "");
      if (v && !(k === "name" && v === st.partyName)) overrides[k] = v;
    }
    const r = await api("plans/" + encodeURIComponent(st.doc.id) + "/convert-student", "POST", { version: st.doc.version, overrides, ...extra });
    st.doc = await api("plans/" + encodeURIComponent(st.doc.id));
    st.student = await api("data/students/" + encodeURIComponent(r.student_id))
      .then((x) => x.record || x)
      .catch(() => null);
    await close();
    notice(extra.link_student_id ? "已关联到已有学员" : "已建学员档案", "success");
    rerender();
  };
  submit(form, "确认转为学员", async () => {
    try {
      await go({});
    } catch (e) {
      if (e.code !== "possible_duplicate") throw e;
      const dups = e.details?.duplicates || [];
      form.querySelector(".yxp-dup")?.remove();
      const box = el("div", null, { class: "yxp-dup", role: "group", "aria-label": "可能是同一位学员" });
      box.append(el("strong", "已有可能是同一位学员的档案"), el("p", "同名且家长手机尾号相同。是同一个人就关联，不会改动原档案。", { class: "v-muted" }));
      for (const d of dups) box.append(button("关联到 " + d.name + (d.grade ? " · " + d.grade : "") + (d.phone_last4 ? " · 尾号 " + d.phone_last4 : ""), () => go({ link_student_id: d.id }).catch((x) => notice(x.message))));
      box.append(button("不是同一人，仍然新建", () => go({ confirm_new: true }).catch((x) => notice(x.message))));
      (form.querySelector(":scope > .v-form-foot") || form.querySelector('[type="submit"]')).before(box);
    }
  });
  panel.append(form);
}
async function yxpArchive(st, rerender) {
  if (!(await UI.confirm({ title: "归档这个方案？", consequence: "家长端不再显示，分享链接立即失效。", danger: true }))) return;
  await api("plans/" + encodeURIComponent(st.doc.id) + "/archive", "POST", { version: st.doc.version });
  st.doc = await api("plans/" + encodeURIComponent(st.doc.id));
  rerender();
}
async function yxpDelete(st, shell, close) {
  if (!(await UI.confirm({ title: "删除这个草稿？", consequence: "删除后不能恢复。", danger: true }))) return;
  await api("plans/" + encodeURIComponent(st.doc.id), "DELETE", { version: st.doc.version });
  st.dirty = false;
  await close();
}
async function yxpDuplicate(st, shell, close) {
  const p = await api("plans/" + encodeURIComponent(st.doc.id) + "/duplicate", "POST", { title: st.doc.title + "（副本）" });
  st.dirty = false;
  notice("已复制", "success");
  yxPlanEditor(p.id, close);
}
async function yxpRevisions(st, rerender) {
  const r = await api("plans/" + encodeURIComponent(st.doc.id) + "/revisions?limit=50");
  const view = UI.drawer({ title: "历史版本" });
  const ACT = { create: "创建", save: "保存", restore: "恢复", reprice: "价格刷新", duplicate: "复制", send: "发送", sign: "签约", archive: "归档" };
  for (const x of r.items || []) {
    const row = el("div", null, { class: "yxp-rev" });
    const who = el("div");
    who.append(el("strong", (ACT[x.action] || x.action) + " · 第 " + x.version + " 版"), el("small", String(x.created_at).slice(0, 16).replace("T", " ") + (x.id === st.doc.sent_revision_id ? " · 家长看到的版本" : "") + (x.id === st.doc.signed_revision_id ? " · 签约版本" : ""), { class: "v-muted" }));
    row.append(who, button("预览", () => yxpExport(st, x.id)));
    if (!yxpLocked(st.doc) && x.version !== st.doc.version)
      row.append(
        button("恢复", async () => {
          if (st.dirty) return notice("先保存或放弃当前修改");
          await api("plans/" + encodeURIComponent(st.doc.id) + "/revisions/" + encodeURIComponent(x.id) + "/restore", "POST", { version: st.doc.version });
          st.doc = await api("plans/" + encodeURIComponent(st.doc.id));
          await view.close();
          notice("已恢复为新版本", "success");
          rerender();
        }),
      );
    view.body.append(row);
  }
}
async function yxpReprice(st, rerender) {
  if (st.dirty) return notice("先保存");
  const r = await api("plans/" + encodeURIComponent(st.doc.id) + "/reprice");
  const view = UI.drawer({ title: "按最新价目表刷新价格" });
  const changed = (r.lines || []).filter((x) => x.status === "changed");
  if (!changed.length) {
    view.body.append(el("p", "价格都是最新的，不需要刷新。"));
    return;
  }
  view.body.append(el("p", "总价 " + yxpMoney(r.total.old) + " → " + yxpMoney(r.total.new) + (r.budget_over ? "（会超出预算）" : "")));
  for (const x of r.lines) view.body.append(el("p", x.name + "：" + yxpMoney(x.old_amount) + " → " + (x.status === "changed" ? yxpMoney(x.new_amount) : x.status === "unchanged" ? "不变" : "无法刷新（课程已停用或未定价）")));
  view.body.append(
    button("确认刷新", async () => {
      await api("plans/" + encodeURIComponent(st.doc.id) + "/reprice", "POST", { version: st.doc.version, line_ids: changed.map((x) => x.line_id) });
      st.doc = await api("plans/" + encodeURIComponent(st.doc.id));
      await view.close();
      notice("价格已刷新", "success");
      rerender();
    }, "primary"),
  );
}
async function yxpShare(st) {
  const id = encodeURIComponent(st.doc.id);
  const view = UI.drawer({ title: "分享链接" });
  const draw = async () => {
    view.body.replaceChildren(el("p", "链接打开的是最近一次发送给家长的版本，不需要登录。每个链接只在创建时显示一次，请当场复制。", { class: "muted" }));
    const list = await api("plans/" + id + "/share-links?limit=50");
    for (const x of list.items || []) {
      const row = el("div", null, { class: "yxp-rev" }),
        who = el("div");
      who.append(el("strong", x.revoked_at ? "已作废" : "有效至 " + String(x.expires_at).slice(0, 10)), el("small", "创建于 " + String(x.created_at).slice(0, 10) + " · 打开 " + (x.visits || 0) + " 次", { class: "v-muted" }));
      row.append(who);
      if (!x.revoked_at)
        row.append(
          button("作废", async () => {
            await api("plans/" + id + "/share-links/" + encodeURIComponent(x.id), "DELETE", { version: x.version });
            await draw();
          }),
        );
      view.body.append(row);
    }
    const form = el("form");
    const d = field(form, "有效天数（1–180）", "days", "number", "30");
    d.min = "1";
    d.max = "180";
    submit(form, "生成新链接", async (v) => {
      const r = await api("plans/" + id + "/share-links", "POST", { expires_in_days: Number(v.days) });
      const box = el("div", null, { class: "yxp-share-new" });
      box.append(el("code", r.url, { class: "secret" }), button("复制链接", async () => {
        try {
          await navigator.clipboard.writeText(r.url);
          notice("已复制", "success");
        } catch {
          notice("请手动选中复制");
        }
      }, "primary"));
      await draw();
      view.body.prepend(box);
    });
    view.body.append(form);
  };
  await draw();
}
async function yxpExport(st, revisionId) {
  if (st.dirty && !revisionId) return notice("先保存，再预览");
  let r;
  const ack = revisionId ? {} : await yxp2Ack(st);
  if (ack === null) return;
  const body = revisionId ? { revision_id: revisionId } : ack;
  try {
    r = await api("plans/" + encodeURIComponent(st.doc.id) + "/export", "POST", body);
  } catch (e) {
    if (e.code === "check_failed" && me.user.roles.includes("supervisor") && /预算/.test(JSON.stringify(e.details || e.message))) {
      if (!(await UI.confirm({ title: "方案超出预算，仍然导出？", consequence: "会记录在操作日志里。" }))) return;
      r = await api("plans/" + encodeURIComponent(st.doc.id) + "/export", "POST", { ...body, force: ["over_budget"] });
    } else throw e;
  }
  yxPlanPrintView(r.render_data, r.manifest && { ...r.manifest, asset_base: r.asset_base }, st.student?.name || st.partyName || "");
}

// ---------- 方案排版（设计稿 v3：封面三套模版 + 内页；打印 / 家长端 / 分享页共用）----------
// manifest 可带 asset_base（风格包图片授权前缀）；封面文字按实际主色和实际照片检查对比度，看不清就加底板。
const YXD_LATIN = { music_interest: "Music · Learning Plan", music_exam: "Music · Exam Preparation", art_interest: "Art · Learning Plan", art_exam: "Fine Arts · Exam Preparation" };
const YXD_FORM = { one_to_one: "一对一", small_group: "小班", group: "集体课", camp: "集训", package: "课包" };
const YXD_CN = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
function yxdLum(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function yxdContrast(a, b) {
  const x = yxdLum(a),
    y = yxdLum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
// 照片上文字区域：平均亮度 + 杂乱程度，决定深色字 / 白字 / 加底板（设计稿 v3「封面文字的可读性」）
function yxdPhotoMode(img, region, apply) {
  const run = () => {
    try {
      const cv = document.createElement("canvas");
      const w = (cv.width = 48),
        hgt = (cv.height = 48);
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      const sx = img.naturalWidth * region.x,
        sy = img.naturalHeight * region.y;
      ctx.drawImage(img, sx, sy, img.naturalWidth * region.w, img.naturalHeight * region.h, 0, 0, w, hgt);
      const d = ctx.getImageData(0, 0, w, hgt).data;
      let sum = 0,
        sq = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        sum += l;
        sq += l * l;
      }
      const mean = sum / n,
        sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
      apply(sd > 0.2 ? "panel" : mean > 0.58 ? "dark" : mean < 0.42 ? "light" : "panel");
    } catch {
      apply("panel");
    }
  };
  if (img.complete && img.naturalWidth) run();
  else img.addEventListener("load", run, { once: true });
  img.addEventListener("error", () => apply("panel"), { once: true });
}
function yxPlanDocument(rd, manifest, mediaUrl) {
  if (rd?.doc_version === 2) return yxPlanDocument2(rd, manifest, mediaUrl);
  const tok = manifest?.tokens?.color || {};
  const comp = manifest?.components || {};
  const primary = tok.use_tenant_primary !== false && /^#[0-9a-f]{6}$/i.test(rd.brand?.primary_color || "") ? rd.brand.primary_color : /^#[0-9a-f]{6}$/i.test(tok.primary || "") ? tok.primary : "#6A35B8";
  const ink = /^#[0-9a-f]{6}$/i.test(tok.ink || "") ? tok.ink : "#211A30";
  const cover = String(comp["plan.cover"] || "folio").replace(/[^a-z]/g, "");
  const docEl = el("article", null, { class: "yxp-doc yxd is-" + cover + " sh-" + String(comp["plan.section_header"] || "numeral").replace(/[^a-z]/g, "") + " sb-" + String(comp["plan.stage_block"] || "band").replace(/[^a-z]/g, "") + " tc-" + String(comp["plan.total_card"] || "solid").replace(/[^a-z]/g, "") });
  docEl.style.setProperty("--yxp-primary", primary);
  docEl.style.setProperty("--yxd-on-primary", yxdContrast("#ffffff", primary) >= 4.5 ? "#ffffff" : ink);
  for (const [k, v] of [["ink", tok.ink], ["paper", tok.paper], ["accent", tok.accent], ["muted", tok.muted]]) if (/^#[0-9a-f]{6}$/i.test(v || "")) docEl.style.setProperty("--yxp-" + k, v);
  const M = rd.modules,
    C = rd.computed || {},
    showPrice = rd.style?.show_unit_price,
    sty = rd.style || {};
  const who = rd.student?.display_name || rd.student?.nickname || "";
  const latin = sty.show_latin_eyebrow ? YXD_LATIN[rd.subject] || "Learning Plan" : "";
  const asset = (p) => (p && manifest?.asset_base ? manifest.asset_base + String(p).replace(/^assets\//, "") : null);
  const pages = [];
  const page = (cls) => {
    const p = el("section", null, { class: "yxp-page yxd-page " + (cls || "") });
    docEl.append(p);
    pages.push(p);
    return p;
  };
  // ---- 封面 ----
  const cv = page("yxd-cover");
  const logo = () => {
    const b = el("div", null, { class: "yxd-logo" });
    if (rd.brand?.logo) b.append(el("img", null, { src: rd.brand.logo, alt: rd.brand?.name || "" }));
    else b.append(el("span", rd.brand?.name || ""));
    return b;
  };
  const photo = sty.cover_image_id && mediaUrl ? el("img", null, { src: mediaUrl(sty.cover_image_id), alt: "", class: "yxd-photo" }) : null;
  if (photo && sty.focal_point) photo.style.setProperty("object-position", Math.round((sty.focal_point.x ?? 0.5) * 100) + "% " + Math.round((sty.focal_point.y ?? 0.5) * 100) + "%");
  const textBox = el("div", null, { class: "yxd-cover-text" });
  if (latin) textBox.append(el("p", latin, { class: "yxd-latin" }));
  textBox.append(el("h1", rd.title));
  const sub = [M.cover?.subtitle, yxpMonthLabel(M.path?.stages?.[0]?.start, M.path?.stages?.at(-1)?.end)].filter(Boolean).join(" · ");
  if (sub) textBox.append(el("p", sub, { class: "yxd-sub" }));
  textBox.append(el("i", null, { class: "yxd-rule" }));
  const nums = el("div", null, { class: "yxd-nums" });
  for (const n of C.cover_numbers || []) {
    const b = el("div");
    b.append(el("small", n.label), el("b", n.value, { class: "yxd-num" }), el("span", n.unit), ...(n.sub ? [el("small", n.sub, { class: "yxd-nsub" })] : []));
    nums.append(b);
  }
  const meta = el("p", ["学员 " + who + (rd.student?.grade ? " · " + rd.student.grade : ""), sty.show_consultant && rd.consultant?.name ? "顾问 " + rd.consultant.name : "", String(rd.sent_at || rd.updated_at || "").slice(0, 10).replaceAll("-", ".")].filter(Boolean).join("　　"), { class: "yxd-meta" });
  if (cover === "stage") {
    // 舞台：主图铺满，文字压在底部
    const bg = el("div", null, { class: "yxd-stage-bg" });
    if (photo) bg.append(photo);
    const top = el("div", null, { class: "yxd-cover-top" });
    top.append(logo(), el("span", "Study Plan", { class: "yxd-kicker" }));
    textBox.append(nums, meta);
    cv.append(bg, top, textBox);
    const mode = sty.text_mode && sty.text_mode !== "auto" ? sty.text_mode : photo ? null : "light";
    const set = (m) => cv.setAttribute("data-text", m);
    if (mode) set(mode);
    else {
      set("light");
      yxdPhotoMode(photo, { x: 0.05, y: 0.55, w: 0.9, h: 0.4 }, set);
    }
  } else if (cover === "journal") {
    // 手札：纸张底色 + 拍立得相框 + 色块，文字不压照片
    cv.append(el("i", null, { class: "yxd-blob a" }), el("i", null, { class: "yxd-blob b" }));
    const top = el("div", null, { class: "yxd-cover-top" });
    top.append(logo());
    const frame = el("figure", null, { class: "yxd-polaroid" });
    if (photo) frame.append(photo);
    else frame.append(el("div", null, { class: "yxd-photo-empty" }));
    frame.append(el("figcaption", (String(M.path?.stages?.[0]?.start || "").slice(0, 4) || "") + " · " + (rd.brand?.name || "")));
    textBox.append(nums);
    cv.append(top, frame, textBox, meta);
  } else {
    // 画册（默认）：主图放在拱形画框里，文字在主色块上
    const arch = el("div", null, { class: "yxd-arch" });
    if (photo) arch.append(photo);
    else arch.append(el("div", null, { class: "yxd-photo-empty" }));
    const band = el("div", null, { class: "yxd-band" });
    const head = el("div", null, { class: "yxd-band-head" });
    head.append(textBox, logo());
    band.append(head, nums, meta);
    cv.append(arch, band);
  }
  const corner = asset(manifest?.decor?.corner_image);
  if (corner) cv.append(el("img", null, { src: corner, alt: "", class: "yxd-corner" }));
  // ---- 内页 ----
  let n = 0;
  const inner = () => {
    const p = page("yxd-inner");
    const hd = el("div", null, { class: "yxd-phead" });
    hd.append(el("span", who + " · " + rd.title, { class: "yxd-phead-l" }), el("span", rd.brand?.name || ""));
    p.append(hd);
    return p;
  };
  const head = (p, latinT, t) => {
    const h = el("div", null, { class: "yxd-h" });
    h.append(el("span", String(++n).padStart(2, "0"), { class: "yxd-h-num" }));
    const tx = el("div");
    if (latinT && sty.show_latin_eyebrow !== false) tx.append(el("small", latinT, { class: "yxd-latin" }));
    tx.append(el("h2", t));
    h.append(tx);
    p.append(h);
  };
  const A = M.assessment;
  const stages = M.path?.visible ? M.path.stages || [] : [];
  const compStage = Object.fromEntries((C.stages || []).map((x) => [x.key, x]));
  let p1 = null;
  if (A?.visible && (A.text || A.strengths?.length || A.gaps?.length || A.goals?.length)) {
    p1 = inner();
    head(p1, "Assessment", "现在的水平与老师评估");
    if (A.text) p1.append(el("p", A.text, { class: "yxd-text" }));
    const g = el("div", null, { class: "yxd-cards3" });
    for (const [t, arr] of [["已经做得好", A.strengths], ["需要补的", A.gaps], ["这次的目标", A.goals]]) {
      if (!arr?.length) continue;
      const b = el("div", null, { class: "yxd-card" });
      b.append(el("h3", t));
      const ul = el("ul");
      for (const x of arr) ul.append(el("li", x));
      b.append(ul);
      g.append(b);
    }
    p1.append(g);
    if (A.source_note) p1.append(el("p", "依据 " + A.source_note, { class: "yxd-note" }));
  }
  if (stages.length) {
    const p = p1 || inner();
    head(p, "Learning Path", "学习路径与节点");
    const tl = el("div", null, { class: "yxd-path" });
    stages.forEach((s, i) => {
      const c = compStage[s.key] || {};
      const row = el("div", null, { class: "yxd-path-row" });
      const l = el("div", null, { class: "yxd-path-l" });
      l.append(el("small", "第" + (YXD_CN[i] || i + 1) + "阶段"), el("strong", s.name));
      const dur = el("p");
      dur.append(el("b", String(c.months ?? ""), { class: "yxd-num" }), " 个月" + (c.weeks_display ? " · " + c.weeks_display + " 周" : ""));
      l.append(dur);
      const r = el("div", null, { class: "yxd-path-r" + (i === stages.length - 1 ? " is-last" : "") });
      const t = el("p", null, { class: "yxd-path-when" });
      t.append(el("strong", yxpMonthLabel(s.start, s.end).replace(/(\d{4})\.(\d{2})/g, "$1 年 $2 月").replace(/ 年 0?/g, " 年 ")));
      // 节点标签只显示中文名称；内部编号（英文）不给家长看
      for (const tag of s.node_tags || []) if (!/^[a-z0-9_]+$/i.test(tag)) t.append(el("span", tag, { class: "yxd-chip" }));
      r.append(t);
      if (s.goals?.length) {
        const ul = el("ul");
        for (const x of s.goals) ul.append(el("li", x));
        r.append(ul);
      }
      row.append(l, r);
      tl.append(row);
    });
    p.append(tl);
    if (rd.meta?.target?.text) p.append(el("p", "目标：" + rd.meta.target.text, { class: "yxd-target" }));
  }
  if (M.courses?.visible && stages.length) {
    const p = inner();
    head(p, "Course Schedule", "各阶段课程安排");
    const t = el("table", null, { class: "yxd-table" });
    const hr = el("tr");
    for (const x of ["课程", "形式", "频率", "时长", "课时"]) hr.append(el("th", x));
    const thead = el("thead");
    thead.append(hr);
    t.append(thead);
    stages.forEach((s, i) => {
      const c = compStage[s.key] || {};
      const tb = el("tbody", null, { class: "yxd-stage" });
      const band = el("tr", null, { class: "yxd-stage-row" });
      const td = el("td");
      td.colSpan = 5;
      const bl = el("div");
      const name = el("strong", "第" + (YXD_CN[i] || i + 1) + "阶段 · " + s.name);
      bl.append(name, el("small", yxpMonthLabel(s.start, s.end) + (c.weeks_display ? " · " + c.weeks_display + " 周" : "")), el("span", null, { class: "yxd-sp" }), el("b", (c.units ?? 0) + " 课时" + (M.fees?.visible && c.amount != null ? " · " + yxpMoney(c.amount) : "")));
      td.append(bl);
      band.append(td);
      tb.append(band);
      for (const l of (M.courses.lines || []).filter((x) => x.stage_key === s.key && !x.snapshot?.optional)) {
        const sn = l.snapshot || {};
        const [k, unit] = YXP_QTY[sn.pricing?.mode] || ["units", "课时"];
        const tr = el("tr");
        const nm = el("td");
        nm.append(el("span", sn.name || ""));
        if (l.note || l.includes?.length) nm.append(el("small", [l.note, l.includes?.length ? "含 " + l.includes.map((x) => x.name || x).join("、") : ""].filter(Boolean).join(" · ")));
        if (showPrice && sn.pricing?.amount_cents != null) nm.append(el("small", yxpMoney(sn.pricing.amount_cents / 100) + " / " + unit));
        tr.append(nm, el("td", YXD_FORM[sn.form] || ""), el("td", l.frequency_text || ""), el("td", sn.minutes ? sn.minutes + " 分钟" : sn.duration_text || ""), el("td", (l.qty?.[k] ?? "") + (unit === "课时" ? "" : " " + unit), { class: "yxd-r" }));
        tb.append(tr);
      }
      t.append(tb);
    });
    p.append(t);
    if (M.fees?.visible) {
      const tot = el("div", null, { class: "yxd-sum" });
      tot.append(el("strong", "合计"), el("span", (C.total?.units || 0) + " 课时" + (C.total?.bundles?.length ? " + " + C.total.bundles.join("、") : "")), el("span", null, { class: "yxd-sp" }), el("b", yxpMoney(C.total?.amount), { class: "yxd-num" }));
      p.append(tot);
    }
  }
  if (M.fees?.visible) {
    const p = inner();
    head(p, "Tuition", "费用与付款");
    const wrap = el("div", null, { class: "yxd-fees" });
    const t = el("table", null, { class: "yxd-table is-plain" });
    const hr = el("tr");
    for (const x of ["阶段", "付款时间", "金额"]) hr.append(el("th", x));
    const thead = el("thead");
    thead.append(hr);
    t.append(thead);
    const tb = el("tbody");
    for (const x of C.installments || []) {
      const tr = el("tr");
      tr.append(el("td", x.label), el("td", x.due ? x.due.replaceAll("-", ".") + " 前" : "—"), el("td", yxpMoney(x.amount), { class: "yxd-r" }));
      tb.append(tr);
    }
    t.append(tb);
    const card = el("div", null, { class: "yxd-total" });
    card.append(el("small", "课程总费用"), el("b", yxpMoney(C.total?.amount), { class: "yxd-num" }), el("p", (C.total?.units || 0) + " 课时" + (C.total?.bundles?.length ? " + " + C.total.bundles.join("、") : "") + (C.installments?.length > 1 ? "，可分 " + C.installments.length + " 期付" : "")));
    wrap.append(t, card);
    p.append(wrap);
    if (C.optional_fees?.length) p.append(el("p", "可选费用（不计入总价）：" + C.optional_fees.map((x) => x.label + (x.price_text ? " " + x.price_text : "")).join("；"), { class: "yxd-note" }));
    if (M.fees.note) p.append(el("p", M.fees.note, { class: "yxd-note" }));
    if (M.teachers?.visible && rd.teachers?.length) yxdTeachers(p, rd, head);
  } else if (M.teachers?.visible && rd.teachers?.length) yxdTeachers(inner(), rd, head);
  // 末页：机构联系卡片
  const last = pages.at(-1);
  if (last && last !== cv) {
    const card = el("div", null, { class: "yxd-contact" });
    const tx = el("div");
    tx.append(el("strong", rd.brand?.name || ""));
    for (const x of [rd.profile?.address, rd.profile?.class_hours ? "上课时间：" + rd.profile.class_hours : "", rd.consultant?.name && sty.show_consultant ? "顾问 " + rd.consultant.name + (rd.profile?.contact_phone ? " · " + rd.profile.contact_phone : "") : rd.profile?.contact_phone || ""]) if (x) tx.append(el("p", x));
    card.append(tx);
    if (rd.brand?.qr_image_id && mediaUrl) {
      const qr = el("figure", null, { class: "yxd-qr" });
      qr.append(el("img", null, { src: mediaUrl(rd.brand.qr_image_id), alt: "咨询二维码" }), el("figcaption", "咨询二维码"));
      card.append(qr);
    }
    last.append(card);
  }
  // 页脚：机构 · 学习方案 · 页码
  pages.forEach((p, i) => {
    if (i === 0) return;
    const f = el("div", null, { class: "yxd-pfoot" });
    f.append(el("span", (rd.brand?.name || "") + " · 学习方案" + (i === pages.length - 1 ? " · 以签署的合同为准" : "")), el("span", String(i + 1).padStart(2, "0") + " / " + String(pages.length).padStart(2, "0")));
    p.append(f);
  });
  // “以签署的合同为准”放进最后一页页脚：以前放在页面外，打印时会多出一张只有这行字的空白页。
  if (pages.length < 2) docEl.append(el("p", "以签署的合同为准", { class: "yxd-legal" }));
  return docEl;
}
function yxdTeachers(p, rd, head) {
  head(p, "Teachers", "授课老师");
  const g = el("div", null, { class: "yxd-teachers" });
  for (const t of rd.teachers) {
    const b = el("div", null, { class: "yxd-teacher" });
    b.append(el("span", (t.name || "").slice(0, 1), { class: "yxd-avatar" }));
    const tx = el("div");
    tx.append(el("strong", t.name), el("p", t.introduction || ""));
    b.append(tx);
    g.append(b);
  }
  p.append(g);
}
function yxExportName(kind, title) {
  const t = String(title || "").replace(/[\\/:*?"<>|\n\r]+/g, " ").trim().slice(0, 40);
  return kind + (t ? "-" + t : "");
}
// 打印时浏览器用 document.title 当 PDF 文件名：临时换成“学员方案-姓名”，打印完恢复。
function yxPrintAs(name) {
  const old = document.title;
  document.title = name;
  const back = () => ((document.title = old), removeEventListener("afterprint", back));
  addEventListener("afterprint", back);
  window.print();
  setTimeout(back, 60000);
}
function yxPlanPrintView(rd, manifest, who) {
  document.querySelector(".yxp-print-root")?.remove();
  const rootEl = el("div", null, { class: "yxp-print-root ui-root" });
  const bar = el("div", null, { class: "yxp-print-bar" });
  bar.append(
    button("‹ 关闭预览", () => rootEl.remove()),
    el("span", "打印时选“A4、纵向”，可另存为 PDF。", { class: "v-muted" }),
    el("span", null, { class: "v-spacer" }),
    button("打印 / 存为 PDF", () => yxPrintAs(yxExportName("学员方案", who || rd.title)), "primary"),
  );
  const mediaUrl = (id) => base + "api/gallery/" + encodeURIComponent(id) + "/file";
  rootEl.append(bar, yxPlanDocument(rd, manifest, mediaUrl));
  document.body.append(rootEl);
}

// ---------- 家长端「学习方案」 ----------
async function yxParentPlans(c) {
  c.replaceChildren();
  const feed = await api("parent/children/" + encodeURIComponent(yxState.child) + "/feed?limit=50");
  const plans = (feed.items || []).filter((x) => x.type === "plan");
  if (!plans.length) return yxParentEmpty(c, "学习方案", "机构发送学习方案后，会显示在这里。");
  const open = async (id) => {
    const r = await api("parent/plans/" + encodeURIComponent(id));
    c.replaceChildren();
    if (plans.length > 1) c.append(button("‹ 全部方案", () => yxParentPlans(c)));
    c.append(yxPlanDocument(r.render_data, r.manifest && { ...r.manifest, asset_base: r.asset_base }, (img) => base + "api/parent/media/" + encodeURIComponent(img)));
  };
  if (plans.length === 1) return open(plans[0].id);
  const list = el("div", null, { class: "yxp-parent-list" });
  for (const p of plans) {
    const b = el("button", null, { type: "button", class: "yxp-item" }),
      w = el("span", null, { class: "yxp-item-main" });
    w.append(el("strong", p.title), el("small", (p.status === "signed" ? "已签约 · " : "") + String(p.at).slice(0, 10), { class: "v-muted" }));
    b.append(w);
    b.addEventListener("click", () => open(p.id));
    list.append(b);
  }
  c.append(list);
}

// ---------- 公开分享页 /s/{token} ----------
// 不登录；数据只来自 GET /api/share/{token}。所有失效原因显示同一句话，不暴露原因。
async function yxSharePage() {
  const token = location.pathname.split("/")[2] || "";
  const fail = () => {
    const box = el("section", null, { class: "yx-paused-card yxp-share-fail" });
    box.append(el("h1", "链接已失效"), el("p", "这个学习方案链接已失效或不存在。请联系机构老师获取新的链接。", { class: "yx-paused-sub" }));
    const page = el("div", null, { class: "yx-paused" });
    page.append(box);
    root.replaceChildren(page);
    document.title = "链接已失效";
  };
  try {
    const res = await fetch("/api/share/" + encodeURIComponent(token), { credentials: "omit", headers: { Accept: "application/json" } });
    if (!res.ok) return fail();
    const r = await res.json();
    if (!r?.render_data) return fail();
    document.title = r.render_data.title || "学习方案";
    const wrap = el("div", null, { class: "yxp-share" });
    wrap.append(yxPlanDocument(r.render_data, r.manifest && { ...r.manifest, asset_base: r.asset_base }, (img) => "/api/share/" + encodeURIComponent(token) + "/media/" + encodeURIComponent(img)));
    const bar = el("div", null, { class: "yxp-share-bar" });
    bar.append(button("保存为 PDF / 打印", () => yxPrintAs(document.title), "primary"));
    wrap.append(bar);
    root.replaceChildren(wrap);
  } catch {
    fail();
  }
}
