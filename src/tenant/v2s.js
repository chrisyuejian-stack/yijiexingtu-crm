// 第十阶段重构（v2）第 6 组：班级（B6 名单）、固定排课（按周看板）、课程与教室。
// 只读既有接口；写入全部沿用原表单与原写入路径。
(() => {
  "use strict";
  const n = el,
    F = UI.fmt,
    V = () => globalThis.ChannelV2,
    P = () => globalThis.ChannelV2People,
    R = () => globalThis.ChannelRebuild;
  const chip = (text, tone) => V().chip(text, tone);
  const link = (text, fn) => V().link(text, fn);
  const WD = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const old = { classesPage, templatesPage, settingsPage };
  const inPage = (c) => !!c?.closest?.(".v-content") && !c.closest(".ui-overlay, .ui-sheet, .v-detail");
  const endTime = (start, minutes) => {
    const [h, m] = start.split(":").map(Number),
      t = h * 60 + m + Number(minutes || 0);
    return String(Math.floor(t / 60) % 24).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
  };
  // 课程类型 → 大类颜色（与周课表同一套配色）。
  async function lookups() {
    const [types, cats] = await Promise.all([R().take("data/course_types"), R().take("data/course_categories")]);
    const color = new Map(types.map((t) => [t.id, cats.find((x) => x.id === t.category_id)?.color || ""]));
    return { types, cats, colorOf: (typeId) => V().colorClass({ category_color: color.get(typeId) }) };
  }

  // ---------- 班级 ----------
  const cState = { selected: null };
  async function classes(c) {
    const [raw, look, templates, teachers, rooms] = await Promise.all([
      R().take("tools/classes"),
      lookups(),
      enabled("templates") ? R().take("data/schedule_templates") : [],
      choices("teachers"),
      choices("locations"),
    ]);
    // 班级记录只带 id；名字从教师、教室列表里查。
    const rows = raw.map((r) => ({
      ...r,
      teacher_name: r.teacher_name || teachers.find((t) => t.id === r.teacher_id)?.name || "",
      location_name: r.location_name || rooms.find((x) => x.id === r.location_id)?.name || "",
    }));
    // 没有班级时只保留空白页里的那一个“新建班级”，页头不再重复。
    vHead?.actions(enabled("classes", "create") && rows.length ? button("＋ 新建班级", () => classForm(c), "primary") : null);
    c.replaceChildren();
    if (!rows.length) {
      const box = n("section", null, { class: "v-panel v-cl-empty" });
      box.append(
        n("h2", "还没有班级"),
        n("p", "班级用来管固定名单：小班课、集训班、乐理班。建好后可以整班排课、整班销课，每周固定课程自动带入全班学员。", { class: "v-muted" }),
      );
      if (enabled("classes", "create")) box.append(button("＋ 新建班级", () => classForm(c), "primary"));
      c.append(box);
      return;
    }
    const members = await R().take("tools/class_members");
    const active = rows.filter((r) => r.status === "active"),
      sorted = [...active, ...rows.filter((r) => r.status !== "active")];
    const current = sorted.find((r) => r.id === cState.selected) || sorted[0];
    cState.selected = current.id;
    const typeName = (id) => look.types.find((t) => t.id === id)?.name || "未设置课程";
    const weekly = (id) => templates.filter((t) => t.class_id === id && t.active !== 0).sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
    const cards = n("div", null, { class: "v-cl-cards" });
    for (const r of sorted) {
      const cnt = members.filter((m) => m.class_id === r.id).length,
        w = weekly(r.id);
      const card = n("button", null, {
        type: "button",
        class: "v-cl-card " + look.colorOf(r.course_type_id) + (r.id === current.id ? " is-on" : "") + (r.status !== "active" ? " is-gone" : ""),
        "aria-pressed": String(r.id === current.id),
      });
      const t = n("strong");
      t.append(n("i", null, { class: "v-cl-dot" }), r.name);
      card.append(
        t,
        n(
          "span",
          [r.teacher_name, w.length ? [...new Set(w.map((x) => WD[x.weekday]))].join("、") + " " + w[0].start_time : "未设每周课"].filter(Boolean).join(" · "),
          { class: "v-muted" },
        ),
      );
      const foot = n("span", null, { class: "v-cl-foot" });
      foot.append(chip(r.status === "active" ? "在读" : "已归档", r.status === "active" ? "ok" : "muted"), n("span", cnt + " 人"));
      card.append(foot);
      card.addEventListener("click", () => {
        cState.selected = r.id;
        void classes(c);
      });
      cards.append(card);
    }
    c.append(cards);
    await classDetail(c, current, look, weekly(current.id), typeName);
  }
  async function classDetail(c, cls, look, weekly, typeName) {
    const [details, roster] = await Promise.all([api("tools/classes/" + cls.id), api("c3/classes/" + cls.id + "/roster")]);
    const members = details.members,
      byStudent = new Map(roster.items.map((r) => [r.student_id, r]));
    const again = () => classes(c);
    const head = n("section", null, { class: "v-panel v-cl-head" });
    const title = n("div", null, { class: "v-cl-title" });
    const h = n("h2", cls.name);
    title.append(h, chip(cls.status === "active" ? "在读" : "已归档", cls.status === "active" ? "ok" : "muted"));
    const meta = n("p", null, { class: "v-detail-sub v-csegs" });
    for (const part of [
      typeName(cls.course_type_id),
      "主讲 " + (cls.teacher_name || "未设置"),
      cls.location_name || (cls.location_id ? "" : "线上 / 未定教室"),
      members.length + " 人",
      cls.date_from + " 至 " + cls.date_to,
    ].filter(Boolean))
      meta.append(n("span", part, { class: "v-cseg" }));
    const left = n("div", null, { class: "v-cl-main" });
    left.append(title, meta);
    if (cls.note) left.append(n("p", cls.note, { class: "v-muted v-cl-note" }));
    const ops = n("div", null, { class: "v-detail-ops" });
    const presets = {
      class_id: cls.id,
      teacher_id: cls.teacher_id,
      course_type_id: cls.course_type_id,
      location_id: cls.location_id,
      date_from: cls.date_from,
      date_to: cls.date_to,
      participants: members.map((m) => ({ student_id: m.student_id })),
    };
    if (enabled("classes", "update")) ops.append(button("编辑班级", () => classForm(P().sink(again), cls)));
    if (enabled("classes", "create") && cls.status === "active") ops.append(button("添加学员", () => addMembers(cls, members, again)));
    if (enabled("lessons", "create") && cls.status === "active")
      ops.append(button("整班排一节课", () => lessonForm(P().sink(again), presets), members.length ? "primary" : ""));
    if (enabled("classes", "delete"))
      ops.append(
        UI.actionMenu({
          items: [
            {
              label: "删除班级",
              danger: true,
              onSelect: () =>
                globalThis.ChannelV2Pay.removeItem({
                  title: "删除班级“" + cls.name + "”？",
                  consequence: members.length ? "班里还有 " + members.length + " 位学员，需要先移除成员，或改为归档。" : "删除后不再显示，已上过的课不受影响。",
                  path: "tools/classes/" + cls.id,
                  body: { version: cls.version },
                  done: again,
                }),
            },
          ],
        }).element,
      );
    head.append(left, ops);
    c.append(head);

    const grid = n("div", null, { class: "v-cl-grid" });
    // 名单（B6）：剩余课时 + 最近出勤
    const list = V().panel("学员名单 · " + members.length);
    const low = Number(me.policy?.settings?.low_balance_threshold ?? 3);
    if (!members.length) {
      list.append(n("p", "还没有学员。点“添加学员”把在读学员加入这个班。", { class: "v-muted v-pad" }));
    } else {
      const showBal = roster.items.some((r) => "balance" in r);
      const t = n("table", null, { class: "v-table" }),
        hr = n("tr");
      for (const [label, cls2] of [["学员", ""], ...(showBal ? [["剩余课时", "is-num"]] : []), ["最近出勤", ""], ["状态", ""], ["", "is-act"]])
        hr.append(n("th", label, cls2 ? { class: cls2 } : {}));
      const thead = n("thead"),
        tbody = n("tbody");
      thead.append(hr);
      const ATT = { attended: ["到", "ok"], student_leave: ["假", "warn"], no_show: ["旷", "bad"], teacher_leave: ["师假", "muted"], cancelled: ["消", "muted"] };
      for (const m of [...members].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))) {
        const r = byStudent.get(m.student_id) || {};
        const tr = n("tr");
        const nameCell = n("td"),
          nm = n("button", m.name, { type: "button", class: "v-cell-link" });
        nm.addEventListener("click", () => R().goStudent(m.student_id));
        nameCell.append(nm);
        tr.append(nameCell);
        if (showBal) tr.append(n("td", r.balance === undefined || r.balance === null ? "—" : String(r.balance), { class: "is-num" + (r.balance <= 0 ? " v-bal-zero" : r.balance <= low ? " v-bal-low" : "") }));
        const att = n("td"),
          dots = n("span", null, { class: "v-att-dots" });
        const recent = [...(r.recent_attendance || [])].reverse();
        for (const a of recent) {
          const [t2, tone] = ATT[a.attendance] || ["·", "muted"];
          const d = n("i", t2 === "到" ? "" : t2, { class: "v-att v-att-" + tone, title: P().dayLabel(String(a.start_at).slice(0, 10)) + " " + (ATT[a.attendance]?.[0] || "未点名") });
          dots.append(d);
        }
        att.append(recent.length ? dots : n("span", "还没上过课", { class: "v-muted" }));
        tr.append(att);
        const st = n("td");
        st.append(
          !showBal || r.balance === undefined
            ? chip("在读", "ok")
            : r.balance <= 0
              ? chip("课时已用完", "bad")
              : r.balance <= low
                ? chip("课时不足", "warn")
                : chip("在读", "ok"),
        );
        tr.append(st);
        const act = n("td", null, { class: "is-act" });
        if (enabled("classes", "delete"))
          act.append(
            UI.actionMenu({
              items: [
                {
                  label: "移出班级",
                  danger: true,
                  onSelect: async () => {
                    if (!(await UI.confirm({ title: "把 " + m.name + " 移出班级？", consequence: "只移出固定名单，已生成的课程和历史记录不变。", danger: true }))) return;
                    await api("tools/class_members/" + m.id, "DELETE", { version: m.version });
                    await again();
                  },
                },
              ],
            }).element,
          );
        tr.append(act);
        tbody.append(tr);
      }
      t.append(thead, tbody);
      const wrap = n("div", null, { class: "v-cl-roster" });
      wrap.append(t);
      list.append(wrap, n("p", "最近出勤：从左到右是最近 7 节已开始的课，绿点是到课；“假”是请假，“旷”是旷课。", { class: "v-muted v-fin-note" }));
    }
    // 每周固定课程
    const extra = enabled("templates", "create") && cls.status === "active" ? link("＋ 添加", () => recordForm(P().sink(again), "schedule_templates", presets)) : null;
    const week = V().panel("每周固定课程", extra);
    if (!weekly.length) week.append(n("p", "还没有每周固定课程。添加后，在“固定排课”里生成未来课程时会自动带入全班学员。", { class: "v-muted v-pad" }));
    for (const t of weekly) {
      const line = n("button", null, { type: "button", class: "v-cl-week " + look.colorOf(t.course_type_id) });
      line.append(
        n("strong", WD[t.weekday]),
        n("span", t.start_time + "–" + endTime(t.start_time, t.duration), { class: "v-cl-time" }),
        n("span", (t.course_name || typeName(t.course_type_id)) + " · " + (t.teacher_name || "") + (t.location_name ? " · " + t.location_name : ""), { class: "v-muted" }),
      );
      line.addEventListener("click", () => (enabled("templates", "update") ? recordForm(P().sink(again), "schedule_templates", t) : null));
      week.append(line);
    }
    if (weekly.length) week.append(n("p", "生成课程时，名单里的学员自动加入每节课；单个学员请假在那节课里单独登记。", { class: "v-muted v-fin-note" }));
    grid.append(list, week);
    c.append(grid);
  }
  // 固定排课加学员：卡片多选 + 起止日期；每人一条报名（data/schedule_enrollments POST），和原来单个加学员的写入相同。
  async function addEnrollees(r, who, reopen) {
    const day = "周" + "一二三四五六日"[r.weekday] + " " + String(r.start_time).slice(0, 5);
    const view = UI.drawer({ title: "加学员 · " + day, subtitle: "只列出在读、还没报名这节固定课的学员。" });
    const all = (await choices("students")).filter((s) => s.status === "active" && !who.some((e) => e.student_id === s.id));
    const f = n("form", null, { class: "v-pick-form" });
    const pick = studentPicker(f, { students: all, selected: [], legend: "选择学员" });
    f.append(pick.element);
    const from = UI.field({ label: "从哪天开始", name: "date_from", type: "date", value: r.date_from, required: true }),
      to = UI.field({ label: "到哪天结束", name: "date_to", type: "date", value: r.date_to, required: true });
    from.element.classList.add("field");
    to.element.classList.add("field");
    f.append(from.element, to.element);
    if (!all.length) f.append(n("p", "没有可加入的在读学员。", { class: "v-muted" }));
    submit(f, "加入这节固定课", async (d) => {
      const ids = [...pick.chosen];
      if (!ids.length) throw Error("请先选择学员");
      const names = new Map(all.map((s) => [s.id, s.name]));
      for (const id of ids) {
        try {
          await api("data/schedule_enrollments", "POST", { template_id: r.id, student_id: id, date_from: d.date_from, date_to: d.date_to });
        } catch (e) {
          throw Error((names.get(id) || "学员") + "：" + e.message + "（前面已加入的不受影响）");
        }
      }
      await view.close();
      await reopen();
    });
    view.body.append(f);
    standardForm(f);
  }

  // 与原“批量加入学员”相同的写入（tools/classes/:id/members POST）。
  async function addMembers(cls, members, again) {
    const view = UI.drawer({ title: "添加学员 · " + cls.name, subtitle: "只列出在读、还不在这个班里的学员。" });
    const all = (await choices("students")).filter((s) => s.status === "active" && !members.some((m) => m.student_id === s.id));
    const f = n("form", null, { class: "v-pick-form" });
    const pick = studentPicker(f, { students: all, selected: [], legend: "选择学员" });
    f.append(pick.element);
    if (!all.length) f.append(n("p", "没有可加入的在读学员。", { class: "v-muted" }));
    submit(f, "加入所选学员", async () => {
      const ids = [...pick.chosen];
      if (!ids.length) throw Error("请先选择学员");
      await api("tools/classes/" + cls.id + "/members", "POST", { student_ids: ids });
      await view.close();
      await again();
    });
    view.body.append(f);
    standardForm(f);
  }

  // ---------- 固定排课：按周看板 ----------
  async function templates(c) {
    // 五份数据一起取（教师、教室、课程名单多半已在缓存里）。
    const [rows, enrollments, look, teachers, rooms] = await Promise.all([
      R().take("data/schedule_templates"),
      R().take("data/schedule_enrollments"),
      lookups(),
      R().take("data/teachers"),
      R().take("data/locations"),
    ]);
    const again = () => templates(c);
    // 原“学员报名”页并入这里：每节固定课的详情里直接看、加、退学员。
    vHead?.actions(
      enabled("templates", "create") ? button("＋ 固定排课", () => recordForm(P().sink(again), "schedule_templates")) : null,
      enabled("templates", "create") ? button("生成未来课程", () => generate(c, look, teachers, rooms), "primary") : null,
    );
    c.replaceChildren();
    const live = rows.filter((r) => r.active !== 0);
    const students = new Set(enrollments.map((e) => e.student_id)).size;
    const ends = live.map((r) => r.date_to).sort();
    c.append(
      n(
        "p",
        "共 " + live.length + " 个每周固定课 · " + students + " 位学员报名" + (ends.length ? " · 最早到期 " + ends[0] : "") + "。点卡片看报名学员、加学员或改时间；“生成未来课程”会先预览再写入。",
        { class: "v-muted v-tp-sum" },
      ),
    );
    if (!rows.length) {
      c.append(
        UI.empty({
          text: "固定排课用于按有效期与报名名单批量生成未来课程。",
          action: enabled("templates", "create") ? { label: "新建固定排课", onSelect: () => recordForm(P().sink(again), "schedule_templates") } : null,
        }),
      );
      return;
    }
    const board = n("div", null, { class: "v-tp-board" });
    for (let i = 0; i < 7; i++) {
      const col = n("section", null, { class: "v-tp-col" });
      const list = rows.filter((r) => r.weekday === i).sort((a, b) => a.start_time.localeCompare(b.start_time));
      const h = n("header");
      h.append(n("h3", WD[i]), n("span", list.length ? String(list.length) : "", { class: "v-lead-count" }));
      col.append(h);
      for (const r of list) {
        const who = enrollments.filter((e) => e.template_id === r.id);
        const card = n("article", null, { class: "v-tp-card " + look.colorOf(r.course_type_id) + (r.active === 0 ? " is-off" : ""), tabindex: "0", role: "button" });
        card.append(
          n("span", r.start_time + "–" + endTime(r.start_time, r.duration), { class: "v-tp-time" }),
          n("strong", r.course_name || "未设置课程"),
          n("span", (r.teacher_name || "未设老师") + " · " + (r.location_name || "未定教室"), { class: "v-muted" }),
        );
        const foot = n("span", null, { class: "v-tp-foot" });
        foot.append(n("span", r.class_id ? "班级名单" : who.length + " 位学员"), n("span", untilText(r.date_to), { class: "v-muted" }));
        card.append(foot);
        if (r.active === 0) card.append(chip("已停用", "muted"));
        card.title = who.map((e) => e.student_name).join("、");
        const openIt = () => details(c, r, who, again);
        card.addEventListener("click", openIt);
        card.addEventListener("keydown", (e) => e.key === "Enter" && openIt());
        col.append(card);
      }
      if (!list.length) col.append(n("p", "—", { class: "v-lead-empty" }));
      // 每天一列，列底部可快速在这一天新建固定课（星期已填好）。
      if (enabled("templates", "create")) {
        const add = n("button", "＋ 在" + WD[i] + "添加", { type: "button", class: "v-tp-add" });
        add.addEventListener("click", () => recordForm(P().sink(again), "schedule_templates", { weekday: i }));
        col.append(add);
      }
      board.append(col);
    }
    c.append(board);
  }
  // “不限”日期（1900 起 / 2099 止）一律写“长期”，不显示占位日期。
  const isOpenEnd = (d) => !d || d >= "2099-01-01";
  const isOpenStart = (d) => !d || d <= "1901-01-01";
  const untilText = (d) => (isOpenEnd(d) ? "长期" : "至 " + d.slice(5));
  const spanText = (from, to) =>
    (isOpenStart(from) ? "" : from + " 起") + (isOpenEnd(to) ? (isOpenStart(from) ? "长期" : " · 长期") : " 至 " + to);
  async function details(c, r, who, again) {
    const view = UI.drawer({
      title: WD[r.weekday] + " " + r.start_time + "–" + endTime(r.start_time, r.duration) + " · " + (r.course_name || "未设置课程"),
      subtitle: (r.teacher_name || "未设老师") + " · " + (r.location_name || "未定教室") + " · " + spanText(r.date_from, r.date_to),
    });
    // 加学员/退学员后重读看板，并重新打开这节课的详情。
    const reopen = async () => {
      await again();
      const [rows, enrollments] = await Promise.all([R().take("data/schedule_templates"), R().take("data/schedule_enrollments")]);
      const fresh = rows.find((x) => x.id === r.id);
      if (fresh) await details(c, fresh, enrollments.filter((e) => e.template_id === r.id), again);
    };
    const p = V().panel(r.class_id ? "按班级名单生成" : "报名学员 · " + who.length + " 人");
    if (!r.class_id) {
      if (enabled("templates", "create")) {
        const add = button("＋ 加学员", async () => {
          await view.close();
          await addEnrollees(r, who, reopen);
        });
        add.classList.add("v-tp-addstu");
        (p.querySelector("header") || p).append(add);
      }
      const roster = n("div", null, { class: "v-tp-roster" });
      for (const e of who.slice().sort((a, b) => String(a.student_name).localeCompare(String(b.student_name), "zh-CN"))) {
        const row = n("div", null, { class: "v-tp-rr" });
        row.append(
          n("span", Array.from(e.student_name || "?")[0], { class: "v-avatar-mark", "aria-hidden": "true" }),
          (() => {
            const t = n("div");
            t.append(
              link(e.student_name, async () => {
                await view.close();
                R().goStudent(e.student_id);
              }),
              n("div", spanText(e.date_from, e.date_to), { class: "v-muted" }),
            );
            return t;
          })(),
        );
        const acts = n("span", null, { class: "v-tp-racts" });
        if (enabled("templates", "update"))
          acts.append(
            link("改日期", async () => {
              await view.close();
              recordForm(P().sink(reopen), "schedule_enrollments", e);
            }),
          );
        if (enabled("templates", "delete"))
          acts.append(
            link("退出", async () => {
              if (!(await UI.confirm({ title: e.student_name + " 退出这节固定课？", consequence: "已经生成的课程不受影响；之后再生成时不再带上这位学员。", danger: true }))) return;
              await api("data/schedule_enrollments/" + e.id, "DELETE", { version: e.version });
              await view.close();
              await reopen();
            }),
          );
        row.append(acts);
        roster.append(row);
      }
      p.append(who.length ? roster : n("p", "还没有学员。点“＋ 加学员”登记谁固定上这节课、从哪天开始。", { class: "v-muted" }));
    } else p.append(n("p", "这节固定课关联了班级，生成时读取班级当前名单。", { class: "v-muted" }));
    view.body.append(p);
    const ops = n("div", null, { class: "v-detail-ops v-tp-ops" });
    if (enabled("templates", "update"))
      ops.append(
        button(
          "修改时间与老师",
          async () => {
            await view.close();
            recordForm(P().sink(again), "schedule_templates", r);
          },
          "primary",
        ),
      );
    if (enabled("templates", "delete"))
      ops.append(
        button(
          "删除",
          async () => {
            if (!(await UI.confirm({ title: "删除这个固定排课？", consequence: "有关联课程或报名时服务器会拒绝，可改为停用。", danger: true }))) return;
            await api("data/schedule_templates/" + r.id, "DELETE", { version: r.version });
            await view.close();
            await again();
          },
          "danger",
        ),
      );
    view.body.append(ops);
  }
  // 生成未来课程：沿用原有的“先预览、无冲突才确认生成”流程（原函数在 c3 内部，借原页面入口调起）。
  async function generate(c, look, teachers, rooms) {
    const box = n("div");
    await old.templatesPage(box);
    const btn = [...box.querySelectorAll("button")].find((x) => x.textContent.trim() === "生成未来课程");
    // 原流程生成成功后会重画传入的容器；监听到就回到看板。
    new MutationObserver((_, o) => {
      o.disconnect();
      void templates(c);
    }).observe(box, { childList: true });
    btn?.click();
  }

  // ---------- 课程与教室 ----------
  const SECTIONS = [
    ["categories", "课程大类", "course_categories"],
    ["types", "细分课程", "course_types"],
    ["rooms", "教室与地点", "locations"],
  ];
  // 课程与教室只放这三项；缺勤规则、教师与学员端、默认视图在“机构设置”里。
  const SETTING_NAV = [
    ["categories", "课程大类"],
    ["types", "细分课程"],
    ["rooms", "教室与地点"],
  ];
  const FORMAT = { individual: "一对一", group: "小班课", class: "集训班" };
  async function courses(c, section) {
    const sec = SECTIONS.find((x) => x[0] === section);
    if (!sec) {
      vHead?.actions();
      return old.settingsPage(c, section);
    }
    const [, label, resource] = sec;
    const [rows, look] = await Promise.all([R().take("data/" + resource), lookups()]);
    const again = () => courses(c, section);
    vHead?.actions(
      enabled("settings", "create") ? button("＋ 新增" + label.replace("与地点", ""), () => recordForm(P().sink(again), resource), "primary") : null,
    );
    c.replaceChildren();
    const wrap = n("div", null, { class: "c3-settings" }),
      nav = n("nav", null, { "aria-label": "机构设置分类" }),
      body = n("section", null, { class: "v-set-body" });
    for (const [key, text] of SETTING_NAV) {
      const x = button(text, () => settingsPage(c, key));
      x.setAttribute("aria-current", key === section ? "page" : "false");
      nav.append(x);
    }
    wrap.append(nav, body);
    c.append(wrap);
    const typesOf = (catId) => look.types.filter((t) => t.category_id === catId);
    const actions = (r) => {
      const w = n("span", null, { class: "v-renew-acts" });
      if (enabled("settings", "update")) w.append(link("编辑", () => recordForm(P().sink(again), resource, r)));
      const more = [];
      if (enabled("settings", "delete"))
        more.push({
          label: "删除",
          danger: true,
          onSelect: async () => {
            if (!(await UI.confirm({ title: "删除" + r.name + "？", consequence: "有关联业务记录时服务器会拒绝，可改为停用。", danger: true }))) return;
            await api("data/" + resource + "/" + r.id, "DELETE", { version: r.version });
            await again();
          },
        });
      if (more.length) w.append(UI.actionMenu({ items: more }).element);
      return w;
    };
    const state = (r) => (r.active ? chip("启用", "ok") : chip("停用", "muted"));
    let cols;
    if (resource === "course_categories")
      cols = [
        {
          label: "大类",
          value: (r) => {
            const s = n("span", null, { class: "v-set-name " + V().colorClass({ category_color: r.color }) });
            s.append(n("i", null, { class: "v-cl-dot" }), r.name);
            return s;
          },
        },
        { label: "细分课程", value: (r) => typesOf(r.id).map((t) => t.name).join("、") || "—", cls: "v-fin-note-cell" },
        { label: "状态", value: state },
        { label: "", cls: "is-act", value: actions },
      ];
    else if (resource === "course_types")
      cols = [
        {
          label: "课程",
          value: (r) => {
            const s = n("span", null, { class: "v-set-name " + look.colorOf(r.id) });
            s.append(n("i", null, { class: "v-cl-dot" }), r.name);
            return s;
          },
        },
        { label: "大类", value: (r) => look.cats.find((x) => x.id === r.category_id)?.name || "—" },
        { label: "形式", value: (r) => FORMAT[r.format] || "—" },
        { label: "每节时长", num: true, value: (r) => (r.default_minutes ? r.default_minutes + " 分钟" : "—") },
        { label: "每节扣课时", num: true, value: (r) => String(r.units_per_lesson ?? 1) },
        { label: "人数上限", num: true, value: (r) => String(r.capacity ?? "—") },
        { label: "状态", value: state },
        { label: "", cls: "is-act", value: actions },
      ];
    else
      cols = [
        { label: "教室 / 地点", value: (r) => n("strong", r.name) },
        { label: "校区", value: (r) => r.campus || "—" },
        { label: "容纳人数", num: true, value: (r) => String(r.capacity ?? "—") },
        { label: "类型", value: (r) => (r.offsite ? "校外地点" : "校内") },
        { label: "状态", value: state },
        { label: "", cls: "is-act", value: actions },
      ];
    const sorted = resource === "course_types" ? [...rows].sort((a, b) => look.cats.findIndex((x) => x.id === a.category_id) - look.cats.findIndex((x) => x.id === b.category_id)) : rows;
    const head = n("div", null, { class: "v-set-head" });
    head.append(n("h2", label), n("span", rows.length + " 项 · 启用 " + rows.filter((r) => r.active).length, { class: "v-muted" }));
    body.append(head);
    body.append(table2(cols, sorted));
    if (resource === "course_types") body.append(n("p", "颜色跟随所属大类，周课表和课表图都用这套颜色。", { class: "v-muted v-fin-note" }));
  }
  function table2(cols, rows) {
    if (!rows.length) return UI.empty({ text: "还没有内容。" });
    const wrap = n("div", null, { class: "v-renew-table panel v-fin-table" }),
      t = n("table", null, { class: "v-table" }),
      hr = n("tr"),
      thead = n("thead"),
      tbody = n("tbody");
    for (const col of cols) hr.append(n("th", col.label, { class: (col.num ? "is-num " : "") + (col.cls || "") }));
    thead.append(hr);
    for (const r of rows) {
      const tr = n("tr");
      for (const col of cols) {
        const td = n("td", null, { class: (col.num ? "is-num " : "") + (col.cls || ""), "data-label": col.label });
        td.append(col.value(r) ?? "");
        tr.append(td);
      }
      tbody.append(tr);
    }
    t.append(thead, tbody);
    wrap.append(t);
    return wrap;
  }

  // ---------- 挂到原入口 ----------
  // 原“保存班级”会调用 classesPage(c, 0, 班级id)：在页面里就选中那个班重画。
  classesPage = (c, offset, selected) => {
    if (!inPage(c)) return old.classesPage(c, offset, selected);
    if (selected) cState.selected = selected;
    return classes(c);
  };
  templatesPage = (c) => (inPage(c) ? templates(c) : old.templatesPage(c));
  settingsPage = (c, section = "categories") => (inPage(c) ? courses(c, section) : old.settingsPage(c, section));
  globalThis.ChannelV2Setup = { classes, templates, courses };
})();
