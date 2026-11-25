// 第十阶段重构（v2）第 7 组：账号与权限、机构设置、操作记录（B8 筛选）。
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
  const old = { accounts, settingsPage, logs };
  const inPage = (c) => !!c?.closest?.(".v-content") && !c.closest(".ui-overlay, .ui-sheet, .v-detail");
  const supervisor = () => me.user.roles.includes("supervisor");
  const ROLE = { supervisor: ["主管", "info"], consultant: ["顾问", "info"], academic: ["教务", "info"], finance: ["财务", "info"], teacher: ["教师", "muted"], student: ["学员", "muted"], parent: ["家长", "muted"] };
  function chips(items, current, onPick, label) {
    const box = n("div", null, { class: "v-filter-chips", role: "group", "aria-label": label });
    for (const [key, text, count] of items) {
      const on = current === key;
      const b = n("button", text, { type: "button", class: "v-filter-chip" + (on ? " is-on" : ""), "aria-pressed": String(on) });
      if (count !== undefined && count !== null) b.append(n("span", String(count), { class: "v-chip-count" }));
      b.addEventListener("click", () => onPick(key));
      box.append(b);
    }
    return box;
  }
  function vtable(cols, rows, empty) {
    if (!rows.length) return UI.empty({ text: empty });
    const wrap = n("div", null, { class: "v-renew-table panel v-fin-table" }),
      t = n("table", null, { class: "v-table" }),
      hr = n("tr"),
      thead = n("thead"),
      tbody = n("tbody");
    for (const col of cols) hr.append(n("th", col.label, { class: col.cls || "" }));
    thead.append(hr);
    for (const r of rows) {
      const tr = n("tr");
      for (const col of cols) {
        const td = n("td", null, { class: col.cls || "", "data-label": col.label });
        td.append(col.value(r) ?? "");
        tr.append(td);
      }
      if (cols.rowAction) {
        tr.classList.add("is-click");
        tr.addEventListener("click", (e) => {
          if (!e.target.closest("button, a, input")) cols.rowAction(r);
        });
      }
      tbody.append(tr);
    }
    t.append(thead, tbody);
    wrap.append(t);
    return wrap;
  }

  // ---------- 账号与权限 ----------
  const aState = { role: "" };
  async function accountsV(c, offset = 0) {
    const data = await api("accounts?offset=" + offset);
    const items = data.items;
    const again = () => accountsV(c, offset);
    const staff = items.filter((u) => u.roles.some((r) => ["supervisor", "consultant", "academic", "finance"].includes(r))).length,
      students = items.filter((u) => u.roles.includes("student")).length;
    vHead?.sub(data.total > items.length ? "共 " + data.total + " 个账号" : "员工账号 " + staff + " / " + me.limits.staff + " · 学员账号 " + students + " / " + me.limits.student);
    vHead?.actions(
      supervisor() ? button("＋ 新建员工账号", () => newAccount(P().sink(again)), "primary") : null,
    );
    c.replaceChildren();
    const count = (role) => items.filter((u) => !role || u.roles.includes(role)).length;
    c.append(
      chips(
        [["", "全部", count("")], ...Object.entries(ROLE).filter(([k]) => count(k)).map(([k, [t]]) => [k, t, count(k)])],
        aState.role,
        (k) => {
          aState.role = k;
          void accountsV(c, offset);
        },
        "按角色",
      ),
    );
    const shown = items.filter((u) => !aState.role || u.roles.includes(aState.role));
    const cols = [
      { label: "姓名", value: (u) => n("strong", u.name) },
      { label: "登录手机", value: (u) => n("span", u.phone || "—", { class: "v-num" }) },
      {
        label: "角色",
        value: (u) => {
          const w = n("span", null, { class: "v-lead-tags" });
          for (const r of u.roles) w.append(chip(ROLE[r]?.[0] || r, ROLE[r]?.[1] || "muted"));
          return w;
        },
      },
      {
        label: "关联档案",
        value: (u) => {
          if (u.teacher_id) return link("教师档案", () => (location.hash = "settings-teachers"));
          if (u.student_id) return link("学员档案", () => R().goStudent(u.student_id));
          return n("span", "—", { class: "v-muted" });
        },
      },
      {
        label: "状态",
        value: (u) => (u.active === false ? chip("已停用", "muted") : u.must_change ? chip("待改密码", "warn") : chip("正常", "ok")),
      },
      {
        label: "",
        cls: "is-act",
        value: (u) => {
          const w = n("span", null, { class: "v-renew-acts" });
          const own = u.roles.includes("supervisor");
          const personal = u.roles.some((x) => ["teacher", "student"].includes(x));
          if (!own && (supervisor() || personal)) w.append(link("编辑", () => editAccount(P().sink(again), u)));
          const more = [
            { label: "登录设备", onSelect: () => devices(u.id) },
            {
              label: "查看完整号码（会记录）",
              onSelect: async () => notice((await api("accounts/" + u.id + "/phone", "POST", {})).phone + "（已记录查看操作）", "success"),
            },
          ];
          if (!own)
            more.push({
              label: "重置密码",
              danger: true,
              onSelect: async () => {
                if (!(await UI.confirm({ title: "重置 " + u.name + " 的密码？", consequence: "这个账号所有设备会立即下线，新初始密码只显示一次。", danger: true }))) return;
                showSecret(await api("accounts/" + u.id + "/reset-password", "POST", {}));
                await again();
              },
            });
          w.append(UI.actionMenu({ items: more }).element);
          return w;
        },
      },
    ];
    const grid = n("div", null, { class: "v-ac-grid" });
    grid.append(vtable(cols, shown, "这个角色还没有账号。"));
    const side = V().panel("说明");
    for (const t of [
      "教师和学员账号在对应档案的详情页里开通（学员详情 › 更多 › 开通账号）。",
      "编辑、停用或重置密码后，这个账号会被要求重新登录。",
      "教务、财务能做什么，在上方“角色权限”分页里整张表调整；保存后本机构所有在线账号会重新登录。",
      "教师端、学员端能看到什么（课时余额、缴费记录、自助销课），在“机构设置 › 教师与学员端”里开关。",
    ])
      side.append(n("p", t, { class: "v-ac-note" }));
    const go = link("去机构设置 →", () => {
      iState.section = "personal";
      location.hash = "settings-institution";
    });
    side.append(go);
    grid.append(side);
    c.append(grid);
    if (data.next_offset !== null && data.next_offset !== undefined)
      c.append(button("下一页", () => accountsV(c, data.next_offset)));
  }
  // ---------- 账号与权限 · 角色权限（整张表一眼看清，勾选后一次保存） ----------
  // 默认权限与服务端 permissions.js 的 defaults 一致（测试逐项比对）；机构自定义项来自 me.policy.rights。
  const RIGHT_DEFAULTS = {
    academic: {
      classes: ["read", "create", "update", "delete"],
      leads: ["read", "create", "update", "delete"],
      referrals: ["read", "create", "update"],
      imports: ["read", "create"],
      home: ["read"],
      schedule: ["read", "create", "update", "export"],
      templates: ["read", "create", "update", "export"],
      lessons: ["read", "create", "update", "export"],
      attendance: ["read", "create", "update", "export"],
      students: ["read", "create", "update", "export"],
      followup: ["read", "create", "update", "export"],
      packages: ["read", "create", "update", "export"],
      reports: ["read"],
      exports: ["read", "export"],
      settings: ["read"],
      comments: ["read", "update"],
      promo: ["read", "create", "update"],
    },
    finance: {
      home: ["read"],
      schedule: ["read"],
      templates: ["read"],
      lessons: ["read"],
      attendance: ["read"],
      students: ["read"],
      packages: ["read", "create", "update", "approve", "adjust", "transfer"],
      tuition: ["read", "create", "update", "approve", "export"],
      teacher_pay: ["read", "create", "update", "approve", "export"],
      settlements: ["read", "create", "update", "submit"],
      reports: ["read"],
      exports: ["read", "export"],
      settings: ["read", "rates_update"],
    },
  };
  const STD = ["read", "create", "update", "delete"];
  const RIGHT_ROWS = [
    ["日常教务", [
      ["schedule", "课表与排课", STD],
      ["templates", "固定排课", STD],
      ["attendance", "点名销课", STD],
      ["students", "学员档案", STD],
      ["followup", "跟进任务", STD],
      ["classes", "班级", STD],
      ["comments", "课后点评", ["read", "update"]],
    ]],
    ["招生", [
      ["leads", "招生线索", STD],
      ["promo", "推广中心", ["read", "create", "update"]],
    ]],
    ["财务", [
      ["packages", "课时包", [...STD, "adjust", "transfer"]],
      ["tuition", "收款", [...STD, "export"]],
      ["teacher_pay", "课酬与结算", [...STD, "export"]],
      ["settlements", "其他成本", STD],
      ["reports", "报表", ["read"]],
    ]],
    ["机构管理", [
      ["settings", "课程、教室与设置", STD],
      ["imports", "数据导入", ["read", "create"]],
      ["exports", "导出文件", ["read", "export"]],
    ]],
  ];
  const ACT = { read: "查看", create: "新增", update: "修改", delete: "删除", export: "导出", adjust: "调课时", transfer: "转课时" };
  const rgState = { pending: new Map() };
  const rightKey = (role, module, action) => role + "|" + module + "|" + action;
  const baseRight = (role, module, action) => {
    const custom = (me.policy.rights || []).find((r) => r.role === role && r.module === module && r.action === action);
    return custom ? !!custom.allowed : !!RIGHT_DEFAULTS[role]?.[module]?.includes(action);
  };
  function rightsPage(c) {
    vHead?.sub("机构主管拥有全部权限，不在表里");
    const draw = () => {
      const pending = rgState.pending;
      vHead?.actions(
        pending.size ? button("撤销修改", () => (pending.clear(), draw())) : null,
        UI.button(pending.size ? "保存 " + pending.size + " 项修改" : "保存修改", {
          kind: "primary",
          disabled: !pending.size,
          onClick: async () => {
            const changes = [...pending.values()];
            if (!(await UI.confirm({ title: "保存 " + changes.length + " 项权限修改？", consequence: "保存后本机构所有在线账号会立即重新登录，包括你自己。", danger: true }))) return;
            // 一项沿用原接口；多项一次提交（服务端整批校验、只让大家重新登录一次）。
            if (changes.length === 1) await api("rights", "PUT", changes[0]);
            else await api("rights", "PUT", { changes });
            location.assign(base + "login");
          },
        }),
      );
      c.replaceChildren();
      const grid = n("div", null, { class: "v-rg" });
      const wrap = n("div", null, { class: "v-rg-table panel" });
      const table = n("table");
      const head = n("tr");
      head.append(n("th", "功能"), n("th", "教务"), n("th", "财务"));
      const thead = n("thead");
      thead.append(head);
      table.append(thead);
      const tbody = n("tbody");
      for (const [group, rows] of RIGHT_ROWS) {
        const gr = n("tr", null, { class: "v-rg-group" });
        gr.append(n("th", group, { colspan: "3", scope: "colgroup" }));
        tbody.append(gr);
        for (const [module, label, actions] of rows) {
          if (me.policy.modules?.[module] === false) continue;
          const tr = n("tr");
          tr.append(n("th", label, { scope: "row" }));
          for (const role of ["academic", "finance"]) {
            const td = n("td");
            // 推广中心只对主管和教务开放（服务端固定规则），财务一栏不给勾选。
            if (module === "promo" && role === "finance") {
              td.append(n("span", "不适用", { class: "v-muted v-small" }));
              tr.append(td);
              continue;
            }
            const cells = n("div", null, { class: "v-rg-cells" });
            for (const action of actions) {
              const key = rightKey(role, module, action);
              const base0 = baseRight(role, module, action);
              const value = pending.has(key) ? pending.get(key).allowed : base0;
              const box = n("label", null, { class: "v-rg-cell" + (pending.has(key) ? " is-changed" : "") });
              const input = n("input", null, { type: "checkbox", "aria-label": (role === "academic" ? "教务" : "财务") + " · " + label + " · " + ACT[action] });
              input.checked = value;
              input.addEventListener("change", () => {
                if (input.checked === base0) pending.delete(key);
                else pending.set(key, { role, module, action, allowed: input.checked });
                draw();
              });
              box.append(input, n("span", ACT[action]));
              cells.append(box);
            }
            td.append(cells);
            if (pending.size && [...pending.values()].some((p) => p.role === role && p.module === module)) td.classList.add("is-changed");
            tr.append(td);
          }
          tbody.append(tr);
        }
      }
      table.append(tbody);
      wrap.append(table);
      const side = n("aside", null, { class: "v-rg-side" });
      const legend = V().panel("怎么看");
      legend.append(
        n("p", "勾上＝这个角色可以做；不勾＝不能做。改过的格子会变成浅黄色，点“保存”才生效。", { class: "v-ac-note" }),
        n("p", "教师账号：默认只能看到自己的学生和自己的课（包括做助教的课），不能看别人的。这一条是固定的，不在表里调整。", { class: "v-ac-note" }),
        n("p", "学员账号：只能看到自己的课表、点评；课时余额和缴费记录在“机构设置 › 教师与学员端”里开关。", { class: "v-ac-note" }),
      );
      side.append(legend);
      if (pending.size) {
        const p = V().panel("未保存的修改 · " + pending.size + " 项");
        const labelOf = (m) => RIGHT_ROWS.flatMap((g) => g[1]).find((r) => r[0] === m)?.[1] || m;
        for (const ch of pending.values())
          p.append(n("p", (ch.role === "academic" ? "教务" : "财务") + " · " + labelOf(ch.module) + "：" + (ch.allowed ? "允许" : "取消") + "“" + ACT[ch.action] + "”", { class: "v-rg-change" }));
        p.append(n("p", "保存后本机构所有在线账号会重新登录。", { class: "v-muted v-small" }));
        side.append(p);
      }
      grid.append(wrap, side);
      c.append(grid);
    };
    draw();
  }


  // ---------- 数据导入导出 · 导出 ----------
  // 原来导出入口散落在各页；这里集中列出，按权限显示。下载沿用原 api/export 地址。
  function exportsPage(c) {
    let month = financeMonth;
    const picker = UI.monthPicker({
      value: month,
      onChange: (v) => {
        month = v;
        financeMonth = v;
        draw();
      },
    });
    vHead?.bar(picker.element);
    const list = [
      ["lessons", "课程记录", "这个月每节课的时间、老师、教室、状态", enabled("lessons")],
      ["packages", "课时包", "学员课时包、剩余课时（财务可见金额）", enabled("packages")],
      ["finance", "教师课酬", "这个月每位老师的课次、应发、已付", enabled("teacher_pay")],
      ["report", "经营报表", "确认收入、课酬、成本和利润", enabled("reports")],
      ["logs", "操作记录", "谁在什么时候做了什么", enabled("logs") || enabled("logs", "read_finance")],
    ].filter((x) => x[3] && enabled("exports", "export"));
    const grid = n("div", null, { class: "v-ex-grid" });
    const draw = () => {
      grid.replaceChildren();
      for (const [kind, title, desc] of list) {
        const card = n("section", null, { class: "v-ex-card" });
        const a = n("a", "下载 Excel", {
          class: "ui-button ui-button--primary v-ex-dl",
          href: base + "api/export?kind=" + kind + "&month=" + month,
          download: "",
        });
        card.append(n("h3", title), n("p", desc, { class: "v-muted" }), n("span", kind === "logs" ? "最近记录" : month.replace("-", " 年 ") + " 月", { class: "v-ex-month" }), a);
        grid.append(card);
      }
      if (!list.length) grid.append(UI.empty({ text: "你的账号没有导出权限。" }));
    };
    draw();
    c.replaceChildren(n("p", "导出文件只包含你有权查看的数据；下载会记录在操作记录里。", { class: "v-muted v-rate-note" }), grid);
  }

  // ---------- 机构设置 ----------
  const iState = { section: "brand" };
  const INST_BASE = [
    ["brand", "机构信息"],
    ["absence", "缺勤规则"],
    ["personal", "教师与学员端"],
    ["view", "课表默认视图"],
  ];
  async function institution(c, section) {
    // 艺界星途阶段 3：报价、阶段、日历、报告、档案、图库、修改卡片（见 yx-settings.js）。
    const INST = [...INST_BASE, ...(typeof yxSettingsSections === "function" ? yxSettingsSections() : [])];
    if (!section && globalThis.yxSettingsJump) {
      section = globalThis.yxSettingsJump;
      globalThis.yxSettingsJump = null;
    }
    if (section && typeof yxSettingsRoute === "function") section = yxSettingsRoute(section);
    if (section && INST.some((x) => x[0] === section)) iState.section = section;
    vHead?.actions();
    c.replaceChildren();
    const wrap = n("div", null, { class: "c3-settings" }),
      nav = n("nav", null, { "aria-label": "机构设置分类" }),
      body = n("section", null, { class: "v-set-body" });
    for (const [key, text] of INST) {
      const x = button(text, () => institution(c, key));
      x.setAttribute("aria-current", key === iState.section ? "page" : "false");
      nav.append(x);
    }
    wrap.append(nav, body);
    c.append(wrap);
    const head = n("div", null, { class: "v-set-head" });
    head.append(n("h2", INST.find((x) => x[0] === iState.section)[1]));
    body.append(head);
    if (typeof yxSettingsSection === "function" && (await yxSettingsSection(body, head, iState.section, () => institution(c, iState.section)))) return;
    if (iState.section === "brand") {
      const b = await api("renewal-brand");
      const card = n("div", null, { class: "v-panel v-brand-card" });
      const top = n("div", null, { class: "v-brand-top" });
      const logo = b.logo ? n("img", null, { src: b.logo, alt: "机构 Logo", class: "v-brand-logo" }) : n("span", Array.from(b.display_name || "教")[0], { class: "v-brand-logo is-text" });
      top.append(logo, n("strong", b.display_name || "未设置"));
      card.append(top);
      const rows = n("dl", null, { class: "v-brand-dl" });
      // 颜色用 SVG 的 fill 属性画（不用内联样式）。
      const sw = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      sw.setAttribute("viewBox", "0 0 16 16");
      sw.setAttribute("class", "v-brand-swatch");
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      for (const [k, v] of [["width", 16], ["height", 16], ["rx", 4], ["fill", /^#[0-9a-f]{6}$/i.test(b.theme_color || "") ? b.theme_color : "#2B4C7E"]]) rect.setAttribute(k, String(v));
      sw.append(rect);
      for (const [k, v] of [
        ["主题色", b.theme_color || "默认"],
        ["顾问二维码", b.consultant_qr ? "已上传" : "未上传"],
        ["联系说明", b.contact_text || "未填写"],
      ]) {
        rows.append(n("dt", k));
        const dd = n("dd", v);
        if (k === "主题色") dd.prepend(sw);
        rows.append(dd);
      }
      card.append(rows);
      if (b.consultant_qr) card.append(n("img", null, { src: b.consultant_qr, alt: "顾问二维码", class: "v-brand-qr" }));
      body.append(
        card,
        n("p", "这些信息会出现在登录页、课表图和续费提醒图片上。机构品牌信息由管理员统一维护，如需修改请联系管理员。主色和咨询二维码可以在下面自己改。", { class: "v-muted v-fin-note" }),
      );
      if (typeof yxsBrandEditor === "function") await yxsBrandEditor(body, () => institution(c, "brand"));
      return;
    }
    // 缺勤规则、教师与学员端、默认视图：沿用原页面的内容和保存方式，只换外框。
    const temp = n("div", null, { class: "v-content-temp" });
    await old.settingsPage(temp, iState.section);
    const inner = temp.querySelector(".c3-settings > section");
    if (inner) body.append(...inner.childNodes);
    const hint = {
      absence: "学员请假、旷课，教师请假，机构取消时，是否扣学员课时、是否给老师计课酬。修改只影响还没锁定的月份。",
      personal: "关掉的项目，服务器不再向教师或学员账号返回这些数据，不只是隐藏。",
      view: "打开“课表”时默认用哪种视图。每个人仍可以在课表页临时切换。",
    }[iState.section];
    if (hint) head.after(n("p", hint, { class: "v-muted v-set-hint" }));
  }

  // ---------- 操作记录（B8：按模块、动作筛选） ----------
  const lState = { kind: "audit", module: "", action: "", actor: "", from: "", to: "" };
  let logActors = null;
  const QUICK = [
    ["", "全部"],
    ["export", "只看导出"],
    ["delete", "只看删除"],
    ["reset_password", "只看重置密码"],
  ];
  async function logsV(c, offset = 0) {
    const q = new URLSearchParams({ kind: lState.kind, offset: String(offset) });
    for (const k of ["actor", "from", "to"]) if (lState[k]) q.set(k, lState[k]);
    if (lState.kind === "audit") for (const k of ["module", "action"]) if (lState[k]) q.set(k, lState[k]);
    const data = await api("logs?" + q);
    vHead?.actions();
    c.replaceChildren();
    const again = (o = 0) => logsV(c, o);
    // 操作记录 / 登录记录：和其他页面一样放在顶栏下那一行（原来是页面里一排小块）。
    const kindTabs = n("div", null, { class: "v-inner-tabs", role: "group", "aria-label": "记录类型" });
    for (const [k, label] of [
      ["audit", "操作记录"],
      ["login", "登录记录"],
    ]) {
      const b = button(label, () => {
        lState.kind = k;
        return again();
      });
      b.setAttribute("aria-current", k === lState.kind ? "page" : "false");
      kindTabs.append(b);
    }
    if (vHead?.bar) vHead.bar(kindTabs);
    else c.append(kindTabs);
    // 第二行：筛选
    const bar = n("div", null, { class: "v-fin-bar is-tools v-log-bar" });
    if (lState.kind === "audit") {
      bar.append(
        chips(QUICK, lState.action, (k) => {
          lState.action = k;
          void again();
        }, "按动作"),
        UI.selectControl({
          label: "模块",
          value: lState.module,
          options: [{ value: "", label: "全部模块" }, ...Object.entries(me.labels.modules).filter(([k]) => !["home", "profile"].includes(k)).map(([k, v]) => ({ value: k, label: v }))],
          onChange: (v) => {
            lState.module = v;
            return again();
          },
        }).element,
      );
    }
    // 操作人从账号名单里选（不用手打）；没有“账号”查看权限（例如财务）时不去请求，直接用输入框。
    if (!logActors && enabled("accounts"))
      logActors = await api("accounts?offset=0")
      .then((d) => [...new Set(d.items.map((u) => u.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")))
      .catch(() => null);
    let actor;
    if (logActors) {
      const names = [...logActors, "系统", "系统维护"];
      if (lState.actor && !names.includes(lState.actor)) names.unshift(lState.actor);
      actor = UI.selectControl({
        label: "操作人",
        value: lState.actor,
        options: [{ value: "", label: "全部操作人" }, ...names.map((x) => ({ value: x, label: x }))],
        onChange: (v) => {
          lState.actor = v;
          return again();
        },
      });
    } else {
      actor = UI.field({ label: "操作人", type: "search", value: lState.actor });
      actor.input.maxLength = 100;
      let t;
      actor.input.addEventListener("change", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          lState.actor = actor.input.value.trim();
          void again();
        }, 100);
      });
    }
    const range = n("div", null, { class: "v-log-range" });
    for (const [key, label] of [
      ["from", "开始日期"],
      ["to", "结束日期"],
    ]) {
      range.append(
        UI.datePicker({
          label,
          value: lState[key],
          allowEmpty: true,
          onChange: (v) => {
            lState[key] = v || "";
            return again();
          },
        }).element,
      );
    }
    bar.append(actor.element, range);
    if (lState.module || lState.action || lState.actor || lState.from || lState.to)
      bar.append(link("清除筛选", () => {
        Object.assign(lState, { module: "", action: "", actor: "", from: "", to: "" });
        return again();
      }));
    c.append(bar);
    // 同一人、同类操作、同一分钟合并（仅限已加载的这一页）。
    const grouped = new Map();
    for (const row of data.items) {
      const key = [row.actor_label || row.user_id, row.module, row.action || row.event, Math.floor(row.at / 60000)].join("|");
      if (!grouped.has(key)) grouped.set(key, { ...row, rows: [] });
      grouped.get(key).rows.push(row);
    }
    const rows = [...grouped.values()];
    const what = (r) =>
      (me.labels.modules[r.module] || (lState.kind === "login" ? "登录" : "其他")) +
      " · " +
      (me.labels.actions[r.action] || me.labels.events?.[r.event] || "操作") +
      (r.rows.length > 1 ? " " + r.rows.length + " 条" : "");
    const tone = (r) => (r.action === "delete" || r.action === "reset_password" ? "bad" : r.action === "export" || r.action === "download" ? "info" : "muted");
    const cols = [
      { label: "时间", value: (r) => n("span", F.date(r.at).slice(5) + " " + F.time(r.at), { class: "v-num" }) },
      { label: "操作人", value: (r) => r.actor_label || "本人登录账号" },
      { label: "动作", value: (r) => chip(what(r), tone(r)) },
      { label: "对象", value: (r) => (r.rows.length > 1 ? "多个对象" : r.summary || (lState.kind === "login" ? "登录会话" : "—")), cls: "v-fin-note-cell" },
    ];
    cols.rowAction = (r) => {
      const d = UI.drawer({ title: what(r), subtitle: (r.actor_label || "") + " · " + F.date(r.at) + " " + F.time(r.at) });
      for (const x of r.rows) {
        const p = V().panel(F.time(x.at) + " · " + (x.summary || ""));
        for (const key of ["before_json", "after_json"])
          if (x[key]) {
            const det = n("details");
            det.append(n("summary", key === "before_json" ? "修改前" : "修改后"), n("pre", JSON.stringify(JSON.parse(x[key]), null, 2), { class: "preserve-text v-log-pre" }));
            p.append(det);
          }
        d.body.append(p);
      }
    };
    c.append(vtable(cols, rows, lState.module || lState.action || lState.actor || lState.from || lState.to ? "没有符合筛选条件的记录。" : "还没有记录。"));
    const pager = n("div", null, { class: "v-fin-bar" });
    pager.append(n("span", "共 " + data.total + " 条" + (rows.length < data.items.length ? " · 同一人同一分钟的同类操作已合并" : ""), { class: "v-muted v-fin-cut" }));
    if (offset) pager.append(button("上一页", () => again(Math.max(0, offset - 200))));
    if (data.next_offset !== null && data.next_offset !== undefined) pager.append(button("下一页", () => again(data.next_offset)));
    c.append(pager);
  }

  // ---------- 挂到原入口 ----------
  accounts = (c, offset) => (inPage(c) ? accountsV(c, offset) : old.accounts(c, offset));
  settingsPage = (c, section) =>
    inPage(c) && location.hash === "#settings-institution" ? institution(c, section) : old.settingsPage(c, section);
  logs = (c, kind, offset) => (inPage(c) ? ((lState.kind = kind || lState.kind), logsV(c, offset || 0)) : old.logs(c, kind, offset));
  if (typeof pageHooks !== "undefined") {
    pageHooks.rights = rightsPage;
    pageHooks.exports = exportsPage;
  }
  globalThis.ChannelV2Admin = { accountsV, institution, logsV, rightsPage };
})();
