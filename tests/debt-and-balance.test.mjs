import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./support.mjs";
import { accountToken, balance, details, lesson, mutate, pack, request, setup, status } from "./fixtures-credit.mjs";
import { teacherToken } from "./fixtures-mobile.mjs";
import { randomId } from "../src/server/core.js";

function ok(response, code = 200) {
  assert.equal(response.status, code, response.text);
  assert.ok(response.queries <= 40, "D1 查询预算");
  return response.body;
}
async function withSchool(run, count = 2) {
  const f = await fixture();
  try { await run({ ...await setup(f, count), f }); }
  finally { f.restore(); }
}
const paid = (s, data) => mutate(s, "credits/payments", {
  student_id: s.students[0], paid_at: "2026-11-01", kind: "tuition", ...data,
});
const funds = (s) => request(s, "credits/balance?student_id=" + s.students[0]);
const credits = (s, student = s.students[0]) => request(s, "credits/packages?student_id=" + student);
const raw = (s, table) => s.f.db.raw.prepare(`SELECT * FROM ${table} WHERE tenant_id=? ORDER BY created_at,id`).all(s.t.id);
const freshPack = (s) => ({ course_type_id: s.type, units_total: 2, amount: 200, unit_price: 100 });

test("B1 欠课：默认 3、先实扣再记欠、整体收费无欠、续费分类", () => withSchool(async (s) => {
  assert.equal(ok(await request(s, "settings")).max_debt_units, 3);
  const p = await pack(s, s.students[0], 0.5);
  await pack(s, s.students[1], 5);
  const overall = await s.create("students", { name: "整体收费", billing_mode: "overall" });
  const id = await lesson(s, "2026-11-10T09:00", [...s.students, overall]);
  const result = ok(await status(s, id, "completed"));
  assert.deepEqual(result.blocked, []);
  assert.equal(await balance(s, p), 0);
  assert.deepEqual(raw(s, "credit_debts").map((d) => [d.student_id, d.units, d.remaining_units]),
    [[s.students[0], 0.5, 0.5]]);
  const dto = ok(await credits(s));
  assert.equal(dto.debt_units, 0.5);
  assert.equal(dto.available_units, -0.5);
  const out = ok(await request(s, "c2/renewals?group=debt"));
  assert.equal(out.items[0].state, "debt");
  assert.equal(out.items[0].student_id, s.students[0]);
  assert.ok(ok(await request(s, "c2/renewals?group=zero")).items.some((x) => x.student_id === s.students[0]));
  assert.equal(ok(await request(s, "todo/summary")).renewal_debt, 1);
}));

test("B1 欠课：超限仅留该学员待销，补包后只处理未销者，幂等", () => withSchool(async (s) => {
  ok(await request(s, "settings", "PUT", { key: "max_debt_units", value: 0.5 }));
  const p = await pack(s, s.students[1], 5);
  const id = await lesson(s, "2020-11-10T09:00");
  const d = await details(s, id);
  const payload = { operation_id: randomId("op"), lesson_version: d.version, status: "completed" };
  const path = "credits/lessons/" + id + "/status";
  const a = ok(await request(s, path, "POST", payload));
  assert.equal(a.committed, true);
  assert.match(a.blocked[0].reason, /学员0/);
  assert.deepEqual(ok(await request(s, path, "POST", payload)), a);
  assert.equal(await balance(s, p), 4);
  assert.ok(ok(await request(s, "c2/unchecked")).items.some((row) => row.id === id));
  assert.equal((await details(s, id)).participants.find((x) => x.student_id === s.students[0]).attendance, "planned");
  await pack(s, s.students[0], 2);
  assert.deepEqual(ok(await status(s, id, "completed")).blocked, []);
  assert.equal(await balance(s, p), 4);
}));

test("B1 欠课：同学员 FIFO 部分补扣、补扣日期确认收入、撤销后流水回补", () => withSchool(async (s) => {
  const first = await lesson(s, "2020-11-10T09:00", [s.students[0]]);
  const second = await lesson(s, "2020-11-11T09:00", [s.students[0]]);
  ok(await status(s, first, "completed"));
  ok(await status(s, second, "completed"));
  const p = await pack(s, s.students[0], 1.5);
  assert.equal(await balance(s, p), 0);
  const consume = raw(s, "package_transactions").filter((row) => row.type === "consume");
  const date = consume[0].date;
  assert.equal(consume.find((x) => x.delta === -1).participant_id, (await details(s, first)).participants[0].id);
  assert.ok(consume.every((x) => x.note === "补扣欠课时" && x.date === date));
  assert.equal(ok(await credits(s)).debt_units, 0.5);
  assert.equal(ok(await request(s, "finance/report?month=" + date.slice(0, 7))).earned_amount, 150);
  assert.equal(ok(await request(s, "finance/report?month=2020-11")).earned_amount, 0);
  const version = (await details(s, first)).version;
  ok(await mutate(s, "credits/lessons/" + first + "/undo", { lesson_version: version }));
  assert.equal(await balance(s, p), 1);
  assert.equal(raw(s, "credit_debts").find((x) => x.lesson_id === first).remaining_units, 0);
  assert.ok(raw(s, "credit_debts").find((x) => x.lesson_id === first).deleted_at);
  const more = await pack(s, s.students[0], 2);
  assert.equal(await balance(s, more), 1.5);
  assert.equal(ok(await credits(s)).debt_units, 0);
}));

test("B1 缴费：多包、超额转预收、分位、原子失败和幂等", () => withSchool(async (s) => {
  const p = await pack(s, s.students[0], 1);
  const wrong = await pack(s, s.students[1], 1);
  const d = { operation_id: randomId("op"), amount: 300.01,
    allocations: [{ package_id: p, amount: 120 }, { new_package: freshPack(s), amount: 100.01 }] };
  const a = ok(await paid(s, d));
  assert.equal(a.overflow, 20);
  assert.equal(a.deposit_amount, 100);
  assert.deepEqual(a.allocations.map((x) => x.amount), [100, 100.01]);
  assert.deepEqual(ok(await paid(s, d)), a);
  assert.equal(ok(await funds(s)).balance, 100);
  assert.equal(raw(s, "student_payments")[0].amount, 30001);
  const before = ["packages", "student_payments", "student_balances_ledger"].map((table) => raw(s, table).length);
  ok(await paid(s, { amount: 150, allocations: [{ new_package: freshPack(s), amount: 75 }, { package_id: wrong, amount: 75 }] }), 404);
  assert.deepEqual(["packages", "student_payments", "student_balances_ledger"].map((table) => raw(s, table).length), before);
  const edit = "finance/tuition/" + a.id;
  ok(await mutate(s, edit, { version: 1, amount: 300.02 }, "PATCH"), 409);
  ok(await mutate(s, edit, { version: 1, note: "备注" }, "PATCH"));
  const reverse = ok(await mutate(s, "credits/payments/" + a.id + "/reverse", { version: 2, reason: "测试冲正" }));
  assert.equal(reverse.balance_amount, 0);
  assert.equal(ok(await funds(s)).balance, 0);
  assert.equal(ok(await request(s, "credits/packages/" + p)).record.paid_amount, 0);
}));

test("B1 预收：一次兑换多个包，自动补欠，退款不透支，金额权限与跨机构", () => withSchool(async (s) => {
  ok(await paid(s, { amount: 300, allocations: [] }));
  const id = await lesson(s, "2026-11-10T09:00", [s.students[0]]);
  ok(await status(s, id, "completed"));
  const p = await pack(s, s.students[0], 0, s.type);
  const dto = await request(s, "credits/packages/" + p);
  ok(await mutate(s, "credits/packages/" + p, { version: dto.body.record.version, amount: 50 }, "PATCH"));
  const args = { student_id: s.students[0], items: [
    { package_id: p, amount: 50 }, { new_package: freshPack(s), amount: 150 },
  ] };
  const redeemed = ok(await mutate(s, "credits/balance/redeem", args));
  assert.equal(redeemed.balance_amount, 100);
  assert.equal(await balance(s, redeemed.allocations[1].package_id), 1);
  assert.equal(ok(await credits(s)).debt_units, 0);
  ok(await mutate(s, "credits/balance/adjust", { student_id: s.students[0], type: "refund", amount: -101, reason: "退款" }), 409);
  ok(await mutate(s, "credits/balance/adjust", { student_id: s.students[0], type: "refund", amount: -10, reason: "退款" }));
  assert.equal(ok(await funds(s)).balance, 90);
  const academic = await accountToken(s, ["academic"]);
  const teacher = await teacherToken(s);
  for (const account of [academic, teacher]) {
    ok(await request(s, "credits/balance?student_id=" + s.students[0], "GET", undefined, account.token), 403);
    ok(await mutate(s, "credits/balance/redeem", args, "POST", account.token), 403);
  }
  const other = { ...await setup(s.f, 1, "b1foreign"), f: s.f };
  ok(await request(other, "credits/balance?student_id=" + s.students[0]), 404);
  ok(await paid(s, { amount: 20, allocations: [{ package_id: await pack(other), amount: 20 }] }), 404);
}));

test("B1 待核对：三种历史归类、旧包已收、补价后未处理数下降及直接确认其他收入", () => withSchool(async (s) => {
  const p = await pack(s, s.students[0], 3);
  const unknown = ok(await mutate(s, "credits/packages", { student_id: s.students[0], course_type_id: s.type, units_total: 1 })).id;
  const legacy = [];
  for (const amount of [100, 20, 30])
    legacy.push(ok(await paid(s, { kind: undefined, amount })).id);
  ok(await paid(s, { kind: undefined, package_id: p, amount: 50 }));
  const summary = async () => ok(await request(s, "finance/receivable-summary"));
  assert.deepEqual(await summary(), { amount: 250, unresolved: 4 });
  const pending = () => request(s, "credits/payments/pending?student_id=" + s.students[0]);
  assert.equal(ok(await pending()).unlinked_payments.length, 3);
  for (const [i, action] of ["link", "to_balance", "other_income"].entries())
    ok(await mutate(s, "credits/payments/" + legacy[i] + "/resolve", {
      version: 1, action, ...(i === 0 ? { allocations: [{ package_id: p, amount: 100 }] } : {}),
      ...(i === 2 ? { other_category: "教材费" } : {}),
    }));
  ok(await mutate(s, "credits/payments/" + legacy[0] + "/resolve", { version: 2, action: "to_balance" }), 409);
  assert.deepEqual(await summary(), { amount: 150, unresolved: 1 });
  assert.equal(ok(await pending()).packages_without_price.length, 1);
  ok(await mutate(s, "credits/packages/" + unknown, { version: 1, amount: 80 }, "PATCH"));
  assert.deepEqual(await summary(), { amount: 230, unresolved: 0 });
  ok(await paid(s, { kind: "other_income", amount: 2.34, other_category: "报名费" }));
  assert.equal(ok(await funds(s)).balance, 20);
  const report = ok(await request(s, "finance/report?month=2026-11"));
  assert.equal(report.other_income_amount, 32.34);
  assert.equal(report.earned_amount, 32.34);
  assert.equal(report.other_income.find((row) => row.category === "教材费").amount, 30);
  assert.deepEqual(await summary(), { amount: 230, unresolved: 0 });
}));

test("B1 旧锁月：认定其他收入落在认定月，历史结算与现金日期不变", () => withSchool(async (s) => {
  const oldDate = "2020-10-10", oldMonth = oldDate.slice(0, 7);
  const payment = ok(await paid(s, { kind: undefined, amount: 30, paid_at: oldDate }));
  const finance = await accountToken(s, ["finance"]);
  ok(await mutate(s, "finance/settlements/submit", { month: oldMonth, version: 0 }, "POST", finance.token));
  ok(await mutate(s, "finance/settlements/approve", { month: oldMonth, version: 1 }));
  const historical = ok(await request(s, "finance/report?month=" + oldMonth));
  const resolved = ok(await mutate(s, "credits/payments/" + payment.id + "/resolve",
    { version: 1, action: "other_income", other_category: "其他" }));
  assert.notEqual(resolved.recognized_date.slice(0, 7), oldMonth);
  assert.equal(raw(s, "student_payments")[0].paid_at, oldDate);
  assert.deepEqual(ok(await request(s, "finance/report?month=" + oldMonth)), historical);
  assert.equal(ok(await request(s, "finance/report?month=" + resolved.recognized_date.slice(0, 7))).other_income_amount, 30);
}));

test("B1 并发：同一预收余额不能重复兑换，财务写入全有或全无", () => withSchool(async (s) => {
  ok(await paid(s, { amount: 100 }));
  const body = { student_id: s.students[0], items: [{ new_package: freshPack(s), amount: 90 }] };
  const out = await Promise.all([
    mutate(s, "credits/balance/redeem", body),
    mutate(s, "credits/balance/redeem", body),
  ]);
  assert.deepEqual(out.map((row) => row.status).sort(), [200, 400]);
  assert.equal(ok(await funds(s)).balance, 10);
  assert.equal(raw(s, "packages").length, 1);
  assert.equal(raw(s, "student_payment_allocations").length, 1);
}));

test("B1 备份恢复：欠课时、分类、预收流水及分配一同还原", () => withSchool(async (s) => {
  const { startBackup, continueBackup } = await import("../src/server/backup.js");
  const { adminCall } = await import("./fixtures-admin.mjs");
  const id = await lesson(s, "2026-11-10T09:00", [s.students[0]]);
  ok(await status(s, id, "completed"));
  const p = await pack(s, s.students[1], 3);
  ok(await paid(s, { student_id: s.students[1], amount: 100, allocations: [{ package_id: p, amount: 20 }] }));
  const tables = ["credit_debts", "student_payment_resolutions", "student_balances_ledger", "student_payment_allocations"];
  const expected = tables.map((table) => raw(s, table));
  const backup = await startBackup(s.f.env);
  while (!(await continueBackup(s.f.env)).done) {}
  ok(await paid(s, { amount: 200 }));
  s.f.env.ACCESS_MODE = "off";
  const admin = async (path, data) => {
    const res = await adminCall(s.f, "tenants/" + s.t.id + "/" + path, "POST", data);
    assert.equal(res.status, 200, res.text);
    return res.body;
  };
  const job = await admin("jobs", { kind: "restore", backup_id: backup.id, reason: "核验 B1 数据恢复" });
  for (const page of job.manifest.required) await admin("jobs/" + job.id + "/page", page);
  await admin("jobs/" + job.id + "/commit", {});
  assert.deepEqual(tables.map((table) => raw(s, table)), expected);
  assert.deepEqual(s.f.db.raw.prepare("PRAGMA foreign_key_check").all(), []);
}));

test("B1 未购包欠课：可登记续费提醒，非欠课学员不能伪造空包提醒", () => withSchool(async (s) => {
  const id = await lesson(s, "2026-11-10T09:00", [s.students[0]]);
  ok(await status(s, id, "completed"));
  const body = { course_type_id: s.type, package_ids: [], channel: "text" };
  ok(await request(s, "renewals/remind", "POST", { ...body, student_id: s.students[0] }));
  ok(await request(s, "renewals/remind", "POST", { ...body, student_id: s.students[1] }), 404);
  const out = ok(await request(s, "renewals?group=debt"));
  assert.equal(out.total, 1);
  assert.equal(out.items[0].reminded_count, 1);
}));
