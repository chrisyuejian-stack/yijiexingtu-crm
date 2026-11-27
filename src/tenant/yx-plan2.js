// 学员方案 v2 编辑器（v0.5，doc_version=2）：11 个版块、自由课程/老师、模版库、长输入框 AI 卡组。
// 约定见《v0.5 doc_v2 字段表与接口约定》。系统数据只做“一键带入”的辅助，不做限制；金额只由服务器计算。
const YXP2_MODS = { basic: "基本信息", assessment: "学员测评", strategy: "学习 / 申请策略", path: "学习路径", timeline: "关键节点时间线", courses: "课程计划", teachers: "师资", fees: "费用与缴费", goals: "目标院校 / 目标", photos: "附加照片页", about: "机构介绍" };
const YXP2_TL = { grade_exam: "考级", competition: "比赛", art_exam: "艺考", application_deadline: "申请截止", performance: "演出", other: "其他" };
const YXP2_BILL = { per_unit: ["units", "课时"], per_term: ["terms", "期"], per_semester: ["semesters", "学期"], per_month: ["months", "个月"], package: ["packages", "包"] };
const YXP2_DOCKEYS = ["doc_version", "student_id", "source_lead_id", "subject", "title", "style", "meta", "module_order", "modules"];
const YXP2_READONLY = ["id", "version", "status", "current_revision_id", "sent_revision_id", "signed_revision_id", "updated_at", "updated_by", "party", "party_name", "stored_doc_version", "converted_from", "brief", "warnings", "reference", "id_map", "computed", "applied_suggestion_ids"];
const yxp2Money = (v) => (v == null ? "—" : "¥" + Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
const yxp2Tmp = (p) => "tmp_" + p + "_" + Math.random().toString(36).slice(2, 9);
const yxp2Media = (id) => (id ? base + "api/gallery/" + encodeURIComponent(id) + "/file" : null);

// 只取业务 doc（去掉元信息和只读字段），用于 PUT / quote-preview / AI 本地候选
function yxp2Body(doc) {
  const out = {};
  for (const k of YXP2_DOCKEYS) if (k in doc) out[k] = doc[k];
  return yxClone(out);
}

async function yxp2Open(st) {
  st.v2 = true;
  st.priceRev = st.doc.price_list_rev ?? null;
  st.brief = await api("plans/" + encodeURIComponent(st.doc.id) + "/brief")
    .then((r) => r.brief)
    .catch(() => ({ version: 0, text: "", updated_at: null }));
  st.briefText = st.brief?.text || "";
  const [prof, br] = await Promise.all([api("settings/profile").catch(() => null), api("settings/brand").catch(() => null)]);
  st.profile = prof?.profile || prof || null;
  st.brandQr = br?.brand?.qr_image_id || br?.qr_image_id || null;
  st.cards = null;
}

// 编辑后 0.8 秒：服务器试算（不写库、不扣次数），金额和分期实时更新
function yxp2CancelQuote(st) {
  clearTimeout(st.qTimer);
  st.qSeq = (st.qSeq || 0) + 1;
}
function yxp2QuoteSoon(st, redraw) {
  yxp2CancelQuote(st);
  const seq = st.qSeq;
  st.qTimer = setTimeout(async () => {
    const version = st.doc.version;
    try {
      const r = await api("plans/" + encodeURIComponent(st.doc.id) + "/quote-preview", "POST", { version, doc: yxp2Body(st.doc), ...(st.priceRev != null ? { expected_price_list_rev: st.priceRev } : {}) });
      if (seq !== st.qSeq || version !== st.doc.version || st.closed) return;
      st.doc.computed = r.computed;
      st.priceRev = r.price_list_rev;
      st.quoteWarn = r.warnings || [];
      redraw();
    } catch {}
  }, 800);
}

function yxp2Accept(st, r) {
  st.doc = { ...st.doc, ...r };
  st.priceRev = r.price_list_rev ?? st.priceRev;
}
function yxp2InstallmentError(doc) {
  const f = doc.modules.fees;
  if (f.installments !== "custom") return null;
  if (!f.custom.length || f.custom.some(x => !Number.isInteger(x.ratio_bps) || x.ratio_bps <= 0 || x.ratio_bps > 10000)) return "每期比例须大于 0% 且不超过 100%。";
  if (f.custom.reduce((n, x) => n + x.ratio_bps, 0) !== 10000) return "各期比例合计须为 100%。";
  return null;
}
function yxp2DeleteStage(doc, key) {
  const c = doc.modules.courses, f = doc.modules.fees;
  if (c.lines.some(x => x.stage_key === key)) return false;
  c.groups = c.groups.filter(x => x.stage_key !== key);
  c.stage_settings = c.stage_settings.filter(x => x.stage_key !== key);
  if (f.due_dates) delete f.due_dates[key];
  for (const x of [...f.stage_extras, ...f.custom, ...f.fixed]) if (x.stage_key === key) x.stage_key = null;
  return true;
}

function yxp2Render(shell, st, close, rerender) {
  const V = globalThis.ChannelV2,
    doc = st.doc,
    M = doc.modules,
    locked = yxpLocked(doc) || !enabled("plans", "write");
  let timer = 0;
  const mark = () => {
    st.dirty = true;
    saveBtn.disabled = false;
    saved.textContent = "有未保存的修改";
    saved.classList.add("is-dirty");
    clearTimeout(timer);
    timer = setTimeout(drawPreview, 400);
    yxp2QuoteSoon(st, drawPreview);
  };
  st.mark = mark;
  shell.classList.add("yxv-editor", "yxv-plan", "yxp2");
  shell.replaceChildren(yxvRail(close));
  const main = el("div", null, { class: "yxv-main" });
  shell.append(main);
  // 顶栏
  const bar = el("header", null, { class: "yxp-bar yxv-bar" });
  const crumbs = el("nav", null, { class: "yxv-crumbs", "aria-label": "位置" });
  const back = button("‹ 返回", close);
  back.classList.add("yxv-back");
  crumbs.append(back);
  for (const x of [V.link("招生", close), el("span", "›", { "aria-hidden": "true" }), V.link("学员方案", close), el("span", "›", { "aria-hidden": "true" })]) {
    x.classList.add("yxv-crumb");
    crumbs.append(x);
  }
  const title = el("input", null, { type: "text", class: "yxv-title-input", "aria-label": "方案标题", value: doc.title || "", maxlength: "200", placeholder: "未命名方案" });
  title.disabled = locked;
  title.addEventListener("input", () => ((doc.title = title.value), mark()));
  crumbs.append(title);
  const s = YXP_STATUS[doc.status] || [doc.status, "muted"];
  const who0 = st.student?.name || (st.partyName ? st.partyName + (st.party === "lead" ? "（线索）" : "（意向）") : "");
  const canConvert = !doc.student_id && enabled("plans", "write") && enabled("students", "create");
  const saved = el("span", st.dirty ? "有未保存的修改" : [who0, doc.updated_at ? "已保存 " + String(doc.updated_at).slice(11, 16) : ""].filter(Boolean).join(" · "), { class: "yxv-saved" + (st.dirty ? " is-dirty" : "") });
  const saveBtn = button("保存", () => yxp2Save(st, rerender));
  saveBtn.disabled = !st.dirty;
  const check = button(st.checkCount ? "检查 · " + st.checkCount + " 项" : "检查", () => yxpCheck(st));
  if (st.checkCount) check.classList.add("yxv-warn-btn");
  const capT = me?.capabilities?.plan_templates || {};
  const more = UI.actionMenu({
    label: "更多",
    items: [
      ...(!locked ? [{ label: "整体平移日期", onSelect: () => yxp2Shift(st, rerender) }] : []),
      ...(capT.write !== false && enabled("plans", "write") ? [{ label: "存为本机构模版", onSelect: () => yxp2SaveTemplate(st) }] : []),
      ...(enabled("plans", "write") && doc.reference ? [{ label: doc.reference.enabled ? "取消“优秀方案”" : "标为优秀方案（供 AI 参考）", onSelect: () => yxp2Reference(st, rerender) }] : []),
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
  // 中间 A4 预览
  const strip = el("div", null, { class: "yxv-insert yxp-strip" });
  const pagesBox = el("div", null, { class: "yxp-pages" });
  mid.append(strip, pagesBox);
  const drawPreview = () => {
    const d = yxPlanDocument2(yxp2PreviewData(st), yxpManifest(st), yxp2Media);
    pagesBox.replaceChildren(d);
    d.addEventListener("yxd-paged", () => thumbs(d));
  };
  const thumbs = (d) => {
    const pages = [...d.querySelectorAll(".yxp-page")];
    strip.replaceChildren(el("span", "A4 · 共 " + pages.length + " 页", { class: "v-muted" }));
    pages.forEach((p, i) => {
      const b = el("button", String(i + 1), { type: "button", class: "yxp-thumb", "aria-label": "第 " + (i + 1) + " 页" });
      b.addEventListener("click", () => p.scrollIntoView({ behavior: "smooth", block: "start" }));
      strip.append(b);
    });
  };
  // 左栏：内容 / 样式
  const tabs = el("div", null, { class: "yxv-seg yxv-seg-full", role: "tablist" });
  for (const [k, t] of [["content", "内容"], ["style", "样式"]]) {
    const b = el("button", t, { type: "button", role: "tab", "aria-selected": String((st.tab || "content") === k), "aria-pressed": String((st.tab || "content") === k) });
    b.addEventListener("click", () => ((st.tab = k), rerender()));
    tabs.append(b);
  }
  left.append(tabs);
  if ((st.tab || "content") === "style") yxpStyleTab(left, st, locked, mark, rerender);
  else yxp2Modules(left, st, locked, mark, rerender);
  yxp2Ai(right, st, locked, mark, rerender);
  drawPreview();
}

// ---------- 左栏：11 个版块（手风琴，一次展开一个；可改标题、显示/隐藏、调整顺序）----------
function yxp2Kit(locked, mark) {
  const inp = (parent, label, value, on, type = "text", attrs = {}) => {
    const w = el("label", label, { class: "yxp-field" }),
      i = type === "textarea" ? el("textarea", null, { rows: attrs.rows || "3", ...attrs }) : el("input", null, { type, ...attrs });
    i.value = value ?? "";
    i.disabled = locked;
    i.addEventListener(type === "date" || type === "month" ? "change" : "input", () => (on(i.value), mark()));
    w.append(i);
    parent.append(w);
    return i;
  };
  const num = (parent, label, value, on, attrs = {}) => inp(parent, label, value ?? "", (v) => on(v === "" ? null : Number(v)), "number", { step: "any", min: "0", ...attrs });
  const sel = (parent, label, value, opts, on) => {
    const w = el("label", label, { class: "yxp-field" }),
      s = el("select");
    for (const [k, t] of opts) s.append(el("option", t, { value: k }));
    s.value = value ?? "";
    s.disabled = locked;
    s.addEventListener("change", () => (on(s.value), mark()));
    w.append(s);
    parent.append(w);
    return s;
  };
  const chk = (parent, label, value, on) => {
    const w = el("label", null, { class: "yxp2-check" }),
      c = el("input", null, { type: "checkbox" });
    c.checked = !!value;
    c.disabled = locked;
    c.addEventListener("change", () => (on(c.checked), mark()));
    w.append(c, label);
    parent.append(w);
    return c;
  };
  const grid = (parent) => {
    const g = el("div", null, { class: "yxp-grid" });
    parent.append(g);
    return g;
  };
  // 一行小操作：上移 / 下移 / 删除
  const ops = (arr, i, rerender, extra = [], beforeDelete = () => true) => {
    const r = el("div", null, { class: "yxp2-ops" });
    if (locked) return r;
    const go = (fn) => () => {
      if (fn() !== false) { mark(); rerender(); }
    };
    r.append(
      ...extra,
      button("↑", go(() => i > 0 && ([arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]))),
      button("↓", go(() => i < arr.length - 1 && ([arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]))),
      button("删除", go(() => beforeDelete() !== false && arr.splice(i, 1))),
    );
    return r;
  };
  const lines = (parent, label, arr, set) => inp(parent, label + "（每行一条）", (arr || []).join("\n"), (v) => set(v.split("\n").map((x) => x.trim()).filter(Boolean)), "textarea");
  return { inp, num, sel, chk, grid, ops, lines };
}

function yxp2Modules(left, st, locked, mark, rerender) {
  const doc = st.doc,
    M = doc.modules,
    K = yxp2Kit(locked, mark),
    C = doc.computed || {};
  const en = !!M.basic.english_enabled;
  st.open ||= "basic";
  const summary = {
    basic: () => [M.basic.student_name, M.basic.grade, M.basic.direction].filter(Boolean).join(" · ") || "还没填",
    assessment: () => (M.assessment.text ? M.assessment.text.replace(/\*\*/g, "").slice(0, 18) + "…" : "还没填"),
    strategy: () => (M.strategy.text ? "已填写" : "还没填"),
    path: () => (M.path.stages.length ? M.path.stages.length + " 个阶段" : "还没排阶段"),
    timeline: () => (M.timeline.items.length ? M.timeline.items.length + " 个节点" : "还没加节点"),
    courses: () => (M.courses.lines.length ? M.courses.lines.length + " 门课 · " + (C.total?.units ?? C.total?.known_units ?? 0) + " 课时" : "还没配课"),
    teachers: () => (M.teachers.groups.reduce((n, g) => n + g.members.length, 0) || "还没加") + (M.teachers.groups.length ? " 位老师" : ""),
    fees: () => (C.total ? (C.total.amount != null ? yxp2Money(C.total.amount) : "已确定 " + yxp2Money(C.total.known_amount) + (C.total.has_tbd ? " + 另议" : " · 待报价")) : "—"),
    goals: () => (M.goals.groups.reduce((n, g) => n + g.items.length, 0) || "还没加") + (M.goals.groups.length ? " 项" : ""),
    photos: () => (M.photos.pages.length ? M.photos.pages.length + " 页" : "没有照片页"),
    about: () => (M.about.text == null ? "使用机构档案" : "自定义文字"),
  };
  doc.module_order.forEach((key, idx) => {
    const mod = M[key],
      open = st.open === key;
    const box = el("section", null, { class: "yxp-acc" + (open ? " is-open" : "") + (mod.visible === false ? " is-hidden" : "") });
    const head = el("div", null, { class: "yxp-acc-head" });
    const tgl = el("button", null, { type: "button", class: "yxp-acc-btn", "aria-expanded": String(open) });
    tgl.append(el("span", String(idx + 1), { class: "yx-num" }), el("strong", ("title" in mod && mod.title) || YXP2_MODS[key]), el("span", mod.visible === false ? "不显示" : summary[key](), { class: "v-muted" }));
    tgl.addEventListener("click", () => ((st.open = open ? "" : key), rerender()));
    head.append(tgl);
    const eye = el("button", null, { type: "button", class: "yxp-eye", "aria-pressed": String(mod.visible !== false), "aria-label": (mod.visible === false ? "给家长显示" : "不给家长显示") + "：" + YXP2_MODS[key], title: mod.visible === false ? "家长看不到，点一下显示" : "家长能看到，点一下隐藏" });
    eye.append(UI.icon("eye"));
    eye.disabled = locked;
    eye.addEventListener("click", () => ((mod.visible = mod.visible === false), mark(), rerender()));
    head.append(eye);
    box.append(head);
    if (open) {
      const b = el("div", null, { class: "yxp-acc-body" });
      if (!locked) {
        const row = el("div", null, { class: "yxp2-modbar" });
        if ("title" in mod) K.inp(row, "版块标题（家长看到的）", mod.title, (v) => (mod.title = v), "text", { maxlength: "80", placeholder: YXP2_MODS[key] });
        const mv = (d) => () => {
          const o = doc.module_order,
            j = idx + d;
          if (j < 0 || j >= o.length) return;
          [o[idx], o[j]] = [o[j], o[idx]];
          mark();
          rerender();
        };
        const r2 = el("div", null, { class: "yxp2-ops" });
        r2.append(el("span", "版块顺序", { class: "v-muted" }), button("上移", mv(-1)), button("下移", mv(1)));
        row.append(r2);
        b.append(row);
      }
      yxp2Mod[key](b, st, K, locked, mark, rerender, en);
      box.append(b);
    }
    left.append(box);
  });
}

const yxp2Mod = {
  basic(b, st, K, locked, mark, rerender) {
    const m = st.doc.modules.basic,
      g = K.grid(b);
    K.inp(g, "学员姓名", m.student_name, (v) => (m.student_name = v), "text", { maxlength: "100" });
    K.inp(g, "年级", m.grade, (v) => (m.grade = v), "text", { maxlength: "100" });
    K.inp(g, "方案日期", m.plan_date || "", (v) => (m.plan_date = v || null), "date");
    K.inp(g, "专业方向", m.direction, (v) => (m.direction = v), "text", { maxlength: "200" });
    if (m.english_enabled) K.inp(b, "英文专业方向", m.direction_en, (v) => (m.direction_en = v), "text", { maxlength: "200" });
    K.chk(b, "显示英文名（专业方向、课程、目标）", m.english_enabled, (v) => ((m.english_enabled = v), rerender()));
    K.chk(b, "要封面", m.cover_visible, (v) => (m.cover_visible = v));
    if (m.cover_visible) {
      K.inp(b, "封面眉题（如 LEARNING PLAN）", m.cover_eyebrow, (v) => (m.cover_eyebrow = v), "text", { maxlength: "200" });
      K.inp(b, "封面副标题", m.cover_subtitle, (v) => (m.cover_subtitle = v), "textarea", { maxlength: "1000", rows: "2" });
    }
    if (!locked && (st.student || st.partyName))
      b.append(
        button("从学员档案带入姓名和年级", () => {
          m.student_name = st.student?.name || st.partyName || m.student_name;
          if (st.student?.grade) m.grade = st.student.grade;
          if (st.student?.direction) m.direction = st.student.direction;
          mark();
          rerender();
        }),
      );
    b.append(el("p", "这里的姓名只用在方案里，不会改学员档案。主图和模版在“样式”里换。", { class: "v-muted" }));
  },
  assessment(b, st, K, locked, mark, rerender) {
    const m = st.doc.modules.assessment;
    K.inp(b, "测评内容（可用 **加粗** 和以 - 开头的列表）", m.text, (v) => (m.text = v), "textarea", { rows: "9", maxlength: "12000" });
    const sc = el("div", null, { class: "yxp2-list" });
    sc.append(el("small", "评分（可选）", { class: "yxv-label" }));
    m.scores.forEach((x, i) => {
      const r = el("div", null, { class: "yxp2-row" });
      K.inp(r, "项目", x.label, (v) => (x.label = v), "text", { maxlength: "50" });
      K.num(r, "分数", x.value, (v) => (x.value = v));
      K.num(r, "满分", x.max, (v) => (x.max = v ?? 5), { min: "1", max: "100" });
      r.append(K.ops(m.scores, i, rerender));
      sc.append(r);
    });
    if (!locked && m.scores.length < 20) sc.append(button("＋ 加一项评分", () => (m.scores.push({ id: yxp2Tmp("sc"), label: "", value: null, max: 5 }), mark(), rerender())));
    b.append(sc);
    K.inp(b, "标签（用逗号分开）", m.tags.join("，"), (v) => (m.tags = v.split(/[,，、]/).map((x) => x.trim()).filter(Boolean).slice(0, 30)));
  },
  strategy(b, st, K) {
    const m = st.doc.modules.strategy;
    K.inp(b, "策略说明（可用 **加粗** 和 - 列表）", m.text, (v) => (m.text = v), "textarea", { rows: "10", maxlength: "12000" });
  },
  path(b, st, K, locked, mark, rerender) {
    const P = st.doc.modules.path,
      C = Object.fromEntries((st.doc.computed?.stages || []).map((x) => [x.key, x]));
    P.stages.forEach((sg, i) => {
      const card = el("div", null, { class: "yxp-stage yxp2-card" });
      const head = el("div", null, { class: "yxp-stage-head" });
      head.append(el("span", "①②③④⑤⑥⑦⑧⑨⑩"[i] || String(i + 1), { class: "yxp-num" }), el("span", C[sg.key]?.months ? C[sg.key].months + " 个月 · " + (C[sg.key].weeks_display ?? "—") + " 周" : "", { class: "v-muted" }));
      head.append(
        K.ops(P.stages, i, rerender, [
          ...(st.types.length && !locked
            ? [
                (() => {
                  const s = el("select", null, { "aria-label": "按机构阶段类型带入", class: "yxp2-mini" });
                  s.append(el("option", "带入阶段类型…", { value: "" }));
                  for (const t of st.types) s.append(el("option", t.name, { value: t.id }));
                  s.addEventListener("change", () => {
                    const t = st.types.find((x) => x.id === s.value);
                    if (!t) return;
                    sg.stage_type_id = t.id;
                    sg.name = sg.name || t.name;
                    if (!sg.goals.length && t.goals?.length) sg.goals = [...t.goals];
                    mark();
                    rerender();
                  });
                  return s;
                })(),
              ]
            : []),
        ], () => {
          if (yxp2DeleteStage(st.doc, sg.key)) return true;
          notice("请先移走或删除该阶段的课程，再删除阶段。");
          return false;
        }),
      );
      card.append(head);
      const g = K.grid(card);
      K.inp(g, "阶段名称", sg.name, (v) => (sg.name = v), "text", { maxlength: "100" });
      K.inp(g, "开始月份", sg.start_month || "", (v) => (sg.start_month = v || null), "month");
      K.inp(g, "结束月份", sg.end_month || "", (v) => (sg.end_month = v || null), "month");
      K.num(g, "教学周数（可空）", sg.teaching_weeks, (v) => (sg.teaching_weeks = v), { min: "1", step: "1" });
      K.inp(g, "教学周数说明（手填周数时必填）", sg.weeks_note, (v) => (sg.weeks_note = v), "text", { maxlength: "500" });
      K.lines(card, "阶段目标", sg.goals, (v) => (sg.goals = v.slice(0, 30)));
      const nd = el("div", null, { class: "yxp2-list" });
      nd.append(el("small", "阶段内的节点（如暑期音乐节、学期汇报）", { class: "yxv-label" }));
      sg.nodes.forEach((x, k) => {
        const r = el("div", null, { class: "yxp2-row" });
        K.inp(r, "日期", x.date || "", (v) => (x.date = v || null), "date");
        K.inp(r, "名称", x.name, (v) => (x.name = v), "text", { maxlength: "200" });
        K.inp(r, "备注", x.note, (v) => (x.note = v), "text", { maxlength: "1000" });
        r.append(K.ops(sg.nodes, k, rerender));
        nd.append(r);
      });
      if (!locked && sg.nodes.length < 50) nd.append(button("＋ 加节点", () => (sg.nodes.push({ id: yxp2Tmp("nd"), date: null, name: "", note: "" }), mark(), rerender())));
      card.append(nd);
      b.append(card);
    });
    if (!locked)
      b.append(
        button("＋ 加阶段", () => {
          const last = P.stages[P.stages.length - 1];
          let sm = last?.end_month ? yxp2AddMonth(last.end_month, 1) : st.doc.meta?.start_month || null;
          P.stages.push({ key: yxp2Tmp("stage"), name: "新阶段", stage_type_id: null, start_month: sm, end_month: null, teaching_weeks: null, weeks_note: "", goals: [], nodes: [], node_tags: [] });
          mark();
          rerender();
        }),
      );
    b.append(el("p", "删除阶段前，先把这一阶段的课程改到别的阶段或删掉。", { class: "v-muted" }));
  },
  timeline(b, st, K, locked, mark, rerender) {
    const T = st.doc.modules.timeline;
    T.items.forEach((x, i) => {
      const card = el("div", null, { class: "yxp2-card" });
      const g = K.grid(card);
      K.inp(g, "日期", x.date || "", (v) => (x.date = v || null), "date");
      K.sel(g, "类型", x.type, Object.entries(YXP2_TL), (v) => (x.type = v));
      K.inp(card, "事件", x.name, (v) => (x.name = v), "text", { maxlength: "200" });
      K.inp(card, "备注", x.note, (v) => (x.note = v), "text", { maxlength: "2000" });
      card.append(K.ops(T.items, i, rerender));
      b.append(card);
    });
    if (!locked) {
      const r = el("div", null, { class: "yxv-btnrow" });
      r.append(button("＋ 加节点", () => (T.items.push({ id: yxp2Tmp("tl"), date: null, name: "", type: "other", note: "", source_key: null }), mark(), rerender())));
      const cal = st.calendar?.items || [];
      if (cal.length) {
        const s = el("select", null, { "aria-label": "从机构节点日历带入", class: "yxp2-mini" });
        s.append(el("option", "从节点日历带入…", { value: "" }));
        for (const c of cal) s.append(el("option", c.name + (c.date ? " · " + c.date : ""), { value: c.key }));
        s.addEventListener("change", () => {
          const c = cal.find((x) => x.key === s.value);
          if (!c) return;
          T.items.push({ id: yxp2Tmp("tl"), date: c.date || null, name: c.name, type: YXP2_TL[c.type] ? c.type : "other", note: "", source_key: c.key });
          mark();
          rerender();
        });
        r.append(s);
      }
      b.append(r);
    }
    b.append(el("p", "考级、比赛、艺考、演出等规划都放在这里。带入后可以随意改，不影响机构日历。", { class: "v-muted" }));
  },
  courses: (...a) => yxp2Courses(...a),
  teachers(b, st, K, locked, mark, rerender) {
    const T = st.doc.modules.teachers;
    T.groups.forEach((g, gi) => {
      const card = el("div", null, { class: "yxp2-card" });
      const h = el("div", null, { class: "yxp2-row" });
      K.inp(h, "角色（如“声乐主专业导师”）", g.role, (v) => (g.role = v), "text", { maxlength: "100" });
      h.append(K.ops(T.groups, gi, rerender));
      card.append(h);
      g.members.forEach((p, pi) => {
        const pc = el("div", null, { class: "yxp2-sub" });
        const r = K.grid(pc);
        K.inp(r, "姓名", p.name, (v) => (p.name = v), "text", { maxlength: "100" });
        K.inp(r, "头衔", p.title, (v) => (p.title = v), "text", { maxlength: "200" });
        K.inp(pc, "介绍", p.introduction, (v) => (p.introduction = v), "textarea", { rows: "4", maxlength: "12000" });
        const tools = el("div", null, { class: "yxp2-ops" });
        if (!locked) {
          tools.append(
            button(p.photo_image_id ? "换照片" : "加照片", () => yxcPickImage({ gallery: st.gallery }, (id) => ((p.photo_image_id = id), mark(), rerender()))),
            ...(p.photo_image_id ? [button("去掉照片", () => ((p.photo_image_id = null), mark(), rerender()))] : []),
          );
        }
        K.chk(tools, "标“拟”", p.proposed, (v) => (p.proposed = v));
        tools.append(K.ops(g.members, pi, rerender));
        pc.append(tools);
        card.append(pc);
      });
      if (!locked && T.groups.reduce((n, x) => n + x.members.length, 0) < 60) {
        const r = el("div", null, { class: "yxv-btnrow" });
        r.append(button("＋ 直接填写一位老师", () => (g.members.push({ id: yxp2Tmp("tm"), teacher_id: null, name: "", title: "", introduction: "", photo_image_id: null, proposed: false }), mark(), rerender())));
        if (st.teachers.length) {
          const s = el("select", null, { "aria-label": "从系统老师带入", class: "yxp2-mini" });
          s.append(el("option", "从系统老师带入…", { value: "" }));
          for (const t of st.teachers) s.append(el("option", t.name, { value: t.id }));
          s.addEventListener("change", () => {
            const t = st.teachers.find((x) => x.id === s.value);
            if (!t) return;
            g.members.push({ id: yxp2Tmp("tm"), teacher_id: t.id, name: t.name, title: t.title || "", introduction: t.bio || t.introduction || "", photo_image_id: null, proposed: false });
            mark();
            rerender();
          });
          r.append(s);
        }
        card.append(r);
      }
      b.append(card);
    });
    if (!locked) b.append(button("＋ 加一组角色", () => (T.groups.push({ id: yxp2Tmp("tg"), role: "", members: [] }), mark(), rerender())));
    b.append(el("p", "系统里没有的老师也可以直接写，不会新建老师账号。带入后的介绍是这份方案自己的文字。", { class: "v-muted" }));
  },
  fees: (...a) => yxp2Fees(...a),
  goals(b, st, K, locked, mark, rerender, en) {
    const G = st.doc.modules.goals;
    G.groups.forEach((g, gi) => {
      const card = el("div", null, { class: "yxp2-card" });
      const h = el("div", null, { class: "yxp2-row" });
      K.inp(h, "分组标题（如“英国院校”“考级目标”）", g.title, (v) => (g.title = v), "text", { maxlength: "100" });
      h.append(K.ops(G.groups, gi, rerender));
      card.append(h);
      g.items.forEach((x, k) => {
        const r = el("div", null, { class: "yxp2-sub" });
        const gg = K.grid(r);
        K.inp(gg, "名称", x.name, (v) => (x.name = v), "text", { maxlength: "200" });
        if (en) K.inp(gg, "英文名", x.name_en, (v) => (x.name_en = v), "text", { maxlength: "200" });
        K.inp(gg, "档次（冲刺 / 主申 / 保底…）", x.tier, (v) => (x.tier = v), "text", { maxlength: "50" });
        K.inp(r, "备注", x.note, (v) => (x.note = v), "text", { maxlength: "2000" });
        r.append(K.ops(g.items, k, rerender));
        card.append(r);
      });
      if (!locked && g.items.length < 100) card.append(button("＋ 加一项", () => (g.items.push({ id: yxp2Tmp("gl"), name: "", name_en: "", tier: "", note: "" }), mark(), rerender())));
      b.append(card);
    });
    if (!locked && G.groups.length < 30) b.append(button("＋ 加一组", () => (G.groups.push({ id: yxp2Tmp("gg"), title: "", items: [] }), mark(), rerender())));
  },
  photos(b, st, K, locked, mark, rerender) {
    const Ph = st.doc.modules.photos;
    Ph.pages.forEach((p, i) => {
      const card = el("div", null, { class: "yxp2-card" });
      const g = K.grid(card);
      K.inp(g, "页标题", p.title, (v) => (p.title = v), "text", { maxlength: "100" });
      K.sel(g, "排版", p.layout, [["grid_2x3", "2 列（大图）"], ["grid_3x3", "3 列（小图）"]], (v) => ((p.layout = v), rerender()));
      const strip = el("div", null, { class: "yxp2-thumbs" });
      p.image_ids.forEach((id, k) => {
        const t = el("figure");
        t.append(el("img", null, { src: yxp2Media(id), alt: "照片 " + (k + 1) }));
        if (!locked) {
          const x = el("button", "✕", { type: "button", "aria-label": "去掉这张" });
          x.addEventListener("click", () => (p.image_ids.splice(k, 1), mark(), rerender()));
          t.append(x);
        }
        strip.append(t);
      });
      card.append(strip);
      if (!locked && p.image_ids.length < 8) card.append(button("＋ 从图库加照片", () => yxcPickImage({ gallery: st.gallery }, (id) => (p.image_ids.includes(id) ? notice("这张已经在这一页了") : (p.image_ids.push(id), mark(), rerender())))));
      card.append(K.ops(Ph.pages, i, rerender));
      b.append(card);
    });
    if (!locked && Ph.pages.length < 20) b.append(button("＋ 加照片页", () => (Ph.pages.push({ id: yxp2Tmp("pg"), title: "", layout: "grid_2x3", image_ids: [] }), mark(), rerender())));
    b.append(el("p", "校区环境、成果展示、录取通知等，每页最多 8 张。", { class: "v-muted" }));
  },
  about(b, st, K, locked, mark, rerender) {
    const A = st.doc.modules.about;
    K.chk(b, "自己写这一页的文字（不勾选就用机构档案）", A.text != null, (v) => ((A.text = v ? A.text ?? "" : null), rerender()));
    if (A.text != null) K.inp(b, "机构介绍", A.text, (v) => (A.text = v), "textarea", { rows: "6", maxlength: "12000" });
    const strip = el("div", null, { class: "yxp2-thumbs" });
    (A.image_ids || []).forEach((id, k) => {
      const t = el("figure");
      t.append(el("img", null, { src: yxp2Media(id), alt: "图片 " + (k + 1) }));
      if (!locked) {
        const x = el("button", "✕", { type: "button", "aria-label": "去掉这张" });
        x.addEventListener("click", () => (A.image_ids.splice(k, 1), mark(), rerender()));
        t.append(x);
      }
      strip.append(t);
    });
    b.append(strip);
    if (!locked) b.append(button("＋ 从图库加图片", () => yxcPickImage({ gallery: st.gallery }, (id) => ((A.image_ids ||= []).push(id), mark(), rerender()))));
  },
};
function yxp2AddMonth(m, n) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

// 课程计划：按 阶段 → 分组 → 课程 显示；库课程带入价目表价格，自由课程手填单价或标“价格另议”。
function yxp2Courses(b, st, K, locked, mark, rerender, en) {
  const doc = st.doc,
    Cm = doc.modules.courses,
    stages = doc.modules.path.stages,
    CL = Object.fromEntries((doc.computed?.lines || []).map((x) => [x.line_id, x])),
    CS = Object.fromEntries((doc.computed?.stages || []).map((x) => [x.key, x]));
  const setting = (key) => {
    let s = Cm.stage_settings.find((x) => x.stage_key === key);
    if (!s) Cm.stage_settings.push((s = { stage_key: key, pending: false, pending_note: "" }));
    return s;
  };
  const sections = [...stages.map((s) => [s.key, s.name || "未命名阶段"]), [null, stages.length ? "未分阶段" : "课程（还没排阶段，也可以先在“学习路径”里加阶段）"]];
  for (const [key, name] of sections) {
    const lines = Cm.lines.filter((l) => (l.stage_key ?? null) === key);
    const groups = Cm.groups.filter((g) => (g.stage_key ?? null) === key);
    if (key === null && !lines.length && !groups.length && stages.length) continue;
    const sec = el("div", null, { class: "yxp2-card yxp2-csec" });
    const cs = key ? CS[key] : doc.computed?.unassigned;
    const head = el("div", null, { class: "yxp-stage-head" });
    head.append(el("strong", name), el("span", cs ? (cs.units ?? cs.known_units ?? 0) + " 课时 · " + (cs.amount != null ? yxp2Money(cs.amount) : "已确定 " + yxp2Money(cs.known_amount)) : "", { class: "v-muted" }));
    sec.append(head);
    if (key) {
      const sg = setting(key);
      K.chk(sec, "这一阶段课程待定", sg.pending, (v) => ((sg.pending = v), rerender()));
      if (sg.pending) K.inp(sec, "待定说明（家长看到的）", sg.pending_note, (v) => (sg.pending_note = v), "textarea", { rows: "2", maxlength: "2000" });
    }
    const drawLine = (ln) => sec.append(yxp2Line(st, ln, K, locked, mark, rerender, en, CL[ln.line_id], groups));
    const loose = lines.filter((l) => !l.group_id || !groups.some((g) => g.id === l.group_id));
    loose.forEach(drawLine);
    for (const g of groups) {
      const gh = el("div", null, { class: "yxp2-ghead" });
      const gi = el("input", null, { type: "text", value: g.name, placeholder: "分组名（如“基础 / 核心”）", "aria-label": "分组名", maxlength: "100" });
      gi.disabled = locked;
      gi.addEventListener("input", () => ((g.name = gi.value), mark()));
      gh.append(gi);
      if (!locked)
        gh.append(
          button("删分组", () => {
            for (const l of Cm.lines) if (l.group_id === g.id) l.group_id = null;
            Cm.groups = Cm.groups.filter((x) => x !== g);
            mark();
            rerender();
          }),
        );
      sec.append(gh);
      lines.filter((l) => l.group_id === g.id).forEach(drawLine);
    }
    if (!locked) {
      const add = el("div", null, { class: "yxv-btnrow yxp2-add" });
      const pick = el("select", null, { "aria-label": "从课程库加课", class: "yxp2-mini" });
      pick.append(el("option", "＋ 从课程库加课…", { value: "" }));
      for (const c of st.courses.filter((c) => c.active)) pick.append(el("option", (c.optional ? "[可选] " : "") + c.name + (c.pricing ? " · " + yxsPrice(c.pricing) : " · 未定价"), { value: c.id }));
      pick.addEventListener("change", () => {
        const c = st.courses.find((x) => x.id === pick.value);
        if (!c) return;
        const mode = c.pricing?.mode || "per_unit";
        Cm.lines.push({ line_id: yxp2Tmp("ln"), stage_key: key, group_id: groups[groups.length - 1]?.id || null, pricing_source: "catalog", course_id: c.id, origin_course_id: null, name: c.name, name_en: c.name_en || "", frequency_text: c.frequency_text || "", minutes: c.minutes || null, billing_mode: mode, qty: { [YXP2_BILL[mode][0]]: null }, teaching_units: null, manual_unit_price: null, price_tbd: false, units_per_package: null, optional: !!c.optional, note: "", includes: [], ai_filled: false });
        mark();
        rerender();
      });
      add.append(
        pick,
        button("＋ 自由课程", () => {
          Cm.lines.push({ line_id: yxp2Tmp("ln"), stage_key: key, group_id: groups[groups.length - 1]?.id || null, pricing_source: "manual", course_id: null, origin_course_id: null, name: "", name_en: "", frequency_text: "", minutes: null, billing_mode: "per_unit", qty: { units: null }, teaching_units: null, manual_unit_price: null, price_tbd: false, units_per_package: null, optional: false, note: "", includes: [], ai_filled: false });
          mark();
          rerender();
        }),
        button("＋ 分组", () => (Cm.groups.push({ id: yxp2Tmp("grp"), stage_key: key, name: "" }), mark(), rerender())),
      );
      sec.append(add);
    }
    b.append(sec);
  }
  const t = doc.computed?.total;
  if (t) b.append(el("p", "合计 " + (t.units ?? t.known_units ?? 0) + " 课时 · " + (t.amount != null ? yxp2Money(t.amount) : "已确定 " + yxp2Money(t.known_amount) + (t.has_tbd ? " + 另议" : "（还有课程待报价）")), { class: "yxp2-total" }));
  b.append(el("p", "课程库里的课按价目表算；自由课程可以手填单价，或标“价格另议”。金额都由系统计算。", { class: "v-muted" }));
}

function yxp2Line(st, ln, K, locked, mark, rerender, en, cl, groups) {
  const row = el("div", null, { class: "yxp2-line" + (ln.pricing_source === "manual" ? " is-manual" : "") });
  const top = el("div", null, { class: "yxp2-line-top" });
  const nm = el("input", null, { type: "text", value: ln.name, placeholder: "课程名称", "aria-label": "课程名称", maxlength: "200", class: "yxp2-line-name" });
  nm.disabled = locked;
  nm.addEventListener("input", () => ((ln.name = nm.value), mark()));
  top.append(nm);
  const amt = cl?.amount != null ? yxp2Money(cl.amount) : ln.price_tbd ? "另议" : ln.pricing_source === "manual" && ln.manual_unit_price == null ? "待报价" : "";
  top.append(el("span", amt, { class: "yxp2-amt" + (amt === "待报价" ? " is-warn" : "") }));
  if (ln.pricing_source === "manual") top.append(el("span", "非价目表", { class: "yxp2-tag" }));
  if (ln.optional) top.append(el("span", "可选", { class: "yxp2-tag is-soft" }));
  row.append(top);
  const g = K.grid(row);
  if (en) K.inp(g, "英文名", ln.name_en, (v) => (ln.name_en = v), "text", { maxlength: "200" });
  K.inp(g, "频率（如“每周 1 次 · 每次 1 课时”）", ln.frequency_text, (v) => (ln.frequency_text = v), "text", { maxlength: "500" });
  K.num(g, "每课时分钟", ln.minutes, (v) => (ln.minutes = v), { min: "1", max: "1440", step: "1" });
  if (ln.pricing_source === "manual") K.sel(g, "计价方式", ln.billing_mode, Object.entries(YXP2_BILL).map(([k, [, u]]) => [k, "按" + u]), (v) => ((ln.billing_mode = v), (ln.qty = { [YXP2_BILL[v][0]]: null }), rerender()));
  const [qk, unit] = YXP2_BILL[ln.billing_mode] || ["units", "课时"];
  K.num(g, "数量（" + unit + "）", ln.qty?.[qk], (v) => (ln.qty = { [qk]: v }));
  if (ln.billing_mode === "package" && ln.pricing_source === "manual") K.num(g, "每包课时", ln.units_per_package, (v) => (ln.units_per_package = v), { min: "1", step: "1" });
  if (ln.billing_mode !== "per_unit" && ln.billing_mode !== "package") K.num(g, "折合课时（可空）", ln.teaching_units, (v) => (ln.teaching_units = v));
  if (ln.pricing_source === "manual") {
    if (!ln.price_tbd) K.num(g, "单价（元 / " + unit + "）", ln.manual_unit_price, (v) => (ln.manual_unit_price = v));
    K.chk(row, "价格另议（家长看到“另议”）", ln.price_tbd, (v) => ((ln.price_tbd = v), v && (ln.manual_unit_price = null), rerender()));
    K.chk(row, "可选课程（不计入总价）", ln.optional, (v) => (ln.optional = v));
  }
  if (groups.length) K.sel(row, "分组", ln.group_id || "", [["", "（不分组）"], ...groups.map((x) => [x.id, x.name || "未命名分组"])], (v) => ((ln.group_id = v || null), rerender()));
  K.inp(row, "备注", ln.note, (v) => (ln.note = v), "text", { maxlength: "2000" });
  if (!locked) {
    const ops = el("div", null, { class: "yxp2-ops" });
    const stages = st.doc.modules.path.stages;
    const mv = el("select", null, { "aria-label": "移到阶段", class: "yxp2-mini" });
    mv.append(el("option", "移到阶段…", { value: "" }));
    for (const s of stages) if (s.key !== ln.stage_key) mv.append(el("option", s.name || "未命名阶段", { value: s.key }));
    if (ln.stage_key) mv.append(el("option", "未分阶段", { value: "__none" }));
    mv.addEventListener("change", () => {
      if (!mv.value) return;
      ln.stage_key = mv.value === "__none" ? null : mv.value;
      ln.group_id = null;
      mark();
      rerender();
    });
    ops.append(mv, button("复制", () => (st.doc.modules.courses.lines.push({ ...yxClone(ln), line_id: yxp2Tmp("ln"), snapshot: undefined, ...(ln.pricing_source === "catalog" ? {} : {}) }), mark(), rerender())), button("删除", () => ((st.doc.modules.courses.lines = st.doc.modules.courses.lines.filter((x) => x !== ln)), mark(), rerender())));
    row.append(ops);
  }
  return row;
}

// 费用与缴费：附加费 / 其他费用 / 优惠 / 分期；家长预算放在这里对比
function yxp2Fees(b, st, K, locked, mark, rerender) {
  const doc = st.doc,
    F = doc.modules.fees,
    C = doc.computed || {},
    stages = doc.modules.path.stages,
    meta = doc.meta;
  const sum = el("div", null, { class: "yxp2-feesum" });
  const T = C.total || {};
  const row = (k, v, cls) => {
    const r = el("div", null, { class: cls || "" });
    r.append(el("span", k), el("strong", v));
    sum.append(r);
  };
  row("课程与附加费", yxp2Money(C.subtotal?.amount ?? C.subtotal?.known_amount));
  if (F.discount?.type !== "none") row("优惠", "− " + yxp2Money(C.discount?.amount ?? C.discount?.known_amount));
  row(T.amount != null ? "应付总额" : "已确定费用", yxp2Money(T.amount ?? T.known_amount) + (T.amount == null ? (T.has_tbd ? " + 另议" : " · 待报价") : ""), "is-total");
  if (C.budget_comparison?.over) row("家长预算", "超出预算", "is-warn");
  b.append(sum);
  const g0 = K.grid(b);
  K.num(g0, "家长预算（元，可空）", meta.budget?.amount, (v) => (meta.budget = { ...(meta.budget || { period: "unspecified", note: "" }), amount: v }));
  K.sel(g0, "预算周期", meta.budget?.period || "unspecified", [["unspecified", "未说明"], ["total", "全程"], ["year", "每年"], ["month", "每月"]], (v) => (meta.budget = { ...(meta.budget || { amount: null, note: "" }), period: v, ...(v === "total" ? {} : {}) }));
  K.inp(b, "预算备注", meta.budget?.note || "", (v) => (meta.budget = { ...(meta.budget || { amount: null, period: "unspecified" }), note: v }), "text", { maxlength: "500" });
  // 附加费
  const list = (title, arr, withStage, mk) => {
    const box = el("div", null, { class: "yxp2-list" });
    box.append(el("small", title, { class: "yxv-label" }));
    arr.forEach((x, i) => {
      const r = el("div", null, { class: "yxp2-row" });
      if (withStage) K.sel(r, "阶段", x.stage_key || "", [["", "未分阶段"], ...stages.map((s) => [s.key, s.name || "未命名阶段"])], (v) => (x.stage_key = v || null));
      K.inp(r, "名称", x.label, (v) => (x.label = v), "text", { maxlength: "100" });
      K.num(r, "金额（元）", x.amount, (v) => (x.amount = v));
      r.append(K.ops(arr, i, rerender));
      box.append(r);
    });
    if (!locked && arr.length < 100) box.append(button("＋ 添加", () => (arr.push(mk()), mark(), rerender())));
    b.append(box);
  };
  list("阶段附加费（教材、演出、考级报名等）", F.stage_extras, true, () => ({ id: yxp2Tmp("fee"), stage_key: null, label: "", amount: null, note: "" }));
  list("其他费用（申请服务费等）", F.other_fees, false, () => ({ id: yxp2Tmp("fee"), label: "", amount: null, note: "" }));
  // 优惠
  const d = (F.discount ||= { type: "none", amount: null, rate_bps: null, note: "" });
  const g1 = K.grid(b);
  K.sel(g1, "优惠", d.type, [["none", "无"], ["fixed", "减固定金额"], ["percent", "按比例减免"]], (v) => ((d.type = v), (d.amount = null), (d.rate_bps = null), rerender()));
  if (d.type === "fixed") K.num(g1, "减免金额（元）", d.amount, (v) => (d.amount = v));
  if (d.type === "percent") K.num(g1, "减免比例（%）", d.rate_bps == null ? null : d.rate_bps / 100, (v) => (d.rate_bps = v == null ? null : Math.round(v * 100)), { min: "0.01", max: "100" });
  if (d.type !== "none") K.inp(b, "优惠说明", d.note, (v) => (d.note = v), "text", { maxlength: "1000" });
  // 分期
  K.sel(b, "缴费方式", F.installments, [["per_stage", "按阶段缴费"], ["custom", "按比例分期"], ["fixed", "直接填每期金额"]], (v) => {
    F.installments = v;
    if (v === "custom" && !F.custom.length) F.custom = [{ stage_key: null, label: "第1期", due: null, ratio_bps: 10000 }];
    if (v !== "custom") F.custom = [];
    if (v !== "fixed") F.fixed = [];
    rerender();
  });
  const inst = el("div", null, { class: "yxp2-list" });
  if (F.installments === "per_stage") {
    for (const s of stages) {
      const r = el("div", null, { class: "yxp2-row" });
      r.append(el("span", s.name || "未命名阶段", { class: "yxp2-rowlabel" }));
      K.inp(r, "缴费日期", F.due_dates?.[s.key] || "", (v) => (F.due_dates = { ...(F.due_dates || {}), [s.key]: v || null }), "date");
      inst.append(r);
    }
  } else if (F.installments === "custom") {
    F.custom.forEach((x, i) => {
      const r = el("div", null, { class: "yxp2-row" });
      K.inp(r, "名称", x.label, (v) => (x.label = v), "text", { maxlength: "30" });
      K.inp(r, "日期", x.due || "", (v) => (x.due = v || null), "date");
      K.num(r, "比例（%）", x.ratio_bps / 100, (v) => (x.ratio_bps = Math.round((v || 0) * 100)), { min: "0.01", max: "100", step: "0.01" });
      r.append(K.ops(F.custom, i, rerender));
      inst.append(r);
    });
    if (!locked) inst.append(button("＋ 加一期", () => (F.custom.push({ stage_key: null, label: "第" + (F.custom.length + 1) + "期", due: null, ratio_bps: 0 }), mark(), rerender())));
  } else {
    F.fixed.forEach((x, i) => {
      const r = el("div", null, { class: "yxp2-row" });
      K.inp(r, "名称", x.label, (v) => (x.label = v), "text", { maxlength: "100" });
      K.inp(r, "日期", x.due || "", (v) => (x.due = v || null), "date");
      K.num(r, "金额（元）", x.amount, (v) => (x.amount = v));
      r.append(K.ops(F.fixed, i, rerender));
      inst.append(r);
    });
    if (!locked) inst.append(button("＋ 加一期", () => (F.fixed.push({ id: yxp2Tmp("ins"), stage_key: null, label: "第" + (F.fixed.length + 1) + "期", due: null, amount: null }), mark(), rerender())));
  }
  const validation = el("p", null, { class: "yxs-warn", role: "status" });
  const updateValidation = () => {
    validation.textContent = yxp2InstallmentError(doc) || "";
    validation.hidden = !validation.textContent;
  };
  inst.append(validation);
  inst.addEventListener("input", updateValidation);
  updateValidation();
  const ist = C.installment_status;
  if (ist === "unbalanced") inst.append(el("p", "各期合计和应付总额对不上，可以先存草稿，发送前要调平。", { class: "yxs-warn" }));
  if (ist === "pending_quote") inst.append(el("p", "还有课程待报价，报完价才能算出分期。", { class: "v-muted" }));
  for (const x of C.installments || []) inst.append(el("p", (x.label || "") + (x.due ? " · " + x.due : "") + " · " + yxp2Money(x.amount), { class: "yxp2-inst" }));
  b.append(inst);
  K.inp(b, "费用说明", F.note, (v) => (F.note = v), "textarea", { rows: "2", maxlength: "3000" });
}

// ---------- 保存 / 平移日期 / 模版 / 优秀方案 ----------
async function yxp2Save(st, rerender) {
  const error = yxp2InstallmentError(st.doc);
  if (error) { notice(error); return false; }
  yxp2CancelQuote(st);
  const body = { version: st.doc.version, doc: yxp2Body(st.doc) };
  if (st.priceRev != null) body.expected_price_list_rev = st.priceRev;
  if (st.applied?.length) body.applied_suggestion_ids = [...new Set(st.applied)];
  if (st.appliedCards?.length) body.applied_cards = st.appliedCards;
  if (st.dateShift) body.date_shift = st.dateShift;
  try {
    const r = await api("plans/" + encodeURIComponent(st.doc.id), "PUT", body);
    yxp2Accept(st, r);
    st.dirty = false;
    st.applied = [];
    st.appliedCards = [];
    st.dateShift = null;
    st.priceRev = r.price_list_rev ?? st.priceRev;
    notice("已保存", "success");
  } catch (e) {
    if (e.code === "version_conflict") {
      if (!(await UI.confirm({ title: "方案已被别人修改", consequence: "要载入最新内容吗？你这次的修改会丢失。", danger: true }))) return;
      st.doc = e.details?.latest || (await api("plans/" + encodeURIComponent(st.doc.id)));
      st.dirty = false;
      st.applied = [];
      st.appliedCards = [];
      st.dateShift = null;
      st.priceRev = st.doc.price_list_rev ?? null;
    } else if (e.code === "price_changed") {
      const d = e.details || {};
      if (d.price_list_rev == null) return notice("价目表刚更新过，请检查后再保存。");
      const ok = await UI.confirm({ title: "价目表刚更新过", consequence: "按最新价格，方案总价从 " + yxp2Money(st.doc.computed?.total?.amount ?? st.doc.computed?.total?.known_amount) + " 变为 " + yxp2Money(d.computed?.total?.amount ?? d.computed?.total?.known_amount) + "。确定按新价格保存？" });
      if (!ok) return;
      st.priceRev = d.price_list_rev;
      if (d.computed) st.doc.computed = d.computed;
      return yxp2Save(st, rerender);
    } else throw e;
  }
  rerender();
}
// 有自由课程时，发送 / 导出前请顾问确认一次价格（v0.5 §4.8）
async function yxp2Ack(st) {
  if (!st.v2) return {};
  const manual = (st.doc.modules?.courses?.lines || []).filter((l) => l.pricing_source === "manual");
  if (!manual.length) return {};
  const ok = await UI.confirm({ title: "确认非价目表课程的价格", consequence: "这份方案里有 " + manual.length + " 门自由课程（" + manual.slice(0, 3).map((l) => l.name || "未命名").join("、") + (manual.length > 3 ? " 等" : "") + "），价格是手填或“另议”。确认无误后继续。" });
  return ok ? { acknowledgements: { manual_pricing: true } } : null;
}
async function yxp2Shift(st, rerender) {
  if (st.dirty) return notice("先保存，再平移日期");
  const { panel, close } = drawer("整体平移日期");
  const form = el("form");
  form.append(el("p", "学习路径、阶段节点、时间线、缴费日期和方案日期一起前后移动。正文里写到的日期不会改，课时和价格也不会变。", { class: "v-muted" }));
  field(form, "移动几个月（往后填正数，往前填负数）", "months", "number", "1");
  const out = el("div");
  form.append(out);
  let pv = null;
  const months = () => Math.round(Number(form.elements.months.value));
  form.append(
    button("预览改动", async () => {
      const n = months();
      if (!n || Math.abs(n) > 120) return notice("请填 -120 到 120 之间、不为 0 的整数");
      pv = await api("plans/" + encodeURIComponent(st.doc.id) + "/shift-dates/preview", "POST", { version: st.doc.version, months: n });
      pv.n = n;
      out.replaceChildren(el("p", "会改动 " + (pv.changes?.length || 0) + " 处日期。" + (pv.warnings?.length ? pv.warnings.join("；") : ""), { class: "v-muted" }));
      const ul = el("ul", null, { class: "yxp-check" });
      for (const c of (pv.changes || []).slice(0, 30)) ul.append(el("li", (c.label || c.path || "") + "：" + (c.before || "—") + " → " + (c.after || "—")));
      out.append(ul);
    }),
  );
  submit(form, "确认平移并保存", async () => {
    if (!pv || pv.n !== months()) throw Error("先点“预览改动”看一下");
    st.doc = { ...st.doc, ...pv.doc, computed: pv.computed };
    st.dateShift = pv.save_options?.date_shift || { months: pv.n, base_version: st.doc.version };
    st.dirty = true;
    await close();
    await yxp2Save(st, rerender);
  });
  panel.append(form);
}
async function yxp2SaveTemplate(st) {
  if (st.dirty) return notice("先保存，再存为模版");
  const pv = await api("plans/" + encodeURIComponent(st.doc.id) + "/template-preview", "POST", { version: st.doc.version });
  const { panel, close } = drawer("存为本机构模版");
  const form = el("form");
  form.append(el("p", "模版会去掉学员姓名、家长信息、电话、学校、照片和咨询原文，只留下结构、课程搭配和文字写法。下一位学员可以从这个模版开始。", { class: "v-muted" }));
  if (pv.redactions?.length) form.append(el("p", "已自动去掉 " + pv.redactions.length + " 处个人信息。", { class: "v-muted" }));
  const M = st.doc.modules;
  field(form, "模版名称", "name", "text", [M.basic.direction, M.basic.grade].filter(Boolean).join(" · ") || st.doc.title || "学习方案模版");
  field(form, "适用说明（可空）", "description", "text", "", false);
  field(form, "适用方向（逗号分开，可空）", "directions", "text", M.basic.direction || "", false);
  field(form, "适用年级（逗号分开，可空）", "grades", "text", M.basic.grade || "", false);
  submit(form, "保存模版", async (d) => {
    const split = (x) => String(x || "").split(/[,，、]/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
    try {
      await api("plan-templates", "POST", { name: d.name.trim(), description: d.description.trim(), applicability: { subject: st.doc.subject, directions: split(d.directions), grades: split(d.grades), budget: { min: null, max: null, period: "unspecified" }, target_types: [] }, source: { plan_id: st.doc.id, version: st.doc.version }, doc: pv.doc });
    } catch (e) {
      if (e.code === "template_privacy_review_required") throw Error("方案里还有学员个人信息（如姓名、学校、电话），请先在方案里改掉再存模版。");
      throw e;
    }
    await close();
    notice("已存为本机构模版", "success");
  });
  panel.append(form);
}
async function yxp2Reference(st, rerender) {
  const r = st.doc.reference || {};
  const on = !r.enabled;
  if (st.dirty) return notice("先保存，再标记");
  const res = await api("plans/" + encodeURIComponent(st.doc.id) + "/reference", "PUT", { version: st.doc.version, reference_version: r.version || 0, enabled: on });
  st.doc.reference = res.reference;
  notice(on ? "已标为优秀方案，以后 AI 会参考它的写法" : "已取消", "success");
  rerender();
}

// ---------- 右栏：方案助手（常驻长输入框 → 一组建议卡）----------
const YXP2_COLL = {
  stage: { arr: (d) => d.modules.path.stages, id: "key" },
  stage_node: { arr: (d, p) => d.modules.path.stages.find((s) => s.key === p)?.nodes, id: "id" },
  timeline_item: { arr: (d) => d.modules.timeline.items, id: "id" },
  course_group: { arr: (d) => d.modules.courses.groups, id: "id" },
  course_line: { arr: (d) => d.modules.courses.lines, id: "line_id" },
  teacher_group: { arr: (d) => d.modules.teachers.groups, id: "id" },
  teacher: { arr: (d, p) => d.modules.teachers.groups.find((g) => g.id === p)?.members, id: "id" },
  goal_group: { arr: (d) => d.modules.goals.groups, id: "id" },
  goal: { arr: (d, p) => d.modules.goals.groups.find((g) => g.id === p)?.items, id: "id" },
  photo_page: { arr: (d) => d.modules.photos.pages, id: "id" },
};
function yxp2ApplyCard(doc, c) {
  if (c.entity_type === "budget") {
    doc.meta.budget = c.after?.budget ?? doc.meta.budget;
    if (c.after && "budget_cap" in c.after) doc.meta.budget_cap = c.after.budget_cap;
    return;
  }
  if (c.entity_type === "module") {
    if (c.module === "basic" && c.field === "title") doc.title = c.after;
    else doc.modules[c.module][c.field] = yxClone(c.after);
    return;
  }
  const C = YXP2_COLL[c.entity_type];
  const arr = C?.arr(doc, c.parent_id);
  if (!arr) return;
  const i = arr.findIndex((x) => x[C.id] === c.entity_id);
  if (c.op === "add") {
    if (i < 0) arr.push(yxClone(c.after));
  } else if (c.op === "remove") {
    if (i >= 0) arr.splice(i, 1);
  } else if (i >= 0) {
    if (c.field) arr[i][c.field] = yxClone(c.after);
    else arr[i] = { ...arr[i], ...yxClone(c.after) };
  }
}
// 卡片里“改成什么”的一句话
function yxp2CardText(c, v) {
  if (v == null) return "";
  if (typeof v === "string") return v.replace(/\*\*/g, "");
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : x.label || x.name || "")).filter(Boolean).join("、");
  if (c.entity_type === "stage") return [v.name, v.start_month && v.end_month ? v.start_month + " – " + v.end_month : "", (v.goals || []).join("；")].filter(Boolean).join(" · ");
  if (c.entity_type === "course_line") {
    const [k, u] = YXP2_BILL[v.billing_mode] || ["units", "课时"];
    return [v.name, v.frequency_text, v.qty?.[k] != null ? v.qty[k] + " " + u : "", v.pricing_source === "manual" ? "非价目表" : ""].filter(Boolean).join(" · ");
  }
  if (c.entity_type === "budget") return v.budget?.amount != null ? "预算 " + yxp2Money(v.budget.amount) + ({ year: " / 年", month: " / 月", total: "（全程）" }[v.budget.period] || "") : "预算待确认";
  return [v.name, v.title, v.role, v.date, v.tier, v.note].filter(Boolean).join(" · ");
}
function yxp2Ai(right, st, locked, mark, rerender) {
  const head = el("div", null, { class: "yxv-ai-head" });
  const t = el("div");
  t.append(el("strong", "方案助手"), el("small", "艺界星途 AI", { class: "v-muted" }));
  const tier = el("div", null, { class: "yxv-tier", role: "group", "aria-label": "AI 模式" });
  for (const [k, n] of [[false, "快速"], [true, "深度"]]) {
    const b = el("button", n, { type: "button", "aria-pressed": String(!!st.aiDeep === k) });
    b.addEventListener("click", () => ((st.aiDeep = k), rerender()));
    tier.append(b);
  }
  head.append(el("span", "✦", { class: "yxv-ai-logo", "aria-hidden": "true" }), t, el("span", null, { class: "v-spacer" }), tier);
  right.append(head);
  const body = el("div", null, { class: "yxv-ai-body" });
  right.append(body);
  if (locked) return body.append(el("p", "方案已锁定，助手只能用在可编辑的方案上。", { class: "v-muted" }));
  // 长输入框：顾问用口语描述情况或提修改要求，AI 自己判断是填写还是修改
  const lab = el("label", null, { class: "yxp2-brief" });
  lab.append(el("small", "说说学员情况，或者想怎么改", { class: "yxv-label" }));
  const ta = el("textarea", null, { rows: "9", maxlength: "8000", placeholder: "直接用口语写，比如：\n孩子初二，钢琴 6 级，手型有点塌，视唱一般；家长想走艺考，明年 7 月考 8 级，预算一年 3 万左右，每周能上两次课。\n\n也可以写修改要求：考级推迟一个月，每周加一节视唱练耳。" });
  ta.value = st.briefText || "";
  const cnt = el("small", (ta.value.length || 0) + " / 8000", { class: "v-muted yxp2-cnt" });
  ta.addEventListener("input", () => ((st.briefText = ta.value), (cnt.textContent = ta.value.length + " / 8000")));
  lab.append(ta, cnt);
  body.append(lab);
  const row = el("div", null, { class: "yxp2-brief-row" });
  const scope = el("select", null, { "aria-label": "只改哪一块", class: "yxp2-mini" });
  scope.append(el("option", "自动判断要改哪里", { value: "auto" }));
  for (const k of st.doc.module_order) scope.append(el("option", "只改：" + (st.doc.modules[k].title || YXP2_MODS[k]), { value: k }));
  scope.value = st.scope || "auto";
  scope.addEventListener("change", () => (st.scope = scope.value));
  row.append(scope, yxAiButton("整理并生成", () => yxp2Brief(st, rerender), "primary"));
  body.append(row, el("p", "会整理成方案里的文字，并排好阶段和课程。建议逐条采用，不会自动改方案。写的原话会随方案保存，只有员工能看到。", { class: "v-muted yxp2-hint" }));
  if (st.cards) yxp2Cards(body, st, mark, rerender);
}
async function yxp2Brief(st, rerender) {
  const text = (st.briefText || "").trim();
  if (!text) return notice("先写几句学员情况或修改要求");
  if (st.dirty) await yxp2Save(st, () => {});
  if (st.dirty) return;
  if (text !== (st.brief?.text || "")) {
    try {
      st.brief = (await api("plans/" + encodeURIComponent(st.doc.id) + "/brief", "PUT", { version: st.brief?.version || 0, text })).brief;
    } catch (e) {
      if (e.code !== "version_conflict") throw e;
      st.brief = e.details?.latest || st.brief;
      st.brief = (await api("plans/" + encodeURIComponent(st.doc.id) + "/brief", "PUT", { version: st.brief.version, text })).brief;
    }
  }
  try {
    const res = await yxAi("plan/brief", { plan_id: st.doc.id, doc_version: 2, plan_version: st.doc.version, brief_version: st.brief.version, scope: st.scope || "auto", tier: st.aiDeep ? "deep" : "fast" });
    st.cards = { list: res.suggestions || [], warnings: res.warnings || [], v: 0, pick: {} };
    for (const sg of st.cards.list) for (const c of sg.payload?.cards || []) st.cards.pick[sg.id + "|" + c.card_id] = !!c.default_selected;
  } catch (e) {
    e.message = "原话已保存。" + e.message;
    throw e;
  }
  rerender();
}
function yxp2Cards(body, st, mark, rerender) {
  const S = st.cards;
  if (!S.list.length) {
    body.append(el("p", "这次没有生成合适的建议，可以多写一些情况再试。", { class: "v-muted" }));
    const w = yxAiWarnings(S.warnings);
    if (w) body.append(w);
    return;
  }
  if (S.list.length > 1) {
    const tabs = el("div", null, { class: "yxv-seg yxv-seg-full", role: "tablist" });
    S.list.forEach((sg, i) => {
      const b = el("button", "方案 " + "ABC"[i] + (sg.payload?.recommended ? "（推荐）" : ""), { type: "button", role: "tab", "aria-selected": String(S.v === i), "aria-pressed": String(S.v === i) });
      b.addEventListener("click", () => ((S.v = i), rerender()));
      tabs.append(b);
    });
    body.append(tabs);
  }
  const sg = S.list[S.v],
    P = sg.payload || {},
    cards = P.cards || [];
  const key = (c) => sg.id + "|" + c.card_id;
  const byId = Object.fromEntries(cards.map((c) => [c.card_id, c]));
  const set = (c, on) => {
    S.pick[key(c)] = on;
    if (on) for (const d of c.depends_on || []) byId[d] && set(byId[d], true);
    else for (const x of cards) if ((x.depends_on || []).includes(c.card_id) && S.pick[key(x)]) set(x, false);
  };
  if (P.completion && Object.values(P.completion).includes("partial")) body.append(el("p", "这次只生成了一部分，可以补充情况后再试。", { class: "v-muted" }));
  const mods = [...new Set(cards.map((c) => c.module))];
  for (const m of mods) {
    const box = el("div", null, { class: "yxp2-cgroup" });
    box.append(el("h4", st.doc.modules[m]?.title || YXP2_MODS[m] || m));
    for (const c of cards.filter((x) => x.module === m)) {
      const card = el("label", null, { class: "yxp2-cardx" + (S.pick[key(c)] ? " is-on" : "") });
      const cb = el("input", null, { type: "checkbox" });
      cb.checked = !!S.pick[key(c)];
      cb.addEventListener("change", () => (set(c, cb.checked), rerender()));
      const tx = el("div");
      tx.append(el("strong", (c.op === "remove" ? "删除：" : c.op === "add" ? "新增：" : "") + (c.label || "")));
      if (c.op === "update" && c.before != null && typeof c.before !== "object") tx.append(el("p", yxp2CardText(c, c.before).slice(0, 140), { class: "yxp2-before" }));
      if (c.op !== "remove") tx.append(el("p", yxp2CardText(c, c.after).slice(0, 400), { class: "yxp2-after" }));
      if (c.evidence?.kind === "quote" && c.evidence.verified && c.evidence.quote) tx.append(el("small", "你写的：“" + c.evidence.quote.slice(0, 60) + "”", { class: "v-muted" }));
      card.append(cb, tx);
      box.append(card);
    }
    body.append(box);
  }
  const picked = cards.filter((c) => S.pick[key(c)]);
  const tot = P.computed?.total;
  if (tot) body.append(el("p", "全部采用后约 " + (tot.amount != null ? yxp2Money(tot.amount) : "已确定 " + yxp2Money(tot.known_amount)) + "，部分采用以保存后的金额为准。", { class: "v-muted" }));
  const w = yxAiWarnings(S.warnings);
  if (w) body.append(w);
  const ops = el("div", null, { class: "yxv-btnrow" });
  ops.append(
    button("采用所选（" + picked.length + "）", () => {
      if (!picked.length) return notice("先勾选要采用的建议");
      // 依赖顺序：先阶段/分组，再课程
      const order = ["module", "budget", "stage", "stage_node", "timeline_item", "course_group", "course_line", "teacher_group", "teacher", "goal_group", "goal", "photo_page"];
      for (const c of [...picked].sort((a, b) => order.indexOf(a.entity_type) - order.indexOf(b.entity_type))) yxp2ApplyCard(st.doc, c);
      if (P.price_list_rev != null) st.priceRev = P.price_list_rev;
      (st.applied ||= []).push(sg.id);
      // 采用后顾问往往还会再改，统一按“修改后采用”记，最终内容由普通保存校验
      (st.appliedCards ||= []).push({ suggestion_id: sg.id, card_ids: picked.map((c) => c.card_id), edited_card_ids: picked.map((c) => c.card_id) });
      st.cards = null;
      mark();
      rerender();
      notice("已填入方案，检查后记得保存", "success");
    }, "primary"),
    button("都不要", () => ((st.cards = null), rerender())),
  );
  body.append(ops);
}

// ---------- 预览数据（编辑器里，按家长看到的样子）----------
function yxp2PreviewData(st) {
  const d = st.doc;
  return { doc_version: 2, title: d.title, subject: d.subject, style: d.style, meta: d.meta, module_order: d.module_order, modules: d.modules, computed: d.computed || {}, student: { display_name: d.modules.basic.student_name || st.student?.name || st.partyName || "" }, brand: { name: brand?.display_name, logo: brand?.logo_url || null, primary_color: brand?.primary_color, qr_image_id: st.brandQr || null }, profile: st.profile || null };
}

// ---------- v2 方案排版：封面 + 按版块顺序的内页，自动分页（A4）----------
const YXD2_LATIN = { assessment: "Assessment", strategy: "Strategy", path: "Learning Path", timeline: "Key Dates", courses: "Course Plan", teachers: "Faculty", fees: "Tuition", goals: "Goals", photos: "Gallery", about: "About Us" };
function yxd2Rich(text) {
  // 方案正文只认 **加粗** 和行首“- ”列表
  const box = el("div", null, { class: "yxd-text" });
  let ul = null;
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      ul = null;
      continue;
    }
    const li = /^\s*[-•]\s+(.*)$/.exec(line);
    const fill = (node, t) => {
      for (const part of String(t).split(/(\*\*[^*\n]+\*\*)/g)) {
        if (!part) continue;
        if (/^\*\*[^*]+\*\*$/.test(part)) node.append(el("b", part.slice(2, -2)));
        else node.append(part);
      }
      return node;
    };
    if (li) {
      if (!ul) box.append((ul = el("ul")));
      ul.append(fill(el("li"), li[1]));
    } else {
      ul = null;
      box.append(fill(el("p"), line));
    }
  }
  return box;
}
function yxd2Month(s, e) {
  const f = (m) => (m ? m.replace(/^(\d{4})-0?(\d+)$/, "$1 年 $2 月") : "");
  return s && e ? f(s) + " – " + f(e) : f(s || e);
}
function yxPlanDocument2(rd, manifest, mediaUrl) {
  const tok = manifest?.tokens?.color || {};
  const comp = manifest?.components || {};
  const primary = tok.use_tenant_primary !== false && /^#[0-9a-f]{6}$/i.test(rd.brand?.primary_color || "") ? rd.brand.primary_color : /^#[0-9a-f]{6}$/i.test(tok.primary || "") ? tok.primary : "#6A35B8";
  const ink = /^#[0-9a-f]{6}$/i.test(tok.ink || "") ? tok.ink : "#211A30";
  const cover = String(comp["plan.cover"] || "folio").replace(/[^a-z]/g, "");
  const docEl = el("article", null, { class: "yxp-doc yxd yxd2 is-" + cover + " sh-" + String(comp["plan.section_header"] || "numeral").replace(/[^a-z]/g, "") + " sb-" + String(comp["plan.stage_block"] || "band").replace(/[^a-z]/g, "") + " tc-" + String(comp["plan.total_card"] || "solid").replace(/[^a-z]/g, "") });
  docEl.style.setProperty("--yxp-primary", primary);
  docEl.style.setProperty("--yxd-on-primary", yxdContrast("#ffffff", primary) >= 4.5 ? "#ffffff" : ink);
  for (const [k, v] of [["ink", tok.ink], ["paper", tok.paper], ["accent", tok.accent], ["muted", tok.muted]]) if (/^#[0-9a-f]{6}$/i.test(v || "")) docEl.style.setProperty("--yxp-" + k, v);
  const M = rd.modules,
    C = rd.computed || {},
    sty = rd.style || {},
    B = M.basic || {};
  const en = !!B.english_enabled;
  const img = (id, url) => url || (id && mediaUrl ? mediaUrl(id) : null);
  const who = rd.student?.display_name || B.student_name || "";
  const money = (v) => (v == null ? "—" : yxpMoney(v));
  const pages = [];
  const page = (cls) => {
    const p = el("section", null, { class: "yxp-page yxd-page " + (cls || "") });
    docEl.append(p);
    pages.push(p);
    return p;
  };
  // ---- 封面 ----
  if (B.visible !== false && B.cover_visible !== false) {
    const cv = page("yxd-cover");
    const logo = el("div", null, { class: "yxd-logo" });
    if (rd.brand?.logo) logo.append(el("img", null, { src: rd.brand.logo, alt: rd.brand?.name || "" }));
    else logo.append(el("span", rd.brand?.name || ""));
    const pu = img(sty.cover_image_id, sty.cover_image_url);
    const photo = pu ? el("img", null, { src: pu, alt: "", class: "yxd-photo" }) : null;
    if (photo && sty.focal_point) photo.style.setProperty("object-position", Math.round((sty.focal_point.x ?? 0.5) * 100) + "% " + Math.round((sty.focal_point.y ?? 0.5) * 100) + "%");
    const textBox = el("div", null, { class: "yxd-cover-text" });
    const eyebrow = B.cover_eyebrow || (sty.show_latin_eyebrow ? YXD_LATIN[rd.subject] || "Learning Plan" : "");
    if (eyebrow) textBox.append(el("p", eyebrow, { class: "yxd-latin" }));
    textBox.append(el("h1", rd.title || "学习方案"));
    const st0 = M.path?.stages || [];
    const sub = [B.cover_subtitle, yxd2Month(st0[0]?.start_month, st0.at(-1)?.end_month)].filter(Boolean).join(" · ");
    if (sub) textBox.append(el("p", sub, { class: "yxd-sub" }));
    textBox.append(el("i", null, { class: "yxd-rule" }));
    const nums = el("div", null, { class: "yxd-nums" });
    for (const n of (C.cover_numbers || []).filter((x) => x.value != null && x.value !== "")) {
      const b = el("div");
      b.append(el("small", n.label), el("b", n.value, { class: "yxd-num" }), el("span", n.unit), ...(n.sub ? [el("small", n.sub, { class: "yxd-nsub" })] : []));
      nums.append(b);
    }
    const meta = el("p", [who ? "学员 " + who + (B.grade ? " · " + B.grade : "") : "", B.direction ? B.direction + (en && B.direction_en ? " / " + B.direction_en : "") : "", String(B.plan_date || "").replaceAll("-", ".")].filter(Boolean).join("　　"), { class: "yxd-meta" });
    if (cover === "stage") {
      const bg = el("div", null, { class: "yxd-stage-bg" });
      if (photo) bg.append(photo);
      const top = el("div", null, { class: "yxd-cover-top" });
      top.append(logo, el("span", "Study Plan", { class: "yxd-kicker" }));
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
      cv.append(el("i", null, { class: "yxd-blob a" }), el("i", null, { class: "yxd-blob b" }));
      const top = el("div", null, { class: "yxd-cover-top" });
      top.append(logo);
      const frame = el("figure", null, { class: "yxd-polaroid" });
      frame.append(photo || el("div", null, { class: "yxd-photo-empty" }), el("figcaption", (String(st0[0]?.start_month || "").slice(0, 4) || "") + " · " + (rd.brand?.name || "")));
      textBox.append(nums);
      cv.append(top, frame, textBox, meta);
    } else {
      const arch = el("div", null, { class: "yxd-arch" });
      arch.append(photo || el("div", null, { class: "yxd-photo-empty" }));
      const band = el("div", null, { class: "yxd-band" });
      const head = el("div", null, { class: "yxd-band-head" });
      head.append(textBox, logo);
      band.append(head, nums, meta);
      cv.append(arch, band);
    }
  }
  // ---- 内页：先按版块生成“块”，挂到页面上后再按 A4 高度分页 ----
  const blocks = [];
  let n = 0;
  const add = (x, opt = {}) => blocks.push({ x, ...opt });
  const head = (key, title) => {
    const h = el("div", null, { class: "yxd-h" });
    h.append(el("span", String(++n).padStart(2, "0"), { class: "yxd-h-num" }));
    const tx = el("div");
    if (sty.show_latin_eyebrow !== false) tx.append(el("small", YXD2_LATIN[key] || "", { class: "yxd-latin" }));
    tx.append(el("h2", title));
    h.append(tx);
    add(h, { keep: true });
  };
  const T = (key, def) => M[key]?.title || def;
  const CS = Object.fromEntries((C.stages || []).map((x) => [x.key, x]));
  const CL = Object.fromEntries((C.lines || []).map((x) => [x.line_id, x]));
  for (const key of rd.module_order || []) {
    const m = M[key];
    if (!m || m.visible === false || key === "basic") continue;
    if (key === "assessment" && (m.text || m.scores?.length || m.tags?.length)) {
      head(key, T(key, "学员测评"));
      if (m.text) for (const c of yxd2Rich(m.text).children) add(c);
      if (m.scores?.length) {
        const g = el("div", null, { class: "yxd2-scores" });
        for (const s of m.scores) {
          const r = el("div");
          const bar = el("i");
          bar.style.setProperty("--v", String(s.value == null ? 0 : Math.max(0, Math.min(1, s.value / (s.max || 5)))));
          r.append(el("span", s.label), bar, el("b", s.value == null ? "—" : s.value + " / " + s.max));
          g.append(r);
        }
        add(g);
      }
      if (m.tags?.length) {
        const g = el("p", null, { class: "yxd2-tags" });
        for (const t of m.tags) g.append(el("span", t, { class: "yxd-chip" }));
        add(g);
      }
    } else if (key === "strategy" && m.text) {
      head(key, T(key, "学习 / 申请策略"));
      for (const c of yxd2Rich(m.text).children) add(c);
    } else if (key === "path" && m.stages?.length) {
      head(key, T(key, "学习路径"));
      m.stages.forEach((s, i) => {
        const c = CS[s.key] || {};
        const row = el("div", null, { class: "yxd-path-row" });
        const l = el("div", null, { class: "yxd-path-l" });
        l.append(el("small", "第" + (YXD_CN[i] || i + 1) + "阶段"), el("strong", s.name || ""));
        const dur = el("p");
        if (c.months) dur.append(el("b", String(c.months), { class: "yxd-num" }), " 个月" + (c.weeks_display ? " · " + c.weeks_display + " 周" : ""));
        l.append(dur);
        const r = el("div", null, { class: "yxd-path-r" + (i === m.stages.length - 1 ? " is-last" : "") });
        const t = el("p", null, { class: "yxd-path-when" });
        t.append(el("strong", yxd2Month(s.start_month, s.end_month)));
        r.append(t);
        if (s.goals?.length) {
          const ul = el("ul");
          for (const x of s.goals) ul.append(el("li", x));
          r.append(ul);
        }
        if (s.nodes?.length) {
          const p = el("p", null, { class: "yxd2-nodes" });
          for (const x of s.nodes) p.append(el("span", (x.date ? x.date.slice(5).replace("-", ".") + " " : "") + x.name, { class: "yxd-chip" }));
          r.append(p);
        }
        row.append(l, r);
        const wrap = el("div", null, { class: "yxd-path" });
        wrap.append(row);
        add(wrap);
      });
    } else if (key === "timeline" && m.items?.length) {
      head(key, T(key, "关键节点时间线"));
      const items = [...m.items].sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")));
      for (let i = 0; i < items.length; i += 8) {
        const t = el("table", null, { class: "yxd-table is-plain yxd2-tl" });
        for (const x of items.slice(i, i + 8)) {
          const tr = el("tr");
          tr.append(el("td", x.date ? x.date.replaceAll("-", ".") : "待定", { class: "yxd2-date" }), el("td", YXP2_TL[x.type] || "", { class: "yxd2-type" }), el("td", x.name + (x.note ? "　" : "")));
          if (x.note) tr.lastChild.append(el("small", x.note));
          t.append(tr);
        }
        add(t);
      }
    } else if (key === "courses" && m.lines?.length) {
      head(key, T(key, "课程计划"));
      const stages = [...(M.path?.stages || []).map((s) => [s.key, s.name]), [null, "其他课程"]];
      for (const [sk, sname] of stages) {
        const set = (m.stage_settings || []).find((x) => x.stage_key === sk);
        const lines = m.lines.filter((l) => (l.stage_key ?? null) === sk);
        if (!lines.length && !set?.pending) continue;
        const c = sk ? CS[sk] || {} : C.unassigned || {};
        const t = el("table", null, { class: "yxd-table yxd2-courses" });
        const band = el("tr", null, { class: "yxd-stage-row" });
        const td = el("td");
        td.colSpan = 4;
        const bl = el("div");
        bl.append(el("strong", sname || ""), el("span", null, { class: "yxd-sp" }), el("b", set?.pending ? "待定" : (c.units ?? c.known_units ?? 0) + " 课时" + (M.fees?.visible !== false && c.amount != null ? " · " + money(c.amount) : "")));
        td.append(bl);
        band.append(td);
        t.append(band);
        if (set?.pending) {
          const tr = el("tr");
          const td2 = el("td", set.pending_note || "这一阶段的课程待定，会根据前一阶段的情况再确定。");
          td2.colSpan = 4;
          tr.append(td2);
          t.append(tr);
        } else {
          const groups = (m.groups || []).filter((g) => (g.stage_key ?? null) === sk);
          const draw = (ls) => {
            for (const l of ls) {
              const [qk, unit] = YXP2_BILL[l.billing_mode] || ["units", "课时"];
              const tr = el("tr");
              const nm = el("td");
              nm.append(el("span", l.name || ""));
              if (en && l.name_en) nm.append(el("i", l.name_en, { class: "yxd2-en" }));
              if (l.note) nm.append(el("small", l.note));
              const unitPrice = l.pricing_source === "manual" ? (l.price_tbd ? "另议" : l.manual_unit_price != null ? money(l.manual_unit_price) + " / " + unit : null) : l.snapshot?.pricing?.amount_cents != null ? money(l.snapshot.pricing.amount_cents / 100) + " / " + unit : null;
              if (sty.show_unit_price && unitPrice) nm.append(el("small", unitPrice));
              else if (l.price_tbd) nm.append(el("small", "价格另议"));
              if (l.optional) nm.append(el("small", "可选"));
              tr.append(nm, el("td", l.frequency_text || ""), el("td", l.minutes ? l.minutes + " 分钟" : ""), el("td", (l.qty?.[qk] ?? "") + (unit === "课时" ? "" : " " + unit), { class: "yxd-r" }));
              t.append(tr);
            }
          };
          draw(lines.filter((l) => !l.group_id || !groups.some((g) => g.id === l.group_id)));
          for (const g of groups) {
            const ls = lines.filter((l) => l.group_id === g.id);
            if (!ls.length) continue;
            const gr = el("tr", null, { class: "yxd2-grp" });
            const gt = el("td", g.name || "");
            gt.colSpan = 4;
            gr.append(gt);
            t.append(gr);
            draw(ls);
          }
        }
        add(t);
      }
      if (M.fees?.visible !== false && C.total) {
        const tot = el("div", null, { class: "yxd-sum" });
        tot.append(el("strong", "合计"), el("span", (C.total.units ?? C.total.known_units ?? 0) + " 课时"), el("span", null, { class: "yxd-sp" }), el("b", C.total.amount != null ? money(C.total.amount) : money(C.total.known_amount) + (C.total.has_tbd ? " + 另议" : ""), { class: "yxd-num" }));
        add(tot);
      }
    } else if (key === "teachers" && m.groups?.some((g) => g.members.length)) {
      head(key, T(key, "师资"));
      for (const g of m.groups) {
        if (!g.members.length) continue;
        if (g.role) add(el("h3", g.role, { class: "yxd2-role" }), { keep: true });
        for (const p of g.members) {
          const card = el("div", null, { class: "yxd2-teacher" });
          const ph = img(p.photo_image_id, p.photo_url);
          if (ph) card.append(el("img", null, { src: ph, alt: p.name }));
          const tx = el("div");
          const nm = el("strong", p.name);
          if (p.proposed) nm.append(el("small", "（拟）"));
          tx.append(nm);
          if (p.title) tx.append(el("p", p.title, { class: "yxd2-title" }));
          if (p.introduction) tx.append(yxd2Rich(p.introduction));
          card.append(tx);
          add(card);
        }
      }
    } else if (key === "fees") {
      head(key, T(key, "费用与缴费"));
      const t = el("table", null, { class: "yxd-table is-plain" });
      const rowf = (a, b, cls) => {
        const tr = el("tr", null, { class: cls || "" });
        tr.append(el("td", a), el("td", b, { class: "yxd-r" }));
        t.append(tr);
      };
      for (const s of M.path?.stages || []) {
        const c = CS[s.key];
        if (c) rowf(s.name || "阶段", c.pending ? "待定" : c.amount != null ? money(c.amount) : "已确定 " + money(c.known_amount));
      }
      if (C.unassigned?.known_amount) rowf("其他课程", money(C.unassigned.amount ?? C.unassigned.known_amount));
      for (const x of m.other_fees || []) rowf(x.label, x.amount != null ? money(x.amount) : "待定");
      if (m.discount?.type && m.discount.type !== "none" && C.discount?.amount) rowf("优惠" + (m.discount.note ? "（" + m.discount.note + "）" : ""), "− " + money(C.discount.amount));
      add(t);
      const card = el("div", null, { class: "yxd-total" });
      const done = C.total?.amount != null;
      card.append(el("small", done ? "应付总额" : "已确定费用"), el("b", done ? money(C.total.amount) : money(C.total?.known_amount), { class: "yxd-num" }), el("p", done ? (C.total.units ?? 0) + " 课时" + (C.installments?.length > 1 ? "，分 " + C.installments.length + " 期缴费" : "") : C.total?.has_tbd ? "另有“价格另议”的课程" : "部分课程待定，确定后另行报价"));
      add(card);
      if (done && C.installments?.length) {
        const it = el("table", null, { class: "yxd-table is-plain" });
        const hr = el("tr");
        for (const x of ["缴费", "日期", "金额"]) hr.append(el("th", x));
        it.append(hr);
        for (const x of C.installments) {
          const tr = el("tr");
          tr.append(el("td", x.label || ""), el("td", x.due ? x.due.replaceAll("-", ".") + " 前" : "—"), el("td", money(x.amount), { class: "yxd-r" }));
          it.append(tr);
        }
        add(it);
      }
      if (C.optional_fees?.length) add(el("p", "可选费用（不计入总价）：" + C.optional_fees.map((x) => x.label + (x.price_text ? " " + x.price_text : x.amount != null ? " " + money(x.amount) : "")).join("；"), { class: "yxd-note" }));
      if (m.note) add(el("p", m.note, { class: "yxd-note" }));
    } else if (key === "goals" && m.groups?.some((g) => g.items.length)) {
      head(key, T(key, "目标院校 / 目标"));
      for (const g of m.groups) {
        if (!g.items.length) continue;
        const t = el("table", null, { class: "yxd-table is-plain yxd2-goals" });
        if (g.title) {
          const hr = el("tr", null, { class: "yxd2-grp" });
          const td = el("td", g.title);
          td.colSpan = 3;
          hr.append(td);
          t.append(hr);
        }
        for (const x of g.items) {
          const tr = el("tr");
          const nm = el("td", x.name);
          if (en && x.name_en) nm.append(el("i", x.name_en, { class: "yxd2-en" }));
          tr.append(nm, el("td", x.tier || "", { class: "yxd2-type" }), el("td", x.note || ""));
          t.append(tr);
        }
        add(t);
      }
    } else if (key === "photos" && m.pages?.length) {
      for (const pg of m.pages) {
        const list = pg.images?.length ? pg.images : (pg.image_ids || []).map((id) => ({ id }));
        if (!list.length) continue;
        const per = pg.layout === "grid_3x3" ? 9 : 6;
        for (let i = 0; i < list.length; i += per) {
          const g = el("div", null, { class: "yxd2-photos is-" + (pg.layout === "grid_3x3" ? "g3" : "g2") });
          for (const x of list.slice(i, i + per)) {
            const u = img(x.id, x.url);
            if (u) g.append(el("img", null, { src: u, alt: pg.title || "" }));
          }
          add(el("h3", pg.title || "", { class: "yxd2-role" }), { keep: true, newPage: i === 0 });
          add(g);
        }
      }
    } else if (key === "about") {
      const text = m.text ?? rd.profile?.intro ?? "";
      const imgs = m.images?.length ? m.images : (m.image_ids || []).map((id) => ({ id }));
      if (!text && !imgs.length) continue;
      head(key, T(key, "机构介绍"));
      if (text) for (const c of yxd2Rich(text).children) add(c);
      if (imgs.length) {
        const g = el("div", null, { class: "yxd2-photos is-g3" });
        for (const x of imgs.slice(0, 6)) {
          const u = img(x.id, x.url);
          if (u) g.append(el("img", null, { src: u, alt: "" }));
        }
        add(g);
      }
    }
  }
  // 联系卡片
  const contact = el("div", null, { class: "yxd-contact" });
  const tx = el("div");
  tx.append(el("strong", rd.brand?.name || ""));
  for (const x of [rd.profile?.address, rd.profile?.class_hours ? "上课时间：" + rd.profile.class_hours : "", rd.profile?.contact_phone || ""]) if (x) tx.append(el("p", x));
  contact.append(tx);
  const qrUrl = rd.brand?.qr_url || (rd.brand?.qr_image_id && mediaUrl ? mediaUrl(rd.brand.qr_image_id) : null);
  if (qrUrl) {
    const qr = el("figure", null, { class: "yxd-qr" });
    qr.append(el("img", null, { src: qrUrl, alt: "咨询二维码" }), el("figcaption", "咨询二维码"));
    contact.append(qr);
  }
  if (blocks.length) add(contact);
  // 分页：挂到页面上后再量高度
  const paginate = () => {
    let cur = null,
      body = null;
    const fresh = () => {
      cur = page("yxd-inner");
      const hd = el("div", null, { class: "yxd-phead" });
      hd.append(el("span", (who ? who + " · " : "") + (rd.title || ""), { class: "yxd-phead-l" }), el("span", rd.brand?.name || ""));
      body = el("div", null, { class: "yxd2-body" });
      cur.append(hd, body, el("div", null, { class: "yxd-pfoot" }));
    };
    const over = () => body.scrollHeight > body.clientHeight + 1;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!cur || b.newPage) fresh();
      body.append(b.x);
      if (over() && body.childElementCount > 1) {
        // 放不下：换页；标题类块要和下一块一起走
        b.x.remove();
        const kids = [...body.children],
          carry = [];
        for (let k = kids.length - 1; k >= 0 && blocks.find((z) => z.x === kids[k])?.keep; k--) carry.unshift(kids[k]);
        if (carry.length === kids.length) carry.length = 0;
        for (const c of carry) c.remove();
        fresh();
        body.append(...carry, b.x);
      }
    }
    pages.forEach((p, i) => {
      const f = p.querySelector(".yxd-pfoot");
      if (!f) return;
      f.append(el("span", (rd.brand?.name || "") + " · 学习方案" + (i === pages.length - 1 ? " · 以签署的合同为准" : "")), el("span", String(i + 1).padStart(2, "0") + " / " + String(pages.length).padStart(2, "0")));
    });
    docEl.dispatchEvent(new Event("yxd-paged"));
  };
  let tries = 0;
  const wait = () => (docEl.isConnected ? paginate() : ++tries < 200 && requestAnimationFrame(wait));
  requestAnimationFrame(wait);
  return docEl;
}
