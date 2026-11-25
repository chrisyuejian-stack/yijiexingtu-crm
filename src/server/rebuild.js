import { studentSearchKeys } from "./student-search.js";
import { maxDebtUnits } from "./debt.js";
import { repo } from "./repo.js";
import { requireCan } from "./accounts.js";
import { can, projectRecord } from "./permissions.js";
import { fail, integer, string, now } from "./core.js";
import { addStudentSummaries, day, nextDay } from "./scheduling.js";
import { makeupPlanning } from "./makeup-planning.js";
import { renewalSettings } from "./tools.js";
import { effectivePolicies } from "./absence.js";
import { creditPreview } from "./credits.js";
import { calculatePayroll } from "./finance.js";
import { moneyOut } from "./numbers.js";
const date = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
    new Date(now()),
  );
export async function rebuildApi(
  req,
  env,
  t,
  user,
  policy,
  path,
  url,
  readBody,
) {
  if (
    !user.roles.some((r) => ["supervisor", "academic", "finance"].includes(r))
  )
    fail(403, "没有权限");
  const r = repo(env, t.id),
    offset = integer(
      Number(url.searchParams.get("offset") || 0),
      "分页",
      0,
      1000000,
    ),
    today = date(),
    settings = renewalSettings(policy.settings);
  if (path === "/api/c2/students/counts" && req.method === "GET") {
    requireCan(user, policy, "students", "read");
    return r.c2StudentCounts(today, settings);
  }
  if (path === "/api/c2/students" && req.method === "GET") {
    requireCan(user, policy, "students", "read");
    const data = await r.c2StudentPage({
      at: now(),
      today,
      days: settings.expiry_warning_days,
      q: string(url.searchParams.get("q") || "", "搜索", 100, 0),
      status: string(url.searchParams.get("status") ?? "active", "状态", 10, 0),
      course: string(url.searchParams.get("course") || "", "课程", 80, 0),
      balance: string(url.searchParams.get("balance") || "", "余额筛选", 10, 0),
      sort: url.searchParams.get("sort") || "default",
      dir: url.searchParams.get("dir") || "asc",
      offset,
      low: settings.low_balance_threshold,
    });
    const packageAccess = can(user, policy, "packages", "read");
    const groups = packageAccess
      ? Object.groupBy(
          await r.studentRenewalGroups(
            today,
            settings,
            data.items.map((item) => item.id),
          ),
          (row) => row.student_id,
        )
      : {};
    for (const item of data.items) {
      item.search_keys = studentSearchKeys(item.name);
      if (packageAccess) item.renewal_groups = groups[item.id] || [];
      else
        for (const key of ["balance", "package_count", "course_names"])
          delete item[key];
      if (!can(user, policy, "schedule", "read"))
        for (const key of ["next_start", "teacher_names"]) delete item[key];
    }
    return {
      ...data,
      settings,
      next_offset: offset + 50 < data.total ? offset + 50 : null,
    };
  }
  const student = /^\/api\/c2\/students\/([^/]+)$/.exec(path);
  if (student && req.method === "GET") {
    requireCan(user, policy, "students", "read");
    const out = await r.c2StudentSnapshot(student[1], now(), today, settings,
      can(user, policy, "packages", "read"), can(user, policy, "schedule", "read"));
    if (!out) fail(404, "不存在");
    if (!can(user, policy, "tuition", "read"))
      for (const k of ["paid_amount", "due_amount", "due_unresolved"])
        delete out.facts[k];
    if (!can(user, policy, "packages", "read"))
      for (const k of ["balance", "package_count", "debt_units", "available_units"]) delete out.facts[k];
    if (!can(user, policy, "schedule", "read")) delete out.recent;
    else if (!can(user, policy, "comments", "read"))
      for (const row of out.recent)
        for (const k of ["public_text", "private_comment"]) delete row[k];
    return moneyOut(out);
  }
  const blocks = /^\/api\/c2\/students\/([^/]+)\/blocks$/.exec(path);
  if (blocks && req.method === "GET") {
    requireCan(user, policy, "students", "read");
    if (!(await r.businessGet("students", blocks[1]))) fail(404, "不存在");
    const items = await r.c2StudentBlocks(blocks[1], offset);
    return { items, next_offset: items.length === 50 ? offset + 50 : null };
  }
  const history = /^\/api\/c2\/students\/([^/]+)\/history$/.exec(path);
  if (history && req.method === "GET") {
    requireCan(user, policy, "students", "read");
    requireCan(user, policy, "schedule", "read");
    if (!(await r.businessGet("students", history[1]))) fail(404, "不存在");
    const items = await r.c2StudentHistory(history[1], now(), offset);
    if (!can(user, policy, "comments", "read"))
      for (const row of items) {
        delete row.public_text;
        delete row.private_comment;
      }
    return { items, next_offset: items.length === 50 ? offset + 50 : null };
  }
  if (path === "/api/c2/home" && req.method === "GET") {
    requireCan(user, policy, "home", "read");
    const monday = nextDay(today, -((new Date(today + "T12:00Z").getUTCDay() + 6) % 7));
    const schedule = can(user, policy, "schedule", "read");
    const { data, counts, week, stages, leads } = await r.workbench(today, settings, {
      at: now(),
      week: schedule ? [monday, nextDay(monday, 7)] : null,
      stages: can(user, policy, "followup", "read") && can(user, policy, "students", "read"),
      leads: can(user, policy, "leads", "read"),
    });
    if (schedule) {
      await addStudentSummaries(r, data.lessons, user);
      data.week = week;
    } else {
      delete data.lessons;
      delete data.lesson_count;
    }
    if (!can(user, policy, "tuition", "read")) delete data.tuition_amount;
    const permitted = {
      unchecked_lessons: "schedule",
      followup_overdue: "followup",
      renewal_zero: "packages",
      renewal_debt: "packages",
      renewal_low: "packages",
      renewal_expiring: "packages",
    };
    data.counts = {};
    for (const [k, m] of Object.entries(permitted))
      if (can(user, policy, m, "read")) data.counts[k] = counts[k];
    if (!can(user, policy, "attendance", "read")) {
      delete data.pending;
      delete data.overdue;
    }
    if (!can(user, policy, "followup", "read")) delete data.tasks;
    if (!can(user, policy, "packages", "read")) {
      delete data.renewals;
      delete data.expiring;
    }
    data.actions = [];
    if (can(user, policy, "followup", "read")) {
      data.actions.push(
        ...(data.tasks || [])
          .filter((x) => x.due_date <= today)
          .map((x) => ({
            ...x,
            kind: "followup",
            title:
              (x.student_name || "未关联学员") +
              " · " +
              x.title +
              " · " +
              (x.due_date < today ? "逾期" : "今天"),
            priority: x.due_date < today ? 0 : 1,
          })),
      );
      if (can(user, policy, "students", "read"))
        data.actions.push(
          ...stages.map((x) => ({
            id: x.id,
            student_id: x.student_id,
            title: x.student_name + " · 学习阶段已到期 · 今天",
            kind: "stage",
            priority: 1,
          })),
        );
    }
    for (const item of data.renewals || [])
      if (item.balance <= 0 || item.expiring)
        data.actions.push({
          id: item.id,
          package_ids: item.package_ids,
          course_type_id: item.course_type_id,
          category_id: item.category_id,
          scope_kind: item.scope_kind,
          student_id: item.student_id,
          title:
            item.student_name +
            " · " +
            (item.balance <= 0 ? "课时已用完" : "课时包即将到期"),
          kind: "renewal",
          priority: item.balance <= 0 ? 2 : 3,
        });
    if (can(user, policy, "leads", "read"))
      data.actions.push(
        ...leads.map((x) => ({
          id: x.id,
          title: x.name + " · 今天回访",
          kind: "lead",
          priority: 4,
        })),
      );
    data.actions.sort(
      (a, b) =>
        a.priority - b.priority ||
        Number(a.kind === "stage") - Number(b.kind === "stage") ||
        String(a.due_date || "").localeCompare(b.due_date || ""),
    );
    data.actions = data.actions.slice(0, 6);
    return moneyOut(data);
  }
  if (path === "/api/c2/unchecked" && req.method === "GET") {
    requireCan(user, policy, "schedule", "read");
    const items = await r.c2Unchecked(now(), offset);
    await addStudentSummaries(r, items, user);
    const total =
      items[0]?.page_total ??
      (offset ? ((await r.c2Unchecked(now(), 0))[0]?.page_total ?? 0) : 0);
    for (const item of items) delete item.page_total;
    return {
      items,
      total,
      next_offset: offset + 50 < total ? offset + 50 : null,
    };
  }
  if (path === "/api/c2/makeups" && req.method === "GET") {
    requireCan(user, policy, "attendance", "read");
    const items = await r.c2PendingMakeups(offset);
    const total =
      items[0]?.page_total ??
      (offset ? ((await r.c2PendingMakeups())[0]?.page_total ?? 0) : 0);
    for (const item of items) delete item.page_total;
    return {
      items,
      total,
      next_offset: offset + 50 < total ? offset + 50 : null,
    };
  }
  if (path === "/api/c2/followups" && req.method === "GET") {
    requireCan(user, policy, "followup", "read");
    const group = url.searchParams.get("group") || "today";
    if (!["overdue", "today", "future", "done"].includes(group))
      fail(400, "分组不正确");
    const items = await r.c2Followups(
      today,
      group,
      string(url.searchParams.get("owner") || "", "负责人", 80, 0),
      offset,
    );
    const stages =
      !url.searchParams.get("owner") &&
      group === "today" &&
      can(user, policy, "students", "read")
        ? await r.c2ExpiredStages(today, offset)
        : [];
    return {
      items,
      stages,
      next_offset:
        items.length === 50 || stages.length === 50 ? offset + 50 : null,
    };
  }
  if (path === "/api/c2/renewals" && req.method === "GET") {
    requireCan(user, policy, "packages", "read");
    const group = url.searchParams.get("group") || "";
    if (!["", "debt", "zero", "low", "expiring", "expired"].includes(group))
      fail(400, "分组不正确");
    const items = await r.c2Renewals(today, settings, offset, group);
    const total =
      items[0]?.page_total ??
      (offset
        ? ((await r.c2Renewals(today, settings, 0, group))[0]?.page_total ?? 0)
        : 0);
    for (const item of items) delete item.page_total;
    return {
      items,
      settings,
      total,
      next_offset: offset + 50 < total ? offset + 50 : null,
    };
  }
  const preview = /^\/api\/c2\/lessons\/([^/]+)\/preview$/.exec(path);
  if (preview && req.method === "POST") {
    requireCan(user, policy, "attendance", "read");
    requireCan(user, policy, "packages", "read");
    const lesson = await r.businessGet("lessons", preview[1]);
    if (!lesson || lesson.source_course_id) fail(404, "不存在");
    const type = await r.businessGet("course_types", lesson.course_type_id);
    lesson.category_id = type.category_id;
    const d = await readBody(req);
    const result = await creditPreview(
      r,
      lesson,
      d.participants,
      effectivePolicies(policy.settings),
      maxDebtUnits(policy.settings),
    );
    result.locked =
      (await r.rateLocks(lesson.start_at, lesson.start_at)).length > 0;
    if (can(user, policy, "teacher_pay", "read")) {
      const ctx = await r.financeContext(lesson.start_at.slice(0, 7));
      result.locked = !!ctx.settlements[0]?.locked;
      if (!result.locked) {
        const before = calculatePayroll(
            ctx,
            effectivePolicies(policy.settings),
          ),
          after = calculatePayroll(
            {
              ...ctx,
              lessons: ctx.lessons.filter((l) => l.id !== lesson.id),
              participants: ctx.participants.filter(
                (p) => p.lesson_id !== lesson.id,
              ),
            },
            effectivePolicies(policy.settings),
          );
        result.undo = {
          teacher_pay_amount:
            after.summaries.reduce((n, x) => n + x.total_amount, 0) -
            before.summaries.reduce((n, x) => n + x.total_amount, 0),
        };
      }
    }
    return moneyOut(result);
  }
  const makeup = /^\/api\/c2\/makeups\/([^/]+)\/(suggestions|day|check)$/.exec(
    path,
  );
  if (makeup)
    return makeupPlanning(
      req,
      env,
      t,
      r,
      user,
      policy,
      makeup,
      url,
      today,
      readBody,
    );
  fail(404, "不存在");
}
