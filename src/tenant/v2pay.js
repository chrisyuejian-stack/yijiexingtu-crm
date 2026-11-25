// B1 缴费：缴费就是缴费。登记时可直接分给多个课时包（含当场新建）、剩余进预收余额，或记为其他收入；
// 待核对逐条处理；预收余额兑换课时包；学员页显示预收余额与欠课时。写入全部走 B1 接口。
(() => {
  "use strict";
  const n = el,
    F = UI.fmt,
    V = () => globalThis.ChannelV2,
    R = () => globalThis.ChannelRebuild;
  const chip = (text, tone) => V().chip(text, tone);
  const r2 = (x) => Math.round(Number(x || 0) * 100) / 100;
  const OTHER = ["报名费", "教材费", "其他"];
  const METHODS = ["微信", "支付宝", "转账", "现金", "刷卡"];
  const todayStr = () => todayBJ();

  const inputBox = (label, input, hint) => {
    const w = n("label", null, { class: "v-pay-field" });
    w.append(n("span", label, { class: "v-pay-label" }), input);
    if (hint) w.append(n("small", hint, { class: "v-muted" }));
    return w;
  };
  const numInput = (value = "", attrs = {}) =>
    n("input", null, { type: "number", min: "0", step: ".01", inputmode: "decimal", value: value === null ? "" : String(value), ...attrs });
  const selectOf = (items, value = "", empty = "") => {
    const s = n("select");
    if (empty !== null) s.append(n("option", empty || "请选择", { value: "" }));
    for (const it of items) s.append(n("option", it.name, { value: it.id }));
    s.value = value || "";
    return s;
  };
  // 每个课时包：应收、已收、还差。
  const owed = (p) => (p.amount === null || p.amount === undefined ? null : r2(Math.max(0, Number(p.amount) - Number(p.paid_amount || 0))));
  async function studentPacks(sid) {
    if (!sid || !enabled("packages")) return { items: [] };
    return api("credits/packages?student_id=" + encodeURIComponent(sid));
  }

  // 分配区：已有课时包逐行填金额，可加“新建课时包”行。mode = "pay"（超出转预收）| "redeem"（不能超出）。
  function allocator(box, { mode, onChange }) {
    const rows = [];
    let types = null;
    box.classList.add("v-pay-alloc");
    const list = n("div", null, { class: "v-pay-list" }),
      newBox = n("div", null, { class: "v-pay-new-list" }),
      addBtn = button("＋ 新建课时包并分配", () => addNew(), "");
    addBtn.classList.add("v-pay-add");
    box.append(list, newBox);
    if (enabled("packages", "create")) box.append(addBtn);
    function load(packs) {
      list.replaceChildren();
      for (const r of rows.splice(0)) r.el?.remove?.();
      newBox.replaceChildren();
      const items = (packs || []).filter((p) => p.status !== "deleted");
      items.sort((a, b) => (owed(b) || 0) - (owed(a) || 0));
      if (!items.length) list.append(n("p", "这位学员还没有课时包，可以当场新建，或者不分配、整笔进预收余额。", { class: "v-muted" }));
      for (const p of items) {
        const due = owed(p),
          input = numInput("", { "aria-label": (p.course_name || "课时包") + " 本次分配金额", placeholder: "0.00" }),
          line = n("div", null, { class: "v-pay-pk" }),
          info = n("div");
        info.append(
          n("strong", (p.course_name || "课时包") + " · " + F.units(p.units_total)),
          n(
            "small",
            due === null
              ? "没有填价格，先补价格才能分配"
              : "应收 " + F.money(p.amount) + " · 已收 " + F.money(p.paid_amount || 0) + " · " + (due > 0 ? "还差 " + F.money(due) : "已收齐"),
            { class: due === null ? "v-tone-text-warn" : due > 0 ? "v-tone-text-bad" : "v-tone-text-ok" },
          ),
        );
        const tail = n("div", null, { class: "v-pay-amt" });
        if (due === null) {
          input.disabled = true;
          if (enabled("packages", "update")) tail.append(button("补价格", () => priceForm(p, () => onChange?.("reload"))));
        } else {
          tail.append(input);
          if (due > 0) {
            const fill = n("button", "填还差", { type: "button", class: "v-link-btn" });
            fill.addEventListener("click", () => {
              input.value = String(due);
              line.classList.add("is-on");
              onChange?.();
            });
            tail.append(fill);
          }
        }
        input.addEventListener("input", () => {
          line.classList.toggle("is-on", Number(input.value) > 0);
          onChange?.();
        });
        line.append(info, tail);
        const hint = n("small", null, { class: "v-pay-over", hidden: "" });
        line.append(hint);
        list.append(line);
        rows.push({ kind: "pack", pack: p, input, hint, due });
      }
      onChange?.();
    }
    async function addNew() {
      types ||= await choices("course_types");
      const line = n("div", null, { class: "v-pay-new" }),
        course = selectOf(types, "", "选择课程"),
        units = numInput("", { min: "0.5", step: ".5", placeholder: "例如 20" }),
        amount = numInput("", { placeholder: "课时包金额" }),
        alloc = numInput("", { placeholder: "本次付多少" }),
        price = n("small", "", { class: "v-muted" }),
        rm = n("button", "移除", { type: "button", class: "v-link-btn" });
      const sync = () => {
        price.textContent = Number(units.value) > 0 && Number(amount.value) > 0 ? "单价 " + F.money(r2(Number(amount.value) / Number(units.value))) + " / 课时" : "";
        if (alloc.dataset.touched !== "1" && Number(amount.value) > 0) alloc.value = amount.value;
        onChange?.();
      };
      for (const x of [course, units, amount]) x.addEventListener("input", sync);
      alloc.addEventListener("input", () => {
        alloc.dataset.touched = "1";
        onChange?.();
      });
      const row = { kind: "new", course, units, amount, input: alloc, el: line };
      rm.addEventListener("click", () => {
        rows.splice(rows.indexOf(row), 1);
        line.remove();
        onChange?.();
      });
      line.append(
        n("strong", "新建课时包", { class: "v-pay-new-title" }),
        inputBox("适用课程", course),
        inputBox("课时数", units),
        inputBox("课时包金额（元）", amount),
        inputBox(mode === "redeem" ? "本次兑换（元）" : "本次付（元）", alloc),
        price,
        rm,
      );
      newBox.append(line);
      rows.push(row);
      course.focus();
      onChange?.();
    }
    function total() {
      return r2(rows.reduce((s, r) => s + (Number(r.input.value) || 0), 0));
    }
    function overflow() {
      let o = 0;
      for (const r of rows) {
        if (r.kind !== "pack") continue;
        const v = Number(r.input.value) || 0,
          extra = r2(v - (r.due || 0));
        r.hint.hidden = !(v > 0 && extra > 0);
        if (extra > 0 && v > 0) {
          r.hint.textContent =
            mode === "redeem" ? "超过还差的 " + F.money(extra) + "，兑换不能超过课时包剩余应收" : "超过还差的 " + F.money(extra) + " 会转入预收余额";
          o += extra;
        }
      }
      return r2(o);
    }
    function items() {
      const out = [];
      for (const r of rows) {
        const v = r2(r.input.value);
        if (r.kind === "pack") {
          if (v > 0) out.push({ package_id: r.pack.id, amount: v });
          continue;
        }
        if (!r.course.value) throw Error("新建课时包请选择课程");
        if (!(Number(r.units.value) > 0)) throw Error("新建课时包请填写课时数");
        if (!(Number(r.amount.value) > 0)) throw Error("新建课时包请填写金额");
        out.push({
          new_package: {
            course_type_id: r.course.value,
            units_total: Number(r.units.value),
            amount: r2(r.amount.value),
            unit_price: r2(Number(r.amount.value) / Number(r.units.value)),
          },
          amount: v,
        });
      }
      if (out.length > 20) throw Error("一次最多分配 20 个课时包");
      return out;
    }
    return { load, total, overflow, items, addNew };
  }

  function priceForm(p, done) {
    const amount = numInput(p.amount ?? "", { placeholder: "这个课时包的总价" });
    const view = UI.drawer({
      title: "补填课时包价格",
      subtitle: (p.student_name ? p.student_name + " · " : "") + (p.course_name || "课时包") + " · " + F.units(p.units_total),
      secondary: { label: "取消", onSelect: (v) => v.close() },
      primary: {
        label: "保存价格",
        onSelect: async (v) => {
          if (!(Number(amount.value) > 0)) throw Error("请填写价格");
          await api("credits/packages/" + p.id, "PATCH", { version: p.version, amount: r2(amount.value), operation_id: op });
          await v.close();
          await done?.();
        },
      },
    });
    const op = operation();
    view.body.append(inputBox("课时包金额（元）", amount, "补填后“待核对”数字会减少，待收按新价格计算。"));
    amount.focus();
  }

  // ---------- 登记缴费 ----------
  async function payForm(preset = {}, done) {
    const op = operation();
    let kind = "tuition";
    // 先开窗口，学员名单在后台取（多数时候命中缓存）；带入学员时先按这个学员读课时包，不等全体名单。
    const studentsRequest = choices("students");
    const view = UI.drawer({
      title: "登记缴费",
      isDirty: () => !!amount.value,
      secondary: { label: "取消", onSelect: (v) => v.close() },
      primary: { label: "确认登记缴费", onSelect: (v) => save(v) },
    });
    view.element.classList.add("v-pay-drawer");
    const seg = n("div", null, { class: "v-seg v-pay-kind", role: "group", "aria-label": "缴费类型" });
    const segBtns = [
      ["tuition", "课时包学费"],
      ["other_income", "其他收入（报名费、教材费等）"],
    ].map(([k, label]) => {
      const b = n("button", label, { type: "button", class: "v-seg-item", "aria-pressed": String(k === kind) });
      b.addEventListener("click", () => {
        kind = k;
        for (const x of segBtns) x.setAttribute("aria-pressed", String(x === b));
        tuitionBox.hidden = kind !== "tuition";
        otherBox.hidden = kind === "tuition";
        refresh();
      });
      seg.append(b);
      return b;
    });
    const student = selectOf(
        preset.student_id ? [{ id: preset.student_id, name: preset.student_name || "正在读取姓名…" }] : [],
        preset.student_id || "",
        preset.student_id ? "选择学员" : "正在加载学员名单…",
      ),
      paidAt = n("input", null, { type: "date", value: todayStr(), max: todayStr() }),
      amount = numInput("", { placeholder: "本次实收金额", min: "0.01" }),
      method = n("input", null, { type: "text", list: "v-pay-methods", placeholder: "微信、转账…", maxlength: "40" }),
      note = n("input", null, { type: "text", placeholder: "选填", maxlength: "500" });
    const dl = n("datalist", null, { id: "v-pay-methods" });
    for (const m of METHODS) dl.append(n("option", null, { value: m }));
    student.disabled = !!preset.student_id && preset.lock !== false;
    const base = n("section", null, { class: "v-pay-group" });
    const grid = n("div", null, { class: "v-pay-grid" });
    grid.append(
      inputBox("学员 *", student),
      inputBox("收款日期 *", paidAt),
      inputBox("本次收款金额（元）*", amount),
      inputBox("收款方式", method),
    );
    base.append(seg, grid, dl);

    const tuitionBox = n("section", null, { class: "v-pay-group" }),
      head = n("div", null, { class: "v-pay-head" });
    head.append(n("h3", "钱分给哪些课时包"), n("small", "可分给多个；不分配的部分进学员预收余额", { class: "v-muted" }));
    const balanceNote = n("p", null, { class: "v-muted", hidden: "" });
    tuitionBox.append(head, balanceNote);
    const allocBox = n("div");
    tuitionBox.append(allocBox);
    const alloc = allocator(allocBox, {
      mode: "pay",
      onChange: (why) => (why === "reload" ? loadStudent() : refresh()),
    });
    const stage = selectOf([], "", "不关联");
    tuitionBox.append(inputBox("学习阶段", stage));

    const otherBox = n("section", null, { class: "v-pay-group", hidden: "" }),
      cat = selectOf(OTHER.map((x) => ({ id: x, name: x })), "报名费", null),
      otherNote = n("input", null, { type: "text", placeholder: "例如 练习册、考级报名", maxlength: "200" });
    otherBox.append(
      n("h3", "其他收入"),
      n("p", "登记即确认收入，不进预收余额，也不算待收。", { class: "v-muted" }),
      inputBox("类别 *", cat),
      inputBox("说明", otherNote),
    );
    const noteGroup = n("section", null, { class: "v-pay-group" });
    noteGroup.append(inputBox("备注", note));
    const sum = n("div", null, { class: "v-pay-sum", role: "status" });
    view.body.append(base, tuitionBox, otherBox, noteGroup);
    view.footer.prepend(sum);

    function refresh() {
      const total = r2(amount.value);
      sum.replaceChildren();
      if (kind !== "tuition") {
        sum.append(n("span", "本次收款 "), n("strong", F.money(total)), n("span", " · 记为" + cat.value + "收入"));
        return;
      }
      const given = alloc.total(),
        over = alloc.overflow(),
        dep = r2(total - given + over);
      if (given > total) {
        sum.append(n("strong", "分配合计 " + F.money(given) + " 超过收款金额 " + F.money(r2(given - total)), { class: "v-tone-text-bad" }));
        return;
      }
      sum.append(
        n("span", "本次收款 "),
        n("strong", F.money(total)),
        n("span", " ＝ 分到课时包 "),
        n("strong", F.money(r2(given - over))),
        n("span", " ＋ 进预收余额 "),
        n("strong", F.money(dep), { class: "v-tone-text-info" }),
      );
    }
    amount.addEventListener("input", refresh);
    cat.addEventListener("change", refresh);
    async function loadStudent() {
      const sid = student.value;
      if (!sid) {
        alloc.load([]);
        return;
      }
      const [packs, stages, bal] = await Promise.all([
        studentPacks(sid),
        enabled("students") ? api("credits/stages?student_id=" + encodeURIComponent(sid)).catch(() => ({ items: [] })) : { items: [] },
        api("credits/balance?student_id=" + encodeURIComponent(sid)).catch(() => null),
      ]);
      if (sid !== student.value) return;
      alloc.load(packs.items);
      stage.replaceChildren(n("option", "不关联", { value: "" }));
      for (const s of stages.items || []) stage.append(n("option", s.name, { value: s.id }));
      const bits = [];
      if (bal && bal.balance > 0) bits.push("已有预收余额 " + F.money(bal.balance));
      if (packs.debt_units > 0) bits.push("欠 " + F.units(packs.debt_units) + "，新课时包到账后自动补扣");
      balanceNote.hidden = !bits.length;
      balanceNote.textContent = bits.join(" · ");
    }
    student.addEventListener("change", () => void loadStudent().catch((e) => notice(e.message)));
    const fillStudents = studentsRequest.then((list) => {
      if (!student.isConnected && !view.element.isConnected) return;
      const keep = student.value;
      student.replaceChildren(n("option", "选择学员", { value: "" }));
      for (const it of list) student.append(n("option", it.name, { value: it.id }));
      // 带入的学员不在名单里（例如已停用）时保留原选项。
      if (keep && !list.some((x) => x.id === keep)) student.append(n("option", preset.student_name || "当前学员", { value: keep }));
      student.value = keep;
    });
    fillStudents.catch((e) => notice(e.message));
    await loadStudent();
    refresh();
    (preset.student_id ? amount : student).focus();

    async function save(v) {
      await fillStudents.catch(() => {});
      if (!student.value) throw Error("请选择学员");
      const total = r2(amount.value);
      if (!(total > 0)) throw Error("请填写收款金额");
      if (!paidAt.value) throw Error("请填写收款日期");
      const body = {
        operation_id: op,
        student_id: student.value,
        paid_at: paidAt.value,
        method: method.value.trim(),
        note: note.value.trim(),
        amount: total,
        kind,
      };
      if (kind === "tuition") {
        body.allocations = alloc.items();
        if (alloc.total() > total) throw Error("分配合计超过收款金额");
        if (stage.value) body.stage_id = stage.value;
      } else {
        body.other_category = cat.value;
        body.other_note = otherNote.value.trim();
      }
      let res;
      try {
        res = await api("credits/payments", "POST", body);
      } catch (error) {
        if (error instanceof TypeError)
          throw Error("网络连接中断，暂时无法确认是否登记成功。请在当前窗口重试，系统会避免重复登记。");
        throw error;
      }
      const bits = ["已登记 " + F.money(total)];
      if (res.deposit_amount > 0) bits.push(F.money(res.deposit_amount) + " 进预收余额");
      if (res.overflow > 0) bits.push("其中 " + F.money(res.overflow) + " 超过课时包还差，已转预收");
      notice(bits.join("，"), "success");
      await v.close();
      await done?.(res);
    }
  }

  // ---------- 待核对 ----------
  async function pendingList(c, reload) {
    const data = await api("credits/payments/pending");
    const wrap = n("div", null, { class: "v-pay-pending" });
    wrap.append(
      n("p", "这里是系统没法自己判断的账：没关联课时包的缴费、没填价格的课时包。处理一条少一条，处理完这里是空的。", {
        class: "v-banner v-banner-warn",
      }),
    );
    const rows = [
      ...data.unlinked_payments.map((r) => ({ type: "pay", r })),
      ...data.packages_without_price.map((r) => ({ type: "price", r })),
    ];
    if (!rows.length) {
      wrap.append(UI.empty({ text: "没有待核对的账。" }));
      c.append(wrap);
      return;
    }
    const t = n("table", null, { class: "v-table" }),
      head = n("tr");
    for (const h of ["问题", "学员", "金额", "日期", "怎么处理"]) head.append(n("th", h));
    const thead = n("thead"),
      tbody = n("tbody");
    thead.append(head);
    const can = enabled("tuition", "update");
    for (const { type, r } of rows) {
      const tr = n("tr"),
        acts = n("div", null, { class: "v-pay-acts" });
      if (type === "pay") {
        if (can)
          acts.append(
            button("关联课时包", () => linkForm(r, reload), "primary"),
            button("转预收余额", async () => {
              if (!(await UI.confirm({ title: "把 " + F.money(r.amount) + " 转入 " + r.student_name + " 的预收余额？", consequence: "以后可在预收余额里兑换成课时包。", danger: false })))
                return;
              await api("credits/payments/" + r.id + "/resolve", "POST", { version: r.version, action: "to_balance", operation_id: operation() });
              notice("已转入预收余额", "success");
              await reload();
            }),
            button("记为其他收入", () => otherForm(r, reload)),
          );
        tr.append(
          n("td", null, { "data-label": "问题" }),
          n("td", r.student_name || "", { "data-label": "学员" }),
          n("td", F.money(r.amount), { class: "is-num", "data-label": "金额" }),
          n("td", (r.paid_at || "").slice(0, 10), { "data-label": "日期" }),
        );
        tr.firstChild.append(chip("缴费未关联", "bad"));
      } else {
        if (enabled("packages", "update")) acts.append(button("补填价格", () => priceForm(r, reload), "primary"));
        tr.append(
          n("td", null, { "data-label": "问题" }),
          n("td", (r.student_name || "") + " · " + (r.course_name || "课时包") + " " + F.units(r.units_total), { "data-label": "学员" }),
          n("td", "—", { class: "is-num", "data-label": "金额" }),
          n("td", r.purchase_date || "", { "data-label": "日期" }),
        );
        tr.firstChild.append(chip("课时包没填价格", "warn"));
      }
      const td = n("td", null, { "data-label": "怎么处理" });
      td.append(acts);
      tr.append(td);
      tbody.append(tr);
    }
    t.append(thead, tbody);
    const box = n("div", null, { class: "v-renew-table panel v-fin-table" });
    box.append(t);
    wrap.append(box);
    c.append(wrap);
  }
  async function linkForm(pay, done) {
    const op = operation();
    const view = UI.drawer({
      title: "关联这笔缴费",
      subtitle: pay.student_name + " · " + F.money(pay.amount) + " · " + (pay.paid_at || "").slice(0, 10) + (pay.method ? " · " + pay.method : ""),
      secondary: { label: "取消", onSelect: (v) => v.close() },
      primary: {
        label: "确认关联",
        onSelect: async (v) => {
          const items = alloc.items();
          if (!items.length) throw Error("请至少给一个课时包分配金额；整笔不分配请用“转预收余额”");
          if (alloc.total() > Number(pay.amount)) throw Error("分配合计超过这笔缴费");
          const res = await api("credits/payments/" + pay.id + "/resolve", "POST", { version: pay.version, action: "link", allocations: items, operation_id: op });
          const dep = res.deposit_amount ?? res.balance_amount;
          notice("已关联" + (dep > 0 ? "，" + F.money(dep) + " 进预收余额" : ""), "success");
          await v.close();
          await done?.();
        },
      },
    });
    const sum = n("p", null, { class: "v-pay-sum", role: "status" });
    const box = n("div");
    view.body.append(n("h3", "分给哪些课时包", { class: "v-pay-h" }), box, sum);
    const alloc = allocator(box, {
      mode: "pay",
      onChange: (why) => {
        if (why === "reload") return void load();
        const given = alloc.total(),
          over = alloc.overflow(),
          left = r2(Number(pay.amount) - given + over);
        sum.textContent =
          given > Number(pay.amount)
            ? "分配合计超过这笔缴费 " + F.money(r2(given - Number(pay.amount)))
            : "合计分配 " + F.money(r2(given - over)) + "，剩余 " + F.money(left) + " 自动进预收余额";
      },
    });
    const load = async () => alloc.load((await studentPacks(pay.student_id)).items);
    await load();
  }
  function otherForm(pay, done) {
    const cat = selectOf(OTHER.map((x) => ({ id: x, name: x })), "报名费", null);
    UI.drawer({
      title: "记为其他收入",
      subtitle: pay.student_name + " · " + F.money(pay.amount),
      secondary: { label: "取消", onSelect: (v) => v.close() },
      primary: {
        label: "确认",
        onSelect: async (v) => {
          await api("credits/payments/" + pay.id + "/resolve", "POST", { version: pay.version, action: "other_income", other_category: cat.value, operation_id: op });
          notice("已记为" + cat.value, "success");
          await v.close();
          await done?.();
        },
      },
    }).body.append(inputBox("类别", cat, "直接确认为收入，不进预收、不算待收。原收款月已锁定时记入当月。"));
    const op = operation();
  }

  // ---------- 预收余额 ----------
  async function balanceCard(box, sid, name, reload) {
    if (!enabled("tuition")) return;
    const bal = await api("credits/balance?student_id=" + encodeURIComponent(sid)).catch(() => null);
    if (!bal) return;
    // 没有余额也没有流水的学员不占位置。
    if (!bal.balance && !bal.ledger.length && !box.classList.contains("v-pay-baltab-out")) return;
    const card = n("div", null, { class: "v-pay-balance" });
    const top = n("div", null, { class: "v-pay-balance-top" });
    top.append(n("span", "预收余额", { class: "v-muted" }), n("strong", F.money(bal.balance)));
    const acts = n("div", null, { class: "v-pay-acts" });
    if (bal.balance > 0 && enabled("tuition", "update"))
      acts.append(button("兑换课时包", () => redeemForm(sid, name, bal.balance, reload), "primary"));
    if (enabled("tuition", "update")) acts.append(button("退款 / 调整", () => adjustForm(sid, name, bal.balance, reload)));
    if (bal.ledger.length) {
      const more = n("details", null, { class: "v-pay-ledger" });
      more.append(n("summary", "余额流水 " + bal.ledger.length + " 条"));
      const ul = n("ul");
      const TYPE = { deposit: "存入", redeem: "兑换课时包", refund: "退款", adjust: "调整" };
      for (const x of bal.ledger.slice(0, 50))
        ul.append(
          n(
            "li",
            new Date(x.created_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }) +
              " · " +
              (TYPE[x.type] || x.type) +
              " " +
              (x.amount > 0 ? "+" : "") +
              F.money(x.amount) +
              (x.reason ? " · " + x.reason : ""),
          ),
        );
      more.append(ul);
      card.append(top, acts, more);
    } else card.append(top, acts);
    box.append(card);
  }
  async function redeemForm(sid, name, balance, done) {
    const op = operation();
    const view = UI.drawer({
      title: "用预收余额兑换课时包",
      subtitle: name + " · 预收余额 " + F.money(balance),
      secondary: { label: "取消", onSelect: (v) => v.close() },
      primary: {
        label: "确认兑换",
        onSelect: async (v) => {
          const items = alloc.items();
          if (!items.length) throw Error("请填写兑换金额");
          if (alloc.total() > balance) throw Error("兑换合计超过预收余额");
          if (alloc.overflow() > 0) throw Error("兑换金额不能超过课时包剩余应收");
          let res;
          try {
            res = await api("credits/balance/redeem", "POST", { student_id: sid, items, operation_id: op });
          } catch (error) {
            // Only a definite business rejection permits refreshing the balance.
            // For lost responses, retain the original inputs/key for idempotent retry.
            if ([400, 409].includes(error.status)) {
              const latest = await api("credits/balance?student_id=" + encodeURIComponent(sid)).catch(() => null);
              if (latest && latest.balance !== balance) {
                balance = latest.balance;
                const subtitle = view.body.querySelector(":scope > .ui-muted");
                if (subtitle) subtitle.textContent = name + " · 预收余额 " + F.money(balance);
                sum.textContent = "兑换 " + F.money(alloc.total()) + "，当前预收余额 " + F.money(balance);
                throw Error("预收余额已变化，当前可用 " + F.money(balance) + "。请核对兑换金额后重试。");
              }
            }
            throw error;
          }
          notice("已兑换，剩余预收 " + F.money(res.balance_amount), "success");
          await v.close();
          await done?.();
        },
      },
    });
    const sum = n("p", null, { class: "v-pay-sum", role: "status" }),
      debt = n("p", null, { class: "v-muted", hidden: "" }),
      box = n("div");
    view.body.append(debt, n("h3", "兑换到哪些课时包", { class: "v-pay-h" }), box, sum);
    const alloc = allocator(box, {
      mode: "redeem",
      onChange: (why) => {
        if (why === "reload") return void load();
        const given = alloc.total();
        sum.textContent =
          given > balance ? "超过预收余额 " + F.money(r2(given - balance)) : "兑换 " + F.money(given) + "，兑换后剩余 " + F.money(r2(balance - given));
      },
    });
    const load = async () => {
      const packs = await studentPacks(sid);
      alloc.load(packs.items);
      if (packs.debt_units > 0) {
        debt.hidden = false;
        debt.textContent = "这位学员欠 " + F.units(packs.debt_units) + "，兑换或新建课时包后会自动补扣。";
      }
    };
    await load();
  }
  function adjustForm(sid, name, balance, done) {
    const op = operation();
    let type = "refund";
    const amount = numInput("", { placeholder: "金额" }),
      reason = n("input", null, { type: "text", placeholder: "必填，例如 退回多收", maxlength: "200" }),
      seg = n("div", null, { class: "v-seg", role: "group" });
    const btns = [
      ["refund", "退款给家长"],
      ["adjust_in", "手工增加"],
      ["adjust_out", "手工减少"],
    ].map(([k, label]) => {
      const b = n("button", label, { type: "button", class: "v-seg-item", "aria-pressed": String(k === type) });
      b.addEventListener("click", () => {
        type = k;
        for (const x of btns) x.setAttribute("aria-pressed", String(x === b));
      });
      seg.append(b);
      return b;
    });
    UI.drawer({
      title: "预收余额 · 退款或调整",
      subtitle: name + " · 当前 " + F.money(balance),
      secondary: { label: "取消", onSelect: (v) => v.close() },
      primary: {
        label: "确认",
        onSelect: async (v) => {
          const a = r2(amount.value);
          if (!(a > 0)) throw Error("请填写金额");
          if (!reason.value.trim()) throw Error("请填写原因");
          const signed = type === "adjust_in" ? a : -a;
          if (balance + signed < 0) throw Error("余额不能变成负数");
          const res = await api("credits/balance/adjust", "POST", {
            student_id: sid,
            type: type === "refund" ? "refund" : "adjust",
            amount: signed,
            reason: reason.value.trim(),
            operation_id: op,
          });
          notice("已保存，预收余额 " + F.money(res.balance_amount), "success");
          await v.close();
          await done?.();
        },
      },
    }).body.append(seg, inputBox("金额（元）", amount), inputBox("原因 *", reason));
  }
  // 收款页“预收余额”分页：选学员看余额、流水，兑换或退款。
  async function balanceTab(c, reload) {
    const students = await choices("students");
    const wrap = n("div", null, { class: "v-pay-baltab" });
    const pick = selectOf(students, balState.sid, "选择学员查看预收余额");
    const out = n("div", null, { class: "v-pay-baltab-out" });
    wrap.append(
      n("p", "预收余额还不算收入；兑换成课时包后才按课时包确认收入。", { class: "v-muted v-fin-note" }),
      inputBox("学员", pick),
      out,
    );
    c.append(wrap);
    const show = async () => {
      balState.sid = pick.value;
      out.replaceChildren();
      if (!pick.value) return;
      await balanceCard(out, pick.value, pick.selectedOptions[0]?.textContent || "", () => show());
    };
    pick.addEventListener("change", () => void show().catch((e) => notice(e.message)));
    await show();
  }
  const balState = { sid: "" };

  // 学员页：预收余额与欠课时。
  async function studentFunds(box, sid, name, reload) {
    const strip = n("div", null, { class: "v-pay-strip" });
    box.append(strip);
    const packs = enabled("packages") ? await studentPacks(sid).catch(() => null) : null;
    if (packs?.debt_units > 0) {
      const d = n("div", null, { class: "v-pay-debt" });
      d.append(
        chip("欠课时", "bad"),
        n("strong", "欠 " + F.units(packs.debt_units)),
        n("small", "上限 " + F.units(me.policy?.settings?.max_debt_units ?? 3) + " · 新课时包到账后自动补扣", { class: "v-muted" }),
      );
      strip.append(d);
    }
    await balanceCard(strip, sid, name, reload);
    if (!strip.childElementCount) strip.remove();
  }

  // 修改缴费：新式缴费只能改方式、备注；金额有误走冲正后重新登记。
  function editPayment(row, done) {
    const method = n("input", null, { type: "text", value: row.method || "", list: "v-pay-methods", maxlength: "40" }),
      note = n("input", null, { type: "text", value: row.note || "", maxlength: "500" });
    const op = operation();
    const legacy = !row.kind;
    const amount = numInput(row.amount);
    const paidAt = n("input", null, { type: "date", value: (row.paid_at || "").slice(0, 10) });
    const view = UI.drawer({
      title: "修改缴费记录",
      subtitle: (row.student_name || "") + " · " + F.money(row.amount) + " · " + (row.paid_at || "").slice(0, 10),
      secondary: { label: "取消", onSelect: (v) => v.close() },
      primary: {
        label: "保存",
        onSelect: async (v) => {
          await api("finance/tuition/" + row.id, "PATCH", {
            amount: legacy ? Number(amount.value) : Number(row.amount),
            paid_at: legacy ? paidAt.value : row.paid_at,
            method: method.value.trim(),
            note: note.value.trim(),
            version: row.version,
            operation_id: op,
          });
          await v.close();
          await done?.();
        },
      },
    });
    if (legacy) view.body.append(inputBox("金额（元）", amount), inputBox("收款日期", paidAt));
    if (legacy && enabled("tuition", "delete")) {
      const del = button("删除这笔缴费", async () => {
        const ok = await removeItem({
          title: "删除这笔 " + F.money(row.amount) + " 的缴费？",
          consequence: "只适用于旧式、没有分配的缴费；锁定月份需要主管先解锁。",
          path: "finance/tuition/" + row.id,
          body: { version: row.version },
        });
        if (ok) {
          await view.close();
          await done?.();
        }
      });
      del.classList.add("v-danger-link");
      view.body.append(del);
    }
    view.body.append(inputBox("收款方式", method), inputBox("备注", note));
    if (!legacy && enabled("tuition", "update")) {
      const box = n("div", null, { class: "v-banner v-banner-warn v-pay-reverse" });
      box.append(
        n("span", "金额或日期填错了？先冲正这笔缴费（会撤回它分到课时包和预收的钱），再重新登记。"),
        button("冲正这笔缴费", async () => {
          const reason = await requestReason("请填写冲正原因", {
            confirmLabel: "确认冲正",
            message: "冲正会撤回这笔缴费分到课时包和预收余额的金额，不改变已购课时。若预收已被兑换或退款，余额不足时会拒绝冲正。",
          });
          if (!reason) return;
          await api("credits/payments/" + row.id + "/reverse", "POST", { version: row.version, reason, operation_id: operation() });
          notice("已冲正，请重新登记正确的缴费", "success");
          await view.close();
          await done?.();
        }),
      );
      view.body.append(box);
    }
  }
  // 缴费一行的“去处”说明。
  function payTarget(r, packs) {
    if (r.kind === "other_income") return chip("其他收入 · " + (r.other_category || ""), "muted");
    if (r.unresolved || (!r.kind && !r.package_id)) return chip("未关联 · 待核对", "warn");
    if (r.package_id) return packs?.get(r.package_id)?.course_name || "已关联课时包";
    return "学费（已分配 / 预收）";
  }

  // 统一入口：所有“登记缴费”（学员页、今天页、收款页）走新表单。
  const oldCreditForm = creditForm;
  creditForm = async (c, kind, row = {}) => {
    if (kind !== "payments" || row.id) return oldCreditForm(c, kind, row);
    return payForm({ student_id: row.student_id || "" }, () => creditPage(c, "payments", c.dataset?.creditScope || ""));
  };

  // D1：统一的删除确认。服务器拒绝时（有关联记录）把原因原样提示。
  async function removeItem({ title, consequence, path, body = {}, done }) {
    if (!(await UI.confirm({ title, consequence, danger: true }))) return false;
    await api(path, "DELETE", { operation_id: operation(), ...body });
    notice("已删除", "success");
    await done?.();
    return true;
  }
  globalThis.ChannelV2Pay = { removeItem, payForm, pendingList, balanceTab, studentFunds, payEdit: editPayment, payTarget, priceForm };
})();
