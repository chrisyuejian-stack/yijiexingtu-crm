// 第十阶段重构（v2）第 3 组：学员、教师（左列表、右详情；手机列表与详情分屏）。
// 只读既有接口；编辑、加课时包、跟进等写入全部复用原有表单与原写入路径。
(() => {
  "use strict";
  const n = el,
    F = UI.fmt,
    V = () => globalThis.ChannelV2,
    R = () => globalThis.ChannelRebuild;
  const phone = () => matchMedia("(max-width: 760px)").matches;
  const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const dayLabel = (iso) =>
    iso.slice(5, 10) + " " + WEEK[new Date(iso.slice(0, 10) + "T12:00:00Z").getUTCDay()];
  const chip = (text, tone) => V().chip(text, tone);
  const panel = (title, extra) => V().panel(title, extra);
  const link = (text, fn) => V().link(text, fn);

  // 原有表单保存后会把结果页渲染进传入的容器；给它一个不挂载的容器，
  // 一旦被写入就说明保存完成，回到本页重新渲染。
  function sink(done) {
    const box = n("div");
    new MutationObserver((_, o) => {
      o.disconnect();
      done();
    }).observe(box, { childList: true });
    return box;
  }
  function avatar(name, extra = "") {
    return n("span", Array.from(name || "?")[0], { class: "v-avatar-mark " + extra });
  }
  // 读到的手机号是打码的（137****0001）；编辑表单里留空 = 保留原号码，不能把打码值存回去。
  const unmask = (row) => ({ ...row, phone: "", parent_phone: "" });
  function backRow(text, fn, extra) {
    const row = n("div", null, { class: "v-back" });
    row.append(link("‹ " + text, fn), n("span", null, { class: "v-spacer" }));
    if (extra) row.append(extra);
    return row;
  }
  function kpi(label, value, hint, tone = "") {
    const box = n("div", null, { class: "v-kpi" + (tone ? " v-tone-" + tone : "") });
    box.append(
      n("span", label, { class: "v-kpi-label" }),
      n("strong", value, { class: "v-kpi-value" }),
      n("small", hint || ""),
    );
    return box;
  }
  function kpis(items) {
    const row = n("div", null, { class: "v-kpis" });
    row.append(...items.filter(Boolean));
    return row;
  }

  // ---------- 学员 ----------
  const sState = { q: "", filter: "active", items: [], next: null, key: "", counts: null };
  const FILTERS = {
    active: { status: "active", balance: "" },
    zero: { status: "active", balance: "zero" },
    low: { status: "active", balance: "low" },
    all: { status: "", balance: "" },
  };
  const listQuery = (offset = 0) => {
    const f = FILTERS[sState.filter];
    return new URLSearchParams({ q: sState.q, status: f.status, balance: f.balance, offset });
  };
  async function loadStudents(force) {
    const key = listQuery().toString();
    // 同样的筛选、且期间没有保存操作时直接复用（缴费、改状态后会自动重取）。
    if (!force && key === sState.key && sState.items.length && sState.seq === apiWriteSeq) return;
    const data = await api("c2/students?" + listQuery());
    Object.assign(sState, {
      key,
      seq: apiWriteSeq,
      items: data.items,
      next: data.next_offset ?? null,
      total: data.total,
      threshold: Number(data.settings?.low_balance_threshold ?? 3),
    });
  }
  async function loadCounts(force) {
    if (sState.counts && !force && sState.countsSeq === apiWriteSeq) return sState.counts;
    const seq = apiWriteSeq;
    // 参数写法和列表一致（q、status、balance、offset 同顺序），“在读”这一项能和列表本身共用同一个请求。
    const total = (q) => api("c2/students?" + new URLSearchParams({ q: "", status: q.status, balance: q.balance || "", offset: 0 })).then((d) => d.total);
    const list = [
      ["active", { status: "active" }],
      ["paused", { status: "paused" }],
      ["archived", { status: "archived" }],
    ];
    if (enabled("packages"))
      list.push(["zero", { status: "active", balance: "zero" }], ["low", { status: "active", balance: "low" }]);
    // 新后端一次返回五个数字；旧后端没有这个接口（404）时退回逐个取总数。
    let counts = null;
    try {
      counts = await api("c2/students/counts");
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    if (counts) {
      if (!enabled("packages")) delete counts.zero, delete counts.low;
      sState.counts = counts;
      sState.countsSeq = seq;
      return sState.counts;
    }
    const values = await Promise.all(list.map(([, q]) => total(q)));
    sState.counts = Object.fromEntries(list.map(([k], i) => [k, values[i]]));
    sState.countsSeq = seq;
    return sState.counts;
  }
  const balanceTone = (row) =>
    row.balance === undefined
      ? ""
      : row.balance <= 0
        ? "bad"
        : row.balance <= sState.threshold
          ? "warn"
          : "";

  function studentList(c, selected) {
    const box = n("section", null, { class: "v-list" }),
      head = n("div", null, { class: "v-list-head" }),
      search = n("input", null, {
        type: "search",
        class: "v-list-search",
        placeholder: "姓名、家长",
        "aria-label": "搜索学员",
        maxlength: "100",
      });
    search.value = sState.q;
    let timer;
    search.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        sState.q = search.value.trim();
        refreshList(c);
      }, 300);
    });
    const chips = n("div", null, { class: "v-filter-chips is-even", role: "group", "aria-label": "筛选" }),
      counts = sState.counts || {};
    for (const [key, label, count] of [
      ["active", "在读", counts.active],
      ...(enabled("packages")
        ? [
            ["zero", "已用完", counts.zero],
            ["low", "快用完", counts.low],
          ]
        : []),
      ["all", "全部"],
    ]) {
      const b = n("button", label, {
        type: "button",
        class: "v-filter-chip" + (sState.filter === key ? " is-on" : "") + (key === "zero" ? " is-bad" : key === "low" ? " is-warn" : ""),
        "aria-pressed": String(sState.filter === key),
      });
      b.dataset.countKey = key;
      if (count !== undefined && count !== null) b.append(n("span", String(count), { class: "v-chip-count" }));
      b.addEventListener("click", () => {
        sState.filter = key;
        for (const x of chips.children) {
          x.classList.toggle("is-on", x === b);
          x.setAttribute("aria-pressed", String(x === b));
        }
        refreshList(c);
      });
      chips.append(b);
    }
    head.append(search, chips);
    const rows = n("div", null, { class: "v-list-rows" });
    for (const row of sState.items) {
      const item = n("button", null, {
        type: "button",
        class: "v-list-row" + (row.id === selected ? " is-on" : ""),
        "data-id": row.id,
        ...(row.id === selected ? { "aria-current": "true" } : {}),
      });
      const who = n("span", null, { class: "v-list-main" }),
        name = n("strong", row.name);
      if (row.same_name_count > 1 && row.grade) name.append(n("small", row.grade, { class: "v-list-tag" }));
      if (row.status !== "active") name.append(n("small", UI.personStatus(row), { class: "v-list-tag" }));
      who.append(name, n("span", row.course_names || "暂无课时包", { class: "v-list-sub" }));
      item.append(avatar(row.name), who);
      if (row.balance !== undefined)
        item.append(
          row.package_count
            ? n("span", F.units(row.balance), { class: "v-list-tail v-tone-text-" + (balanceTone(row) || "muted") })
            : n("span", "无课时包", { class: "v-list-tail v-tone-text-muted" }),
        );
      item.addEventListener("click", () => R().goStudent(row.id));
      rows.append(item);
    }
    if (!sState.items.length)
      rows.append(n("p", sState.q ? "没有找到“" + sState.q + "”。" : "这里还没有学员。", { class: "v-list-empty" }));
    const foot = n("div", null, { class: "v-list-foot" });
    foot.append(n("span", "共 " + (sState.total ?? sState.items.length) + " 人"));
    if (sState.next !== null)
      foot.append(
        button("加载更多", async () => {
          const more = await api("c2/students?" + listQuery(sState.next));
          sState.items.push(...more.items);
          sState.next = more.next_offset ?? null;
          refreshList(c);
        }),
      );
    box.append(head, rows, foot);
    return box;
  }

  // 学员基本资料（档案、摘要、上课历史）一次并行取回；同页内切换分页时短暂复用，整页刷新时清空。
  const dCache = new Map();
  function studentBase(id) {
    const hit = dCache.get(id);
    if (hit && hit.writes === apiWriteSeq && Date.now() - hit.at < 60000) return hit.p;
    const key = encodeURIComponent(id);
    const p = Promise.all([
      api("data/students/" + key),
      api("c2/students/" + key),
      enabled("schedule")
        ? api("c2/students/" + key + "/history").then((d) => d.items || []).catch(() => null)
        : null,
    ]);
    dCache.set(id, { at: Date.now(), writes: apiWriteSeq, p });
    p.catch(() => dCache.delete(id));
    return p;
  }
  async function studentDetailView(c, id, tab, standalone) {
    const key = encodeURIComponent(id);
    // 分页需要的额外数据与基本资料同时发出，不再一个等一个。
    const overview = tab === "overview" && !standalone;
    const extra = {
      packs: overview && enabled("packages") ? api("credits/packages?student_id=" + key).then((d) => d.items || []) : null,
      tasks: overview && enabled("followup") ? toolPage("followup_tasks", id).then((d) => d.items || []) : null,
      records: tab === "records" && !standalone ? R().take("c2/students/" + key + "/history") : null,
    };
    for (const v of Object.values(extra)) v?.catch(() => {});
    const [rec, data, history] = await studentBase(id);
    const row = rec.record,
      facts = data.facts || {},
      groups = data.renewal_groups || [];
    const again = () => render(c, true);
    const wrap = n("div", null, { class: "v-detail", "data-id": id });

    // 头部
    const head = n("section", null, { class: "v-detail-head v-panel" });
    if (standalone)
      wrap.append(
        backRow(
          "学员",
          () => (location.hash = "students"),
          enabled("students", "update") && link("编辑", () => recordForm(sink(again), "students", unmask(row))),
        ),
      );
    const title = n("div", null, { class: "v-detail-title" }),
      line = n("div", null, { class: "v-detail-name" });
    line.append(n("h2", row.name), chip(UI.personStatus(row), row.status === "active" ? "ok" : "muted"));
    if (row.direction) line.append(chip(row.direction, "info"));
    const same = sState.items.filter((x) => x.name === row.name && x.id !== row.id);
    if (same.length)
      line.append(chip("同名：另有 " + row.name + (same[0].grade ? " · " + same[0].grade : ""), "warn"));
    // 联系方式：每段不拆行（避免“学/员”被截断），“显示”放在号码后面，点开后原位替换
    const contact = n("p", null, { class: "v-detail-sub v-csegs" });
    const seg = (...kids) => {
      const x = n("span", null, { class: "v-cseg" });
      x.append(...kids);
      contact.append(x);
      return x;
    };
    if (row.grade) seg(row.grade);
    const parentNo = n("span", row.parent_phone || "", { class: "v-num" }),
      studentNo = n("span", row.phone || "", { class: "v-num" });
    if (row.parent_name || row.parent_phone) seg("家长 " + (row.parent_name || "") + (row.parent_phone ? " " : ""), parentNo);
    if (row.phone) seg("学员 ", studentNo);
    if (enabled("accounts", "reveal_phone") && (row.parent_phone || row.phone)) {
      const show = link("显示号码", async () => {
        const r = await api("data/students/" + id + "/contact", "POST", {});
        parentNo.textContent = r.parent_phone || "未填";
        studentNo.textContent = r.phone || "未填";
        show.remove();
      });
      contact.append(show);
    }
    const account = n(
      "p",
      row.account_id ? "学员账号已开通" + (row.account_active ? "" : " · 已停用") : "未开通学员账号",
      { class: "v-detail-sub" },
    );
    title.append(line, contact, account);
    head.append(avatar(row.name, "is-big"), title);

    const urgent = groups.find((g) => g.state === "zero") || groups.find((g) => g.state === "low");
    const remind = async (group) => {
      const view = UI.drawer({ title: "续费提醒 · " + row.name, subtitle: group.course_name });
      await renewalNotice(view.body, await api("renewal-brand"), group);
    };
    const ops = n("div", null, { class: "v-detail-ops" });
    if (enabled("students", "update"))
      ops.append(button("编辑档案", () => recordForm(sink(again), "students", unmask(row))));
    if (enabled("exports", "export") && enabled("schedule"))
      ops.append(
        button("生成课表图", async () => {
          const view = UI.drawer({ title: row.name + " · 本周课表图" });
          await timetableImage(view.body, weekStart(todayBJ()), "student_id=" + encodeURIComponent(id));
        }),
      );
    if (urgent && enabled("exports", "export")) ops.append(button("发续费提醒", () => remind(urgent)));
    if (enabled("packages", "create"))
      ops.append(button("＋ 课时包", () => creditForm(sink(again), "packages", { student_id: id }), "primary"));
    const more = [];
    if (!row.account_id && enabled("accounts", "create_personal"))
      more.push({ label: "开通学员账号", onSelect: () => personalAccount("students", row) });
    if (row.account_id && enabled("accounts", "reset_personal"))
      more.push({
        label: "重置学员账号密码",
        onSelect: async () => {
          if (await UI.confirm({ title: "重置学员密码？", consequence: "原密码失效，所有设备下线；初始密码仅显示一次。" }))
            showSecret(await api("accounts/" + row.account_id + "/reset-password", "POST", {}));
        },
      });
    if (enabled("students", "update"))
      for (const [value, label] of [
        ["active", "恢复在读"],
        ["paused", "暂停"],
        ["archived", "归档"],
      ])
        if (row.status !== value)
          more.push({
            label,
            onSelect: async () => {
              if (await UI.confirm({ title: label + "：" + row.name + "？", consequence: "保留历史课程、缴费与审计记录。" })) {
                await api("data/students/" + id, "PATCH", { status: value, version: row.version });
                sState.counts = null;
                await again();
              }
            },
          });
    if (enabled("students", "delete"))
      more.push({
        label: "删除学员",
        danger: true,
        onSelect: async () => {
          if (await UI.confirm({ title: "删除学员？", consequence: "仅无课程、课时包等关联的档案可删除；有历史记录时请归档。", danger: true })) {
            await api("data/students/" + id, "DELETE", { version: row.version });
            sState.counts = null;
            sState.key = "";
            location.hash = "students";
          }
        },
      });
    if (more.length) ops.append(UI.actionMenu({ label: "更多", items: more }).element);
    head.append(ops);
    wrap.append(head);

    // 四个数字
    const month = todayBJ().slice(0, 7),
      thisMonth = (history || []).filter((l) => l.start_at.slice(0, 7) === month && l.status !== "planned");
    const worst = groups.find((g) => g.state === "zero") ? "已用完" : groups.find((g) => g.state === "low") ? "快用完" : "";
    wrap.append(
      kpis([
        facts.balance !== undefined &&
          kpi(
            "剩余课时",
            // B1：有欠课时时显示负数（可用余额 = 课时包余额 − 欠课时）。
            facts.debt_units > 0 ? F.units(facts.available_units ?? -facts.debt_units) : F.units(facts.balance),
            facts.debt_units > 0
              ? "欠 " + F.units(facts.debt_units) + " · 买课时包后自动补扣"
              : facts.package_count + " 个课时包" + (worst ? " · " + worst : ""),
            facts.balance <= 0 || facts.debt_units > 0 ? "bad" : worst ? "warn" : "",
          ),
        history &&
          !standalone &&
          kpi(
            "本月上课",
            thisMonth.filter((l) => l.attendance === "attended" || l.attendance === "no_show").length + " 次",
            "请假 " +
              thisMonth.filter((l) => l.attendance === "student_leave").length +
              " · 缺课 " +
              thisMonth.filter((l) => l.attendance === "no_show").length,
          ),
        enabled("schedule") &&
          kpi(
            "下次课",
            data.next ? dayLabel(data.next.start_at) : "暂无安排",
            data.next ? F.time(data.next.start_at) + " " + data.next.course_name + " · " + data.next.teacher_name : "",
          ),
        facts.paid_amount !== undefined &&
          !standalone &&
          kpi(
            "累计缴费",
            F.money(facts.paid_amount),
            facts.due_unresolved ? "欠费待核对 " + facts.due_unresolved + " 笔" : "欠费 " + F.money(facts.due_amount || 0),
            "money",
          ),
      ]),
    );

    // 分页
    const tabs = [
      ["overview", "概况", true],
      ["schedule", "课表", enabled("schedule")],
      ["records", "上课记录", enabled("schedule")],
      ["packages", "课时与缴费", enabled("packages") || enabled("tuition")],
      ["followup", "跟进", enabled("followup")],
      ["stages", "学习阶段", enabled("students")],
      ["parents", "家长", enabled("parents", "manage")],
      ["plans", "课程方案", enabled("plans")],
      ["repertoire", "曲目 / 作品", enabled("growth_reports") || (typeof yxIsTeacher === "function" && yxIsTeacher())],
      ["more", "更多", true],
    ].filter((x) => x[2] && !(standalone && (x[0] === "overview" || x[0] === "more")));
    if (tab === "payments") tab = "packages";
    if (!tabs.some((x) => x[0] === tab)) tab = "overview";
    const bar = n("nav", null, { class: "v-ptabs", "aria-label": "学员资料分页" });
    for (const [key, label] of tabs) {
      const b = n("button", label, { type: "button", class: "v-ptab" + (key === tab ? " is-on" : "") });
      if (key === tab) b.setAttribute("aria-current", "page");
      b.addEventListener("click", () => {
        // 点下立即高亮，内容随后替换。
        for (const x of bar.children) {
          x.classList.toggle("is-on", x === b);
          x === b ? x.setAttribute("aria-current", "page") : x.removeAttribute("aria-current");
        }
        R().goStudent(id, key);
      });
      bar.append(b);
    }
    wrap.append(bar);
    const body = n("div", null, { class: "v-tab-body" });
    wrap.append(body);

    if (tab === "overview") {
      body.classList.add("v-detail-grid");
      const recent = panel("最近上课与点评");
      for (const l of data.recent || []) {
        const item = n("div", null, { class: "v-recent" }),
          top = n("div", null, { class: "v-recent-top" });
        top.append(
          n("strong", dayLabel(l.start_at) + " " + F.time(l.start_at)),
          n("span", l.course_name + (l.teacher_name ? " · " + l.teacher_name : ""), { class: "v-muted" }),
          n("span", null, { class: "v-spacer" }),
          l.status === "planned"
            ? chip("待销课", "warn")
            : chip(me.labels.attendance[l.attendance] || me.labels.lessons?.[l.status] || "", l.attendance === "attended" ? "ok" : "muted"),
        );
        item.append(top);
        const notes = [l.public_text, l.private_comment].filter(Boolean);
        item.append(
          notes.length
            ? n("p", notes.join("\n"), { class: "v-recent-note preserve-text" })
            : n("p", "老师未填写点评", { class: "v-recent-note v-muted" }),
        );
        recent.append(item);
      }
      if (!data.recent?.length) recent.append(n("p", "上课后，最近五次记录和点评会显示在这里。", { class: "v-muted v-pad" }));
      const side = n("div", null, { class: "v-detail-side" });
      if (enabled("packages")) {
        const packs = await extra.packs;
        const box = panel("课时包");
        for (const g of groups) {
          const mine = packs.filter((p) => g.package_ids.includes(p.id)),
            total = mine.reduce((s, p) => s + Number(p.units_total || 0), 0);
          const card = n("div", null, { class: "v-pack" }),
            top = n("div", null, { class: "v-pack-top" });
          top.append(
            n("strong", g.course_name + (total ? " · " + F.units(total) : "")),
            g.state === "zero" ? chip("已用完", "bad") : g.state === "low" ? chip("快用完", "warn") : chip("正常", "ok"),
          );
          const meter = n("progress", null, {
            class: "v-pack-bar v-pack-" + g.state,
            max: String(Math.max(total, 1)),
            value: String(Math.max(0, Math.min(total, Number(g.balance)))),
            "aria-label": "剩余课时",
          });
          const next =
            data.next && data.next.course_name === g.course_name ? " · " + data.next.start_at.slice(5, 10) + " 还有一节课" : "";
          card.append(
            top,
            meter,
            n(
              "p",
              "剩 " + F.units(g.balance) + (total ? " / " + F.units(total) : "") + " · " + (g.valid_to ? "至 " + g.valid_to : "不限有效期") + (g.expiring ? "（快到期）" : "") + next,
              { class: "v-muted v-small" },
            ),
          );
          const acts = n("div", null, { class: "v-pack-ops" });
          if (g.state !== "active" && enabled("exports", "export")) acts.append(button("发续费提醒", () => remind(g)));
          if (enabled("packages", "create"))
            acts.append(
              button("＋ 课时包", () =>
                creditForm(sink(again), "packages", { student_id: id, course_type_id: g.course_type_id || undefined }),
              ),
            );
          if (acts.childNodes.length) card.append(acts);
          box.append(card);
        }
        if (!groups.length) box.append(n("p", "还没有有效的课时包。", { class: "v-muted v-pad" }));
        side.append(box);
      }
      if (enabled("followup")) {
        const tasks = (await extra.tasks).filter((x) => !x.done);
        const box = panel(
          "跟进任务",
          enabled("followup", "create") && [
            n("span", null, { class: "v-spacer" }),
            link("＋ 添加", () => followupForm(sink(again), "followup_tasks", id)),
          ],
        );
        for (const t of tasks) {
          const label = n("label", null, { class: "v-task" }),
            check = n("input", null, { type: "checkbox", "aria-label": "完成：" + t.title });
          check.disabled = !enabled("followup", "update");
          check.addEventListener("change", async () => {
            check.disabled = true;
            try {
              await api("tools/followup_tasks/" + t.id, "PATCH", { ...t, version: t.version, done: true });
              await again();
            } catch (e) {
              check.checked = false;
              check.disabled = false;
              notice(e.message);
            }
          });
          label.append(check, n("span", (t.due_date ? t.due_date.slice(5) + " " : "") + t.title));
          if (t.owner_name) label.append(n("span", " · " + t.owner_name, { class: "v-muted" }));
          box.append(label);
        }
        if (!tasks.length) box.append(n("p", "没有未完成的跟进。", { class: "v-muted v-pad" }));
        side.append(box);
      }
      body.append(recent, side);
    } else if (tab === "records" && standalone) {
      // 手机：上课记录用卡片，不用宽表格。
      const rows = (history || []).filter((l) => l.status !== "planned").slice(0, 20);
      for (const l of rows) {
        const item = n("div", null, { class: "v-recent v-recent-card" }),
          top = n("div", null, { class: "v-recent-top" });
        top.append(
          n("strong", dayLabel(l.start_at) + " " + F.time(l.start_at)),
          n("span", l.course_name + (l.teacher_name ? " · " + l.teacher_name : ""), { class: "v-muted" }),
          n("span", null, { class: "v-spacer" }),
          chip(me.labels.attendance[l.attendance] || me.labels.lessons?.[l.status] || "", l.attendance === "attended" ? "ok" : "muted"),
        );
        const note = l.public_text || l.private_comment;
        item.append(top, n("p", note || "老师未填写点评", { class: "v-recent-note" + (note ? " preserve-text" : " v-muted") }));
        item.addEventListener("click", () => lessonDetail(c, l));
        body.append(item);
      }
      if (!rows.length) body.append(n("p", "还没有上课记录。", { class: "v-muted v-pad" }));
    } else if (tab === "records") {
      const rows = await extra.records;
      R().table(
        body,
        [
          { key: "start_at", label: "时间", render: (r) => F.date(r.start_at) + " " + F.time(r.start_at) },
          { key: "course_name", label: "课程" },
          { key: "teacher_name", label: "教师" },
          {
            key: "attendance",
            label: "出勤",
            render: (r) => (r.status === "planned" ? "待销课" : me.labels.attendance[r.attendance] || me.labels.lessons?.[r.status] || ""),
          },
          {
            key: "public_text",
            label: "点评",
            sortable: false,
            render: (r) => r.public_text || r.private_comment || "—",
          },
        ],
        rows,
        { rowAction: (r) => lessonDetail(c, r) },
      );
    } else if (tab === "packages") {
      // 课时包与缴费记录同时加载；最上面是欠课时与预收余额（B1）。
      const jobs = [];
      const funds = n("div");
      body.append(funds);
      jobs.push(globalThis.ChannelV2Pay.studentFunds(funds, id, row.name, () => render(c, true)).catch(() => {}));
      if (enabled("packages")) {
        const a = n("div");
        body.append(n("h3", "课时包", { class: "v-section-title" }), a);
        jobs.push(creditPage(a, "packages", id));
      }
      if (enabled("tuition")) {
        const b = n("div");
        body.append(n("h3", "缴费记录", { class: "v-section-title" }), b);
        jobs.push(creditPage(b, "payments", id));
      }
      await Promise.all(jobs);
    } else if (tab === "schedule") await V().studentWeek(body, id, c);
    else if (tab === "followup") await followupPage(body, id);
    else if (tab === "stages") await creditPage(body, "stages", id);
    else if (tab === "parents") await yxGuardians(body, id, row, again);
    else if (tab === "plans") await yxPlansTab(body, id, row, again);
    else if (tab === "repertoire") await yxRepertoireTab(body, id);
    else {
      const box = panel("更多");
      if (enabled("students", "read")) box.append(button("不可排时段", () => R().studentBlocks(c, id)));
      if (enabled("referrals")) box.append(button("合作升学推荐", () => referralsPage(body, id)));
      body.append(box);
    }
    return { wrap, row, data, groups, urgent, remind };
  }

  // 手机：详情为独立页面（画板 25）。
  async function phoneStudent(c, id, tab) {
    if (!tab || tab === "overview" || tab === "more") tab = enabled("schedule") ? "schedule" : "packages";
    const { wrap, row, urgent, remind } = await studentDetailView(c, id, tab, true);
    wrap.classList.add("is-phone");
    const quick = n("div", null, { class: "v-quick" });
    if (enabled("accounts", "reveal_phone") && row.parent_phone)
      quick.append(
        button("打给家长", async () => {
          const r = await api("data/students/" + id + "/contact", "POST", {});
          if (r.parent_phone) location.href = "tel:" + r.parent_phone;
          else notice("没有填写家长手机");
        }),
      );
    if (urgent && enabled("exports", "export")) quick.append(button("续费提醒", () => remind(urgent)));
    if (enabled("packages", "create"))
      quick.append(button("加课时包", () => creditForm(sink(() => render(c, true)), "packages", { student_id: id })));
    wrap.querySelector(".v-detail-ops")?.replaceWith(quick);
    return wrap;
  }

  async function render(c, force) {
    const route = R().parseStudentHash(location.hash.slice(1));
    const id = route?.[0],
      tab = route?.[1] || "overview";
    if (force) {
      sState.counts = null;
      sState.key = "";
    }
    // 学员详情缓存：只要这期间没有任何保存操作，回到学员页直接复用（1 分钟内）；有保存或手动刷新才重取。
    if (force) dCache.clear();
    if (phone() && id) {
      const wrap = await phoneStudent(c, id, tab);
      c.replaceChildren(wrap);
      c.dataset.page = "student-detail";
      vHead?.sub("");
      return;
    }
    // 先等名单，筛选上的数字随后补上（不让整页等五个数字）。
    const countsRequest = loadCounts(force);
    countsRequest.catch(() => {});
    await loadStudents(force);
    const showCounts = (k) => {
      vHead?.sub(["在读 " + k.active, k.paused && "暂停 " + k.paused, k.archived && "归档 " + k.archived].filter(Boolean).join(" · "));
      for (const b of c.querySelectorAll(".v-filter-chip[data-count-key]")) {
        const v = k[b.dataset.countKey];
        if (v === undefined || v === null) continue;
        const tag = b.querySelector(".v-chip-count") || b.appendChild(n("span", "", { class: "v-chip-count" }));
        tag.textContent = String(v);
      }
    };
    if (sState.counts && sState.countsSeq === apiWriteSeq) showCounts(sState.counts);
    else void countsRequest.then(showCounts, () => {});
    const acts = [];
    if (enabled("exports", "export") && !phone()) acts.push(button("导出", () => exportLink("students").click()));
    if (enabled("students", "create") && !phone())
      acts.push(button("＋ 新建学员", () => recordForm(sink(() => render(c, true)), "students"), "primary"));
    vHead?.actions(...acts);
    const list = studentList(c, id || (!phone() && sState.items[0]?.id));
    if (phone()) {
      c.replaceChildren(list);
      c.dataset.page = "students";
      return;
    }
    const pick = id || sState.items[0]?.id;
    const split = n("div", null, { class: "v-split" });
    split.append(list);
    // 先显示列表，右侧详情随后补上（不必等详情一起回来）。
    const holder = n("div", pick ? "正在载入学员详情…" : "左侧选择一位学员查看详情。", { class: "v-panel v-muted v-pad v-detail-holder" });
    split.append(holder);
    c.replaceChildren(split);
    c.dataset.page = "students";
    // 电脑端：换学员、换分页只替换右侧详情（见 app.js render 的 __soft）。
    if (c.classList?.contains("ui-page-body"))
      c.__soft = (key) => {
        if (phone() || !c.querySelector(":scope > .v-split")) return false;
        const r = R().parseStudentHash(key);
        if (!r) return false;
        swapDetail(c, r[0], r[1]);
        return true;
      };
    if (pick) await swapDetail(c, pick, tab);
  }
  let detailSeq = 0;
  async function swapDetail(c, id, tab) {
    const split = c.querySelector(":scope > .v-split");
    const seq = ++detailSeq;
    const old = split.querySelector(":scope > .v-detail, :scope > .v-panel.v-muted");
    old?.classList.add("is-loading");
    old?.setAttribute("aria-busy", "true");
    for (const r of split.querySelectorAll(".v-list-row")) {
      const on = r.dataset.id === id;
      r.classList.toggle("is-on", on);
      on ? r.setAttribute("aria-current", "true") : r.removeAttribute("aria-current");
    }
    try {
      const view = (await studentDetailView(c, id, tab, false)).wrap;
      if (seq !== detailSeq || !split.isConnected) return;
      if (old?.isConnected) old.replaceWith(view);
      else split.append(view);
    } catch (e) {
      if (seq !== detailSeq) return;
      old?.classList.remove("is-loading");
      old?.removeAttribute("aria-busy");
      notice(e.message);
    }
  }
  // 筛选、搜索、加载更多：只替换左侧列表；搜索框原样保留（不丢输入焦点）。
  let listSeq = 0;
  async function refreshList(c) {
    const split = c.querySelector(":scope > .v-split");
    const oldList = split?.querySelector(":scope > .v-list");
    if (phone() || !oldList) return render(c);
    const seq = ++listSeq;
    oldList.querySelector(".v-list-rows")?.classList.add("is-loading");
    try {
      await loadStudents();
    } catch (e) {
      oldList.querySelector(".v-list-rows")?.classList.remove("is-loading");
      return notice(e.message);
    }
    if (seq !== listSeq || !oldList.isConnected) return;
    const route = R().parseStudentHash(location.hash.slice(1));
    const shown = split.querySelector(":scope > .v-detail")?.dataset.id;
    const pick = route?.[0] || sState.items[0]?.id;
    // 搜索框和筛选按钮原地不动（移动元素会丢失输入焦点），只换下面的名单和页脚。
    const fresh = studentList(c, route?.[0] || shown || pick);
    oldList.querySelector(".v-list-rows").replaceWith(fresh.querySelector(".v-list-rows"));
    const foot = fresh.querySelector(".v-list-foot");
    if (foot) oldList.querySelector(".v-list-foot")?.replaceWith(foot);
    // 没有指定学员时，右侧跟随列表第一位。
    if (!route && pick && pick !== shown) swapDetail(c, pick, "overview");
  }
  // 学员列表的原入口（手动排序抽屉）仍用 legacy 版本；这里只替换页面。
  const legacyStudents = studentsPage;
  studentsPage = async (c, ...args) => {
    if (!c.isConnected) {
      // 原表单保存后刷新到不挂载的容器：只打个标记，交给 sink 回调。
      c.replaceChildren(n("span"));
      return;
    }
    if (c.closest(".ui-sheet")) return legacyStudents(c, ...args);
    return render(c);
  };
  if (globalThis.ChannelRebuild)
    globalThis.ChannelRebuild.studentDetail = (c) => render(c);

  // ---------- 教师 ----------
  const tState = { q: "", subject: "", selected: null, seq: 0, data: null, shared: {} };
  const subjectsOf = (t) => {
    try {
      return JSON.parse(t.subjects || "[]");
    } catch {
      return [];
    }
  };
  const EMPLOY = { full_time: "全职", part_time: "兼职" };
  // reuse=true：同一次访问里的筛选、搜索、点选老师，复用已取回的名单和课表，只补取所选老师的资料。
  async function teachersView(c, reuse) {
    let data = reuse && tState.data;
    const oldDetail = reuse ? c.querySelector(":scope > .v-split > .v-detail") : null;
    oldDetail?.classList.add("is-loading");
    if (!data) {
      const day = todayBJ(),
        from = weekStart(day),
        to = dateShift(from, 7),
        monthFrom = day.slice(0, 8) + "01",
        start = monthFrom < from ? monthFrom : from;
      const [rows, lessons] = await Promise.all([
        api("c3/teachers").then((d) => d.items || []),
        enabled("schedule")
          ? api("schedule?from=" + start + "&to=" + to).then((d) => d.items || []).catch(() => [])
          : [],
      ]);
      data = tState.data = { rows, lessons, from, monthFrom };
      tState.shared = {};
    }
    const { rows, lessons, from, monthFrom } = data;
    const active = rows.filter((t) => t.status === "active");
    const weekTotal = lessons.filter((l) => l.start_at.slice(0, 10) >= from).length;
    vHead?.sub(
      "在职 " + active.length + " · 离职 " + (rows.length - active.length) + (enabled("schedule") ? " · 本周共 " + weekTotal + " 节" : ""),
    );
    const acts = [];
    if (enabled("settings", "create") && !phone())
      acts.push(button("＋ 新建教师", () => recordForm(sink(() => teachersView(c)), "teachers"), "primary"));
    vHead?.actions(...acts);

    const subjects = [...new Set(rows.flatMap(subjectsOf))];
    const q = tState.q.toLowerCase();
    const shown = rows
      .filter(
        (t) =>
          (!q || (t.name + (t.course_names || "") + subjectsOf(t).join("")).toLowerCase().includes(q)) &&
          (!tState.subject || subjectsOf(t).includes(tState.subject)),
      )
      .sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1));
    if (!shown.some((t) => t.id === tState.selected)) tState.selected = phone() ? null : shown[0]?.id || null;

    const list = n("section", null, { class: "v-list" }),
      head = n("div", null, { class: "v-list-head" }),
      search = n("input", null, { type: "search", class: "v-list-search", placeholder: "姓名、科目", "aria-label": "搜索教师" });
    search.value = tState.q;
    let timer;
    search.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        tState.q = search.value.trim();
        teachersView(c, true);
      }, 300);
    });
    const chips = n("div", null, { class: "v-filter-chips", role: "group", "aria-label": "科目" });
    for (const s of ["", ...subjects]) {
      const b = n("button", s || "全部科目", {
        type: "button",
        class: "v-filter-chip" + (tState.subject === s ? " is-on" : ""),
        "aria-pressed": String(tState.subject === s),
      });
      b.addEventListener("click", () => {
        tState.subject = s;
        for (const x of chips.children) {
          x.classList.toggle("is-on", x === b);
          x.setAttribute("aria-pressed", String(x === b));
        }
        teachersView(c, true);
      });
      chips.append(b);
    }
    head.append(search, chips);
    const listRows = n("div", null, { class: "v-list-rows" });
    for (const t of shown) {
      const item = n("button", null, { type: "button", class: "v-list-row" + (t.id === tState.selected ? " is-on" : "") + (t.status === "active" ? "" : " is-gone") });
      const who = n("span", null, { class: "v-list-main" });
      who.append(
        n("strong", t.name),
        n(
          "span",
          [subjectsOf(t).join(" · ") || t.course_names, t.status === "active" ? EMPLOY[t.employment] : "已离职"].filter(Boolean).join(" · "),
          { class: "v-list-sub" },
        ),
      );
      const tail = n("span", null, { class: "v-list-tail v-list-count" });
      tail.append(n("strong", String(t.week_count ?? 0)), " 节", n("small", "本周"));
      item.append(avatar(t.name), who, tail);
      item.addEventListener("click", () => {
        tState.selected = t.id;
        for (const x of listRows.querySelectorAll(".v-list-row")) x.classList.toggle("is-on", x === item);
        teachersView(c, true);
      });
      listRows.append(item);
    }
    if (!shown.length) listRows.append(n("p", "没有符合条件的教师。", { class: "v-list-empty" }));
    list.append(head, listRows);

    const picked = rows.find((t) => t.id === tState.selected);
    if (phone() && picked) {
      const d = await teacherDetail(c, picked, lessons, { from, monthFrom });
      d.prepend(
        backRow("教师", () => {
          tState.selected = null;
          teachersView(c, true);
        }),
      );
      c.replaceChildren(d);
      return;
    }
    if (phone()) {
      c.replaceChildren(list);
      return;
    }
    const seq = ++tState.seq;
    const split = n("div", null, { class: "v-split" });
    if (!reuse) {
      // 首次进入：先显示列表，详情随后补上。
      split.append(list, n("div", picked ? "正在载入教师详情…" : "还没有教师。", { class: "v-panel v-muted v-pad v-detail-holder" }));
      c.replaceChildren(split);
      c.dataset.page = "teachers";
      if (!picked) return;
      const d = await teacherDetail(c, picked, lessons, { from, monthFrom });
      if (seq === tState.seq && split.isConnected) split.lastElementChild.replaceWith(d);
      return;
    }
    // 同一次访问内：搜索框和科目按钮原地不动（不丢输入焦点），先换名单，再换右侧详情。
    const oldSplit = c.querySelector(":scope > .v-split");
    if (oldSplit) {
      oldSplit.querySelector(":scope > .v-list .v-list-rows")?.replaceWith(listRows);
      const detail = picked ? await teacherDetail(c, picked, lessons, { from, monthFrom }) : n("div", "没有符合条件的教师。", { class: "v-panel v-muted v-pad" });
      if (seq !== tState.seq || !oldSplit.isConnected) return; // 已经点了别的老师
      oldSplit.lastElementChild.replaceWith(detail);
      return;
    }
    split.append(list, picked ? await teacherDetail(c, picked, lessons, { from, monthFrom }) : n("div", "还没有教师。", { class: "v-panel v-muted v-pad" }));
    if (seq !== tState.seq) return;
    c.replaceChildren(split);
    c.dataset.page = "teachers";
  }

  async function teacherDetail(c, t, lessons, { from, monthFrom }) {
    const again = () => teachersView(c);
    const [rec, rates, pay, students] = await Promise.all([
      api("data/teachers/" + encodeURIComponent(t.id)).then((d) => d.record).catch(() => t),
      enabled("teacher_pay")
        ? (tState.shared.rates ??= R().take("finance/rates"))
            .then((r) => r.filter((x) => x.teacher_id === t.id))
            .catch(() => null)
        : null,
      enabled("teacher_pay")
        ? api("finance/payroll?month=" + todayBJ().slice(0, 7) + "&teacher_id=" + encodeURIComponent(t.id))
            .then((d) => (d.items || []).find((x) => x.teacher_id === t.id) || null)
            .catch(() => null)
        : null,
      enabled("students")
        ? (tState.shared.students ??= R().take("c2/students?status=active"))
            .then((r) => r.filter((s) => (s.teacher_names || "").split(",").includes(t.name)))
            .catch(() => null)
        : null,
    ]);
    const mine = lessons.filter((l) => l.teacher_id === t.id || l.assistant_id === t.id);
    const week = mine.filter((l) => l.start_at.slice(0, 10) >= from);
    const monthDone = mine.filter((l) => l.start_at.slice(0, 10) >= monthFrom && l.status === "completed");
    const late = week.filter((l) => V().overdue(l));
    const wrap = n("div", null, { class: "v-detail" });

    const head = n("section", null, { class: "v-detail-head v-panel" }),
      title = n("div", null, { class: "v-detail-title" }),
      line = n("div", null, { class: "v-detail-name" });
    line.append(n("h2", t.name), chip(t.status === "active" ? "在职" : "已离职", t.status === "active" ? "ok" : "muted"));
    for (const s of subjectsOf(t)) line.append(chip(s, "info"));
    if (EMPLOY[t.employment]) line.append(chip(EMPLOY[t.employment], "muted"));
    if (rec.show_in_timetable === 0) line.append(chip("不在对外课表图显示", "warn"));
    const sub = n("p", null, { class: "v-detail-sub v-csegs" });
    if (rec.phone) {
      const no = n("span", rec.phone, { class: "v-num" }),
        part = n("span", "手机 ", { class: "v-cseg" });
      part.append(no);
      sub.append(part);
      if (enabled("accounts", "reveal_phone")) {
        const show = link("显示号码", async () => {
          const r = await api("data/teachers/" + t.id + "/contact", "POST", {});
          no.textContent = r.phone || "未填";
          show.remove();
        });
        sub.append(show);
      }
    }
    sub.append(n("span", rec.account_id ? "教师账号已开通 · 可自助提交点名" : "未开通教师账号", { class: "v-cseg" }));
    title.append(line, sub);
    const ops = n("div", null, { class: "v-detail-ops" });
    if (enabled("settings", "update")) ops.append(button("编辑资料", () => recordForm(sink(again), "teachers", unmask(rec))));
    if (enabled("exports", "export") && enabled("schedule"))
      ops.append(
        button("导出课表图", async () => {
          const view = UI.drawer({ title: t.name + " · 本周课表图" });
          await timetableImage(view.body, from, "teacher_id=" + encodeURIComponent(t.id));
        }),
      );
    if (enabled("schedule", "create") && t.status === "active")
      ops.append(button("给他排课", () => lessonForm(sink(again), { teacher_id: t.id }), "primary"));
    const more = [];
    if (!rec.account_id && enabled("accounts", "create_personal"))
      more.push({ label: "开通教师账号", onSelect: () => personalAccount("teachers", rec) });
    if (enabled("settings", "delete"))
      more.push({
        label: "删除教师",
        danger: true,
        onSelect: async () => {
          if (await UI.confirm({ title: "删除教师？", consequence: "有关联课程时将被拒绝；保留历史可改为离职。", danger: true })) {
            await api("data/teachers/" + t.id, "DELETE", { version: t.version });
            tState.selected = null;
            await again();
          }
        },
      });
    if (more.length) ops.append(UI.actionMenu({ label: "更多", items: more }).element);
    head.append(avatar(t.name, "is-big"), title, ops);
    wrap.append(head);

    wrap.append(
      kpis([
        enabled("schedule") &&
          kpi(
            "本周课",
            week.length + " 节",
            "已上 " + week.filter((l) => l.status === "completed").length + (late.length ? " · 待点名 " + late.length : ""),
          ),
        enabled("schedule") && kpi("本月已上", (pay ? pay.lesson_count : monthDone.length) + " 节", monthFrom.slice(5) + " 起，已销课"),
        students && kpi("负责学生", students.length + " 人", students.length ? "按接下来的排课统计" : "接下来没有排课"),
        pay &&
          kpi(
            "本月课酬",
            F.money(pay.total_amount),
            (pay.confirmation_status === "confirmed" ? "已确认" : "未结算") + " · 已付 " + F.money(pay.paid_amount || 0),
            "money",
          ),
      ]),
    );

    const grid = n("div", null, { class: "v-detail-grid" });
    if (enabled("schedule")) {
      const box = panel("本周课表", [
        n("span", null, { class: "v-spacer" }),
        link("在课表里按教师查看", () => (location.hash = "schedule-week")),
      ]);
      for (const l of week.sort((a, b) => a.start_at.localeCompare(b.start_at))) {
        const r = n("button", null, { type: "button", class: "v-week-line" });
        const who = n("span", null, { class: "v-week-who" });
        who.append(n("strong", V().person(l)), n("span", " · " + (l.location_name || "未指定教室"), { class: "v-muted" }));
        const st =
          l.status === "completed"
            ? chip("已上", "ok")
            : V().overdue(l)
              ? chip("待点名", "warn")
              : l.status === "planned"
                ? chip("待上", "info")
                : chip(me.labels.lessons?.[l.status] || "已取消", "muted");
        r.append(n("span", dayLabel(l.start_at), { class: "v-muted" }), n("strong", F.time(l.start_at)), who, st);
        r.addEventListener("click", () => lessonDetail(c, l));
        box.append(r);
      }
      if (!week.length) box.append(n("p", "本周没有课。", { class: "v-muted v-pad" }));
      grid.append(box);
    }
    const side = n("div", null, { class: "v-detail-side" });
    if (rates) {
      const box = panel("课酬标准", [
        n("span", null, { class: "v-spacer" }),
        enabled("teacher_pay", "create") && link("全部课酬标准", () => vHead?.navigate?.("teachers-rates")),
      ]);
      const today = todayBJ();
      const current = rates.filter((r) => r.effective_from <= today && (!r.effective_to || r.effective_to >= today));
      for (const r of current) {
        const lineR = n("div", null, { class: "v-rate" });
        lineR.append(
          n("span", (r.course_name || "全部课程") + (r.format === "group" && !/班/.test(r.course_name || "") ? " · 小班" : "") + " · 按节"),
          n("strong", F.money(r.rate) + " / 节"),
        );
        box.append(lineR);
      }
      box.append(
        n(
          "p",
          current.length ? "当前生效 · 改价时填生效日，从那天起算，不影响已锁定月份" : "还没有设置课酬标准。",
          { class: "v-muted v-small" },
        ),
      );
      side.append(box);
    }
    if (students) {
      const box = panel("负责的学生 · " + students.length + " 人");
      const tags = n("div", null, { class: "v-tags" });
      for (const s of students) {
        const b = n("button", s.name, { type: "button", class: "v-tag" });
        b.addEventListener("click", () => R().goStudent(s.id));
        tags.append(b);
      }
      if (!students.length) tags.append(n("p", "接下来没有排到这位老师的学员。", { class: "v-muted" }));
      box.append(tags);
      side.append(box);
    }
    grid.append(side);
    wrap.append(grid);
    return wrap;
  }

  const previousRecords = recordsPage;
  recordsPage = async (c, resource, ...args) => {
    if (resource !== "teachers" || c.closest(".ui-sheet")) return previousRecords(c, resource, ...args);
    if (!c.isConnected) {
      c.replaceChildren(n("span"));
      return;
    }
    return teachersView(c);
  };

  // ---------- 教师 · 课酬标准（原来是整页旧表格，现在是教师页的第二个分页） ----------
  // 按老师分组；“不限”日期写“长期”；新增/修改沿用原课酬表单与原写入接口。
  const rState2 = { q: "", all: false };
  async function ratesPage(c) {
    const rates = await api("finance/rates").then((d) => d.items || []);
    const again = () => ratesPage(c);
    const today = todayBJ();
    const open = (d) => !d || d >= "2099-01-01";
    const start = (d) => !d || d <= "1901-01-01";
    const span = (r) =>
      start(r.effective_from) && open(r.effective_to)
        ? "长期"
        : (start(r.effective_from) ? "" : r.effective_from + " 起") + (open(r.effective_to) ? (start(r.effective_from) ? "" : " · 长期") : " 至 " + r.effective_to);
    const live = (r) => (start(r.effective_from) || r.effective_from <= today) && (open(r.effective_to) || r.effective_to >= today);
    const search = n("input", null, { type: "search", class: "ui-control v-rate-search", placeholder: "老师或课程", "aria-label": "搜索老师或课程" });
    search.value = rState2.q;
    const scope = n("div", null, { class: "v-inner-tabs", role: "group", "aria-label": "范围" });
    for (const [v, t] of [[false, "当前生效"], [true, "全部（含已结束）"]]) {
      const b = button(t, () => {
        rState2.all = v;
        return again();
      });
      b.setAttribute("aria-current", rState2.all === v ? "page" : "false");
      scope.append(b);
    }
    vHead?.bar(search, scope);
    vHead?.actions(
      enabled("teacher_pay", "create") ? button("＋ 新增课酬标准", () => financeRecordForm(sink(again), "rates"), "primary") : null,
    );
    const body = n("div", null, { class: "v-rates" });
    const draw = () => {
      const q = rState2.q.trim();
      const rows = rates.filter((r) => (rState2.all || live(r)) && (!q || (r.teacher_name + " " + r.course_name).includes(q)));
      const byTeacher = new Map();
      for (const r of rows) {
        if (!byTeacher.has(r.teacher_id)) byTeacher.set(r.teacher_id, []);
        byTeacher.get(r.teacher_id).push(r);
      }
      body.replaceChildren();
      const names = [...byTeacher.values()].sort((a, b) => String(a[0].teacher_name).localeCompare(String(b[0].teacher_name), "zh-CN"));
      for (const list of names) {
        const box = n("section", null, { class: "v-rate-card" });
        const head = n("header");
        head.append(avatar(list[0].teacher_name), n("strong", list[0].teacher_name || "未知老师"), n("span", list.length + " 条", { class: "v-muted" }));
        box.append(head);
        for (const r of list.sort((a, b) => String(a.course_name).localeCompare(String(b.course_name), "zh-CN"))) {
          const line = n("div", null, { class: "v-rate-row" + (live(r) ? "" : " is-old") });
          line.append(
            n("span", r.course_name || "全部课程", { class: "v-rate-course" }),
            n("span", { individual: "一对一", group: "小班", class: "集训班" }[r.format] || "", { class: "v-muted" }),
            n("strong", F.money(r.rate) + " / " + (me.labels.rate_units?.[r.rate_basis] || "课时")),
            n("span", span(r), { class: "v-muted" }),
          );
          const acts = n("span", null, { class: "v-rate-acts" });
          if (enabled("teacher_pay", "update")) acts.append(link("修改", () => financeRecordForm(sink(again), "rates", r)));
          if (enabled("teacher_pay", "delete"))
            acts.append(
              UI.actionMenu({
                items: [
                  {
                    label: "删除",
                    danger: true,
                    onSelect: async () => {
                      if (!(await UI.confirm({ title: "删除这条课酬标准？", consequence: "已锁定月份的课酬不受影响；未锁定月份会按剩下的标准重算。", danger: true }))) return;
                      await api("finance/rates/" + r.id, "DELETE", { version: r.version });
                      await again();
                    },
                  },
                ],
              }).element,
            );
          line.append(acts);
          box.append(line);
        }
        body.append(box);
      }
      if (!body.children.length) body.append(UI.empty({ text: q ? "没有匹配的课酬标准。" : "还没有设置课酬标准。" }));
    };
    search.addEventListener("input", () => {
      rState2.q = search.value;
      draw();
    });
    draw();
    c.replaceChildren(
      n("p", "改价时新增一条并填生效日，从那天起按新价计算；已锁定的月份不受影响。", { class: "v-muted v-rate-note" }),
      body,
    );
  }

  if (typeof pageHooks !== "undefined") pageHooks.rates = ratesPage;
  globalThis.ChannelV2People = { studentsRender: render, teachersView, kpi, kpis, avatar, sink, dayLabel, backRow, ratesPage };
})();
