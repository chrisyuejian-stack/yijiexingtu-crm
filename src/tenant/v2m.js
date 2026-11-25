// 第十阶段重构（v2）第 8 组：教师端、学员端手机页面。
// 只读既有接口；点名、点评、修改密码、登录设备等仍用原页面与原写入路径。
(() => {
  "use strict";
  const n = el,
    F = UI.fmt,
    V = () => globalThis.ChannelV2,
    C3 = () => globalThis.ChannelC3;
  const chip = (text, tone) => V().chip(text, tone);
  const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const WD = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const wd = (d) => WEEK[new Date(d + "T12:00:00Z").getUTCDay()];
  const md = (d) => Number(d.slice(5, 7)) + " 月 " + Number(d.slice(8, 10)) + " 日";
  const mmdd = (d) => d.slice(5, 10);
  const dayOf = (iso) => String(iso).slice(0, 10);
  const isTeacher = () => me.user.roles.includes("teacher");
  const ATT = { attended: ["出勤", "ok"], student_leave: ["请假", "warn"], no_show: ["旷课", "bad"], teacher_leave: ["老师请假", "muted"], cancelled: ["已取消", "muted"] };
  const LESSON = { planned: ["待上课", "info"], completed: ["已上课", "ok"], cancelled: ["已取消", "muted"] };
  function head(c, title, sub, extra) {
    const h = n("div", null, { class: "v-m-head" });
    const t = n("div");
    t.append(n("h1", title));
    if (sub) t.append(n("p", sub, { class: "v-muted" }));
    h.append(t);
    if (extra) h.append(extra);
    c.append(h);
  }
  const linkBtn = (text, fn) => V().link(text, fn);
  const empty = (text) => UI.empty({ text });
  const started = (row) => Date.parse(row.start_at) <= Date.now();
  // 与原个人页相同：修改密码用原表单；退出登录走原接口。
  const dialogPassword = () => changePassword(UI.drawer({ title: "修改密码" }).body);
  const logOut = async () => {
    await api("logout", "POST", {});
    location.assign(base + "login");
  };

  // ---------- 外框：底部四个标签 ----------
  let current = null;
  personalShell = () => {
    root.replaceChildren();
    const frame = n("div", null, { class: "personal-frame c3-personal v-personal" }),
      header = n("header", null, { class: "personal-header" }),
      identity = n("div");
    identity.append(n("strong", brand.display_name), n("small", me.user.name + (isTeacher() && !/老师$/.test(me.user.name) ? " 老师" : "")));
    header.append(mark(), identity);
    const content = n("section", null, { class: "personal-content" }),
      nav = n("nav", null, { class: "personal-nav", "aria-label": "个人导航" });
    const views = isTeacher()
      ? [
          ["schedule", "calendar", "课表", () => teacherWeek(content), enabled("schedule")],
          // 艺界星途：课后反馈与成长报告（阶段 6）。机构关闭成长报告模块时不显示。
          ["yxfeedback", "edit", "反馈", () => yxFeedbackPage(content), typeof yxFeedbackPage === "function" && me.policy?.modules?.growth_reports !== false],
          ["students", "users", "我的学生", () => C3().teacherStudents(content), enabled("students")],
          ["yxreports", "arrow-up", "报告", () => yxReportsPage(content), typeof yxReportsPage === "function" && me.policy?.modules?.growth_reports !== false],
          ["pay", "wallet", "课酬", () => teacherPay(content), enabled("teacher_pay")],
          ["my", "user", "我的", () => profile(content), true],
        ]
      : [
          ["schedule", "calendar", "课表", () => studentWeek(content), enabled("schedule")],
          ["records", "book", "上课记录", () => studentRecords(content), enabled("schedule")],
          ["balance", "wallet", "课时缴费", () => studentBalance(content), enabled("packages") || enabled("tuition")],
          ["my", "user", "我的", () => profile(content), true],
        ];
    const shown = views.filter((v) => v[4]);
    let run = 0;
    const select = async (key, fn) => {
      current = key;
      personalTab = key;
      for (const x of nav.children) x.setAttribute("aria-current", x.dataset.key === key ? "page" : "false");
      content.dataset.personalTab = key;
      content.setAttribute("aria-busy", "true");
      content.replaceChildren(UI.tableSkeleton());
      const g = ++run;
      try {
        await fn();
        content.scrollTop = 0;
      } catch (e) {
        if (g === run) content.replaceChildren(UI.empty({ text: e.message, action: { label: "重试", onSelect: () => select(key, fn) } }));
        notice(e.message);
      } finally {
        if (g === run) content.setAttribute("aria-busy", "false");
      }
    };
    for (const [key, icon, label, fn] of shown) {
      const b = button("", () => select(key, fn));
      b.dataset.key = key;
      b.append(UI.icon(icon), n("span", label));
      nav.append(b);
    }
    frame.append(header, content, nav);
    root.append(frame);
    if (me.user.must_change) {
      changePassword(content, true);
      nav.hidden = true;
      return;
    }
    const first = shown.find((v) => v[0] === personalTab) || shown[0];
    void select(first[0], first[3]);
  };

  // ---------- 课程卡片（教师、学员共用） ----------
  function lessonCard(c, row, back, { student = false, record = false } = {}) {
    const card = n("button", null, { type: "button", class: "v-m-lesson " + V().colorClass(row) });
    const time = n("span", null, { class: "v-m-time" });
    time.append(n("strong", F.time(row.start_at)), n("small", F.time(Date.parse(row.start_at) + row.duration * 60000)));
    const body = n("span", null, { class: "v-m-body" });
    const who = student ? row.teacher_name || "老师" : row.participants_summary?.class_name || (row.participants_summary?.names || []).join("、") || "";
    body.append(n("strong", row.course_name + (who && !student ? " · " + who : "")));
    body.append(n("small", (student ? who + " · " : "") + (row.mode === "online" ? "线上课" : row.location_name || "待定地点") + (!student && row.participants_summary?.count > 1 ? " · " + row.participants_summary.count + " 人" : "")));
    const tags = n("span", null, { class: "v-m-tags" });
    const own = row.own_attendance && row.own_attendance !== "planned" ? ATT[row.own_attendance] : null;
    if (own) tags.append(chip(own[0] + (student && row.own_deducted ? " · 扣 " + row.own_deducted + " 课时" : ""), own[1]));
    else if (!student && row.status === "planned" && started(row)) {
      tags.append(chip(row.review_status === "pending" ? "待教务确认" : "待点名", "warn"));
      if (row.review_status !== "pending") tags.append(n("span", "去点名 ›", { class: "v-m-go" }));
    } else if (record && row.status === "planned" && started(row)) tags.append(chip("待老师销课", "warn"));
    else tags.append(chip(...(LESSON[row.status] || ["", "muted"])));
    body.append(tags);
    card.append(time, body);
    card.addEventListener("click", () => (row.source_course_id ? personalPartner(c, row, back) : reviewScreen(c, row.id, back)));
    return card;
  }
  function weekStrip(from, items, selected, onPick) {
    const strip = n("div", null, { class: "v-m-strip", role: "group", "aria-label": "选择日期" });
    for (let i = 0; i < 7; i++) {
      const d = dateShift(from, i),
        cnt = items.filter((x) => dayOf(x.start_at) === d).length;
      const b = n("button", null, { type: "button", class: "v-m-day" + (d === selected ? " is-on" : "") + (d === todayBJ() ? " is-today" : ""), "aria-pressed": String(d === selected) });
      b.append(n("span", WD[i].slice(1)), n("strong", String(Number(d.slice(8)))), n("i", null, { class: "v-m-dots v-m-dots-" + Math.min(cnt, 3) }));
      b.addEventListener("click", () => onPick(d));
      strip.append(b);
    }
    return strip;
  }

  // ---------- 教师：课表 ----------
  async function teacherWeek(c) {
    const from = weekStart(personalDate),
      to = dateShift(from, 6);
    const items = (await scheduleRows(from, to)).sort((a, b) => a.start_at.localeCompare(b.start_at));
    const back = () => teacherWeek(c);
    c.replaceChildren();
    const mine = items.filter((x) => !x.source_course_id);
    const done = mine.filter((x) => x.status === "completed").length,
      waiting = mine.filter((x) => x.status === "planned" && started(x) && x.review_status !== "pending").length;
    head(
      c,
      "本周 " + mine.length + " 节",
      "已上 " + done + (waiting ? " · 待点名 " + waiting : "") + " · " + mmdd(from) + " 至 " + mmdd(to),
      enabled("exports", "export") ? linkBtn("课表图", () => timetableImage(c, from)) : null,
    );
    const nav = n("div", null, { class: "v-m-weeknav v-m-seg-nav", role: "group", "aria-label": "切换周" });
    nav.append(
      button("‹ 上周", () => ((personalDate = dateShift(personalDate, -7)), teacherWeek(c))),
      button("本周", () => ((personalDate = todayBJ()), teacherWeek(c))),
      button("下周 ›", () => ((personalDate = dateShift(personalDate, 7)), teacherWeek(c))),
    );
    c.append(nav, weekStrip(from, items, personalDate, (d) => ((personalDate = d), teacherWeek(c))));
    const rows = items.filter((x) => dayOf(x.start_at) === personalDate);
    const title = n("div", null, { class: "v-m-daytitle" });
    title.append(n("h2", md(personalDate) + " " + wd(personalDate)), n("span", (personalDate === todayBJ() ? "今天 " : "") + rows.length + " 节", { class: "v-muted" }));
    c.append(title);
    for (const row of rows) c.append(lessonCard(c, row, back));
    if (!rows.length) c.append(empty("这一天没有课。"));
  }

  // ---------- 教师：课酬 ----------
  const pState = { month: null };
  async function teacherPay(c) {
    const thisMonth = todayBJ().slice(0, 7),
      lastMonth = dateShift(thisMonth + "-01", -1).slice(0, 7);
    pState.month ||= thisMonth;
    const data = await api("finance/payroll?month=" + pState.month);
    const row = data.items[0];
    c.replaceChildren();
    head(c, "我的课酬");
    const seg = n("div", null, { class: "v-m-seg", role: "group", "aria-label": "月份" });
    for (const [m, label] of [
      [lastMonth, Number(lastMonth.slice(5)) + " 月"],
      [thisMonth, Number(thisMonth.slice(5)) + " 月（进行中）"],
    ]) {
      const b = n("button", label, { type: "button", class: pState.month === m ? "is-on" : "", "aria-pressed": String(pState.month === m) });
      b.addEventListener("click", () => ((pState.month = m), teacherPay(c)));
      seg.append(b);
    }
    c.append(seg);
    const mm = Number(pState.month.slice(5)) + " 月";
    const hero = n("section", null, { class: "v-m-hero" });
    const top = n("div", null, { class: "v-m-hero-top" });
    top.append(n("span", mm + "应得课酬"), n("span", data.locked ? "已确认" : "未确认", { class: "v-m-badge" }));
    hero.append(top, n("strong", F.money(row?.total_amount ?? 0), { class: "v-m-big" }));
    const foot = n("div", null, { class: "v-m-hero-foot" });
    foot.append(n("span", "已付 " + F.money(row?.paid_amount ?? 0)), n("span", "待付 " + F.money(row?.unpaid_amount ?? 0)));
    hero.append(foot);
    c.append(hero);
    // 计算明细：按课程、单价、计费方式合并（只算已经计酬的课）。
    const today = todayBJ();
    const paid = data.lessons.filter((l) => l.status !== "planned" && Number(l.amount) !== 0);
    const groups = new Map();
    for (const l of paid) {
      const key = l.course_name + "|" + l.rate + "|" + l.rate_basis;
      const g = groups.get(key) || { name: l.course_name, rate: l.rate, basis: l.rate_basis, qty: 0, amount: 0 };
      g.qty += Number(l.quantity || 0);
      g.amount += Number(l.amount || 0);
      groups.set(key, g);
    }
    const calc = V().panel("计算明细");
    const unit = (b) => me.labels.rate_units?.[b] || "节";
    for (const g of [...groups.values()].sort((a, b) => b.amount - a.amount)) {
      const line = n("div", null, { class: "v-m-line" });
      const l = n("span");
      l.append(g.name + " ", n("small", Math.round(g.qty * 100) / 100 + " " + unit(g.basis) + " × " + F.money(g.rate)));
      line.append(l, n("span", F.money(Math.round(g.amount * 100) / 100)));
      calc.append(line);
    }
    for (const a of data.adjustments || []) {
      const line = n("div", null, { class: "v-m-line" });
      line.append(n("span", "课酬调整 · " + (a.reason || "")), n("span", (a.amount > 0 ? "+" : "") + F.money(a.amount)));
      calc.append(line);
    }
    const total = n("div", null, { class: "v-m-line is-total" });
    total.append(n("span", "合计 · " + paid.length + " 节"), n("span", F.money(row?.total_amount ?? 0)));
    calc.append(total);
    const future = data.lessons.filter((l) => l.status === "planned" && dayOf(l.start_at) > today).length,
      pending = data.lessons.filter((l) => l.status === "planned" && dayOf(l.start_at) <= today).length;
    calc.append(
      n(
        "p",
        "学员请假、机构取消的课不计课酬；学员旷课照常计。" + (pending ? "还有 " + pending + " 节课没销课，销课后才计入。" : "") + (future ? "本月还有 " + future + " 节待上课。" : ""),
        { class: "v-muted v-m-note" },
      ),
    );
    c.append(calc);
    const pay = V().panel("付款记录");
    for (const p of data.payments || []) {
      const line = n("div", null, { class: "v-m-line" });
      line.append(n("span", mmdd(p.paid_at) + " " + (p.note || "付款")), n("span", F.money(p.amount)));
      pay.append(line);
    }
    if (row?.unpaid_amount > 0) {
      const line = n("div", null, { class: "v-m-line is-due" });
      line.append(n("span", "尾款（待付）"), n("span", F.money(row.unpaid_amount)));
      pay.append(line);
    }
    if (!(data.payments || []).length && !(row?.unpaid_amount > 0)) pay.append(n("p", "这个月还没有付款记录。", { class: "v-muted v-m-note" }));
    c.append(pay);
    c.append(
      linkBtn("查看 " + mm + "每节课明细 ›", () => {
        personalMonth = pState.month;
        return personalPay(c);
      }),
    );
  }

  // ---------- 学员：课表 ----------
  const rel = (d) => {
    const diff = Math.round((Date.parse(d + "T12:00:00Z") - Date.parse(todayBJ() + "T12:00:00Z")) / 86400000);
    return diff === 0 ? "今天" : diff === 1 ? "明天" : diff === 2 ? "后天" : diff > 0 ? diff + " 天后" : "";
  };
  async function studentWeek(c) {
    const from = weekStart(personalDate),
      to = dateShift(from, 6);
    const [items, next] = await Promise.all([scheduleRows(from, to), api("schedule-next").then((x) => x.record).catch(() => null)]);
    const back = () => studentWeek(c);
    c.replaceChildren();
    head(c, "我的课表", null, enabled("exports", "export") ? linkBtn("保存课表图", () => timetableImage(c, from)) : null);
    const hero = n("section", null, { class: "v-m-hero is-next" });
    if (next) {
      const d = dayOf(next.start_at);
      hero.append(
        n("span", "下一节课" + (rel(d) ? " · " + rel(d) : ""), { class: "v-m-hero-label" }),
        n("strong", mmdd(d) + " " + wd(d) + " " + F.range(next.start_at, next.duration), { class: "v-m-hero-time" }),
        n("span", next.course_name + " · " + (next.teacher_name || "老师") + " · " + (next.mode === "online" ? "线上课" : next.location_name || "待定地点")),
        n("small", "需要请假请提前联系机构教务"),
      );
    } else hero.append(n("span", "下一节课", { class: "v-m-hero-label" }), n("strong", "暂未安排", { class: "v-m-hero-time" }), n("small", "有疑问请联系机构老师"));
    c.append(hero);
    const title = n("div", null, { class: "v-m-daytitle" });
    title.append(n("h2", (from <= todayBJ() && todayBJ() <= to ? "本周 · " : "") + mmdd(from) + " 至 " + mmdd(to)), n("span", "共 " + items.length + " 节", { class: "v-muted" }));
    const nav = n("div", null, { class: "v-m-weeknav" });
    nav.append(
      button("‹ 上周", () => ((personalDate = dateShift(personalDate, -7)), studentWeek(c))),
      button("本周", () => ((personalDate = todayBJ()), studentWeek(c))),
      button("下周 ›", () => ((personalDate = dateShift(personalDate, 7)), studentWeek(c))),
    );
    c.append(title, nav);
    const list = n("div", null, { class: "v-m-week" });
    for (const row of items.sort((a, b) => a.start_at.localeCompare(b.start_at))) {
      const line = lessonCard(c, row, back, { student: true, record: true });
      line.querySelector(".v-m-time").replaceChildren(n("strong", wd(dayOf(row.start_at))), n("small", F.time(row.start_at)));
      list.append(line);
    }
    if (!items.length) list.append(empty("这一周没有课。"));
    c.append(list);
  }

  // ---------- 学员：上课记录 ----------
  const rState = { course: "" };
  async function studentRecords(c) {
    const from = personalMonth + "-01",
      end = dateShift(dateShift(from, 32).slice(0, 7) + "-01", -1);
    const items = (await scheduleRows(from, end)).filter((r) => !r.source_course_id && started(r)).sort((a, b) => b.start_at.localeCompare(a.start_at));
    c.replaceChildren();
    const att = items.filter((r) => r.own_attendance === "attended").length,
      leave = items.filter((r) => r.own_attendance === "student_leave").length;
    head(c, "上课记录", Number(personalMonth.slice(5)) + " 月 · 出勤 " + att + (leave ? " · 请假 " + leave : ""));
    const nav = n("div", null, { class: "v-m-weeknav" });
    const shift = (k) => {
      personalMonth = dateShift(personalMonth + "-15", k * 30).slice(0, 7);
      return studentRecords(c);
    };
    nav.append(button("‹ 上月", () => shift(-1)), n("strong", Number(personalMonth.slice(0, 4)) + " 年 " + Number(personalMonth.slice(5)) + " 月"), button("下月 ›", () => shift(1)));
    c.append(nav);
    const courses = [...new Set(items.map((r) => r.course_name))];
    if (courses.length > 1) {
      const box = n("div", null, { class: "v-filter-chips v-m-chips" });
      for (const [k, t] of [["", "全部"], ...courses.map((x) => [x, x])]) {
        const b = n("button", t, { type: "button", class: "v-filter-chip" + (rState.course === k ? " is-on" : "") });
        b.addEventListener("click", () => ((rState.course = k), studentRecords(c)));
        box.append(b);
      }
      c.append(box);
    }
    const shown = items.filter((r) => !rState.course || r.course_name === rState.course);
    for (const r of shown) {
      const card = n("article", null, { class: "v-m-record" });
      const top = n("div", null, { class: "v-m-record-top" });
      const own = ATT[r.own_attendance];
      top.append(n("strong", mmdd(r.start_at) + " " + wd(dayOf(r.start_at)) + " " + F.time(r.start_at)), own ? chip(own[0], own[1]) : chip(r.status === "planned" ? "待老师销课" : "—", "muted"));
      card.append(top, n("p", r.course_name + " · " + (r.teacher_name || "老师") + (r.own_deducted ? " · 扣 " + r.own_deducted + " 课时" : r.own_attendance === "student_leave" ? " · 不扣课时" : ""), { class: "v-muted" }));
      for (const t of [r.public_text, r.private_comment]) if (t) card.append(n("p", t, { class: "preserve-text v-m-comment" }));
      if (r.homework) {
        const hw = n("p", null, { class: "v-m-homework preserve-text" });
        hw.append(n("strong", "作业："), r.homework);
        card.append(hw);
      }
      c.append(card);
    }
    if (!shown.length) c.append(empty("这个月还没有上课记录。"));
    if (enabled("attendance")) {
      const mk = await R3take("credits/makeups");
      if (mk.length) {
        const p = V().panel("请假与补课");
        for (const row of mk) p.append(n("p", (row.original_course || "原课") + " " + mmdd(dayOf(row.original_start)) + " → " + (row.target_course || "补课") + " " + mmdd(dayOf(row.target_start)), { class: "v-m-note" }));
        c.append(p);
      }
    }
  }
  const R3take = (p) => globalThis.ChannelRebuild.take(p).catch(() => []);

  // ---------- 学员：课时与缴费 ----------
  async function studentBalance(c) {
    const [pkgs, pays] = await Promise.all([enabled("packages") ? R3take("credits/packages") : [], enabled("tuition") ? R3take("credits/payments") : []]);
    c.replaceChildren();
    head(c, "课时与缴费");
    const live = pkgs.filter((p) => p.status === "active" || p.balance > 0).sort((a, b) => String(b.valid_to || "").localeCompare(String(a.valid_to || "")));
    for (const p of live) {
      const card = n("section", null, { class: "v-m-pkg" });
      const top = n("div", null, { class: "v-m-record-top" });
      top.append(n("strong", p.course_name + " · " + p.units_total + " 课时"), n("span", p.valid_to ? "至 " + p.valid_to : "不限有效期", { class: "v-muted" }));
      const big = n("p", null, { class: "v-m-pkg-num" });
      big.append(n("strong", String(p.balance)), n("span", " / " + p.units_total + " 课时剩余"));
      const bar = n("progress", null, { max: String(p.units_total || 1), value: String(Math.max(0, p.balance)), class: "v-m-progress" + (p.balance <= 0 ? " is-zero" : "") });
      card.append(top, big, bar);
      if (p.balance <= 0) card.append(n("p", "课时已用完，请联系老师续费。", { class: "v-m-note v-bal-zero" }));
      c.append(card);
    }
    if (enabled("packages") && !live.length) c.append(empty("目前没有在用的课时包。"));
    if (enabled("packages")) {
      const tx = await R3take("credits/transactions");
      if (tx.length) {
        const p = V().panel("课时变动");
        for (const t of tx.slice(0, 8)) {
          const line = n("div", null, { class: "v-m-line" });
          line.append(n("span", mmdd(String(t.date)) + " " + (t.note || ({ purchase: "购买", consume: "上课", reversal: "回补", adjustment: "调整", transfer_in: "转入", transfer_out: "转出" }[t.type] || "变动"))), n("span", (t.delta > 0 ? "+" : "") + t.delta, { class: t.delta < 0 ? "v-bal-zero" : "" }));
          p.append(line);
        }
        c.append(p);
      }
    }
    if (enabled("tuition")) {
      const p = V().panel("缴费记录");
      for (const r of pays.sort((a, b) => b.paid_at.localeCompare(a.paid_at))) {
        const line = n("div", null, { class: "v-m-line" });
        line.append(n("span", r.paid_at + (r.note ? " · " + r.note : "")), n("span", F.money(r.amount)));
        p.append(line);
      }
      if (!pays.length) p.append(n("p", "还没有缴费记录。", { class: "v-muted v-m-note" }));
      c.append(p);
    }
  }

  // ---------- 我的 ----------
  async function profile(c) {
    c.replaceChildren();
    const card = n("section", null, { class: "v-m-me" });
    const av = n("span", Array.from(me.user.name || "?")[0], { class: "v-avatar-mark is-big" });
    const t = n("div");
    t.append(n("strong", me.user.name + (isTeacher() && !/老师$/.test(me.user.name) ? " 老师" : "")), n("span", brand.display_name, { class: "v-muted" }));
    card.append(av, t);
    c.append(card);
    const list = n("div", null, { class: "v-m-menu" });
    for (const [label, fn, danger] of [
      ["修改密码", dialogPassword],
      ["登录设备", () => devices()],
      ["退出登录", logOut, true],
    ]) {
      const b = n("button", null, { type: "button", class: "v-m-menu-item" + (danger ? " is-danger" : "") });
      b.append(n("span", label), n("span", "›", { class: "v-muted" }));
      b.addEventListener("click", fn);
      list.append(b);
    }
    c.append(list);
  }

  // ---------- 课程详情 / 点名（教师、学员手机）：沿用原页面与提交逻辑，只重排版面 ----------
  const oldReview = reviewScreen;
  reviewScreen = async (c, id, back) => {
    await oldReview(c, id, back);
    if (!c.closest?.(".v-personal")) return;
    const data = c.__reviewSnapshot,
      l = data?.lesson;
    if (!l) return;
    // 顶部：‹ 课程详情
    const [first, second] = c.children;
    if (first?.matches("button") && second?.tagName === "H1") {
      const bar = n("div", null, { class: "v-m-backbar" });
      const b = n("button", null, { type: "button", class: "v-m-back", "aria-label": "返回" });
      b.append(UI.icon("chevron-left"));
      b.addEventListener("click", () => back());
      bar.append(b, n("h1", "课程详情"));
      first.replaceWith(bar);
      second.remove();
    }
    // 与课表列表同一口径：已提交待确认 / 已开始未点名 / 原状态
    const lessonChip = () => {
      const st = data.submission?.status;
      if (st === "pending") return ["待教务确认", "warn"];
      if (st === "returned") return ["已退回", "bad"];
      if (isTeacher() && l.status === "planned" && Date.parse(l.start_at) <= Date.now()) return ["待点名", "warn"];
      return LESSON[l.status] || ["", "muted"];
    };
    // 课程概要
    const old = [...c.querySelectorAll(":scope > .ui-card")].find((x) => x.querySelector(".ui-card-title")?.textContent === l.course_name);
    if (old) {
      const card = n("section", null, { class: "v-m-sum " + V().colorClass(l) });
      const people = data.participants.length;
      card.append(
        n("h2", l.course_name),
        n("p", mmdd(l.start_at) + " " + wd(dayOf(l.start_at)) + " " + F.time(l.start_at) + "–" + F.time(Date.parse(l.start_at) + l.duration * 60000) + " · " + (l.location_name || "线上课")),
      );
      const meta = n("p", null, { class: "v-m-sum-meta" });
      meta.append((people > 1 ? "班课 " + people + " 人 · 每人计 " : "每人计 ") + l.units + " 课时", chip(...lessonChip()));
      card.append(meta);
      old.replaceWith(card);
    }
    // 教师：没有已确认点评时，不显示空卡片
    if (isTeacher())
      for (const x of c.querySelectorAll(":scope > .ui-card"))
        if (x.textContent.includes("暂无已确认点评")) x.remove();
    // 点名表单
    const form = c.querySelector(".c3-checkin-row")?.closest("form");
    if (form) {
      form.classList.add("v-m-checkin");
      const rows = [...form.querySelectorAll(".c3-checkin-row")];
      for (const row of rows)
        for (const x of row.querySelectorAll(".c2-attendance-buttons button")) {
          const face = x.querySelector(".ui-button-face span") || x;
          if (x.dataset.attendance === "attended") face.textContent = "出勤";
          if (x.dataset.attendance === "no_show") face.textContent = "旷课";
        }
      const roll = n("section", null, { class: "v-m-roll" });
      const head = n("div", null, { class: "v-m-roll-head" });
      head.append(
        n("h2", "点名"),
        button("全部出勤", () => {
          for (const row of rows) row.querySelector('[data-attendance="attended"]')?.click();
        }),
      );
      roll.append(head);
      form.querySelector(":scope > h2")?.remove();
      for (const row of rows) roll.append(row);
      form.prepend(roll);
      // 课后点评：原“全班内容与作业”折叠区里的输入框，放进独立卡片（仍在表单内，提交方式不变）
      const fields = ["public_text", "homework"].map((k) => form.elements[k]?.closest("label")).filter(Boolean);
      if (fields.length) {
        const disclosure = fields[0].closest("section");
        const box = n("section", null, { class: "v-m-review" });
        const h = n("div", null, { class: "v-m-roll-head" });
        h.append(n("h2", "课后点评"), n("span", "该课学员可见", { class: "v-muted" }));
        box.append(h, ...fields);
        roll.after(box);
        if (disclosure && disclosure !== form && !disclosure.contains(roll)) disclosure.remove();
      }
      const submitBtn = form.querySelector("button[type=submit]");
      if (submitBtn) {
        const bar = n("div", null, { class: "v-m-submitbar" });
        bar.append(submitBtn, n("small", "提交后由教务确认，确认后扣课时、计课酬"));
        form.append(bar);
        const face = submitBtn.querySelector(".ui-button-face span");
        if (face && face.textContent.includes("等待教务确认")) face.textContent = "提交出勤与点评";
      }
    }
  };

  globalThis.ChannelV2Mobile = { teacherWeek, teacherPay, studentWeek, studentRecords, studentBalance, profile };
})();
