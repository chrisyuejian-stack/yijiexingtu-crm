// C3 presentation composition; all writes retain their original permission and audit paths.
(() => {
  const n = el,
    b = button,
    U = UI,
    F = fmt,
    R = globalThis.ChannelRebuild,
    { take, table, metric, tools, lessonPerson } = R;
  const old = {
    accounts,
    followupPage,
    recordsPage,
    creditPage,
    financeRecords,
    classesPage,
    importWizard,
    personalRecords,
    personalPay,
    leadForm,
    referralForm,
    promoCenter,
    staffTimetable,
    reviewScreen,
  };
  const tabs = (items) => {
    const p = U.page({ tabs: items });
    return p.element.querySelector("nav");
  };
  // 搜索框：带放大镜和提示文字，不再是一个空白框上面写“搜索”。
  const searchField = (fn, placeholder = "搜索姓名或课程") => {
    const x = U.field({ label: placeholder, type: "search" });
    x.input.placeholder = placeholder;
    x.element.classList.add("v-search-field");
    x.element.prepend(U.icon("search"));
    x.input.addEventListener("input", () => fn(x.input.value));
    return x.element;
  };
  const state = {
    leadView: "board",
    payTab: "received",
    packageStatus: "",
    q: "",
    logs: { actor: "", from: "", to: "" },
  };
  const amount = (key, label) => ({
    key,
    label,
    numeric: true,
    render: (r) => F.moneyCell(r[key]),
  });
  const clear = (c) => c.replaceChildren();
  const metrics = (c, rows) => {
    const box = n("div", null, { class: "c2-metrics" });
    for (const [label, value] of rows) {
      const card = metric(label, value),
        strong = card.querySelector("strong"),
        [main, note] = String(value).split(" · 另有 ");
      // “¥24,440 · 另有 8 笔待核对”：金额保持大字，补充说明降为小字，避免折行。
      if (strong && note) {
        strong.textContent = main;
        strong.append(
          n("span", " · 另有 " + note, { class: "c3-metric-note" }),
        );
      }
      box.append(card);
    }
    c.append(box);
  };
  const more = (c, items) => {
    if (items.length) c.append(U.actionMenu({ label: "更多", items }).element);
  };
  const drawerTable = (title, columns, rows, opts = {}) => {
    const d = U.drawer({ title });
    table(d.body, columns, rows, opts);
    return d;
  };
  const filter = (
    c,
    rows,
    columns,
    {
      qKeys = [],
      filters = [],
      rowAction,
      more: menu,
      primary,
      tableOptions,
    } = {},
  ) => {
    let q = "",
      selected = filters.map((x) => x.value || "");
    const host = n("div");
    const draw = () => {
      host.replaceChildren();
      const list = rows.filter(
        (x) =>
          (!q ||
            qKeys.some((k) =>
              String(x[k] || "")
                .toLocaleLowerCase()
                .includes(q.toLocaleLowerCase()),
            )) &&
          filters.every((f, i) => !selected[i] || f.match(x, selected[i])),
      );
      table(host, columns, list, {
        rowAction,
        more: menu,
        primary,
        empty: "没有符合条件的记录",
        ...tableOptions,
      });
    };
    tools(c, [
      ...(qKeys.length
        ? [
            searchField((v) => {
              q = v;
              draw();
            }),
          ]
        : []),
      ...filters.map(
        (f, i) =>
          U.selectControl({
            label: f.label,
            value: selected[i],
            options: f.options,
            onChange: (v) => {
              selected[i] = v;
              draw();
            },
          }).element,
      ),
    ]);
    c.append(host);
    draw();
    return { draw };
  };
  // Admissions: summary is a tenant-wide aggregate, not the loaded board page.
  leadsPage = async (c) => {
    const [data, summary] = await Promise.all([
      take("tools/leads"),
      api("c3/leads-summary"),
    ]);
    clear(c);
    metrics(c, [
      ["本月新增", summary.added],
      ["已约试听", summary.trial],
      ["本月转正", summary.converted],
      ["转化率", summary.conversion_rate + "%"],
    ]);
    const bar = n("div", null, { class: "ui-filter-bar" });
    if (enabled("leads", "create"))
      bar.append(b("＋新增线索", () => leadForm(c), "primary"));
    bar.append(
      U.selectControl({
        label: "显示方式",
        value: state.leadView,
        options: [
          { value: "board", label: "看板" },
          { value: "table", label: "表格" },
        ],
        onChange: (v) => {
          state.leadView = v;
          void leadsPage(c);
        },
      }).element,
    );
    c.append(bar);
    if (state.leadView === "table") {
      filter(
        c,
        data,
        [
          { key: "name", label: "姓名" },
          {
            key: "stage",
            label: "阶段",
            render: (r) => me.labels.lead_stages[r.stage],
          },
          { key: "source", label: "来源" },
          {
            key: "direction",
            label: "意向方向",
            render: (r) => r.direction || "意向待补充",
          },
          { key: "next_followup", label: "回访日期" },
        ],
        {
          qKeys: ["name", "source", "direction"],
          rowAction: (r) => leadDetail(c, r),
        },
      );
      return;
    }
    const stages = [
        ["new", "新咨询"],
        ["contacted", "跟进中"],
        ["trial", "已约试听"],
        ["lost", "已流失"],
      ],
      board = n("div", null, { class: "c3-board" });
    for (const [stage, label] of stages) {
      const column = n("section", null, { class: "c3-lead-column" }),
        rows = data.filter((r) => r.stage === stage);
      column.append(n("h2", label + " · " + rows.length));
      column.addEventListener("dragover", (e) => e.preventDefault());
      column.addEventListener("drop", async (e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain"),
          row = data.find((r) => r.id === id),
          from = stages.findIndex((x) => x[0] === row?.stage),
          to = stages.findIndex((x) => x[0] === stage);
        if (
          !row ||
          !U.leadMoveAllowed(row.stage, stage) ||
          !enabled("leads", "update")
        )
          return;
        try {
          await api("tools/leads/" + id, "PATCH", {
            stage,
            version: row.version,
          });
          await leadsPage(c);
        } catch (err) {
          notice(err.message);
        }
      });
      for (const row of rows) {
        const card = b(
          "",
          () => leadDetail(c, row),
          "c3-lead-card" + (stage === "lost" ? " is-lost" : ""),
        );
        card
          .querySelector(".ui-button-face")
          .replaceChildren(n("strong", row.name));
        if (row.next_followup && row.next_followup <= todayBJ())
          card.append(
            U.status(
              row.next_followup < todayBJ() ? "danger" : "warning",
              row.next_followup < todayBJ() ? "回访逾期" : "今天回访",
            ),
          );
        card.append(
          n(
            "span",
            (row.source || "未填来源") +
              " · 意向方向：" +
              (row.direction || "意向待补充"),
          ),
        );
        if (stage === "trial")
          card.append(
            n(
              "time",
              row.trial_at
                ? F.day(row.trial_at) + " " + F.time(row.trial_at)
                : "试听时间待补充",
            ),
          );
        if (enabled("leads", "update") && stage !== "lost") {
          card.draggable = true;
          card.addEventListener("dragstart", (e) =>
            e.dataTransfer.setData("text/plain", row.id),
          );
        }
        column.append(card);
      }
      board.append(column);
    }
    c.append(board);
  };
  function leadDetail(c, row) {
    const d = U.drawer({
      title: row.name,
      subtitle: me.labels.lead_stages[row.stage],
    });
    for (const [label, value] of [
      ["手机", row.phone],
      ["来源", row.source],
      ["意向方向", row.direction || "意向待补充"],
      ["跟进备注", row.note],
      ["下次回访", row.next_followup],
    ])
      d.body.append(
        n("p", label + "：" + (value || "未填写"), { class: "preserve-text" }),
      );
    if (row.stage === "lost") {
      if (enabled("leads", "update"))
        d.body.append(
          b("重新跟进", async () => {
            await api("tools/leads/" + row.id, "PATCH", {
              stage: "contacted",
              version: row.version,
            });
            await d.close();
            await leadsPage(c);
          }),
        );
      return;
    }
    if (!row.student_id && enabled("leads", "update"))
      d.body.append(
        b("编辑 / 跟进", () => {
          void d.close();
          leadForm(c, row);
        }),
      );
    if (
      row.stage === "trial" &&
      enabled("students", "create") &&
      enabled("leads", "create")
    )
      d.body.append(
        b(
          "转为正式学员",
          async () => {
            if (
              !(await U.confirm({
                title: "转为正式学员",
                consequence: "新建独立学员档案并保留线索历史。",
              }))
            )
              return;
            await api("tools/leads/" + row.id + "/convert", "POST", {
              version: row.version,
            });
            await d.close();
            await leadsPage(c);
          },
          "primary",
        ),
      );
  }
  referralsPage = async (c, studentId = null) => {
    const rows = await take(
      "tools/referrals" +
        (studentId ? "?student_id=" + encodeURIComponent(studentId) : ""),
    );
    clear(c);
    c.append(
      n("p", "仅在家长明确同意后提交姓名、年级、方向、意向和家长联系方式。"),
    );
    if (enabled("referrals", "create"))
      c.append(b("推荐学员", () => referralForm(c, studentId), "primary"));
    table(
      c,
      [
        { key: "name", label: "学员" },
        { key: "grade", label: "年级" },
        { key: "direction", label: "方向" },
        { key: "intention", label: "意向" },
        {
          key: "consent_at",
          label: "同意信息",
          render: (r) =>
            r.consent_name +
            " · " +
            F.date(r.consent_at) +
            " " +
            F.time(r.consent_at) +
            " · " +
            r.consent_method,
        },
        { key: "consent_operator", label: "经办" },
        {
          key: "status",
          label: "状态",
          render: (r) =>
            ({ submitted: "已提交", received: "已接收", withdrawn: "已撤回" })[
              r.status
            ],
        },
      ],
      rows,
      {
        more: (r) =>
          r.status === "submitted" && enabled("referrals", "update")
            ? [
                {
                  label: "撤回",
                  danger: true,
                  onSelect: async () => {
                    if (
                      !(await U.confirm({
                        title: "撤回推荐",
                        consequence: "保留历史推荐及同意记录。",
                        danger: true,
                      }))
                    )
                      return;
                    await api("tools/referrals/" + r.id, "PATCH", {
                      version: r.version,
                      status: "withdrawn",
                    });
                    await referralsPage(c, studentId);
                  },
                },
              ]
            : [],
      },
    );
  };
  referralForm = async (c, id) => {
    await old.referralForm(c, id);
    const f = document.querySelector("dialog[open] form");
    if (!f) return;
    const group = n("fieldset");
    group.append(
      n("legend", "家长同意信息"),
      n("p", "仅用于本次升学推荐，提交至合作服务专用列表。"),
    );
    for (const key of [
      "consent_name",
      "consent_at",
      "consent_method",
      "consent_operator",
    ]) {
      const input = f.elements[key];
      if (input) group.append(input.closest("label"));
    }
    f.insertBefore(group, f.querySelector("button[type=submit]"));
  };
  // Finance lists share the same table; all values are already yuan at the HTTP boundary.
  creditPage = async (c, kind = "packages", studentId = "", offset = 0) => {
    c.dataset.creditScope = studentId || "";
    if (kind === "stages") {
      const rows = await take(
        "credits/stages" +
          (studentId ? "?student_id=" + encodeURIComponent(studentId) : ""),
      );
      clear(c);
      if (enabled("students", "create"))
        c.append(
          b(
            "＋ 学习阶段",
            () => creditForm(c, "stages", { student_id: studentId }),
            "primary",
          ),
        );
      table(
        c,
        [
          // 在学员自己的页面里不再重复一列“学员”。
          ...(studentId ? [] : [{ key: "student_name", label: "学员" }]),
          { key: "name", label: "阶段" },
          {
            key: "date_from",
            label: "起止日期",
            render: (r) =>
              !r.date_from && !r.date_to ? "未设日期" : (r.date_from || "…") + " 至 " + (r.date_to || "长期"),
          },
          { key: "goal", label: "目标" },
          {
            key: "status",
            label: "状态",
            render: (r) =>
              U.status(r.display_status.kind, r.display_status.text),
          },
        ],
        rows,
        {
          primary: enabled("students", "update")
            ? { label: "编辑", onSelect: (r) => creditForm(c, "stages", r) }
            : undefined,
          more: (r) =>
            enabled("students", "delete")
              ? [
                  {
                    label: "删除",
                    danger: true,
                    onSelect: () =>
                      globalThis.ChannelV2Pay.removeItem({
                        title: "删除学习阶段“" + r.name + "”？",
                        consequence: "有课时包关联这个阶段时不能删，可以先在课时包里取消关联，或把阶段改为已完成。",
                        path: "credits/stages/" + r.id,
                        body: { version: r.version },
                        done: () => creditPage(c, "stages", studentId),
                      }),
                  },
                ]
              : [],
        },
      );
      return;
    }
    if (!["packages", "payments", "transactions"].includes(kind))
      return old.creditPage(c, kind, studentId, offset);
    // 收款页：课时包和本月收款汇总与收款记录同时请求（原来三轮依次等待）。
    const sidQ = studentId ? "student_id=" + encodeURIComponent(studentId) : "";
    const payExtra =
      kind === "payments"
        ? Promise.all([
            enabled("packages") ? take("credits/packages" + (sidQ ? "?" + sidQ : "")) : [],
            api("c3/receipts?month=" + financeMonth + (sidQ ? "&" + sidQ : "")),
          ])
        : null;
    payExtra?.catch(() => {});
    const rows = await take(
      "credits/" +
        kind +
        (studentId ? "?student_id=" + encodeURIComponent(studentId) : ""),
    );
    clear(c);
    if (kind === "transactions") {
      c.append(b("返回课时包", () => creditPage(c, "packages", studentId)));
      table(
        c,
        [
          { key: "date", label: "日期" },
          { key: "student_name", label: "学员" },
          { key: "delta", label: "课时变动", numeric: true },
          {
            key: "type",
            label: "类型",
            render: (r) =>
              ({
                purchase: "购买",
                consume: "销课",
                reversal: "回补",
                adjustment: "调整",
                transfer_in: "转入",
                transfer_out: "转出",
              })[r.type] || "课时变动",
          },
          { key: "note", label: "说明" },
        ],
        rows,
      );
      return;
    }
    const module = kind === "packages" ? "packages" : "tuition";
    if (kind === "packages")
      more(c, [
        {
          label: "全部课时流水",
          onSelect: () => creditPage(c, "transactions", studentId),
        },
      ]);
    if (enabled(module, "create"))
      c.append(
        b(
          kind === "packages" ? "＋课时包" : "登记缴费",
          () => creditForm(c, kind, { student_id: studentId }),
          "primary",
        ),
      );
    if (enabled("exports", "export")) c.append(exportLink(kind));
    if (kind === "payments") {
      const [packages, receipt] = await payExtra,
        by = new Map(packages.map((p) => [p.id, p]));
      const received = rows.filter(
          (r) => r.paid_at.slice(0, 7) === financeMonth,
        ),
        receiptPath =
          "c3/receipts?month=" +
          financeMonth +
          (studentId ? "&student_id=" + encodeURIComponent(studentId) : "");
      metrics(c, [
        ["本月已收", F.money(receipt.metrics.total_amount)],
        [
          "待收",
          F.receivable(receipt.metrics.due_amount, receipt.metrics.unresolved),
        ],
        ["本月笔数", receipt.metrics.payment_count],
      ]);
      c.append(
        U.monthPicker({
          value: financeMonth,
          onChange: (v) => {
            financeMonth = v;
            void creditPage(c, kind, studentId);
          },
        }).element,
        tabs([
          {
            key: "received",
            label: "收款记录",
            active: state.payTab === "received",
            onSelect: () => {
              state.payTab = "received";
              void creditPage(c, kind, studentId);
            },
          },
          {
            key: "due",
            label: "待收款",
            active: state.payTab === "due",
            onSelect: () => {
              state.payTab = "due";
              void creditPage(c, kind, studentId);
            },
          },
        ]),
      );
      if (state.payTab === "due") {
        const outstanding = await take(receiptPath);
        table(
          c,
          [
            { key: "student_name", label: "学员" },
            { key: "course_name", label: "对应课时包" },
            { key: "valid_to", label: "有效期" },
            amount("due_amount", "待收"),
          ],
          outstanding,
        );
        const unknown = receipt.metrics.unresolved;
        if (unknown)
          c.append(
            n(
              "p",
              "另有 " +
                unknown +
                " 笔待核对：缺应收价格或未关联课时包，不自动分摊。",
            ),
          );
        return;
      }
      filter(
        c,
        received,
        [
          { key: "paid_at", label: "日期" },
          { key: "student_name", label: "学员" },
          {
            key: "package_id",
            label: "对应课时包",
            render: (r) =>
              r.package_id
                ? by.get(r.package_id)?.course_name || "已关联课时包"
                : "未关联 · 待核对",
          },
          amount("amount", "金额"),
          { key: "method", label: "方式" },
          { key: "note", label: "说明" },
        ],
        {
          qKeys: ["student_name"],
          filters: [
            {
              label: "方式",
              options: [
                { value: "", label: "全部方式" },
                ...[
                  ...new Set(received.map((r) => r.method).filter(Boolean)),
                ].map((x) => ({ value: x, label: x })),
              ],
              match: (r, v) => r.method === v,
            },
          ],
          more: (r) =>
            enabled("tuition", "update")
              ? [{ label: "编辑", onSelect: () => editTuition(c, r) }]
              : [],
        },
      );
      return;
    }
    c.append(
      n(
        "p",
        "状态按暂停、有效期和余额计算；金额只对有学费读取权限的账号显示。",
        { class: "muted" },
      ),
    );
    filter(
      c,
      rows,
      [
        { key: "student_name", label: "学员" },
        { key: "course_name", label: "课程" },
        {
          key: "balance",
          label: "剩余课时",
          numeric: true,
          render: (r) => U.status(r.display_status.kind, F.units(r.balance)),
        },
        {
          key: "valid_to",
          label: "有效期",
          render: (r) => r.valid_to || "不限",
        },
        ...(enabled("tuition")
          ? [amount("unit_price", "单价"), amount("amount", "金额")]
          : []),
        {
          key: "status",
          label: "状态",
          render: (r) => U.status(r.display_status.kind, r.display_status.text),
        },
      ],
      {
        qKeys: ["student_name", "course_name"],
        filters: [
          {
            label: "状态",
            options: [
              { value: "", label: "全部状态" },
              ...["active", "low", "empty", "expired", "paused"].map(
                (v, i) => ({
                  value: v,
                  label: ["使用中", "余额低", "已用完", "已过期", "已暂停"][i],
                }),
              ),
            ],
            match: (r, v) => r.display_status.code === v,
          },
        ],
        rowAction: (r) => packageFlow(c, r),
        more: (r) => [
          ...(enabled("packages", "update")
            ? [{ label: "编辑", onSelect: () => creditForm(c, "packages", r) }]
            : []),
          ...(enabled("packages", "adjust")
            ? [{ label: "手工调整", onSelect: () => adjustForm(c, r) }]
            : []),
          ...(enabled("packages", "transfer")
            ? [
                {
                  label: "课时转移",
                  onSelect: () => transferForm(c, r.student_id),
                },
              ]
            : []),
          ...(enabled("packages", "delete")
            ? [
                {
                  label: "删除",
                  danger: true,
                  onSelect: () =>
                    globalThis.ChannelV2Pay.removeItem({
                      title: "删除这个课时包？",
                      consequence: "只有没用过（没有销课、流水、缴费记录）的课时包能删；用过的请改为暂停。",
                      path: "data/packages/" + r.id,
                      body: { version: r.version },
                      done: () => creditPage(c, "packages", studentId),
                    }),
                },
              ]
            : []),
        ],
      },
    );
  };
  async function editTuition(c, row) {
    const d = U.drawer({ title: "修改缴费记录" }),
      f = n("form");
    field(f, "金额（元）", "amount", "number", row.amount).step = ".01";
    field(f, "收款日期", "paid_at", "date", row.paid_at);
    field(f, "方式", "method", "text", row.method, false);
    field(f, "备注", "note", "text", row.note, false);
    const op = operation();
    submit(f, "保存", async (data) => {
      await api("finance/tuition/" + row.id, "PATCH", {
        ...data,
        amount: Number(data.amount),
        version: row.version,
        operation_id: op,
      });
      await d.close();
      await creditPage(c, "payments", c.dataset.creditScope || "");
    });
    d.body.append(f);
  }
  async function packageFlow(c, row) {
    const rows = (
      await take(
        "credits/transactions?student_id=" + encodeURIComponent(row.student_id),
      )
    ).filter((x) => x.package_id === row.id);
    drawerTable(
      row.student_name + " · " + row.course_name,
      [
        { key: "date", label: "日期" },
        { key: "delta", label: "变动", numeric: true },
        {
          key: "type",
          label: "类型",
          render: (r) =>
            ({
              purchase: "购买",
              consume: "销课",
              reversal: "回补",
              adjustment: "调整",
              transfer_in: "转入",
              transfer_out: "转出",
            })[r.type] || "课时变动",
        },
        { key: "note", label: "说明" },
      ],
      rows,
    );
  }
  financePage = async (c) => {
    const [data, settlement] = await Promise.all([
      api("finance/payroll?month=" + financeMonth),
      enabled("settlements")
        ? api("finance/settlement?month=" + financeMonth)
        : Promise.resolve({ record: { status: "draft" } }),
    ]);
    clear(c);
    c.append(
      U.monthPicker({
        value: financeMonth,
        onChange: (v) => {
          financeMonth = v;
          void financePage(c);
        },
      }).element,
    );
    const steps = n("ol", null, { class: "c3-steps" }),
      index =
        { draft: 0, pending: 1, locked: 2 }[settlement.record.status] || 0;
    ["未确认", "财务提交", "主管批准锁定"].forEach((label, i) =>
      steps.append(
        n("li", label, { "aria-current": i === index ? "step" : "false" }),
      ),
    );
    c.append(steps);
    const actions = [];
    if (enabled("settlements"))
      actions.push({ label: "月度结算", onSelect: () => settlementForm(c) });
    if (enabled("teacher_pay", "create"))
      for (const [k, label] of [
        ["rates", "课酬标准"],
        ["adjustments", "课酬调整"],
        ["payments", "付款记录"],
      ])
        actions.push({
          label,
          onSelect: () => {
            const d = U.drawer({ title: label });
            void financeRecords(d.body, k);
          },
        });
    more(c, actions);
    if (enabled("exports", "export")) c.append(exportLink("finance"));
    table(
      c,
      [
        { key: "teacher_name", label: "教师" },
        { key: "lesson_count", label: "课次", numeric: true },
        amount("total_amount", "应发"),
        amount("paid_amount", "已付"),
        amount("unpaid_amount", "未付"),
        {
          key: "confirmation_status",
          label: "状态",
          render: (r) =>
            U.status(
              r.confirmation_status === "confirmed" ? "success" : "pending",
              r.confirmation_status === "confirmed" ? "已确认" : "未确认",
            ),
        },
      ],
      data.items,
      {
        rowAction: (r) =>
          payrollDetail(
            r,
            data.lessons.filter((l) => l.teacher_id === r.teacher_id),
          ),
        more: (r) =>
          enabled("teacher_pay", "create")
            ? [
                {
                  label: "登记付款",
                  onSelect: () =>
                    financeRecordForm(c, "payments", {
                      teacher_id: r.teacher_id,
                      month: financeMonth,
                    }),
                },
              ]
            : [],
      },
    );
  };
  financeRecords = async (c, kind) => {
    const rows = await take("finance/" + kind),
      cost = kind === "costs",
      module = cost ? "settlements" : "teacher_pay";
    clear(c);
    if (cost) {
      c.append(
        U.monthPicker({
          value: financeMonth,
          onChange: (v) => {
            financeMonth = v;
            void financeRecords(c, kind);
          },
        }).element,
      );
      metrics(c, [
        [
          "本月合计",
          F.money(
            (await api("c3/costs-summary?month=" + financeMonth)).cost_amount,
          ),
        ],
      ]);
    }
    if (enabled(module, "create"))
      c.append(
        b(
          "＋新增" +
            {
              costs: "成本",
              rates: "标准",
              adjustments: "调整",
              payments: "付款",
            }[kind],
          () => financeRecordForm(c, kind),
          "primary",
        ),
      );
    table(
      c,
      cost
        ? [
            { key: "date", label: "日期" },
            { key: "category", label: "类别" },
            amount("amount", "金额"),
            { key: "note", label: "说明" },
          ]
        : [
            { key: "teacher_name", label: "教师" },
            {
              key: "course_name",
              label: "课程 / 月份",
              render: (r) => r.course_name || r.month,
            },
            amount(kind === "rates" ? "rate" : "amount", "金额"),
            {
              key: "note",
              label: "方式 / 说明",
              render: (r) =>
                r.rate_basis
                  ? {
                      legacy: "旧版按课时",
                      unit: "按课时",
                      lesson: "按课次",
                      person: "按人次",
                    }[r.rate_basis]
                  : r.reason || r.note,
            },
            {
              key: "paid_at",
              label: "日期",
              render: (r) =>
                r.effective_from
                  ? r.effective_from + "–" + r.effective_to
                  : r.paid_at || "",
            },
          ],
      cost ? rows.filter((r) => r.date.slice(0, 7) === financeMonth) : rows,
      {
        primary: enabled(module, "update")
          ? { label: "编辑", onSelect: (r) => financeRecordForm(c, kind, r) }
          : undefined,
        more: (r) =>
          enabled(module, "delete")
            ? [
                {
                  label: "删除",
                  danger: true,
                  onSelect: async () => {
                    if (
                      !(await U.confirm({
                        title: "删除记录",
                        consequence: "已锁定月份需先解锁。",
                        danger: true,
                      }))
                    )
                      return;
                    await api("finance/" + kind + "/" + r.id, "DELETE", {
                      version: r.version,
                      operation_id: operation(),
                    });
                    await financeRecords(c, kind);
                  },
                },
              ]
            : [],
      },
    );
  };
  reportsPage = async (c) => {
    const data = await api("c3/report?month=" + financeMonth);
    clear(c);
    c.append(
      U.monthPicker({
        value: financeMonth,
        onChange: (v) => {
          financeMonth = v;
          void reportsPage(c);
        },
      }).element,
      n(
        "p",
        "截至 " +
          data.cutoff +
          " · 已确认到课及按规则扣课/计酬的缺勤；不含未来日期成本，锁月沿用快照。",
      ),
    );
    const values = [
      ["已发生课次", data.lesson_count],
      ["已发生人次", data.participant_count],
      ["待销课", data.pending_count],
      ["已排未上", data.scheduled_count],
    ];
    for (const [k, l] of [
      ["tuition_amount", "学费实收"],
      ["teacher_pay_amount", "教师课酬"],
      ["cost_amount", "其他成本"],
      ["profit_amount", "利润（截至报告日）"],
    ])
      if (k in data) values.push([l, F.money(data[k])]);
    metrics(c, values);
    if (enabled("exports", "export")) {
      const link = exportLink("report");
      link.href += "&scope=occurred";
      c.append(link);
    }
    c.append(n("h2", "近6个月趋势"));
    const trend = n("div", null, { class: "c3-trend" }),
      legend = n("div", null, { class: "c3-trend-legend" }),
      series = [
        ["tuition_amount", "收入"],
        ["teacher_pay_amount", "课酬"],
        ["cost_amount", "成本"],
      ].filter(([key]) => data.trend.some((row) => key in row)),
      max = Math.max(
        1,
        ...data.trend.flatMap((row) =>
          series.map(([key]) => Math.abs(row[key] || 0)),
        ),
      );
    for (const [key, label] of series) {
      const item = n("span");
      item.append(
        n("i", null, { class: "c3-trend-bar c3-bar-" + key }),
        n("span", label),
      );
      legend.append(item);
    }
    for (const row of data.trend) {
      const group = n("section"),
        bars = n("div", null, { class: "c3-trend-bars" });
      for (const [key, label] of series) {
        const value = row[key] || 0;
        const height = Math.round((Math.abs(value) / max) * 20);
        bars.append(
          n("div", null, {
            class: "c3-trend-bar c3-bar-" + key + " c2-height-" + height,
            role: "img",
            "aria-label": label + " " + F.money(value),
            title: label + " " + F.money(value),
          }),
        );
      }
      group.append(bars, n("strong", row.month));
      trend.append(group);
    }
    c.append(legend, trend);
    for (const [k, label] of [
      ["teachers", "教师"],
      ["courses", "课程"],
      ["students", "学员"],
    ]) {
      c.append(n("h2", label));
      table(
        c,
        [
          { key: "name", label: "姓名 / 课程" },
          { key: "lesson_count", label: "已发生课次", numeric: true },
          { key: "units", label: "课时", numeric: true },
          ...(data[k].some((r) => "teacher_pay_amount" in r)
            ? [amount("teacher_pay_amount", "课酬分摊")]
            : []),
        ],
        data[k],
      );
    }
  };
  followupPage = async (c, studentId = null) => {
    if (!studentId) return old.followupPage(c);
    clear(c);
    const owners = (await api("followup-assignees")).items;
    for (const [kind, title] of [
      ["followup_tasks", "跟进待办"],
      ["followup_notes", "沟通记录"],
      ["student_routines", "练习与日常安排"],
    ]) {
      const rows = await take(
          "tools/" + kind + "?student_id=" + encodeURIComponent(studentId),
        ),
        section = U.card(title);
      if (enabled("followup", "create"))
        section.append(
          b("＋新增" + title, () => followupForm(c, kind, studentId)),
        );
      const columns =
        kind === "followup_tasks"
          ? [
              { key: "title", label: "事项" },
              { key: "due_date", label: "截止日期" },
              {
                key: "assignee_id",
                label: "负责人",
                render: (r) =>
                  owners.find((x) => x.id === r.assignee_id)?.name ||
                  r.legacy_owner ||
                  "待指派",
              },
              {
                key: "done",
                label: "状态",
                render: (r) =>
                  U.status(
                    r.done
                      ? "success"
                      : r.due_date < todayBJ()
                        ? "danger"
                        : "pending",
                    r.done
                      ? "已完成"
                      : r.due_date < todayBJ()
                        ? "已逾期"
                        : "待处理",
                  ),
              },
            ]
          : kind === "followup_notes"
            ? [
                {
                  key: "at",
                  label: "时间",
                  render: (r) => F.date(r.at) + " " + F.time(r.at),
                },
                { key: "content", label: "沟通内容" },
              ]
            : [
                {
                  key: "weekday",
                  label: "星期",
                  render: (r) =>
                    ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][
                      r.weekday
                    ],
                },
                { key: "time", label: "时段" },
                { key: "content", label: "活动内容" },
              ];
      table(section, columns, rows, {
        primary: enabled("followup", "update")
          ? {
              label: "编辑",
              onSelect: (r) => followupForm(c, kind, studentId, r),
            }
          : undefined,
        more: (r) =>
          enabled("followup", "delete")
            ? [
                {
                  label: "删除",
                  danger: true,
                  onSelect: async () => {
                    if (
                      !(await U.confirm({
                        title: "删除跟进记录",
                        consequence: "删除后此记录不再显示，操作留审计。",
                        danger: true,
                      }))
                    )
                      return;
                    await api("tools/" + kind + "/" + r.id, "DELETE", {
                      version: r.version,
                    });
                    await followupPage(c, studentId);
                  },
                },
              ]
            : [],
      });
      c.append(section);
    }
  };
  // Settings: small directory with real content, no placeholder button wall.
  const settingSections = [
    ["categories", "课程大类"],
    ["types", "细分课程"],
    ["rooms", "教室与地点"],
    ["absence", "缺勤规则"],
    ["personal", "教师与学员端"],
    ["view", "课表默认视图"],
  ];
  settingsPage = async (c, section = "categories") => {
    clear(c);
    const wrap = n("div", null, { class: "c3-settings" }),
      nav = n("nav", null, { "aria-label": "机构设置分类" }),
      body = n("section");
    for (const [key, label] of settingSections) {
      const x = b(label, () => settingsPage(c, key));
      x.setAttribute("aria-current", key === section ? "page" : "false");
      nav.append(x);
    }
    wrap.append(nav, body);
    c.append(wrap);
    const resource = {
      categories: "course_categories",
      types: "course_types",
      rooms: "locations",
    }[section];
    if (resource) {
      await settingsRecords(body, resource);
      return;
    }
    if (section === "absence") {
      const current = await api("absence-policies"),
        f = n("form"),
        inputs = {};
      for (const [key, label] of [
        ["student_leave", "学员请假"],
        ["student_no_show", "学员旷课"],
        ["teacher_leave", "教师请假"],
        ["cancelled", "机构取消"],
      ]) {
        const group = n("fieldset");
        group.append(n("legend", label));
        inputs[key] = { ...current.policies[key] };
        for (const [flag, text] of [
          ["deduct", "扣课时"],
          ["teacherPaid", "计课酬"],
        ]) {
          const x = U.switch({
            label: text,
            checked: !!inputs[key][flag],
            onCommit: (v) => {
              inputs[key][flag] = v;
            },
          });
          if (!me.user.roles.includes("supervisor"))
            x.element.querySelector("button").disabled = true;
          group.append(x.element);
        }
        f.append(group);
      }
      if (me.user.roles.includes("supervisor"))
        submit(f, "保存规则", async () => {
          await api("absence-policies", "PUT", { policies: inputs });
          notice("缺勤规则已保存", "success");
        });
      body.append(f);
      return;
    }
    const supervisor = me.user.roles.includes("supervisor");
    if (section === "personal") {
      for (const [key, label] of [
        ["teacher_self_checkin", "教师可自助提交出勤"],
        ["teacher_view_student_balance", "教师可查看学生剩余课时"],
        ["student_view_balance", "学员可查看剩余课时"],
        ["student_view_payments", "学员可查看缴费记录"],
        ["academic_can_create_accounts", "教务可开通教师与学员账号"],
        ["academic_can_reset_accounts", "教务可重置教师与学员账号"],
      ]) {
        const checked = [
            "academic_can_create_accounts",
            "academic_can_reset_accounts",
          ].includes(key)
            ? me.policy.settings[key] !== false
            : me.policy.settings[key] === true,
          x = U.switch({
            label,
            checked,
            description:
              key === "teacher_view_student_balance"
                ? "仅当前主讲教师及其对应课程；助教和历史关系不返回余额。"
                : "",
            onCommit: async (v) => {
              await api("settings", "PUT", { key, value: v });
              me.policy.settings[key] = v;
            },
          });
        if (!supervisor) x.element.querySelector("button").disabled = true;
        body.append(x.element);
      }
      // B1：课时不够时最多可以欠几课时（按学员合计）；超过只拦这位学员，同班其他人照常销课。
      const debt = U.selectControl({
        label: "课时不够时最多可欠",
        value: String(me.policy.settings.max_debt_units ?? 3),
        options: [0, 1, 2, 3, 4, 5, 6, 8, 10].map((v) => ({ value: String(v), label: v ? v + " 课时" : "不允许欠课时" })),
        onChange: async (v) => {
          if (!supervisor) throw Error("只有主管可以修改");
          await api("settings", "PUT", { key: "max_debt_units", value: Number(v) });
          me.policy.settings.max_debt_units = Number(v);
        },
      });
      body.append(debt.element, n("p", "欠的课时在学员下次买课时包或用预收余额兑换时自动补扣；超过上限的学员这节课保持待销课，其他人照常销课。", { class: "muted" }));
      return;
    }
    body.append(
      U.selectControl({
        label: "打开课表时的默认视图",
        value: me.policy.settings.default_schedule_view || "calendar",
        options: [
          { value: "calendar", label: "按时间" },
          { value: "teacher", label: "按教师" },
          { value: "room", label: "按教室" },
          { value: "list", label: "列表" },
        ],
        onChange: async (v) => {
          if (!supervisor) throw Error("只有主管可以修改");
          await api("settings", "PUT", {
            key: "default_schedule_view",
            value: v,
          });
          me.policy.settings.default_schedule_view = v;
          scheduleView = v;
        },
      }).element,
    );
    if (!supervisor) body.append(n("p", "只有主管可以修改机构设置。"));
  };
  async function manualOrder(resource) {
    const d = U.drawer({
      title: businessLabels[resource] + " · 手动顺序",
      subtitle: "只调整当前加载的200条；不跨页、不给未加载记录编造顺序。",
    });
    const load = async (offset = 0) => {
      const page = await api("data/" + resource + "?offset=" + offset);
      d.body.replaceChildren();
      const list = U.dataList({
        columns: [{ key: "name", label: "名称" }],
        items: page.items,
        total: page.total,
        loadedLabel: "",
        serverPage: {
          offset,
          nextOffset: page.next_offset,
          size: 200,
          onPage: load,
        },
        manual: true,
        compactActions: true,
        onReorder: async (ordered) => {
          await api("reorder", "PUT", {
            resource,
            offset,
            records: ordered.map((x) => ({ id: x.id, version: x.version })),
          });
          return (await api("data/" + resource + "?offset=" + offset)).items;
        },
      });
      d.body.append(list.element);
    };
    await load();
  }
  async function settingsRecords(c, resource) {
    const rows = await take("data/" + resource);
    if (enabled("settings", "update"))
      more(c, [
        {
          label: "手动顺序（已加载范围）",
          onSelect: () => manualOrder(resource),
        },
      ]);
    if (enabled("settings", "create"))
      c.append(
        b(
          "＋新增" + businessLabels[resource],
          () => recordForm(c, resource),
          "primary",
        ),
      );
    table(
      c,
      [
        { key: "name", label: "名称" },
        ...(resource === "course_types"
          ? [
              {
                key: "format",
                label: "形式",
                render: (r) =>
                  ({ individual: "一对一", group: "班课", class: "集训班" })[
                    r.format
                  ],
              },
              { key: "default_minutes", label: "时长（分钟）", numeric: true },
            ]
          : []),
        ...(resource === "locations"
          ? [
              { key: "campus", label: "校区" },
              { key: "capacity", label: "容量", numeric: true },
            ]
          : []),
        {
          key: "active",
          label: "状态",
          render: (r) => (r.active ? "启用" : "停用"),
        },
      ],
      rows,
      {
        primary: enabled("settings", "update")
          ? { label: "编辑", onSelect: (r) => recordForm(c, resource, r) }
          : undefined,
        more: (r) =>
          enabled("settings", "delete")
            ? [
                {
                  label: "删除",
                  danger: true,
                  onSelect: async () => {
                    if (
                      !(await U.confirm({
                        title: "删除" + businessLabels[resource],
                        consequence: "有关联业务记录时服务器拒绝删除。",
                        danger: true,
                      }))
                    )
                      return;
                    await api("data/" + resource + "/" + r.id, "DELETE", {
                      version: r.version,
                    });
                    await settingsRecords(c, resource);
                  },
                },
              ]
            : [],
      },
    );
  }
  recordsPage = async (c, resource, ...args) => {
    if (resource !== "teachers") return old.recordsPage(c, resource, ...args);
    const rows = (await api("c3/teachers")).items;
    clear(c);
    if (enabled("settings", "update"))
      more(c, [
        {
          label: "手动顺序（已加载范围）",
          onSelect: () => manualOrder("teachers"),
        },
      ]);
    if (enabled("settings", "create"))
      c.append(b("＋新增教师", () => recordForm(c, "teachers"), "primary"));
    filter(
      c,
      rows,
      [
        { key: "name", label: "姓名" },
        {
          key: "course_names",
          label: "负责课程",
          render: (r) =>
            r.course_names ||
            JSON.parse(r.subjects || "[]").join("、") ||
            "未安排",
        },
        { key: "week_count", label: "本周课数", numeric: true },
        {
          key: "status",
          label: "状态",
          render: (r) => (r.status === "active" ? "在职" : "离职"),
        },
      ],
      {
        qKeys: ["name", "course_names"],
        filters: [
          {
            label: "状态",
            options: [
              { value: "", label: "全部" },
              { value: "active", label: "在职" },
              { value: "inactive", label: "离职" },
            ],
            match: (r, v) =>
              v === "active" ? r.status === "active" : r.status !== "active",
          },
        ],
        primary: enabled("settings", "update")
          ? { label: "编辑", onSelect: (r) => recordForm(c, "teachers", r) }
          : undefined,
        more: (r) => [
          {
            label: "详情、账号与联系方式",
            onSelect: () => recordDetails(c, "teachers", r),
          },
          ...(enabled("accounts", "create_personal")
            ? [
                {
                  label: "开通教师账号",
                  onSelect: () => personalAccount("teachers", r),
                },
              ]
            : []),
          ...(enabled("settings", "delete")
            ? [
                {
                  label: "删除",
                  danger: true,
                  onSelect: async () => {
                    if (
                      !(await U.confirm({
                        title: "删除教师",
                        consequence:
                          "有关联课程时将被拒绝；保留历史可改为离职。",
                        danger: true,
                      }))
                    )
                      return;
                    await api("data/teachers/" + r.id, "DELETE", {
                      version: r.version,
                    });
                    await recordsPage(c, "teachers");
                  },
                },
              ]
            : []),
        ],
      },
    );
  };
  accounts = async (c, offset = 0) => {
    const data = await api("accounts?offset=" + offset);
    clear(c);
    c.append(
      n(
        "p",
        "员工账号上限 " +
          me.limits.staff +
          " · 学员账号上限 " +
          me.limits.student,
      ),
      b("＋新增账号", () => newAccount(c), "primary"),
    );
    table(
      c,
      [
        { key: "name", label: "姓名" },
        { key: "phone", label: "手机号" },
        {
          key: "roles",
          label: "角色",
          render: (r) =>
            r.roles
              .map(
                (v) =>
                  ({
                    supervisor: "主管",
                    academic: "教务",
                    finance: "财务",
                    teacher: "教师",
                    student: "学员",
                  })[v],
              )
              .join("、"),
        },
        {
          key: "active",
          label: "状态",
          render: (r) =>
            r.active ? (r.must_change ? "待修改密码" : "启用") : "停用",
        },
      ],
      data.items,
      {
        pageSize: 0,
        total: data.total,
        scopeLimited: data.total > data.items.length,
        serverPage: {
          offset,
          nextOffset: data.next_offset,
          size: 200,
          onPage: (next) => accounts(c, next),
        },
        empty: "开通后，机构账号会显示在这里。",
        emptyAction: { label: "新增账号", onSelect: () => newAccount(c) },
        primary: { label: "编辑", onSelect: (r) => editAccount(c, r) },
        more: (r) => [
          { label: "登录设备", onSelect: () => devices(r.id) },
          {
            label: "查看完整号码（留审计）",
            onSelect: async () => {
              notice(
                (await api("accounts/" + r.id + "/phone", "POST", {})).phone +
                  "（已记录）",
              );
            },
          },
          ...(!r.roles.includes("supervisor")
            ? [
                {
                  label: "重置密码",
                  danger: true,
                  onSelect: async () => {
                    if (
                      !(await U.confirm({
                        title: "重置密码",
                        consequence: "该账号所有设备将下线。",
                        danger: true,
                      }))
                    )
                      return;
                    showSecret(
                      await api(
                        "accounts/" + r.id + "/reset-password",
                        "POST",
                        {},
                      ),
                    );
                  },
                },
              ]
            : []),
        ],
      },
    );

    if (me.user.roles.includes("supervisor"))
      c.append(
        b("角色权限", async () => {
          const temp = n("section");
          await old.accounts(temp);
          const title = [...temp.querySelectorAll("h2")].find((x) =>
            x.textContent.includes("调整教务"),
          );
          if (title) {
            const d = U.drawer({ title: "角色权限" });
            const form = title.closest("form");
            for (const select of form.querySelectorAll("select")) {
              const wrap = select.closest("label"),
                label = wrap.firstChild.textContent;
              if (select.name === "allowed") {
                const toggle = U.switch({
                  label: "是否允许",
                  checked: select.value === "true",
                  onCommit: (v) => {
                    select.value = String(v);
                  },
                });
                wrap.hidden = true;
                wrap.after(toggle.element);
              } else {
                const picker = U.selectControl({
                  label,
                  value: select.value,
                  options: [...select.options].map((o) => ({
                    value: o.value,
                    label: o.textContent,
                  })),
                  onChange: (v) => {
                    select.value = v;
                  },
                });
                wrap.hidden = true;
                wrap.after(picker.element);
              }
            }
            d.body.append(form);
          }
        }),
      );
  };
  function auditText(value, key = "") {
    const labels = {
      name: "姓名",
      status: "状态",
      active: "启用",
      start_at: "开始时间",
      duration: "时长（分钟）",
      units: "课时",
      units_total: "总课时",
      balance: "余额",
      valid_from: "有效期开始",
      valid_to: "有效期结束",
      date_from: "开始日期",
      date_to: "结束日期",
      amount: "金额",
      unit_price: "单价",
      rate: "课酬单价",
      note: "说明",
      text: "点评",
      homework: "作业",
      public_text: "公共点评",
      comment: "个人点评",
      deducted: "扣课时",
      attendance: "出勤",
      reason: "原因",
      month: "月份",
      paid_at: "收款/付款日期",
      date: "日期",
      method: "方式",
      content: "内容",
      goal: "目标",
      title: "标题",
      grade: "年级",
      direction: "方向",
      source: "来源",
      stage: "阶段",
      total: "合计",
      before: "修改前",
      after: "修改后",
      resource: "资料类别",
      data: "内容",
      value: "设置值",
      key: "设置项目",
      allowed: "允许",
      role: "角色",
      roles: "角色",
      module: "模块",
      action: "操作",
    };
    const codes = {
      ...me.labels.lessons,
      ...me.labels.attendance,
      ...me.labels.reviews,
      ...me.labels.lead_stages,
      ...me.labels.modules,
      ...me.labels.actions,
      active: "启用",
      paused: "暂停",
      archived: "归档",
      supervisor: "主管",
      academic: "教务",
      finance: "财务",
      teacher: "教师",
      student: "学员",
      legacy: "旧版按课时",
      unit: "按课时",
      lesson: "按课次",
      person: "按人次",
      individual: "一对一",
      group: "班课",
      class: "集训班",
      type: "指定课程",
      category: "同大类通用",
    };
    if (value === null || value === undefined) return "未填写";
    if (Array.isArray(value)) {
      if (
        value.length === 2 &&
        typeof value[0] === "string" &&
        Object.hasOwn(businessLabels, value[0])
      )
        return businessLabels[value[0]] + "\n" + auditText(value[1]);
      return value.map((v) => auditText(v, key)).join("\n");
    }
    if (typeof value === "object")
      return (
        Object.entries(value)
          .filter(
            ([k]) =>
              k !== "id" &&
              !k.endsWith("_id") &&
              ![
                "created_by",
                "updated_by",
                "created_at",
                "updated_at",
                "version",
                "deleted_at",
                "phone_enc",
                "parent_phone_enc",
                "salt",
                "digest",
              ].includes(k),
          )
          .map(
            ([k, v]) =>
              (Object.hasOwn(labels, k)
                ? labels[k]
                : Object.hasOwn(businessLabels, k)
                  ? businessLabels[k]
                  : "记录内容") +
              "：" +
              auditText(v, k),
          )
          .join("\n") || "关联资料已变更（请对照业务详情）"
      );
    if (typeof value === "boolean") return value ? "是" : "否";
    if (typeof value === "number" && /amount|price|rate|cost/.test(key))
      return F.money(value);
    if (typeof value === "string") {
      if (
        [
          "status",
          "attendance",
          "stage",
          "role",
          "roles",
          "module",
          "action",
          "format",
          "rate_basis",
          "scope_kind",
          "resource",
        ].includes(key)
      ) {
        if (Object.hasOwn(codes, value)) return codes[value];
        if (Object.hasOwn(businessLabels, value)) return businessLabels[value];
      }
      return value;
    }
    return String(value);
  }
  // Audit grouping stays within explicit loaded pages; only finance-visible rows reach this view.
  logs = async (c, kind = "audit", offset = 0) => {
    const data = await api(
      "logs?kind=" +
        kind +
        "&offset=" +
        offset +
        "&" +
        new URLSearchParams(state.logs),
    );
    clear(c);
    const actor = U.field({
      label: "操作人",
      type: "search",
      value: state.logs.actor,
    });
    actor.input.maxLength = 100;
    const range = n("fieldset", null, { class: "c2-range" });
    range.append(n("legend", "日期范围"));
    for (const [key, label] of [
      ["from", "开始日期"],
      ["to", "结束日期"],
    ])
      range.append(
        U.datePicker({
          label,
          value: state.logs[key],
          onChange: (v) => {
            state.logs[key] = v;
          },
        }).element,
      );
    tools(c, [
      actor.element,
      range,
      b("筛选", () => {
        state.logs.actor = actor.input.value;
        return logs(c, kind);
      }),
      b("重置", () => {
        state.logs = { actor: "", from: "", to: "" };
        return logs(c, kind);
      }),
    ]);
    c.append(
      tabs([
        {
          key: "audit",
          label: "操作记录",
          active: kind === "audit",
          onSelect: () => logs(c, "audit"),
        },
        {
          key: "login",
          label: "登录记录",
          active: kind === "login",
          onSelect: () => logs(c, "login"),
        },
      ]),
    );
    const grouped = new Map();
    for (const row of data.items) {
      const key = [
        row.actor_label || row.user_id,
        row.module,
        row.action || row.event,
        Math.floor(row.at / 60000),
      ].join("|");
      if (!grouped.has(key)) grouped.set(key, { ...row, rows: [] });
      grouped.get(key).rows.push(row);
    }
    const rows = [...grouped.values()].map((r) => ({
      ...r,
      actor: r.actor_label || "本人登录账号",
      action_label:
        (me.labels.modules[r.module] || "登录") +
        " / " +
        (me.labels.actions[r.action] || me.labels.events[r.event] || "操作") +
        (r.rows.length > 1 ? " " + r.rows.length + " 条" : ""),
      date: F.date(r.at),
      object: r.rows.length > 1 ? "多个对象" : r.summary || "登录会话",
    }));
    c.append(
      n(
        "p",
        "同一人、同类操作、同一分钟合并；合并仅限当前已加载" +
          data.items.length +
          "条，不跨页猜测。",
        { class: "muted" },
      ),
    );
    filter(
      c,
      rows,
      [
        {
          key: "at",
          label: "时间",
          render: (r) => F.date(r.at) + " " + F.time(r.at),
        },
        { key: "actor", label: "人" },
        { key: "action_label", label: "动作" },
        { key: "object", label: "对象" },
      ],
      {
        tableOptions: {
          pageSize: 0,
          total: data.total,
          scopeLimited: data.total > data.items.length,
          serverPage: {
            offset,
            nextOffset: data.next_offset,
            size: 200,
            onPage: (next) => logs(c, kind, next),
          },
          empty: "符合筛选条件的日志会显示在这里。",
          emptyAction: {
            label: "清除筛选",
            onSelect: () => {
              state.logs = { actor: "", from: "", to: "" };
              return logs(c, kind);
            },
          },
        },
        rowAction: (r) => {
          const d = U.drawer({ title: r.action_label });
          for (const x of r.rows) {
            const p = U.card(
              F.date(x.at) + " " + F.time(x.at),
              x.summary || "",
            );
            for (const key of ["before_json", "after_json"])
              if (x[key]) {
                const details = n("details");
                details.append(
                  n("summary", key === "before_json" ? "修改前" : "修改后"),
                  n("pre", auditText(JSON.parse(x[key])), {
                    class: "preserve-text",
                  }),
                );
                p.append(details);
              }
            d.body.append(p);
          }
        },
      },
    );
  };
  importWizard = async (c) => {
    await old.importWizard(c);
    for (const title of c.querySelectorAll("h2,h3,label>span"))
      title.textContent = title.textContent.replace(/^\d+ · /, "");
    const input = c.querySelector("input[type=file]");
    if (input) {
      const drop = U.upload({
        label: "拖拽Excel文件到这里，或选择文件",
        accept: ".xlsx",
        onFiles: (files) => {
          const dt = new DataTransfer();
          for (const file of files) dt.items.add(file);
          input.files = dt.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        },
      });
      const holder =
        input.closest("label") || input.closest(".field") || input.parentElement;
      holder.hidden = true;
      holder.after(drop.element);
    }
  };
  templatesPage = async (c) => {
    const [rows, enrollments, courses, teachers, rooms] = await Promise.all([
      take("data/schedule_templates"),
      take("data/schedule_enrollments"),
      take("data/course_types"),
      take("data/teachers"),
      take("data/locations"),
    ]);
    const name = (all, id) => all.find((r) => r.id === id)?.name || "未设置";
    clear(c);
    if (enabled("templates", "create"))
      c.append(
        b("＋固定排课", () => recordForm(c, "schedule_templates")),
        b(
          "生成未来课程",
          () => generationDialog(c, { courses, teachers, rooms }),
          "primary",
        ),
      );
    c.append(b("管理模板报名", () => recordsPage(c, "schedule_enrollments")));
    for (let i = 0; i < 7; i++) {
      const list = rows.filter((r) => r.weekday === i);
      if (!list.length) continue;
      c.append(
        n("h2", ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][i]),
      );
      table(
        c,
        [
          {
            key: "start_time",
            label: "时间",
            render: (r) => r.start_time + " · " + r.duration + "分钟",
          },
          {
            key: "course_type_id",
            label: "课程",
            render: (r) => name(courses, r.course_type_id),
          },
          {
            key: "teacher_id",
            label: "老师",
            render: (r) => name(teachers, r.teacher_id),
          },
          {
            key: "location_id",
            label: "教室",
            render: (r) => name(rooms, r.location_id),
          },
          {
            key: "id",
            label: "学生数",
            numeric: true,
            render: (r) =>
              enrollments.filter((e) => e.template_id === r.id).length,
          },
          {
            key: "date_from",
            label: "有效期",
            render: (r) => r.date_from + "–" + r.date_to,
          },
        ],
        list,
        {
          more: (r) => [
            {
              label: "详情",
              onSelect: () => recordDetails(c, "schedule_templates", r),
            },
            ...(enabled("templates", "delete")
              ? [
                  {
                    label: "删除",
                    danger: true,
                    onSelect: async () => {
                      if (
                        !(await U.confirm({
                          title: "删除固定排课",
                          consequence:
                            "有关联课程或报名时服务器拒绝；可改为停用。",
                          danger: true,
                        }))
                      )
                        return;
                      await api("data/schedule_templates/" + r.id, "DELETE", {
                        version: r.version,
                      });
                      await templatesPage(c);
                    },
                  },
                ]
              : []),
          ],
          primary: enabled("templates", "update")
            ? {
                label: "编辑",
                onSelect: (r) => recordForm(c, "schedule_templates", r),
              }
            : undefined,
        },
      );
    }
    if (!rows.length)
      c.append(
        U.empty({
          text: "固定排课用于按有效期与报名名单批量生成未来课程。",
          action: enabled("templates", "create")
            ? {
                label: "新建模板",
                onSelect: () => recordForm(c, "schedule_templates"),
              }
            : null,
        }),
      );
  };
  async function generationDialog(c, lookup) {
    const d = U.drawer({ title: "生成未来课程" }),
      f = n("form"),
      preview = n("section");
    field(f, "开始日期", "from", "date", scheduleWeek);
    field(f, "结束日期", "to", "date", dateShift(scheduleWeek, 30));
    let revision = 0;
    f.addEventListener("input", () => {
      revision++;
      preview.replaceChildren();
    });
    submit(f, "先预览课程与冲突", async (data) => {
      const current = revision,
        result = await api("c3/templates/preview", "POST", data);
      preview.replaceChildren(
        n(
          "p",
          "预计生成 " +
            result.generated +
            " 节，跳过重复 " +
            result.skipped +
            " 节。",
        ),
      );
      const name = (rows, id) =>
        rows.find((x) => x.id === id)?.name || "未设置";
      table(
        preview,
        [
          {
            key: "start_at",
            label: "时间",
            render: (r) => F.date(r.start_at) + " " + F.time(r.start_at),
          },
          {
            key: "course_type_id",
            label: "课程",
            render: (r) => name(lookup.courses, r.course_type_id),
          },
          {
            key: "teacher_id",
            label: "老师",
            render: (r) => name(lookup.teachers, r.teacher_id),
          },
          {
            key: "location_id",
            label: "教室",
            render: (r) => name(lookup.rooms, r.location_id),
          },
        ],
        result.items,
      );
      for (const x of result.conflicts)
        preview.append(
          n("p", "冲突：" + (x.reasons || []).join("、"), {
            class: "impact-note",
          }),
        );
      if (!result.conflicts.length && result.generated)
        preview.append(
          b(
            "确认生成",
            async () => {
              if (current !== revision) throw Error("日期已变化，请重新预览");
              const saved = await api("templates/generate", "POST", data);
              if (!saved.committed) {
                notice(
                  "数据已变化，本次没有写入：" +
                    saved.conflicts.length +
                    "项冲突",
                );
                return;
              }
              await d.close();
              notice("已生成 " + saved.generated + " 节", "success");
              await templatesPage(c);
            },
            "primary",
          ),
        );
    });
    d.body.append(f, preview);
  }
  classesPage = async (c) => {
    const [rows, courses, teachers] = await Promise.all([
      take("tools/classes"),
      choices("course_types"),
      choices("teachers"),
    ]);
    clear(c);
    if (enabled("classes", "create"))
      c.append(b("＋新建班级", () => classForm(c), "primary"));
    if (!rows.length) {
      c.append(
        U.empty({
          text: "班级用于管理固定名单和集训班，整班排课时自动带入学员。",
          action: enabled("classes", "create")
            ? { label: "新建班级", onSelect: () => classForm(c) }
            : null,
        }),
      );
      return;
    }
    const members = await take("tools/class_members");
    table(
      c,
      [
        { key: "name", label: "班名" },
        {
          key: "course_type_id",
          label: "课程",
          render: (r) =>
            courses.find((x) => x.id === r.course_type_id)?.name || "未设置",
        },
        {
          key: "teacher_id",
          label: "老师",
          render: (r) =>
            teachers.find((x) => x.id === r.teacher_id)?.name || "未设置",
        },
        {
          key: "id",
          label: "人数",
          numeric: true,
          render: (r) => members.filter((m) => m.class_id === r.id).length,
        },
        {
          key: "date_from",
          label: "日期范围",
          render: (r) => r.date_from + "–" + r.date_to,
        },
      ],
      rows,
      {
        rowAction: (r) => {
          const d = U.drawer({ title: r.name });
          void old.classesPage(d.body, 0, r.id);
        },
        more: (r) =>
          enabled("classes", "update")
            ? [{ label: "编辑", onSelect: () => classForm(c, r) }]
            : [],
      },
    );
  };
  staffTimetable = async () => {
    const d = U.drawer({ title: "导出课表图" }),
      f = n("form"),
      host = n("section");
    let generation = 0;
    const kind = selectField(
        f,
        "对象",
        "kind",
        [
          { id: "teacher", name: "教师" },
          { id: "student", name: "学员" },
        ],
        "teacher",
      ),
      personHost = n("div");
    let people = await choices("teachers"),
      person;
    const from = field(f, "周起始日期", "from", "date", weekStart(todayBJ()));
    const load = async () => {
      const count = ++generation,
        temporary = n("section");
      if (!person?.value) return;
      await timetableImage(
        temporary,
        weekStart(from.value),
        (kind.value === "teacher" ? "teacher_id=" : "student_id=") +
          encodeURIComponent(person.value),
      );
      if (count !== generation) {
        for (const img of temporary.querySelectorAll("img"))
          URL.revokeObjectURL(img.src);
        return;
      }
      for (const img of host.querySelectorAll("img"))
        URL.revokeObjectURL(img.src);
      host.replaceChildren(...temporary.childNodes);
    };
    const choose = () => {
      personHost.replaceChildren();
      person = selectField(personHost, "姓名", "person", people, people[0]?.id);
      person.addEventListener(
        "change",
        () => void load().catch((e) => notice(e.message)),
      );
    };
    kind.addEventListener("change", async () => {
      people = await choices(
        kind.value === "teacher" ? "teachers" : "students",
      );
      choose();
      await load();
    });
    from.addEventListener(
      "change",
      () => void load().catch((e) => notice(e.message)),
    );
    choose();
    f.append(personHost);
    d.body.append(f, host);
    await load();
  };
  // Personal views use the same APIs, the same role gates and confirmed comments.
  const mainTeacher = () => me.user.roles.includes("teacher");
  const dialogPassword = () => {
    const d = U.drawer({ title: "修改密码" });
    changePassword(d.body);
  };
  const logOut = async () => {
    await api("logout", "POST", {});
    location.assign(base + "login");
  };
  personalShell = () => {
    root.replaceChildren();
    const frame = n("div", null, { class: "personal-frame c3-personal" }),
      head = n("header", null, { class: "personal-header" }),
      identity = n("div");
    identity.append(n("strong", brand.display_name), n("small", me.user.name));
    head.append(mark(), identity);
    const content = n("section", null, { class: "personal-content" }),
      nav = n("nav", null, { class: "personal-nav", "aria-label": "个人导航" }),
      teacher = mainTeacher(),
      views = teacher
        ? [
            ["today", "home", "今天", () => teacherToday(content)],
            ["schedule", "calendar", "课表", () => personalSchedule(content)],
            ["students", "users", "学生", () => teacherStudents(content)],
            ["my", "user", "我的", () => personalProfile(content)],
          ]
        : [
            ["home", "home", "首页", () => studentHome(content)],
            ["schedule", "calendar", "课表", () => personalSchedule(content)],
            ["records", "book", "记录", () => personalRecords(content)],
            ["my", "user", "我的", () => personalProfile(content)],
          ];
    let run = 0;
    const select = async (key, fn) => {
      personalTab = key;
      for (const x of nav.children)
        x.setAttribute(
          "aria-current",
          x.dataset.key === key ? "page" : "false",
        );
      content.dataset.personalTab = key;
      content.setAttribute("aria-busy", "true");
      content.replaceChildren(U.tableSkeleton());
      const generation = ++run;
      try {
        await fn();
      } catch (e) {
        if (generation === run)
          content.replaceChildren(
            U.empty({
              text: e.message,
              action: { label: "重试", onSelect: () => select(key, fn) },
            }),
          );
        notice(e.message);
      } finally {
        if (generation === run) content.setAttribute("aria-busy", "false");
      }
    };
    for (const [key, icon, label, fn] of views) {
      if (["schedule", "records"].includes(key) && !enabled("schedule"))
        continue;
      if (key === "students" && !enabled("students")) continue;
      const button = b("", () => select(key, fn));
      button.dataset.key = key;
      button.append(U.icon(icon), n("span", label));
      nav.append(button);
    }
    frame.append(head, content, nav);
    root.append(frame);
    if (me.user.must_change) {
      changePassword(content, true);
      nav.hidden = true;
      return;
    }
    const initial = views.find((x) => x[0] === personalTab) || views[0];
    void select(initial[0], initial[3]);
  };
  personalCourse = (c, row, back, record = false) => {
    const p = b(
      "",
      () =>
        row.source_course_id
          ? personalPartner(c, row, back)
          : reviewScreen(c, row.id, back),
      "personal-course c3-personal-course",
    );
    const student = me.user.roles.includes("student");
    p.append(
      n(
        "time",
        F.day(row.start_at) + " " + F.range(row.start_at, row.duration),
      ),
      n("strong", row.course_name),
      n("span", student ? row.teacher_name || "教师" : lessonPerson(row)),
      n(
        "small",
        row.mode === "online" ? "线上课" : row.location_name || "待定地点",
      ),
    );
    const waiting =
      record &&
      (row.own_attendance === "planned" ||
        (!row.own_attendance && row.status === "planned"));
    const startedUnclosed =
      !student &&
      row.status === "planned" &&
      Date.parse(row.start_at) <= Date.now();
    const teacherStatus =
      row.review_status === "pending"
        ? "待确认"
        : me.policy.settings.teacher_self_checkin === true &&
            row.teacher_id === me.user.teacher_id &&
            enabled("attendance", "submit")
          ? "待提交点名"
          : "待点名";
    p.append(
      U.status(
        waiting ? "danger" : row.status === "completed" ? "success" : "pending",
        row.source_course_id
          ? partnerLabel(row)
          : waiting
            ? "待销课"
            : row.own_attendance && row.own_attendance !== "planned"
              ? cnAttendance(row.own_attendance) +
                (student ? " · 扣 " + row.own_deducted + " 课时" : "")
              : startedUnclosed
                ? teacherStatus
                : cnLesson(row.status),
      ),
    );
    if (row.review_status) p.append(n("small", cnReview(row.review_status)));
    return p;
  };
  async function teacherToday(c) {
    const today = todayBJ(),
      rows = (await scheduleRows(today, dateShift(today, 1))).filter(
        (x) => x.start_at.slice(0, 10) === today,
      );
    clear(c);
    c.append(
      n("h1", "今天 · " + F.day(today)),
      n("p", me.user.name + " · " + rows.length + " 节课"),
    );
    const pending = [];
    if (
      me.policy.settings.teacher_self_checkin === true &&
      enabled("attendance", "submit")
    ) {
      for (const row of rows.filter(
        (x) =>
          !x.source_course_id &&
          x.teacher_id === me.user.teacher_id &&
          x.status === "planned" &&
          Date.parse(x.start_at) <= Date.now(),
      )) {
        const data = await api("lessons/" + row.id + "/review");
        if (data.can_submit_attendance && data.submission?.status !== "pending")
          pending.push(row);
      }
    }
    if (pending.length) {
      const p = U.card(
        pending.length + " 节课等你提交点名",
        "待员工确认后才扣课、计酬",
      );
      p.classList.add("c3-pending-callout");
      for (const row of pending)
        p.append(
          personalCourse(c, row, () => teacherToday(c)),
          b(
            "提交点名",
            () => reviewScreen(c, row.id, () => teacherToday(c)),
            "primary",
          ),
        );
      c.append(p);
    }
    for (const row of rows.filter((x) => !pending.some((y) => y.id === x.id)))
      c.append(personalCourse(c, row, () => teacherToday(c)));
    if (!rows.length) c.append(U.empty({ text: "今天暂无课程。" }));
    const next = (await api("schedule-next")).record;
    if (next) {
      c.append(
        n("h2", "下一节课"),
        personalCourse(c, next, () => teacherToday(c)),
      );
    }
  }
  async function studentHome(c) {
    clear(c);
    c.append(n("h1", "首页"));
    if (enabled("schedule")) {
      const next = (await api("schedule-next")).record;
      if (next)
        c.append(
          n("h2", "下一节课"),
          personalCourse(c, next, () => studentHome(c)),
        );
      else c.append(U.empty({ text: "暂未安排下一节课，请联系机构老师。" }));
    }
    if (enabled("packages")) {
      const rows = await take("credits/packages"),
        by = new Map();
      for (const row of rows) {
        const k = row.course_type_id || row.course_name,
          x = by.get(k) || { name: row.course_name, balance: 0 };
        if (row.status === "active")
          x.balance = Math.round((x.balance + row.balance) * 100) / 100;
        by.set(k, x);
      }
      c.append(n("h2", "剩余课时"));
      for (const x of by.values()) {
        const p = U.card(x.name);
        p.append(n("strong", F.units(x.balance)));
        if (x.balance === 0)
          p.append(
            n("p", "课时已用完，请联系老师续费", { class: "impact-note" }),
          );
        c.append(p);
      }
    }
    if (enabled("comments")) {
      const rows = (await api("c3/student-comments")).items;
      c.append(n("h2", "最近老师点评"));
      for (const row of rows) {
        const p = U.card(
          row.course_name,
          F.day(row.start_at) + " · " + row.teacher_name,
        );
        if (row.public_text)
          p.append(n("p", row.public_text, { class: "preserve-text" }));
        if (row.private_comment)
          p.append(n("p", row.private_comment, { class: "preserve-text" }));
        c.append(p);
      }
      if (!rows.length) c.append(n("p", "暂无已确认点评。"));
    }
  }
  personalSchedule = async (c) => {
    const from = weekStart(personalDate),
      to = dateShift(from, 6),
      items = await scheduleRows(from, to);
    clear(c);
    c.append(n("h1", "我的课表"));
    const bar = n("div", null, { class: "ui-filter-bar" });
    bar.append(
      b("上周", () => {
        personalDate = dateShift(personalDate, -7);
        return personalSchedule(c);
      }),
      n("strong", from + "–" + to),
      b("下周", () => {
        personalDate = dateShift(personalDate, 7);
        return personalSchedule(c);
      }),
    );
    c.append(bar);
    const strip = n("nav", null, {
      class: "week-strip",
      "aria-label": "选择日期",
    });
    for (let i = 0; i < 7; i++) {
      const date = dateShift(from, i),
        rows = items.filter((x) => x.start_at.slice(0, 10) === date),
        x = b("", () => {
          personalDate = date;
          return personalSchedule(c);
        });
      x.append(
        n("span", ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][i]),
        n("strong", date.slice(8)),
        n("small", rows.length + "节"),
      );
      x.setAttribute("aria-current", date === personalDate ? "date" : "false");
      strip.append(x);
    }
    c.append(strip);
    const rows = items.filter((x) => x.start_at.slice(0, 10) === personalDate);
    for (const row of rows)
      c.append(personalCourse(c, row, () => personalSchedule(c)));
    if (!rows.length) c.append(U.empty({ text: "当天暂无课程。" }));
    if (enabled("exports", "export"))
      c.append(b("保存品牌课表图", () => timetableImage(c, from)));
  };
  async function teacherStudents(c) {
    const data = await api("c3/teacher-students");
    clear(c);
    c.append(n("h1", "我的学生"));
    if (data.balance_enabled)
      c.append(
        n("p", "余额仅对当前主讲关系开放；历史或助教关系不显示余额。", {
          class: "muted",
        }),
      );
    const list = n("div", null, { class: "c3-teacher-students" });
    const openRecords = async (r) => {
      const rows = await take(
          "c3/teacher-students/" + encodeURIComponent(r.student_id),
        ),
        d = U.drawer({ title: r.name + " · 上课记录" });
      for (const x of rows) {
        const p = U.card(
          x.course_name,
          F.day(x.start_at) + " " + F.time(x.start_at),
        );
        p.append(
          n(
            "p",
            x.status === "planned" ? "待销课" : cnAttendance(x.attendance),
          ),
        );
        if (x.public_text)
          p.append(n("p", x.public_text, { class: "preserve-text" }));
        if (x.private_comment)
          p.append(n("p", x.private_comment, { class: "preserve-text" }));
        d.body.append(p);
      }
      if (!rows.length)
        d.body.append(U.empty({ text: "暂无本人参与的已开始课程。" }));
    };
    const students = new Map();
    for (const entry of data.items) {
      if (!students.has(entry.student_id))
        students.set(entry.student_id, { ...entry, courses: [] });
      const row = students.get(entry.student_id);
      row.courses.push(entry);
      if (
        entry.last_comment &&
        (!row.last_comment || entry.last_comment > row.last_comment)
      )
        row.last_comment = entry.last_comment;
    }
    const draw = (query = "") => {
      list.replaceChildren();
      const rows = [...students.values()].filter((row) =>
        [row.name, ...row.courses.map((course) => course.course_name)].some(
          (value) => value.toLowerCase().includes(query.toLowerCase()),
        ),
      );
      for (const row of rows) {
        const item = U.button("", {
          icon: "chevron-right",
          onClick: () => openRecords(row),
        });
        item.classList.add("c3-teacher-student");
        const face = item.querySelector(".ui-button-face");
        const text = n("span");
        const courses = row.courses.map(
          (course) =>
            course.course_name +
            ("balance" in course ? " " + F.units(course.balance) : ""),
        );
        text.append(n("strong", row.name), " · " + courses.join("、"));
        if (enabled("comments") && row.last_comment)
          text.append(" · " + F.date(row.last_comment));
        face.prepend(text);
        list.append(item);
      }
      if (!rows.length)
        list.append(U.empty({ text: "符合搜索条件的授课学员会显示在这里。" }));
    };
    c.append(searchField(draw, "搜索学生姓名或课程"), list);
    draw();
  }
  personalProfile = async (c) => {
    clear(c);
    c.append(
      n("h1", "我的"),
      n("p", me.user.name + " · " + brand.display_name),
    );
    if (mainTeacher() && enabled("teacher_pay")) {
      const data = await api("finance/payroll?month=" + todayBJ().slice(0, 7)),
        row = data.items[0],
        p = U.card("本月应发", data.locked ? "已确认" : "未确认");
      p.classList.add("c3-own-pay");
      const details = b("", () => personalPay(c));
      details
        .querySelector(".ui-button-face")
        .replaceChildren(
          n("strong", F.money(row?.total_amount ?? 0)),
          n("span", "查看课酬明细"),
        );
      p.append(details);
      c.append(p);
    }
    if (!mainTeacher() && enabled("tuition"))
      c.append(b("缴费记录", () => studentPayments(c)));
    c.append(
      b("修改密码", dialogPassword),
      b("登录设备", () => devices()),
      b("退出登录", logOut),
    );
  };
  async function studentPayments(c) {
    const rows = await take("credits/payments");
    clear(c);
    c.append(
      b("‹ 返回我的", () => personalProfile(c)),
      n("h1", "缴费记录"),
    );
    table(
      c,
      [
        { key: "paid_at", label: "日期" },
        amount("amount", "金额"),
        { key: "method", label: "方式" },
        { key: "note", label: "说明" },
      ],
      rows,
    );
  }
  personalRecords = async (c) => {
    await old.personalRecords(c);
    const oldLink = [...c.querySelectorAll("button")].find(
      (x) => x.textContent === "查看请假补课关联记录",
    );
    oldLink?.remove();
    if (me.user.roles.includes("student") && enabled("attendance")) {
      const rows = await take("credits/makeups");
      if (rows.length) {
        c.append(n("h2", "请假与补课"));
        for (const row of rows)
          c.append(
            n(
              "p",
              (row.original_course || "原课") +
                " " +
                F.day(row.original_start) +
                " → " +
                (row.target_course || "补课") +
                " " +
                F.day(row.target_start),
            ),
          );
      }
    }
  };
  // Teacher submissions retain review/confirm separation. Only shared form layout changes.
  reviewScreen = async (c, id, back) => {
    await old.reviewScreen(c, id, back);
    for (const x of c.querySelectorAll("button")) {
      if (x.textContent.includes("提交") && x.type === "submit")
        x.classList.add("c3-tap-target");
    }
    if (mainTeacher())
      for (const select of c.querySelectorAll("form select")) {
        if (![...select.options].some((o) => o.value === "attended")) continue;
        const host = select.closest(".field"),
          row = n("section", null, { class: "c2-attendee c3-checkin-row" }),
          buttons = n("div", null, { class: "c2-attendance-buttons" });
        row.append(
          n("strong", select.getAttribute("aria-label").replace(" · 出勤", "")),
        );
        for (const [value, label] of [
          ["attended", "到课"],
          ["student_leave", "请假"],
          ["no_show", "缺课"],
        ]) {
          const x = b(label, () => {
            select.value = value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
            paint();
          });
          x.dataset.attendance = value;
          buttons.append(x);
        }
        const paint = () => {
          for (const x of buttons.children)
            x.setAttribute(
              "aria-pressed",
              String(x.dataset.attendance === select.value),
            );
        };
        paint();
        row.append(buttons);
        host.hidden = true;
        host.after(row);
        const comment = select.form.elements["comment_" + select.name];
        if (comment)
          row.append(
            U.disclosure("逐人点评（选填）", [comment.closest("label")], {
              open: false,
            }),
          );
        const person = c.__reviewSnapshot?.participants.find(
          (p) => p.id === select.name,
        );
        if (person) row.dataset.student = person.student_id;
        const others = [...select.options].filter(
          (o) =>
            o.value &&
            !["attended", "student_leave", "no_show"].includes(o.value),
        );
        if (others.length)
          row.append(
            U.actionMenu({
              label: "其他缺勤",
              items: others.map((o) => ({
                label: o.textContent,
                onSelect: () => {
                  select.value = o.value;
                  paint();
                },
              })),
            }).element,
          );
      }
    const attendanceForm = c.querySelector(".c3-checkin-row")?.closest("form");
    if (attendanceForm) {
      const duplicate = [...c.children].find(
        (x) => x.querySelector?.(".ui-card-title")?.textContent === "学员出勤",
      );
      duplicate?.remove();
      const title = attendanceForm.querySelector("h2");
      if (title) title.textContent = "学员点名";
      const publicFields = ["public_text", "homework"]
        .map((key) => attendanceForm.elements[key]?.closest("label"))
        .filter(Boolean);
      if (publicFields.length)
        attendanceForm.insertBefore(
          U.disclosure("全班内容与作业（选填）", publicFields, { open: false }),
          attendanceForm.querySelector("button[type=submit]"),
        );
      if (
        me.policy.settings.teacher_view_student_balance === true &&
        enabled("students") &&
        enabled("schedule")
      ) {
        const data = await api("c3/teacher-students");
        for (const row of attendanceForm.querySelectorAll(".c3-checkin-row")) {
          const balance = data.items.find(
            (x) =>
              x.student_id === row.dataset.student &&
              x.course_type_id === c.__reviewSnapshot.lesson.course_type_id,
          );
          if (balance && "balance" in balance)
            row.insertBefore(
              n("small", "剩余 " + F.units(balance.balance)),
              row.querySelector(".c2-attendance-buttons"),
            );
        }
      }
    }
  };
  globalThis.ChannelC3 = {
    teacherToday,
    teacherStudents,
    studentHome,
    leadDetail,
  };
})();
