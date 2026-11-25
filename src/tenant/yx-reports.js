// 艺界星途 · 成长报告：批次、编辑器、排版（Claude，接口 v0.3.7 §4.5.3、§4.5.4）
// 分数只由人打；AI 只写四段文字建议，人点“采用”再保存。

const YXR_PROGRESS = { not_started: ["未开始", "muted"], draft: ["草稿", "info"], ready: ["完成待发", "warn"], published: ["已发布", "ok"] };
const YXR_STATS = { lessons: ["上课", "次"], attendance: ["出勤", "次"], repertoire_done: ["完成曲目 / 作品", "首"], camp_days: ["集训", "天"], mock_count: ["模拟考", "次"], days_to_exam: ["距统考", "天"] };
const YXR_FIXED = new Set(["mock_count", "days_to_exam"]);
const YXR_TEXTS = [["progress", "这学期的进步", false], ["focus", "还需要加强", false], ["next_goals", "下阶段目标（每行一条）", true], ["home_practice", "在家练习（每行一条）", true], ["teacher_note", "老师寄语", false]];
const YXR_AI_FIELDS = ["progress", "focus", "home_practice", "teacher_note"];
const yxrCache = { names: null };

async function yxrNames() {
  // 老师读不了全部学员，用“我的学生”接口取名字。
  if (!yxrCache.names)
    yxrCache.names = (yxIsTeacher() ? api("c3/teacher-students") : api("data/students?limit=1000"))
      .then((r) => new Map((r.items || r.records || r.students || []).map((x) => [x.student_id || x.id, x.name])))
      .catch(() => new Map());
  return yxrCache.names;
}
function yxrCanWrite() {
  return enabled("growth_reports", "write") || yxIsTeacher();
}
// 分数和模拟考成绩只能由老师本人或教务填写（主管单一角色不能代填）。
function yxrCanScore() {
  return yxIsTeacher() || me.user.roles.includes("academic");
}
function yxrCanPublish() {
  return enabled("growth_reports", "publish") || (yxIsTeacher() && me.policy?.settings?.teacher_can_publish_reports === true);
}

// ---------- 批次列表 ----------
async function yxReportsPage(c) {
  const V = globalThis.ChannelV2;
  const data = await api("report-batches?limit=100");
  c.replaceChildren();
  c.classList.add("yx-page");
  const bar = el("div", null, { class: "yxs-bar" });
  bar.append(el("span", null, { class: "v-spacer" }));
  if (yxrCanWrite()) bar.append(button("＋ 新建报告批次", () => yxrBatchForm(() => yxReportsPage(c)), "primary"));
  c.append(bar, el("p", "按学期或阶段建一个批次，系统为每位学员建好报告；AI 可以按已确认的课后反馈批量起草文字，分数由老师打。", { class: "v-muted" }));
  if (!data.items?.length) return c.append(UI.empty({ text: "还没有报告批次。" }));
  for (const b of data.items) {
    const box = V.panel(b.name + " · " + b.from + " – " + b.to);
    const count = {};
    for (const r of b.reports || []) count[r.progress] = (count[r.progress] || 0) + 1;
    const sum = el("div", null, { class: "yxai-tags" });
    for (const [k, [t, tone]] of Object.entries(YXR_PROGRESS)) if (count[k]) sum.append(V.chip(t + " " + count[k], tone));
    box.append(sum, button("打开", () => yxReportBatch(c, b.id), "primary"));
    c.append(box);
  }
}
async function yxrBatchForm(again) {
  const { panel, close } = drawer("新建报告批次"),
    form = el("form");
  const [classes, teachers, students] = await Promise.all([
    api("settings/report-classes?limit=200").catch(() => ({ items: [] })),
    yxIsTeacher() ? { items: [] } : api("data/teachers?limit=200").catch(() => ({ items: [] })),
    api("data/students?limit=1000").catch(() => ({ items: [] })),
  ]);
  field(form, "批次名称", "name", "text", "秋季学期报告");
  field(form, "开始日期", "from", "date", "");
  field(form, "结束日期", "to", "date", "");
  yxsSelect(form, "报告班型", "report_class_id", [["", "按每位学员档案里的班型"], ...(classes.items || []).filter((x) => x.active !== false).map((x) => [x.id, x.name])], "");
  if (!yxIsTeacher()) yxsSelect(form, "负责老师", "teacher_id", [["", "暂不分配"], ...(teachers.items || teachers.records || []).map((x) => [x.id, x.name])], "");
  const pick = el("fieldset", null, { class: "yxs-group" });
  pick.append(el("legend", "选择学员"));
  const q = el("input", null, { type: "search", placeholder: "搜索姓名", "aria-label": "搜索学员" });
  const list = el("div", null, { class: "yxc-checks" });
  const chosen = new Set();
  const all = students.items || students.records || [];
  const draw = () => {
    list.replaceChildren();
    for (const s of all.filter((x) => !q.value.trim() || String(x.name).includes(q.value.trim())).slice(0, 300)) {
      const ck = yxsCheck(list, s.name, "stu_" + s.id, chosen.has(s.id));
      ck.addEventListener("change", () => (ck.checked ? chosen.add(s.id) : chosen.delete(s.id)));
    }
  };
  q.addEventListener("input", draw);
  draw();
  pick.append(q, list);
  form.append(pick);
  submit(form, "建好报告", async (d) => {
    if (!chosen.size) throw Error("至少选一位学员");
    if (!d.from || !d.to || d.from > d.to) throw Error("日期不正确");
    await api("report-batches", "POST", { name: d.name.trim(), from: d.from, to: d.to, ...(d.report_class_id ? { report_class_id: d.report_class_id } : {}), ...(d.teacher_id ? { teacher_id: d.teacher_id } : {}), student_ids: [...chosen] });
    await close();
    await again();
  });
  panel.append(form);
}

// ---------- 批次详情 ----------
const yxrBatchState = {};
async function yxReportBatch(c, batchId) {
  const V = globalThis.ChannelV2;
  const [list, names] = await Promise.all([api("report-batches?limit=200"), yxrNames()]);
  const b = (list.items || []).find((x) => x.id === batchId);
  if (!b) return yxReportsPage(c);
  const st = (yxrBatchState[batchId] ||= { sugs: {}, result: null });
  const again = () => yxReportBatch(c, batchId);
  c.classList.add("yx-page");
  const backRow = el("div");
  backRow.append(button("‹ 全部批次", () => yxReportsPage(c)));
  c.replaceChildren(backRow, el("h1", b.name), el("p", b.from + " – " + b.to + " · " + b.reports.length + " 位学员", { class: "v-muted" }));
  const acts = el("div", null, { class: "yxai-acts" });
  const fresh = b.reports.filter((r) => r.progress === "not_started");
  if (fresh.length && yxrCanWrite())
    acts.append(
      yxAiButton("AI 批量起草（未开始的 " + fresh.length + " 位）", async () => {
        const res = await yxAi("report/batch-draft", { batch_id: batchId, student_ids: fresh.slice(0, 100).map((r) => r.student_id) });
        for (const sg of res.suggestions) st.sugs[sg.target.report_id] = sg;
        st.result = res;
        await again();
      }, "primary"),
    );
  const ready = b.reports.filter((r) => r.progress === "ready");
  if (ready.length && yxrCanPublish())
    acts.append(
      button("发布完成待发的 " + ready.length + " 份", async () => {
        if (!(await UI.confirm({ title: "发布 " + ready.length + " 份报告？", consequence: "发布后家长端立即可以看到。" }))) return;
        const r = await api("report-batches/" + encodeURIComponent(batchId) + "/publish", "POST", { report_ids: ready.map((x) => x.id) });
        notice("已发布 " + (r.published || []).length + " 份" + (r.skipped?.length ? "，" + r.skipped.length + " 份没发布" : ""), "success");
        await again();
      }),
    );
  acts.append(yxAiUsageChip());
  c.append(acts);
  if (st.result) {
    const r = st.result;
    const box = el("div", null, { class: "yxai-card" });
    box.append(el("strong", "AI 已起草 " + r.processed.length + " 位" + (r.skipped.length ? "，" + r.skipped.length + " 位没处理" : "") + "。打开每份报告查看和采用，没采用前不会写进报告。"));
    const why = { already_started: "已经开始写了", quota_exceeded: "今天 AI 次数不够", model_error: "AI 出错", deadline: "超时" };
    for (const s of r.skipped) box.append(el("small", (names.get(s.student_id) || s.student_id) + "：" + (why[s.reason] || s.reason), { class: "v-muted" }));
    const w = yxAiWarnings(r.warnings);
    if (w) box.append(w);
    c.append(box);
  }
  const panel = V.panel("学员");
  for (const r of b.reports) {
    const s = YXR_PROGRESS[r.progress] || [r.progress, "muted"];
    const line = el("button", null, { type: "button", class: "yxp-item" }),
      who = el("span", null, { class: "yxp-item-main" });
    who.append(el("strong", names.get(r.student_id) || "学员"), el("small", st.sugs[r.id] ? "有 AI 草稿待采用" : "", { class: "v-muted" }));
    line.append(who, V.chip(s[0], s[1]));
    line.addEventListener("click", () => yxReportEditor(r.id, { batch: b, names, sugs: st.sugs, onClose: again, name: names.get(r.student_id) || "学员", sug: st.sugs[r.id] }, again));
    panel.append(line);
  }
  c.append(panel);
}

// ---------- 报告编辑器 ----------
async function yxReportEditor(id, ctx, onClose) {
  yxDisposeEditors();
  const shell = el("div", null, { class: "yxp-editor yxv-editor yxr-editor ui-root", role: "dialog", "aria-modal": "true", "aria-label": "成长报告" });
  document.body.append(shell);
  shell.append(UI.tableSkeleton());
  const st = { doc: null, dirty: false, stats: {}, undo: [], manifest: null, gallery: null };
  shell.yxDispose = () => {
    st.closed = true;
    clearTimeout(st.qTimer);
    st.qSeq = (st.qSeq || 0) + 1;
  };
  const close = async () => {
    if (st.dirty && !(await UI.confirm({ title: "有未保存的修改，确定离开？", consequence: "离开后这些修改会丢失。" }))) return;
    shell.yxDispose?.();
    shell.remove();
    await onClose?.();
  };
  shell.addEventListener("keydown", (e) => yxEditorEscape(e, shell) && close());
  try {
    st.doc = await api("reports/" + encodeURIComponent(id));
    const s = st.doc.style || {};
    st.manifest = (await api("styles/" + encodeURIComponent(s.pack_id) + "/versions/" + encodeURIComponent(s.pack_version)).catch(() => null))?.manifest || null;
    st.gallery = await api("gallery?limit=200").then((r) => r.items || []).catch(() => null);
  } catch (e) {
    shell.replaceChildren(UI.empty({ text: e.message, action: { label: "关闭", onSelect: close } }));
    return;
  }
  const render = () => shell.isConnected && yxrRender(shell, st, ctx, close, render);
  render();
}
function yxrPreview(st, ctx) {
  return { ...st.doc, student: { nickname: ctx.name }, brand: { name: brand.display_name, primary_color: getComputedStyle(document.documentElement).getPropertyValue("--theme").trim() || null }, title: ctx.batch?.name };
}
function yxrRender(shell, st, ctx, close, rerender) {
  const V = globalThis.ChannelV2,
    doc = st.doc;
  const ro = !yxrCanWrite();
  const mark = () => {
    st.dirty = true;
    save.disabled = false;
    saved.textContent = "有未保存的修改";
    saved.classList.add("is-dirty");
    pv.replaceChildren(yxReportDocument(yxrPreview(st, ctx), st.manifest, yxcMedia));
  };
  // 第一次打开：批量起草的结果放进各段文字下方的建议框
  if (ctx.sug && !st.sugInit) {
    st.sugInit = true;
    yxrTakeSug(st, ctx.sug);
  }
  shell.classList.add("yxv-editor", "yxr-v3");
  shell.replaceChildren(yxvRail(close));
  const main = el("div", null, { class: "yxv-main" });
  shell.append(main);
  const b = ctx.batch;
  const list = b?.reports || [];
  // 顶栏：面包屑 · 批次名 · 日期；右侧 今日 AI / 生成长图 / 发布已完成的
  const bar = el("header", null, { class: "yxp-bar yxv-bar" });
  const crumbs = el("nav", null, { class: "yxv-crumbs", "aria-label": "位置" });
  const back = button("‹ 返回", close);
  back.classList.add("yxv-back");
  crumbs.append(back);
  for (const x of [V.link("招生", close), el("span", "›", { "aria-hidden": "true" }), V.link("成长报告", close), el("span", "›", { "aria-hidden": "true" })]) {
    x.classList.add("yxv-crumb");
    crumbs.append(x);
  }
  crumbs.append(el("strong", b?.name || "成长报告"));
  bar.append(crumbs);
  if (b) bar.append(el("span", b.from.replaceAll("-", ".") + " – " + b.to.replaceAll("-", "."), { class: "yxv-saved" }));
  bar.append(el("span", null, { class: "v-spacer" }));
  if (enabled("ai", "use") || yxIsTeacher()) bar.append(yxAiUsageChip());
  bar.append(button("生成长图", () => print()));
  const ready = list.filter((r) => r.progress === "ready" && r.id !== doc.id);
  if (b && yxrCanPublish()) {
    const readyAll = list.filter((r) => r.progress === "ready");
    const pub = button("发布已完成的 " + readyAll.length + " 份", async () => {
      if (st.dirty) await yxrSave(st);
      if (!(await UI.confirm({ title: "发布 " + readyAll.length + " 份报告？", consequence: "发布后家长端立即可以看到。" }))) return;
      const r = await api("report-batches/" + encodeURIComponent(b.id) + "/publish", "POST", { report_ids: readyAll.map((x) => x.id) });
      notice("已发布 " + (r.published || []).length + " 份" + (r.skipped?.length ? "，" + r.skipped.length + " 份没发布" : ""), "success");
      await yxrReloadBatch(st, ctx, rerender);
    }, "primary");
    pub.disabled = !readyAll.length;
    bar.append(pub);
  }
  void ready;
  main.append(bar);
  const body = el("div", null, { class: "yxv-body yxr-grid" + (list.length > 1 ? "" : " is-single") });
  main.append(body);
  // 左：全班学员
  if (list.length > 1) body.append(yxrClassList(st, ctx, rerender));
  // 中：表单
  const mid = el("div", null, { class: "yxr-mid", role: "main", "aria-label": "填写报告" });
  body.append(mid);
  const head = el("div", null, { class: "yxe-head" });
  const nm = el("div");
  nm.append(el("h1", ctx.name || "学员"), el("span", [YXS_SUBJECT?.[doc.subject] || "", doc.feedback_count != null ? "本期已确认的课后反馈 " + doc.feedback_count + " 条" : ""].filter(Boolean).join(" · "), { class: "v-muted" }));
  head.append(nm, el("span", null, { class: "v-spacer" }));
  const at = list.findIndex((r) => r.id === doc.id);
  const go = async (i) => {
    const r = list[i];
    if (!r) return;
    if (st.dirty && !(await UI.confirm({ title: "有未保存的修改，确定切换？", consequence: "切换后这些修改会丢失。" }))) return;
    st.dirty = false;
    shell.remove();
    await yxReportEditor(r.id, { ...ctx, name: ctx.names?.get(r.student_id) || "学员", sug: ctx.sugs?.[r.id] }, ctx.onClose);
  };
  ctx.go = go;
  if (list.length > 1) {
    const prev = button("上一位", () => go(at - 1));
    prev.disabled = at <= 0;
    const next = button("下一位", () => go(at + 1));
    next.disabled = at >= list.length - 1;
    head.append(prev, next);
  }
  mid.append(head);
  // 状态与操作
  const p = YXR_PROGRESS[doc.progress] || [doc.status, "muted"];
  const save = button("保存", () => yxrSave(st).then(rerender).catch((e) => notice(e.message)));
  save.disabled = !st.dirty;
  const saved = el("span", st.dirty ? "有未保存的修改" : doc.updated_at ? "已保存 " + String(doc.updated_at).slice(11, 16) : "", { class: "yxv-saved" + (st.dirty ? " is-dirty" : "") });
  const act = async (path, body2, okText) => {
    if (st.dirty) await yxrSave(st);
    try {
      const fc = st.doc.feedback_count;
      st.doc = await api("reports/" + encodeURIComponent(doc.id) + "/" + path, "POST", body2 || {});
      if (st.doc.feedback_count == null) st.doc.feedback_count = fc;
      notice(okText, "success");
      await yxrReloadBatch(st, ctx, rerender);
    } catch (e) {
      if (e.code === "check_failed") return yxrCheck(e.details?.items || [], doc);
      throw e;
    }
  };
  const ops = el("div", null, { class: "yxr-ops" });
  ops.append(el("span", p[0], { class: "yx-dot is-" + (p[1] === "info" ? "muted" : p[1]) }), saved, el("span", null, { class: "v-spacer" }));
  if (!ro) ops.append(save);
  if (!ro && doc.status === "draft") ops.append(button("完成", () => act("ready", {}, "已完成，等待发布")));
  if (doc.status === "ready" && enabled("growth_reports", "write"))
    ops.append(
      button("退回", async () => {
        const reason = await yxrReason("退回给老师的原因");
        if (reason) await act("return", { reason }, "已退回");
      }),
    );
  if (yxrCanPublish() && (doc.status === "ready" || (doc.status === "draft" && yxIsTeacher())))
    ops.append(
      button("发布给家长", async () => {
        if (await UI.confirm({ title: "发布这份报告？", consequence: "发布后家长端立即可以看到。" })) await act("publish", {}, "已发布，家长端可以看到了");
      }, "primary"),
    );
  if (doc.status === "published" && enabled("growth_reports", "unpublish"))
    ops.append(
      button("撤回发布", async () => {
        const reason = await yxrReason("撤回原因");
        if (reason) await act("unpublish", { reason }, "已撤回，家长端不再显示");
      }),
    );
  mid.append(ops);
  if (doc.status === "published") mid.append(el("p", "这份报告已发布。现在修改会生成新的草稿，家长继续看到已发布的版本，重新发布后才替换。", { class: "yxp-hint" }));
  if (doc.reason) mid.append(el("p", "退回原因：" + doc.reason, { class: "yxai-warn" }));
  const w = yxAiWarnings(doc.warnings);
  if (w) mid.append(w);
  st.refreshCrm = () => act("refresh-crm", {}, "已重新读取 CRM 数字（你手改过的保留）");
  yxrForm(mid, st, ro, mark, rerender);
  // 右：家长看到的报告
  const right = el("div", null, { class: "yxr-right", role: "complementary", "aria-label": "家长看到的报告" });
  right.append(el("p", "家长看到的报告 · 实时预览", { class: "yxr-right-h" }));
  const pv = el("div", null, { class: "yxr-phone" });
  pv.append(yxReportDocument(yxrPreview(st, ctx), st.manifest, yxcMedia));
  right.append(pv);
  body.append(right);
}
// 全班列表（设计稿 v3 左栏）
function yxrClassList(st, ctx, rerender) {
  const b = ctx.batch,
    list = b.reports;
  const box = el("div", null, { class: "yxr-class", role: "navigation", "aria-label": "全班学员" });
  const cnt = {};
  for (const r of list) cnt[r.progress] = (cnt[r.progress] || 0) + 1;
  const h = el("div", null, { class: "yxr-class-h" });
  h.append(el("strong", "全班 " + list.length + " 人"), el("small", "已发 " + (cnt.published || 0) + " · 待发 " + (cnt.ready || 0) + " · 草稿 " + (cnt.draft || 0), { class: "v-muted" }));
  const prog = el("div", null, { class: "yxr-prog" });
  for (const k of ["published", "ready", "draft"]) {
    const s = el("span", null, { class: "is-" + k });
    s.style.setProperty("width", ((cnt[k] || 0) / list.length) * 100 + "%");
    prog.append(s);
  }
  box.append(h, prog);
  const ul = el("div", null, { class: "yxr-class-list" });
  for (const r of list) {
    const s = YXR_PROGRESS[r.progress] || [r.progress, "muted"];
    const on = r.id === st.doc.id;
    const it = el("button", null, { type: "button", class: "yxr-class-item" + (on ? " is-on" : "") + (r.progress === "not_started" ? " is-fresh" : ""), "aria-current": on ? "true" : "false" });
    it.append(el("span", ctx.names?.get(r.student_id) || "学员"), r.progress === "not_started" ? el("small", ctx.sugs?.[r.id] ? "AI 草稿待看" : "未开始", { class: "v-muted" }) : el("span", r.progress === "published" ? "已发" : s[0], { class: "yx-dot is-" + (r.progress === "published" ? "ok" : r.progress === "ready" ? "warn" : "muted") }));
    it.addEventListener("click", () => !on && ctx.go?.(list.indexOf(r)));
    ul.append(it);
  }
  box.append(ul);
  const fresh = list.filter((r) => r.progress === "not_started" && !ctx.sugs?.[r.id]);
  if (fresh.length && yxrCanWrite() && (enabled("ai", "use") || yxIsTeacher())) {
    const foot = el("div", null, { class: "yxr-class-foot" });
    foot.append(
      yxAiButton("为未开始的 " + fresh.length + " 人起草", async () => {
        const res = await yxAi("report/batch-draft", { batch_id: b.id, student_ids: fresh.slice(0, 100).map((r) => r.student_id) });
        for (const sg of res.suggestions) ctx.sugs[sg.target.report_id] = sg;
        const skipped = res.skipped?.length ? "，" + res.skipped.length + " 位没处理" : "";
        notice("AI 已起草 " + (res.processed?.length || 0) + " 位" + skipped + "。打开每份报告查看，填入后才写进报告。", "success");
        const mine = ctx.sugs[st.doc.id];
        if (mine) yxrTakeSug(st, mine);
        rerender();
      }, "primary"),
      el("p", "起草只填进编辑框下方的建议，不会自动发布。每份都要老师确认。", { class: "v-muted" }),
    );
    box.append(foot);
  }
  return box;
}
async function yxrReloadBatch(st, ctx, rerender) {
  if (ctx.batch) {
    const l = await api("report-batches?limit=200").catch(() => null);
    const nb = l?.items?.find((x) => x.id === ctx.batch.id);
    if (nb) ctx.batch = nb;
  }
  rerender();
}
// 把一条 AI 建议拆进各段文字的建议框
function yxrTakeSug(st, sg) {
  st.sugText ||= {};
  const t = sg.payload?.texts || {};
  for (const k of Object.keys(t)) if (t[k] != null && (Array.isArray(t[k]) ? t[k].length : String(t[k]).trim())) st.sugText[k] = { value: t[k], sg };
}
async function yxrReason(title) {
  return new Promise((done) => {
    const { panel, close } = drawer(title),
      form = el("form");
    field(form, title, "reason", "text", "");
    submit(form, "确定", async (d) => {
      if (!d.reason.trim()) throw Error("请填写原因");
      await close();
      done(d.reason.trim());
    });
    panel.append(form);
  });
}
function yxrCheck(items, doc) {
  const names = Object.fromEntries(YXR_TEXTS.map(([k, t]) => [k, t.replace(/（.*）/, "")]));
  const { panel } = drawer("还差这些才能完成");
  const ul = el("ul", null, { class: "yxp-checks" });
  for (const x of items) ul.append(el("li", String(x).replace(/文字未填：(\w+)/, (_, k) => "还没写：" + (names[k] || k))));
  panel.append(ul);
  void doc;
}
function yxrForm(left, st, ro, mark, rerender) {
  const doc = st.doc;
  const card = (t, sub, extra) => {
    const s = el("section", null, { class: "yxe-card" });
    const h = el("div", null, { class: "yxe-card-h" });
    h.append(el("h3", t));
    if (sub) h.append(el("small", sub, { class: "v-muted" }));
    if (extra) h.append(el("span", null, { class: "v-spacer" }), ...extra);
    s.append(h);
    left.append(s);
    return s;
  };
  // 本期概况：数字来自课表和销课记录，可以手动改
  const keys = Object.keys(doc.stats || {});
  if (keys.length) {
    const s = card("本期概况", "从课表和销课记录读取，可以手动改", ro ? null : [button("刷新 CRM 数字", () => st.refreshCrm?.())]);
    const g = el("div", null, { class: "yxe-stats" });
    for (const k of keys) {
      const v = doc.stats[k],
        [name, unit] = YXR_STATS[k] || [k.replace(/^manual_/, ""), ""];
      const lab = el("label", null, { class: "yxe-stat" });
      const box = el("span", null, { class: "yxe-statbox" });
      const inp = el("input", null, { type: "number", min: "0", step: "1", value: v.value ?? "", "aria-label": name + (unit ? "（" + unit + "）" : "") });
      inp.disabled = ro || YXR_FIXED.has(k);
      const tag = el("span", "", { class: "yxe-src" });
      const upd = () => {
        const manual = v.crm_value != null && v.value !== v.crm_value;
        tag.textContent = YXR_FIXED.has(k) ? "自动计算" : manual ? "已手动改 · 原 " + v.crm_value : v.source === "crm" || v.crm_value != null ? "CRM" : "手填";
        tag.classList.toggle("is-manual", manual);
        box.classList.toggle("is-manual", manual);
      };
      inp.addEventListener("input", () => {
        v.value = inp.value === "" ? null : Number(inp.value);
        st.stats[k] = v.value;
        upd();
        mark();
      });
      upd();
      box.append(inp, tag);
      lab.append(el("span", name), box);
      g.append(lab);
    }
    s.append(g);
  }
  // 老师打分：圆点 1–5，显示上期与变化
  const noScore = ro || !yxrCanScore();
  const s2 = card("老师打分", "1–5 分 · 维度来自机构设置 · 只由老师打");
  if (!ro && noScore) s2.append(el("small", "打分和模拟考成绩只能由老师本人或教务填写。", { class: "v-muted" }));
  const scores = new Map((doc.scores || []).map((x) => [x.key, x]));
  const tbl = el("div", null, { class: "yxe-scores" });
  const th = el("div", null, { class: "yxe-score is-head" });
  th.append(el("span", "维度"), el("span", "本期"), el("span", "上期"), el("span", ""));
  tbl.append(th);
  for (const d of doc.dimensions_snapshot || []) {
    const cur = scores.get(d.key);
    const row = el("div", null, { class: "yxe-score" });
    const g = el("div", null, { class: "yxe-dots", role: "radiogroup", "aria-label": d.name });
    const delta = el("small", "", { class: "yxe-delta" });
    const paint = () => {
      const v = scores.get(d.key)?.value || 0;
      g.querySelectorAll("button").forEach((y, i) => {
        y.classList.toggle("is-on", i < v);
        y.setAttribute("aria-checked", String(i + 1 === v));
      });
      const pv = cur?.previous;
      delta.textContent = pv == null || !v ? "" : v > pv ? "↑ " + (v - pv) : v < pv ? "↓ " + (pv - v) : "持平";
      delta.className = "yxe-delta" + (pv != null && v > pv ? " is-up" : pv != null && v && v < pv ? " is-down" : "");
    };
    for (let n = 1; n <= 5; n++) {
      const b = el("button", null, { type: "button", role: "radio", "aria-label": d.name + " " + n + " 分" });
      b.disabled = noScore;
      b.addEventListener("click", () => {
        const x = scores.get(d.key) || { key: d.key };
        x.value = n;
        scores.set(d.key, x);
        doc.scores = [...scores.values()].filter((y) => y.value);
        paint();
        mark();
      });
      g.append(b);
    }
    row.append(el("span", d.name), g, el("span", cur?.previous != null ? String(cur.previous) : "—", { class: "v-muted" }), delta);
    tbl.append(row);
    paint();
  }
  s2.append(tbl);
  // 模拟考
  if (doc.options?.mock_exam) {
    const s3 = card("模拟考");
    const draw = () => {
      s3.querySelectorAll(".yxr-mock").forEach((n) => n.remove());
      (doc.mock_exams ||= []).forEach((m, i) => {
        const box = el("div", null, { class: "yxr-mock" });
        const mon = el("input", null, { type: "month", value: m.month || "", "aria-label": "月份" });
        mon.disabled = noScore;
        mon.addEventListener("change", () => ((m.month = mon.value), mark()));
        box.append(mon);
        m.items.forEach((it) => {
          const r = el("div", null, { class: "yxc-row" });
          const sub = el("input", null, { type: "text", value: it.subject, placeholder: "科目", "aria-label": "科目" });
          const sc = el("input", null, { type: "number", value: it.score ?? "", placeholder: "分数", "aria-label": "分数", min: "0" });
          const fu = el("input", null, { type: "number", value: it.full ?? 100, placeholder: "满分", "aria-label": "满分", min: "1" });
          for (const x of [sub, sc, fu]) {
            x.disabled = noScore;
            x.addEventListener("input", () => {
              it.subject = sub.value;
              it.score = sc.value === "" ? null : Number(sc.value);
              it.full = Number(fu.value);
              mark();
            });
          }
          r.append(sub, sc, fu);
          box.append(r);
        });
        if (!noScore)
          box.append(
            button("＋ 科目", () => (m.items.push({ subject: "", score: null, full: 100 }), draw(), mark())),
            button("删除这次", () => (doc.mock_exams.splice(i, 1), draw(), mark())),
          );
        s3.append(box);
      });
    };
    if (!noScore) s3.append(button("＋ 一次模拟考", () => (doc.mock_exams.push({ month: "", items: [{ subject: "", score: null, full: 100 }], image_ids: [] }), draw(), mark())));
    draw();
  }
  // AI 起草：一行操作条，建议出现在每段文字下面
  const canAi = !ro && (enabled("ai", "use") || yxIsTeacher());
  const run = async (fields, instruction, fresh) => {
    if (st.dirty) await yxrSave(st);
    const res = await yxAi("report/draft", { report_id: doc.id, fields, ...(instruction ? { instruction } : {}) }, fresh);
    const w2 = yxAiWarnings(res.warnings);
    st.aiWarn = w2 ? res.warnings : null;
    if (!res.suggestions.length) notice("这次没有可用的建议。先确认本期有已确认的课后反馈。");
    for (const sg of res.suggestions) yxrTakeSug(st, sg);
    rerender();
  };
  if (canAi) {
    const bar = el("div", null, { class: "yxr-aibar" });
    const ask = el("input", null, { type: "text", placeholder: "一句话调整，如“语气再温和一点”", "aria-label": "一句话调整", maxlength: "300" });
    bar.append(
      el("span", "✦", { class: "yxv-ai-logo", "aria-hidden": "true" }),
      yxAiButton("起草四段文字", () => run(YXR_AI_FIELDS), "primary"),
      ask,
      yxAiButton("发送", async () => {
        if (!ask.value.trim()) return notice("先写一句要怎么调整");
        await run(YXR_AI_FIELDS, ask.value.trim(), true);
      }),
    );
    left.append(bar, el("p", "AI 只读这位学员本期已确认的课后反馈和老师打分，每段附反馈原话；不打分、不和其他学员比较。", { class: "v-muted yxr-ainote" }));
    if (st.aiWarn) left.append(yxAiWarnings(st.aiWarn));
  }
  st.aiFilled ||= new Set();
  for (const [k, t, isList] of YXR_TEXTS) {
    const name = t.replace(/（.*）/, "");
    const sug = st.sugText?.[k];
    const filled = st.aiFilled.has(k);
    const extra = [];
    if (filled) {
      const u = st.undo.findLast?.((x) => x.key === k);
      if (u)
        extra.push(
          button("↶ 撤销", () => {
            st.undo = st.undo.filter((x) => x !== u);
            doc.texts[k] = u.text;
            doc.applied_suggestion_ids = u.applied;
            st.aiFilled.delete(k);
            mark();
            rerender();
          }),
        );
    }
    const sec = card(name, isList ? "每行一条" : sug && !doc.texts?.[k] ? "编辑框还空着，下面是 AI 的建议" : "", extra);
    if (filled) sec.querySelector(".yxe-card-h h3").after(el("span", "AI 起草 · 已填入", { class: "yxv-tag is-ai" }));
    const v = doc.texts?.[k];
    const area = yxcArea(isList ? (v || []).join("\n") : v || "", name, (x) => {
      doc.texts[k] = isList ? x.split("\n").map((y) => y.trim()).filter(Boolean) : x;
      if (st.aiFilled.delete(k)) area.classList.remove("yx-ai-filled");
      mark();
    }, ro, isList ? 3 : 3);
    if (filled) area.classList.add("yx-ai-filled");
    sec.append(area);
    if (sug && canAi) {
      const box = el("div", null, { class: "yxr-sug" });
      box.append(el("p", Array.isArray(sug.value) ? sug.value.map((x) => "• " + x).join("\n") : sug.value, { class: "yxc-pre" }));
      const quotes = (sug.sg.basis || []).filter((x) => x.quote || x.text).slice(0, 2);
      if (quotes.length) box.append(el("p", "依据：" + quotes.map((x) => (x.label ? x.label + "「" : "「") + (x.quote || x.text) + "」").join(" · "), { class: "yxr-basis" }));
      const acts = el("div", null, { class: "yxv-row" });
      const fill = button("填入", () => {
        st.undo.push({ key: k, text: yxClone(doc.texts[k] ?? (isList ? [] : "")), applied: [...(doc.applied_suggestion_ids || [])] });
        doc.texts[k] = sug.value;
        doc.applied_suggestion_ids = [...new Set([...(doc.applied_suggestion_ids || []), sug.sg.id])];
        st.aiFilled.add(k);
        delete st.sugText[k];
        mark();
        rerender();
      }, "primary");
      fill.classList.add("yxai-btn");
      acts.append(fill);
      if (YXR_AI_FIELDS.includes(k)) acts.append(yxAiButton("换个说法", () => run([k], null, true)));
      acts.append(button("不要", () => (delete st.sugText[k], rerender())));
      box.append(acts);
      sec.append(box);
    }
  }
  // 作品
  const s5 = card("本阶段作品" + (doc.options?.require_artwork ? "（必填）" : ""));
  const grid = el("div", null, { class: "yxc-imgs" });
  const drawArt = () => {
    grid.replaceChildren();
    (doc.artwork_image_ids || []).forEach((id, i) => {
      const f = el("button", null, { type: "button", class: "yxc-pick", "aria-label": "去掉这张" });
      f.append(el("img", null, { src: yxcMedia(id), alt: "作品", loading: "lazy" }));
      f.disabled = ro;
      f.addEventListener("click", () => (doc.artwork_image_ids.splice(i, 1), drawArt(), mark()));
      grid.append(f);
    });
  };
  drawArt();
  s5.append(grid);
  if (!ro && st.gallery) s5.append(button("＋ 从图库添加", () => yxcPickImage({ gallery: st.gallery }, (id) => ((doc.artwork_image_ids ||= []).push(id), drawArt(), mark()))));
  else if (!ro) s5.append(el("small", "你的账号不能读取机构图库，作品图请让教务添加。", { class: "v-muted" }));
  // 续报
  if (doc.options?.renewal_suggestion) {
    const s6 = card("续报建议", "默认不附");
    const ck = yxsCheck(s6, "在报告末尾附上续报建议", "yxr_renew", doc.renewal?.visible);
    ck.disabled = ro;
    ck.addEventListener("change", () => ((doc.renewal = { ...(doc.renewal || {}), visible: ck.checked }), mark()));
    s6.append(yxcArea(doc.renewal?.text || "", "续报建议", (x) => ((doc.renewal = { ...(doc.renewal || {}), text: x }), mark()), ro, 2));
  }
}
async function yxrSave(st) {
  const d = st.doc;
  const body = {
    version: d.version,
    ...(yxrCanScore() ? { scores: (d.scores || []).filter((x) => x.value).map((x) => ({ key: x.key, value: x.value })), mock_exams: (d.mock_exams || []).filter((m) => m.month) } : {}),
    texts: d.texts,
    artwork_image_ids: d.artwork_image_ids || [],
    renewal: d.renewal || { visible: false, text: "" },
    applied_suggestion_ids: d.applied_suggestion_ids || [],
  };
  if (Object.keys(st.stats).length) body.stats = Object.fromEntries(Object.entries(st.stats).map(([k, v]) => [k, { value: v }]));
  try {
    st.doc = await api("reports/" + encodeURIComponent(d.id), "PUT", body);
    // feedback_count 只在 GET 里返回（只读），保存后沿用原值。
    if (st.doc.feedback_count == null && d.feedback_count != null) st.doc.feedback_count = d.feedback_count;
    st.dirty = false;
    st.stats = {};
    st.undo = [];
    notice("已保存", "success");
  } catch (e) {
    if (e.code !== "version_conflict") throw e;
    if (await UI.confirm({ title: "报告已被别人修改", consequence: "要载入最新内容吗？你这次的修改会丢失。" })) {
      st.doc = e.details?.latest || (await api("reports/" + encodeURIComponent(d.id)));
      st.dirty = false;
      st.stats = {};
    }
    throw Error("没有保存");
  }
}
// ---------- 报告排版（编辑器预览、家长端共用） ----------
function yxReportDocument(rd, manifest, mediaUrl) {
  const tok = manifest?.tokens?.color || {};
  const variant = String(manifest?.components?.["report.header"] || "band").replace(/[^a-z]/g, "");
  const page = el("article", null, { class: "yxr-doc yxrd is-" + variant });
  const primary = (tok.use_tenant_primary !== false && /^#[0-9a-f]{6}$/i.test(rd.brand?.primary_color || "") && rd.brand.primary_color) || (/^#[0-9a-f]{6}$/i.test(tok.primary || "") ? tok.primary : "#16a394");
  page.style.setProperty("--yxr-primary", primary);
  // 主色太浅时，标题、小字改用深色字（对比度不低于 4.5）
  page.style.setProperty("--yxr-on-primary", yxdContrast("#ffffff", primary) >= 4.5 ? "#ffffff" : "#211a30");
  page.style.setProperty("--yxr-accent-text", yxdContrast(primary, "#ffffff") >= 3 ? primary : "#211a30");
  const from = String(rd.period?.from || ""),
    to = String(rd.period?.to || "");
  const m = Number(from.slice(5, 7));
  const term = !m ? "Growth Report" : (m >= 8 || m <= 1 ? "Autumn Term" : m <= 6 ? "Spring Term" : "Summer Term") + " · " + from.slice(0, 4);
  // 头部：有头图就用照片头图，否则用主色带
  const head = el("div", null, { class: "yxrd-head" });
  const img = rd.style?.header_image_id && mediaUrl ? el("img", null, { src: mediaUrl(rd.style.header_image_id), alt: "", class: "yxrd-photo" }) : null;
  if (img && variant === "photo") head.append(img);
  else head.classList.add("is-band");
  const logo = el("span", null, { class: "yxrd-logo" });
  if (rd.brand?.logo) logo.append(el("img", null, { src: rd.brand.logo, alt: rd.brand?.name || "" }));
  else logo.textContent = rd.brand?.name || "";
  head.append(logo);
  const box = el("div", null, { class: "yxrd-title" });
  box.append(el("p", term, { class: "yxrd-latin" }), el("h2", (rd.student?.nickname || "") + "的" + (rd.title ? rd.title.replace(/(成长)?报告$/, "") : "") + "成长报告"), el("p", [rd.teacher?.name, from.replaceAll("-", ".") + " – " + to.replaceAll("-", ".")].filter(Boolean).join(" · "), { class: "yxrd-meta" }));
  head.append(box);
  const stats = Object.entries(rd.stats || {}).filter(([, v]) => v.value != null);
  if (stats.length) {
    const row = el("div", null, { class: "yxrd-stats" });
    for (const [k, v] of stats) {
      const [name] = YXR_STATS[k] || [k.replace(/^manual_/, ""), ""];
      const s = el("div");
      s.append(el("b", String(v.value), { class: "yxd-num" }), el("span", name));
      row.append(s);
    }
    head.append(row);
  }
  page.append(head);
  const sec = (latin, title) => {
    const s = el("section", null, { class: "yxrd-sec" });
    s.append(el("p", latin, { class: "yxrd-eyebrow" }), el("h3", title));
    page.append(s);
    return s;
  };
  // 老师打分：雷达图（含上期虚线）+ 进步标签
  const scores = new Map((rd.scores || []).map((x) => [x.key, x]));
  const scored = (rd.dimensions_snapshot || []).filter((d) => scores.get(d.key)?.value);
  if (scored.length) {
    const s = sec("Teacher's Rating", "老师打分");
    const cmp = rd.options?.compare_previous !== false;
    if (scored.length >= 3) {
      s.append(yxrRadar(scored, scores, cmp));
      if (cmp && scored.some((d) => scores.get(d.key).previous != null)) {
        const lg = el("p", null, { class: "yxrd-legend" });
        lg.append(el("i", null, { class: "is-now" }), "本期", el("i", null, { class: "is-prev" }), "上期");
        s.append(lg);
      }
    } else {
      const g = el("div", null, { class: "yxrd-bars" });
      for (const d of scored) {
        const r = el("div");
        r.append(el("span", d.name), el("b", "●".repeat(scores.get(d.key).value) + "○".repeat(5 - scores.get(d.key).value), { "aria-label": scores.get(d.key).value + " 分" }));
        g.append(r);
      }
      s.append(g);
    }
    if (cmp) {
      const up = scored.filter((d) => scores.get(d.key).previous != null && scores.get(d.key).value > scores.get(d.key).previous);
      if (up.length) {
        const chips = el("div", null, { class: "yxrd-chips" });
        for (const d of up) chips.append(el("span", d.name + " " + scores.get(d.key).previous + " → " + scores.get(d.key).value));
        s.append(chips);
      }
    }
    s.append(el("p", "每项 1–5 分，由老师评定；只和" + (rd.student?.nickname || "自己") + "自己上一期比较。", { class: "yxrd-note" }));
  }
  // 模拟考：表格
  if (rd.mock_exams?.length) {
    const s = sec("Mock Exams", "模拟考成绩");
    const subs = [...new Set(rd.mock_exams.flatMap((x) => x.items.map((i) => i.subject)))];
    const t = el("table", null, { class: "yxrd-table" });
    const hr = el("tr");
    for (const x of ["月份", ...subs, "总分"]) hr.append(el("th", x));
    t.append(hr);
    for (const mx of rd.mock_exams) {
      const tr = el("tr");
      tr.append(el("td", Number(String(mx.month).slice(5, 7)) + " 月"));
      for (const sub of subs) tr.append(el("td", String(mx.items.find((i) => i.subject === sub)?.score ?? "—")));
      tr.append(el("td", String(mx.items.reduce((a, i) => a + (Number(i.score) || 0), 0)), { class: "is-total" }));
      t.append(tr);
    }
    s.append(t);
    const imgs = rd.mock_exams.flatMap((x) => x.image_ids || []);
    if (imgs.length && mediaUrl) {
      const g = el("div", null, { class: "yxrd-imgs" });
      for (const id of imgs.slice(0, 6)) g.append(el("img", null, { src: mediaUrl(id), alt: "模拟考试卷", loading: "lazy" }));
      s.append(g);
    }
  }
  const tx = rd.texts || {};
  const textSec = (k, latin, title) => {
    if (!tx[k]) return;
    const s = sec(latin, title);
    s.append(el("p", tx[k], { class: "yxrd-text" }));
  };
  const listSec = (s, k, title) => {
    const v = tx[k];
    if (!v?.length) return;
    const b = el("div", null, { class: "yxrd-box" });
    b.append(el("strong", title));
    const ul = el("ul");
    for (const x of Array.isArray(v) ? v : [v]) ul.append(el("li", x));
    b.append(ul);
    s.append(b);
  };
  textSec("progress", "Progress", "这学期的进步");
  if (tx.focus) {
    const s = sec("Next Focus", "还需要加强");
    const parts = String(tx.focus).split(/\n+/).filter(Boolean);
    if (parts.length > 1) {
      const ul = el("ul", null, { class: "yxrd-list" });
      for (const x of parts) ul.append(el("li", x));
      s.append(ul);
    } else s.append(el("p", tx.focus, { class: "yxrd-text" }));
  }
  if (rd.artwork_image_ids?.length && mediaUrl) {
    const s = sec("Works", "本阶段作品与课堂照片");
    const g = el("div", null, { class: "yxrd-imgs" });
    for (const id of rd.artwork_image_ids) g.append(el("img", null, { src: mediaUrl(id), alt: "作品", loading: "lazy" }));
    s.append(g);
  }
  if (tx.next_goals?.length || tx.home_practice?.length) {
    const s = sec("Next Term", "下阶段目标与在家练习");
    listSec(s, "next_goals", "下阶段目标");
    listSec(s, "home_practice", "在家怎么练");
  }
  if (tx.teacher_note) {
    const s = sec("From the Teacher", "老师寄语");
    const q = el("blockquote", null, { class: "yxrd-quote" });
    q.append(el("p", tx.teacher_note));
    if (rd.teacher?.name) q.append(el("cite", "—— " + rd.teacher.name));
    s.append(q);
  }
  if (rd.renewal?.visible && rd.renewal.text) page.append(el("p", rd.renewal.text, { class: "yxr-renew" }));
  const foot = el("div", null, { class: "yxrd-foot" });
  foot.append(el("span", (rd.brand?.name || "") + (rd.published_at ? " · " + String(rd.published_at).slice(0, 10).replaceAll("-", ".") : "")));
  page.append(foot);
  return page;
}

// 雷达图（设计稿 v3）：本期实线、上期虚线；SVG 用 DOM 生成，颜色由样式表控制。
function yxrRadar(dims, scores, cmp = true) {
  const NS = "http://www.w3.org/2000/svg",
    n = dims.length,
    R = 88,
    cx = 150,
    cy = 125;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 300 250");
  svg.setAttribute("class", "yxr-radar");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", dims.map((d) => d.name + " " + scores.get(d.key).value + " 分").join("，"));
  const pt = (i, r) => [cx + r * Math.sin((2 * Math.PI * i) / n), cy - r * Math.cos((2 * Math.PI * i) / n)];
  const poly = (pts, cls) => {
    const p = document.createElementNS(NS, "polygon");
    p.setAttribute("points", pts.map((x) => x.join(",")).join(" "));
    p.setAttribute("class", cls);
    svg.append(p);
  };
  for (const k of [1, 0.8, 0.6, 0.4, 0.2]) poly(dims.map((_, i) => pt(i, R * k)), "is-grid");
  dims.forEach((_, i) => {
    const l = document.createElementNS(NS, "line");
    const [x, y] = pt(i, R);
    l.setAttribute("x1", String(cx));
    l.setAttribute("y1", String(cy));
    l.setAttribute("x2", String(x));
    l.setAttribute("y2", String(y));
    l.setAttribute("class", "is-axis");
    svg.append(l);
  });
  if (cmp && dims.every((d) => scores.get(d.key).previous != null)) poly(dims.map((d, i) => pt(i, (R * scores.get(d.key).previous) / 5)), "is-prev");
  const now = dims.map((d, i) => pt(i, (R * scores.get(d.key).value) / 5));
  poly(now, "is-val");
  for (const [x, y] of now) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", String(x));
    c.setAttribute("cy", String(y));
    c.setAttribute("r", "3");
    c.setAttribute("class", "is-dot");
    svg.append(c);
  }
  dims.forEach((d, i) => {
    const [x, y] = pt(i, R + 16);
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(y + 4));
    t.setAttribute("text-anchor", Math.abs(x - cx) < 4 ? "middle" : x > cx ? "start" : "end");
    t.textContent = d.name;
    svg.append(t);
  });
  return svg;
}
