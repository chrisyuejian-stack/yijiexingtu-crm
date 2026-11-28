// 第十阶段重构（v2）第 4 组：待办（续费提醒、请假待补课）与招生线索看板。
// 只读既有接口；写入沿用原表单与原写入路径（续费提醒登记 B2、线索 PATCH/转正、补课安排）。
(() => {
  "use strict";
  const n = el,
    F = UI.fmt,
    V = () => globalThis.ChannelV2,
    P = () => globalThis.ChannelV2People,
    R = () => globalThis.ChannelRebuild;
  const phone = () => matchMedia("(max-width: 760px)").matches;
  const chip = (text, tone) => V().chip(text, tone);
  const link = (text, fn) => V().link(text, fn);
  const bjDate = (ms) =>
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date(ms));
  const dateOf = (v) => (v === null || v === undefined || v === "" ? "" : typeof v === "number" ? bjDate(v) : String(v).slice(0, 10));

  // ---------- 续费提醒 ----------
  // 一行 = 一个“学员 + 课程”分组（B3）。同一组若同时落在多个分组里，只显示一次，按 用完 > 快用完 > 即将到期 取状态。
  // B1：欠课时一组排最前（服务器 zero 组也含欠课，先读 debt 组让它保持“欠课时”）。
  const GROUPS = [
    ["debt", "欠课时", "bad"],
    ["zero", "已用完", "bad"],
    ["low", "快用完", "warn"],
    ["expiring", "即将到期", "info"],
    ["expired", "已过期仍有余额", "muted"],
  ];
  const rState = { filter: "all", selected: new Set(), focus: null, batch: [], at: 0, host: null };
  let remindHook = null;
  // 复制文字 / 保存图片后，原函数会登记一次提醒（B2）；登记完把列表重新读一遍，让“上次提醒”是服务器上的真实时间。
  if (typeof renewalRemind === "function" && !renewalRemind.v2) {
    const original = renewalRemind;
    renewalRemind = async (row, channel) => {
      await original(row, channel);
      await remindHook?.(row);
    };
    renewalRemind.v2 = true;
  }

  async function loadRenewals() {
    // 四组和提醒设置同时请求（原来设置要等四组取完再取）。
    const [settingsData, ...pages] = await Promise.all([
      api("c2/renewals?group=zero&offset=0"),
      ...GROUPS.map(([key]) => R().take("c2/renewals?group=" + key)),
    ]);
    const settings = settingsData.settings;
    const byId = new Map();
    GROUPS.forEach(([key], i) => {
      for (const row of pages[i]) if (!byId.has(row.id)) byId.set(row.id, { ...row, state: key });
    });
    const order = { debt: -1, zero: 0, low: 1, expiring: 2, expired: 3 };
    const rows = [...byId.values()].sort(
      (a, b) =>
        order[a.state] - order[b.state] ||
        a.balance - b.balance ||
        String(a.valid_to || "9").localeCompare(String(b.valid_to || "9")) ||
        a.student_name.localeCompare(b.student_name, "zh-CN"),
    );
    return { rows, settings };
  }

  function ruleDialog(c, settings) {
    const view = UI.formDialog([
      { name: "low_balance_threshold", label: "低余额课时", type: "number", value: settings.low_balance_threshold },
      { name: "expiry_warning_days", label: "提前提醒天数", type: "number", value: settings.expiry_warning_days },
    ], { title: "修改预警规则" });
    submit(view.form, "保存规则", async (d) => {
      await api("renewal-settings", "PUT", {
        low_balance_threshold: Number(d.low_balance_threshold),
        expiry_warning_days: Number(d.expiry_warning_days),
      });
      await view.close();
      await renewals(c);
    });
  }

  // 已用完的组没有“预计用完”可言；其余按服务器估算日显示。
  const endText = (r) => (r.state === "debt" ? "已欠 " + F.units(r.debt_units) : r.state === "zero" ? "已用完" : r.estimated_end ? P().dayLabel(r.estimated_end) : "—");
  function remindedText(row) {
    const day = dateOf(row.last_reminded_at);
    if (!day) return "从未";
    return P().dayLabel(day) + (row.reminded_count > 1 ? " · 共 " + row.reminded_count + " 次" : "");
  }

  async function preview(box, row, brand, { index = 0, total = 1, onMove } = {}) {
    box.replaceChildren();
    const head = n("div", null, { class: "v-rn-head" });
    head.append(n("h3", "续费提醒预览 · " + row.student_name));
    if (total > 1) {
      const nav = n("div", null, { class: "v-rn-nav" });
      const prev = button("‹", () => onMove(-1)),
        next = button("›", () => onMove(1));
      prev.setAttribute("aria-label", "上一位");
      next.setAttribute("aria-label", "下一位");
      prev.disabled = index === 0;
      next.disabled = index === total - 1;
      nav.append(prev, n("span", index + 1 + " / " + total, { class: "v-muted" }), next);
      head.append(nav);
    }
    const body = n("div", null, { class: "v-rn-body" });
    box.append(head, body);
    await renewalNotice(body, brand, row);
    box.append(
      n("p", "复制文字或保存图片后，会自动记一次“上次提醒”。图片使用机构 Logo、主题色和顾问二维码，不出现平台信息。", {
        class: "v-rn-foot",
      }),
    );
  }

  async function renewals(c) {
    rState.host = c;
    const [{ rows, settings }, brand] = await Promise.all([loadRenewals(), api("renewal-brand")]);
    const live = new Set(rows.map((r) => r.id));
    for (const id of [...rState.selected]) if (!live.has(id)) rState.selected.delete(id);
    const canMake = enabled("exports", "export");
    c.replaceChildren();
    const page = n("div", null, { class: "v-renew" });
    const main = n("div", null, { class: "v-renew-main" }),
      side = n("aside", null, { class: "v-renew-side panel", "aria-label": "续费提醒预览" });

    // 规则 + 批量
    const top = n("div", null, { class: "v-renew-top" });
    const rule = n("p", null, { class: "v-renew-rule" });
    rule.append(
      "预警规则：剩余 ≤ " + settings.low_balance_threshold + " 课时，或 " + settings.expiry_warning_days + " 天内到期",
    );
    if (me.user.roles.includes("supervisor")) rule.append(link("修改规则", () => ruleDialog(c, settings)));
    top.append(rule, n("span", null, { class: "v-spacer" }));
    const picked = n("span", "", { class: "v-muted v-renew-picked" });
    const batch = button(
      "批量生成续费提醒",
      async () => {
        const list = rows.filter((r) => rState.selected.has(r.id));
        if (!list.length) throw Error("请先勾选要提醒的学员");
        rState.batch = list.map((r) => r.id);
        rState.at = 0;
        await show(list[0]);
      },
      "primary",
    );
    if (canMake) top.append(picked, batch);

    // 筛选
    const counts = { all: rows.filter((r) => r.state !== "expired").length };
    for (const [key] of GROUPS) counts[key] = rows.filter((r) => r.state === key).length;
    const chips = n("div", null, { class: "v-filter-chips", role: "group", "aria-label": "续费分组" });
    for (const [key, label] of [["all", "全部"], ...GROUPS]) {
      if ((key === "expired" || key === "debt") && !counts[key]) continue;
      const on = rState.filter === key;
      const b = n("button", label, {
        type: "button",
        class: "v-filter-chip" + (on ? " is-on" : "") + (key === "zero" || key === "debt" ? " is-bad" : key === "low" ? " is-warn" : ""),
        "aria-pressed": String(on),
      });
      b.append(n("span", String(counts[key]), { class: "v-chip-count" }));
      b.addEventListener("click", () => {
        rState.filter = key;
        void renewals(c);
      });
      chips.append(b);
    }
    const shown = rows.filter((r) => (rState.filter === "all" ? r.state !== "expired" : r.state === rState.filter));
    const syncPicked = () => {
      // 没勾选时按钮照常可点，文字直接告诉怎么用（原来是一块灰色，看着像坏了）。
      const k = rState.selected.size;
      picked.textContent = k ? "已选 " + k + " 位" : "勾选左侧学员后可批量生成";
      const face = batch.querySelector(".ui-button-face > span:last-child");
      if (face) face.textContent = k ? "批量生成 " + k + " 份提醒" : "批量生成续费提醒";
      batch.classList.toggle("ui-button--primary", k > 0);
    };
    syncPicked();

    const stateChip = (r) => {
      const g = GROUPS.find((x) => x[0] === r.state);
      return chip(g[1], g[2]);
    };
    const show = async (row) => {
      rState.focus = row.id;
      for (const tr of main.querySelectorAll("[data-row]")) tr.classList.toggle("is-focus", tr.dataset.row === row.id);
      const ids = rState.batch.includes(row.id) ? rState.batch : [row.id];
      if (!ids.includes(row.id)) rState.batch = [];
      const index = ids.indexOf(row.id);
      const opts = {
        index,
        total: ids.length,
        onMove: async (d) => {
          const next = rows.find((r) => r.id === ids[index + d]);
          if (next) await show(next);
        },
      };
      if (phone()) {
        const view = UI.drawer({ title: "续费提醒 · " + row.student_name, subtitle: row.course_name });
        const box = n("div", null, { class: "v-rn" });
        view.body.append(box);
        await preview(box, row, brand, opts);
      } else await preview(side, row, brand, opts);
    };
    const actions = (r) => {
      const wrap = n("div", null, { class: "v-renew-acts" });
      if (canMake) wrap.append(link("生成提醒", () => {
        rState.batch = [];
        return show(r);
      }));
      const more = [];
      if (enabled("followup", "create"))
        more.push({ label: "记录联系", onSelect: () => followupForm(P().sink(() => renewals(c)), "followup_notes", r.student_id) });
      if (enabled("packages", "create"))
        more.push({
          label: "加课时包",
          onSelect: () => creditForm(P().sink(() => renewals(c)), "packages", { student_id: r.student_id, course_type_id: r.course_type_id }),
        });
      more.push({ label: "查看学员", onSelect: () => R().goStudent(r.student_id, "packages") });
      wrap.append(UI.actionMenu({ items: more }).element);
      return wrap;
    };

    let list;
    if (!shown.length) {
      list = UI.empty({ text: rState.filter === "all" ? "现在没有课时快用完或快到期的学员。" : "这一组现在没有学员。" });
    } else if (phone()) {
      list = n("div", null, { class: "v-renew-cards" });
      for (const r of shown) {
        const card = n("article", null, { class: "v-renew-card", "data-row": r.id });
        const line = n("div", null, { class: "v-renew-card-top" });
        if (canMake) line.append(pick(r));
        line.append(n("strong", r.student_name), stateChip(r));
        card.append(
          line,
          n("p", r.course_name + " · 剩 " + F.units(r.balance) + (r.valid_to ? " · 至 " + r.valid_to : "")),
          n("p", (r.state === "zero" ? "" : "预计用完 " + endText(r) + " · ") + "上次提醒 " + remindedText(r), { class: "v-muted" }),
          actions(r),
        );
        list.append(card);
      }
    } else {
      list = n("div", null, { class: "v-renew-table panel" });
      const table = n("table", null, { class: "v-table" }),
        thead = n("thead"),
        tbody = n("tbody"),
        hr = n("tr");
      const all = n("input", null, { type: "checkbox", "aria-label": "全选" });
      all.checked = shown.length > 0 && shown.every((r) => rState.selected.has(r.id));
      all.addEventListener("change", () => {
        for (const r of shown) all.checked ? rState.selected.add(r.id) : rState.selected.delete(r.id);
        for (const box of tbody.querySelectorAll("input[type=checkbox]")) box.checked = all.checked;
        syncPicked();
      });
      const th = (text, cls = "") => n("th", text, cls ? { class: cls } : {});
      const first = n("th", null, { class: "is-check" });
      if (canMake) first.append(all);
      hr.append(first, th("学员"), th("课程"), th("剩余", "is-num"), th("预计用完"), th("上次提醒"), th("状态"), th("操作", "is-act"));
      thead.append(hr);
      for (const r of shown) {
        const tr = n("tr", null, { "data-row": r.id, class: rState.focus === r.id ? "is-focus" : "" });
        const name = n("button", r.student_name, { type: "button", class: "v-cell-link" });
        name.addEventListener("click", () => R().goStudent(r.student_id, "packages"));
        const course = n("td");
        course.append(n("span", r.course_name), n("small", r.valid_to ? "至 " + r.valid_to : "不限有效期"));
        const bal = n("td", F.units(r.balance), { class: "is-num v-bal-" + r.state });
        const c0 = n("td", null, { class: "is-check" });
        if (canMake) c0.append(pick(r));
        const nameCell = n("td");
        nameCell.append(name);
        const stCell = n("td");
        stCell.append(stateChip(r));
        const act = n("td", null, { class: "is-act" });
        act.append(actions(r));
        tr.append(
          c0,
          nameCell,
          course,
          bal,
          n("td", endText(r), { class: r.state === "zero" ? "v-muted" : "" }),
          n("td", remindedText(r), { class: r.last_reminded_at ? "" : "v-muted" }),
          stCell,
          act,
        );
        tbody.append(tr);
      }
      table.append(thead, tbody);
      list.append(table);
    }
    function pick(r) {
      const box = n("input", null, { type: "checkbox", "aria-label": "选择 " + r.student_name });
      box.checked = rState.selected.has(r.id);
      box.addEventListener("change", () => {
        box.checked ? rState.selected.add(r.id) : rState.selected.delete(r.id);
        syncPicked();
      });
      return box;
    }

    main.append(top, chips, list);
    page.append(main);
    if (!phone()) {
      page.append(side);
      const focus = shown.find((r) => r.id === rState.focus) || (canMake ? shown[0] : null);
      if (focus) {
        rState.focus = focus.id;
        list.querySelector('[data-row="' + CSS.escape(focus.id) + '"]')?.classList.add("is-focus");
        await preview(side, focus, brand, {
          index: Math.max(0, rState.batch.indexOf(focus.id)),
          total: rState.batch.includes(focus.id) ? rState.batch.length : 1,
          onMove: async (d) => {
            const ids = rState.batch,
              next = rows.find((r) => r.id === ids[ids.indexOf(focus.id) + d]);
            if (next) {
              rState.focus = next.id;
              await renewals(c);
            }
          },
        });
      } else {
        side.append(n("h3", "续费提醒预览"), n("p", canMake ? "选一位学员，这里会生成提醒图片和文字。" : "当前账号没有导出权限，无法生成提醒。", { class: "v-muted" }));
      }
    }
    c.append(page);
    remindHook = async () => {
      if (rState.host === c && c.isConnected) {
        const { rows: fresh } = await loadRenewals();
        for (const tr of c.querySelectorAll("[data-row]")) {
          const row = fresh.find((r) => r.id === tr.dataset.row);
          const cell = tr.tagName === "TR" ? tr.children[5] : null;
          if (row && cell) {
            cell.textContent = remindedText(row);
            cell.classList.toggle("v-muted", !row.last_reminded_at);
          }
        }
      }
    };
  }
  renewalsPage = (c) => renewals(c);

  // ---------- 请假待补课：最近 30 天在上，更早的收起（不计入待办角标） ----------
  const originalMakeups = R().makeups;
  async function makeups(c) {
    const cut = dateShift(todayBJ(), -30);
    // 待补课列表与原页面（已安排部分）同时加载。
    const legacyBox = n("div");
    const [pending] = await Promise.all([R().take("c2/makeups"), originalMakeups(legacyBox)]);
    const arranged = legacyBox.lastElementChild;
    arranged?.remove();
    // 原“已安排”卡片里的“解除关联”会重画 legacyBox；画完后回到本页。
    new MutationObserver((_, o) => {
      o.disconnect();
      void makeups(c);
    }).observe(legacyBox, { childList: true });
    const recent = pending.filter((r) => dateOf(r.start_at) >= cut),
      older = pending.filter((r) => dateOf(r.start_at) < cut);
    const rowsOf = (items) => {
      const box = n("div", null, { class: "v-mk-rows" });
      for (const r of items) {
        const line = n("div", null, { class: "v-mk-row" });
        const who = n("div", null, { class: "v-mk-who" });
        who.append(n("strong", r.student_name), n("span", r.course_name + " · " + (r.teacher_name || "未指定教师"), { class: "v-muted" }));
        line.append(n("span", P().dayLabel(dateOf(r.start_at)) + " " + F.time(r.start_at), { class: "v-mk-when" }), who);
        if (enabled("attendance", "create"))
          line.append(
            button("安排补课", async () => {
              const l = (await api("data/lessons/" + r.lesson_id)).record;
              await makeupForm(
                P().sink(() => makeups(c)),
                l,
                l.participants.find((x) => x.id === r.id),
              );
            }),
          );
        box.append(line);
      }
      return box;
    };
    c.replaceChildren();
    const head = n("p", null, { class: "v-mk-note" });
    head.append(
      "最近 30 天 ",
      n("strong", String(recent.length)),
      " 条，计入待办数字；更早的 ",
      n("strong", String(older.length)),
      " 条收在下面，不计入。",
    );
    c.append(head);
    const recentCard = V().panel("最近 30 天 · " + recent.length);
    recentCard.append(recent.length ? rowsOf(recent) : UI.empty({ text: "最近 30 天没有待补课的请假。" }));
    c.append(recentCard);
    if (older.length) {
      const olderCard = V().panel("更早 · " + older.length);
      olderCard.append(UI.disclosure("展开 " + older.length + " 条更早的请假", [rowsOf(older)]));
      c.append(olderCard);
    }
    if (arranged) c.append(arranged);
  }
  R().makeups = makeups;

  // ---------- 招生线索看板 ----------
  // 阶段固定：新咨询 / 跟进中 / 已试听 / 已转正 / 已流失（标签取服务器 lead_stages）。
  const STAGES = ["new", "contacted", "trial", "enrolled", "lost"];
  const lState = { view: "board" };
  const stageLabel = (s) => me.labels.lead_stages?.[s] || s;
  async function leads(c) {
    const [rows, summary] = await Promise.all([R().take("tools/leads"), api("c3/leads-summary")]);
    const today = todayBJ(),
      monthStart = Date.parse(today.slice(0, 7) + "-01T00:00:00+08:00");
    const open = rows.filter((r) => !["lost", "enrolled"].includes(r.stage));
    const dueToday = open.filter((r) => r.next_followup === today).length,
      late = open.filter((r) => r.next_followup && r.next_followup < today).length;
    const sources = new Map();
    for (const r of rows.filter((x) => x.created_at >= monthStart)) sources.set(r.source || "未填来源", (sources.get(r.source || "未填来源") || 0) + 1);
    const srcText = [...sources].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k + " " + v).join(" · ");
    const trials = rows.filter((r) => r.stage === "trial"),
      booked = trials.filter((r) => r.trial_at).length;

    vHead?.actions(
      button(lState.view === "board" ? "列表视图" : "看板视图", () => {
        lState.view = lState.view === "board" ? "table" : "board";
        void leads(c);
      }),
      enabled("leads", "create") ? button("＋ 登记线索", () => leadForm(c), "primary") : null,
    );
    c.replaceChildren();
    const K = P().kpi;
    c.append(
      P().kpis([
        K("本月新线索", String(summary.added), srcText || "本月还没有新线索"),
        K("已试听", String(summary.trial), "已排时间 " + booked + " · 待排 " + (trials.length - booked)),
        K("本月转正", String(summary.converted), "转化率 " + summary.conversion_rate + "%", summary.converted ? "money" : ""),
        K("今天要跟进", String(dueToday), late ? "已逾期 " + late : "没有逾期", late || dueToday ? "warn" : ""),
      ]),
    );
    if (lState.view === "table") {
      const host = n("div", null, { class: "panel v-lead-table" });
      R().table(
        host,
        [
          { key: "name", label: "姓名" },
          { key: "stage", label: "阶段", render: (r) => stageLabel(r.stage) },
          { key: "grade", label: "年级", render: (r) => r.grade || "—" },
          { key: "source", label: "来源", render: (r) => r.source || "未填来源" },
          { key: "direction", label: "意向方向", render: (r) => r.direction || "待补充" },
          { key: "next_followup", label: "下次回访", render: (r) => (r.next_followup ? P().dayLabel(r.next_followup) : "—") },
        ],
        rows,
        { rowAction: (r) => globalThis.ChannelC3.leadDetail(c, r), empty: "登记的咨询会显示在这里。" },
      );
      c.append(host);
      return;
    }
    const moveLead = async (row, stage) => {
      if (!row || !UI.leadMoveAllowed(row.stage, stage) || !enabled("leads", "update")) return;
      try {
        await api("tools/leads/" + row.id, "PATCH", { stage, version: row.version });
        await leads(c);
      } catch (err) {
        notice(err.message);
      }
    };
    const ADJ = ["new", "contacted", "trial", "lost"];
    const board = n("div", null, { class: "v-lead-board" });
    let dragging = null;
    for (const stage of STAGES) {
      const items = rows.filter((r) => r.stage === stage);
      const col = n("section", null, { class: "v-lead-col v-stage-" + stage, "data-stage": stage });
      const h = n("header");
      h.append(n("h3", stageLabel(stage)), n("span", String(items.length), { class: "v-lead-count" }));
      col.append(h);
      const drop = (on) => col.classList.toggle("is-over", on);
      col.addEventListener("dragover", (e) => {
        if (dragging && UI.leadMoveAllowed(dragging.stage, stage)) {
          e.preventDefault();
          drop(true);
        }
      });
      col.addEventListener("dragleave", (e) => {
        if (!col.contains(e.relatedTarget)) drop(false);
      });
      col.addEventListener("drop", async (e) => {
        e.preventDefault();
        drop(false);
        await moveLead(dragging, stage);
      });
      const list = n("div", null, { class: "v-lead-list" });
      for (const r of items) list.append(leadCard(c, r, stage, (x) => (dragging = x), moveLead, ADJ));
      if (!items.length) list.append(n("p", stage === "enrolled" ? "试听后转为学员的会出现在这里。" : "暂无", { class: "v-lead-empty" }));
      col.append(list);
      board.append(col);
    }
    c.append(board, n("p", "拖动卡片或点击阶段切换按钮可在相邻阶段间移动；“已转正”需在已试听卡片上点“转为正式学员”。", { class: "v-muted v-lead-hint" }));
  }
  function leadCard(c, r, stage, setDrag, moveLead, adj = ["new", "contacted", "trial", "lost"]) {
    const today = todayBJ();
    const card = n("article", null, { class: "v-lead-card" + (stage === "lost" ? " is-lost" : ""), tabindex: "0", role: "button" });
    const top = n("div", null, { class: "v-lead-top" });
    top.append(n("strong", r.name), n("span", r.grade || "", { class: "v-muted" }));
    const tags = n("div", null, { class: "v-lead-tags" });
    if (r.direction) tags.append(chip(r.direction, "info"));
    tags.append(chip(r.source || "未填来源", "muted"));
    card.append(top, tags);
    let line = null;
    if (stage === "enrolled") line = n("p", "已转为学员 · " + bjDate(r.updated_at).slice(5), { class: "v-muted" });
    else if (stage === "lost") line = n("p", "原因：" + (String(r.note || "").split("\n")[0] || "未填写"), { class: "v-muted" });
    else if (r.next_followup && r.next_followup < today) line = n("p", "回访逾期 · " + P().dayLabel(r.next_followup), { class: "v-lead-due is-late" });
    else if (r.next_followup === today) line = n("p", "今天回访", { class: "v-lead-due is-today" });
    else if (stage === "trial") line = n("p", r.trial_at ? P().dayLabel(dateOf(r.trial_at)) + " " + F.time(r.trial_at) + " 试听" : "试听时间待定", { class: "v-muted" });
    else if (r.next_followup) line = n("p", P().dayLabel(r.next_followup) + " 回访", { class: "v-muted" });
    if (line) card.append(line);
    if (stage === "trial" && enabled("students", "create") && enabled("leads", "create")) {
      const go = link("转为正式学员 →", async () => {
        if (!(await UI.confirm({ title: "把 " + r.name + " 转为正式学员？", consequence: "新建独立学员档案，保留线索历史。", danger: false }))) return;
        await api("tools/leads/" + r.id + "/convert", "POST", { version: r.version });
        await leads(c);
      });
      go.addEventListener("click", (e) => e.stopPropagation());
      card.append(go);
    }
    if (stage === "enrolled" && r.student_id) {
      const go = link("查看学员档案 →", () => R().goStudent(r.student_id));
      go.addEventListener("click", (e) => e.stopPropagation());
      card.append(go);
    }
    const idx = adj.indexOf(stage);
    const prevStage = idx > 0 && UI.leadMoveAllowed(stage, adj[idx - 1]) ? adj[idx - 1] : null;
    const nextStage = idx >= 0 && idx < adj.length - 1 && UI.leadMoveAllowed(stage, adj[idx + 1]) ? adj[idx + 1] : null;
    if (enabled("leads", "update") && (prevStage || nextStage)) {
      const moves = n("div", null, { class: "v-lead-move" });
      for (const [target, text] of [
        [prevStage, prevStage ? "← " + stageLabel(prevStage) : ""],
        [nextStage, nextStage ? stageLabel(nextStage) + " →" : ""],
      ]) {
        if (!target) continue;
        const b = button(text, () => moveLead(r, target));
        b.setAttribute("aria-label", "移至" + stageLabel(target));
        b.addEventListener("click", (e) => e.stopPropagation());
        b.addEventListener("keydown", (e) => e.stopPropagation());
        moves.append(b);
      }
      card.append(moves);
    }
    const openIt = () => globalThis.ChannelC3.leadDetail(c, r);
    card.addEventListener("click", openIt);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target === card) openIt();
    });
    if (enabled("leads", "update") && !["lost", "enrolled"].includes(stage)) {
      card.draggable = true;
      card.addEventListener("dragstart", (e) => {
        setDrag(r);
        card.classList.add("is-drag");
        e.dataTransfer.setData("text/plain", r.id);
      });
      card.addEventListener("dragend", () => {
        setDrag(null);
        card.classList.remove("is-drag");
      });
    }
    return card;
  }
  leadsPage = (c) => leads(c);


  // ---------- 待办 · 点名销课（原“未销课”与“教师提交”合成一页） ----------
  const cState = { tab: "unchecked" };
  // 顶栏下的小分页：一组按钮，选中项高亮。
  function innerTabs(label, items, current, onPick) {
    const box = n("div", null, { class: "v-inner-tabs", role: "group", "aria-label": label });
    for (const [value, text, count] of items) {
      const b = button(text, () => onPick(value));
      b.setAttribute("aria-current", value === current ? "page" : "false");
      if (count !== undefined && count !== null) b.querySelector(".ui-button-face").append(n("span", String(count), { class: "v-inner-count" }));
      box.append(b);
    }
    return box;
  }
  async function checkin(c, tab) {
    if (tab) cState.tab = tab;
    const canTeacher = enabled("attendance", "confirm");
    if (!canTeacher) cState.tab = "unchecked";
    const counts = await api("todo/summary").catch(() => null);
    const again = (t) => checkin(c, t);
    if (canTeacher)
      vHead?.bar(
        innerTabs(
          "点名销课",
          [
            ["unchecked", "过了上课时间未销课", counts?.unchecked_lessons],
            ["teacher", "老师已提交、等确认", counts?.teacher_submissions],
          ],
          cState.tab,
          again,
        ),
      );
    if (cState.tab === "teacher") await submissionQueue(c);
    else await R().unchecked(c);
  }

  // ---------- 待办 · 跟进任务 ----------
  // 分组列表（逾期 / 今天 / 之后 / 已完成）+ 右侧详情；系统提醒（学习阶段到期）合成一行。
  // 读写都沿用原接口：c2/followups、tools/followup_tasks、tools/followup_notes。
  const FU_GROUPS = [
    ["overdue", "逾期", "bad"],
    ["today", "今天", "warn"],
    ["future", "之后", "muted"],
    ["done", "已完成", "muted"],
  ];
  const fState = { mine: false, owner: "", source: "all", pick: null, openDone: false, openStages: false, people: null };
  const dayDiff = (a, b) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
  const shortDay = (d) => (d ? P().dayLabel(d) : "未定");
  async function followups(c) {
    const owner = fState.mine ? me.user.id : fState.owner;
    const [people, ...lists] = await Promise.all([
      fState.people ? Promise.resolve(fState.people) : api("followup-assignees"),
      ...FU_GROUPS.map(([g]) => api("c2/followups?group=" + g + "&owner=" + encodeURIComponent(owner))),
    ]);
    fState.people = people;
    const again = () => followups(c);
    const groups = FU_GROUPS.map(([key, label, tone], i) => ({ key, label, tone, items: lists[i].items || [], stages: lists[i].stages || [] }));
    const all = groups.flatMap((g) => g.items.map((r) => ({ ...r, group: g.key })));
    const mineCount = all.filter((r) => r.group !== "done" && r.assignee_id === me.user.id).length;
    const openCount = all.filter((r) => r.group !== "done").length;

    vHead?.bar(
      innerTabs("范围", [["all", "全部", fState.mine ? null : openCount], ["mine", "我负责的", fState.mine ? openCount : mineCount]], fState.mine ? "mine" : "all", (v) => {
        fState.mine = v === "mine";
        if (fState.mine) fState.owner = "";
        return again();
      }),
      fState.mine
        ? null
        : UI.selectControl({
            label: "负责人",
            value: fState.owner,
            options: [{ value: "", label: "所有负责人" }, ...people.items.map((x) => ({ value: x.id, label: x.name }))],
            onChange: (v) => {
              fState.owner = v;
              return again();
            },
          }).element,
      innerTabs("来源", [["all", "全部来源"], ["manual", "人工任务"], ["system", "系统提醒"]], fState.source, (v) => {
        fState.source = v;
        return again();
      }),
    );
    vHead?.actions(
      enabled("students") ? button("学习阶段", () => creditPage(c, "stages")) : null,
      enabled("followup", "create") ? button("＋ 新增跟进", () => followupForm(c, "followup_tasks"), "primary") : null,
    );

    c.replaceChildren();
    const wrap = n("div", null, { class: "v-fu" });
    const list = n("section", null, { class: "v-fu-list", "aria-label": "跟进任务列表" });
    const side = n("aside", null, { class: "v-fu-side", "aria-label": "任务详情" });
    const today = todayBJ();
    const rowsEl = new Map();
    const select = async (row) => {
      fState.pick = row.id;
      for (const [id, el2] of rowsEl) el2.classList.toggle("is-on", id === row.id);
      if (phone()) {
        const view = UI.drawer({ title: row.title });
        await detail(view.body, row, again, () => view.close());
      } else await detail(side, row, again);
    };
    const taskRow = (row) => {
      const line = n("div", null, { class: "v-fu-row", tabindex: "0", role: "button" });
      rowsEl.set(row.id, line);
      if (enabled("followup", "update")) {
        const ck = n("input", null, { type: "checkbox", class: "v-fu-ck", "aria-label": (row.done ? "重新打开：" : "标记完成：") + row.title });
        ck.checked = !!row.done;
        ck.addEventListener("click", (e) => e.stopPropagation());
        ck.addEventListener("change", async () => {
          ck.disabled = true;
          try {
            await saveTask(row, { done: ck.checked });
            await again();
          } catch (e) {
            ck.checked = !ck.checked;
            notice(e.message);
          } finally {
            ck.disabled = false;
          }
        });
        line.append(ck);
      } else line.append(n("span"));
      const main = n("div", null, { class: "v-fu-main" });
      const title = n("div", null, { class: "v-fu-title" });
      title.append(row.title);
      if (row.student_name) title.append(n("span", " · " + row.student_name, { class: "v-fu-who" }));
      else title.append(n("span", " · 未关联学员", { class: "v-muted" }));
      const late = row.group === "overdue" ? dayDiff(today, row.due_date) : 0;
      const when =
        row.group === "overdue"
          ? "逾期 " + late + " 天 · " + shortDay(row.due_date)
          : row.group === "today"
            ? "今天到期"
            : row.group === "done"
              ? "已完成 · 原定 " + shortDay(row.due_date)
              : shortDay(row.due_date);
      main.append(title, n("div", when + " · 负责人 " + (row.assignee_name || "待指派"), { class: "v-fu-meta" + (row.group === "overdue" ? " is-late" : "") }));
      line.append(main, chip("人工", "muted"));
      if (row.done) line.classList.add("is-done");
      line.addEventListener("click", () => select(row));
      line.addEventListener("keydown", (e) => e.key === "Enter" && select(row));
      return line;
    };
    const stageRow = (stages) => {
      const box = n("div", null, { class: "v-fu-stage" });
      const line = n("div", null, { class: "v-fu-row is-system" });
      line.append(UI.icon("calendar"));
      const main = n("div", null, { class: "v-fu-main" });
      main.append(
        n("div", "学习阶段到期 · " + stages.length + " 位学员", { class: "v-fu-title" }),
        n("div", stages.map((s) => s.student_name).slice(0, 6).join("、") + (stages.length > 6 ? " 等" : "") + " · 需要设定下一阶段", { class: "v-fu-meta" }),
      );
      const tail = n("span", null, { class: "v-fu-tail" });
      tail.append(chip("系统提醒", "info"));
      const toggle = button(fState.openStages ? "收起" : "展开", () => {
        fState.openStages = !fState.openStages;
        inner.hidden = !fState.openStages;
        toggle.querySelector(".ui-button-face > span:last-child").textContent = fState.openStages ? "收起" : "展开";
      });
      toggle.classList.add("v-fu-mini");
      tail.append(toggle);
      line.append(main, tail);
      const inner = n("div", null, { class: "v-fu-stage-list" });
      inner.hidden = !fState.openStages;
      for (const s of stages) {
        const r = n("div", null, { class: "v-fu-stage-item" });
        r.append(
          link(s.student_name, () => R().goStudent(s.student_id, "stages")),
          n("span", (s.name || "学习阶段") + " · " + (s.goal || "未写目标") + " · " + shortDay(s.date_to) + " 到期", { class: "v-muted" }),
        );
        inner.append(r);
      }
      box.append(line, inner);
      return box;
    };
    let firstRow = null;
    for (const g of groups) {
      const items = fState.source === "system" ? [] : g.items;
      const stages = fState.source === "manual" ? [] : g.stages;
      const count = items.length + (stages.length ? 1 : 0);
      if (g.key !== "done" && !count) continue;
      const head = n("div", null, { class: "v-fu-gh is-" + g.tone });
      head.append(n("span", g.label), chip(String(g.key === "done" ? items.length : items.length + stages.length), g.tone));
      if (g.key === "done") {
        const box = n("details", null, { class: "v-fu-done" });
        box.open = fState.openDone;
        box.addEventListener("toggle", () => (fState.openDone = box.open));
        const sum = n("summary");
        sum.append(head);
        box.append(sum);
        for (const r of items) box.append(taskRow({ ...r, group: "done" }));
        if (!items.length) box.append(n("p", "最近没有完成的任务。", { class: "v-muted v-pad" }));
        list.append(box);
        continue;
      }
      list.append(head);
      for (const r of items) {
        const el2 = taskRow({ ...r, group: g.key });
        firstRow ??= { ...r, group: g.key };
        list.append(el2);
      }
      if (stages.length) list.append(stageRow(stages));
    }
    if (!list.querySelector(".v-fu-row"))
      list.prepend(UI.empty({ text: fState.source === "system" ? "没有系统提醒。" : "没有需要跟进的任务。" }));
    wrap.append(list, side);
    c.append(wrap);
    const picked = all.find((r) => r.id === fState.pick) || firstRow;
    if (picked && !phone()) await select(picked);
    else if (!phone()) side.append(n("p", "点左侧任务查看详情。", { class: "v-muted v-pad" }));
  }
  async function saveTask(row, changes) {
    return api("tools/followup_tasks/" + row.id, "PATCH", {
      student_id: row.student_id,
      title: row.title,
      due_date: row.due_date,
      assignee_id: row.assignee_id,
      done: !!row.done,
      ...changes,
      version: row.version,
    });
  }
  async function detail(box, row, again, closeView) {
    box.classList.add("is-loading");
    const notes = row.student_id ? await api("tools/followup_notes?offset=0&student_id=" + encodeURIComponent(row.student_id)).catch(() => ({ items: [] })) : { items: [] };
    box.classList.remove("is-loading");
    box.replaceChildren();
    const after = async () => {
      await closeView?.();
      await again();
    };
    const head = n("div", null, { class: "v-fu-dhead" });
    head.append(
      n("span", (row.student_name || row.title).slice(0, 1), { class: "v-fu-avatar", "aria-hidden": "true" }),
      (() => {
        const t = n("div");
        t.append(n("h3", row.title), n("div", row.student_name || "未关联学员", { class: "v-muted" }));
        return t;
      })(),
      row.done ? chip("已完成", "ok") : row.group === "overdue" ? chip("已逾期", "bad") : row.group === "today" ? chip("今天到期", "warn") : chip(shortDay(row.due_date), "muted"),
    );
    const dl = n("dl", null, { class: "v-fu-dl" });
    const pair = (k, v) => dl.append(n("dt", k), (() => { const d = n("dd"); d.append(v); return d; })());
    pair("负责人", row.assignee_name || "待指派");
    pair("截止", shortDay(row.due_date));
    pair("关联学员", row.student_id ? link(row.student_name + " 的档案", () => R().goStudent(row.student_id, "followup")) : "无");
    const log = n("div", null, { class: "v-fu-log" });
    log.append(n("h4", "沟通记录"));
    const ol = n("ol");
    for (const note of (notes.items || []).slice(0, 6)) {
      const li = n("li");
      li.append(n("div", String(note.at || "").slice(0, 16).replace("T", " "), { class: "v-muted" }), n("div", note.content, { class: "preserve-text" }));
      ol.append(li);
    }
    if (!ol.children.length) log.append(n("p", row.student_id ? "还没有沟通记录。" : "这条任务没有关联学员，沟通记录记在学员名下。", { class: "v-muted" }));
    else log.append(ol);
    box.append(head, dl, log);
    const canEdit = enabled("followup", "update");
    if (row.student_id && enabled("followup", "create")) {
      const area = n("textarea", null, { class: "ui-control", rows: "3", maxlength: "6000", placeholder: "沟通了什么、下一步是什么", "aria-label": "记一笔" });
      const lab = n("label", null, { class: "v-fu-note" });
      lab.append(n("span", "记一笔", { class: "v-muted" }), area);
      box.append(lab);
      box.__note = area;
    }
    const ops = n("div", null, { class: "v-fu-ops" });
    const saveNote = async () => {
      const text = box.__note?.value.trim();
      if (!text) return false;
      const now = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).replace(" ", "T");
      await api("tools/followup_notes", "POST", { student_id: row.student_id, at: now, content: text });
      return true;
    };
    if (canEdit)
      ops.append(
        button(
          row.done ? "重新打开" : "标记完成",
          async () => {
            await saveNote();
            await saveTask(row, { done: !row.done });
            notice(row.done ? "已重新打开" : "已标记完成", "success");
            await after();
          },
          "primary",
        ),
      );
    if (box.__note)
      ops.append(
        button("保存记录", async () => {
          if (!(await saveNote())) throw Error("先写下沟通内容");
          notice("已记下", "success");
          await after();
        }),
      );
    if (canEdit) {
      ops.append(
        button("改期", () => {
          const view = UI.formDialog([{ name: "due_date", label: "新的截止日期", type: "date", value: row.due_date }], { title: "改期 · " + row.title });
          submit(view.form, "保存", async (d) => {
            await saveTask(row, { due_date: d.due_date });
            await view.close();
            await after();
          });
        }),
        button("转给…", () => {
          const view = UI.overlay({ title: "转给谁负责", kind: "modal" });
          const listBox = n("div", null, { class: "v-fu-people" });
          for (const p of fState.people?.items || []) {
            const b = button(p.name, async () => {
              await saveTask(row, { assignee_id: p.id });
              await view.close();
              notice("已转给 " + p.name, "success");
              await after();
            });
            if (p.id === row.assignee_id) b.setAttribute("aria-current", "true");
            listBox.append(b);
          }
          view.body.append(listBox);
        }),
      );
      const more = [{ label: "修改内容", onSelect: () => followupForm(document.querySelector(".v-content .ui-page-body") || box, "followup_tasks", row.student_id, row) }];
      if (enabled("followup", "delete"))
        more.push({
          label: "删除任务",
          danger: true,
          onSelect: async () => {
            if (!(await UI.confirm({ title: "删除这条跟进任务？", consequence: "删除后不能恢复，沟通记录不受影响。", danger: true }))) return;
            await api("tools/followup_tasks/" + row.id, "DELETE", { version: row.version });
            fState.pick = null;
            await after();
          },
        });
      ops.append(UI.actionMenu({ items: more }).element);
    }
    box.append(ops);
  }
  // 原跟进页的写入回调会调 followupPage(c)；没有学员时换成新页面，学员档案里的跟进仍用原页面。
  const legacyFollowup = followupPage;
  followupPage = (c, studentId = null, ...rest) => (studentId ? legacyFollowup(c, studentId, ...rest) : followups(c));


  // ---------- 安排补课面板 ----------
  // 从上到下：① 自选时间（当天时间轴直观看到所选时段与占用，实时检查冲突）② 推荐时间（带理由，点一下填到上面）
  // ③ 加入已有同类课。接口：c2/makeups/:id/suggestions（推荐）、/day（当天占用）、/check（只读预查），
  // 保存沿用原补课写入 makeups。
  const TL_FROM = 8 * 60,
    TL_TO = 21 * 60,
    TL_STEP = 15;
  const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const toHm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  const tlCol = (m) => Math.max(1, Math.min((TL_TO - TL_FROM) / TL_STEP + 1, Math.round((m - TL_FROM) / TL_STEP) + 1));
  // 时间块用网格列定位（不写行内样式）：起点 tl-s-N，跨度 tl-w-N。
  const tlPlace = (el2, from, to) => {
    const a = tlCol(from),
      b = Math.max(a + 1, tlCol(to));
    el2.classList.add("tl-s-" + a, "tl-w-" + (b - a));
    return el2;
  };
  async function makeupPanel(c, data, part) {
    const pid = part.id;
    const [sug, teachers, rooms] = await Promise.all([
      api("c2/makeups/" + pid + "/suggestions").catch(() => ({ items: [], context: null })),
      R().take("data/teachers"),
      R().take("data/locations"),
    ]);
    const tName = new Map(teachers.map((t) => [t.id, t.name])),
      rName = new Map(rooms.map((r) => [r.id, r.name]));
    const orig = sug.context?.original || {
      start_at: data.start_at,
      duration: data.duration,
      teacher_id: data.teacher_id,
      location_id: data.location_id,
      course_name: data.course_name,
    };
    const tomorrow = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date(Date.now() + 86400000));
    const first = sug.items[0];
    const st = {
      date: first ? first.start_at.slice(0, 10) : tomorrow,
      time: first ? first.start_at.slice(11, 16) : String(orig.start_at).slice(11, 16),
      duration: Number((first || orig).duration) || 45,
      teacher_id: (first || orig).teacher_id || data.teacher_id,
      location_id: (first ? first.location_id : orig.location_id) ?? null,
      picked: first ? first.start_at : null,
      check: null,
    };
    const view = UI.drawer({
      title: "安排补课 · " + part.student_name,
      subtitle:
        "请假的课：" +
        P().dayLabel(String(data.start_at).slice(0, 10)) +
        " " +
        F.range(data.start_at, data.duration) +
        " · " +
        (data.course_name || "") +
        " · " +
        (tName.get(data.teacher_id) || data.teacher_name || "未定老师") +
        (data.location_id ? " · " + (rName.get(data.location_id) || data.location_name || "") : ""),
    });
    view.element.classList.add("v-mkp");
    const body = view.body;
    const secCustom = n("section", null, { class: "v-mkp-sec" }),
      secSug = n("section", null, { class: "v-mkp-sec" }),
      secJoin = n("section", null, { class: "v-mkp-sec" });
    const secHead = (no, title, hint) => {
      const h = n("h3", null, { class: "v-mkp-h" });
      h.append(n("span", String(no), { class: "v-mkp-no" }), title);
      if (hint) h.append(n("span", hint, { class: "v-muted v-mkp-hint" }));
      return h;
    };
    body.append(secCustom, secSug, secJoin);
    const summary = n("div", null, { class: "v-mkp-sum" });
    const endOf = () => toHm(toMin(st.time) + st.duration);
    const startAt = () => st.date + "T" + st.time + "+08:00";
    let checkSeq = 0,
      daySeq = 0;
    const lanes = n("div", null, { class: "v-tl" });
    const verdict = n("div", null, { class: "v-mkp-verdict", "aria-live": "polite" });
    const fixes = n("div", null, { class: "v-mkp-fixes" });
    const drawSummary = () => {
      summary.replaceChildren(
        n("span", "将安排：", { class: "v-muted" }),
        n(
          "strong",
          P().dayLabel(st.date) + " " + st.time + "–" + endOf() + " · " + (tName.get(st.teacher_id) || "未定老师") + " · " + (st.location_id ? rName.get(st.location_id) || "教室" : "不占教室"),
        ),
      );
    };
    async function drawDay() {
      const seq = ++daySeq;
      lanes.classList.add("is-loading");
      // 换了老师或教室：学员那一行仍用补课接口（含学员不可排时段），老师、教室两行按当天课表现算新选择的占用。
      const changed = st.teacher_id !== orig.teacher_id || st.location_id !== orig.location_id;
      const [day, rows] = await Promise.all([
        api("c2/makeups/" + pid + "/day?date=" + st.date).catch((e) => ({ error: e.message, busy: [] })),
        changed ? liveDayRows(st.date).catch(() => null) : null,
      ]);
      if (seq !== daySeq) return;
      if (changed && rows) {
        const own = (day.busy || []).filter((b) => b.who === "student" || b.who === "block");
        const hits = liveConflicts(
          { from: TL_FROM, duration: TL_TO - TL_FROM, teacher_id: st.teacher_id, location_id: st.location_id, mode: st.location_id ? "offline" : "online", exclude_id: data.id },
          rows,
        ).filter((h) => h.who !== "student");
        day.busy = [...own, ...hits.map((h) => ({ who: h.who, from: toHm(h.from), to: toHm(h.to), label: h.label }))];
        day.teacher_usual = st.teacher_id === orig.teacher_id ? day.teacher_usual : null;
      }
      const laneTeacher = changed && rows ? st.teacher_id : orig.teacher_id,
        laneRoom = changed && rows ? st.location_id : orig.location_id;
      lanes.classList.remove("is-loading");
      lanes.replaceChildren();
      const head = n("div", null, { class: "v-tl-head" });
      head.append(n("strong", P().dayLabel(st.date) + " 当天安排"), n("span", "灰色＝已有安排　蓝框＝你选的时间", { class: "v-muted" }));
      lanes.append(head);
      const axis = n("div", null, { class: "v-tl-row" });
      axis.append(n("span"));
      const ticks = n("div", null, { class: "v-tl-axis" });
      for (let m = TL_FROM; m <= TL_TO; m += 120) ticks.append(tlPlace(n("span", toHm(m)), m, m + 60));
      axis.append(ticks);
      lanes.append(axis);
      const from = toMin(st.time),
        to = from + st.duration;
      const lane = (label, who) => {
        const row = n("div", null, { class: "v-tl-row" });
        const track = n("div", null, { class: "v-tl-track" });
        if (who === "teacher" && day.teacher_usual) track.append(tlPlace(n("span", null, { class: "v-tl-usual", title: "老师常上课的时段" }), toMin(day.teacher_usual.from), toMin(day.teacher_usual.to)));
        for (const b of day.busy || [])
          if (b.who === who || (b.who === "block" && who === "student"))
            track.append(tlPlace(n("span", b.label || (b.who === "block" ? "不可排" : "有课"), { class: "v-tl-busy", title: b.from + "–" + b.to + " " + (b.label || "") }), toMin(b.from), toMin(b.to)));
        track.append(tlPlace(n("span", null, { class: "v-tl-pick", "aria-label": "你选的时间 " + st.time + "–" + endOf() }), from, to));
        row.append(n("span", label, { class: "v-tl-label" }), track);
        lanes.append(row);
      };
      lane(tName.get(laneTeacher) || "老师", "teacher");
      lane(part.student_name, "student");
      if (laneRoom) lane(rName.get(laneRoom) || "教室", "room");
      if (day.error) lanes.append(n("p", day.error, { class: "v-muted v-small" }));
      else if (changed && !rows)
        lanes.append(n("p", "时间轴暂时按原老师和原教室显示；下面的冲突检查按新选择计算。", { class: "v-muted v-small" }));
    }
    async function runCheck() {
      const seq = ++checkSeq;
      // 已有结论时先变淡，查完再换；第一次才显示“正在检查”。
      if (verdict.childNodes.length) verdict.classList.add("is-stale");
      else {
        verdict.className = "v-mkp-verdict is-wait";
        verdict.replaceChildren("正在检查老师、学员、教室是否空闲…");
      }
      fixes.classList.add("is-stale");
      const r = await api("c2/makeups/" + pid + "/check", "POST", {
        start_at: startAt(),
        duration: st.duration,
        teacher_id: st.teacher_id,
        location_id: st.location_id,
      }).catch((e) => ({ ok: false, error: e.message }));
      if (seq !== checkSeq) return;
      st.check = r;
      fixes.replaceChildren();
      fixes.classList.remove("is-stale");
      lanes.classList.toggle("is-bad", !r.ok);
      if (r.ok) {
        verdict.className = "v-mkp-verdict is-ok";
        verdict.replaceChildren(n("strong", "没有冲突"), "老师、学员、教室这个时间都空着。");
        return;
      }
      verdict.className = "v-mkp-verdict is-bad";
      verdict.replaceChildren(n("strong", r.error ? "没法检查" : "有冲突"), (r.error ? r.error : (r.conflicts || []).map((x) => x.text).join("；")) + "");
      // 教室冲突时给出能一键换的空教室（同一时段按推荐里出现过的教室）；时间冲突时给出最近的推荐。
      if ((r.conflicts || []).some((x) => x.who === "room")) {
        const alt = rooms.filter((x) => x.active !== 0 && x.id !== st.location_id && !x.offsite).slice(0, 3);
        for (const room of alt)
          fixes.append(
            button("换到 " + room.name, () => {
              st.location_id = room.id;
              st.picked = null;
              return refresh();
            }),
          );
      }
      const near = sug.items.find((x) => x.start_at.slice(0, 10) === st.date && x.start_at !== startAt());
      if (near)
        fixes.append(
          button("改用推荐 " + near.start_at.slice(11, 16), () => {
            pick(near);
          }),
        );
    }
    // 自己的下拉框改动时不重建这一块（避免下拉框闪一下、跳一下），只更新结束时间；点推荐时间时才整块重画。
    let endValue = null;
    const refresh = async (redraw = true) => {
      if (redraw || !endValue) drawCustom();
      else endValue.textContent = endOf() + "（自动）";
      drawSug();
      drawSummary();
      await Promise.all([drawDay(), runCheck()]);
    };
    function drawCustom() {
      secCustom.replaceChildren(secHead(1, "自选时间"));
      const grid = n("div", null, { class: "v-mkp-grid" });
      const date = UI.datePicker({
        label: "日期",
        value: st.date,
        onChange: (v) => {
          if (!v) return;
          st.date = v;
          st.picked = null;
          void refresh(false);
        },
      });
      const time = UI.timePicker({
        label: "开始时间",
        value: st.time,
        onChange: (v) => {
          st.time = v;
          st.picked = null;
          void refresh(false);
        },
      });
      const durs = [...new Set([30, 45, 60, 90, 120, Number(orig.duration) || 45])].sort((a, b) => a - b);
      const dur = UI.selectControl({
        label: "时长",
        value: String(st.duration),
        options: durs.map((d) => ({ value: String(d), label: d + " 分钟" })),
        onChange: (v) => {
          st.duration = Number(v);
          st.picked = null;
          void refresh(false);
        },
      });
      const teacher = UI.selectControl({
        label: "老师",
        value: st.teacher_id || "",
        options: teachers.filter((t) => t.status !== "archived" || t.id === st.teacher_id).map((t) => ({ value: t.id, label: t.name })),
        onChange: (v) => {
          st.teacher_id = v;
          st.picked = null;
          void refresh(false);
        },
      });
      const room = UI.selectControl({
        label: "教室",
        value: st.location_id || "",
        options: [{ value: "", label: "不占教室（线上等）" }, ...rooms.filter((r) => r.active !== 0 || r.id === st.location_id).map((r) => ({ value: r.id, label: r.name }))],
        onChange: (v) => {
          st.location_id = v || null;
          st.picked = null;
          void refresh(false);
        },
      });
      const end = n("div", null, { class: "ui-field v-mkp-end" });
      endValue = n("div", endOf() + "（自动）", { class: "ui-control v-mkp-endv" });
      end.append(n("label", "结束"), endValue);
      grid.append(date.element, time.element, dur.element, teacher.element, room.element, end);
      secCustom.append(grid, lanes, verdict, fixes);
    }
    function pick(item) {
      st.date = item.start_at.slice(0, 10);
      st.time = item.start_at.slice(11, 16);
      st.duration = Number(item.duration) || st.duration;
      st.teacher_id = item.teacher_id || st.teacher_id;
      st.location_id = item.location_id ?? st.location_id;
      st.picked = item.start_at;
      void refresh();
      body.scrollTo?.({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
    function drawSug() {
      secSug.replaceChildren(secHead(2, "推荐时间", "点一下就会填到上面"));
      if (!sug.items.length) {
        secSug.append(n("p", "接下来两周没有找到合适的空档，请在上面自选时间，或加入已有的同类课。", { class: "v-muted" }));
        return;
      }
      const byDay = new Map();
      for (const it of [...sug.items].sort((a, b) => a.start_at.localeCompare(b.start_at))) {
        const d = it.start_at.slice(0, 10);
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d).push(it);
      }
      for (const [d, list] of byDay) {
        secSug.append(n("div", P().dayLabel(d), { class: "v-mkp-day" }));
        for (const it of list) {
          const card = n("button", null, { type: "button", class: "v-mkp-rec" + (st.picked === it.start_at ? " is-on" : ""), "aria-pressed": String(st.picked === it.start_at) });
          const top = n("span", null, { class: "v-mkp-rec-top" });
          top.append(
            n("strong", F.range(it.start_at, it.duration)),
            " · " + (tName.get(it.teacher_id) || "原老师") + (it.location_id ? " · " + (rName.get(it.location_id) || "") : ""),
          );
          card.append(top, n("span", it.reason_text || "", { class: "v-muted" }));
          card.addEventListener("click", () => pick(it));
          secSug.append(card);
        }
      }
    }
    secJoin.append(secHead(3, "加入已有的同类课", "小组课可以直接插班，不用新开一节"));
    secJoin.append(
      button("选择已有课程…", async () => {
        await view.close();
        await R().manualMakeup(c, data, part);
      }),
    );
    const saveBtn = UI.button("保存补课", {
      kind: "primary",
      onClick: async () => {
        const result = await creditWrite("makeups", {
          original_participant_id: pid,
          new_lesson: {
            ...data,
            id: undefined,
            teacher_id: st.teacher_id,
            location_id: st.location_id,
            start_at: startAt(),
            duration: st.duration,
            student_ids: [part.student_id],
            force: false,
          },
          note: st.picked ? "从推荐时间安排" : "自选时间安排",
        });
        if (!result.committed) {
          notice("没保存：" + ((result.conflicts || []).map((x) => (x.reasons || []).join("、")).join("；") || "时段已被占用，请换一个时间"));
          await runCheck();
          return;
        }
        notice("已安排补课", "success");
        await view.close();
        if (!c.isConnected) c.replaceChildren(n("span"));
        else vHead?.navigate?.(document.querySelector(".v-content")?.dataset.route || "today");
      },
    });
    const cancel = UI.button("取消", { onClick: () => view.close() });
    const foot = n("div", null, { class: "v-mkp-foot" });
    foot.append(summary, cancel, saveBtn);
    view.footer.append(foot);
    await refresh();
  }
  if (typeof makeupForm === "function" && !makeupForm.v2) {
    const c2Makeup = makeupForm;
    makeupForm = (c, data, part) => (enabled("lessons", "create") ? makeupPanel(c, data, part) : c2Makeup(c, data, part));
    makeupForm.v2 = true;
  }


  // ---------- 招生 · 线索详情 ----------
  // 与学员详情同一套排法：头部（姓名、阶段、来源）→ 阶段进度（点一下就改）→ 资料 → 跟进备注 → 下次回访 → 操作。
  // 写入沿用 tools/leads/:id PATCH（带全部字段，不改手机号）、/contact、/convert。
  const LEAD_STEPS = ["new", "contacted", "trial"];
  function leadDetailV(c, row) {
    const S = me.labels.lead_stages || {};
    const view = UI.drawer({ title: row.name, subtitle: (S[row.stage] || "") + (row.source ? " · 来源 " + row.source : "") });
    view.element.classList.add("v-ld");
    const refresh = async () => {
      await view.close();
      if (c?.isConnected) await leads(c);
      else if (c) c.replaceChildren(n("span"));
    };
    const canEdit = enabled("leads", "update") && !row.student_id;
    const patch = (changes) =>
      api("tools/leads/" + row.id, "PATCH", {
        name: row.name,
        grade: row.grade || "",
        direction: row.direction || "",
        source: row.source || "",
        note: row.note || "",
        stage: row.stage,
        next_followup: row.next_followup || null,
        trial_at: row.trial_at || null,
        ...changes,
        version: row.version,
      });
    // 阶段进度
    const steps = n("ol", null, { class: "v-ld-steps", "aria-label": "跟进阶段" });
    const at = row.student_id ? 3 : LEAD_STEPS.indexOf(row.stage);
    [...LEAD_STEPS, "enrolled"].forEach((k, i) => {
      const li = n("li", null, { class: "v-ld-step" + (i < at ? " is-done" : i === at ? " is-on" : "") + (row.stage === "lost" ? " is-lost" : "") });
      const label = n("span", S[k] || k);
      if (canEdit && k !== "enrolled" && row.stage !== "lost" && k !== row.stage) {
        const b = n("button", null, { type: "button", "aria-label": "改为" + (S[k] || k) });
        b.append(n("i"), label);
        b.addEventListener("click", async () => {
          try {
            await patch({ stage: k });
            notice("已改为" + (S[k] || k), "success");
            await refresh();
          } catch (e) {
            notice(e.message);
          }
        });
        li.append(b);
      } else li.append(n("i"), label);
      steps.append(li);
    });
    view.body.append(steps);
    if (row.stage === "lost") view.body.append(n("p", "这条线索已标记流失" + (row.note ? "：" + row.note : "") + "。", { class: "v-ld-lost" }));
    // 资料
    const dl = n("dl", null, { class: "v-fu-dl v-ld-dl" });
    const pair = (k, v) => {
      const dd = n("dd");
      dd.append(v || n("span", "未填写", { class: "v-muted" }));
      dl.append(n("dt", k), dd);
    };
    const phoneBox = n("span");
    phoneBox.append(row.phone || "未填写");
    if (row.phone && enabled("leads", "update"))
      phoneBox.append(
        " ",
        link("显示号码", async () => {
          const ct = await api("tools/leads/" + row.id + "/contact", "POST", {});
          phoneBox.replaceChildren(ct.phone || "未填写", ct.parent_phone ? " · 家长 " + ct.parent_phone : "", n("span", "（已记录查看）", { class: "v-muted v-small" }));
        }),
      );
    pair("手机", phoneBox);
    pair("来源", row.source);
    pair("年级", row.grade);
    pair("意向方向", row.direction);
    pair("试听时间", row.trial_at ? P().dayLabel(row.trial_at.slice(0, 10)) + " " + row.trial_at.slice(11, 16) : "");
    pair("登记时间", P().dayLabel(new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date(row.created_at))));
    if (row.student_id) pair("正式学员", link("查看学员档案", async () => (await view.close(), R().goStudent(row.student_id))));
    view.body.append(dl);
    // 下次回访：一键改期
    const next = n("section", null, { class: "v-ld-sec" });
    next.append(n("h4", "下次回访"));
    const nextRow = n("div", null, { class: "v-ld-next" });
    const today = todayBJ();
    const shift = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "UTC" }).format(new Date(Date.parse(today + "T00:00:00Z") + d * 86400000));
    nextRow.append(
      row.next_followup
        ? chip(P().dayLabel(row.next_followup) + (row.next_followup < today ? " · 已过期" : row.next_followup === today ? " · 今天" : ""), row.next_followup < today ? "bad" : row.next_followup === today ? "warn" : "info")
        : chip("未安排", "muted"),
    );
    if (canEdit && row.stage !== "lost")
      for (const [t, d] of [["明天", 1], ["3 天后", 3], ["下周", 7]])
        nextRow.append(
          button(t, async () => {
            await patch({ next_followup: shift(d) });
            notice("下次回访改到 " + P().dayLabel(shift(d)), "success");
            await refresh();
          }),
        );
    next.append(nextRow);
    view.body.append(next);
    // 跟进备注：直接改
    const noteSec = n("section", null, { class: "v-ld-sec" });
    noteSec.append(n("h4", "跟进备注"));
    if (canEdit) {
      const area = n("textarea", null, { class: "ui-control", rows: "4", maxlength: "6000", "aria-label": "跟进备注", placeholder: "家长关心什么、上次聊到哪、下一步做什么" });
      area.value = row.note || "";
      noteSec.append(area);
      noteSec.append(
        button("保存备注", async () => {
          await patch({ note: area.value.trim() });
          notice("备注已保存", "success");
          await refresh();
        }),
      );
    } else noteSec.append(n("p", row.note || "没有备注。", { class: "preserve-text" }));
    view.body.append(noteSec);
    // 操作
    const ops = n("div", null, { class: "v-ld-ops" });
    if (row.stage === "lost" && canEdit)
      ops.append(
        button(
          "重新跟进",
          async () => {
            await patch({ stage: "contacted" });
            await refresh();
          },
          "primary",
        ),
      );
    if (row.stage === "trial" && !row.student_id && enabled("students", "create") && enabled("leads", "create"))
      ops.append(
        button(
          "转为正式学员",
          async () => {
            if (!(await UI.confirm({ title: row.name + " 转为正式学员？", consequence: "会新建一个学员档案，线索的历史保留。", danger: false }))) return;
            await api("tools/leads/" + row.id + "/convert", "POST", { version: row.version });
            notice("已转为正式学员", "success");
            await refresh();
          },
          "primary",
        ),
      );
    if (canEdit) {
      ops.append(
        button("编辑资料", async () => {
          await view.close();
          leadForm(c, row);
        }),
      );
      const items = [];
      if (row.stage !== "lost")
        items.push({
          label: "标记流失…",
          danger: true,
          onSelect: async () => {
            if (!(await UI.confirm({ title: "把 " + row.name + " 标记为流失？", consequence: "以后可以点“重新跟进”恢复。", danger: true }))) return;
            await patch({ stage: "lost", next_followup: null });
            await refresh();
          },
        });
      if (enabled("leads", "delete"))
        items.push({
          label: "删除线索",
          danger: true,
          onSelect: () =>
            globalThis.ChannelV2Pay.removeItem({
              title: "删除线索“" + row.name + "”？",
              consequence: "删除后不再显示；已经转为正式学员的档案不受影响。",
              path: "tools/leads/" + row.id,
              body: { version: row.version },
              done: refresh,
            }),
        });
      if (items.length) ops.append(UI.actionMenu({ items }).element);
    }
    if (ops.children.length) view.footer.append(ops);
  }
  if (globalThis.ChannelC3) globalThis.ChannelC3.leadDetail = leadDetailV;

  if (typeof pageHooks !== "undefined") {
    pageHooks.checkin = checkin;
    pageHooks.pickCheckin = (t) => (cState.tab = t);
  }
  globalThis.ChannelV2Todo = { renewals, makeups, leads, checkin, followups };
})();
