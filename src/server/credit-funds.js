import { fail, integer, now, randomId, string, version } from "./core.js";
import { can } from "./permissions.js";
import { requireCan } from "./accounts.js";
import { moneyIn, multiplyCents, quantityIn } from "./numbers.js";
import { day } from "./scheduling.js";
import { repayDebts } from "./debt.js";

const today = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
const month = (date) => date.slice(0, 7);
function positive(value) {
  const amount = moneyIn(value);
  if (amount <= 0) fail(400, "金额须大于零");
  return amount;
}
async function owned(r, table, id, student = null) {
  if (typeof id !== "string" || !id) fail(400, "缺少关联记录");
  const row = await r.businessGet(table, id);
  if (!row || (student && row.student_id !== student)) fail(404, "不存在");
  return row;
}
const add = (changes, resource, data, previous) =>
  changes.push({ resource, data: { deleted_at: null, ...data }, previous });

const remainingDue = (pack, paid) => {
  if (pack.amount === null) fail(409, "请先补填课时包价格");
  return Math.max(0, pack.amount - paid);
};

export function allocateLegacyPayment(changes, payment, pack) {
  const result = { id: payment.id, committed: true };
  const applied = pack ? Math.min(payment.amount, remainingDue(pack, pack.paid_amount)) : payment.amount;
  const deposit = payment.amount - applied;
  if (!deposit) {
    add(changes, "student_payments", payment);
    return result;
  }

  const { id, student_id } = payment;
  add(changes, "student_payments", { ...payment, package_id: null });
  add(changes, "student_payment_resolutions", { id, student_id, kind: "tuition", other_note: "" });
  const allocations = [];
  if (applied) {
    const allocation = { package_id: pack.id, amount: applied };
    allocations.push(allocation);
    add(changes, "student_payment_allocations", {
      id: randomId("alloc"), student_id, payment_id: id, ...allocation,
    });
  }
  add(changes, "student_balances_ledger", {
    id: randomId("bal"), student_id, payment_id: id, type: "deposit",
    amount: deposit, reason: "缴费转预收",
  });
  return { ...result, kind: "tuition", allocations, deposit_amount: deposit, overflow: deposit };
}

export function fundsRoute(path) {
  if (path === "/api/credits/balance") return { kind: "balance" };
  if (path === "/api/credits/balance/redeem") return { kind: "redeem" };
  if (path === "/api/credits/balance/adjust") return { kind: "balance_adjust" };
  if (path === "/api/credits/payments/pending") return { kind: "pending" };
  const match = /^\/api\/credits\/payments\/([^/]+)\/(resolve|reverse)$/.exec(path);
  return match ? { kind: match[2], id: match[1] } : null;
}

export async function readFunds(r, user, policy, route, url) {
  const requested = url.searchParams.get("student_id");
  const student = user.roles.includes("student") ? user.student_id : requested;
  if (requested && student !== requested) fail(404, "不存在");
  requireCan(user, policy, "tuition", "read", { student_id: student });
  const offset = integer(Number(url.searchParams.get("offset") || 0), "分页", 0, 1000000);
  if (route.kind === "pending") {
    if (user.roles.some((role) => role === "teacher" || role === "student"))
      fail(403, "无权查看待核对项目");
    if (student) await owned(r, "students", student);
    const out = await r.paymentPending(student, offset);
    for (const row of [...out.unlinked_payments, ...out.packages_without_price])
      for (const key of ["tenant_id", "created_by", "updated_by"]) delete row[key];
    return out;
  }
  if (route.kind !== "balance") fail(404, "不存在");
  requireCan(user, policy, "packages", "read", { student_id: student });
  await owned(r, "students", student);
  const out = await r.studentBalance(student, offset);
  return { ...out, balance: out.balance / 100, next_offset: out.ledger.length === 200 ? offset + 200 : null };
}

async function allocations(r, user, policy, student, items, total, changes, operationId, source, stageId) {
  if (!Array.isArray(items) || items.length > 20)
    fail(400, "一次可分配至最多 20 个课时包");
  const entries = items.map((item) => {
    if (!item || (!!item.package_id === !!item.new_package))
      fail(400, "每项请选择已有课时包或新建课时包");
    return { ...item, cents: positive(item.amount) };
  });
  if (entries.reduce((sum, item) => sum + item.cents, 0) > total)
    fail(400, "分配金额超过可用金额");
  const packageIds = entries.map((item) => item.package_id).filter(Boolean);
  const newItems = entries.filter((item) => item.new_package);
  if (newItems.length) requireCan(user, policy, "packages", "create");
  const categoryIds = newItems.map((item) => item.new_package.category_id).filter(Boolean);
  const typeIds = newItems.map((item) => item.new_package.course_type_id).filter(Boolean);
  const stageIds = [...new Set(newItems.map((item) => item.new_package.stage_id).concat(stageId).filter(Boolean))];
  if (stageIds.length) {
    const stages = await r.paymentStages(stageIds, student);
    if (stages.length !== stageIds.length) fail(404, "不存在");
  }
  await r.primeReferences({ packageIds, typeIds, categoryIds });
  const categoryTypes = new Map(
    (categoryIds.length ? await r.categoryPackageTypes(categoryIds) : [])
      .map((row) => [row.category_id, row.id]),
  );
  await r.primeReferences({ typeIds: [...categoryTypes.values()] });
  const paid = new Map((packageIds.length ? await r.paymentPackageTotals(packageIds) : []).map((row) => [row.package_id, row.amount]));
  const date = today();
  const debtContext = newItems.length ? await r.creditContext(null, [student]) : null;
  if (newItems.length) await r.assertUnlocked([month(date)]);
  let applied = 0, overflow = 0;
  const result = [];
  for (const item of entries) {
    let pack;
    if (item.package_id) {
      pack = await owned(r, "packages", item.package_id, student);
    } else {
      const input = item.new_package;
      const type = await owned(r, "course_types", input.course_type_id || categoryTypes.get(input.category_id));
      if (input.category_id && input.category_id !== type.category_id) fail(404, "不存在");
      if (!type.active) fail(409, "细分课程未启用");
      const units = quantityIn(input.units_total);
      const price = input.unit_price == null ? null : moneyIn(input.unit_price);
      const amount = input.amount == null ? price === null ? null : multiplyCents(price, units) : moneyIn(input.amount);
      if (amount === null || amount > 10000000000) fail(400, "请填写有效的课时包应收金额");
      pack = {
        id: randomId("pkg"), student_id: student, course_type_id: type.id,
        category_id: input.category_id || null,
        scope_kind: input.category_id ? "category" : "type",
        units_total: units, unit_price: price, amount, status: "active",
        purchase_date: date, valid_from: input.valid_from ? day(input.valid_from) : null,
        valid_to: input.valid_to ? day(input.valid_to) : null,
        stage_id: input.stage_id || stageId || null,
      };
      if (pack.valid_from && pack.valid_to && pack.valid_from > pack.valid_to)
        fail(400, "有效期不正确");
      add(changes, "packages", pack);
      add(changes, "package_transactions", {
        id: randomId("txn"), package_id: pack.id, student_id: student,
        delta: units, type: "purchase", date, reference_id: operationId, note: "购买课时",
      });
      repayDebts(debtContext, changes, pack, units, date, operationId);
    }
    const amount = Math.min(item.cents, remainingDue(pack, paid.get(pack.id) || 0));
    overflow += item.cents - amount;
    if (!amount) continue;
    const ledgerId = source ? null : randomId("bal");
    if (ledgerId)
      add(changes, "student_balances_ledger", {
        id: ledgerId, student_id: student, package_id: pack.id,
        type: "redeem", amount: -amount, reason: "兑换课时包",
      });
    add(changes, "student_payment_allocations", {
      id: randomId("alloc"), student_id: student, package_id: pack.id,
      payment_id: source, ledger_id: ledgerId, amount,
    });
    paid.set(pack.id, (paid.get(pack.id) || 0) + amount);
    applied += amount;
    result.push({ package_id: pack.id, amount });
  }
  return { applied, overflow, result };
}

export async function changeFunds(r, user, policy, route, d, changes, operationId) {
  const old = route.id ? await owned(r, "student_payments", route.id) : null;
  const student = await owned(r, "students", old?.student_id || d.student_id);
  if (route.kind === "reverse") {
    if (version(d.version) !== old.version) fail(409, "记录已修改，请刷新");
    const metadata = await r.businessGet("student_payment_resolutions", old.id);
    if (!metadata) fail(409, "这笔缴费请通过原缴费编辑流程处理");
    const reason = string(d.reason, "冲正原因", 1000);
    await r.assertUnlocked([month(old.paid_at), ...(metadata.recognized_date ? [month(metadata.recognized_date)] : [])]);
    const { allocations, deposit, balance } = await r.paymentReversalFacts(old.id, student.id);
    if (deposit > balance) fail(409, "预收余额不足，不能冲正已兑换或退款的余额");
    for (const row of allocations)
      add(changes, "student_payment_allocations", { ...row, deleted_at: now() }, row);
    if (deposit)
      add(changes, "student_balances_ledger", { id: randomId("bal"), student_id: student.id,
        payment_id: old.id, type: "refund", amount: -deposit, reason });
    add(changes, "student_payments", { ...old, deleted_at: now(), reason }, old);
    return { id: old.id, committed: true, balance_amount: balance - deposit };
  }
  if (route.kind === "balance_adjust" || route.kind === "redeem") {
    const { balance } = await r.studentBalance(student.id);
    if (route.kind === "balance_adjust") {
      const amount = moneyIn(d.amount, { signed: true });
      if (!amount || !["refund", "adjust"].includes(d.type) || (d.type === "refund" && amount >= 0))
        fail(400, "余额调整或退款金额不正确");
      if (balance + amount < 0) fail(409, "预收余额不足");
      const reason = string(d.reason, "原因", 1000);
      add(changes, "student_balances_ledger", { id: randomId("bal"),
        student_id: student.id, type: d.type, amount, reason });
      return { committed: true, balance_amount: balance + amount };
    }
    if (!d.items?.length) fail(400, "请选择要兑换的课时包");
    const { applied, overflow, result } = await allocations(r, user, policy, student.id, d.items, balance, changes, operationId, null, null);
    if (overflow) fail(409, "兑换金额超出课时包应收，请修改后重试");
    return { committed: true, balance_amount: balance - applied, allocations: result };
  }

  const paidDate = old?.paid_at || day(d.paid_at || today());
  const payment = old || {
    id: randomId("pay"), student_id: student.id, package_id: null, amount: positive(d.amount),
    paid_at: paidDate, method: string(d.method || "", "收款方式", 50, 0),
    note: string(d.note || "", "备注", 1000, 0),
  };
  if (old) {
    if (version(d.version) !== old.version) fail(409, "记录已修改，请刷新");
    if (old.package_id || await r.businessGet("student_payment_resolutions", old.id))
      fail(409, "这笔缴费已处理");
    if (!["link", "to_balance", "other_income"].includes(d.action)) fail(400, "处理方式不正确");
    add(changes, "student_payments", old, old);
  } else {
    await r.assertUnlocked([month(paidDate)]);
    add(changes, "student_payments", payment);
  }
  const kind = old ? d.action === "other_income" ? "other_income" : "tuition" : d.kind;
  if (!["tuition", "other_income"].includes(kind)) fail(400, "缴费分类不正确");
  const metadata = { id: payment.id, student_id: student.id, kind, stage_id: d.stage_id || null, other_note: "" };
  if (metadata.stage_id) await owned(r, "student_stages", metadata.stage_id, student.id);
  if (kind === "other_income") {
    if (!["报名费", "教材费", "其他"].includes(d.other_category)) fail(400, "请选择其他收入类别");
    if (d.allocations?.length || d.stage_id) fail(400, "其他收入不能分配到课时包或学习阶段");
    metadata.other_category = d.other_category;
    metadata.other_note = string(d.other_note || "", "类别说明", 100, 0);
    metadata.recognized_date = old && (await r.rateLocks(paidDate, paidDate)).length ? today() : paidDate;
    await r.assertUnlocked([month(metadata.recognized_date)]);
    add(changes, "student_payment_resolutions", metadata);
    return { id: payment.id, committed: true, kind, recognized_date: metadata.recognized_date };
  }
  add(changes, "student_payment_resolutions", metadata);
  if (d.action === "link" && !d.allocations?.length) fail(400, "请选择要分配的课时包");
  if (d.action === "to_balance" && d.allocations?.length) fail(400, "转预收时不能同时分配");
  const { applied, overflow, result } = await allocations(r, user, policy, student.id, d.allocations ?? [], payment.amount, changes, operationId, payment.id, metadata.stage_id);
  const deposit = payment.amount - applied;
  if (deposit)
    add(changes, "student_balances_ledger", {
      id: randomId("bal"), student_id: student.id, payment_id: payment.id,
      type: "deposit", amount: deposit, reason: "缴费转预收",
    });
  return { id: payment.id, kind, committed: true, allocations: result, deposit_amount: deposit, overflow };
}
