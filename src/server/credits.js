import { changeFunds, fundsRoute, readFunds, allocateLegacyPayment } from "./credit-funds.js";
import { matchesDebtScope, maxDebtUnits, repayDebts, validForLesson } from "./debt.js";
import { packageStatus, stageStatus } from "../shared/view.js";
import { effectivePolicies } from "./absence.js";
import { moneyIn, moneyOut, quantityIn, multiplyCents } from "./numbers.js";
import { repo } from "./repo.js";
import { fail, randomId, version, integer, string, sha, now } from "./core.js";
import { can, projectRecord } from "./permissions.js";
import { requireCan } from "./accounts.js";
import { day, prepareMakeupLesson, conflicts } from "./scheduling.js";
const EPS = 0.001;
const today = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
const round = (n) => Math.round(n * 100) / 100;
const quantity = (value, zero = false) => quantityIn(value, { zero });
const money = (value) => moneyIn(value, { nullable: true });
const scope = (user) => ({
  id: user.id,
  student_id: user.student_id,
  teacher_id: user.teacher_id,
});
const actorStudent = (user, input) =>
  user.roles.includes("student") ? user.student_id : input || null;
const groupMonth = (value) => String(value).slice(0, 7);
function clean(user, policy, module, row) {
  const out = projectRecord(user, policy, module, moneyOut(row));
  if (!out) return null;
  for (const key of ["tenant_id", "created_by", "updated_by"]) delete out[key];
  return out;
}
async function owned(r, kind, id) {
  if (typeof id !== "string" || !id) fail(400, "关联 ID 不正确");
  const row = await r.businessGet(kind, id);
  if (!row) fail(404, "不存在");
  return row;
}
function policyDeduct(part, lesson, parts, policies) {
  if (part.attendance === "attended") {
    const original = part.makeup_for ? parts.get(part.makeup_for) : null;
    return original && original.deducted > 0 ? 0 : lesson.units;
  }
  if (part.attendance === "no_show")
    return policies.student_no_show?.deduct === false ? 0 : lesson.units;
  if (part.attendance === "student_leave")
    return policies.student_leave?.deduct ? lesson.units : 0;
  return 0;
}
export function reconcileStatus(parts) {
  const statuses = parts.map((p) => p.attendance);
  return statuses.includes("attended")
    ? "completed"
    : statuses.includes("planned")
      ? "planned"
      : statuses.every((x) => x === "teacher_leave")
        ? "teacher_leave"
        : statuses.every((x) => x === "cancelled")
          ? "cancelled"
          : statuses.includes("no_show")
            ? "student_no_show"
            : statuses.includes("student_leave")
              ? "student_leave"
              : statuses.includes("teacher_leave")
                ? "teacher_leave"
                : "planned";
}
function eligiblePackages(packages, student, lesson) {
  return packages.filter((p) => p.student_id === student &&
    validForLesson(p, lesson.start_at.slice(0, 10)) && matchesDebtScope(p, lesson));
}
const inactiveMakeupAttendance = new Set(["student_leave", "no_show", "teacher_leave", "cancelled"]);
const inactiveMakeupLessons = new Set(["cancelled", "rescheduled", "teacher_leave"]);
const activeMakeup = (part, lesson) => part && lesson && !part.deleted_at && !lesson.deleted_at &&
  !inactiveMakeupAttendance.has(part.attendance) && !inactiveMakeupLessons.has(lesson.status);
function alreadyHasMakeup() {
  fail(409, "这次请假已有有效补课，原补课取消或缺席后才可重新安排", "MAKEUP_ALREADY_ACTIVE");
}
function assertMakeupTransitions(ctx, state) {
  const active = Object.groupBy(ctx.links.filter((link) =>
    activeMakeup(state.participants.get(link.target_participant_id), state.lessons.get(link.target_lesson_id)),
  ), (link) => link.original_participant_id);
  for (const group of Object.values(active)) {
    if (group.length < 2) continue;
    for (const link of group) {
      const part = ctx.participants.find((p) => p.id === link.target_participant_id);
      const lesson = ctx.lessons.find((l) => l.id === link.target_lesson_id);
      if (!activeMakeup(part, lesson)) alreadyHasMakeup();
    }
  }
}
function contextState(ctx, policies, maxDebt = maxDebtUnits()) {
  const participants = new Map(ctx.participants.map((p) => [p.id, { ...p }])),
    lessons = new Map(ctx.lessons.map((l) => [l.id, { ...l }])),
    balances = new Map(
      ctx.balances.map((x) => [x.package_id, Number(x.balance)]),
    ),
    net = new Map();
  for (const n of ctx.nets)
    net.set(n.participant_id + ":" + n.package_id, Number(n.net));
  const changes = new Map(),
    debts = new Map((ctx.debts || []).map((d) => [d.participant_id, { ...d }])),
    blocked = [],
    txns = [];
  const profile = (part) => ctx.students.find((s) => s.id === part.student_id);
  const packagesFor = (part) => eligiblePackages(ctx.packages, part.student_id, lessons.get(part.lesson_id));
  function canAllocate(part, restoring) {
    if (profile(part)?.billing_mode === "overall") return true;
    const want = policyDeduct(part, lessons.get(part.lesson_id), participants, policies);
    if (want <= 0) return true;
    const available = packagesFor(part).reduce((sum, pack) => sum + Math.max(0,
      (balances.get(pack.id) || 0) - (restoring ? net.get(part.id + ":" + pack.id) || 0 : 0),
    ), 0);
    const shortfall = round(want - available);
    if (shortfall <= 0) return true;
    const owed = [...debts.values()].reduce((sum, debt) =>
      debt.student_id === part.student_id && debt.participant_id !== part.id
        ? sum + debt.remaining_units : sum, 0);
    if (round(owed + shortfall) <= maxDebt) return true;
    const student_name = profile(part)?.name || "该学员";
    blocked.push({ participant_id: part.id, student_id: part.student_id, student_name,
      reason: student_name + "的欠课时将超过上限，请补充课时包后再销课" });
    return false;
  }
  function change(resource, row, previous) {
    changes.set(resource + ":" + row.id, { resource, data: row, previous });
  }
  function txn(
    pack,
    delta,
    type,
    part = null,
    referenceId = null,
    note = "",
    date = today(),
  ) {
    txns.push({
      resource: "package_transactions",
      data: {
        id: randomId("txn"),
        package_id: pack.id,
        student_id: pack.student_id,
        delta: round(delta),
        type,
        date,
        participant_id: part?.id || null,
        reference_id: referenceId,
        note,
        deleted_at: null,
      },
    });
    balances.set(pack.id, round((balances.get(pack.id) || 0) + delta));
    if (part)
      net.set(
        part.id + ":" + pack.id,
        round((net.get(part.id + ":" + pack.id) || 0) + delta),
      );
  }
  function reverse(part) {
    const debt = debts.get(part.id);
    if (debt) {
      debts.delete(part.id);
      change("credit_debts", { ...debt, deleted_at: now() }, debt);
    }
    for (const pack of ctx.packages) {
      const amount = net.get(part.id + ":" + pack.id) || 0;
      if (Math.abs(amount) > EPS)
        txn(pack, -amount, "reversal", part, null, "销课调整 / 撤销回补");
    }
    part.deducted = 0;
  }
  function allocate(part) {
    const lesson = lessons.get(part.lesson_id),
      want = policyDeduct(part, lesson, participants, policies);
    if (want <= 0) {
      part.deducted = 0;
      return;
    }
    if (
      ctx.students.find((s) => s.id === part.student_id)?.billing_mode ===
      "overall"
    ) {
      part.deducted = want;
      return;
    }
    const candidates = packagesFor(part);
    let left = want;
    for (const pack of candidates) {
      const use = Math.min(Math.max(0, balances.get(pack.id) || 0), left);
      if (use > 0) {
        txn(pack, -use, "consume", part);
        left = round(left - use);
      }
      if (left < EPS) break;
    }
    if (left > EPS) {
      const debt = {
        id: randomId("debt"),
        student_id: part.student_id,
        lesson_id: part.lesson_id,
        participant_id: part.id,
        course_type_id: lesson.course_type_id,
        category_id: lesson.category_id,
        units: left,
        remaining_units: left,
        settled_at: null,
        deleted_at: null,
      };
      debts.set(part.id, debt);
      change("credit_debts", debt);
    }
    part.deducted = want;
  }
  function refresh(ids) {
    const touched = new Set();
    for (const id of ids) {
      const part = participants.get(id);
      const previous = ctx.participants.find((x) => x.id === id);
      if (!canAllocate(part, true)) {
        participants.set(id, { ...previous });
        continue;
      }
      touched.add(id);
      reverse(part);
      allocate(part);
      change(
        "lesson_participants",
        part,
        ctx.participants.find((x) => x.id === id),
      );
    }
    // 原课扣课改变时，已出勤补课按旧版 refreshLinkedMakeups 重新分配。
    for (const part of participants.values())
      if (
        part.makeup_for &&
        touched.has(part.makeup_for) &&
        part.attendance === "attended" &&
        !touched.has(part.id)
      ) {
        if (!canAllocate(part, true)) {
          // A linked makeup was already posted. Leave the whole correction
          // intact until its existing debit can be reallocated.
          fail(409, blocked.at(-1).reason);
        }
        reverse(part);
        allocate(part);
        change(
          "lesson_participants",
          part,
          ctx.participants.find((x) => x.id === part.id),
        );
        touched.add(part.id);
      }
    const lessonIds = new Set(
      [...touched].map((id) => participants.get(id).lesson_id),
    );
    for (const id of lessonIds) {
      const lesson = lessons.get(id),
        original = ctx.lessons.find((x) => x.id === id);
      const roster = [...participants.values()].filter((p) => p.lesson_id === id);
      const confirmed = roster.filter((p) => p.attendance !== "planned");
      const hasBlock = blocked.some((item) => participants.get(item.participant_id)?.lesson_id === id);
      lesson.status = reconcileStatus(hasBlock && confirmed.length ? confirmed : roster);
      lesson.teacher_paid =
        lesson.status === "completed" || policies[lesson.status]?.teacherPaid
          ? 1
          : 0;
      change("lessons", lesson, original);
    }
  }
  return {
    participants,
    lessons,
    balances,
    blocked,
    canAllocate,
    changes,
    txns,
    txn,
    reverse,
    allocate,
    refresh,
    change,
  };
}
async function getRead(env, tenant, user, policy, kind, id, url) {
  const module =
    kind === "payments"
      ? "tuition"
      : kind === "stages"
        ? "students"
        : kind === "makeups"
          ? "attendance"
          : "packages";
  requireCan(user, policy, module, "read", scope(user));
  const student = actorStudent(user, url.searchParams.get("student_id"));
  const r = repo(env, tenant.id);
  if (student && !user.roles.includes("student"))
    await owned(r, "students", student);
  let rows = await r.creditRead(
    kind,
    student,
    id || null,
    integer(Number(url.searchParams.get("offset") || 0), "分页", 0, 1000000),
  );
  rows = rows
    .map((row) =>
      clean(user, policy, module, { ...row, student_id: row.student_id }),
    )
    .filter(Boolean);
  let debtFields;
  if (kind === "packages" && (student || id && rows.length)) {
    const { debt_units, available_units } = await r.creditDebtTotal(student || rows[0].student_id);
    debtFields = { debt_units, available_units };
  }
  for (const row of rows) {
    if (kind === "packages")
      row.display_status = packageStatus(row, policy.settings);
    if (kind === "stages") row.display_status = stageStatus(row);
  }
  if (id) {
    if (!rows.length) fail(404, "不存在");
    return { record: rows[0], ...debtFields };
  }
  if (rows.length && ["payments", "transactions"].includes(kind)) {
    const ids = [...new Set(rows.map((row) => row.student_id))];
    const names = new Map(
      (await r.creditStudentNames(ids)).map(({ id, name }) => [id, name]),
    );
    for (const row of rows)
      row.student_name = names.get(row.student_id) ?? null;
  }
  return {
    items: rows,
    ...debtFields,
    next_offset:
      rows.length === 200
        ? Number(url.searchParams.get("offset") || 0) + 200
        : null,
  };
}
async function execute(req, env, tenant, user, policy, path, url, readBody) {
  const resource =
    req.method !== "GET" && path.startsWith("/api/credits/makeups")
      ? null
      : /^\/api\/(?:credits|data)\/(packages|transactions|payments|stages|makeups)(?:\/([^/]+))?$/.exec(
          path,
        );
  const lessonMatch =
    /^\/api\/credits\/lessons\/([^/]+)\/(attendance|status|undo|delete)$/.exec(
      path,
    );
  const legacyDelete = /^\/api\/data\/lessons\/([^/]+)$/.exec(path);
  let kind = resource?.[1],
    id = resource?.[2],
    action = lessonMatch?.[2];
  if (legacyDelete && req.method === "DELETE") {
    id = legacyDelete[1];
    action = "delete";
  } else if (lessonMatch) id = lessonMatch[1];
  const unlink = /^\/api\/credits\/makeups\/([^/]+)\/unlink$/.exec(path);
  const transfer = path === "/api/credits/transfer",
    adjust = path === "/api/credits/adjust",
    makeup = path === "/api/credits/makeups",
    r = repo(env, tenant.id);
  const funds = fundsRoute(path);
  if (funds && req.method === "GET") return moneyOut(await readFunds(r, user, policy, funds, url));
  if (funds && ["balance_adjust", "redeem", "reverse"].includes(funds.kind))
    requireCan(user, policy, "tuition", "read");
  if (funds && (req.method !== "POST" || !["balance_adjust", "redeem", "resolve", "reverse"].includes(funds.kind)))
    fail(404, "不存在");
  if (transfer && req.method === "GET") {
    requireCan(user, policy, "packages", "transfer");
    const from = await owned(
        r,
        "packages",
        url.searchParams.get("from_package_id"),
      ),
      to = await owned(r, "packages", url.searchParams.get("to_package_id"));
    if (
      from.student_id !== to.student_id ||
      from.id === to.id ||
      from.course_type_id === to.course_type_id
    )
      fail(400, "须为同一学员不同课程课时包");
    const ratio =
      from.unit_price > 0 && to.unit_price > 0
        ? from.unit_price / to.unit_price
        : null;
    return { reference_ratio: ratio };
  }
  if (resource && req.method === "GET")
    return getRead(env, tenant, user, policy, kind, id, url);
  const module =
    funds ? "tuition" :
    action || makeup || unlink
      ? "attendance"
      : kind === "payments"
        ? "tuition"
        : kind === "stages"
          ? "students"
          : kind === "makeups"
            ? "attendance"
            : "packages";
  const deleteResource = req.method === "DELETE" && resource &&
    ["packages", "stages"].includes(kind) && id;
  const verb = deleteResource ? "delete" : req.method === "PATCH" ? "update" : "create";
  requireCan(
    user,
    policy,
    module,
    funds
      ? funds.kind === "redeem" ? "create" : "update"
      : adjust
      ? "adjust"
      : funds ? funds.kind
      : transfer
        ? "transfer"
        : action || unlink
          ? "update"
          : verb,
  );
  if (action === "delete") {
    requireCan(user, policy, "lessons", "delete");
    requireCan(user, policy, "attendance", "delete");
  }
  if (
    !["POST", "PATCH", "DELETE"].includes(req.method) ||
    (resource && ["transactions", "makeups"].includes(kind)) ||
    (!funds && !resource && !action && !makeup && !unlink && !transfer && !adjust)
  )
    fail(404, "不存在");
  const d = await readBody(req);
  let operationId = d.operation_id;
  if (
    !operationId &&
    ((path.startsWith("/api/data/packages") &&
      (d.units_total === 0 || d.units_total === undefined)) ||
      legacyDelete)
  )
    operationId = legacyDelete
      ? "delete_" + id + "_" + d.version
      : randomId("op");
  if (
    typeof operationId !== "string" ||
    !/^[A-Za-z0-9_-]{8,100}$/.test(operationId)
  )
    fail(400, "缺少有效操作编号");
  const hash = await sha(
    JSON.stringify({ user: user.id, path, method: req.method, body: d }),
  );
  const completed = await r.creditOperation(operationId);
  if (completed) {
    if (completed.actor_id !== user.id || completed.request_hash !== hash)
      fail(409, "操作编号已用于其他请求");
    return JSON.parse(completed.response_json);
  }
  const revision = await r.dataVersion(),
    changes = [];
  let result;
  if (funds || (kind === "payments" && !id && req.method === "POST" && d.kind !== undefined)) {
    result = await changeFunds(r, user, policy, funds || { kind: "payment" }, d, changes, operationId);
  } else if (deleteResource) {
    const table = kind === "stages" ? "student_stages" : "packages";
    const previous = await owned(r, table, id);
    if (version(d.version) !== previous.version) fail(409, "记录已修改，请刷新");
    if (kind === "stages") {
      const refs = await r.stageReferences(id);
      const used = [refs.packages && "课时包", refs.payments && "缴费分类"].filter(Boolean);
      if (used.length)
        fail(409, "这个学习阶段已被" + used.join("、") + "引用，请先解除关联或把阶段改为已完成", "STAGE_IN_USE");
    }
    if (kind === "packages" && await r.packageInUse(id))
      fail(409, "有课时流水、销课或缴费记录关联，不能删除课时包");
    changes.push({ resource: table, previous, data: { ...previous, deleted_at: now() } });
    result = { id, committed: true };
  } else if (resource) {
    if (
      !["POST", "PATCH"].includes(req.method) ||
      (req.method === "POST" && id) ||
      (req.method === "PATCH" && !id)
    )
      fail(404, "不存在");
    const table = {
      packages: "packages",
      payments: "student_payments",
      stages: "student_stages",
    }[kind];
    const old = id ? await owned(r, table, id) : null;
    if (old && version(d.version) !== old.version)
      fail(409, "记录已修改，请刷新");
    const studentId = old?.student_id || d.student_id;
    await r.primeReferences({
      studentIds: [studentId],
      typeIds: [d.course_type_id || old?.course_type_id],
    });
    const student = await owned(r, "students", studentId);
    const row = old
      ? { ...old }
      : {
          id: randomId(
            kind === "packages" ? "pkg" : kind === "payments" ? "pay" : "stage",
          ),
          student_id: student.id,
          deleted_at: null,
        };
    if (kind === "packages") {
      const type = await owned(
        r,
        "course_types",
        old?.course_type_id || d.course_type_id,
      );
      if (
        old &&
        ((d.student_id && d.student_id !== old.student_id) ||
          (d.course_type_id && d.course_type_id !== old.course_type_id))
      )
        fail(400, "课时包归属和适用课程不能更换");
      row.course_type_id = type.id;
      row.units_total = quantity(d.units_total ?? old?.units_total ?? 0, true);
      row.valid_from =
        d.valid_from === null
          ? null
          : d.valid_from
            ? day(d.valid_from)
            : old?.valid_from || null;
      row.valid_to =
        d.valid_to === null
          ? null
          : d.valid_to
            ? day(d.valid_to)
            : old?.valid_to || null;
      if (row.valid_from && row.valid_to && row.valid_from > row.valid_to)
        fail(400, "有效期不正确");
      row.purchase_date = old?.purchase_date || day(d.purchase_date || today());
      row.status = d.status ?? old?.status ?? "active";
      if (!["active", "paused"].includes(row.status))
        fail(400, "课时包状态不正确");
      row.scope_kind = old?.scope_kind || d.scope_kind || "type";
      if (!["type", "category"].includes(row.scope_kind))
        fail(400, "适用范围不正确");
      row.category_id = row.scope_kind === "category" ? type.category_id : null;
      row.stage_id = d.stage_id !== undefined ? d.stage_id : old?.stage_id ?? null;
      if (row.stage_id) {
        const stage = await owned(r, "student_stages", row.stage_id);
        if (stage.student_id !== student.id) fail(404, "不存在");
      }
      row.unit_price = old?.unit_price ?? null;
      row.amount = old?.amount ?? null;
      if (can(user, policy, "tuition", old ? "update" : "create")) {
        if (d.unit_price !== undefined) row.unit_price = money(d.unit_price);
        if (d.amount !== undefined) row.amount = money(d.amount);
        else if (row.amount === null && row.unit_price !== null && (!old || d.unit_price !== undefined)) {
          row.amount = multiplyCents(row.unit_price, row.units_total);
          if (row.amount > 10000000000) fail(400, "课时包金额超出上限");
        }
      }
      let ctxForPackage, balanceBefore = 0;
      const delta = round(row.units_total - (old?.units_total || 0));
      if (delta) {
        ctxForPackage = await r.creditContext(null, [student.id], [row.id]);
        balanceBefore =
          ctxForPackage.balances.find((x) => x.package_id === row.id)?.balance || 0;
        if (balanceBefore + delta < -EPS) fail(409, "调整后课时余额不能为负");
        await r.assertUnlocked([groupMonth(today())]);
        changes.push({
          resource: "package_transactions",
          data: {
            id: randomId("txn"),
            package_id: row.id,
            student_id: student.id,
            delta,
            type: old ? "adjustment" : "purchase",
            date: today(),
            participant_id: null,
            reference_id: operationId,
            note: old ? "购买课时修订" : "购买课时",
            deleted_at: null,
          },
        });
      }
      changes.unshift({ resource: table, previous: old, data: row });
      if (delta > 0) repayDebts(ctxForPackage, changes, row, balanceBefore + delta, today(), operationId);
      result = { id: row.id, committed: true };
    } else if (kind === "payments") {
      if (old) fail(404, "不存在");
      row.package_id = d.package_id || null;
      const pack = row.package_id ? await r.legacyPaymentPackage(row.package_id) : null;
      if (row.package_id && (!pack || pack.student_id !== student.id)) fail(404, "不存在");
      row.amount = money(d.amount);
      if (!(row.amount > 0)) fail(400, "缴费金额须大于零");
      row.paid_at = day(d.paid_at || today());
      await r.assertUnlocked([groupMonth(row.paid_at)]);
      row.method = string(d.method || "", "收款方式", 50, 0);
      row.note = string(d.note || "", "备注", 1000, 0);
      result = allocateLegacyPayment(changes, row, pack);
    } else {
      row.name = string(d.name ?? old?.name, "阶段名称", 100);
      row.date_from = d.date_from ? day(d.date_from) : old?.date_from || null;
      row.date_to = d.date_to ? day(d.date_to) : old?.date_to || null;
      if (row.date_from && row.date_to && row.date_from > row.date_to)
        fail(400, "阶段日期不正确");
      row.goal = string(d.goal ?? old?.goal ?? "", "目标", 1000, 0);
      row.status = d.status ?? old?.status ?? "active";
      if (!["active", "completed", "paused"].includes(row.status))
        fail(400, "阶段状态不正确");
      changes.push({ resource: table, previous: old, data: row });
      result = { id: row.id, committed: true };
    }
  } else if (transfer || adjust) {
    const pack = await owned(
        r,
        "packages",
        transfer ? d.from_package_id : d.package_id,
      ),
      target = transfer ? await owned(r, "packages", d.to_package_id) : null;
    if (
      target &&
      (pack.id === target.id ||
        pack.student_id !== target.student_id ||
        pack.course_type_id === target.course_type_id)
    )
      fail(400, "课时转换须为同一学员的不同课程课时包");
    const ctx = await r.creditContext(
        null,
        [pack.student_id],
        [pack.id, target?.id].filter(Boolean),
      ),
      state = contextState(ctx, effectivePolicies(policy.settings), maxDebtUnits(policy.settings)),
      reason = string(d.reason || "", "调整原因", 1000, adjust ? 1 : 0),
      date = today();
    await r.assertUnlocked([groupMonth(date)]);
    let reference = {};
    if (transfer && pack.unit_price > 0 && target.unit_price > 0) {
      const ratio = pack.unit_price / target.unit_price;
      reference = { reference_ratio: ratio };
      if (
        Math.abs(d.to_units / d.from_units / ratio - 1) > 0.2 + 1e-9 &&
        !reason.trim()
      )
        fail(400, "偏离参考比例超过20%，请填写原因");
    }
    if (transfer) {
      const from = quantity(d.from_units),
        to = quantity(d.to_units);
      if ((state.balances.get(pack.id) || 0) + EPS < from)
        fail(409, "来源课时余额不足");
      state.txn(pack, -from, "transfer_out", null, operationId, reason);
      state.txn(target, to, "transfer_in", null, operationId, reason);
    } else {
      if (
        typeof d.delta !== "number" ||
        !Number.isFinite(d.delta) ||
        !d.delta ||
        Math.abs(d.delta) > 1000000
      )
        fail(400, "调整课时格式不正确");
      quantityIn(d.delta, { signed: true });
      if ((state.balances.get(pack.id) || 0) + d.delta < -EPS)
        fail(409, "调整后余额不能为负");
      state.txn(pack, d.delta, "adjustment", null, operationId, reason);
    }
    changes.push(...state.txns);
    result = { committed: true, ...reference };
  } else if (action) {
    const lesson = await owned(r, "lessons", id);
    if (lesson.source_course_id) fail(403, "合作课不参与机构销课");
    if (version(d.lesson_version ?? d.version) !== lesson.version)
      fail(409, "课程已修改，请刷新");
    const ctx = await r.creditContext(id),
      policies = effectivePolicies(policy.settings),
      state = contextState(ctx, policies, maxDebtUnits(policy.settings)),
      targetParts = [...state.participants.values()].filter(
        (x) => x.lesson_id === id,
      );
    if (!targetParts.length) fail(409, "课程没有学员");
    await r.primeReferences({
      typeIds: ctx.lessons.map((x) => x.course_type_id),
    });
    for (const l of state.lessons.values())
      l.category_id = (
        await r.businessGet("course_types", l.course_type_id)
      )?.category_id;
    await r.assertUnlocked(attendanceLockMonths(ctx));
    if (action === "delete") {
      if (ctx.links.length || ctx.participants.some((x) => x.makeup_for))
        fail(409, "仍有补课关联，不能删除");
      for (const part of targetParts) {
        state.reverse(part);
        state.change(
          "lesson_participants",
          { ...part, deleted_at: now() },
          ctx.participants.find((x) => x.id === part.id),
        );
      }
      state.change("lessons", { ...lesson, deleted_at: now() }, lesson);
    } else {
      let changed = [];
      if (action === "attendance") {
        if (
          !Array.isArray(d.participants) ||
          !d.participants.length ||
          d.participants.length > 200 ||
          new Set(d.participants.map((x) => x?.id)).size !==
            d.participants.length
        )
          fail(400, "出勤列表不正确");
        for (const input of d.participants) {
          const p = targetParts.find((x) => x.id === input?.id);
          if (!p) fail(404, "不存在");
          if (version(input.version) !== p.version)
            fail(409, "出勤记录已修改，请刷新");
          if (
            ![
              "planned",
              "attended",
              "student_leave",
              "no_show",
              "teacher_leave",
              "cancelled",
            ].includes(input.attendance)
          )
            fail(400, "出勤状态不正确");
          if (input.attendance !== p.attendance) {
            p.attendance = input.attendance;
            changed.push(p.id);
          }
        }
      } else {
        const status = action === "undo" ? "planned" : d.status;
        if (
          ![
            "planned",
            "completed",
            "teacher_leave",
            "cancelled",
            "rescheduled",
            "student_leave",
            "student_no_show",
          ].includes(status)
        )
          fail(400, "课程状态不正确");
        for (const p of targetParts) {
          if (status === "completed" && p.attendance !== "planned") continue;
          p.attendance =
            {
              completed: "attended",
              teacher_leave: "teacher_leave",
              cancelled: "cancelled",
              student_leave: "student_leave",
              student_no_show: "no_show",
            }[status] || "planned";
          changed.push(p.id);
        }
      }
      state.refresh(changed);
      if (action === "status" && d.status === "rescheduled") {
        const row = state.lessons.get(id);
        row.status = "rescheduled";
        row.teacher_paid = policies.rescheduled?.teacherPaid ? 1 : 0;
        state.change("lessons", row, lesson);
      }
    }
    assertMakeupTransitions(ctx, state);
    changes.push(...state.changes.values(), ...state.txns);
    result = { id, committed: changes.length > 0, blocked: state.blocked };
  } else if (unlink) {
    const link = await owned(r, "makeup_links", unlink[1]);
    if (version(d.version) !== link.version) fail(409, "补课关联已修改");
    const target = await owned(
        r,
        "lesson_participants",
        link.target_participant_id,
      ),
      ctx = await r.creditContext(target.lesson_id),
      state = contextState(ctx, effectivePolicies(policy.settings), maxDebtUnits(policy.settings));
    await r.primeReferences({
      typeIds: ctx.lessons.map((x) => x.course_type_id),
    });
    for (const l of state.lessons.values())
      l.category_id = (
        await owned(r, "course_types", l.course_type_id)
      ).category_id;
    await r.assertUnlocked([
      ...ctx.lessons.map((x) => groupMonth(x.start_at)),
      groupMonth(today()),
    ]);
    state.participants.get(target.id).makeup_for = null;
    state.refresh([target.id]);
    if (state.blocked.length)
      fail(409, "解除补课关联后无法扣课：" + state.blocked[0].reason, "MAKEUP_UNLINK_BLOCKED");
    changes.push(...state.changes.values(), ...state.txns, {
      resource: "makeup_links",
      previous: link,
      data: { ...link, deleted_at: now() },
    });
    result = { committed: true };
  } else if (makeup) {
    const original = await owned(
      r,
      "lesson_participants",
      d.original_participant_id,
    );
    if (original.makeup_for) fail(400, "不能把补课再次作为原课");
    const originalLesson = await owned(r, "lessons", original.lesson_id);
    let targetLesson;
    if (d.new_lesson) {
      requireCan(user, policy, "lessons", "create");
      const prepared = await prepareMakeupLesson(env, tenant, r, user, policy, {
        ...d.new_lesson,
        course_type_id: originalLesson.course_type_id,
        student_ids: [original.student_id],
      });
      if (prepared.conflicts?.length)
        return { committed: false, conflicts: prepared.conflicts };
      targetLesson = prepared.row;
      changes.push({ resource: "lessons", data: targetLesson });
    } else {
      targetLesson = await owned(r, "lessons", d.target_lesson_id);
      changes.push({
        resource: "lessons",
        previous: targetLesson,
        data: { ...targetLesson },
      });
    }
    if (
      targetLesson.id === original.lesson_id ||
      targetLesson.course_type_id !== originalLesson.course_type_id ||
      ["cancelled", "rescheduled", "teacher_leave"].includes(
        targetLesson.status,
      )
    )
      fail(400, "补课课程不适用");
    const targetParts = d.new_lesson
      ? []
      : await r.participantsFor(targetLesson.id);
    if (targetParts.some((x) => x.student_id === original.student_id))
      fail(409, "该学员已在目标课程");
    await r.primeReferences({
      studentIds: [original.student_id],
      typeIds: [targetLesson.course_type_id],
      locationIds: [targetLesson.location_id],
    });
    const type = await owned(r, "course_types", targetLesson.course_type_id);
    if (
      (type.format === "individual" && targetParts.length) ||
      targetParts.length + 1 > type.capacity
    )
      fail(400, "超过课程容量");
    if (
      targetLesson.location_id &&
      targetParts.length + 1 >
        (await owned(r, "locations", targetLesson.location_id)).capacity
    )
      fail(400, "超过教室容量");
    if (!d.new_lesson) {
      const date = targetLesson.start_at.slice(0, 10),
        end = new Date(date + "T00:00:00Z");
      end.setUTCDate(end.getUTCDate() + 1);
      const snapshot = await r.scheduleWindow(
          date,
          end.toISOString().slice(0, 10),
        ),
        found = await conflicts(
          r,
          targetLesson,
          [original.student_id],
          snapshot,
        );
      if (found.length && d.force !== true)
        return { committed: false, conflicts: found };
    }
    const ctx = await r.creditContext(original.lesson_id, [
      original.student_id,
    ]);
    if (ctx.links.some((link) => link.original_participant_id === original.id &&
      activeMakeup(ctx.participants.find((p) => p.id === link.target_participant_id),
        ctx.lessons.find((l) => l.id === link.target_lesson_id))
    )) alreadyHasMakeup();
    await r.primeReferences({
      typeIds: ctx.lessons.map((x) => x.course_type_id),
    });
    if (!ctx.lessons.some((x) => x.id === targetLesson.id))
      ctx.lessons.push(targetLesson);
    const part = {
      id: randomId("part"),
      lesson_id: targetLesson.id,
      student_id: original.student_id,
      attendance: targetLesson.status === "completed" ? "attended" : "planned",
      deducted: 0,
      package_id: null,
      makeup_for: original.id,
      deleted_at: null,
    };
    ctx.participants.push(part);
    const state = contextState(ctx, effectivePolicies(policy.settings), maxDebtUnits(policy.settings));
    for (const l of state.lessons.values())
      l.category_id = (
        await owned(r, "course_types", l.course_type_id)
      ).category_id;
    await r.assertUnlocked([
      groupMonth(originalLesson.start_at),
      groupMonth(targetLesson.start_at),
      groupMonth(today()),
    ]);
    if (part.attendance === "attended") {
      const draft = state.participants.get(part.id);
      if (!state.canAllocate(draft, false)) fail(409, state.blocked[0].reason);
      state.allocate(draft);
    }
    changes.push(
      {
        resource: "lesson_participants",
        data: state.participants.get(part.id),
      },
      {
        resource: "makeup_links",
        data: {
          id: randomId("makeup"),
          original_participant_id: original.id,
          target_participant_id: part.id,
          target_lesson_id: targetLesson.id,
          note: string(d.note || "", "备注", 1000, 0),
          deleted_at: null,
        },
      },
      ...state.changes.values(),
      ...state.txns,
    );
    result = { id: part.id, lesson_id: targetLesson.id, committed: true };
  }
  if (!result) fail(404, "不存在");
  changes.push({
    resource: "credit_operations",
    data: {
      id: operationId,
      actor_id: user.id,
      request_hash: hash,
      response_json: JSON.stringify(result),
      deleted_at: null,
    },
  });
  await r.commitBusiness(
    revision,
    changes,
    user,
    module,
    d.force === true || d.new_lesson?.force === true
      ? "force_makeup"
      : transfer
        ? "transfer"
        : adjust
          ? "adjust"
          : deleteResource ? "delete" : action || kind || "credit_change",
  );
  return result;
}
export async function creditApi(
  req,
  env,
  tenant,
  user,
  policy,
  path,
  url,
  bodyReader,
) {
  let saved;
  const read = async (request) => {
    if (saved === undefined) saved = await bodyReader(request);
    return saved;
  };
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await execute(
        req,
        env,
        tenant,
        user,
        policy,
        path,
        url,
        read,
      );
      return req.method === "GET" ? result : moneyOut(result);
    } catch (e) {
      if (String(e.message).includes("stage_has_packages"))
        fail(409, "这个学习阶段已被课时包引用，请先解除关联或把阶段改为已完成", "STAGE_IN_USE");
      if (String(e.message).includes("stage_has_payment_resolution"))
        fail(409, "这个学习阶段已被缴费分类引用，请先解除关联或把阶段改为已完成", "STAGE_IN_USE");
      if (String(e.message).includes("credit_price_locked"))
        fail(409, "补录单价会在本月确认收入，本月已锁定，请先解锁", "PRICE_COMPLETION_LOCKED");
      if (e.code !== "SCHEDULE_RETRY" || attempt >= 1) throw e;
    }
  }
}

// 复用第三阶段扣课、补课联动和计酬算法；由审查服务将这些变更与审核状态一起提交。
export function reviewedAttendanceChanges(ctx, lessonId, people, policies, maxDebt) {
  const state = contextState(ctx, policies, maxDebt),
    ids = [];
  for (const person of people) {
    const part = state.participants.get(person.participant_id);
    if (
      !part ||
      part.lesson_id !== lessonId ||
      part.student_id !== person.student_id
    )
      fail(404, "不存在");
    part.attendance = person.attendance;
    ids.push(part.id);
  }
  state.refresh(ids);
  assertMakeupTransitions(ctx, state);
  return { changes: [...state.changes.values(), ...state.txns], blocked: state.blocked };
}

export function attendanceLockMonths(ctx) {
  return [
    ...new Set([
      ...ctx.lessons.map((l) => groupMonth(l.start_at)),
      groupMonth(today()),
    ]),
  ];
}

// Read-only rehearsal uses exactly the same allocation state as the committing endpoint.
export async function creditPreview(r, lesson, input, policies, maxDebt) {
  if (input !== undefined && (!Array.isArray(input) || input.length > 200))
    fail(400, "出勤列表不正确");
  const ctx = await r.creditContext(lesson.id);
  await r.primeReferences({
    typeIds: ctx.lessons.map((x) => x.course_type_id),
  });
  for (const l of ctx.lessons)
    l.category_id = (
      await r.businessGet("course_types", l.course_type_id)
    )?.category_id;
  const direct = ctx.participants.filter((p) => p.lesson_id === lesson.id),
    draft = new Map((input || []).map((p) => [p.id, p.attendance]));
  if (
    input &&
    (input.length !== direct.length ||
      draft.size !== direct.length ||
      input.some((p) => !direct.some((x) => x.id === p.id)))
  )
    fail(404, "不存在");
  for (const p of direct)
    if (
      draft.has(p.id) &&
      ![
        "planned",
        "attended",
        "student_leave",
        "no_show",
        "teacher_leave",
        "cancelled",
      ].includes(draft.get(p.id))
    )
      fail(400, "出勤状态不正确");
  const restored = contextState(ctx, policies);
  for (const p of direct) restored.reverse(restored.participants.get(p.id));
  const items = direct.map((original) => {
    const p = restored.participants.get(original.id);
    p.attendance =
      draft.get(p.id) ||
      (lesson.status === "planned" ? "attended" : original.attendance);
    const packs = eligiblePackages(ctx.packages, p.student_id, lesson);
    const unlimited =
      ctx.students.find((s) => s.id === p.student_id)?.billing_mode ===
      "overall";
    const required = policyDeduct(
      p,
      restored.lessons.get(lesson.id),
      restored.participants,
      policies,
    );
    return {
      id: p.id,
      student_id: p.student_id,
      student_name: ctx.students.find((s) => s.id === p.student_id)?.name,
      available_units:
        Math.round(
          packs.reduce(
            (n, x) => n + Math.max(0, restored.balances.get(x.id) || 0),
            0,
          ) * 100,
        ) / 100,
      required_units: required,
      unlimited,
      valid_to:
        packs
          .map((x) => x.valid_to)
          .filter(Boolean)
          .sort()[0] || null,
      restore_units: original.deducted,
    };
  });
  const trial = contextState(ctx, policies, maxDebt);
  for (const p of direct)
    trial.participants.get(p.id).attendance =
      draft.get(p.id) ||
      (lesson.status === "planned" ? "attended" : p.attendance);
  let warning = null;
  try {
    trial.refresh(direct.map((x) => x.id));
    assertMakeupTransitions(ctx, trial);
  } catch (e) {
    if (e.status !== 409) throw e;
    warning = e.message;
  }
  return { items, valid: !warning && trial.blocked.length < direct.length, warning: warning || trial.blocked[0]?.reason || null, blocked: trial.blocked };
}
