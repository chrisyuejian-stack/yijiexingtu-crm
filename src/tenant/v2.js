// 第十阶段重构（v2）：按 27 张画板重做的页面。复用 app.js 的 api/el/button/enabled 等全局函数，
// 复用 c2.js 的 ChannelRebuild 与 calendar.js 的课表引擎；不改接口。
(() => {
  "use strict";
  const n = el,
    F = UI.fmt,
    R = () => globalThis.ChannelRebuild;
  const COLORS = [
    "#8B7BB5",
    "#5B8DB8",
    "#62A598",
    "#C99A54",
    "#B7768C",
    "#7B93AB",
    "#A48B69",
    "#8C9D62",
  ];
  const colorClass = (row) =>
    "v-c" + Math.max(0, COLORS.indexOf(String(row.category_color || "").toUpperCase()));
  const person = (row) => R()?.lessonPerson?.(row) || row.course_name;
  const overdue = (row) =>
    row.status === "planned" && Date.parse(row.start_at) <= Date.now();
  const daysBetween = (a, b) =>
    Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
  const go = (hash) => {
    location.hash = hash;
  };
  function panel(title, extra) {
    const box = n("section", null, { class: "v-panel" }),
      head = n("header", null, { class: "v-panel-head" }),
      h = n("h2", title);
    head.append(h);
    if (extra) head.append(...[].concat(extra).filter(Boolean));
    box.append(head);
    return box;
  }
  function chip(text, tone) {
    return n("span", text, { class: "v-chip v-chip-" + tone });
  }
  function link(text, fn) {
    const b = button(text, fn, "link");
    b.classList.add("v-link");
    return b;
  }
  globalThis.ChannelV2 = { colorClass, panel, chip, link, overdue, person, studentWeek, studentScheduleView, timeGrid };

  // ---------- 今天 ----------
  async function today(c) {
    const finance =
      me.user.roles.includes("finance") &&
      !me.user.roles.some((r) => ["supervisor", "academic"].includes(r));
    const day = todayBJ();
    // 待收学费与首页数据同时请求（没有学费权限时会被拒绝，按原样只显示实收）。
    const dueP = enabled("tuition") ? api("finance/receivable-summary") : Promise.reject(Error("无权限"));
    dueP.catch(() => {});
    const [data, colors] = await Promise.all([
      api("c2/home"),
      enabled("schedule")
        ? api("schedule?from=" + day + "&to=" + dateShift(day, 1)).catch(() => ({ items: [] }))
        : { items: [] },
    ]);
    const colorOf = new Map((colors.items || []).map((x) => [x.id, x.category_color]));
    for (const row of data.lessons || []) row.category_color ||= colorOf.get(row.id);
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        hour12: false,
      }).format(new Date()),
    );
    vHead?.sub(
      F.day(day) +
        " · " +
        (hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好") +
        "，" +
        (me.user.name || ""),
    );
    if (finance) return financeToday(c, data, day);
    c.replaceChildren();
    c.dataset.page = "home";
    const counts = data.counts || {},
      lessons = (data.lessons || [])
        .slice()
        .sort((a, b) => a.start_at.localeCompare(b.start_at)),
      late = lessons.filter(overdue),
      tasks = data.tasks || [];
    const metrics = n("div", null, { class: "v-metrics" });
    const metric = (label, value, unit, note, tone, hash) => {
      const card = n(hash ? "button" : "div", null, {
        class: "v-metric v-tone-" + tone,
        ...(hash ? { type: "button" } : {}),
      });
      const big = n("p", null, { class: "v-metric-value" });
      big.append(n("strong", value));
      if (unit) big.append(n("span", unit));
      card.append(n("span", label, { class: "v-metric-label" }), big, n("small", note));
      if (hash) card.addEventListener("click", () => go(hash));
      metrics.append(card);
    };
    if (counts.unchecked_lessons !== undefined) {
      const first = late[0];
      metric(
        "过了上课时间还没销课",
        String(counts.unchecked_lessons),
        "节",
        first
          ? "最早一节 " + first.start_at.slice(11, 16) + " " + person(first) + " · 去销课"
          : counts.unchecked_lessons
            ? "包括更早日期的课 · 去销课"
            : "今天的课都已处理",
        counts.unchecked_lessons ? "bad" : "ok",
        "todo-unchecked",
      );
    }
    if (counts.followup_overdue !== undefined) {
      const dueToday = tasks.filter((t) => t.due_date === day).length;
      metric(
        "跟进任务",
        String(counts.followup_overdue),
        "条逾期",
        "另有今天到期 " + dueToday + " 条",
        counts.followup_overdue ? "bad" : "ok",
        "todo-followup",
      );
    }
    // B3 之后 renewal_zero 已是“学员+课程”合计的用完组数。
    if (counts.renewal_zero !== undefined)
      metric(
        "课时已用完",
        String(counts.renewal_zero),
        "项",
        "按学员和课程合计 · 去发续费提醒",
        counts.renewal_zero ? "warn" : "ok",
        "todo-renewal",
      );
    if (data.tuition_amount !== undefined) {
      let note = "本月实收学费";
      try {
        const due = await dueP;
        note = "待收 " + F.receivable(due.amount, due.unresolved);
      } catch {
        /* 无权限时只显示实收 */
      }
      metric("本月已收学费", F.money(data.tuition_amount), "", note, "money", enabled("tuition") ? "finance-income" : null);
    }
    c.append(metrics);
    const grid = n("div", null, { class: "v-today-grid" });
    // 左：今日课程按时间一条线
    const done = lessons.filter((x) => x.status === "completed").length;
    const list = panel("今日课程", [
      n("span", lessons.length + " 节 · 已销 " + done + " · 待销 " + late.length, {
        class: "v-panel-meta",
      }),
      n("span", null, { class: "v-spacer" }),
      enabled("schedule") ? link("打开课表", () => go("schedule-week")) : null,
    ]);
    list.classList.add("v-today-lessons");
    for (const row of lessons) {
      const line = n("div", null, {
        class: "v-lesson-row " + colorClass(row) + (overdue(row) ? " is-late" : ""),
      });
      const who = n("div", null, { class: "v-lesson-who" }),
        name = n("p");
      name.append(n("strong", person(row)), n("span", " · " + row.course_name));
      who.append(name, n("small", row.teacher_name + " · " + (row.location_name || "线上")));
      line.append(n("time", F.range(row.start_at, row.duration || 45)), n("span", null, { class: "v-bar" }), who);
      const tail = n("div", null, { class: "v-lesson-tail" });
      if (overdue(row)) {
        tail.append(chip("未销课", "bad"));
        if (enabled("attendance", "update"))
          tail.append(button("销课", () => lessonDetail(c, row)));
      } else
        tail.append(
          chip(
            row.status === "completed" ? "已销课" : me.labels.lessons[row.status] || "待上课",
            row.status === "completed" ? "ok" : row.status === "planned" ? "info" : "muted",
          ),
        );
      line.append(tail);
      line.addEventListener("click", (e) => {
        if (!e.target.closest("button")) lessonDetail(c, row);
      });
      list.append(line);
    }
    if (!lessons.length)
      list.append(
        UI.empty({
          text: "今天没有课程。排课后会按时间显示在这里。",
          action: enabled("lessons", "create")
            ? { label: "排课", onSelect: () => lessonForm(c) }
            : undefined,
        }),
      );
    grid.append(list);
    // 右：接下来要做 + 本周
    const side = n("div", null, { class: "v-today-side" });
    const actions = data.actions || [];
    const todo = panel("接下来要做", [
      n("span", String(actions.length), { class: "v-count" }),
      n("span", null, { class: "v-spacer" }),
      link("全部待办", () => go("todo-unchecked")),
    ]);
    for (const row of actions) {
      const parts = String(row.title).split(" · ");
      const isLate = row.due_date && row.due_date < day;
      const tone =
        row.kind === "lead" ? "info" : isLate || row.kind === "renewal" && row.priority === 2 ? "bad" : "warn";
      const item = n("div", null, { class: "v-todo-row" });
      const text = n("div", null, { class: "v-todo-text" });
      text.append(
        n("p", parts.slice(0, 2).join(" · ")),
        n(
          "small",
          row.kind === "followup"
            ? (isLate ? "逾期 " + daysBetween(row.due_date, day) + " 天" : "今天到期") +
                (row.assignee_name ? " · 负责人 " + row.assignee_name : "")
            : row.kind === "stage"
              ? "今天 · 需要定下一阶段目标"
              : row.kind === "renewal"
                ? parts.slice(1).join(" · ")
                : "今天回访",
          { class: "v-tone-text-" + tone },
        ),
      );
      const act =
        row.kind === "followup"
          ? row.student_id
            ? ["记录回访", () => R().goStudent(row.student_id, "followup")]
            : ["处理", () => go("todo-followup")]
          : row.kind === "stage"
            ? ["更新阶段", () => R().goStudent(row.student_id, "stages")]
            : row.kind === "renewal"
              ? ["发续费提醒", () => go("todo-renewal")]
              : ["回访", () => searchLeadDetail(c, row.id)];
      item.append(n("span", null, { class: "v-dot v-dot-" + tone }), text, button(act[0], act[1]));
      todo.append(item);
    }
    if (!actions.length) todo.append(n("p", "今天没有需要处理的事。", { class: "v-empty-line" }));
    side.append(todo);
    // 枫琴推荐：只对有推广权限的主管、教务显示，样式比待办低调。
    if (enabled("promo") && globalThis.ChannelV2Promo?.recommend) side.append(globalThis.ChannelV2Promo.recommend());
    if (data.week) {
      const week = panel("本周", n("span", weekStart(day).slice(5) + " – " + dateShift(weekStart(day), 6).slice(5) + " · " + data.week.reduce((s, x) => s + x.n, 0) + " 节", { class: "v-panel-meta" }));
      const monday = weekStart(day),
        max = Math.max(1, ...data.week.map((x) => x.n));
      const bars = n("div", null, { class: "v-week-bars" });
      for (let i = 0; i < 7; i++) {
        const d = dateShift(monday, i),
          count = data.week.find((x) => x.date === d)?.n || 0;
        const bar = n("button", null, {
          type: "button",
          class: "v-week-bar" + (d === day ? " is-today" : ""),
          "aria-label": "周" + "一二三四五六日"[i] + " " + count + " 节",
        });
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 80");
        svg.setAttribute("aria-hidden", "true");
        const h = Math.max(2, Math.round((count / max) * 80));
        const rect = document.createElementNS(svg.namespaceURI, "rect");
        for (const [k, v] of Object.entries({ x: 0, y: 80 - h, width: 24, height: h, rx: 4 }))
          rect.setAttribute(k, String(v));
        svg.append(rect);
        bar.append(n("strong", String(count)), svg, n("span", "周" + "一二三四五六日"[i]));
        bar.addEventListener("click", () => {
          scheduleWeek = d;
          go("schedule-week");
        });
        bars.append(bar);
      }
      week.append(bars);
      side.append(week);
    }
    grid.append(side);
    c.append(grid);
  }

  // ---------- 课表：手机日视图（画板 23）----------
  const phone = () => matchMedia("(max-width: 760px)").matches;
  let phoneDay = null,
    phoneTeacher = "",
    phoneMode = (() => {
      try {
        return localStorage.getItem("fq_phone_mode") === "list" ? "list" : "grid";
      } catch {
        return "grid";
      }
    })();
  async function weekRows(monday, studentId = "") {
    const items = [];
    let offset = 0;
    for (;;) {
      const data = await api(
        "schedule?from=" + monday + "&to=" + dateShift(monday, 7) + (studentId ? "&student_id=" + encodeURIComponent(studentId) : "") + "&offset=" + offset,
      );
      items.push(...(data.items || []));
      if (data.next_offset === null || data.next_offset === undefined) break;
      offset = data.next_offset;
    }
    return items;
  }
  async function phoneSchedule(c) {
    const today = todayBJ();
    phoneDay ||= scheduleWeek && weekStart(scheduleWeek) === weekStart(today) ? today : scheduleWeek || today;
    const monday = weekStart(phoneDay);
    const rows = (await weekRows(monday)).sort((a, b) => a.start_at.localeCompare(b.start_at));
    paintPhone(c, rows, monday);
  }
  // 换天、换老师、换视图只重画，不再重新取这一周的数据。
  function paintPhone(c, rows, monday) {
    const today = todayBJ();
    vHead?.sub(monday.slice(5) + " – " + dateShift(monday, 6).slice(5));
    if (enabled("lessons", "create")) {
      const add = UI.iconButton("排课", "plus", () => lessonForm(c, { start_at: phoneDay + "T14:00" }));
      add.classList.add("v-fab");
      vHead?.actions(add);
    }
    c.replaceChildren();
    c.dataset.page = "schedule-phone";
    const strip = n("div", null, { class: "v-daystrip", role: "tablist", "aria-label": "选择日期" });
    for (let i = 0; i < 7; i++) {
      const d = dateShift(monday, i),
        count = rows.filter((r) => r.start_at.slice(0, 10) === d).length;
      const b = n("button", null, {
        type: "button",
        role: "tab",
        class: "v-day" + (d === phoneDay ? " is-on" : "") + (d === today ? " is-today" : ""),
        "aria-selected": String(d === phoneDay),
      });
      b.append(n("small", "一二三四五六日"[i]), n("strong", String(Number(d.slice(8)))), n("span", count + "节"));
      b.addEventListener("click", () => {
        phoneDay = d;
        paintPhone(c, rows, monday);
      });
      strip.append(b);
    }
    const teachers = [...new Map(rows.map((r) => [r.teacher_id, r.teacher_name])).entries()]
      .map(([id, name]) => ({ id, name, n: rows.filter((r) => r.teacher_id === id).length }))
      .sort((a, b) => b.n - a.n);
    const chips = n("div", null, { class: "v-chips-row" });
    for (const t of [{ id: "", name: "全部老师" }, ...teachers]) {
      const b = n("button", t.name, {
        type: "button",
        class: "v-filter-chip" + (phoneTeacher === t.id ? " is-on" : ""),
        "aria-pressed": String(phoneTeacher === t.id),
      });
      b.addEventListener("click", () => {
        phoneTeacher = t.id;
        paintPhone(c, rows, monday);
      });
      chips.append(b);
    }
    const list = n("div", null, { class: "v-daylist" });
    const dayRows = rows.filter(
      (r) => r.start_at.slice(0, 10) === phoneDay && (!phoneTeacher || r.teacher_id === phoneTeacher),
    );
    const times = [...new Set(dayRows.map((r) => r.start_at.slice(11, 16)))];
    for (const time of times) {
      const group = dayRows.filter((r) => r.start_at.slice(11, 16) === time),
        done = group.filter((r) => r.status === "completed"),
        open = group.filter((r) => r.status !== "completed");
      const block = n("div", null, { class: "v-daylist-group" });
      block.append(n("time", time));
      const cards = n("div", null, { class: "v-daylist-cards" });
      for (const row of open) {
        const late = overdue(row);
        const card = n("button", null, {
          type: "button",
          class: "v-daycard " + colorClass(row) + (late ? " is-late" : "") + (row.status !== "planned" ? " is-off" : ""),
        });
        const text = n("span", null, { class: "v-daycard-text" });
        text.append(
          n("strong", person(row)),
          n("small", row.course_name + " · " + row.teacher_name + " · " + (row.location_name || "线上")),
        );
        card.append(
          text,
          n("em", late ? "未销课" : row.status === "planned" ? "待上课" : me.labels.lessons[row.status] || "", {
            class: late ? "is-bad" : "",
          }),
        );
        card.addEventListener("click", () => lessonDetail(c, row));
        cards.append(card);
      }
      if (done.length) {
        const card = n("button", null, { type: "button", class: "v-daycard is-done " + colorClass(done[0]) });
        const text = n("span", null, { class: "v-daycard-text" });
        text.append(
          n("strong", done.map(person).join(" · ") + (done.length > 1 ? " " + done.length + " 节" : "")),
          n("small", done.length > 1 ? "已销课" : done[0].course_name + " · " + done[0].teacher_name + " · " + (done[0].location_name || "线上")),
        );
        card.append(text, n("em", "已销"));
        card.addEventListener("click", () => (done.length === 1 ? lessonDetail(c, done[0]) : null));
        if (done.length > 1)
          card.addEventListener("click", () => {
            const sheet = UI.overlay({ title: phoneDay.slice(5) + " " + time + " · 已销课", kind: "modal" });
            for (const row of done) {
              const b = button(person(row) + " · " + row.course_name + " · " + row.teacher_name, async () => {
                await sheet.close();
                await lessonDetail(c, row);
              });
              b.classList.add("v-sheet-line");
              sheet.body.append(b);
            }
          });
        cards.append(card);
      }
      block.append(cards);
      list.append(block);
    }
    if (!dayRows.length) list.append(n("p", "这一天没有课程。", { class: "v-empty-line" }));
    let startX = null;
    list.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
    }, { passive: true });
    list.addEventListener("touchend", (e) => {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(dx) < 60) return;
      phoneDay = dateShift(phoneDay, dx < 0 ? 1 : -1);
      scheduleWeek = phoneDay;
      if (weekStart(phoneDay) === monday) paintPhone(c, rows, monday);
      else void phoneSchedule(c);
    });
    const modeBar = n("div", null, { class: "v-phone-bar" });
    const seg = n("div", null, { class: "v-seg", role: "group", "aria-label": "显示方式" });
    for (const [k, label] of [["grid", "时间表"], ["list", "列表"]]) {
      const b = n("button", label, { type: "button", class: "v-seg-item", "aria-pressed": String(phoneMode === k) });
      b.addEventListener("click", () => {
        phoneMode = k;
        try {
          localStorage.setItem("fq_phone_mode", k);
        } catch {}
        paintPhone(c, rows, monday);
      });
      seg.append(b);
    }
    modeBar.append(seg, chips);
    c.append(strip, modeBar, phoneMode === "grid" ? phoneGrid(c, dayRows) : list);
  }
  // 卡片时间表（与电脑版一样：一列一位老师，按时间摆卡片）；时间轴和老师名固定，左右上下滑动。
  const GRID_Q = 15;
  const toMin = (iso) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
  function phoneGrid(c, dayRows) {
    if (!dayRows.length) return n("p", "这一天没有课程。", { class: "v-empty-line" });
    const teachers = [...new Map(dayRows.map((r) => [r.teacher_id, r.teacher_name || "—"])).entries()].sort((x, y) =>
      String(x[1]).localeCompare(String(y[1]), "zh-CN"),
    );
    return timeGrid(c, dayRows, teachers, (r) => r.teacher_id);
  }
  // 通用卡片时间表：cols 是 [键, 名称]，colOf(行) 给出这行放哪一列；时间范围按这批课程自动取整点。
  function timeGrid(c, rows, cols, colOf, text) {
    const wrap = n("div", null, { class: "v-grid-wrap" });
    const t0 = Math.floor(Math.min(...rows.map((r) => toMin(r.start_at))) / 60) * 60,
      t1 = Math.ceil(Math.max(...rows.map((r) => toMin(r.start_at) + (r.duration || 45))) / 60) * 60,
      quarters = (t1 - t0) / GRID_Q;
    const grid = n("div", null, { class: "v-grid vg-cols" + Math.min(cols.length, 12) });
    grid.append(n("div", null, { class: "v-grid-corner" }));
    cols.forEach(([, name], i) => grid.append(n("div", name, { class: "v-grid-head vg-c" + (i + 2) })));
    for (let m = t0; m < t1; m += 60)
      grid.append(
        n("div", String(Math.floor(m / 60)).padStart(2, "0") + ":00", {
          class: "v-grid-time vg-r" + ((m - t0) / GRID_Q + 2) + " vg-s4",
        }),
      );
    cols.forEach((_, i) => grid.append(n("div", null, { class: "v-grid-col vg-c" + (i + 2) + " vg-r2 vg-end", "aria-hidden": "true" })));
    for (const row of rows) {
      const col = cols.findIndex(([key]) => key === colOf(row)) + 2;
      if (col < 2) continue;
      const start = Math.round((toMin(row.start_at) - t0) / GRID_Q) + 2,
        span = Math.max(2, Math.round((row.duration || 45) / GRID_Q)),
        endMin = toMin(row.start_at) + (row.duration || 45);
      const late = overdue(row);
      const card = n("button", null, {
        type: "button",
        class:
          "v-grid-card " + colorClass(row) + " vg-c" + col + " vg-r" + start + " vg-s" + Math.min(span, 24) +
          (late ? " is-late" : "") + (row.status === "completed" ? " is-done" : row.status !== "planned" ? " is-off" : ""),
      });
      card.append(
        n("strong", text ? text(row)[0] : person(row)),
        n(
          "small",
          row.start_at.slice(11, 16) + "–" + String(Math.floor(endMin / 60)).padStart(2, "0") + ":" + String(endMin % 60).padStart(2, "0") + " " + (text ? text(row)[1] : row.course_name),
        ),
      );
      const state = late ? "未销课" : row.status === "completed" ? "已销" : row.status !== "planned" ? me.labels.lessons[row.status] || "" : "";
      if (state) card.append(n("em", state));
      card.addEventListener("click", () => lessonDetail(c, row));
      grid.append(card);
    }
    grid.classList.add("vg-q" + Math.min(quarters, 96));
    wrap.append(grid);
    return wrap;
  }

  // ---------- 学员课表：学员详情的“课表”标签、课表页的“按学员” ----------
  const WD_CN = "一二三四五六日";
  const ownLabel = (row) =>
    row.own_attendance && row.own_attendance !== "planned" && row.own_attendance !== row.status
      ? me.labels.attendance?.[row.own_attendance] || me.labels.lessons?.[row.status] || ""
      : row.status === "planned"
        ? overdue(row)
          ? "未销课"
          : "待上课"
        : me.labels.lessons?.[row.status] || "";
  async function studentWeek(body, studentId, c) {
    let monday = weekStart(todayBJ()),
      mode = phone() ? "list" : "grid";
    const cache = new Map();
    const wrap = n("div", null, { class: "v-sweek" });
    const bar = n("div", null, { class: "v-sweek-bar" });
    const view = n("div", null, { class: "v-sweek-view" });
    const rules = n("div", null, { class: "v-sweek-rules" });
    wrap.append(bar, view, rules);
    body.replaceChildren(wrap);
    const paint = async () => {
      bar.replaceChildren();
      const prev = button("‹", () => go(-7)),
        next = button("›", () => go(7)),
        now = button("本周", () => {
          monday = weekStart(todayBJ());
          void paint();
        });
      prev.setAttribute("aria-label", "上一周");
      next.setAttribute("aria-label", "下一周");
      const seg = n("div", null, { class: "v-seg", role: "group", "aria-label": "显示方式" });
      for (const [k, label] of [["grid", "周视图"], ["list", "列表"]]) {
        const b = n("button", label, { type: "button", class: "v-seg-item", "aria-pressed": String(mode === k) });
        b.addEventListener("click", () => {
          mode = k;
          void paint();
        });
        seg.append(b);
      }
      const label = n("strong", monday.slice(5).replace("-", "月") + "日 – " + dateShift(monday, 6).slice(5).replace("-", "月") + "日", { class: "v-sweek-range" });
      bar.append(prev, label, next, now, n("span", null, { class: "v-spacer" }), seg);
      let rows = cache.get(monday);
      if (!rows) {
        view.replaceChildren(UI.tableSkeleton());
        rows = (await weekRows(monday, studentId)).sort((a, b) => a.start_at.localeCompare(b.start_at));
        cache.set(monday, rows);
      }
      const live = rows.filter((r) => r.status !== "cancelled");
      bar.insertBefore(n("span", "本周 " + live.length + " 节", { class: "v-count" }), bar.querySelector(".v-spacer"));
      if (!rows.length) {
        view.replaceChildren(n("p", "这一周没有课程。", { class: "v-empty-line" }));
        return;
      }
      if (mode === "grid") {
        const today = todayBJ();
        const cols = Array.from({ length: 7 }, (_, i) => {
          const d = dateShift(monday, i);
          return [d, "周" + WD_CN[i] + " " + Number(d.slice(8)) + (d === today ? "·今" : "")];
        });
        view.replaceChildren(timeGrid(c, rows, cols, (r) => r.start_at.slice(0, 10), (r) => [r.course_name, (r.teacher_name || "") + (ownLabel(r) ? " · " + ownLabel(r) : "")]));
        return;
      }
      const list = n("div", null, { class: "v-daylist" });
      for (let i = 0; i < 7; i++) {
        const d = dateShift(monday, i),
          day = rows.filter((r) => r.start_at.slice(0, 10) === d);
        if (!day.length) continue;
        const group = n("div", null, { class: "v-daylist-group" });
        group.append(n("time", "周" + WD_CN[i] + " " + d.slice(5)));
        const cards = n("div", null, { class: "v-daylist-cards" });
        for (const row of day) {
          const card = n("button", null, {
            type: "button",
            class: "v-daycard " + colorClass(row) + (overdue(row) ? " is-late" : "") + (row.status !== "planned" ? " is-off" : ""),
          });
          const t = n("span", null, { class: "v-daycard-text" });
          t.append(n("strong", row.start_at.slice(11, 16) + " " + row.course_name), n("small", (row.teacher_name || "") + " · " + (row.location_name || "线上")));
          card.append(t, n("em", ownLabel(row), { class: overdue(row) ? "is-bad" : "" }));
          card.addEventListener("click", () => lessonDetail(c, row));
          cards.append(card);
        }
        group.append(cards);
        list.append(group);
      }
      view.replaceChildren(list);
    };
    const go = (days) => {
      monday = dateShift(monday, days);
      void paint();
    };
    // 固定课：来自“固定排课”，这里只读；改规则去固定排课页。
    const loadRules = async () => {
      try {
        const data = await api("students/" + encodeURIComponent(studentId) + "/fixed-rules");
        rules.replaceChildren(n("h3", "这个学员的固定课（来自“固定排课”）", { class: "v-section-title" }));
        if (!data.items?.length) {
          rules.append(n("p", "还没有固定课。", { class: "v-muted" }));
          return;
        }
        for (const r of data.items) {
          const line = n("div", null, { class: "v-sweek-rule" });
          line.append(
            n("strong", "每周" + WD_CN[r.weekday] + " " + r.start_time + "–" + r.end_time),
            n("span", r.course_name + " · " + (r.teacher_name || "") + (r.location_name ? " · " + r.location_name : "")),
            n("small", (r.date_from || "") + " 至 " + (r.date_to || "长期") + (r.is_group ? " · 同班 " + r.member_count + " 人" : " · 1对1"), { class: "v-muted" }),
          );
          rules.append(line);
        }
      } catch {
        rules.replaceChildren();
      }
    };
    await Promise.all([paint(), loadRules()]);
  }
  // 课表页“按学员”：先选一位学员（卡片 + 快速筛选，单选），再看 TA 的周课表。
  let pickedStudent = "";
  async function studentScheduleView(c) {
    const students = (await choices("students")).filter((s) => s.status === "active");
    c.replaceChildren();
    const head = n("div", null, { class: "v-ss-head" });
    const body = n("div", null, { class: "v-ss-body" });
    c.append(head, body);
    const pick = () => {
      body.replaceChildren();
      head.replaceChildren();
      const form = n("form", null, { class: "v-ss-form" });
      const picker = studentPicker(form, { students, selected: [], legend: "选择学员", single: true, onChange: (id) => show(id) });
      form.append(picker.element);
      head.append(form);
      form.addEventListener("submit", (e) => e.preventDefault());
    };
    const show = async (id) => {
      pickedStudent = id;
      const st = students.find((s) => s.id === id);
      head.replaceChildren();
      const line = n("div", null, { class: "v-ss-line" });
      line.append(n("span", Array.from(st?.name || "?")[0], { class: "v-avatar-mark", "aria-hidden": "true" }), n("strong", st?.name || "学员"));
      if (enabled("students", "read")) line.append(link("查看学员资料", () => R().goStudent(id)));
      line.append(n("span", null, { class: "v-spacer" }), button("换一位", pick));
      head.append(line);
      body.replaceChildren(UI.tableSkeleton());
      await studentWeek(body, id, c);
    };
    if (pickedStudent && students.some((s) => s.id === pickedStudent)) await show(pickedStudent);
    else pick();
  }
  const desktopSchedule = schedulePage;
  schedulePage = async (c) => (phone() ? phoneSchedule(c) : desktopSchedule(c));

  // ---------- 课程面板：点名销课（画板 3 / 24）----------
  // 与 c2 版接口和规则完全一致，只重排信息：先把“扣谁多少、扣完剩多少、课酬怎么算”讲清楚再确认。
  const c2Lesson = lessonDetail;
  lessonDetail = async (c, row) => {
    // 课程资料与点评同时请求。
    const reviewP = enabled("comments", "read") || row.status === "planned" ? api("lessons/" + row.id + "/review").catch(() => null) : null;
    const data = { ...row, ...(await api("data/lessons/" + row.id)).record };
    if (data.source_course_id) return c2Lesson(c, row);
    const participants = [...data.participants].sort(
      (a, b) =>
        a.student_name.localeCompare(b.student_name, "zh-CN") || a.id.localeCompare(b.id),
    );
    const reviewSnap = await reviewP;
    // 老师已提交出勤、等员工确认的课：不能再走普通销课，只能去确认或退回。
    const sub = reviewSnap?.submission,
      pendingAtt =
        (sub ? sub.status === "pending" && sub.kind !== "comments" : data.review_status === "pending" && data.review_kind !== "comments");
    const planned = data.status === "planned",
      late = planned && Date.parse(data.start_at) < Date.now(),
      canMark = planned && enabled("attendance", "update") && !pendingAtt;
    const draft = new Map(
      participants.map((p) => [p.id, planned ? "attended" : p.attendance]),
    );
    let preview = null,
      seq = 0,
      dirty = false;
    const reviewSnapshot = reviewSnap;
    const view = UI.drawer({
      title: data.course_name + " · " + data.teacher_name,
      subtitle:
        F.day(data.start_at) +
        " " +
        F.range(data.start_at, data.duration) +
        " · " +
        data.duration +
        " 分钟 · " +
        (data.location_name || "线上") +
        " · " +
        (participants.length > 1 ? "每人扣 " : "扣 ") +
        F.units(data.units),
      isDirty: () => dirty,
    });
    view.element.classList.add("v-lesson", colorClass(data));
    const top = n("div", null, { class: "v-lesson-top" });
    if (late) top.append(chip("已过开始时间，还没销课", "bad"));
    else if (!planned)
      top.append(
        chip(me.labels.lessons[data.status] || "", data.status === "completed" ? "ok" : "muted"),
      );
    if (pendingAtt || data.review_status === "pending") {
      const banner = n("p", null, { class: "v-banner v-banner-warn" });
      const canReview = reviewSnap?.can_review ?? enabled("attendance", "confirm");
      banner.append(
        chip("教师已提交", "warn"),
        n(
          "span",
          pendingAtt
            ? canReview
              ? data.teacher_name + " 已提交点名和点评。这节课要在“老师已提交”里确认，确认前不能直接销课。"
              : data.teacher_name + " 已提交点名和点评，等有确认权限的同事处理。"
            : data.teacher_name + " 已提交点评，请核对后确认。改动会记录在操作记录里。",
        ),
      );
      if (pendingAtt && canReview)
        banner.append(
          button("去确认", async () => {
            dirty = false;
            const body = n("section");
            view.body.replaceChildren(body);
            await reviewScreen(body, data.id, () => reviewScreen(body, data.id));
          }),
        );
      top.append(banner);
    }
    view.body.append(top);
    const head = n("div", null, { class: "v-lesson-section" });
    // 打开时焦点落在这个标题上（不落在点评输入框，手机上不会一打开就弹键盘）。
    head.append(
      n("h3", "学员出勤（" + participants.length + " 人）", { tabindex: "-1", autofocus: "" }),
    );
    if (canMark && participants.length > 1)
      head.append(
        button("全部设为到课", () => {
          for (const p of participants) draft.set(p.id, "attended");
          dirty = true;
          void refreshPreview();
        }),
      );
    const roster = n("div", null, { class: "v-roster", role: "table", "aria-label": "学员出勤" });
    const shortageBox = n("div", null, { class: "v-banner v-banner-bad", role: "status", hidden: "" });
    view.body.append(head, roster, shortageBox);
    function renderRoster() {
      roster.replaceChildren();
      const th = n("div", null, { class: "v-roster-row v-roster-head", role: "row" });
      for (const t of ["学员 · 课时", "出勤", "扣", "扣后剩余"]) th.append(n("span", t, { role: "columnheader" }));
      roster.append(th);
      for (const p of participants) {
        const pv = preview?.items.find((x) => x.id === p.id),
          short = pv && !pv.unlimited && pv.available_units < pv.required_units,
          blockedP = preview?.blocked?.some((x) => x.participant_id === p.id);
        // 课时不够时：上限内记“欠课时”照常销课；超过上限的只这一位不销，其他人照常。
        const line = n("div", null, { class: "v-roster-row" + (blockedP ? " is-short" : short ? " is-debt" : ""), role: "row" });
        const who = n("div", null, { class: "v-roster-who", role: "cell" });
        who.append(
          n("strong", p.student_name),
          n(
            "small",
            !pv
              ? ""
              : pv.unlimited
                ? "整体收费，不扣课时包"
                : "课时余 " + pv.available_units + (pv.valid_to ? " · 至 " + pv.valid_to : ""),
          ),
        );
        const seg = n("div", null, { class: "v-seg", role: "cell" });
        if (canMark)
          for (const [value, label] of [
            ["attended", "到课"],
            ["student_leave", "请假"],
            ["no_show", "缺课"],
          ]) {
            const b = n("button", label, {
              type: "button",
              class: "v-seg-item v-seg-" + value,
              "aria-pressed": String(draft.get(p.id) === value),
            });
            b.addEventListener("click", () => {
              draft.set(p.id, value);
              dirty = true;
              renderRoster();
              void refreshPreview();
            });
            seg.append(b);
          }
        else seg.append(n("span", me.labels.attendance[p.attendance] || "未登记", { class: "v-seg-read" }));
        const req = pv ? (pv.unlimited ? "—" : String(pv.required_units)) : planned ? "…" : String(p.deducted ?? "—");
        const left = !pv
          ? "—"
          : pv.unlimited
            ? "—"
            : blockedP
              ? "超上限"
              : String(Math.round((pv.available_units - pv.required_units) * 100) / 100);
        line.append(
          who,
          seg,
          n("span", planned ? req : String(p.deducted ?? 0), { class: "v-num", role: "cell" }),
          n("strong", planned ? left : "—", { class: "v-num" + (short ? " is-bad" : ""), role: "cell" }),
        );
        if (planned && short && !blockedP)
          who.append(n("small", "将欠 " + Math.round((pv.required_units - pv.available_units) * 100) / 100 + " 课时，补缴后自动补扣", { class: "v-debt-note" }));
        if (planned && blockedP) who.append(n("small", "超过欠课上限，本次不销课，其他人照常", { class: "v-debt-note is-bad" }));
        if (draft.get(p.id) === "student_leave" && planned && enabled("attendance", "create")) {
          const mk = button("安排补课", () => makeupForm(c, data, p), "link");
          mk.classList.add("v-roster-extra");
          line.append(mk);
        }
        roster.append(line);
      }
    }
    // 课后点评
    const publicText = UI.field({ label: "本节点评（全班可见）", type: "textarea", required: false }),
      personInputs = new Map();
    if (enabled("comments", "read")) {
      publicText.input.value =
        reviewSnapshot?.published?.find((x) => x.student_id === null)?.text || "";
      publicText.input.placeholder = "本课内容、课后作业、老师点评";
      publicText.input.addEventListener("input", () => (dirty = true));
      const sec = n("section", null, { class: "v-lesson-section v-lesson-comments" });
      const h = n("div", null, { class: "v-lesson-section-head" });
      h.append(n("h3", "课后点评"), n("small", "确认后学员端可见"));
      sec.append(h);
      const commentBody = [publicText.element];
      if (participants.length > 1 || reviewSnapshot?.published?.some((x) => x.student_id)) {
        const each = [];
        for (const p of participants) {
          const f = UI.field({ label: p.student_name, type: "textarea", required: false });
          f.input.value = reviewSnapshot?.published?.find((x) => x.student_id === p.student_id)?.text || "";
          f.input.addEventListener("input", () => (dirty = true));
          personInputs.set(p.student_id, f.input);
          each.push(f.element);
        }
        commentBody.push(UI.disclosure("给每位学生单独点评", each, { open: false }));
      } else
        for (const p of participants) {
          personInputs.set(p.student_id, { value: "" });
        }
      // 手机上点评默认收起成一行，展开再填。
      if (phone()) {
        h.replaceChildren();
        sec.append(UI.disclosure("课后点评（可选）", commentBody, { open: false }));
      } else sec.append(...commentBody);
      view.body.append(sec);
    }
    const summary = n("section", null, { class: "v-lesson-summary" });
    view.body.append(summary);
    function renderSummary() {
      summary.replaceChildren(n("h3", planned ? "确认后将会" : "撤销后将会"));
      const ul = n("ul");
      if (planned && preview) {
        const byUnits = new Map();
        for (const it of preview.items) {
          if (it.unlimited) continue;
          if (preview.blocked?.some((x) => x.participant_id === it.id)) continue;
          if (it.available_units < it.required_units) {
            ul.append(n("li", it.student_name + " 扣 " + it.required_units + " 课时（其中欠 " + Math.round((it.required_units - it.available_units) * 100) / 100 + " 课时，补缴课时包后自动补扣）"));
            continue;
          }
          if (it.required_units > 0) {
            const list = byUnits.get(it.required_units) || [];
            list.push(it.student_name);
            byUnits.set(it.required_units, list);
          }
        }
        for (const [units, names] of byUnits)
          ul.append(n("li", names.join("、") + (names.length > 1 ? " 各扣 " : " 扣 ") + units + " 课时"));
        for (const p of participants.filter((p) => draft.get(p.id) === "student_leave"))
          ul.append(n("li", p.student_name + " 请假：不扣课时，自动进入“待办 › 请假待补课”"));
        for (const b of preview.blocked || [])
          ul.append(n("li", (b.student_name || "学员") + " 超过欠课上限，保持待销课；加课时包后再单独销课", { class: "is-bad" }));
        if (enabled("teacher_pay", "read"))
          ul.append(n("li", data.teacher_name + " 本节课酬按课酬标准计入 " + Number(data.start_at.slice(5, 7)) + " 月"));
        ul.append(n("li", preview.locked ? "本月已锁定：需主管先解锁才能销课" : "锁月后不能再修改这节课的出勤"));
      } else if (!planned) {
        ul.append(
          n("li", participants.map((p) => p.student_name + " 课时 +" + (p.deducted || 0)).join("；")),
        );
        if (preview?.undo)
          ul.append(n("li", "教师课酬变化 " + F.money(preview.undo.teacher_pay_amount)));
        ul.append(n("li", "保留回补流水与操作记录"));
      }
      summary.append(ul);
    }
    async function refreshPreview() {
      if (!enabled("packages")) {
        renderRoster();
        return;
      }
      const request = ++seq;
      const response = await api("c2/lessons/" + data.id + "/preview", "POST", {
        participants: participants.map((p) => ({ id: p.id, attendance: draft.get(p.id) })),
      });
      if (request !== seq) return;
      preview = response;
      const blocked = response.blocked || [];
      const shortage = response.items.filter((x) => blocked.some((b) => b.participant_id === x.id));
      shortageBox.replaceChildren();
      shortageBox.hidden = !shortage.length && !response.locked;
      if (shortage.length) {
        shortageBox.append(
          n(
            "span",
            shortage.map((x) => x.student_name).join("、") +
              " 欠课时会超过上限，这次只给其他人销课；可以先加课时包，或改为“请假”。",
          ),
        );
        if (enabled("packages", "create"))
          shortageBox.append(
            button("加课时包", () =>
              creditForm(c, "packages", {
                student_id: shortage[0].student_id,
                course_type_id: data.course_type_id,
              }),
            ),
          );
      } else if (response.locked) shortageBox.append(n("span", "本月已锁定，请先由主管解锁。"));
      main.disabled = response.locked || (planned && !response.valid);
      renderRoster();
      renderSummary();
    }
    async function publishComments() {
      if (
        !enabled("comments", "correct") ||
        (!publicText.input.value && ![...personInputs.values()].some((x) => x.value))
      )
        return;
      try {
        await api("lessons/" + data.id + "/comments", "PUT", {
          operation_id: operation(),
          comment_fingerprint: reviewSnapshot.comment_fingerprint,
          public_text: publicText.input.value,
          people: participants.map((p) => ({
            participant_id: p.id,
            student_id: p.student_id,
            comment: personInputs.get(p.student_id)?.value || "",
          })),
        });
      } catch (e) {
        notice("销课已成功；点评未保存：" + e.message + "。可从课程点评单独更正。");
      }
    }
    const main = UI.button(planned ? "确认销课" : "撤销销课", {
      kind: planned ? "primary" : "danger",
      onClick: async () => {
        if (planned) {
          await refreshPreview();
          if (preview && !preview.valid) {
            notice(preview.warning || "有学生课时不足，不能确认。");
            return;
          }
          const done = await creditWrite("lessons/" + data.id + "/attendance", {
            lesson_version: data.version,
            participants: participants.map((p) => ({
              id: p.id,
              version: p.version,
              attendance: draft.get(p.id),
            })),
          });
          if (done.blocked?.length)
            notice(
              (done.committed ? "已销课。" : "这节课没有可销课的学员。") +
                done.blocked.map((b) => b.student_name || "学员").join("、") +
                " 超过欠课上限，仍待销课。",
            );
          if (!done.committed) return;
          await publishComments();
        } else {
          const text =
            participants.map((p) => p.student_name + "课时 +" + p.deducted).join("；") +
            (preview?.undo
              ? "；教师课酬 " + F.money(preview.undo.teacher_pay_amount)
              : "；按现有规则重算相关课酬");
          if (!(await UI.confirm({ title: "撤销销课？", consequence: text + "。保留回补流水与审计。" })))
            return;
          await creditWrite("lessons/" + data.id + "/undo", { lesson_version: data.version });
        }
        dirty = false;
        await view.close();
        vHead?.refresh?.();
        const route = document.querySelector(".v-content")?.dataset.route;
        if (route === "today") await home(c);
        else if (route === "todo-unchecked") await R().unchecked(c);
        else await schedulePage(c);
      },
    });
    main.classList.add("v-lesson-main");
    const more = [];
    if (planned && enabled("attendance", "update") && !pendingAtt)
      for (const [value, label] of [
        ["teacher_leave", "教师请假"],
        ["cancelled", "机构取消"],
      ])
        more.push({
          label,
          onSelect: async () => {
            if (
              await UI.confirm({
                title: label + "？",
                consequence: "按机构缺勤规则回补课时并重算课酬，保留审计。",
              })
            ) {
              await creditWrite("lessons/" + data.id + "/status", {
                lesson_version: data.version,
                status: value,
              });
              dirty = false;
              await view.close();
              await schedulePage(c);
            }
          },
        });
    if (enabled("attendance", "create"))
      more.push({ label: "安排补课", onSelect: () => makeupForm(c, data, participants[0]) });
    more.push({
      label: "教师提交与点评记录",
      onSelect: async () => {
        const body = n("section");
        view.body.append(body);
        await reviewScreen(body, data.id, () => reviewScreen(body, data.id));
      },
    });
    if (enabled("lessons", "delete") && enabled("attendance", "delete"))
      more.push({
        label: "删除",
        danger: true,
        onSelect: async () => {
          if (
            await UI.confirm({
              title: "删除课程？",
              consequence: "回补已扣课时；有关联补课或锁月时服务器拒绝。",
            })
          ) {
            await api("data/lessons/" + data.id, "DELETE", { version: data.version });
            dirty = false;
            await view.close();
            await schedulePage(c);
          }
        },
      });
    const footLeft = n("div", null, { class: "v-foot-left" });
    if (more.length) footLeft.append(UI.actionMenu({ items: more }).element);
    if (planned && enabled("lessons", "update"))
      footLeft.append(
        button("改时间", async () => {
          dirty = false;
          await view.close();
          await lessonForm(c, data);
        }),
      );
    view.footer.append(footLeft);
    if (enabled("attendance", "update") && !pendingAtt && (planned || data.status === "completed")) view.footer.append(main);
    renderRoster();
    renderSummary();
    await refreshPreview();
  };

  // 财务的“今天”：只放钱相关的数字和今天的课（只读）。
  async function financeToday(c, data, day) {
    c.replaceChildren();
    c.dataset.page = "home";
    const metrics = n("div", null, { class: "v-metrics" });
    const metric = (label, value, note, tone, hash) => {
      const card = n("button", null, { type: "button", class: "v-metric v-tone-" + tone });
      const big = n("p", null, { class: "v-metric-value" });
      big.append(n("strong", value));
      card.append(n("span", label, { class: "v-metric-label" }), big, n("small", note));
      card.addEventListener("click", () => go(hash));
      metrics.append(card);
    };
    if (data.tuition_amount !== undefined)
      metric("本月已收学费", F.money(data.tuition_amount), "按收款日期统计 · 去看收款", "money", "finance-income");
    if (enabled("tuition")) {
      const due = await api("finance/receivable-summary");
      metric(
        "待收款",
        F.money(due.amount),
        due.unresolved ? "另有 " + due.unresolved + " 笔待核对" : "按课时包应收减实收",
        due.unresolved ? "warn" : "ok",
        "finance-income",
      );
    }
    if (enabled("teacher_pay")) {
      const pay = await api("finance/payroll?month=" + day.slice(0, 7));
      const unpaid = (pay.items || []).reduce((s, x) => s + Number(x.unpaid_amount || 0), 0);
      metric("本月课酬未付", F.money(unpaid), "去月度结算登记付款", unpaid ? "bad" : "ok", "finance-pay");
    }
    c.append(metrics);
    const lessons = (data.lessons || []).slice().sort((a, b) => a.start_at.localeCompare(b.start_at));
    const list = panel("今日课程（只读）", [
      n("span", lessons.length + " 节", { class: "v-panel-meta" }),
      n("span", null, { class: "v-spacer" }),
      link("打开课表", () => go("schedule-week")),
    ]);
    list.classList.add("v-today-lessons");
    for (const row of lessons) {
      const line = n("div", null, { class: "v-lesson-row " + colorClass(row) });
      const who = n("div", null, { class: "v-lesson-who" }),
        name = n("p");
      name.append(n("strong", person(row)), n("span", " · " + row.course_name));
      who.append(name, n("small", row.teacher_name + " · " + (row.location_name || "线上")));
      const tail = n("div", null, { class: "v-lesson-tail" });
      tail.append(
        chip(
          overdue(row) ? "未销课" : row.status === "completed" ? "已销课" : me.labels.lessons[row.status] || "",
          overdue(row) ? "bad" : row.status === "completed" ? "ok" : "info",
        ),
      );
      line.append(n("time", F.range(row.start_at, row.duration || 45)), n("span", null, { class: "v-bar" }), who, tail);
      line.addEventListener("click", () => lessonDetail(c, row));
      list.append(line);
    }
    if (!lessons.length) list.append(n("p", "今天没有课程。", { class: "v-empty-line" }));
    const side = n("div", null, { class: "v-today-side" });
    const todo = panel("财务常用");
    for (const [title, sub, label, fn] of [
      ["登记一笔缴费", "先选学员，自动列出他的课时包", "登记缴费", () => creditForm(c, "payments")],
      ["月度结算", "财务提交 → 主管批准锁定", "去结算", () => go("finance-pay")],
      ["报表", "按上课确认收入 / 按实收现金", "看报表", () => go("finance-reports")],
    ]) {
      if (label === "登记缴费" && !enabled("tuition", "create")) continue;
      const item = n("div", null, { class: "v-todo-row" }),
        text = n("div", null, { class: "v-todo-text" });
      text.append(n("p", title), n("small", sub, { class: "v-tone-text-info" }));
      item.append(n("span", null, { class: "v-dot v-dot-info" }), text, button(label, fn));
      todo.append(item);
    }
    side.append(todo);
    const grid = n("div", null, { class: "v-today-grid" });
    grid.append(list, side);
    c.append(grid);
  }
  home = today;
})();
