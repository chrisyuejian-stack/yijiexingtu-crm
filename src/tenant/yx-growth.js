// 艺界星途 · 课后反馈（老师手机端）、曲目单、员工审核页补充、家长端反馈与报告（Claude，接口 v0.3.7 §4.5）
// 反馈仍走旧的提交 / 确认流程：老师提交 → 教务确认（或机构开了自动确认）→ 家长才看到。

const YXG_STATUS = { not_submitted: ["待反馈", "warn"], pending: ["待确认", "info"], returned: ["已退回", "bad"], confirmed: ["已反馈", "ok"] };
const YXG_TAGS = ["新曲目完成", "读谱进步", "节奏稳定", "状态很好", "需要多练", "布置作业"];
const YXG_MSG = [["learned", "今天学了"], ["good", "做得好"], ["attention", "要注意"], ["homework", "回家练习"]];

function yxIsTeacher() {
  return me.user.roles.includes("teacher") && !!me.user.teacher_id;
}
function yxgDate(v) {
  return String(v || "").slice(0, 16).replace("T", " ");
}
// 四段拼成发给家长的一段话；旧的纯文字点评也用这段，旧页面照样能看。
function yxgText(m, name) {
  const parts = YXG_MSG.filter(([k]) => String(m?.[k] || "").trim()).map(([k, t]) => t + "：" + m[k].trim());
  return parts.length ? (name ? name + "家长您好，" : "") + parts.join("；") + "。" : "";
}

// 就地输入：把按钮换成一个输入框，回车或点别处提交。
function yxgAsk(btn, placeholder, done) {
  const box = el("input", null, { type: "text", placeholder, "aria-label": placeholder, maxlength: "40", class: "yxg-ask" });
  let sent = false;
  const finish = async () => {
    if (sent) return;
    sent = true;
    const v = box.value.trim();
    box.replaceWith(btn);
    if (v) await done(v);
  };
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish().catch((x) => notice(x.message));
    }
    if (e.key === "Escape") {
      box.value = "";
      finish();
    }
  });
  box.addEventListener("blur", () => finish().catch((x) => notice(x.message)));
  btn.replaceWith(box);
  box.focus();
}

// ---------- 老师：今天的课（设计稿 v3 老师手机端） ----------
async function yxFeedbackPage(c) {
  const data = await api("feedback/today");
  c.classList.add("yx-page", "yxg-v3");
  const items = data.items || [];
  const now = new Date();
  const hero = el("div", null, { class: "yxg-hero" });
  hero.append(
    el("p", now.toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Shanghai" }) + " · " + now.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Shanghai" }), { class: "yx-eyebrow" }),
    el("h1", "今天 " + items.length + " 节课"),
    el("p", "下课后 48 小时内提交出勤和反馈", { class: "yxg-hero-sub" }),
  );
  c.replaceChildren(hero);
  if (!items.length) return c.append(UI.empty({ text: "今天没有你的课。" }));
  const list = el("div", null, { class: "yxg-today" });
  for (const x of items) {
    const future = x.status === "not_submitted" && !x.can_submit && new Date(x.start_at) > now;
    const open = () => yxFeedbackEditor(c, x.lesson_id, () => yxFeedbackPage(c));
    const todo = x.status === "not_submitted" && !future && (x.can_submit || x.can_submit_comments);
    const card = el("button", null, { type: "button", class: "yxg-lcard" + (todo || x.status === "returned" ? " is-todo" : "") });
    const who = el("span", null, { class: "yxg-lcard-main" });
    who.append(el("strong", x.course_name || "课程"), el("small", (x.student_names?.length ? x.student_names.join("、") + " · " : "") + x.duration + "′", { class: "v-muted" }));
    let right;
    if (todo) right = el("span", "写反馈", { class: "yxg-go" });
    else if (x.status === "returned") right = el("span", "已退回 · 重写", { class: "yxg-go is-bad" });
    else if (future) right = el("span", "还没上", { class: "v-muted" });
    else {
      const s = YXG_STATUS[x.status] || [x.status, "muted"];
      right = el("span", x.status === "confirmed" ? "已确认" : s[0], { class: "yx-dot is-" + (s[1] === "info" ? "warn" : s[1]) });
    }
    card.append(el("span", x.start_at.slice(11, 16), { class: "yx-num yxg-time" }), who, right);
    card.addEventListener("click", open);
    list.append(card);
  }
  c.append(list);
  const pending = items.filter((x) => x.status === "pending").length;
  const left = items.filter((x) => x.status === "not_submitted" && (x.can_submit || x.can_submit_comments)).length;
  const returned = items.filter((x) => x.status === "returned").length;
  const todos = [
    ...(returned ? [["is-bad", returned + " 条反馈被退回，要重写"]] : []),
    ...(left ? [["is-warn", left + " 节课还没写反馈"]] : []),
    ...(pending ? [["", pending + " 条反馈待教务确认"]] : []),
  ];
  if (todos.length) {
    c.append(el("h2", "待处理", { class: "yxg-h2" }));
    const box = el("div", null, { class: "yxg-todo" });
    for (const [tone, t] of todos) box.append(el("p", t, { class: "yx-dot " + tone }));
    c.append(box);
  }
}

// ---------- 老师：写一节课的反馈 ----------
async function yxFeedbackEditor(c, lessonId, back) {
  const V = globalThis.ChannelV2;
  c.replaceChildren(UI.tableSkeleton());
  const data = await api("lessons/" + encodeURIComponent(lessonId) + "/review");
  const kind = data.can_submit_attendance ? "attendance" : data.can_submit_comments ? "comments" : null;
  const tags = new Set(YXG_TAGS);
  try {
    const rc = await api("settings/report-classes?limit=200");
    for (const r of rc.items || []) for (const d of r.dimensions || []) for (const t of d.feedback_tags || []) tags.add(t);
  } catch {}
  const reps = {};
  await Promise.all(
    data.participants.map((p) =>
      api("students/" + encodeURIComponent(p.student_id) + "/repertoire")
        .then((r) => (reps[p.student_id] = r.items || []))
        .catch(() => (reps[p.student_id] = [])),
    ),
  );
  const st = (c.__yxg ||= {});
  if (st.lesson !== lessonId) {
    st.lesson = lessonId;
    st.op = "op_" + yxUuid();
    st.applied = [];
  }
  const people = data.participants.map((p) => {
    const old = (data.personal || []).find((x) => x.student_id === p.student_id) || {};
    const draft = data.people.find((x) => x.participant_id === p.id) || {};
    return {
      p,
      attendance: draft.attendance && draft.attendance !== "planned" ? draft.attendance : p.attendance !== "planned" ? p.attendance : "attended",
      tags: new Set(old.tags || []),
      reps: new Set(old.repertoire_ids || []),
      note: old.note || (old.message ? "" : draft.comment || ""),
      message: { learned: "", good: "", attention: "", homework: "", ...(old.message || {}) },
      image_ids: old.image_ids || [],
      copied: old.copied_count || 0,
    };
  });
  const l = data.lesson;
  const today = null;
  c.classList.add("yx-page", "yxg-v3");
  const s = data.submission;
  const top = el("div", null, { class: "yxg-top" });
  const bk = el("button", "‹", { type: "button", class: "yxg-back", "aria-label": "返回今天的课" });
  bk.addEventListener("click", back);
  const tt = el("div");
  const one = data.participants.length === 1;
  tt.append(el("strong", (one ? data.participants[0].name : l.course_name) + " · 课后反馈"), el("small", Number(yxgDate(l.start_at).slice(5, 7)) + " 月 " + Number(yxgDate(l.start_at).slice(8, 10)) + " 日 " + yxgDate(l.start_at).slice(11, 16) + " · " + (one ? l.course_name : data.participants.length + " 位学员") + " · " + l.duration + "′", { class: "v-muted" }));
  top.append(bk, tt);
  if (s) {
    const t = YXG_STATUS[s.status] || [s.status, "muted"];
    top.append(el("span", s.status === "confirmed" ? "已确认" : t[0], { class: "yxg-badge is-" + t[1] }));
  }
  c.replaceChildren(top);
  void today;
  if (s?.status === "returned" && s.reason) c.append(el("p", "教务退回：" + s.reason, { class: "yxai-warn" }));
  if (!kind) c.append(el("p", data.window?.overdue ? "已超过提交时间（课后 48 小时），需要修改请联系教务。" : "这节课现在不能提交（只有主讲老师、在课程开始到结束后 48 小时内可以提交）。", { class: "v-muted" }));
  const autoConfirm = me.policy?.settings?.feedback_auto_confirm === true;
  const confirmed = s?.status === "confirmed";
  // 小组课：一次写一位学员，上方切换（已写好的打勾）。
  const host = el("div");
  const tabs = el("div", null, { class: "yxc-pills yxg-students" });
  const show = (i) => {
    st.who = i;
    tabs.querySelectorAll("button").forEach((b, j) => b.setAttribute("aria-pressed", String(j === i)));
    host.replaceChildren(yxgStudentCard(data, people[i], kind, tags, reps[people[i].p.student_id] || [], st, confirmed, () => drawTabs()));
  };
  const drawTabs = () => {
    tabs.replaceChildren();
    people.forEach((x, i) => {
      const b = button((yxgText(x.message) ? "✓ " : "") + x.p.name, () => show(i));
      b.classList.add("yxs-tab");
      b.setAttribute("aria-pressed", String(i === (st.who || 0)));
      tabs.append(b);
    });
  };
  if (people.length > 1) {
    drawTabs();
    c.append(tabs);
  }
  c.append(host);
  show(Math.min(st.who || 0, people.length - 1));
  if (!kind) return;
  // 小组课的全班内容
  let pub = null,
    hw = null;
  const pubOld = data.published.find((x) => !x.student_id);
  if (data.participants.length > 1) {
    const g = V.panel("全班内容（可空）");
    pub = yxcArea(pubOld?.text || "", "全班公共内容", () => {}, false, 2);
    hw = yxcArea(pubOld?.homework || "", "全班作业", () => {}, false, 2);
    pub.placeholder = "今天全班一起练了什么";
    hw.placeholder = "全班作业";
    g.append(pub, hw);
    c.append(g);
  }
  const bar = el("div", null, { class: "yxg-submit" });
  bar.append(
    button(autoConfirm ? "提交并发到家长端" : "提交出勤和反馈", async () => {
      // 家长端显示的是四段，所以每位学员至少要有一段（可以点“AI 整理成四段”）。
      for (const x of people) if (!yxgText(x.message)) throw Error(x.p.name + " 的反馈还没写：在四段里写一段，或点“AI 整理成四段”");
      await api("lessons/" + encodeURIComponent(lessonId) + "/review", "POST", {
        operation_id: st.op,
        kind,
        previous_id: s?.id || null,
        previous_version: s?.version,
        comment_fingerprint: data.comment_fingerprint,
        public_text: pub ? pub.value : "",
        homework: hw ? hw.value : "",
        people: people.map((x) => ({ participant_id: x.p.id, student_id: x.p.student_id, attendance: kind === "attendance" ? x.attendance : x.p.attendance, comment: yxgText(x.message) || x.note.trim() })),
        personal: people.map((x) => ({ student_id: x.p.student_id, tags: [...x.tags], repertoire_ids: [...x.reps], note: x.note.trim(), message: x.message, image_ids: x.image_ids })),
        applied_suggestion_ids: st.applied,
      });
      st.lesson = null;
      notice(autoConfirm ? "已发到家长端" : "已提交，教务确认后家长就能看到", "success");
      await yxFeedbackEditor(c, lessonId, back);
    }, "primary"),
  );
  bar.append(el("small", autoConfirm ? "本机构开了自动确认：提交即销课并发给家长。" : "教务确认后，家长端才会看到，这时才能复制到微信", { class: "v-muted" }));
  c.append(bar);
}
function yxgStudentCard(data, x, kind, tags, reps, st, confirmed, changed) {
  const ro = !kind,
    sid = x.p.student_id;
  const card = el("section", null, { class: "yxg-card yxg-v3card", "aria-label": x.p.name });
  // 出勤：几个按钮直接点
  if (kind === "attendance") {
    const seg = el("div", null, { class: "yxg-att", role: "radiogroup", "aria-label": x.p.name + " 出勤" });
    for (const [k, t] of Object.entries(me.labels.attendance || {})) {
      if (k === "planned") continue;
      const b = el("button", t, { type: "button", role: "radio", "aria-checked": String(x.attendance === k) });
      b.addEventListener("click", () => {
        x.attendance = k;
        seg.querySelectorAll("button").forEach((y) => y.setAttribute("aria-checked", String(y === b)));
      });
      seg.append(b);
    }
    card.append(seg);
  }
  const chip = (text, on, toggle) => {
    const b = el("button", text, { type: "button", class: "yxg-chip", "aria-pressed": String(on) });
    b.disabled = ro;
    b.addEventListener("click", () => b.setAttribute("aria-pressed", String(toggle())));
    return b;
  };
  // 今天学了：来自学员曲目单
  card.append(el("small", "今天学了 · 来自学员曲目单", { class: "yxg-label" }));
  const rp = el("div", null, { class: "yxg-chips" });
  const live = reps.filter((r) => r.status === "learning" || x.reps.has(r.id));
  const repChip = (r) => chip(r.name, x.reps.has(r.id), () => (x.reps.has(r.id) ? x.reps.delete(r.id) : x.reps.add(r.id), x.reps.has(r.id)));
  for (const r of live) rp.append(repChip(r));
  if (!ro) {
    const addRep = el("button", "＋ 新曲目", { type: "button", class: "yxg-chip is-add" });
    addRep.addEventListener("click", () =>
      yxgAsk(addRep, "曲目或作品名称", async (name) => {
        const r = await api("students/" + encodeURIComponent(sid) + "/repertoire", "POST", { name, status: "learning", start_date: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }), completed_date: null, image_ids: [] });
        reps.push(r);
        x.reps.add(r.id);
        addRep.before(repChip(r));
      }),
    );
    rp.append(addRep);
  }
  if (!live.length && ro) rp.append(el("span", "—", { class: "v-muted" }));
  card.append(rp);
  // 表现：按打分维度的常用要点
  card.append(el("small", "表现 · 按打分维度", { class: "yxg-label" }));
  const chips = el("div", null, { class: "yxg-chips" });
  const drawChips = () => {
    chips.replaceChildren();
    for (const t of new Set([...tags, ...x.tags])) chips.append(chip(t, x.tags.has(t), () => (x.tags.has(t) ? x.tags.delete(t) : x.tags.add(t), x.tags.has(t))));
    if (!ro) {
      const add = el("button", "＋ 自己写", { type: "button", class: "yxg-chip is-add" });
      add.addEventListener("click", () =>
        yxgAsk(add, "写一个要点", (v) => {
          x.tags.add(v.slice(0, 20));
          drawChips();
        }),
      );
      chips.append(add);
    }
  };
  drawChips();
  card.append(chips);
  // 补充一句
  const note = el("input", null, { type: "text", class: "yxg-note", value: x.note, placeholder: "补充：作业、要提醒家长的事（可用键盘语音输入）", "aria-label": "补充一句", maxlength: "300" });
  note.disabled = ro;
  note.addEventListener("input", () => (x.note = note.value));
  card.append(note);
  // 发给家长的话：四段，可直接改；AI 整理的先给建议，点“填入”才写进来
  const out = el("div", null, { class: "yxg-out" });
  const oh = el("div", null, { class: "yxg-out-h" });
  const label = el("strong", "发给家长的话");
  oh.append(el("span", "✦", { class: "yxg-spark", "aria-hidden": "true" }), label);
  if (st.aiFilled?.[sid]) oh.append(el("span", "AI 整理 · 可直接改", { class: "yxv-tag is-ai" }));
  out.append(oh);
  const areas = {};
  for (const [k, t] of YXG_MSG) {
    const row = el("label", null, { class: "yxg-row" });
    row.append(el("span", t));
    areas[k] = yxcArea(x.message[k] || "", t, (v) => {
      x.message[k] = v;
      areas[k].classList.remove("yx-ai-filled");
      changed?.();
    }, ro, 1);
    if (st.aiFilled?.[sid]?.has(k)) areas[k].classList.add("yx-ai-filled");
    row.append(areas[k]);
    out.append(row);
  }
  const aiOut = el("div");
  // 老师的 AI 权限按“本人主讲”逐次判断，前端只看角色。
  if (!ro && (enabled("ai", "use") || yxIsTeacher())) {
    oh.append(
      el("span", null, { class: "v-spacer" }),
      yxAiButton("AI 整理", async () => {
        if (!x.tags.size && !x.note.trim() && !x.reps.size) throw Error("先点几个要点或补充一句");
        const r = await yxAi("feedback/compose", { lesson_id: data.lesson.id, student_id: sid, tags: [...x.tags], repertoire_ids: [...x.reps], note: x.note.trim() });
        aiOut.replaceChildren();
        const w = yxAiWarnings(r.warnings);
        if (w) aiOut.append(w);
        const sg = r.suggestions[0];
        if (!sg) return aiOut.append(el("p", "这次没有可用的建议，换个说法再试。", { class: "v-muted" }));
        const m = sg.payload.message;
        const box = el("div", null, { class: "yxr-sug" });
        box.append(el("p", yxgText(m), { class: "yxc-pre" }), yxAiBasis(sg.basis));
        const acts = el("div", null, { class: "yxv-row" });
        const fill = button("填入", () => {
          (st.aiFilled ||= {})[sid] = new Set();
          for (const [k] of YXG_MSG) {
            x.message[k] = m[k] || "";
            areas[k].value = x.message[k];
            if (x.message[k]) {
              areas[k].classList.add("yx-ai-filled");
              st.aiFilled[sid].add(k);
            }
          }
          st.applied = [...new Set([...st.applied, sg.id])];
          aiOut.replaceChildren();
          changed?.();
        }, "primary");
        fill.classList.add("yxai-btn");
        acts.append(fill, button("不要", () => aiOut.replaceChildren()));
        box.append(acts);
        aiOut.append(box);
      }),
    );
  }
  out.append(aiOut);
  card.append(out);
  // 复制到微信：只有已确认的版本可以复制，和家长端看到的一致。
  const pubText = data.published.find((p) => p.student_id === sid)?.text;
  if (confirmed && pubText) {
    card.append(
      button("复制到微信" + (x.copied ? "（已复制 " + x.copied + " 次）" : ""), async () => {
        await yxcCopyText(pubText);
        await api("feedback/" + encodeURIComponent(data.submission.id) + "/" + encodeURIComponent(sid) + "/copied", "POST", {}).catch(() => {});
      }),
    );
  }
  return card;
}
function yxReviewPersonal(c, data) {
  if (!data.personal?.length) return;
  const V = globalThis.ChannelV2;
  const box = V.panel("老师填写的课后反馈");
  for (const x of data.personal) {
    const name = data.participants.find((p) => p.student_id === x.student_id)?.name || "";
    box.append(el("h3", name));
    if (x.tags?.length) {
      const t = el("div", null, { class: "yxai-tags" });
      for (const g of x.tags) t.append(V.chip(g, "muted"));
      box.append(t);
    }
    box.append(el("p", yxgText(x.message) || x.note || "（未填写）", { class: "preserve-text" }));
  }
  c.append(box);
}

// ---------- 学员详情：曲目 / 作品单 ----------
async function yxRepertoireTab(body, studentId) {
  const V = globalThis.ChannelV2;
  const data = await api("students/" + encodeURIComponent(studentId) + "/repertoire");
  const again = () => yxRepertoireTab(body, studentId);
  body.replaceChildren();
  const box = V.panel("曲目 / 作品单");
  const can = enabled("growth_reports", "write") || yxIsTeacher();
  if (can) box.append(button("＋ 新增", () => yxRepForm(studentId, null, again), "primary"));
  if (!data.items?.length) box.append(el("p", "还没有记录。老师写课后反馈时也可以直接加新曲目。", { class: "v-muted v-pad" }));
  for (const r of data.items || []) {
    const line = el("button", null, { type: "button", class: "yxp-item" }),
      who = el("span", null, { class: "yxp-item-main" });
    who.append(el("strong", r.name), el("small", (r.start_date || "") + (r.completed_date ? " → " + r.completed_date : ""), { class: "v-muted" }));
    line.append(who, V.chip(r.status === "done" ? "已完成" : "在练", r.status === "done" ? "ok" : "info"));
    if (can) line.addEventListener("click", () => yxRepForm(studentId, r, again));
    box.append(line);
  }
  body.append(box);
}
function yxRepForm(studentId, r, again) {
  const { panel, close } = drawer(r ? "编辑曲目 / 作品" : "新增曲目 / 作品"),
    form = el("form");
  field(form, "名称", "name", "text", r?.name || "");
  yxsSelect(form, "状态", "status", [["learning", "在练"], ["done", "已完成"]], r?.status || "learning");
  field(form, "开始日期", "start_date", "date", r?.start_date || "", false);
  field(form, "完成日期（已完成时必填）", "completed_date", "date", r?.completed_date || "", false);
  submit(form, "保存", async (d) => {
    const doc = { name: d.name.trim(), status: d.status, start_date: d.start_date || null, completed_date: d.completed_date || null };
    if (doc.status === "done" && !doc.completed_date) throw Error("已完成的曲目要填完成日期");
    const path = "students/" + encodeURIComponent(studentId) + "/repertoire";
    await (r ? api(path, "PUT", { id: r.id, version: r.version, ...doc }) : api(path, "POST", { ...doc, image_ids: [] }));
    await close();
    await again();
  });
  panel.append(form);
}

// ---------- 家长端 ----------
async function yxParentFeed(type) {
  const r = await api("parent/children/" + encodeURIComponent(yxState.child) + "/feed?limit=50");
  return (r.items || []).filter((x) => x.type === type);
}
async function yxParentFeedback(content) {
  const items = await yxParentFeed("feedback");
  // 还没有新版反馈时，沿用原来的上课记录页面。
  if (!items.length) return globalThis["ChannelV2" + "Mobile"].studentRecords(content);
  const V = globalThis.ChannelV2;
  content.replaceChildren(el("h1", "课后反馈"));
  // 课后反馈卡片（设计稿 v3）：主色抬头 + 四段，颜色跟机构主色。
  const n = items.length;
  const th = getComputedStyle(document.documentElement).getPropertyValue("--theme").trim();
  const on = /^#[0-9a-f]{6}$/i.test(th) && yxdContrast("#ffffff", th) < 4.5 ? "#211a30" : "#ffffff";
  items.forEach((x, i) => {
    const card = el("article", null, { class: "yxfc" });
    card.style.setProperty("--fc-on", on);
    const hd = el("div", null, { class: "yxfc-head" });
    const l = el("div");
    l.append(el("small", brand?.display_name || ""), el("strong", "课后反馈"), el("span", [x.title, yxgDate(x.at).slice(5, 10).replace("-", " 月 ") + " 日"].filter(Boolean).join(" · ")));
    hd.append(l, el("span", "No." + (n - i), { class: "yxfc-no" }));
    card.append(hd);
    const body = el("div", null, { class: "yxfc-body" });
    if (x.tags?.length) {
      const t = el("div", null, { class: "yxfc-tags" });
      for (const g of x.tags) t.append(el("span", g));
      body.append(t);
    }
    for (const [k, t] of YXG_MSG)
      if (x.message?.[k]) {
        const r = el("div", null, { class: "yxfc-row" });
        r.append(el("b", t), el("p", x.message[k], { class: "preserve-text" }));
        body.append(r);
      }
    if (x.public_comment) {
      const r = el("div", null, { class: "yxfc-row" });
      r.append(el("b", "全班"), el("p", x.public_comment, { class: "preserve-text" }));
      body.append(r);
    }
    if (x.image_urls?.length) {
      const g = el("div", null, { class: "yxfc-imgs" });
      for (const u of x.image_urls) g.append(el("img", null, { src: u, alt: "课堂照片", loading: "lazy" }));
      body.append(g);
    }
    card.append(body);
    content.append(card);
  });
}
async function yxParentReports(content) {
  const items = await yxParentFeed("report");
  const V = globalThis.ChannelV2;
  content.replaceChildren(el("h1", "成长报告"));
  if (!items.length) return content.append(UI.empty({ text: "老师发布阶段报告后，会显示在这里。" }));
  const box = V.panel("已发布的报告");
  for (const x of items) {
    const line = el("button", null, { type: "button", class: "yxp-item" }),
      who = el("span", null, { class: "yxp-item-main" });
    who.append(el("strong", x.title || "成长报告"), el("small", yxgDate(x.at).slice(0, 10), { class: "v-muted" }));
    line.append(who);
    line.addEventListener("click", async () => {
      const r = await api("parent/reports/" + encodeURIComponent(x.id));
      content.replaceChildren(button("‹ 成长报告", () => yxParentReports(content)));
      content.append(yxReportDocument(r.render_data, r.manifest, (id) => base + "api/parent/media/" + encodeURIComponent(id)));
      content.append(el("div", null, { class: "yxg-submit" }));
      content.lastChild.append(button("保存为图片或 PDF", () => print()));
    });
    box.append(line);
  }
  content.append(box);
}
