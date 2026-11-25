// Presentation-only calendar. All writes use the existing versioned lesson endpoint.
(() => {
  const shift = (date, n) =>
    new Date(Date.parse(date + "T12:00:00Z") + n * 86400000)
      .toISOString()
      .slice(0, 10);
  const monday = (date) =>
    shift(date, -((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7));
  const minutes = (value) =>
    Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
  const at = (date, min) =>
    date +
    "T" +
    String(Math.floor(min / 60)).padStart(2, "0") +
    ":" +
    String(min % 60).padStart(2, "0");
  const detailCache = new Map();
  const pendingDetails = new Map();
  const excluded = ["cancelled", "rescheduled", "teacher_leave"];
  function knownConflicts(
    row,
    start,
    lessons,
    details = new Map(),
    blocks = [],
  ) {
    const date = start.slice(0, 10),
      s = minutes(start),
      e = s + row.duration,
      reasons = new Set();
    const ids =
      row.participant_student_ids ||
      (details.get(row.id)?.participants || row.participants || []).map(
        (p) => p.student_id,
      );
    const teachers = [row.teacher_id, row.assistant_id].filter(Boolean);
    for (const other of lessons) {
      if (
        other.id === row.id ||
        other.start_at.slice(0, 10) !== date ||
        excluded.includes(other.status)
      )
        continue;
      const os = minutes(other.start_at);
      if (s >= os + other.duration || e <= os) continue;
      if (
        [other.teacher_id, other.assistant_id].some(
          (id) => id && teachers.includes(id),
        )
      )
        reasons.add("教师时间冲突");
      if (
        row.mode !== "online" &&
        other.mode !== "online" &&
        row.location_id &&
        row.location_id === other.location_id
      )
        reasons.add("教室时间冲突");
      if (
        (
          other.participant_student_ids?.map((student_id) => ({
            student_id,
          })) ||
          details.get(other.id)?.participants ||
          other.participants ||
          []
        ).some((p) => ids.includes(p.student_id))
      )
        reasons.add("学员时间冲突");
    }
    const weekday = (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7;
    for (const b of blocks)
      if (
        ids.includes(b.student_id) &&
        b.weekday === weekday &&
        b.active !== 0
      ) {
        const lo =
            Number(b.start_time.slice(0, 2)) * 60 +
            Number(b.start_time.slice(3, 5)),
          hi =
            Number(b.end_time.slice(0, 2)) * 60 +
            Number(b.end_time.slice(3, 5));
        if (s < hi && e > lo) reasons.add("学员不可排时段");
      }
    return [...reasons];
  }
  function layoutLanes(lessons) {
    const groups = [],
      map = new Map();
    for (const date of [
      ...new Set(lessons.map((r) => r.start_at.slice(0, 10))),
    ]) {
      let group = null,
        ends = [];
      for (const row of lessons
        .filter((r) => r.start_at.slice(0, 10) === date)
        .sort(
          (a, b) =>
            a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id),
        )) {
        const start = minutes(row.start_at),
          end = start + row.duration;
        if (!group || start >= group.end) {
          group = { date, start, end, count: 0, rows: [] };
          groups.push(group);
          ends = [];
        }
        let lane = ends.findIndex((t) => t <= start);
        if (lane < 0) lane = ends.length;
        ends[lane] = end;
        group.end = Math.max(group.end, end);
        group.count = Math.max(group.count, ends.length);
        group.rows.push(row);
        map.set(row.id, { lane, group });
      }
    }
    return { map, groups };
  }
  function visibleRange(rows) {
    const start = Math.min(
      480,
      ...rows.map((r) => Math.floor((minutes(r.start_at) - 30) / 15) * 15),
    );
    const end = Math.max(
      1200,
      ...rows.map(
        (r) => Math.ceil((minutes(r.start_at) + r.duration + 30) / 15) * 15,
      ),
    );
    return { start: Math.max(0, start), end: Math.min(1440, end) };
  }
  async function mount({
    container: UIHost,
    UI,
    api,
    choices,
    enabled,
    week,
    initialDate,
    view = "calendar",
    today,
    onNavigate,
    onOpen,
    onCreate,
    onTemplates,
    onExport,
    onError,
    labels,
  }) {
    UIHost.__calendarDestroy?.();
    const n = UI.node,
      host = n("section", null, { class: "b-calendar-page" }),
      toolbar = n("div", null, { class: "b-calendar-toolbar" }),
      viewport = n("div", null, { class: "b-calendar-viewport" }),
      status = n("p", "", {
        class: "ui-sr-only",
        role: "status",
        "aria-live": "polite",
      }),
      bottom = n("div", null, { class: "calendar-legend" });
    let date =
        initialDate &&
        initialDate >= monday(week) &&
        initialDate < shift(monday(week), 7)
          ? initialDate
          : today >= monday(week) && today < shift(monday(week), 7)
            ? today
            : monday(week),
      weekDate = monday(week),
      rows = [],
      details = new Map(),
      blocks = [],
      grid,
      scroller,
      drag = null,
      serial = 0,
      loading = false,
      filterTeacher = "",
      filterCategory = "",
      filterRoom = "",
      rangeStart = 480,
      rangeEnd = 1200,
      filterText = "",
      destroyed = false,
      refreshTimer,
      edgeTimer = 0,
      raf = 0,
      lastSwitch = 0;
    const mobile = matchMedia("(max-width: 760px)"),
      cleanup = [];
    let legendNames = [];
    const canMove = enabled("lessons", "update") && enabled("lessons", "read");
    const b = (label, fn, kind = "") => UI.button(label, { onClick: fn, kind });
    const heading = n("div", null, { class: "page-heading" });

    const more = [];
    const pageHead0 = typeof vHead !== "undefined" ? vHead : null;
    // 新外壳里“生成未来课程”只放在“固定排课”分页，周课表不再重复一个入口。
    if (enabled("templates") && !pageHead0)
      more.push({ label: "从固定排课生成", onSelect: onTemplates });
    if (enabled("exports", "export"))
      more.push({ label: "导出课表图", onSelect: onExport });
    // 第十阶段重构：本页动作放到页头（从固定排课生成、导出课表图、排课）；没有页头时退回原位置。
    const pageHead = typeof vHead !== "undefined" ? vHead : null;
    if (pageHead)
      pageHead.actions(
        ...more.map((m) => b(m.label, m.onSelect)),
        enabled("lessons", "create")
          ? b("排课", () => onCreate({}), "primary")
          : null,
      );
    else {
      if (more.length) heading.append(UI.actionMenu({ items: more }).element);
      if (enabled("lessons", "create"))
        heading.append(b("排课", () => onCreate({}), "primary"));
    }
    const step = b("‹", () => navigate(mobile.matches ? -1 : -7)),
      current = b("本周", () => navigateTo(today)),
      next = b("›", () => navigate(mobile.matches ? 1 : 7)),
      range = n("strong", "", { class: "calendar-range" }),
      stats = n("span", "", { class: "calendar-stats" });
    step.setAttribute("aria-label", "上一" + (mobile.matches ? "天" : "周"));
    next.setAttribute("aria-label", "下一" + (mobile.matches ? "天" : "周"));
    const nav = n("div", null, { class: "calendar-date-nav" });
    nav.append(step, current, next);
    const tabs = n("div", null, {
      class: "calendar-view-tabs",
      "aria-label": "课表视图",
    });
    for (const [key, label] of [
      ["calendar", "按时间"],
      ["teacher", "按教师"],
      ["room", "按教室"],
      ["list", "列表"],
    ])
      tabs.append(
        b(label, () => {
          if (drag) cancel();
          view = key;
          onNavigate(weekDate, view);
          render();
        }),
      );
    const teacherPicker = UI.selectControl({
        label: "教师",
        value: "",
        options: [{ value: "", label: "全部教师" }],
        onChange: (v) => {
          filterTeacher = v;
          render();
        },
      }),
      categoryPicker = UI.selectControl({
        label: "类别",
        value: "",
        options: [{ value: "", label: "全部类别" }],
        onChange: (v) => {
          filterCategory = v;
          render();
        },
      });
    const filterHost = n("div", null, { class: "calendar-filters" });
    filterHost.append(teacherPicker.element, categoryPicker.element);
    const searchField = UI.field({
      label: "本周课程搜索",
      name: "calendar_search",
      type: "search",
      required: false,
    });
    searchField.input.placeholder = "搜索本周已加载课程";
    searchField.input.maxLength = 100;
    searchField.input.addEventListener("input", () => {
      filterText = searchField.input.value;
      render();
    });
    searchField.element.classList.add("calendar-search");
    filterHost.append(searchField.element);
    let activeTeacherPicker = teacherPicker,
      activeCategoryPicker = categoryPicker;
    const filterTags = n("div", null, {
      class: "calendar-filter-tags ui-filter-chips",
    });
    filterHost.classList.add("ui-filter-bar");
    const filterPanel = n("section", null, {
      class: "ui-root calendar-filter-panel",
      popover: "auto",
    });
    filterPanel.append(filterHost);
    const filterButton = b("筛选", () =>
      filterPanel.showPopover({ source: filterButton }),
    );
    filterButton.classList.add("calendar-filter-button");
    toolbar.append(nav, range, stats, tabs, filterButton, filterPanel);
    // 电脑上筛选直接排在工具条里，手机上收进“筛选”弹层。
    const placeFilters = () => {
      if (mobile.matches) filterPanel.append(filterHost);
      else toolbar.insertBefore(filterHost, filterButton);
    };
    placeFilters();
    mobile.addEventListener("change", placeFilters);
    cleanup.push(() => mobile.removeEventListener("change", placeFilters));
    const chips = n("div", null, { class: "calendar-day-strip" }),
      instructions = n(
        "p",
        canMove
          ? "选中课程后按空格进入移动，方向键调整，Enter保存，Esc取消；手机可点“改时间”。筛选范围：本周已加载课程。"
          : "点击课程查看详情。筛选范围：本周已加载课程。",
        { class: "muted calendar-help" },
      );
    // 电脑上：周切换、视图、筛选直接放进顶栏下那一行（和“导出课表图 / 排课”同一行），
    // 本周统计放到标题旁边，页面里不再多一条空白。
    const inBar = pageHead && !mobile.matches;
    if (inBar) {
      toolbar.classList.add("is-in-bar");
      pageHead.bar(toolbar);
      const sub = document.querySelector(".v-head-sub");
      toolbar.insertBefore(range, nav.nextSibling);
      if (sub) sub.replaceChildren(stats);
    }
    host.append(
      heading,
      ...(inBar ? [] : [toolbar]),
      filterTags,
      chips,
      viewport,
      bottom,
      instructions,
      status,
    );
    UIHost.replaceChildren(host);
    function stop() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearInterval(refreshTimer);
      clearTimeout(edgeTimer);
      cleanup.forEach((fn) => fn());
      teacherPicker.destroy();
      categoryPicker.destroy();
    }
    UIHost.__calendarDestroy = stop;
    async function fetchRows(w) {
      const result = [];
      for (let offset = 0; ; offset += 200) {
        const page = await api(
          "schedule?from=" + w + "&to=" + shift(w, 7) + "&offset=" + offset,
        );
        result.push(...page.items);
        if (page.next_offset === null) break;
      }
      return result;
    }
    async function load(direction = 0) {
      const id = ++serial;
      loading = true;
      host.setAttribute("aria-busy", "true");
      if (!rows.length) viewport.replaceChildren(UI.tableSkeleton());
      else viewport.classList.add("is-loading");
      try {
        const list = await fetchRows(weekDate);
        if (id !== serial || destroyed || !host.isConnected) return;
        rows = list;
        details = new Map(
          list
            .filter((r) => detailCache.get(r.id)?.version === r.version)
            .map((r) => [r.id, detailCache.get(r.id)]),
        );
        render(direction);
      } catch (e) {
        onError(e.message);
        if (!rows.length)
          viewport.replaceChildren(
            UI.emptyState("课表加载失败", "保留当前日期，可重新加载。", {
              action: b("重试", () => load()),
            }),
          );
        throw e;
      } finally {
        if (id === serial) {
          loading = false;
          host.removeAttribute("aria-busy");
          viewport.classList.remove("is-loading");
        }
      }
    }
    async function ensureDetail(row) {
      const cached = detailCache.get(row.id);
      if (cached?.version === row.version) {
        details.set(row.id, cached);
        return cached;
      }
      if (pendingDetails.has(row.id)) return pendingDetails.get(row.id);
      const promise = api("data/lessons/" + row.id)
        .then((result) => {
          detailCache.set(row.id, result.record);
          details.set(row.id, result.record);
          return result.record;
        })
        .finally(() => pendingDetails.delete(row.id));
      pendingDetails.set(row.id, promise);
      return promise;
    }
    async function primeRelevant(row, start) {
      if (!canMove) return;
      const min = minutes(start),
        date = start.slice(0, 10);
      const relevant = [
        row,
        ...rows.filter(
          (r) =>
            r.id !== row.id &&
            !r.source_course_id &&
            !excluded.includes(r.status) &&
            r.start_at.slice(0, 10) === date &&
            min < minutes(r.start_at) + r.duration &&
            min + row.duration > minutes(r.start_at),
        ),
      ];
      await Promise.all(
        relevant
          .filter((r) => !r.participant_student_ids)
          .map((r) => ensureDetail(r)),
      );
    }
    async function navigateTo(value) {
      if (loading) return;
      date = value;
      const old = weekDate;
      weekDate = monday(value);
      onNavigate(weekDate, view);
      if (old !== weekDate) await load(value > old ? 1 : -1);
      else render();
    }
    async function navigate(delta) {
      const target = mobile.matches
        ? shift(date, delta)
        : shift(weekDate, delta);
      await navigateTo(target);
    }
    function shown() {
      return rows.filter(
        (row) =>
          (!filterTeacher ||
            [row.teacher_id, row.assistant_id].includes(filterTeacher)) &&
          (!filterCategory || row.category_color === filterCategory) &&
          (!filterRoom || (row.location_id || "online") === filterRoom) &&
          (!filterText ||
            [
              row.course_name,
              row.teacher_name,
              row.location_name,
              ...(row.participants_summary?.names || []),
              labels[row.status],
            ].some((text) =>
              String(text || "")
                .toLocaleLowerCase("zh-CN")
                .includes(filterText.toLocaleLowerCase("zh-CN")),
            )),
      );
    }
    function selectableRows() {
      return shown().filter(
        (row) => !mobile.matches || row.start_at.slice(0, 10) === date,
      );
    }
    function lessonButton(row) {
      const color = [
        "#8B7BB5",
        "#5B8DB8",
        "#62A598",
        "#C99A54",
        "#B7768C",
        "#7B93AB",
        "#A48B69",
        "#8C9D62",
      ].indexOf(row.category_color);
      const button = b("", () => {
        if (button.dataset.suppress === "true") {
          button.dataset.suppress = "false";
          return;
        }
        if (!drag) return onOpen(row);
      });
      button.classList.add(
        "course-card",
        "b-course",
        "color-" + Math.max(0, color),
        "status-" + row.status,
      );
      button.dataset.lesson = row.id;
      const p = row.participants_summary || { count: 0, names: [] },
        student =
          p.count > 1
            ? (p.class_name || row.course_name) + " · " + p.count + "人"
            : p.names[0] || "暂无参课学员";
      const room =
          row.mode === "online" ? "线上课" : row.location_name || "未设置教室",
        text =
          UI.fmt.day(row.start_at) +
          " " +
          UI.fmt.range(row.start_at, row.duration) +
          " · " +
          student +
          " · " +
          row.course_name +
          " · " +
          row.teacher_name +
          " · " +
          room +
          " · " +
          (labels[row.status] || "未知状态");
      button.title = text;
      button.setAttribute("aria-label", text);
      const head = n("strong");
      // 时间与学生名分开包裹：窄列时可分两行完整显示，文字内容不变。
      head.append(
        n("time", row.start_at.slice(11, 16)),
        " ",
        n("span", student, { class: "b-course-who" }),
      );
      // 课程名和教室分开：两道、三道并排的窄卡片只显示课程名，教室在悬停提示和详情里。
      const courseLine = n("span", row.course_name, { class: "b-course-line" });
      if (view !== "room") courseLine.append(n("span", " · " + room, { class: "b-course-room" }));
      button.append(head, courseLine);
      if (view !== "teacher") button.append(n("small", row.teacher_name));
      if (row.status === "planned" && Date.parse(row.start_at) <= Date.now()) {
        button.classList.add("is-unchecked");
        button.append(n("span", "未销课", { class: "ui-sr-only" }));
      }
      if (knownConflicts(row, row.start_at, rows, details, blocks).length)
        button.classList.add("has-conflict");
      if (canMove && row.status === "planned" && !row.source_course_id) {
        button.setAttribute(
          "aria-description",
          "空格进入移动，方向键调整时间，Enter保存，Escape取消",
        );
        button.addEventListener("pointerdown", (e) => {
          if (e.pointerType === "touch" || e.button !== 0 || drag) return;
          void ensureDetail(row).catch(() => {});
          drag = {
            row,
            button,
            x: e.clientX,
            y: e.clientY,
            px: e.clientX,
            py: e.clientY,
            start: row.start_at.slice(0, 16),
            active: false,
            keyboard: false,
            pointerId: e.pointerId,
          };
        });
        button.addEventListener("keydown", async (e) => {
          if (e.key === " " && !drag) {
            e.preventDefault();
            void ensureDetail(row).catch(() => {});
            drag = {
              row,
              button,
              start: row.start_at.slice(0, 16),
              active: true,
              keyboard: true,
            };
            button.classList.add("is-dragging");
            status.textContent = "移动课程：方向键调整，Enter保存，Esc取消";
            return;
          }
          if (!drag || drag.row.id !== row.id || !drag.keyboard) return;
          if (
            [
              "ArrowUp",
              "ArrowDown",
              "ArrowLeft",
              "ArrowRight",
              "Enter",
              "Escape",
            ].includes(e.key)
          ) {
            e.preventDefault();
            e.stopPropagation();
          }
          if (e.key === "Escape") cancel();
          else if (e.key === "Enter") {
            button.dataset.suppress = "true";
            await finish();
          } else if (e.key.startsWith("Arrow")) {
            let min = minutes(drag.start),
              d = drag.start.slice(0, 10);
            if (e.key === "ArrowUp") min -= 15;
            if (e.key === "ArrowDown") min += 15;
            if (e.key === "ArrowLeft") d = shift(d, -1);
            if (e.key === "ArrowRight") d = shift(d, 1);
            min = Math.max(0, Math.min(1440 - row.duration, min));
            drag.start = at(d, min);
            void primeRelevant(row, drag.start)
              .then(() => {
                if (drag) drawTarget();
              })
              .catch(() => {});
            if (monday(d) !== weekDate) {
              weekDate = monday(d);
              date = d;
              onNavigate(weekDate, view);
              await load(e.key === "ArrowLeft" ? -1 : 1);
            }
            drawTarget();
            status.textContent = "移动至 " + drag.start.replace("T", " ");
          }
        });
      }
      return button;
    }
    function position(element, start, duration) {
      const day = mobile.matches
        ? 0
        : Math.max(
            0,
            Math.min(
              6,
              Math.floor(
                (Date.parse(start.slice(0, 10) + "T12:00:00Z") -
                  Date.parse(weekDate + "T12:00:00Z")) /
                  86400000,
              ),
            ),
          );
      element.className = element.className.replace(
        /\bcal-(?:day|slot|span)-\d+\b/g,
        "",
      );
      element.classList.add(
        "cal-day-" + day,
        "cal-slot-" + Math.floor(minutes(start) / 15),
        "cal-span-" + Math.max(1, Math.ceil(duration / 15)),
      );
    }
    function paintTime() {
      if (!grid || !host.isConnected) return;
      grid.querySelector(".current-time-line")?.remove();
      const bj = new Date(Date.now() + 8 * 3600000),
        d = bj.toISOString().slice(0, 10),
        min = bj.getUTCHours() * 60 + bj.getUTCMinutes();
      if (
        d < weekDate ||
        d >= shift(weekDate, 7) ||
        min < rangeStart ||
        min > rangeEnd ||
        (mobile.matches && d !== date)
      )
        return;
      const line = n("div", null, {
        class: "current-time-line now-offset-" + (min % 15),
        "aria-label":
          "北京时间 " +
          String(bj.getUTCHours()).padStart(2, "0") +
          ":" +
          String(bj.getUTCMinutes()).padStart(2, "0"),
      });
      position(line, at(d, min), 15);
      grid.append(line);
    }
    function render(direction = 0) {
      if (destroyed) return;
      const scroll = scroller?.scrollTop,
        restore = direction === 0 && scroll !== undefined;
      range.textContent = mobile.matches
        ? date
        : weekDate + " — " + shift(weekDate, 6);
      current
        .querySelector("span span")
        ?.replaceChildren(
          document.createTextNode(mobile.matches ? "今天" : "本周"),
        );
      tabs
        .querySelectorAll("button")
        .forEach((x, i) =>
          x.setAttribute(
            "aria-pressed",
            String(["calendar", "teacher", "room", "list"][i] === view),
          ),
        );
      filterTags.replaceChildren();
      for (const [key, value, label] of [
        ["teacher", filterTeacher, "教师筛选"],
        ["category", filterCategory, "类别筛选"],
        ["text", filterText, "搜索：" + filterText],
      ])
        if (value)
          filterTags.append(
            b(label + " ×", () => {
              if (key === "teacher") {
                filterTeacher = "";
                activeTeacherPicker.setValue("");
              }
              if (key === "category") {
                filterCategory = "";
                activeCategoryPicker.setValue("");
              }
              if (key === "text") {
                filterText = "";
                searchField.input.value = "";
              }
              render();
              searchField.input.focus();
            }),
          );
      if (filterRoom)
        filterTags.append(
          b(
            "教室：" +
              (resourceLists.room?.find((r) => r.id === filterRoom)?.name ||
                "线上课") +
              " ×",
            () => {
              filterRoom = "";
              roomPicker?.setValue("");
              render();
            },
          ),
        );
      if (filterTeacher || filterCategory || filterRoom || filterText)
        filterTags.append(
          b("清除全部筛选", () => {
            filterTeacher = "";
            filterCategory = "";
            filterRoom = "";
            roomPicker?.setValue("");
            filterText = "";
            searchField.input.value = "";
            activeTeacherPicker.setValue("");
            activeCategoryPicker.setValue("");
            render();
            searchField.input.focus();
          }),
        );
      chips.replaceChildren();
      for (let day = 0; day < 7; day++) {
        const d = shift(weekDate, day),
          button = b(
            "周" +
              ["一", "二", "三", "四", "五", "六", "日"][day] +
              " " +
              d.slice(8),
            () => {
              date = d;
              render();
            },
          );
        button.setAttribute("aria-pressed", String(d === date));
        chips.append(button);
      }
      viewport.classList.remove("week-forward", "week-backward");
      void viewport.offsetWidth;
      if (direction)
        viewport.classList.add(
          direction > 0 ? "week-forward" : "week-backward",
        );
      if (view !== "calendar") {
        grid = null;
        renderAlternative();
        return;
      }
      const rangeBounds = visibleRange(rows);
      rangeStart = rangeBounds.start;
      rangeEnd = rangeBounds.end;
      grid = n("div", null, {
        class:
          "b-week-grid c2-grid c2-start-" +
          Math.floor(rangeStart / 15) +
          " c2-count-" +
          Math.ceil((rangeEnd - rangeStart) / 15) +
          (mobile.matches ? " is-day" : ""),
      });
      const days = mobile.matches ? 1 : 7;
      grid.append(n("div", "时间", { class: "cal-corner" }));
      for (let day = 0; day < days; day++) {
        const d = mobile.matches ? date : shift(weekDate, day),
          h = n("div", null, {
            class:
              "cal-column-head cal-day-" +
              day +
              (d === today ? " is-today" : ""),
          });
        h.append(
          n(
            "strong",
            "周" +
              ["日", "一", "二", "三", "四", "五", "六"][
                new Date(d + "T12:00:00Z").getUTCDay()
              ],
          ),
          n(
            "small",
            d.slice(5) +
              " · " +
              shown().filter((x) => x.start_at.slice(0, 10) === d).length +
              " 节",
          ),
        );
        grid.append(h);
      }
      for (let min = rangeStart; min < rangeEnd; min += 60)
        grid.append(
          n(
            "time",
            String(Math.floor(min / 60)).padStart(2, "0") +
              ":" +
              String(min % 60).padStart(2, "0"),
            { class: "cal-hour cal-slot-" + Math.floor(min / 15) },
          ),
        );
      for (let day = 0; day < days; day++)
        grid.append(n("div", null, { class: "cal-background cal-day-" + day }));
      const list = selectableRows(),
        layout = layoutLanes(list),
        // 桌面周视图最多并排2道，第3节起收进“＋N 节”，一屏能看完整周；手机日视图仍为3道。
        maxLanes = mobile.matches ? 3 : 2;
      for (const row of list) {
        const item = layout.map.get(row.id);
        if (item.group.count > maxLanes && item.lane >= maxLanes - 1) continue;
        const card = lessonButton(row);
        position(card, row.start_at, row.duration);
        card.classList.add(
          "lanes-" + Math.min(maxLanes, item.group.count),
          "lane-" + item.lane,
        );
        grid.append(card);
      }
      for (const group of layout.groups.filter((g) => g.count > maxLanes)) {
        const hidden = group.rows.filter(
          (r) => layout.map.get(r.id).lane >= maxLanes - 1,
        );
        // 同一时段课太多时：“＋N 节”点开一个贴着按钮的小列表，按时间列出这一段的全部课，点一节直接打开。
        const pop = n("div", null, { class: "ui-root v-cal-pop", popover: "auto", "aria-label": "同时段的课" });
        const more = b("＋" + hidden.length + " 节", () => {
          pop.replaceChildren(n("div", UI.fmt.day(group.date) + " · 同时段 " + group.rows.length + " 节", { class: "v-cal-pop-head" }));
          for (const row of [...group.rows].sort((x, y) => String(x.start_at).localeCompare(String(y.start_at)))) {
            const color = ["#8B7BB5", "#5B8DB8", "#62A598", "#C99A54", "#B7768C", "#7B93AB", "#A48B69", "#8C9D62"].indexOf(row.category_color);
            const p = row.participants_summary || { count: 0, names: [] };
            const item = n("button", null, { type: "button", class: "v-cal-pop-item color-" + Math.max(0, color) + " status-" + row.status });
            item.append(
              n("strong", UI.fmt.range(row.start_at, row.duration)),
              n("span", p.count > 1 ? (p.class_name || row.course_name) + " · " + p.count + " 人" : p.names[0] || "暂无学员"),
              n("small", row.course_name + " · " + (row.teacher_name || "未定老师") + (row.location_name ? " · " + row.location_name : "")),
            );
            item.addEventListener("click", async () => {
              pop.hidePopover();
              await onOpen(row);
            });
            pop.append(item);
          }
          pop.showPopover({ source: more });
        });
        grid.append(pop);
        more.classList.add(
          "b-course",
          "lanes-" + maxLanes,
          "lane-" + (maxLanes - 1),
          "c2-overflow",
        );
        position(more, at(group.date, group.start), group.end - group.start);
        grid.append(more);
      }
      grid.addEventListener("click", (e) => {
        if (!enabled("lessons", "create") || e.target.closest("button") || drag)
          return;
        const target = targetAt(e.clientX, e.clientY);
        if (target) void onCreate({ start_at: target });
      });
      scroller = n("div", null, {
        class: "b-calendar-scroll",
        tabindex: "0",
        "aria-label": mobile.matches
          ? "日课表，滑动切换日期"
          : "周课表时间网格",
      });
      scroller.append(grid);
      viewport.replaceChildren(scroller);
      const currentWeek = today >= weekDate && today < shift(weekDate, 7),
        first =
          (currentWeek
            ? list.filter(
                (r) =>
                  r.start_at.slice(0, 10) === today && r.status !== "completed",
              )
            : list
          ).sort((a, b) => a.start_at.localeCompare(b.start_at))[0] || list[0];
      if (!restore && initialDate && view === "calendar" && !mobile.matches)
        scroller.scrollLeft =
          Math.max(
            0,
            Math.floor(
              (Date.parse(date + "T12:00Z") -
                Date.parse(weekDate + "T12:00Z")) /
                86400000,
            ),
          ) * 336;
      scroller.scrollTop = restore
        ? scroll
        : Math.max(
            0,
            (((first ? minutes(first.start_at) - 30 : 480) - rangeStart) * 22) /
              15,
          );
      if (mobile.matches && canMove) {
        const tools = n("div", null, { class: "mobile-move-tools" });
        for (const row of list.filter(
          (x) => x.status === "planned" && !x.source_course_id,
        ))
          tools.append(
            b(
              row.start_at.slice(11, 16) + " " + row.course_name + " · 改时间",
              () => moveDialog(row),
            ),
          );
        viewport.append(tools);
      }
      const nowMs = Date.now(),
        doneCount = rows.filter((r) => r.status === "completed").length,
        lateCount = rows.filter(
          (r) => r.status === "planned" && Date.parse(r.start_at) <= nowMs,
        ).length;
      stats.replaceChildren(
        n("span", rows.length + " 节 · 已上 " + doneCount),
        ...(lateCount
          ? [n("span", " · 待销课 " + lateCount, { class: "calendar-late" })]
          : []),
      );
      bottom.replaceChildren();
      for (const color of [
        ...new Set(rows.map((r) => r.category_color).filter(Boolean)),
      ]) {
        const index = Math.max(
          0,
          [
            "#8B7BB5",
            "#5B8DB8",
            "#62A598",
            "#C99A54",
            "#B7768C",
            "#7B93AB",
            "#A48B69",
            "#8C9D62",
          ].indexOf(String(color).toUpperCase()),
        );
        const item = n("span", null, { class: "calendar-legend-item" });
        item.append(
          n("i", null, { class: "calendar-swatch color-" + index }),
          document.createTextNode(
            legendNames.find(
              (c) =>
                String(c.color || "").toUpperCase() ===
                String(color).toUpperCase(),
            )?.name || "课程类别",
          ),
        );
        bottom.append(item);
      }
      bottom.append(
        n("span", "淡色 = 已上完", { class: "calendar-legend-note" }),
        n("span", "● 红点 = 过点未销课", {
          class: "calendar-legend-note calendar-late",
        }),
        n(
          "span",
          "共 " +
            rows.length +
            " 节（本周已加载）" +
            (canMove ? " · 点空白格子可直接排课；拖动卡片改时间" : ""),
          { class: "calendar-legend-note" },
        ),
      );
      paintTime();
      drawTarget();
      if (drag?.keyboard) {
        const active = host.querySelector(
          '[data-lesson="' + drag.row.id + '"]',
        );
        if (active) {
          drag.button = active;
          active.focus();
        }
      }
    }
    let resourceLists = {},
      roomPicker;
    function renderAlternative() {
      const list = selectableRows();
      if (view === "list") {
        const listing = UI.dataList({
          label: "课程列表",
          items: list,
          searchable: true,
          columns: [
            {
              key: "start_at",
              label: "上课时间",
              sortable: true,
              render: (r) => r.start_at.slice(0, 16).replace("T", " "),
            },
            {
              key: "student",
              label: "学生",
              render: (r) => {
                const p = r.participants_summary;
                return p?.count > 1
                  ? (p.class_name || r.course_name) + " · " + p.count + "人"
                  : p?.names[0] || "暂无参课学员";
              },
            },
            { key: "course_name", label: "课程", sortable: true },
            { key: "teacher_name", label: "主讲", sortable: true },
            {
              key: "status",
              label: "状态",
              render: (r) => labels[r.status] || "未知状态",
              searchValue: (r) => labels[r.status] || "",
            },
          ],
          onOpen: onOpen,
        });
        viewport.replaceChildren(listing.element);
        return;
      }
      const field = view === "teacher" ? "teacher_id" : "location_id",
        nameField = view === "teacher" ? "teacher_name" : "location_name";
      const people = new Map(
        (resourceLists[view] || []).map((x) => [x.id, x.name]),
      );
      for (const row of list) {
        people.set(row[field] || "online", row[nameField] || "线上课");
        if (
          view === "teacher" &&
          row.assistant_id &&
          !people.has(row.assistant_id)
        )
          people.set(row.assistant_id, "助教课程");
      }
      const table = n("table", null, {
          class: "ui-table calendar-resource-table",
        }),
        thead = n("thead"),
        head = n("tr");
      head.append(n("th", view === "teacher" ? "教师" : "教室"));
      for (let day = 0; day < (mobile.matches ? 1 : 7); day++)
        head.append(
          n("th", (mobile.matches ? date : shift(weekDate, day)).slice(5)),
        );
      thead.append(head);
      table.append(thead);
      const body = n("tbody");
      for (const [id, name] of people) {
        const tr = n("tr");
        tr.append(n("th", name, { scope: "row" }));
        for (let day = 0; day < (mobile.matches ? 1 : 7); day++) {
          const d = mobile.matches ? date : shift(weekDate, day),
            td = n("td");
          for (const row of list.filter(
            (r) =>
              r.start_at.slice(0, 10) === d &&
              (view === "teacher"
                ? [r.teacher_id, r.assistant_id].includes(id)
                : (r.location_id || "online") === id),
          ))
            td.append(lessonButton(row));
          tr.append(td);
        }
        body.append(tr);
      }
      table.append(body);
      const wrap = n("div", null, { class: "calendar-resource-wrap" });
      wrap.append(table);
      viewport.replaceChildren(wrap);
      if (!people.size)
        wrap.append(UI.emptyState("暂无课程", "当前筛选条件下没有课程。"));
    }
    function targetAt(x, y) {
      if (!grid) return null;
      const r = grid.getBoundingClientRect(),
        dayWidth = (r.width - 56) / (mobile.matches ? 1 : 7),
        day = Math.floor((x - r.left - 56) / dayWidth),
        slot = Math.round((y - r.top - 60) / 22);
      if (day < 0 || day >= (mobile.matches ? 1 : 7) || slot < 0) return null;
      const min = Math.max(
        0,
        Math.min(1440 - (drag?.row.duration || 15), slot * 15 + rangeStart),
      );
      return at(mobile.matches ? date : shift(weekDate, day), min);
    }
    function drawTarget() {
      grid
        ?.querySelectorAll(".move-target,.move-ghost")
        .forEach((x) => x.remove());
      if (!grid || !drag?.active) return;
      const reasons = knownConflicts(
          drag.row,
          drag.start,
          rows,
          details,
          blocks,
        ),
        target = n(
          "div",
          reasons.length
            ? reasons.join("、") +
                "：" +
                rows
                  .filter(
                    (r) =>
                      r.id !== drag.row.id &&
                      r.start_at.slice(0, 10) === drag.start.slice(0, 10) &&
                      minutes(r.start_at) <
                        minutes(drag.start) + drag.row.duration &&
                      minutes(r.start_at) + r.duration > minutes(drag.start),
                  )
                  .map(
                    (r) =>
                      (r.participants_summary?.names || []).join("、") ||
                      r.teacher_name,
                  )
                  .join("、")
            : "可放 · " + drag.start.slice(11),
          { class: "move-target" + (reasons.length ? " is-conflict" : "") },
        );
      position(target, drag.start, drag.row.duration);
      grid.append(target);
      const ghost = drag.button.cloneNode(true);
      ghost.classList.add("move-ghost");
      ghost.removeAttribute("data-lesson");
      ghost.removeAttribute("tabindex");
      ghost.setAttribute("aria-hidden", "true");
      ghost.disabled = true;
      position(ghost, drag.start, drag.row.duration);
      grid.append(ghost);
    }
    async function commit(row, start) {
      await primeRelevant(row, start);
      const reasons = knownConflicts(row, start, rows, details, blocks);
      if (reasons.length) throw Error("未保存：" + reasons.join("、"));
      const latest =
        details.get(row.id) || (await api("data/lessons/" + row.id)).record;
      const result = await api("data/lessons/" + row.id, "PATCH", {
        start_at: start,
        version: latest.version,
      });
      if (result.committed === false)
        throw Error(
          "未保存：" +
            result.conflicts.map((x) => x.reasons.join("、")).join("；"),
        );
      return result;
    }
    async function finish() {
      if (!drag) return;
      const moving = drag;
      drag = null;
      cancelAnimationFrame(raf);
      clearTimeout(edgeTimer);
      grid
        ?.querySelectorAll(".move-target,.move-ghost")
        .forEach((x) => x.remove());
      moving.button.classList.remove("is-dragging");
      moving.button.dataset.suppress = "true";
      if (moving.start === moving.row.start_at.slice(0, 16)) return;
      moving.button.disabled = true;
      moving.button.setAttribute("aria-busy", "true");
      const old = moving.row.start_at;
      moving.row.start_at = moving.start + "+08:00";
      render();
      const pending = host.querySelector(
        '[data-lesson="' + moving.row.id + '"]',
      );
      pending?.setAttribute("aria-busy", "true");
      if (pending) pending.disabled = true;
      try {
        await commit({ ...moving.row, start_at: old }, moving.start);
        UI.toast("调课已保存");
        await load();
        const saved = host.querySelector(
          '[data-lesson="' + moving.row.id + '"]',
        );
        saved?.classList.add("is-saved");
        saved?.focus();
        status.textContent = "调课成功";
      } catch (e) {
        moving.row.start_at = old;
        if (monday(old.slice(0, 10)) !== weekDate) {
          weekDate = monday(old.slice(0, 10));
          date = old.slice(0, 10);
          onNavigate(weekDate, view);
          await load();
        } else render();
        const back = host.querySelector(
          '[data-lesson="' + moving.row.id + '"]',
        );
        back?.classList.add("is-returning");
        back?.focus();
        onError(e.message);
        status.textContent = e.message;
      } finally {
        moving.button.disabled = false;
        moving.button.removeAttribute("aria-busy");
      }
    }
    function cancel() {
      if (!drag) return;
      const moving = drag;
      drag = null;
      cancelAnimationFrame(raf);
      clearTimeout(edgeTimer);
      moving.button.classList.remove("is-dragging");
      moving.button.dataset.suppress = "true";
      grid
        ?.querySelectorAll(".move-target,.move-ghost")
        .forEach((x) => x.remove());
      moving.button.focus();
      status.textContent = "已取消移动，课程时间未变";
      if (monday(moving.row.start_at.slice(0, 10)) !== weekDate) {
        date = moving.row.start_at.slice(0, 10);
        weekDate = monday(date);
        onNavigate(weekDate, view);
        void load().catch(() => {});
      }
    }
    function tick() {
      if (!drag?.active || drag.keyboard || destroyed) return;
      const rect = scroller?.getBoundingClientRect();
      if (rect) {
        const speed =
          drag.py < rect.top + 56 ? -12 : drag.py > rect.bottom - 56 ? 12 : 0;
        if (speed) scroller.scrollTop += speed;
        const target = targetAt(drag.px, drag.py);
        if (target) drag.start = target;
        drawTarget();
        if (
          (drag.px < rect.left + 16 || drag.px > rect.right - 32) &&
          Date.now() - lastSwitch > 1000 &&
          !loading
        ) {
          lastSwitch = Date.now();
          const delta = drag.px < rect.left + 16 ? -7 : 7;
          weekDate = shift(weekDate, delta);
          date = shift(date, delta);
          onNavigate(weekDate, view);
          void load(delta > 0 ? 1 : -1)
            .then(() => {
              if (drag) {
                drag.start = at(
                  shift(weekDate, delta > 0 ? 0 : 6),
                  minutes(drag.start),
                );
                drawTarget();
              }
            })
            .catch(() => cancel());
        }
      }
      raf = requestAnimationFrame(tick);
    }
    const pointerMove = (e) => {
      if (!drag || drag.keyboard) return;
      drag.px = e.clientX;
      drag.py = e.clientY;
      if (
        !drag.active &&
        Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6
      ) {
        drag.active = true;
        drag.button.classList.add("is-dragging");
        drag.button.dataset.suppress = "true";
        raf = requestAnimationFrame(tick);
      }
      if (drag.active) {
        e.preventDefault();
        const target = targetAt(e.clientX, e.clientY);
        if (target && target !== drag.start) {
          drag.start = target;
          void primeRelevant(drag.row, target)
            .then(() => {
              if (drag) drawTarget();
            })
            .catch(() => {});
        }
        drawTarget();
      }
    };
    const pointerUp = () => {
      if (!drag || drag.keyboard) return;
      if (drag.active) void finish();
      else drag = null;
    };
    const key = (e) => {
      if (e.key === "Escape" && drag) {
        e.preventDefault();
        cancel();
      }
    };
    document.addEventListener("pointermove", pointerMove, { passive: false });
    document.addEventListener("pointerup", pointerUp);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", key);
    cleanup.push(
      () => document.removeEventListener("pointermove", pointerMove),
      () => document.removeEventListener("pointerup", pointerUp),
      () => document.removeEventListener("pointercancel", cancel),
      () => document.removeEventListener("keydown", key),
    );
    let touchStart;
    viewport.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 1)
          touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      },
      { passive: true },
    );
    viewport.addEventListener(
      "touchend",
      (e) => {
        if (!touchStart || !mobile.matches) return;
        const dx = e.changedTouches[0].clientX - touchStart.x,
          dy = e.changedTouches[0].clientY - touchStart.y;
        touchStart = null;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5)
          void navigate(dx < 0 ? 1 : -1);
      },
      { passive: true },
    );
    const resize = () => {
      if (drag) cancel();
      render();
    };
    mobile.addEventListener("change", resize);
    cleanup.push(() => mobile.removeEventListener("change", resize));
    async function moveDialog(row) {
      let dirty = false;
      const dlg = UI.overlay({
          title: "调整课程时间",
          kind: "drawer",
          isDirty: () => dirty,
        }),
        form = n("form"),
        picker = UI.dateControl({
          label: "日期（北京时间）",
          value: row.start_at.slice(0, 10),
          onChange: () => {
            dirty = true;
          },
        }),
        times = UI.selectControl({
          label: "上课时间",
          value: row.start_at.slice(11, 16),
          onChange: () => {
            dirty = true;
          },
          options: Array.from({ length: 96 }, (_, i) => {
            const text = at(today, i * 15).slice(11);
            return { value: text, label: text };
          }),
        });
      dlg.element.addEventListener(
        "close",
        () => {
          picker.destroy();
          times.destroy();
        },
        { once: true },
      );
      form.append(
        picker.element,
        times.element,
        n("p", "只调整上课时间，课程名单、课时及其他设置保持原样。", {
          class: "muted",
        }),
      );
      dlg.body.append(form);
      dlg.footer.append(
        b(
          "保存调课",
          async () => {
            const start = picker.value + "T" + times.value;
            if (minutes(start) + row.duration > 1440)
              throw Error("课程不能跨越当天24:00");
            dlg.setBusy(true);
            try {
              await commit(row, start);
              await dlg.close();
              date = start.slice(0, 10);
              weekDate = monday(date);
              onNavigate(weekDate, view);
              await load();
              UI.toast("调课已保存");
            } finally {
              dlg.setBusy(false);
            }
          },
          "primary",
        ),
      );
    }
    refreshTimer = setInterval(() => {
      if (!host.isConnected) {
        stop();
        return;
      }
      paintTime();
    }, 60000);
    if (enabled("students")) {
      void choices("student_schedule_blocks")
        .then((list) => {
          blocks = list;
        })
        .catch(() => {});
    }
    // Filter choices come from the same authorized week snapshot, without new permissions.
    // 筛选用的教师、教室、大类名单与本周课程同时请求，不再等课程画完才开始取。
    const lists = enabled("settings")
      ? Promise.all([choices("teachers"), choices("locations"), choices("course_categories")])
      : null;
    lists?.catch(() => {});
    await load();
    let categories = [];
    if (lists) {
      try {
        const [teachers, rooms, cats] = await lists;
        resourceLists = { teacher: teachers, room: rooms };
        categories = cats;
        legendNames = cats.some((x) => x.color)
          ? cats
          : (await api("data/course_categories").catch(() => ({ items: [] })))
              .items || [];
        render();
      } catch {
        /* snapshot still supplies permitted options */
      }
    }
    const teachers = (
      resourceLists.teacher || [
        ...new Map(
          rows.map((r) => [
            r.teacher_id,
            { id: r.teacher_id, name: r.teacher_name },
          ]),
        ).values(),
      ]
    ).map((r) => ({ value: r.id, label: r.name }));
    const colors = [
      ...new Set(rows.map((r) => r.category_color).filter(Boolean)),
    ];
    teacherPicker.destroy();
    categoryPicker.destroy();
    const tp = UI.selectControl({
        label: "教师",
        options: [{ value: "", label: "全部教师" }, ...teachers],
        value: "",
        onChange: (v) => {
          filterTeacher = v;
          render();
        },
      }),
      cp = UI.selectControl({
        label: "类别",
        options: [
          { value: "", label: "全部类别" },
          ...colors.map((color, i) => ({
            value: color,
            label:
              categories.find((c) => c.color === color)?.name ||
              "颜色类别 " + (i + 1),
          })),
        ],
        value: "",
        onChange: (v) => {
          filterCategory = v;
          render();
        },
      });
    activeTeacherPicker = tp;
    activeCategoryPicker = cp;
    roomPicker = UI.selectControl({
      label: "教室",
      value: filterRoom,
      options: [
        { value: "", label: "全部教室" },
        { value: "online", label: "线上课" },
        ...(resourceLists.room || []).map((x) => ({
          value: x.id,
          label: x.name,
        })),
      ],
      onChange: (v) => {
        filterRoom = v;
        render();
      },
    });
    filterHost.replaceChildren(
      tp.element,
      cp.element,
      roomPicker.element,
      searchField.element,
    );
    cleanup.push(() => roomPicker.destroy());
    cleanup.push(
      () => tp.destroy(),
      () => cp.destroy(),
    );
    return { host, destroy: stop };
  }
  globalThis.ChannelCalendar = {
    mount,
    knownConflicts,
    at,
    shift,
    monday,
    layoutLanes,
    visibleRange,
  };
})();
