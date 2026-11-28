// 今天页（设计稿 10）：功能优先。左边“接下来要做”是主角——按“现在就做 / 今天内 / 可以晚点”分组，
// 每条写清为什么、给一个主按钮，大部分事在这一页做完（记录回访就地填写）。右边是今日课程、平台推送、系统消息。
// 只读既有接口拼出待办；写入沿用原来的接口。财务账号仍用原来的财务今天页。
(() => {
  "use strict";
  const n = el,
    F = UI.fmt,
    V = () => globalThis.ChannelV2,
    R = () => globalThis.ChannelRebuild,
    Pay = () => globalThis.ChannelV2Pay;
  const chip = (text, tone) => V().chip(text, tone);
  const oldHome = home;
  const go = (hash) => (location.hash = hash);
  const tState = { who: "mine", type: "", later: false, open: null };
  const TYPES = {
    unchecked: ["未销课", "bad"],
    submit: ["老师已提交", "warn"],
    debt: ["欠课时", "bad"],
    followup: ["跟进", "warn"],
    makeup: ["待补课", "warn"],
    renewal: ["续费", "warn"],
    payment: ["收款核对", "info"],
    stage: ["学习阶段", "info"],
    lead: ["线索回访", "info"],
  };
  const SNOOZE = "v-today-snooze";
  const snoozed = () => {
    try {
      const all = JSON.parse(localStorage.getItem(SNOOZE) || "{}"),
        day = todayBJ();
      return new Set(Object.entries(all).filter(([, d]) => d > day).map(([k]) => k));
    } catch {
      return new Set();
    }
  };
  const snooze = (key) => {
    try {
      const all = JSON.parse(localStorage.getItem(SNOOZE) || "{}"),
        day = todayBJ();
      for (const [k, d] of Object.entries(all)) if (d <= day) delete all[k];
      all[key] = dateShift(day, 1);
      localStorage.setItem(SNOOZE, JSON.stringify(all));
    } catch {
      /* 浏览器不让存时，本次刷新前隐藏 */
    }
  };
  const ago = (iso) => {
    const h = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 3600000));
    return h < 24 ? "已过 " + h + " 小时" : "已过 " + Math.floor(h / 24) + " 天";
  };
  const days = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
  const sinkTo = (fn) => {
    const box = n("div");
    new MutationObserver((_, o) => {
      o.disconnect();
      fn();
    }).observe(box, { childList: true });
    return box;
  };

  async function load() {
    const day = todayBJ();
    // 第二个参数是“发请求的函数”：没有权限时根本不发请求（以前会先发出去再丢弃结果）。
    const may = (ok, run) => (ok ? run().catch(() => null) : Promise.resolve(null));
    // 推荐卡片和跟进任务也在这一批一起发出，不再排在后面等。
    globalThis.__promoRec = enabled("promo") ? api("promo/recommend").catch(() => null) : null;
    const followRequests = enabled("followup")
      ? ["overdue", "today"].map((g) => api("c2/followups?group=" + g + "&owner=&offset=0").then((x) => x.items || []).catch(() => null))
      : null;
    // 系统消息不挡首页：和其他数据同时发出，但页面不等它，回来后再补上通知条和消息卡片。
    const msgs = api("system-messages?offset=0").catch(() => null);
    const [data, colors, unchecked, subs, makeups, due, debt] = await Promise.all([
      api("c2/home"),
      may(enabled("schedule"), () => api("schedule?from=" + day + "&to=" + dateShift(day, 1))),
      may(enabled("schedule") && enabled("attendance", "update"), () => api("c2/unchecked?offset=0")),
      may(enabled("attendance", "confirm"), () => api("submissions?status=pending&from=" + dateShift(day, -60) + "&to=" + dateShift(day, 1) + "&offset=0")),
      may(enabled("attendance", "create"), () => api("c2/makeups?offset=0")),
      may(enabled("tuition"), () => api("finance/receivable-summary")),
      may(enabled("packages"), () => api("c2/renewals?group=debt&offset=0")),
    ]);
    // 跟进任务用待办页同一个接口（带版本号，才能就地保存）。
    if (followRequests) {
      const [late, now] = await Promise.all(followRequests);
      if (late && now) data.tasks = [...late, ...now].filter((t) => t.id && t.version !== undefined);
    }
    const colorOf = new Map((colors?.items || []).map((x) => [x.id, x.category_color]));
    for (const row of data.lessons || []) row.category_color ||= colorOf.get(row.id);
    return { day, data, unchecked, subs, makeups, due, debt, msgs };
  }

  function buildItems(c, ctx, reload) {
    const { day, data } = ctx,
      items = [],
      hide = snoozed();
    const add = (it) => {
      if (!hide.has(it.key)) items.push(it);
    };
    for (const r of ctx.unchecked?.items || [])
      add({
        key: "u:" + r.id,
        type: "unchecked",
        group: "now",
        who: F.time(r.start_at) + " " + (r.course_name || "课程") + " · " + V().person(r),
        why: (r.start_at.slice(0, 10) === day ? "" : F.day(r.start_at) + " · ") + (r.teacher_name || "") + " · " + ago(r.start_at),
        primary: ["销课", () => lessonDetail(c, r)],
      });
    for (const r of ctx.subs?.items || [])
      add({
        key: "s:" + r.submission_id,
        type: "submit",
        group: "now",
        who: F.day(r.start_at) + " " + F.time(r.start_at) + " " + r.course_name + " · " + r.teacher_name + " 提交了出勤",
        why: "确认前不扣课、不计课酬 · 月结前必须处理",
        primary: ["去确认", () => lessonDetail(c, { id: r.lesson_id, start_at: r.start_at, status: r.lesson_status })],
      });
    for (const r of ctx.debt?.items || [])
      add({
        key: "d:" + r.student_id + ":" + (r.course_type_id || r.category_id || ""),
        type: "debt",
        group: "now",
        who: r.student_name + " · " + (r.course_name || "课程") + " 欠 " + F.units(r.debt_units),
        why: "买课时包或用预收余额兑换后自动补扣",
        primary: enabled("tuition", "create") ? ["登记缴费", () => Pay().payForm({ student_id: r.student_id, student_name: r.student_name }, reload)] : ["查看学员", () => R().goStudent(r.student_id, "packages")],
        secondary: enabled("packages", "create")
          ? ["加课时包", () => creditForm(sinkTo(reload), "packages", { student_id: r.student_id, course_type_id: r.course_type_id })]
          : null,
      });
    for (const t of data.tasks || []) {
      if (t.due_date > day) continue;
      const late = t.due_date < day;
      add({
        key: "f:" + t.id,
        type: "followup",
        group: late ? "now" : "today",
        mine: !t.assignee_id || t.assignee_id === me.user.id,
        who: (t.student_name ? t.student_name + " · " : "") + t.title,
        why: (late ? "逾期 " + days(t.due_date, day) + " 天" : "今天到期") + (t.assignee_name ? " · 负责人 " + t.assignee_name : " · 待指派"),
        tone: late ? "bad" : "warn",
        task: t,
        primary: enabled("followup", "update") ? ["记录回访", null] : ["查看", () => go("todo-followup")],
        snooze: enabled("followup", "update")
          ? async () => {
              await followupSave(t, { due_date: dateShift(day, 1) });
              await reload();
            }
          : null,
      });
    }
    // 请假待补课：只放最近 30 天的（更早的在“待办 · 请假待补课”里收起，和那里的角标一致）。
    const cut = dateShift(day, -7),
      oldest = dateShift(day, -30);
    for (const r of (ctx.makeups?.items || []).filter((x) => x.start_at.slice(0, 10) >= oldest))
      add({
        key: "m:" + r.id,
        type: "makeup",
        group: r.start_at.slice(0, 10) >= cut ? "today" : "later",
        who: r.student_name + " · " + F.day(r.start_at) + " " + r.course_name + " 请假",
        why: "原老师 " + (r.teacher_name || "未指定") + " · 补课排好后自动关联",
        primary: [
          "安排补课",
          async () => {
            const l = (await api("data/lessons/" + r.lesson_id)).record;
            await makeupForm(sinkTo(reload), l, l.participants.find((x) => x.id === r.id) || l.participants[0]);
          },
        ],
      });
    // 续费：用首页数据里的完整名单（“接下来要做”的服务器版本最多只给 6 条）。
    for (const a of data.renewals || []) {
      if (!(a.balance <= 0 || a.expiring)) continue;
      const zero = a.balance <= 0;
      add({
        key: "r:" + a.id,
        type: "renewal",
        group: zero ? "today" : "later",
        who: a.student_name + " · " + (a.course_name || "课程") + (zero ? " 课时已用完" : " 课时包快到期"),
        why: zero ? "下节课前先联系家长续费" : "剩 " + F.units(a.balance) + (a.valid_to ? " · 至 " + a.valid_to : ""),
        primary: ["发续费提醒", () => go("todo-renewal")],
        secondary: enabled("packages", "create")
          ? ["加课时包", () => creditForm(sinkTo(reload), "packages", { student_id: a.student_id, course_type_id: a.course_type_id })]
          : null,
      });
    }
    for (const a of data.actions || []) {
      if (a.kind === "stage")
        add({
          key: "g:" + a.id,
          type: "stage",
          group: "today",
          who: a.title.replace(" · 今天", ""),
          why: "需要定下一阶段目标",
          primary: ["更新阶段", () => R().goStudent(a.student_id, "stages")],
        });
      else if (a.kind === "lead")
        add({
          key: "l:" + a.id,
          type: "lead",
          group: "later",
          who: a.title,
          why: "试听线索，今天约好回访",
          primary: ["回访", () => searchLeadDetail(c, a.id)],
        });
    }
    if (ctx.due?.unresolved)
      add({
        key: "p:" + todayBJ(),
        type: "payment",
        group: "today",
        who: ctx.due.unresolved + " 笔缴费或课时包待核对",
        why: "没关联课时包的缴费、没填价格的课时包，处理一条少一条",
        primary: [
          "去处理",
          () => {
            globalThis.ChannelV2Finance?.payTab?.("pending");
            go("finance-income");
          },
        ],
      });
    return items;
  }

  async function followupSave(t, changes) {
    // 没有负责人的旧任务改日期时，服务器要求指定负责人：就记在当前账号名下。
    const reassign = !t.assignee_id && changes.due_date && changes.due_date !== t.due_date;
    return api("tools/followup_tasks/" + t.id, "PATCH", {
      student_id: t.student_id,
      title: t.title,
      due_date: t.due_date,
      assignee_id: reassign ? me.user.id : t.assignee_id,
      done: !!t.done,
      ...changes,
      version: t.version,
    });
  }
  // 记录回访：就地填写，保存后自动打开下一条。
  function followupInline(it, reload, next) {
    const t = it.task,
      box = n("div", null, { class: "v-td-inline" });
    let result = "已联系，有意向",
      nextDays = 3;
    const seg = (items, cur, set) => {
      const g = n("div", null, { class: "v-td-chips", role: "group" });
      for (const [v, label] of items) {
        const b = n("button", label, { type: "button", class: "v-td-chip", "aria-pressed": String(v === cur) });
        b.addEventListener("click", () => {
          set(v);
          for (const x of g.children) x.setAttribute("aria-pressed", String(x === b));
        });
        g.append(b);
      }
      return g;
    };
    const text = n("textarea", null, { rows: "2", maxlength: "6000", placeholder: "沟通了什么（选填）", "aria-label": "沟通内容" });
    const row = n("div", null, { class: "v-td-inline-foot" });
    row.append(
      n("span", "下次跟进", { class: "v-muted" }),
      seg(
        [
          [1, "明天"],
          [3, "3 天后"],
          [7, "下周"],
          [0, "不再跟进"],
        ],
        nextDays,
        (v) => (nextDays = v),
      ),
      n("span", null, { class: "v-spacer" }),
      button("取消", () => {
        tState.open = null;
        box.remove();
      }),
      UI.button("保存，下一条", {
        kind: "primary",
        onClick: async () => {
          const note = result + (text.value.trim() ? "：" + text.value.trim() : "");
          if (t.student_id && enabled("followup", "create")) {
            const now = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
              .format(new Date())
              .replace(" ", "T");
            await api("tools/followup_notes", "POST", { student_id: t.student_id, at: now, content: t.title + " · " + note });
          }
          await followupSave(t, nextDays ? { due_date: dateShift(todayBJ(), nextDays) } : { done: true });
          notice(nextDays ? "已记录，" + (nextDays === 1 ? "明天" : nextDays + " 天后") + "再跟进" : "已记录，这条跟进完成", "success");
          tState.open = next || null;
          await reload();
        },
      }),
    );
    box.append(
      n("p", "记录回访 · " + (t.student_name || t.title), { class: "v-td-inline-title" }),
      seg(
        [
          ["已联系，有意向", "已联系，有意向"],
          ["已联系，暂不考虑", "已联系，暂不考虑"],
          ["没接通", "没接通"],
        ],
        result,
        (v) => (result = v),
      ),
      text,
      row,
    );
    setTimeout(() => text.focus(), 0);
    return box;
  }

  function actionsPanel(c, items, reload) {
    const box = n("section", null, { class: "v-panel v-td-main" });
    const head = n("header", null, { class: "v-panel-head" });
    const anyMine = items.some((x) => x.mine !== undefined);
    const shownByWho = items.filter((x) => tState.who === "all" || x.mine !== false);
    head.append(n("h2", "接下来要做"), n("span", String(shownByWho.length), { class: "v-count" }));
    if (anyMine) {
      const seg = n("div", null, { class: "v-seg v-td-who", role: "group", "aria-label": "范围" });
      for (const [k, label] of [
        ["mine", "我的"],
        ["all", "全部"],
      ]) {
        const b = n("button", label, { type: "button", class: "v-seg-item", "aria-pressed": String(tState.who === k) });
        b.addEventListener("click", () => {
          tState.who = k;
          void reload(true);
        });
        seg.append(b);
      }
      head.append(seg);
    }
    head.append(n("span", null, { class: "v-spacer" }), V().link("全部待办", () => go("todo-unchecked")));
    box.append(head);
    // 类型筛选
    const counts = new Map();
    for (const it of shownByWho) counts.set(it.type, (counts.get(it.type) || 0) + 1);
    if (counts.size > 1) {
      const chips = n("div", null, { class: "v-filter-chips v-td-types", role: "group", "aria-label": "按类型" });
      for (const [k, label, count] of [["", "全部", shownByWho.length], ...[...counts].map(([k, v]) => [k, TYPES[k][0], v])]) {
        const b = n("button", label, { type: "button", class: "v-filter-chip" + (tState.type === k ? " is-on" : ""), "aria-pressed": String(tState.type === k) });
        b.append(n("span", String(count), { class: "v-chip-count" }));
        b.addEventListener("click", () => {
          tState.type = k;
          void reload(true);
        });
        chips.append(b);
      }
      box.append(chips);
    }
    const shown = shownByWho.filter((x) => !tState.type || x.type === tState.type);
    if (!shown.length) {
      box.append(UI.empty({ text: items.length ? "这一类现在没有要做的事。" : "今天没有需要处理的事。" }));
      return box;
    }
    const groups = [
      ["now", "现在就做 · 已经过时间"],
      ["today", "今天内"],
      ["later", "可以晚点"],
    ];
    const followups = shown.filter((x) => x.type === "followup").map((x) => x.key);
    for (const [g, label] of groups) {
      const list = shown.filter((x) => x.group === g);
      if (!list.length) continue;
      const gh = n("div", null, { class: "v-td-group" });
      gh.append(n("span", label + " · " + list.length));
      box.append(gh);
      if (g === "later" && !tState.later && list.length > 0) {
        const more = n("button", "展开 " + list.length + " 条 ▾", { type: "button", class: "v-link-btn" });
        more.addEventListener("click", () => {
          tState.later = true;
          void reload(true);
        });
        gh.append(more);
        continue;
      }
      for (const it of list) {
        const [tlabel, ttone] = TYPES[it.type];
        const line = n("div", null, { class: "v-td-row" });
        const text = n("div", null, { class: "v-td-text" });
        text.append(n("p", it.who, { class: "v-td-who-line" }), n("small", it.why, { class: "v-tone-text-" + (it.tone || (g === "now" ? "bad" : "muted")) }));
        const ops = n("div", null, { class: "v-td-ops" });
        if (it.secondary) ops.append(V().link(it.secondary[0], it.secondary[1]));
        ops.append(
          V().link("明天再说", async () => {
            if (it.snooze) await it.snooze();
            else {
              snooze(it.key);
              await reload(true);
            }
          }),
        );
        const [plabel, pfn] = it.primary;
        ops.append(
          UI.button(plabel, {
            kind: "primary",
            onClick: async () => {
              if (it.type === "followup" && !pfn) {
                tState.open = tState.open === it.key ? null : it.key;
                await reload(true);
                return;
              }
              await pfn();
            },
          }),
        );
        line.append(chip(tlabel, ttone), text, ops);
        box.append(line);
        if (it.type === "followup" && tState.open === it.key) {
          const i = followups.indexOf(it.key);
          box.append(followupInline(it, reload, followups[i + 1]));
        }
      }
    }
    return box;
  }

  function lessonsPanel(c, ctx) {
    const lessons = (ctx.data.lessons || []).slice().sort((a, b) => a.start_at.localeCompare(b.start_at));
    const done = lessons.filter((x) => x.status === "completed").length;
    const box = V().panel("今日课程", [
      n("span", lessons.length + " 节 · 已销 " + done, { class: "v-panel-meta" }),
      n("span", null, { class: "v-spacer" }),
      enabled("schedule") ? V().link("课表", () => go("schedule-week")) : null,
    ]);
    box.classList.add("v-td-lessons");
    let markerPut = false;
    const nowMs = Date.now();
    for (const row of lessons) {
      if (!markerPut && Date.parse(row.start_at) > nowMs) {
        markerPut = true;
        box.append(n("div", "现在 " + F.time(new Date(nowMs).toISOString()), { class: "v-td-now" }));
      }
      const line = n("button", null, { type: "button", class: "v-td-lesson " + V().colorClass(row) + (V().overdue(row) ? " is-late" : "") });
      const whoLabel = V().person(row);
      const coursePart = row.course_name && whoLabel !== row.course_name ? row.course_name : "";
      const summary = [whoLabel, coursePart, row.teacher_name].filter(Boolean).join(" · ");
      line.append(n("time", F.time(row.start_at)), n("span", summary, { class: "v-td-lesson-who" }));
      line.append(
        V().overdue(row)
          ? chip("未销课", "bad")
          : chip(row.status === "completed" ? "已销" : me.labels.lessons[row.status] || "待上课", row.status === "completed" ? "ok" : "muted"),
      );
      line.addEventListener("click", () => lessonDetail(c, row));
      box.append(line);
    }
    if (!markerPut && lessons.length) box.append(n("div", "今天的课都结束了", { class: "v-td-now" }));
    if (!lessons.length) box.append(n("p", "今天没有课。", { class: "v-empty-line" }));
    return box;
  }

  function messagesPanel(ctx, reload) {
    const items = (ctx.msgs?.items || []).filter((m) => !m.is_read).slice(0, 3);
    if (!items.length) return null;
    const box = V().panel("系统消息", [chip(items.length + " 未读", "bad"), n("span", null, { class: "v-spacer" }), V().link("全部", () => go("settings-messages"))]);
    box.classList.add("v-td-msgs");
    for (const m of items) {
      const line = n("div", null, { class: "v-td-msg" });
      line.append(n("span", null, { class: "v-dot v-dot-bad" }), n("strong", m.title));
      box.append(line);
    }
    return box;
  }

  async function todayV(c, quick) {
    const ctx = quick && todayV.ctx ? todayV.ctx : await load();
    todayV.ctx = ctx;
    const reload = async (local) => {
      if (local !== true) todayV.ctx = null;
      await todayV(c, local === true);
    };
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hour12: false }).format(new Date()));
    vHead?.sub(F.day(ctx.day) + " · " + (hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好") + "，" + (me.user.name || ""));
    vHead?.actions(
      enabled("tuition", "create") ? button("登记缴费", () => Pay().payForm({}, () => reload())) : null,
      enabled("lessons", "create") ? button("＋ 排课", () => lessonForm(c), "primary") : null,
    );
    c.replaceChildren();
    c.dataset.page = "home";
    // 顶部：最新一条未读的平台通知（消息到了再插进来；已到就直接显示）。
    const noticeSlot = n("div", null, { class: "v-td-notice-slot" });
    c.append(noticeSlot);
    const showMsgs = (list) => {
      ctx.msgs = list;
      showNotice(list);
      const panel = messagesPanel(ctx, reload);
      if (panel) side.append(panel);
    };
    const showNotice = (list) => {
      const top = (list?.items || []).find((m) => !m.is_read);
      if (top) {
        const bar = n("div", null, { class: "v-td-notice", role: "status" });
        bar.append(chip("平台通知", "warn"), n("span", null, { class: "v-td-notice-text" }));
        bar.lastChild.append(n("strong", top.title), top.content ? " · " + top.content.slice(0, 80) : "");
        bar.append(
          button("知道了", async () => {
            await api("system-messages/" + top.id + "/read", "POST", {});
            await reload();
          }),
        );
        noticeSlot.append(bar);
      }
    };
    const items = buildItems(c, ctx, reload);
    const grid = n("div", null, { class: "v-td-grid" });
    const side = n("div", null, { class: "v-td-side" });
    const metrics = n("div", null, { class: "v-td-metrics" });
    const lessons = ctx.data.lessons || [];
    if (ctx.data.lessons)
      metrics.append(
        (() => {
          const m = n("button", null, { type: "button", class: "v-td-metric" });
          m.append(n("span", "今日课程", { class: "v-muted" }), n("strong", String(lessons.length)), n("small", "已销 " + lessons.filter((x) => x.status === "completed").length));
          m.addEventListener("click", () => go("schedule-week"));
          return m;
        })(),
      );
    if (ctx.data.tuition_amount !== undefined)
      metrics.append(
        (() => {
          const m = n("button", null, { type: "button", class: "v-td-metric" });
          m.append(
            n("span", "本月已收", { class: "v-muted" }),
            n("strong", F.money(ctx.data.tuition_amount)),
            n("small", ctx.due ? "待收 " + F.money(ctx.due.amount) : ""),
          );
          m.addEventListener("click", () => go("finance-income"));
          return m;
        })(),
      );
    if (metrics.children.length) side.append(metrics);
    if (ctx.data.lessons) side.append(lessonsPanel(c, ctx));
    if (enabled("promo") && globalThis.ChannelV2Promo?.recommend) side.append(globalThis.ChannelV2Promo.recommend());
    grid.append(actionsPanel(c, items, reload), side);
    c.append(grid);
    if (ctx.msgs && typeof ctx.msgs.then === "function") void ctx.msgs.then(showMsgs);
    else showMsgs(ctx.msgs);
  }

  home = async (c) => {
    const finance = me.user.roles.includes("finance") && !me.user.roles.some((r) => ["supervisor", "academic"].includes(r));
    if (finance) return oldHome(c);
    todayV.ctx = null;
    return todayV(c);
  };
  globalThis.ChannelV2Today = { todayV };
})();
