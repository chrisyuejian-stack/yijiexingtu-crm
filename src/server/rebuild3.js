import { generateTemplates } from "./scheduling.js";
import { repo } from "./repo.js";
import { can, projectRecord } from "./permissions.js";
import { requireCan } from "./accounts.js";
import { fail, now, integer } from "./core.js";
import { moneyOut } from "./numbers.js";
import { occurredReport } from "./finance.js";
import { renewalSettings } from "./tools.js";
import { effectivePolicies } from "./absence.js";
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
    new Date(now()),
  );
function viewMonth(url, day) {
  const month = url.searchParams.get("month") || day.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail(400, "月份不正确");
  return month;
}
export async function rebuild3Api(req, env, t, user, policy, path, url, body) {
  if (path === "/api/c3/templates/preview" && req.method === "POST") {
    if (user.roles.some((x) => ["teacher", "student"].includes(x)))
      fail(403, "没有权限");
    return generateTemplates(req, env, t, user, policy, {
      ...(await body(req)),
      preview: true,
    });
  }
  if (req.method !== "GET") fail(404, "不存在");
  const r = repo(env, t.id),
    day = today(),
    offset = integer(
      Number(url.searchParams.get("offset") || 0),
      "分页",
      0,
      1000000,
    ),
    teacher = user.roles.includes("teacher"),
    student = user.roles.includes("student");
  const roster = /^\/api\/c3\/classes\/([^/]+)\/roster$/.exec(path);
  if (roster) {
    if (teacher || student) fail(403, "没有权限");
    requireCan(user, policy, "classes", "read");
    if (!(await r.businessGet("classes", roster[1]))) fail(404, "不存在");
    return {
      items: await r.c3ClassRoster(
        roster[1],
        day,
        now(),
        can(user, policy, "packages", "read"),
      ),
    };
  }
  if (
    path === "/api/c3/teacher-students" ||
    /^\/api\/c3\/teacher-students\/[^/]+$/.test(path)
  ) {
    if (!teacher || !user.teacher_id) fail(403, "没有权限");
    requireCan(user, policy, "students", "read", {
      teacher_id: user.teacher_id,
    });
    requireCan(user, policy, "schedule", "read", {
      teacher_id: user.teacher_id,
    });
    const rows = await r.c3TeacherRoster(
      user.teacher_id,
      day +
        "T" +
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Shanghai",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(now())) +
        "+08:00",
      day,
    );
    const id = path.split("/")[4];
    if (id) {
      if (!rows.some((x) => x.student_id === id)) fail(404, "不存在");
      const items = await r.c3TeacherHistory(user.teacher_id, id, offset);
      if (
        !can(user, policy, "comments", "read", { teacher_id: user.teacher_id })
      )
        for (const x of items) {
          delete x.public_text;
          delete x.private_comment;
        }
      return { items, next_offset: items.length === 50 ? offset + 50 : null };
    }
    return {
      items: rows.map((row) => {
        const out = {
          student_id: row.student_id,
          name: row.name,
          grade: row.grade,
          course_name: row.course_name,
          course_type_id: row.course_type_id,
          last_comment: row.last_comment,
        };
        if (
          !can(user, policy, "comments", "read", {
            teacher_id: user.teacher_id,
          })
        )
          delete out.last_comment;
        if (
          can(user, policy, "students", "read_balance", {
            teacher_id: user.teacher_id,
            current_main: !!row.current_main,
          })
        )
          out.balance = row.balance;
        return out;
      }),
      balance_enabled: policy.settings.teacher_view_student_balance === true,
    };
  }
  if (path === "/api/c3/student-comments") {
    if (!student || !user.student_id) fail(403, "没有权限");
    requireCan(user, policy, "comments", "read", {
      student_id: user.student_id,
    });
    return { items: await r.c3StudentComments(user.student_id) };
  }
  if (teacher || student) fail(403, "没有权限");
  if (path === "/api/c3/receipts") {
    requireCan(user, policy, "tuition", "read");
    const id = url.searchParams.get("student_id") || null;
    if (id && !(await r.businessGet("students", id))) fail(404, "不存在");
    const data = await r.c3Receipts(viewMonth(url, day), id, offset);
    if (id && can(user, policy, "packages", "read"))
      data.renewal_groups = await r.studentRenewalGroups(
        day,
        renewalSettings(policy.settings),
        [id],
      );
    return moneyOut({
      ...data,
      next_offset: offset + 50 < data.total ? offset + 50 : null,
    });
  }
  if (path === "/api/c3/costs-summary") {
    requireCan(user, policy, "settlements", "read");
    return moneyOut(await r.c3CostSummary(viewMonth(url, day)));
  }

  if (path === "/api/c3/leads-summary") {
    requireCan(user, policy, "leads", "read");
    const month = day.slice(0, 7),
      d = new Date(day + "T00:00:00+08:00");
    const from = Date.parse(month + "-01T00:00:00+08:00");
    d.setUTCMonth(d.getUTCMonth() + 1, 1);
    const to = Date.parse(
      new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
        d,
      ) + "T00:00:00+08:00",
    );
    const out = await r.c3LeadSummary(from, to);
    return {
      ...out,
      conversion_rate: out.added
        ? Math.round((out.converted / out.added) * 100)
        : 0,
    };
  }
  if (path === "/api/c3/teachers") {
    requireCan(user, policy, "settings", "read");
    const d = new Date(day + "T12:00:00Z"),
      from = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000)
        .toISOString()
        .slice(0, 10),
      to = new Date(Date.parse(from + "T12:00:00Z") + 7 * 86400000)
        .toISOString()
        .slice(0, 10);
    return { items: await r.c3Teachers(from, to) };
  }
  if (path === "/api/c3/report") {
    requireCan(user, policy, "reports", "read");
    const month = viewMonth(url, day);
    const trend = [];
    let current;
    for (let i = 5; i >= 0; i--) {
      const m = new Date(
          Date.UTC(
            Number(month.slice(0, 4)),
            Number(month.slice(5, 7)) - 1 - i,
            1,
          ),
        )
          .toISOString()
          .slice(0, 7),
        ctx = await r.financeContext(m),
        policies = effectivePolicies({
          absence_policies: JSON.parse(
            ctx.absence_settings?.[0]?.value || "{}",
          ),
        }),
        end = new Date(
          Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0),
        )
          .toISOString()
          .slice(0, 10),
        report = occurredReport(ctx, policies, end < day ? end : day);
      if (i === 0) current = report;
      trend.push({
        month: m,
        tuition_amount: report.tuition_amount,
        earned_amount: report.earned_amount,
        profit_cash: report.profit_cash,
        profit_earned: report.profit_earned,
        unpriced_units: report.unpriced_units,
        teacher_pay_amount: report.teacher_pay_amount,
        cost_amount: report.cost_amount,
      });
    }
    const debt = can(user, policy, "packages", "read") ? await r.creditDebtTotal() : null;
    return moneyOut(
      projectRecord(user, policy, "reports", { month, ...current, trend,
        ...(debt ? { debt_units: debt.debt_units, debt_student_count: debt.debt_student_count } : {}),
      }),
    );
  }
  fail(404, "不存在");
}
