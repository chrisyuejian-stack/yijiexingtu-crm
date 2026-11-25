// C2: composed from the shared UI. Existing write endpoints remain authoritative.
(() => {
  const legacy = {
    creditPage,
    recordsPage,
    home,
    studentsPage,
    lessonDetail,
    recordDetails,
    followupPage,
    renewalsPage,
    makeupForm,
    submissionQueue,
  };
  const n = el,
    b = button,
    U = UI,
    F = fmt;
  const staff = () =>
    me.user.roles.some((r) =>
      ["supervisor", "academic", "finance"].includes(r),
    );
  const take = async (path) => {
    const rows = [];
    for (let offset = 0; offset <= 50000;) {
      const p = await api(
        path + (path.includes("?") ? "&" : "?") + "offset=" + offset,
      );
      rows.push(...p.items);
      if (p.next_offset === null || p.next_offset === undefined) return rows;
      offset = p.next_offset;
    }
    throw Error("数据过多，请缩小范围");
  };
  const studentKey = (id) =>
    Array.from(new TextEncoder().encode(id), (x) =>
      x.toString(16).padStart(2, "0"),
    ).join("");
  const parseStudentHash = (hash) => {
    const m =
      /^student-([a-f0-9]{2,200})(?:-(overview|schedule|packages|records|payments|followup|stages|parents|plans|repertoire|more))?$/.exec(
        hash,
      );
    if (!m || m[1].length % 2) return null;
    return [
      new TextDecoder().decode(
        Uint8Array.from(m[1].match(/../g), (x) => parseInt(x, 16)),
      ),
      m[2] || "overview",
    ];
  };
  const goStudent = (id, tab = "overview") => {
    location.hash = "student-" + studentKey(id) + "-" + tab;
  };
  const lessonPerson = (row) => {
    const p = row.participants_summary || { count: 0, names: [] };
    return p.count > 1
      ? (p.class_name || row.course_name) + " · " + p.count + "人"
      : p.names[0] || "暂无参课学员";
  };
  const tools = (host, items) => {
    const bar = U.filterBar(items);
    host.append(bar);
    return bar;
  };
  const table = (host, columns, rows, options = {}) => {
    const view = U.table({ columns, rows, complete: true, ...options });
    host.append(view.element);
    return view;
  };
  const metric = (label, value, action, danger = false) => {
    const c = U.card(label, "", { interactive: !!action, onClick: action });
    c.classList.add("c2-metric");
    if (danger) c.classList.add("is-danger");
    c.append(n("strong", value));
    return c;
  };
  function pendingItem(title, action) {
    const item = b(title, action),
      tail = String(title).split(" · ").pop();
    item.classList.add(
      "c2-pending-item",
      tail === "逾期" ? "is-overdue" : tail === "今天" ? "is-today" : "is-other",
    );
    return item;
  }
  function courseLine(row, host) {
    const line = b("", () => lessonDetail(host, row));
    line.classList.add("c2-course-line");
    line
      .querySelector(".ui-button-face")
      .replaceChildren(
        n("time", F.range(row.start_at, row.duration || 45)),
        n("strong", lessonPerson(row)),
        n("span", row.course_name),
        n("span", row.teacher_name),
        U.status(
          row.status === "planned" && Date.parse(row.start_at) <= Date.now()
            ? "danger"
            : row.status === "completed"
              ? "success"
              : "pending",
          row.status === "planned" && Date.parse(row.start_at) <= Date.now()
            ? "未销课"
            : me.labels.lessons[row.status],
        ),
      );
    return line;
  }
  home = async (c) => {
    const data = await api("c2/home");
    c.replaceChildren(n("p", F.day(todayBJ()) + " · 北京时间"));
    const finance =
      me.user.roles.includes("finance") &&
      !me.user.roles.some((r) => ["supervisor", "academic"].includes(r));
    if (finance) {
      await financialToday(c, data);
      for (const [i, line] of [
        ...c.querySelectorAll(".mobile-card:last-child button"),
      ].entries()) {
        const row = data.lessons[i];
        if (row)
          line.textContent =
            F.range(row.start_at, row.duration) +
            " · " +
            lessonPerson(row) +
            " · " +
            row.course_name +
            " · " +
            row.teacher_name;
      }
      return;
    }
    const counts = data.counts || {},
      metrics = n("section", null, { class: "c2-metrics" });
    for (const [label, key, hash] of [
      ["已过点未销课", "unchecked_lessons", "todo-unchecked"],
      ["跟进逾期", "followup_overdue", "todo-followup"],
      ["课时已用完", "renewal_zero", "todo-renewal"],
    ])
      if (counts[key] !== undefined)
        metrics.append(
          metric(
            label,
            String(counts[key]),
            () => {
              location.hash = hash;
            },
            counts[key] > 0,
          ),
        );
    if (data.tuition_amount !== undefined)
      metrics.append(metric("本月已收", F.money(data.tuition_amount)));
    c.append(metrics);
    const grid = n("div", null, { class: "c2-home-grid" }),
      today = U.card("今日课程"),
      pending = U.card("需要处理");
    for (const row of data.lessons || []) today.append(courseLine(row, c));
    if (!data.lessons?.length)
      today.append(
        U.empty({
          text: "排课后，今天的课程会显示在这里。",
          action: enabled("lessons", "create")
            ? { label: "排课", onSelect: () => lessonForm(c) }
            : undefined,
        }),
      );
    today.classList.add("c2-today");
    pending.classList.add("c2-pending");
    for (const row of data.actions || [])
      pending.append(
        pendingItem(row.title, () =>
          row.kind === "lead"
            ? searchLeadDetail(c, row.id)
            : row.student_id
              ? goStudent(
                  row.student_id,
                  row.kind === "stage" ? "stages" : "followup",
                )
              : (location.hash = "todo-followup"),
        ),
      );
    const all = b("全部待办", () => (location.hash = "todo-unchecked"));
    all.classList.add("c2-pending-all");
    pending.append(all);
    grid.append(today, pending);
    c.append(grid);
    if (data.week) {
      const week = U.card("本周概况"),
        bars = n("div", null, { class: "c2-week-bars" }),
        monday = weekStart(todayBJ());
      for (let i = 0; i < 7; i++) {
        const d = dateShift(monday, i),
          count = data.week.find((x) => x.date === d)?.n || 0;
        const bar = b("", () => {
          scheduleWeek = d;
          location.hash = "schedule-week";
        });
        bar.querySelector(".ui-button-face").replaceChildren(
          n("span", null, {
            class:
              "c2-bar c2-height-" +
              Math.round(
                (count / Math.max(1, ...data.week.map((x) => x.n))) * 20,
              ),
          }),
          n("strong", String(count)),
          n("span", "周" + ["一", "二", "三", "四", "五", "六", "日"][i]),
        );
        bars.append(bar);
      }
      week.classList.add("c2-week");
      week.append(bars);
      c.append(week);
    }
  };
  async function unchecked(c, offset = 0) {
    const data = await api("c2/unchecked?offset=" + offset);
    c.replaceChildren();
    table(
      c,
      [
        {
          key: "start_at",
          label: "时间",
          render: (r) =>
            F.day(r.start_at) + " " + F.range(r.start_at, r.duration),
        },
        { key: "student", label: "学生", render: lessonPerson },
        { key: "course_name", label: "课程" },
        { key: "teacher_name", label: "老师" },
        {
          key: "elapsed",
          label: "已过时长",
          render: (r) =>
            Math.max(
              0,
              Math.floor((Date.now() - Date.parse(r.start_at)) / 3600000),
            ) + "小时",
        },
        {
          key: "action",
          label: "处理",
          sortable: false,
          render: (r) =>
            r.review_status === "pending" && r.review_kind !== "comments"
              ? b("老师已提交，去确认", () => lessonDetail(c, r))
              : enabled("attendance", "update")
                ? b("点名销课", () => lessonDetail(c, r))
                : n("span", "只读"),
        },
      ],
      data.items,
      {
        rowAction: (r) => lessonDetail(c, r),
        pageSize: 0,
        complete: false,
        scopeLimited: data.total > data.items.length,
        total: data.total,
        serverPage: {
          offset,
          nextOffset: data.next_offset,
          size: 50,
          onPage: (n) => unchecked(c, n),
        },
        empty: "已开始、尚未销课的课程会显示在这里。",
        emptyAction: {
          label: "查看周课表",
          onSelect: () => {
            location.hash = "schedule-week";
          },
        },
      },
    );
  }
  let studentFilters = {
    q: "",
    status: "active",
    course: "",
    balance: "",
    sort: "default",
    dir: "asc",
  };
  studentsPage = async (c, offset = 0) => {
    const query = new URLSearchParams({ ...studentFilters, offset });
    const data = await api("c2/students?" + query);
    c.replaceChildren();
    const search = U.field({
        label: "姓名搜索",
        type: "search",
        value: studentFilters.q,
      }),
      state = U.selectControl({
        label: "状态",
        value: studentFilters.status,
        options: [
          { value: "active", label: "在读" },
          { value: "paused", label: "暂停" },
          { value: "archived", label: "归档" },
          { value: "", label: "全部" },
        ],
        onChange: (v) => {
          studentFilters.status = v;
          return studentsPage(c);
        },
      }),
      balances = U.selectControl({
        label: "余额",
        value: studentFilters.balance,
        options: [
          { value: "", label: "全部余额" },
          { value: "zero", label: "已用完" },
          { value: "low", label: "余额低" },
        ],
        onChange: (v) => {
          studentFilters.balance = v;
          return studentsPage(c);
        },
      }),
      sort = U.selectControl({
        label: "排序",
        value: studentFilters.sort,
        options: [
          { value: "default", label: "默认顺序" },
          { value: "name", label: "按姓名" },
          { value: "balance", label: "按剩余课时" },
          { value: "next_start", label: "按下次课" },
          { value: "course_names", label: "按课程" },
          { value: "teacher_names", label: "按授课教师" },
          { value: "status", label: "按状态" },
        ],
        onChange: (v) => {
          studentFilters.sort = v;
          return studentsPage(c);
        },
      });
    search.input.maxLength = 100;
    const controls = [
      search.element,
      b("搜索", () => {
        studentFilters.q = search.input.value;
        return studentsPage(c);
      }),
      state.element,
    ];
    if (enabled("packages")) controls.push(balances.element);
    controls.push(sort.element);
    if (enabled("settings")) {
      const courses = await choices("course_types");
      controls.push(
        U.selectControl({
          label: "课程",
          value: studentFilters.course,
          options: [
            { value: "", label: "全部课程" },
            ...courses.map((x) => ({ value: x.id, label: x.name })),
          ],
          onChange: (v) => {
            studentFilters.course = v;
            return studentsPage(c);
          },
        }).element,
      );
    }
    if (enabled("students", "create"))
      controls.push(b("新增学员", () => recordForm(c, "students"), "primary"));
    if (enabled("exports", "export"))
      controls.push(exportLink("students", "导出学员 Excel"));
    if (enabled("students", "update"))
      controls.push(
        U.actionMenu({
          items: [
            {
              label: "手动顺序（已加载范围）",
              onSelect: async () => {
                studentListState = {};
                const view = U.drawer({
                  title: "调整学员手动顺序",
                  subtitle: "沿用已有排序接口；无搜索和筛选时可上移、下移。",
                });
                view.body.dataset.manualStudentOrder = "true";
                view.body.classList.add("c2-manual-order");
                view.body.__closeManualOrder = view.close;
                await legacy.studentsPage(view.body);
              },
            },
          ],
        }).element,
      );
    tools(c, controls);
    table(
      c,
      [
        {
          key: "name",
          label: "学员",
          render: (r) => {
            const e = n("span", null, { class: "student-entry" });
            e.append(
              n("span", Array.from(r.name)[0], { class: "avatar" }),
              n("strong", U.studentDisplay(r, data.items)),
            );
            return e;
          },
        },
        {
          key: "course_names",
          label: "在学课程",
          sortable: false,
          render: (r) => r.course_names || "暂无关联课程",
        },
        ...(enabled("packages")
          ? [
              {
                key: "balance",
                label: "剩余课时",
                numeric: true,
                render: (r) =>
                  U.status(
                    r.balance === 0
                      ? "danger"
                      : r.balance <= Number(data.settings.low_balance_threshold)
                        ? "warning"
                        : "neutral",
                    F.units(r.balance),
                  ),
              },
            ]
          : []),
        {
          key: "next_start",
          label: "下次课",
          render: (r) =>
            r.next_start
              ? F.day(r.next_start) + " " + F.time(r.next_start)
              : "暂无安排",
        },
        {
          key: "teacher_names",
          label: "授课教师",
          sortable: false,
          render: (r) => r.teacher_names || "暂无排课",
        },
        { key: "status", label: "状态", render: (r) => U.personStatus(r) },
      ],
      data.items,
      {
        rowAction: (r) => goStudent(r.id),
        pageSize: 0,
        total: data.total,
        complete: false,
        scopeLimited: false,
        serverPage: {
          offset,
          nextOffset: data.next_offset,
          size: 50,
          onPage: (n) => studentsPage(c, n),
        },
        empty: "符合筛选条件的学员会显示在这里。",
        emptyAction: {
          label: "清除筛选",
          onSelect: () => {
            studentFilters = {
              q: "",
              status: "",
              course: "",
              balance: "",
              sort: "default",
              dir: "asc",
            };
            return studentsPage(c);
          },
        },
        state: {
          sortKey:
            studentFilters.sort === "default" ? null : studentFilters.sort,
          direction: studentFilters.dir === "desc" ? -1 : 1,
        },
        onSortChange: async (key, direction) => {
          studentFilters.sort = [
            "balance",
            "name",
            "next_start",
            "status",
          ].includes(key)
            ? key
            : "default";
          studentFilters.dir = direction === -1 ? "desc" : "asc";
          await studentsPage(c);
        },
      },
    );
  };
  async function studentDetail(c, id, tab = "overview") {
    const row = (await api("data/students/" + encodeURIComponent(id))).record,
      data = await api("c2/students/" + encodeURIComponent(id));
    c.replaceChildren();
    c.dataset.studentDetail = id;
    const head = n("section", null, { class: "c2-detail-head" }),
      ops = [];
    head.append(
      b("返回学员列表", () => (location.hash = "students")),
      n("h2", row.name),
      U.status(
        row.status === "active" ? "success" : "neutral",
        U.personStatus(row),
      ),
      n(
        "p",
        [
          row.grade,
          row.parent_name,
          row.phone && "学员 " + row.phone,
          row.parent_phone && "家长 " + row.parent_phone,
        ]
          .filter(Boolean)
          .join(" · "),
      ),
    );
    if (enabled("students", "update"))
      ops.push(b("编辑", () => recordForm(c, "students", row)));
    if (enabled("packages", "create"))
      ops.push(
        b(
          "＋课时包",
          () => creditForm(c, "packages", { student_id: id }),
          "primary",
        ),
      );
    const more = [];
    if (enabled("accounts", "reveal_phone"))
      more.push({
        label: "查看完整联系方式",
        onSelect: async () => {
          const r = await api("data/students/" + id + "/contact", "POST", {});
          notice(
            "手机：" +
              (r.phone || "未填写") +
              "；家长手机：" +
              (r.parent_phone || "未填写"),
            "success",
          );
        },
      });
    if (!row.account_id && enabled("accounts", "create_personal"))
      more.push({
        label: "开通学员账号",
        onSelect: () => personalAccount("students", row),
      });
    if (row.account_id && enabled("accounts", "reset_personal"))
      more.push({
        label: "重置学员账号密码",
        onSelect: async () => {
          if (
            await U.confirm({
              title: "重置学员密码？",
              consequence: "原密码失效，所有设备下线；初始密码仅显示一次。",
            })
          )
            showSecret(
              await api(
                "accounts/" + row.account_id + "/reset-password",
                "POST",
                {},
              ),
            );
        },
      });
    if (row.account_id && enabled("accounts", "update"))
      more.push({
        label: row.account_active ? "停用学员账号" : "启用学员账号",
        onSelect: async () => {
          if (
            await U.confirm({
              title: "变更学员账号状态？",
              consequence: "该账号的全部在线会话将失效，档案和历史记录保留。",
            })
          ) {
            const account = (await api("accounts/" + row.account_id)).user;
            await api("accounts/" + row.account_id, "PATCH", {
              version: account.version,
              active: !row.account_active,
            });
            await studentDetail(c, id, tab);
          }
        },
      });
    if (enabled("students", "update"))
      for (const [value, label] of [
        ["paused", "暂停"],
        ["archived", "归档"],
      ])
        more.push({
          label,
          onSelect: async () => {
            if (
              await U.confirm({
                title: label + "学员？",
                consequence: "保留历史课程、缴费与审计记录。",
              })
            ) {
              await api("data/students/" + id, "PATCH", {
                status: value,
                version: row.version,
              });
              await studentDetail(c, id, tab);
            }
          },
        });
    if (enabled("students", "delete"))
      more.push({
        label: "删除学员",
        danger: true,
        onSelect: async () => {
          if (
            await U.confirm({
              title: "删除学员？",
              consequence:
                "仅无课程、课时包等关联的档案可删除；有历史记录时请归档。",
            })
          ) {
            await api("data/students/" + id, "DELETE", {
              version: row.version,
            });
            location.hash = "students";
          }
        },
      });
    if (more.length) ops.push(U.actionMenu({ items: more }).element);
    head.append(U.filterBar(ops));
    c.append(head);
    const metrics = n("div", null, { class: "c2-metrics" }),
      f = data.facts;
    if (f.balance !== undefined)
      metrics.append(
        metric(
          "剩余课时",
          F.units(f.balance) + " · " + f.package_count + "个包",
        ),
      );
    if (f.paid_amount !== undefined)
      metrics.append(metric("累计缴费", F.money(f.paid_amount)));
    if (enabled("schedule"))
      metrics.append(
        metric(
          "下次课",
          data.next
            ? F.day(data.next.start_at) + " " + F.time(data.next.start_at)
            : "暂无安排",
        ),
      );
    if (f.due_amount !== undefined)
      metrics.append(
        metric(
          "欠费",
          f.due_unresolved
            ? "待核对 " + f.due_unresolved + " 笔"
            : F.money(f.due_amount),
        ),
      );
    c.append(metrics);
    const tabs = [
      ["overview", "概览", true],
      ["packages", "课时包", enabled("packages")],
      ["records", "上课记录", enabled("schedule")],
      ["payments", "缴费", enabled("tuition")],
      ["followup", "跟进", enabled("followup")],
      ["stages", "学习阶段", enabled("students")],
      ["more", "更多", true],
    ].filter((x) => x[2]);
    if (!tabs.some((x) => x[0] === tab)) tab = "overview";
    const page = U.page({
      tabs: tabs.map(([key, label]) => ({
        key,
        label,
        active: key === tab,
        onSelect: () => goStudent(id, key),
      })),
    });
    c.append(page.element);
    const body = page.body;
    if (tab === "overview") {
      if (enabled("packages")) {
        const packs = (await api("credits/packages?student_id=" + id)).items;
        const section = U.card("课时包摘要");
        for (const p of packs)
          section.append(
            b(
              p.course_name +
                " · " +
                F.units(p.balance) +
                " · " +
                p.display_status.text,
              () => goStudent(id, "packages"),
            ),
          );
        body.append(section);
      }
      const recent = U.card("最近上课与点评");
      for (const l of data.recent || []) {
        const line = n("div", null, { class: "c2-recent" });
        line.append(
          n(
            "strong",
            F.day(l.start_at) +
              " " +
              F.time(l.start_at) +
              " · " +
              l.course_name,
          ),
          n(
            "p",
            l.status === "planned"
              ? "待销课"
              : me.labels.attendance[l.attendance] ||
                  me.labels.lessons[l.status],
          ),
        );
        for (const text of [l.public_text, l.private_comment].filter(Boolean))
          line.append(n("p", text, { class: "preserve-text" }));
        recent.append(line);
      }
      if (!data.recent?.length)
        recent.append(
          U.empty({
            text: "上课开始后，最近五次记录和已公开点评会显示在这里。",
          }),
        );
      body.append(recent);
      if (enabled("followup")) {
        const tasks = (await toolPage("followup_tasks", id)).items.filter(
          (x) => !x.done,
        );
        const panel = U.card("待办跟进");
        for (const x of tasks)
          panel.append(
            b(x.due_date + " · " + x.title, () => goStudent(id, "followup")),
          );
        body.append(panel);
      }
    } else if (tab === "packages") await creditPage(body, "packages", id);
    else if (tab === "payments") await creditPage(body, "payments", id);
    else if (tab === "stages") await creditPage(body, "stages", id);
    else if (tab === "followup") await followupPage(body, id);
    else if (tab === "records") {
      // Endpoint below is already student-scoped; no per-course reads.
      const rows = await take("c2/students/" + id + "/history");
      table(
        body,
        [
          {
            key: "start_at",
            label: "时间",
            render: (r) => F.date(r.start_at) + " " + F.time(r.start_at),
          },
          { key: "course_name", label: "课程" },
          { key: "teacher_name", label: "教师" },
          {
            key: "status",
            label: "状态",
            render: (r) =>
              r.status === "planned" ? "待销课" : me.labels.lessons[r.status],
          },
        ],
        rows,
        { rowAction: (r) => lessonDetail(c, r) },
      );
    } else {
      if (enabled("students", "read"))
        body.append(b("不可排时段", () => studentBlocks(c, id)));
      if (enabled("referrals"))
        body.append(b("合作升学推荐", () => referralsPage(body, id)));
    }
  }
  async function studentBlocks(c, id) {
    const view = U.drawer({ title: "学员不可排时段" });
    async function load() {
      const data = { items: await take("c2/students/" + id + "/blocks") };
      view.body.replaceChildren();
      table(
        view.body,
        [
          {
            key: "weekday",
            label: "每周",
            render: (r) =>
              ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][
                r.weekday
              ],
          },
          {
            key: "start_time",
            label: "时段",
            render: (r) => r.start_time + "–" + r.end_time,
          },
          { key: "label", label: "说明" },
          {
            key: "active",
            label: "状态",
            render: (r) => (r.active ? "启用" : "停用"),
          },
        ],
        data.items,
        {
          rowAction: enabled("students", "update") ? (r) => edit(r) : undefined,
          more: enabled("students", "delete")
            ? [
                {
                  label: "删除",
                  danger: true,
                  onSelect: async (r) => {
                    if (
                      await U.confirm({
                        title: "删除不可排时段？",
                        consequence: "后续排课不再用这一时段检查冲突。",
                      })
                    ) {
                      await api(
                        "data/student_schedule_blocks/" + r.id,
                        "DELETE",
                        { version: r.version },
                      );
                      await load();
                    }
                  },
                },
              ]
            : [],
        },
      );
    }
    const edit = (row = {}) => {
      const form = U.formDialog([
        {
          name: "start_time",
          label: "开始时间",
          type: "time",
          value: row.start_time || "09:00",
        },
        {
          name: "end_time",
          label: "结束时间",
          type: "time",
          value: row.end_time || "10:00",
        },
        { name: "label", label: "说明", value: row.label || "" },
      ]);
      const day = selectField(
        form.form,
        "每周",
        "weekday",
        ["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map(
          (name, i) => ({ id: String(i), name }),
        ),
        String(row.weekday || 0),
      );
      submit(form.form, "保存", async (d) => {
        await api(
          "data/student_schedule_blocks" + (row.id ? "/" + row.id : ""),
          row.id ? "PATCH" : "POST",
          {
            student_id: id,
            weekday: Number(d.weekday),
            start_time: d.start_time,
            end_time: d.end_time,
            label: d.label,
            active: row.active ?? 1,
            version: row.version,
          },
        );
        await form.close();
        await load();
      });
    };
    if (enabled("students", "create"))
      view.footer.append(b("新增时段", () => edit(), "primary"));
    await load();
  }
  recordsPage = async (c, resource, ...args) => {
    const detail = c.dataset.studentDetail;
    if (resource === "students" && detail)
      return studentDetail(
        c,
        detail,
        parseStudentHash(location.hash.slice(1))?.[1] || "overview",
      );
    return legacy.recordsPage(c, resource, ...args);
  };
  creditPage = async (c, kind = "packages", studentId = "", ...args) => {
    if (c.dataset.studentDetail && studentId) {
      const tab = {
        packages: "packages",
        payments: "payments",
        stages: "stages",
      }[kind];
      if (tab) {
        const hash = "student-" + studentKey(studentId) + "-" + tab;
        if (location.hash === "#" + hash)
          return studentDetail(c, studentId, tab);
        location.hash = hash;
        return;
      }
    }
    return legacy.creditPage(c, kind, studentId, ...args);
  };
  recordDetails = async (c, resource, row) =>
    resource === "students" && staff()
      ? goStudent(row.id)
      : legacy.recordDetails(c, resource, row);
  async function makeups(c, offset = 0) {
    const [pending, assigned] = await Promise.all([api("c2/makeups?offset=" + offset), take("credits/makeups")]);
    c.replaceChildren();
    const section = U.card("待安排");
    table(
      section,
      [
        { key: "student_name", label: "学员" },
        {
          key: "start_at",
          label: "原课",
          render: (r) =>
            F.day(r.start_at) +
            " " +
            F.time(r.start_at) +
            " · " +
            r.course_name,
        },
        { key: "teacher_name", label: "教师" },
        {
          key: "action",
          label: "处理",
          render: (r) =>
            enabled("attendance", "create")
              ? b("安排补课", async () => {
                  const l = (await api("data/lessons/" + r.lesson_id)).record;
                  await makeupForm(
                    c,
                    l,
                    l.participants.find((x) => x.id === r.id),
                  );
                })
              : n("span", "只读"),
        },
      ],
      pending.items,
      {
        pageSize: 0,
        total: pending.total,
        scopeLimited: pending.total > pending.items.length,
        serverPage: {
          offset,
          nextOffset: pending.next_offset,
          size: 50,
          onPage: (n) => makeups(c, n),
        },
        empty: "需要补课、尚未安排的记录会显示在这里。",
        emptyAction: {
          label: "查看周课表",
          onSelect: () => {
            location.hash = "schedule-week";
          },
        },
      },
    );
    c.append(section);
    const arranged = U.card("已安排");
    table(
      arranged,
      [
        { key: "student_name", label: "学员" },
        {
          key: "original_start",
          label: "原课 → 补课",
          render: (r) =>
            F.date(r.original_start) +
            " " +
            F.time(r.original_start) +
            " → " +
            F.date(r.target_start) +
            " " +
            F.time(r.target_start),
        },
      ],
      assigned,
      {
        more: enabled("attendance", "update")
          ? [
              {
                label: "解除关联",
                onSelect: async (row) => {
                  if (
                    await U.confirm({
                      title: "解除补课关联？",
                      consequence: "按已有补课规则重新分配课时，保留审计流水。",
                    })
                  ) {
                    await creditWrite("makeups/" + row.id + "/unlink", {
                      version: row.version,
                    });
                    await makeups(c, offset);
                  }
                },
              },
            ]
          : [],
      },
    );
    c.append(arranged);
  }
  makeupForm = async (c, data, part) => {
    if (!enabled("lessons", "create")) return manualMakeup(c, data, part);
    const choices = await api("c2/makeups/" + part.id + "/suggestions"),
      view = U.drawer({
        title: "安排补课",
        subtitle: part.student_name + " · " + data.course_name,
      });
    view.body.append(
      n(
        "p",
        "未来14天 · 08:00–20:00 · 已校验教师、学员、教室及不可排时段；保存时仍会重新校验。",
      ),
    );
    for (const option of choices.items)
      view.body.append(
        b(
          F.day(option.start_at) +
            " " +
            F.range(option.start_at, option.duration),
          async () => {
            const result = await creditWrite("makeups", {
              original_participant_id: part.id,
              new_lesson: {
                ...data,
                id: undefined,
                start_at: option.start_at,
                duration: option.duration,
                student_ids: [part.student_id],
                force: false,
              },
              note: "从建议时段安排",
            });
            if (!result.committed) {
              notice("时段已变化，请刷新建议");
              return;
            }
            await view.close();
            await makeups(c);
          },
        ),
      );
    if (!choices.items.length)
      view.body.append(
        U.empty({ text: "建议时间内没有可用空档，请手工选择其他时间。" }),
      );
    view.footer.append(
      b("手工安排 / 加入已有课", async () => {
        await view.close();
        await legacy.makeupForm(c, data, part);
      }),
    );
  };
  followupPage = async (c, studentId = null) => {
    if (studentId) return legacy.followupPage(c, studentId);
    const onlyMine = followupPage.onlyMine === true,
      owner = onlyMine ? me.user.id : followupPage.owner || "";
    // 负责人名单和四组任务同时请求（原来是一个等一个，共 5 轮）。
    const FOLLOW_GROUPS = [
      ["overdue", "逾期"],
      ["today", "今天"],
      ["future", "之后"],
      ["done", "已完成"],
    ];
    const [people, ...lists] = await Promise.all([
      api("followup-assignees"),
      ...FOLLOW_GROUPS.map(([group]) => api("c2/followups?group=" + group + "&owner=" + encodeURIComponent(owner))),
    ]);
    c.replaceChildren();
    tools(c, [
      U.switch({
        label: "只看我的",
        checked: onlyMine,
        onCommit: (value) => {
          followupPage.onlyMine = value;
          return followupPage(c);
        },
      }).element,
      U.selectControl({
        label: "负责人",
        value: owner,
        options: [
          { value: "", label: "所有负责人" },
          ...people.items.map((x) => ({ value: x.id, label: x.name })),
        ],
        onChange: (v) => {
          followupPage.onlyMine = false;
          followupPage.owner = v;
          return followupPage(c);
        },
      }).element,
      ...(enabled("followup", "create")
        ? [b("新增跟进任务", () => followupForm(c, "followup_tasks"))]
        : []),
    ]);
    for (const [i, [group, label]] of FOLLOW_GROUPS.entries()) {
      const data = lists[i];
      const body = n("div");
      for (const row of data.items) {
        const line = n("div", null, { class: "c2-task-row" });
        if (enabled("followup", "update")) {
          const input = n("input", null, {
            type: "checkbox",
            "aria-label": "完成" + row.title,
          });
          input.checked = !!row.done;
          input.addEventListener("change", async () => {
            input.disabled = true;
            try {
              await api("tools/followup_tasks/" + row.id, "PATCH", {
                ...row,
                version: row.version,
                done: input.checked,
              });
              await followupPage(c);
            } catch (e) {
              input.checked = !input.checked;
              notice(e.message);
            } finally {
              input.disabled = false;
            }
          });
          line.append(input);
        }
        line.append(
          row.student_id
            ? b(row.student_name, () => goStudent(row.student_id))
            : n("span", "未关联学员"),
          n("span", row.title),
          n("time", row.due_date),
          n("small", row.assignee_name),
        );
        body.append(line);
      }
      for (const row of data.stages || []) {
        const line = n("div", null, { class: "c2-task-row is-system" }),
          who = b(row.student_name, () => goStudent(row.student_id, "stages"));
        line.append(
          n("span", "系统项", { class: "ui-badge ui-badge--neutral" }),
          who,
          n("span", "学习阶段到期"),
        );
        body.append(line);
      }
      if (!data.items.length && !data.stages?.length)
        body.append(U.empty({ text: "这一组暂无跟进事项。" }));
      const groupView = U.disclosure(label, [body], { open: group !== "done" });
      c.append(groupView);
    }
  };
  renewalsPage = async (c) => {
    const groups = [
      ["zero", "已用完"],
      ["low", "余额低"],
      ["expiring", "即将到期"],
      ["expired", "已过期仍有余额"],
    ];
    const getPage = (key, offset = 0) =>
      api("c2/renewals?group=" + key + "&offset=" + offset);
    const pages = await Promise.all(groups.map(([key]) => getPage(key)));
    const data = pages[0];
    c.replaceChildren();
    c.append(
      n(
        "p",
        "当前阈值：余额≤" +
          data.settings.low_balance_threshold +
          "课时；" +
          data.settings.expiry_warning_days +
          "天内到期。",
      ),
    );
    if (me.user.roles.includes("supervisor"))
      c.append(
        b("预警规则", () => {
          const view = U.formDialog([
            {
              name: "low_balance_threshold",
              label: "低余额课时",
              type: "number",
              value: data.settings.low_balance_threshold,
            },
            {
              name: "expiry_warning_days",
              label: "提前提醒天数",
              type: "number",
              value: data.settings.expiry_warning_days,
            },
          ], { title: "修改预警规则" });
          submit(view.form, "保存规则", async (d) => {
            await api("renewal-settings", "PUT", {
              low_balance_threshold: Number(d.low_balance_threshold),
              expiry_warning_days: Number(d.expiry_warning_days),
            });
            await view.close();
            await renewalsPage(c);
          });
        }),
      );
    function renderGroup(panel, key, page, offset) {
      panel.dataset.loadedCount = String(page.items.length);
      const host = n("div");
      panel.querySelector(".ui-data-table")?.parentElement.remove();
      panel.append(host);
      table(
        host,
        [
          { key: "student_name", label: "学员" },
          { key: "course_name", label: "课程" },
          {
            key: "balance",
            label: "余额",
            numeric: true,
            render: (r) => F.units(r.balance),
          },
          {
            key: "valid_to",
            label: "有效期",
            render: (r) => r.valid_to || "不限",
          },
          {
            key: "last_contact",
            label: "最近联系",
            render: (r) => (r.last_contact ? F.date(r.last_contact) : "未记录"),
          },
          {
            key: "action",
            label: "处理",
            render: (r) => {
              const e = n("span");
              if (enabled("followup", "create"))
                e.append(
                  b("记录联系", () =>
                    followupForm(c, "followup_notes", r.student_id),
                  ),
                );
              if (enabled("packages", "create"))
                e.append(
                  U.actionMenu({
                    items: [
                      {
                        label: "加课时包",
                        onSelect: () =>
                          creditForm(c, "packages", {
                            student_id: r.student_id,
                            course_type_id: r.course_type_id,
                          }),
                      },
                      {
                        label: "生成续费通知",
                        onSelect: async () =>
                          renewalNotice(c, await api("renewal-brand"), r),
                      },
                    ],
                  }).element,
                );
              return e;
            },
          },
        ],
        page.items,
        {
          pageSize: 0,
          total: page.total,
          scopeLimited: page.total > page.items.length,
          serverPage: {
            offset,
            nextOffset: page.next_offset,
            size: 50,
            onPage: async (next) =>
              renderGroup(panel, key, await getPage(key, next), next),
          },
          rowAction: (r) => goStudent(r.student_id),
          empty: "符合该续费提醒条件的学员会显示在这里。",
          emptyAction: {
            label: "查看学员档案",
            onSelect: () => {
              location.hash = "students";
            },
          },
        },
      );
    }
    for (const [index, [key, label]] of groups.entries()) {
      const panel = U.card(label);
      panel.dataset.renewalGroup = label;
      renderGroup(panel, key, pages[index], 0);
      c.append(panel);
    }
  };
  lessonDetail = async (c, row) => {
    const data = { ...row, ...(await api("data/lessons/" + row.id)).record };
    if (data.source_course_id) return legacy.lessonDetail(c, row);
    const participants = [...data.participants].sort(
      (a, b) =>
        a.student_name.localeCompare(b.student_name, "zh-CN") ||
        a.id.localeCompare(b.id),
    );
    let draft = new Map(
        participants.map((p) => [
          p.id,
          data.status === "planned" ? "attended" : p.attendance,
        ]),
      ),
      preview = null,
      seq = 0;
    const reviewSnapshot = enabled("comments", "read")
      ? await api("lessons/" + data.id + "/review")
      : null;
    const view = U.drawer({
      title: data.course_name + " · " + data.teacher_name,
      subtitle:
        F.day(data.start_at) +
        " " +
        F.range(data.start_at, data.duration) +
        " · " +
        data.duration +
        "分钟 · 扣" +
        F.units(data.units) +
        " · " +
        (data.location_name || "待定地点"),
    });
    view.body.append(
      U.status(
        data.status === "planned" && Date.parse(data.start_at) < Date.now()
          ? "danger"
          : data.status === "completed"
            ? "success"
            : "pending",
        data.status === "planned" && Date.parse(data.start_at) < Date.now()
          ? "已过开始时间，未销课"
          : me.labels.lessons[data.status],
      ),
    );
    const roster = n("section"),
      warning = n("p", null, { class: "impact-note", role: "status" }),
      entries = [];
    let filter = "";
    const main = b(
      data.status === "planned" ? "确认销课" : "撤销销课",
      async () => {
        if (data.status === "planned") {
          await refreshPreview();
          if (preview && !preview.valid) {
            notice(preview.warning);
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
          if (!done.committed) return;
          await publishComments();
        } else {
          const text =
            participants
              .map((p) => p.student_name + "课时 +" + p.deducted)
              .join("；") +
            (preview?.undo
              ? "；教师课酬 " + F.money(preview.undo.teacher_pay_amount)
              : "；按现有规则重算相关课酬");
          if (
            !(await U.confirm({
              title: "撤销销课？",
              consequence: text + "。保留回补流水与审计。",
            }))
          )
            return;
          await creditWrite("lessons/" + data.id + "/undo", {
            lesson_version: data.version,
          });
        }
        await view.close();
        await schedulePage(c);
      },
      "primary",
    );
    function renderRoster() {
      roster.replaceChildren();
      for (const p of participants.filter(
        (p) => !filter || p.student_name.includes(filter),
      )) {
        const line = n("div", null, { class: "c2-attendee" }),
          pview = preview?.items.find((x) => x.id === p.id);
        line.append(n("strong", p.student_name));
        if (pview)
          line.append(
            n(
              "small",
              pview.unlimited
                ? "整体课时模式"
                : F.units(pview.available_units) +
                    " · 有效期 " +
                    (pview.valid_to || "不限"),
            ),
          );
        const toggles = n("div", null, { class: "c2-attendance-buttons" });
        if (enabled("attendance", "update"))
          for (const [value, label] of [
            ["attended", "到课"],
            ["student_leave", "请假"],
            ["no_show", "缺课"],
          ]) {
            const item = b(label, () => {
              draft.set(p.id, value);
              renderRoster();
              void refreshPreview();
            });
            item.setAttribute(
              "aria-pressed",
              String(draft.get(p.id) === value),
            );
            toggles.append(item);
          }
        else toggles.append(n("span", me.labels.attendance[p.attendance]));
        line.append(toggles);
        if (
          draft.get(p.id) === "student_leave" &&
          enabled("attendance", "create")
        )
          line.append(b("安排补课", () => makeupForm(c, data, p)));
        roster.append(line);
      }
    }
    if (participants.length > 10) {
      const f = U.field({ label: "搜索本班学员", type: "search" });
      f.input.addEventListener("input", () => {
        filter = f.input.value;
        renderRoster();
      });
      view.body.append(f.element);
    }
    view.body.append(roster, warning);
    async function refreshPreview() {
      if (!enabled("packages")) return;
      const request = ++seq;
      const response = await api("c2/lessons/" + data.id + "/preview", "POST", {
        participants: participants.map((p) => ({
          id: p.id,
          attendance: draft.get(p.id),
        })),
      });
      if (request !== seq) return;
      preview = response;
      const shortage = response.items.filter(
        (x) => !x.unlimited && x.available_units < x.required_units,
      );
      warning.textContent =
        shortage
          .map(
            (x) =>
              x.student_name +
              "余" +
              x.available_units +
              "，无法扣" +
              x.required_units +
              "课时",
          )
          .join("；") ||
        response.warning ||
        "";
      if (response.locked) warning.textContent = "本月已锁定，请先由主管解锁。";
      main.disabled =
        response.locked || (data.status === "planned" && !response.valid);
      renderRoster();
      if (shortage.length && enabled("packages", "create"))
        warning.append(
          b("加课时包", () =>
            creditForm(c, "packages", {
              student_id: shortage[0].student_id,
              course_type_id: data.course_type_id,
            }),
          ),
        );
    }
    const comments = n("section"),
      publicText = U.field({ label: "全班公共点评", type: "textarea" }),
      personInputs = new Map();
    if (enabled("comments", "read")) {
      publicText.input.value =
        reviewSnapshot?.published.find((x) => x.student_id === null)?.text ||
        "";
      comments.append(publicText.element);
      for (const p of participants) {
        const field = U.field({
          label: p.student_name + "的点评",
          type: "textarea",
        });
        field.input.value =
          reviewSnapshot?.published.find((x) => x.student_id === p.student_id)
            ?.text || "";
        personInputs.set(p.student_id, field.input);
        comments.append(field.element);
      }
      view.body.append(
        U.disclosure("课后点评（可选）", [comments], { open: false }),
      );
    }
    async function publishComments() {
      if (
        !enabled("comments", "correct") ||
        (!publicText.input.value &&
          ![...personInputs.values()].some((x) => x.value))
      )
        return;
      try {
        const review = reviewSnapshot;
        await api("lessons/" + data.id + "/comments", "PUT", {
          operation_id: operation(),
          comment_fingerprint: review.comment_fingerprint,
          public_text: publicText.input.value,
          people: participants.map((p) => ({
            participant_id: p.id,
            student_id: p.student_id,
            comment: personInputs.get(p.student_id)?.value || "",
          })),
        });
      } catch (e) {
        notice(
          "销课已成功；点评未保存：" + e.message + "。可从课程点评单独更正。",
        );
      }
    }
    if (enabled("attendance", "update")) view.footer.append(main);
    if (enabled("lessons", "update"))
      view.footer.append(
        b("改时间", async () => {
          await view.close();
          await lessonForm(c, data);
        }),
      );
    const more = [];
    if (enabled("attendance", "update"))
      for (const [value, label] of [
        ["teacher_leave", "教师请假"],
        ["cancelled", "机构取消"],
      ])
        more.push({
          label,
          onSelect: async () => {
            if (
              await U.confirm({
                title: label + "？",
                consequence: "按机构缺勤规则回补课时并重算课酬，保留审计。",
              })
            ) {
              await creditWrite("lessons/" + data.id + "/status", {
                lesson_version: data.version,
                status: value,
              });
              await view.close();
              await schedulePage(c);
            }
          },
        });
    if (enabled("attendance", "create"))
      more.push({
        label: "安排补课",
        onSelect: () => makeupForm(c, data, participants[0]),
      });
    if (enabled("lessons", "delete") && enabled("attendance", "delete"))
      more.push({
        label: "删除",
        danger: true,
        onSelect: async () => {
          if (
            await U.confirm({
              title: "删除课程？",
              consequence: "回补已扣课时；有关联补课或锁月时服务器拒绝。",
            })
          ) {
            await api("data/lessons/" + data.id, "DELETE", {
              version: data.version,
            });
            await view.close();
            await schedulePage(c);
          }
        },
      });
    more.push({
      label: "教师提交与点评记录",
      onSelect: async () => {
        const body = n("section");
        view.body.append(body);
        await reviewScreen(body, data.id, () => reviewScreen(body, data.id));
      },
    });
    if (more.length) view.footer.append(U.actionMenu({ items: more }).element);
    renderRoster();
    await refreshPreview();
  };
  let reviewFilters = {
    status: "pending",
    from: todayBJ().slice(0, 7) + "-01",
    to: new Date(
      Date.UTC(Number(todayBJ().slice(0, 4)), Number(todayBJ().slice(5, 7)), 0),
    )
      .toISOString()
      .slice(0, 10),
  };
  submissionQueue = async (c, status = reviewFilters.status, offset = 0) => {
    reviewFilters.status = status;
    const q = new URLSearchParams({ ...reviewFilters, offset });
    const page = await api("submissions?" + q);
    c.replaceChildren();
    const range = n("fieldset", null, { class: "ui-filter-bar c2-date-range" });
    range.append(n("legend", "日期范围"));
    for (const [key, label] of [
      ["from", "开始日期"],
      ["to", "结束日期"],
    ])
      range.append(
        U.datePicker({
          label,
          value: reviewFilters[key],
          onChange: (v) => {
            const old = reviewFilters[key];
            reviewFilters[key] = v;
            if (reviewFilters.from > reviewFilters.to) {
              reviewFilters[key] = old;
              notice("开始日期不能晚于结束日期");
              return;
            }
            void submissionQueue(c).catch((e) => notice(e.message));
          },
        }).element,
      );
    tools(c, [
      range,
      U.selectControl({
        label: "提交状态",
        value: status,
        options: [
          { value: "pending", label: "待确认" },
          { value: "returned", label: "已退回" },
          { value: "overdue", label: "已过窗口仍未提交" },
        ],
        onChange: (v) => submissionQueue(c, v),
      }).element,
    ]);
    const decide = async (row, action) => {
      const review = await api("lessons/" + row.lesson_id + "/review"),
        draft = review.submission;
      if (!draft || draft.status !== "pending")
        throw Error("提交已变化，请刷新");
      let reason;
      if (action === "return") {
        reason = await requestReason("请填写退回原因");
        if (!reason) return;
      } else if (
        !(await U.confirm({
          title: "确认教师提交？",
          consequence:
            "按缺勤规则扣课、计酬，并公开该版本点评；锁定月份需先解锁。",
          danger: false,
        }))
      )
        return;
      await api("submissions/" + draft.id + "/" + action, "POST", {
        version: draft.version,
        operation_id: operation(),
        reason,
      });
      await submissionQueue(c, status, offset);
    };
    table(
      c,
      [
        {
          key: "start_at",
          label: "时间",
          render: (r) => F.date(r.start_at) + " " + F.time(r.start_at),
        },
        { key: "course_name", label: "课程" },
        { key: "teacher_name", label: "教师" },
        {
          key: "status",
          label: "状态",
          render: (r) =>
            status === "overdue" ? "已过窗口仍未提交" : cnReview(r.status),
        },
        {
          key: "action",
          label: "处理",
          render: (r) =>
            status === "pending"
              ? b("通过", () => decide(r, "confirm"), "primary")
              : status === "overdue" && enabled("attendance", "update")
                ? b("点名销课", () => lessonDetail(c, { id: r.lesson_id }))
                : b("查看", () =>
                    reviewScreen(c, r.lesson_id, () =>
                      submissionQueue(c, status),
                    ),
                  ),
        },
      ],
      page.items,
      {
        pageSize: 0,
        complete: page.total <= page.items.length,
        total: page.total,
        serverPage: {
          offset,
          nextOffset: page.next_offset,
          size: 200,
          onPage: (n) => submissionQueue(c, status, n),
        },
        empty: "教师提交的点名和点评会按状态显示在这里。",
        emptyAction: {
          label: "查看未销课",
          onSelect: () => {
            location.hash = "todo-unchecked";
          },
        },
        rowAction: (r) =>
          reviewScreen(c, r.lesson_id, () => submissionQueue(c, status)),
        more:
          status === "pending"
            ? [{ label: "退回", onSelect: (r) => decide(r, "return") }]
            : [],
      },
    );
  };
  // 手工补课：只做“加入已有的同类课”（新开一节在补课面板里排，更直观）。
  // 先选日期范围，再从卡片里点一节课，写说明，确认。
  async function manualMakeup(c, data, part) {
    let from = todayBJ(),
      to = dateShift(todayBJ(), 30),
      picked = null;
    const op = operation();
    const list = n("div", null, { class: "v-mm-list", role: "radiogroup", "aria-label": "可以加入的课" }),
      note = U.field({ label: "补课说明（选填）", type: "textarea", required: false }),
      range = n("div", null, { class: "v-mm-range" });
    const view = U.drawer({
      title: "加入已有课程补课",
      subtitle: part.student_name + " · " + data.course_name + " · 原课 " + F.day(data.start_at) + " " + F.time(data.start_at),
      secondary: { label: "取消", onSelect: (v) => v.close() },
      primary: {
        label: "确认安排",
        onSelect: async (v) => {
          if (!picked) throw Error("请先点选一节课");
          const saved = await creditWrite(
            "makeups",
            { original_participant_id: part.id, note: note.input.value.trim(), force: false, target_lesson_id: picked },
            "POST",
            op,
          );
          if (!saved.committed) {
            notice("未保存：" + saved.conflicts.map((x) => x.reasons.join("、")).join("；"));
            return;
          }
          notice("已安排补课", "success");
          await v.close();
          await makeups(c);
        },
      },
    });
    const load = async () => {
      list.replaceChildren(n("p", "正在查找…", { class: "v-muted" }));
      const rows = await take("schedule?from=" + from + "&to=" + to);
      const candidates = rows.filter(
        (x) =>
          x.id !== data.id &&
          x.course_type_id === data.course_type_id &&
          !["cancelled", "rescheduled", "teacher_leave", "completed"].includes(x.status) &&
          !x.participant_student_ids?.includes(part.student_id),
      );
      list.replaceChildren();
      picked = null;
      if (!candidates.length) {
        list.append(n("p", "这段时间没有可以加入的“" + data.course_name + "”。可以换个日期范围，或回到补课面板新开一节。", { class: "v-muted" }));
        return;
      }
      for (const row of candidates) {
        const card = n("button", null, { type: "button", class: "v-mm-card", role: "radio", "aria-checked": "false" });
        card.append(
          n("strong", F.day(row.start_at) + " " + F.range(row.start_at, row.duration)),
          n("span", row.course_name + " · " + row.teacher_name + (row.location_name ? " · " + row.location_name : "")),
        );
        card.addEventListener("click", () => {
          picked = row.id;
          for (const x of list.querySelectorAll(".v-mm-card")) x.setAttribute("aria-checked", String(x === card));
        });
        list.append(card);
      }
    };
    for (const [key, label] of [
      ["from", "从"],
      ["to", "到"],
    ])
      range.append(
        U.datePicker({
          label,
          value: key === "from" ? from : to,
          onChange: (v) => {
            if (key === "from") from = v;
            else to = v;
            if (from > to || Date.parse(to) - Date.parse(from) > 30 * 86400000) {
              notice("日期范围最多 31 天");
              return;
            }
            void load().catch((e) => notice(e.message));
          },
        }).element,
      );
    view.body.append(n("h3", "在哪段时间里找", { class: "v-pay-h" }), range, n("h3", "点选一节课", { class: "v-pay-h" }), list, note.element);
    await load();
  }
  globalThis.ChannelRebuild = {
    legacy,
    manualMakeup,
    take,
    studentDetail,
    studentBlocks,
    goStudent,
    parseStudentHash,
    lessonPerson,
    unchecked,
    makeups,
    metric,
    table,
    tools,
  };
})();
