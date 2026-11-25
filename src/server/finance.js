import {
  LESSON_LABELS,
  MODULE_LABELS,
  ACTION_LABELS,
  EXPORT_KIND_LABELS,
  beijingTime,
} from "./presentation.js";
import { effectivePolicies } from "./absence.js";
import { repo } from "./repo.js";
import { HttpError, fail, string, integer, version, randomId, sha, now } from "./core.js";
import { can, projectRecord } from "./permissions.js";
import { requireCan } from "./accounts.js";
import { day } from "./scheduling.js";
import { moneyIn, moneyOut, multiplyCents } from "./numbers.js";
import { workbook, moneyCell } from "./xlsx.js";
function contextPolicies(ctx) {
  return effectivePolicies({
    absence_policies: JSON.parse(ctx.absence_settings?.[0]?.value || "{}"),
  });
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
// 仅采用结算的业务字段，避免姓名、档案备注、更新时间和无关版本阻断审批。
async function settlementFingerprint(ctx) {
  const select = (rows, keys) =>
    rows
      .map((row) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null])))
      .sort((a, b) => a.id.localeCompare(b.id));
  const rates = ctx.rates.filter((r) =>
    ctx.lessons.some(
      (l) =>
        l.teacher_id === r.teacher_id &&
        l.course_type_id === r.course_type_id &&
        l.format === r.format &&
        r.effective_from <= l.start_at.slice(0, 10) &&
        r.effective_to >= l.start_at.slice(0, 10),
    ),
  );
  return sha(
    JSON.stringify(
      canonical({
        fingerprint_version: 2,
        earned: ctx.earned || [],
        ...(ctx.other_income?.length ? { other_income: ctx.other_income } : {}),
        pending_submissions: select(ctx.pending_submissions || [], [
          "id",
          "lesson_id",
        ]),
        lessons: select(ctx.lessons, [
          "id",
          "start_at",
          "duration",
          "units",
          "teacher_id",
          "assistant_id",
          "course_type_id",
          "category_id",
          "format",
          "status",
          "override_rate",
          "override_basis",
        ]),
        participants: select(ctx.participants, [
          "id",
          "lesson_id",
          "student_id",
          "billing_mode",
          "attendance",
          "deducted",
          "package_id",
          "makeup_for",
        ]),
        rates: select(rates, [
          "id",
          "teacher_id",
          "course_type_id",
          "format",
          "rate_basis",
          "rate",
          "effective_from",
          "effective_to",
        ]),
        adjustments: select(ctx.adjustments, [
          "id",
          "teacher_id",
          "month",
          "amount",
          "reason",
        ]),
        costs: select(ctx.costs, ["id", "date", "category", "amount", "note"]),
        tuition: select(ctx.tuition, [
          "id",
          "student_id",
          "package_id",
          "paid_at",
          "amount",
          "method",
          "note",
        ]),
        policies: contextPolicies(ctx),
      }),
    ),
  );
}
export function monthIn(value) {
  if (typeof value !== "string" || !/^20\d\d-(0[1-9]|1[0-2])$/.test(value))
    fail(400, "月份格式为YYYY-MM");
  return value;
}
const today = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
const own = (user) => ({
  teacher_id: user.teacher_id,
  student_id: user.student_id,
  id: user.id,
});
function dto(user, policy, module, row) {
  const out = projectRecord(user, policy, module, moneyOut(row));
  if (!out) return null;
  delete out.tenant_id;
  delete out.created_by;
  delete out.updated_by;
  delete out.money_version;
  return out;
}
async function get(r, kind, id) {
  if (typeof id !== "string" || !id) fail(400, "关联 ID 不正确");
  const row = await r.businessGet(kind, id);
  if (!row) fail(404, "不存在");
  return row;
}
function teacherScope(user, input) {
  if (user.roles.includes("teacher")) {
    if (input && input !== user.teacher_id) fail(404, "不存在");
    return user.teacher_id;
  }
  return input || null;
}
const COST_SCALE = 1000000000000n;
const hourly = (basis) => ["legacy", "unit"].includes(basis);
function rawCost(entry) {
  return hourly(entry.rate_basis)
    ? [
        BigInt(entry.rate) *
          BigInt(entry.quantity.toFixed(12).replace(".", "")),
        COST_SCALE,
      ]
    : [BigInt(entry.amount), 1n];
}
function distributeMonthly(entries) {
  const groups = new Map();
  for (const entry of entries)
    if (hourly(entry.rate_basis)) {
      if (!groups.has(entry.teacher_id)) groups.set(entry.teacher_id, []);
      groups.get(entry.teacher_id).push(entry);
    }
  for (const rows of groups.values()) {
    let sum = 0n,
      base = 0;
    const remainders = [];
    for (const row of rows) {
      const [n, d] = rawCost(row);
      const floor = Number(n / d);
      sum += n;
      base += floor;
      remainders.push({ row, amount: floor, remainder: n % d });
    }
    let remaining = Number((sum + COST_SCALE / 2n) / COST_SCALE) - base;
    remainders.sort((a, b) =>
      a.remainder === b.remainder
        ? a.row.start_at.localeCompare(b.row.start_at) ||
          a.row.id.localeCompare(b.row.id)
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
    for (const item of remainders) {
      const amount = item.amount + (remaining > 0 ? 1 : 0);
      if (remaining > 0) remaining--;
      if (amount !== item.row.amount)
        item.row.rounding_note = "课次包含月度分位尾差分摊";
      item.row.amount = amount;
    }
  }
}
export function calculatePayroll(ctx, policies) {
  const settlement = ctx.settlements[0],
    locked = !!settlement?.locked,
    parts = new Map();
  for (const p of ctx.participants) {
    if (!parts.has(p.lesson_id)) parts.set(p.lesson_id, []);
    parts.get(p.lesson_id).push(p);
  }
  const entries = locked
    ? ctx.snapshots.map((s) => ({
        ...JSON.parse(s.lesson_json),
        teacher_id: s.teacher_id,
        rate: s.rate,
        rate_basis: s.rate_basis,
        quantity: s.quantity,
        amount: s.amount,
      }))
    : ctx.lessons.map((l) => {
        const match = ctx.rates.find(
            (r) =>
              r.teacher_id === l.teacher_id &&
              r.course_type_id === l.course_type_id &&
              r.format === l.format &&
              r.effective_from <= l.start_at.slice(0, 10) &&
              r.effective_to >= l.start_at.slice(0, 10),
          ),
          rate = l.override_rate ?? match?.rate ?? 0,
          basis =
            l.override_rate !== null
              ? l.override_basis
              : match?.rate_basis || "legacy",
          payable =
            l.status === "completed" || !!policies[l.status]?.teacherPaid;
        let quantity = ["legacy", "unit"].includes(basis)
          ? l.units
          : basis === "lesson"
            ? 1
            : (parts.get(l.id) || []).filter(
                (p) =>
                  p.attendance === "attended" ||
                  policies[
                    {
                      no_show: "student_no_show",
                      student_leave: "student_leave",
                      teacher_leave: "teacher_leave",
                      cancelled: "cancelled",
                    }[p.attendance]
                  ]?.teacherPaid,
              ).length;
        return {
          id: l.id,
          teacher_id: l.teacher_id,
          teacher_name: l.teacher_name,
          course_type_id: l.course_type_id,
          course_name: l.course_name,
          category_id: l.category_id,
          location_id: l.location_id,
          location_name: l.location_name,
          start_at: l.start_at,
          duration: l.duration,
          units: l.units,
          status: l.status,
          rate,
          rate_basis: basis,
          quantity: payable ? quantity : 0,
          amount: payable ? multiplyCents(rate, quantity) : 0,
        };
      });
  if (!locked) distributeMonthly(entries);
  const summaries = ctx.teachers.map((t) => {
    const lessons = entries.filter((e) => e.teacher_id === t.id),
      accrued = lessons.reduce((s, e) => s + e.amount, 0),
      adjustment = ctx.adjustments
        .filter((a) => a.teacher_id === t.id)
        .reduce((s, a) => s + a.amount, 0),
      paid = ctx.payments
        .filter((p) => p.teacher_id === t.id)
        .reduce((s, p) => s + p.amount, 0);
    return {
      teacher_id: t.id,
      teacher_name: t.name,
      lesson_count: lessons.filter((e) => e.quantity > 0 && e.rate > 0).length,
      units:
        Math.round(
          lessons
            .filter((e) => e.quantity > 0 && e.rate > 0)
            .reduce((s, e) => s + e.units, 0) * 100,
        ) / 100,
      accrued_amount: accrued,
      adjustment_amount: adjustment,
      total_amount: accrued + adjustment,
      paid_amount: paid,
      unpaid_amount: accrued + adjustment - paid,
      confirmation_status: locked ? "confirmed" : "unconfirmed",
    };
  });
  return { entries, summaries, locked, settlement };
}
function summaryReport(ctx, payroll, notCounted = new Set()) {
  const tuition = ctx.tuition.reduce((s, p) => s + p.amount, 0),
    pay = payroll.summaries.reduce((s, r) => s + r.total_amount, 0),
    cost = ctx.costs.reduce((s, c) => s + c.amount, 0);
  const dimensions = {
    teachers: new Map(),
    courses: new Map(),
    students: new Map(),
  };
  const fractions = new Map(),
    entriesById = new Map(payroll.entries.map((e) => [e.id, e])),
    partsById = new Map();
  for (const part of ctx.participants) {
    if (!partsById.has(part.lesson_id)) partsById.set(part.lesson_id, []);
    partsById.get(part.lesson_id).push(part);
  }
  const gcd = (a, b) => {
    while (b) {
      const t = a % b;
      a = b;
      b = t;
    }
    return a;
  };
  function addFraction(key, n, d) {
    const [a, b] = fractions.get(key) || [0n, 1n],
      total = a * d + n * b,
      den = b * d,
      g = gcd(total, den);
    fractions.set(key, [total / g, den / g]);
  }
  for (const l of ctx.lessons) {
    for (const [kind, id, name] of [
      ["teachers", l.teacher_id, l.teacher_name],
      ["courses", l.course_type_id, l.course_name],
    ]) {
      const map = dimensions[kind],
        r = map.get(id) || {
          id,
          name,
          lesson_count: 0,
          units: 0,
          teacher_pay_amount: 0,
        };
      if (!notCounted.has(l.id)) {
        r.lesson_count++;
        r.units = Math.round((r.units + l.units) * 100) / 100;
      }
      const entry = entriesById.get(l.id);
      const [n, d] = entry ? rawCost(entry) : [0n, 1n];
      addFraction(kind + ":" + id, n, d);
      map.set(id, r);
    }
    const ps = partsById.get(l.id) || [],
      billable = ps.filter((p) =>
        ["attended", "no_show"].includes(p.attendance),
      ),
      weighted = billable.length ? billable : ps,
      entry = entriesById.get(l.id),
      [costNum, costDen] = entry ? rawCost(entry) : [0n, 1n];
    for (const p of ps) {
      const map = dimensions.students,
        r = map.get(p.student_id) || {
          id: p.student_id,
          name: p.student_name,
          lesson_count: 0,
          units: 0,
          teacher_pay_amount: 0,
        };
      if (!notCounted.has(l.id)) {
        r.lesson_count++;
        r.units = Math.round((r.units + l.units) * 100) / 100;
      }
      if (weighted.some((q) => q.id === p.id)) {
        addFraction(
          "students:" + p.student_id,
          costNum,
          costDen * BigInt(weighted.length),
        );
      }
      map.set(p.student_id, r);
    }
  }
  for (const [key, [n, d]] of fractions) {
    const colon = key.indexOf(":"),
      kind = key.slice(0, colon),
      id = key.slice(colon + 1);
    dimensions[kind].get(id).teacher_pay_amount = Number(
      (n * 2n + d) / (d * 2n),
    );
  }
  return {
    lesson_count: ctx.lessons.filter((l) => !notCounted.has(l.id)).length,
    participant_count: ctx.participants.filter(
      (p) => !notCounted.has(p.lesson_id),
    ).length,
    tuition_amount: tuition,
    teacher_pay_amount: pay,
    cost_amount: cost,
    profit_amount: tuition - pay - cost,
    ...Object.fromEntries(
      Object.entries(dimensions).map(([k, v]) => [k, [...v.values()]]),
    ),
  };
}
// 汇报视图复用既有课酬算法。结算只保存这里的新增确认收入指标。
export function occurredReport(
  ctx,
  policies,
  cutoff = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
  }).format(new Date(now())),
  at = now(),
) {
  const full = calculatePayroll(ctx, policies),
    time = Math.min(at, Date.parse(cutoff + "T23:59:59.999+08:00")),
    participants = new Map();
  for (const p of ctx.participants) {
    if (!participants.has(p.lesson_id)) participants.set(p.lesson_id, []);
    participants.get(p.lesson_id).push(p);
  }
  const countedPart = (p) =>
    p.attendance === "attended" ||
    p.deducted > 0 ||
    !!policies[
      {
        no_show: "student_no_show",
        student_leave: "student_leave",
        teacher_leave: "teacher_leave",
        cancelled: "cancelled",
      }[p.attendance]
    ]?.teacherPaid;
  const occurred = ctx.lessons.filter(
      (l) =>
        Date.parse(l.start_at) <= time &&
        !["planned", "cancelled"].includes(l.status) &&
        ((participants.get(l.id) || []).some(countedPart) ||
          !!policies[l.status]?.deduct ||
          !!policies[l.status]?.teacherPaid),
    ),
    ids = new Set(occurred.map((l) => l.id));
  const entries = full.entries.filter(
      (e) => Date.parse(e.start_at) <= time && e.status !== "planned",
    ),
    paidIds = new Set(entries.filter((e) => e.amount !== 0).map((e) => e.id)),
    nonCounting = ctx.lessons.filter(
      (l) => !ids.has(l.id) && paidIds.has(l.id),
    ),
    notCounted = new Set(nonCounting.map((l) => l.id));
  const scope = {
    ...ctx,
    lessons: [...occurred, ...nonCounting],
    participants: ctx.participants.filter(
      (p) =>
        (ids.has(p.lesson_id) && countedPart(p)) || notCounted.has(p.lesson_id),
    ),
    costs: ctx.costs.filter((c) => c.date <= cutoff),
    tuition: ctx.tuition.filter((p) => p.paid_at.slice(0, 10) <= cutoff),
  };
  const p = {
    ...full,
    entries,
    summaries: [
      {
        total_amount:
          entries.reduce((n, e) => n + e.amount, 0) +
          ctx.adjustments.reduce((n, a) => n + a.amount, 0),
      },
    ],
  };
  const totals = summaryReport(scope, p, notCounted);
  const snapshot = full.locked
    ? JSON.parse(full.settlement.summary || "{}")
    : null;
  const earned = (ctx.earned || []).filter((row) => row.date <= cutoff);
  const incomeByCategory = new Map();
  for (const row of ctx.other_income || []) {
    if (row.date > cutoff) continue;
    incomeByCategory.set(row.category, (incomeByCategory.get(row.category) || 0) + row.amount);
  }
  const otherIncome = snapshot
    ? (snapshot.other_income ?? [])
    : [...incomeByCategory].map(([category, amount]) => ({ category, amount }));
  const otherIncomeAmount = otherIncome.reduce((sum, row) => sum + row.amount, 0);
  const earnedAmount = snapshot
    ? (snapshot.earned_amount ?? null)
    : earned.reduce((sum, row) => sum + row.amount, otherIncomeAmount);
  const overallUnits = occurred.reduce(
    (total, lesson) =>
      total +
      (participants.get(lesson.id) || []).filter(
        (part) =>
          part.billing_mode === "overall" &&
          (part.attendance === "attended" ||
            (part.attendance === "no_show" &&
              policies.student_no_show?.deduct)),
      ).length *
        lesson.units,
    0,
  );
  const unpriced = snapshot
    ? (snapshot.unpriced_units ?? null)
    : Math.round(
        (overallUnits +
          earned.reduce((sum, row) => sum + row.unpriced_units, 0)) *
          100,
      ) / 100;
  return {
    ...totals,
    earned_amount: earnedAmount,
    other_income_amount: otherIncomeAmount,
    other_income: otherIncome,
    profit_cash: totals.profit_amount,
    profit_earned: snapshot
      ? (snapshot.profit_earned ?? null)
      : earnedAmount - totals.teacher_pay_amount - totals.cost_amount,
    unpriced_units: unpriced,
    cutoff,
    locked: full.locked,
    pending_count: ctx.lessons.filter(
      (l) => l.status === "planned" && Date.parse(l.start_at) <= time,
    ).length,
    scheduled_count: ctx.lessons.filter(
      (l) => l.status !== "cancelled" && Date.parse(l.start_at) > time,
    ).length,
  };
}
async function readApi(req, env, tenant, user, policy, path, url) {
  const r = repo(env, tenant.id),
    kindMatch =
      /^\/api\/finance\/(rates|payments|adjustments|costs)(?:\/([^/]+))?$/.exec(
        path,
      ),
    offset = integer(
      Number(url.searchParams.get("offset") || 0),
      "分页",
      0,
      1000000,
    );
  if (kindMatch) {
    const [, kind, id] = kindMatch,
      module = kind === "costs" ? "settlements" : "teacher_pay",
      teacher = teacherScope(user, url.searchParams.get("teacher_id"));
    requireCan(user, policy, module, "read", own(user));
    const rows = (await r.financeList(kind, id, teacher, offset))
      .map((row) => dto(user, policy, module, row))
      .filter(Boolean);
    if (id && !rows.length) fail(404, "不存在");
    return id
      ? { record: rows[0] }
      : { items: rows, next_offset: rows.length === 200 ? offset + 200 : null };
  }
  const month = monthIn(url.searchParams.get("month") || today().slice(0, 7)),
    teacher = teacherScope(user, url.searchParams.get("teacher_id"));
  if (path === "/api/finance/payroll") {
    requireCan(user, policy, "teacher_pay", "read", own(user));
    if (teacher) await get(r, "teachers", teacher);
    const ctx = await r.financeContext(month, teacher),
      payroll = calculatePayroll(ctx, contextPolicies(ctx));
    return {
      month,
      locked: payroll.locked,
      confirmation_status: payroll.locked ? "confirmed" : "unconfirmed",
      items: payroll.summaries
        .map((row) => dto(user, policy, "teacher_pay", row))
        .filter(Boolean),
      payments: ctx.payments
        .map((row) => dto(user, policy, "teacher_pay", row))
        .filter(Boolean),
      adjustments: ctx.adjustments
        .map((row) => dto(user, policy, "teacher_pay", row))
        .filter(Boolean),
      lessons: payroll.entries
        .map((row) => dto(user, policy, "teacher_pay", row))
        .filter(Boolean),
    };
  }
  if (path === "/api/finance/report") {
    requireCan(user, policy, "reports", "read");
    const ctx = await r.financeContext(month, null, can(user, policy, "packages", "read")),
      p = calculatePayroll(ctx, contextPolicies(ctx));
    const report = occurredReport(ctx, contextPolicies(ctx));
    const debt = ctx.debt?.[0];
    return {
      month,
      ...dto(user, policy, "reports", {
        ...summaryReport(ctx, p),
        earned_amount: report.earned_amount,
        other_income_amount: report.other_income_amount,
        other_income: report.other_income,
      }),
      ...(debt ? { debt_units: debt.debt_units, debt_student_count: debt.debt_student_count } : {}),
    };
  }
  if (path === "/api/finance/settlement") {
    requireCan(user, policy, "settlements", "read");
    const ctx = await r.financeContext(month),
      row = ctx.settlements[0] || {
        month,
        status: "draft",
        locked: 0,
        version: 0,
      };
    const out = { ...row };
    delete out.summary;
    delete out.snapshot_token;
    delete out.submitted_fingerprint;
    return { record: dto(user, policy, "settlements", out) };
  }
  if (path === "/api/export")
    return exportApi(env, tenant, user, policy, url, r, month, teacher);
  fail(404, "不存在");
}
async function exportApi(env, tenant, user, policy, url, r, month, teacher) {
  requireCan(user, policy, "exports", "export", own(user));
  const kind = url.searchParams.get("kind"),
    rows = [];
  if (kind === "lessons") {
    requireCan(user, policy, "lessons", "read", own(user));
    const items = await r.exportLessons(month, user);
    rows.push(
      ["北京时间", "课程", "教师", "地点", "分钟", "课时", "状态"],
      ...items.map((l) => [
        beijingTime(Date.parse(l.start_at)),
        l.course_name,
        l.teacher_name,
        l.location_name,
        l.duration,
        l.units,
        LESSON_LABELS[l.status] || "未知状态",
      ]),
    );
  } else if (kind === "packages") {
    requireCan(user, policy, "packages", "read", own(user));
    const student = user.roles.includes("student") ? user.student_id : null;
    let items = [];
    for (let offset = 0; offset < 5000; offset += 200) {
      const page = await r.creditRead("packages", student, null, offset);
      items.push(...page);
      if (page.length < 200) break;
      if (offset === 4800) fail(400, "课时包超过导出上限5000，请分期归档");
    }
    const cleaned = items
        .map((row) => dto(user, policy, "packages", row))
        .filter(Boolean),
      financial = can(user, policy, "tuition", "read", own(user));
    rows.push(
      [
        "学员",
        "课程",
        "总课时",
        "余额",
        ...(financial ? ["单价（元）", "金额（元）"] : []),
      ],
      ...cleaned.map((p) => [
        p.student_name,
        p.course_name,
        p.units_total,
        p.balance,
        ...(financial ? [moneyCell(p.unit_price), moneyCell(p.amount)] : []),
      ]),
    );
  } else if (kind === "finance") {
    requireCan(user, policy, "teacher_pay", "read", own(user));
    const ctx = await r.financeContext(month, teacher),
      p = calculatePayroll(ctx, contextPolicies(ctx));
    rows.push(
      [
        "教师",
        "月份",
        "应计（元）",
        "调整（元）",
        "合计（元）",
        "已付（元）",
        "未付（元）",
        "状态",
      ],
      ...p.summaries.map((row) => {
        const v = dto(user, policy, "teacher_pay", row);
        return [
          v.teacher_name,
          month,
          moneyCell(v.accrued_amount),
          moneyCell(v.adjustment_amount),
          moneyCell(v.total_amount),
          moneyCell(v.paid_amount),
          moneyCell(v.unpaid_amount),
          v.confirmation_status === "confirmed" ? "已确认" : "未确认",
        ];
      }),
    );
    if (can(user, policy, "tuition", "read", own(user))) {
      rows.push(
        [],
        ["学费收款"],
        ["学员", "收款日期", "金额（元）", "方式", "备注"],
        ...ctx.tuition.map((p) => {
          const v = dto(user, policy, "tuition", p);
          return [
            v.student_name,
            v.paid_at,
            moneyCell(v.amount),
            v.method,
            v.note,
          ];
        }),
      );
    }
    if (can(user, policy, "settlements", "read"))
      rows.push(
        [],
        ["其他成本"],
        ["日期", "类别", "金额（元）", "备注"],
        ...ctx.costs.map((row) => {
          const v = dto(user, policy, "settlements", row);
          return [v.date, v.category, moneyCell(v.amount), v.note];
        }),
      );
    rows.push(
      [],
      ["课酬调整"],
      ["教师", "月份", "金额（元）", "原因"],
      ...ctx.adjustments.map((row) => {
        const v = dto(user, policy, "teacher_pay", row);
        return [
          ctx.teachers.find((t) => t.id === v.teacher_id)?.name || "已归档教师",
          v.month,
          moneyCell(v.amount),
          v.reason,
        ];
      }),
      [],
      ["课酬付款"],
      ["教师", "月份", "金额（元）", "付款日期", "备注"],
      ...ctx.payments.map((row) => {
        const v = dto(user, policy, "teacher_pay", row);
        return [
          ctx.teachers.find((t) => t.id === v.teacher_id)?.name || "已归档教师",
          v.month,
          moneyCell(v.amount),
          v.paid_at,
          v.note,
        ];
      }),
    );
  } else if (kind === "report") {
    requireCan(user, policy, "reports", "read");
    const ctx = await r.financeContext(month),
      data = dto(
        user,
        policy,
        "reports",
        url.searchParams.get("scope") === "occurred"
          ? occurredReport(ctx, contextPolicies(ctx))
          : summaryReport(ctx, calculatePayroll(ctx, contextPolicies(ctx))),
      );
    const revenue = dto(
      user,
      policy,
      "reports",
      occurredReport(ctx, contextPolicies(ctx)),
    );
    const metrics = [
      ["earned_amount", "确认收入（元）"],
      ["profit_cash", "现金利润（元）"],
      ["profit_earned", "确认利润（元）"],
      ["unpriced_units", "未计价课时"],
    ].filter(([key]) => key in revenue);
    if (metrics.length)
      rows.push(
        metrics.map(([, label]) => label),
        metrics.map(([key]) =>
          key === "unpriced_units" ? revenue[key] : moneyCell(revenue[key]),
        ),
        [],
      );
    if (can(user, policy, "tuition", "read"))
      for (const row of revenue.other_income || [])
        rows.push(["其他收入", row.category, moneyCell(row.amount)]);
    rows.push(
      [
        "维度",
        "名称",
        "课次",
        "课时",
        ...(can(user, policy, "teacher_pay", "read") ? ["课酬分摊（元）"] : []),
      ],
      ...["teachers", "courses", "students"].flatMap((k) =>
        data[k].map((row) => [
          { teachers: "教师", courses: "课程", students: "学员" }[k],
          row.name,
          row.lesson_count,
          row.units,
          ...("teacher_pay_amount" in row
            ? [moneyCell(row.teacher_pay_amount)]
            : []),
        ]),
      ),
    );
  } else if (kind === "logs") {
    const full = can(user, policy, "logs", "read");
    if (!full) requireCan(user, policy, "logs", "read_finance");
    const items = await r.logs("audit", offsetOf(url), !full);
    rows.push(
      ["时间", "操作人", "模块", "操作", "摘要"],
      ...items.map((l) => [
        beijingTime(l.at),
        l.actor_label,
        MODULE_LABELS[l.module] || "业务模块",
        ACTION_LABELS[l.action] || "业务操作",
        l.summary,
      ]),
    );
  } else fail(404, "不存在");
  if (rows.length > 20001) fail(400, "导出记录过多，请按教师或月份分批");
  await r.audit(
    user,
    "exports",
    "export",
    kind,
    "导出 " +
      EXPORT_KIND_LABELS[kind] +
      " " +
      month +
      " · " +
      Math.max(0, rows.length - 1) +
      "行",
  );
  env.__exportRecordCount = Math.max(0, rows.length - 1);
  return new Response(workbook(rows, "教务数据"), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="' + kind + "-" + month + '.xlsx"',
    },
  });
}
function offsetOf(url) {
  return integer(
    Number(url.searchParams.get("offset") || 0),
    "分页",
    0,
    1000000,
  );
}
async function writeApi(req, env, tenant, user, policy, path, url, body) {
  const r = repo(env, tenant.id),
    match =
      /^\/api\/finance\/(rates|payments|adjustments|costs|tuition)(?:\/([^/]+))?$/.exec(
        path,
      ),
    settle =
      /^\/api\/finance\/settlements\/(submit|approve|unlock|reject)$/.exec(
        path,
      ),
    override = /^\/api\/finance\/lessons\/([^/]+)\/rate$/.exec(path);
  if (!match && !settle && !override) fail(404, "不存在");
  const kind = match?.[1],
    id = match?.[2],
    module =
      settle || kind === "costs"
        ? "settlements"
        : kind === "tuition"
          ? "tuition"
          : "teacher_pay",
    action =
      settle?.[1] ||
      (req.method === "POST"
        ? "create"
        : req.method === "PATCH"
          ? "update"
          : req.method === "DELETE"
            ? "delete"
            : null);
  if (
    !action ||
    (settle && req.method !== "POST") ||
    (override && req.method !== "POST")
  )
    fail(404, "不存在");
  requireCan(user, policy, module, override ? "update" : action);
  const d = await body(req),
    op = d.operation_id;
  if (typeof op !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(op))
    fail(400, "缺少有效操作编号");
  const hash = await sha(
      JSON.stringify({ path, method: req.method, body: d, user: user.id }),
    ),
    oldOp = await r.creditOperation(op);
  if (oldOp) {
    if (oldOp.actor_id !== user.id || oldOp.request_hash !== hash)
      fail(409, "操作编号已使用");
    return JSON.parse(oldOp.response_json);
  }
  const revision = await r.dataVersion(),
    changes = [];
  let result;
  if (settle) {
    const month = monthIn(d.month),
      ctx = await r.financeContext(month, null, false, ["submit", "approve"].includes(action)),
      previous = ctx.settlements[0],
      row = previous
        ? { ...previous }
        : {
            id: randomId("settlement"),
            month,
            locked: 0,
            status: "draft",
            summary: "{}",
            reason: "",
            deleted_at: null,
          };
    if (integer(d.version, "版本", 0, 2147483647) !== (previous?.version || 0))
      fail(409, "结算已修改，请刷新");
    if (
      ["submit", "approve"].includes(action) &&
      ctx.pending_submissions.length && !ctx.pending_checkout?.length
    )
      fail(
        409,
        "本月仍有待确认提交，请先处理以下课程：" +
          ctx.pending_submissions
            .map(
              (l) =>
                l.course_name +
                "（" +
                beijingTime(Date.parse(l.start_at)) +
                "）",
            )
            .join("、"),
        "PENDING_SUBMISSIONS",
      );
    if (ctx.pending_checkout?.length) {
      const total = ctx.pending_checkout[0].total;
      const items = ctx.pending_checkout.map(({ start_at, course_name, teacher_name, student_names }) => ({
        start_at, course_name, teacher_name, student_names: JSON.parse(student_names).sort(),
      }));
      const pendingReview = ctx.pending_submissions.length
        ? "本月另有 " + ctx.pending_submissions.length + " 条待确认提交。"
        : "";
      const message = pendingReview + "本月有 " + total + " 节已开始但仍有学员待销课：" +
        items.map((l) => beijingTime(Date.parse(l.start_at)) + " " + l.course_name + " · " + l.teacher_name + " · 待销：" + l.student_names.join("、")).join("；") +
        (total > items.length ? "；仅列前 20 节" : "");
      const error = new HttpError(409, message, pendingReview ? "PENDING_SUBMISSIONS" : "PENDING_CHECKOUT");
      error.details = { total, items };
      throw error;
    }
    if (action === "submit") {
      if (row.locked) fail(409, "月份已锁定");
      row.status = "pending";
      row.submitted_by = user.id;
      row.submitted_at = now();
      row.submitted_revision = null; // 旧列保留兼容，跨请求不再比较机构全局版本。
      row.submitted_fingerprint = await settlementFingerprint(ctx);
      row.reason = "";
    } else if (action === "approve") {
      if (row.status !== "pending" || row.locked) fail(409, "请先由财务提交");
      if (row.submitted_by === user.id) fail(403, "提交人与批准人必须不同");
      if (
        !row.submitted_fingerprint ||
        row.submitted_fingerprint !== (await settlementFingerprint(ctx))
      )
        fail(409, "提交后本月结算数据已变更，请财务重新提交");
      const payroll = calculatePayroll(ctx, contextPolicies(ctx)),
        token = randomId("snapshot");
      row.locked = 1;
      row.status = "locked";
      row.approved_by = user.id;
      row.approved_at = now();
      row.snapshot_token = token;
      const totals = summaryReport(ctx, payroll);
      row.total_amount = totals.teacher_pay_amount;
      row.tuition_amount = totals.tuition_amount;
      row.cost_amount = totals.cost_amount;
      row.profit_amount = totals.profit_amount;
      const { earned_amount, profit_earned, unpriced_units, other_income } = occurredReport(
        ctx,
        contextPolicies(ctx),
      );
      row.summary = JSON.stringify({
        lesson_count: totals.lesson_count,
        participant_count: totals.participant_count,
        teacher_count: payroll.summaries.length,
        earned_amount,
        other_income,
        profit_earned,
        unpriced_units,
      });
      for (const entry of payroll.entries) {
        changes.push({
          resource: "payroll_snapshots",
          data: {
            id: randomId("payroll"),
            month,
            snapshot_token: token,
            lesson_id: entry.id,
            teacher_id: entry.teacher_id,
            rate: entry.rate,
            rate_basis: entry.rate_basis,
            quantity: entry.quantity,
            amount: entry.amount,
            lesson_json: JSON.stringify(
              Object.fromEntries(
                Object.entries(entry).filter(
                  ([key]) =>
                    !["rate", "amount", "rate_basis", "quantity"].includes(key),
                ),
              ),
            ),
            deleted_at: null,
          },
        });
        const lesson = ctx.lessons.find((l) => l.id === entry.id);
        changes.push({
          resource: "lessons",
          previous: lesson,
          data: { ...lesson, locked_rate: entry.rate },
        });
      }
    } else {
      row.reason = string(d.reason, "原因", 1000);
      if (action === "unlock" && !row.locked) fail(409, "月份未锁定");
      if (action === "reject" && row.status !== "pending")
        fail(409, "没有待审批结算");
      row.locked = 0;
      row.status = "draft";
      row.submitted_by = null;
      row.submitted_revision = null;
      row.submitted_fingerprint = null;
      row.approved_by = null;
      row.approved_at = null;
      row.snapshot_token = null;
    }
    changes.push({ resource: "settlements", previous, data: row });
    result = { id: row.id, committed: true, status: row.status };
  } else if (override) {
    const old = await get(r, "lessons", override[1]);
    if (old.source_course_id) fail(403, "合作课程不参与机构课酬");
    if (version(d.version) !== old.version) fail(409, "课程已修改");
    await r.assertUnlocked([old.start_at.slice(0, 7)]);
    const row = {
      ...old,
      override_rate: moneyIn(d.override_rate, { nullable: true }),
      override_basis: d.override_basis || "legacy",
    };
    if (!["legacy", "unit", "lesson", "person"].includes(row.override_basis))
      fail(400, "计费方式不正确");
    changes.push({ resource: "lessons", previous: old, data: row });
    result = { id: old.id, committed: true };
  } else {
    const table = {
      rates: "teacher_rates",
      payments: "teacher_payments",
      adjustments: "teacher_adjustments",
      costs: "other_costs",
      tuition: "student_payments",
    }[kind];
    if (
      (req.method === "POST" && id) ||
      (req.method !== "POST" && !id) ||
      (kind === "tuition" && req.method === "POST")
    )
      fail(404, "不存在");
    const loaded = id && kind === "tuition" ? await r.tuitionForEdit(id) : null;
    if (id && kind === "tuition" && !loaded) fail(404, "不存在");
    const { package_due, package_paid_elsewhere, ...tuition } = loaded || {};
    const old = loaded ? tuition : id ? await get(r, table, id) : null;
    if (old && version(d.version) !== old.version)
      fail(409, "记录已修改，请刷新");
    if (old)
      for (const [key, table] of [
        ["teacher_id", "teachers"],
        ["course_type_id", "course_types"],
        ["student_id", "students"],
        ["package_id", "packages"],
      ])
        if (d[key] !== undefined && d[key] !== old[key]) {
          if (d[key]) await get(r, table, d[key]);
          fail(400, "记录归属不能更换");
        }

    const row = old ? { ...old } : { id: randomId(kind), deleted_at: null };
    if (kind === "rates") {
      row.teacher_id = old?.teacher_id || d.teacher_id;
      row.course_type_id = old?.course_type_id || d.course_type_id;
      await r.primeReferences({
        teacherIds: [row.teacher_id],
        typeIds: [row.course_type_id],
      });
      await get(r, "teachers", row.teacher_id);
      const type = await get(r, "course_types", row.course_type_id);
      row.format = old?.format || d.format || type.format;
      if (!["individual", "group", "class"].includes(row.format))
        fail(400, "课程形式不正确");
      row.rate_basis = d.rate_basis ?? old?.rate_basis ?? "legacy";
      if (!["legacy", "unit", "lesson", "person"].includes(row.rate_basis))
        fail(400, "计费模式不正确");
      row.rate = d.rate === undefined && old ? old.rate : moneyIn(d.rate);
      row.effective_from = day(
        d.effective_from || old?.effective_from || "2000-01-01",
      );
      row.effective_to = day(
        d.effective_to || old?.effective_to || "2099-12-31",
      );
      if (row.effective_from > row.effective_to)
        fail(400, "标准生效日期不正确");
      const locks = await r.rateLocks(
        old && old.effective_from < row.effective_from
          ? old.effective_from
          : row.effective_from,
        old && old.effective_to > row.effective_to
          ? old.effective_to
          : row.effective_to,
      );
      for (const { month } of locks) {
        const start = month + "-01",
          last = new Date(
            Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
          )
            .toISOString()
            .slice(0, 10);
        const interval = (x) =>
          !x || x.effective_from > last || x.effective_to < start
            ? null
            : [
                x.effective_from > start ? x.effective_from : start,
                x.effective_to < last ? x.effective_to : last,
                x.rate,
                x.rate_basis,
              ];
        if (
          JSON.stringify(interval(old)) !==
          JSON.stringify(interval(req.method === "DELETE" ? null : row))
        )
          fail(409, month + " 已锁定，标准变更会影响历史月份");
      }
      if (req.method !== "DELETE" && (await r.rateOverlap(row)))
        fail(409, "该教师、课程和形式的标准生效日期重叠");
    } else if (kind === "costs") {
      row.date = day(d.date || old?.date || today());
      await r.assertUnlocked(
        [row.date.slice(0, 7), old?.date?.slice(0, 7)].filter(Boolean),
      );
      row.category = string(d.category ?? old?.category, "成本类别", 100);
      row.amount =
        d.amount === undefined && old ? old.amount : moneyIn(d.amount);
      row.note = string(d.note ?? old?.note ?? "", "备注", 1000, 0);
    } else if (kind === "tuition") {
      const resolved = await r.businessGet("student_payment_resolutions", old.id);
      if (resolved && (req.method === "DELETE" ||
        (d.amount !== undefined && moneyIn(d.amount) !== old.amount) ||
        (d.paid_at !== undefined && day(d.paid_at) !== old.paid_at)))
        fail(409, "已分配或归类的缴费不能直接更改金额、日期或删除，请走冲正");
      row.amount = d.amount === undefined ? old.amount : moneyIn(d.amount);
      if (row.amount <= 0) fail(400, "缴费金额须大于零");
      if (old.package_id && row.amount > old.amount && row.amount > Math.max(0, (package_due ?? 0) - package_paid_elsewhere))
        fail(409, "修改后缴费超出课时包剩余应收，请另行登记缴费，超出部分会转入预收余额", "PAYMENT_OVERFLOW_EDIT");
      row.paid_at = day(d.paid_at || old.paid_at);
      await r.assertUnlocked([
        row.paid_at.slice(0, 7),
        old.paid_at.slice(0, 7),
      ]);
      row.method = string(d.method ?? old.method, "方式", 50, 0);
      row.note = string(d.note ?? old.note, "备注", 1000, 0);
    } else {
      row.teacher_id = old?.teacher_id || d.teacher_id;
      await get(r, "teachers", row.teacher_id);
      row.month = monthIn(d.month || old?.month);
      if (kind !== "payments" || req.method !== "POST")
        await r.assertUnlocked([row.month, old?.month].filter(Boolean));
      row.amount =
        d.amount === undefined && old
          ? old.amount
          : moneyIn(d.amount, { signed: kind === "adjustments" });
      if (kind === "payments") {
        if (row.amount <= 0) fail(400, "付款须大于零");
        row.paid_at = day(d.paid_at || old?.paid_at || today());
        if (req.method !== "POST")
          await r.assertUnlocked(
            [row.paid_at.slice(0, 7), old?.paid_at?.slice(0, 7)].filter(
              Boolean,
            ),
          );
        row.note = string(d.note ?? old?.note ?? "", "备注", 1000, 0);
      } else row.reason = string(d.reason ?? old?.reason, "调整原因", 1000);
    }
    if (row.teacher_id && (await r.partnerManaged("teachers", row.teacher_id)))
      fail(403, "合作讲师不参与机构课酬");
    if (req.method === "DELETE") row.deleted_at = now();
    changes.push({ resource: table, previous: old, data: row });
    result = { id: row.id, committed: true };
  }
  changes.push({
    resource: "credit_operations",
    data: {
      id: op,
      actor_id: user.id,
      request_hash: hash,
      response_json: JSON.stringify(result),
      deleted_at: null,
    },
  });
  await r.commitBusiness(revision, changes, user, module, action);
  return result;
}
export async function financeApi(
  req,
  env,
  tenant,
  user,
  policy,
  path,
  url,
  bodyReader,
) {
  if (req.method === "GET")
    return readApi(req, env, tenant, user, policy, path, url);
  let saved;
  const body = async (request) => saved ?? (saved = await bodyReader(request));
  for (let retry = 0; ; retry++) {
    try {
      return moneyOut(
        await writeApi(req, env, tenant, user, policy, path, url, body),
      );
    } catch (e) {
      if ((e.code !== "SCHEDULE_RETRY" && e.status !== 409) || retry >= 1)
        throw e;
    }
  }
}
