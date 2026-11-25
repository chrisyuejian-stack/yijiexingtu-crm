import { effectivePolicies } from "../src/server/absence.js";
// 本机只读对照，不读取或绑定旧 D1，也不上传 JSON；需 Node.js 24+。
import { readFile, writeFile } from "node:fs/promises";
import { legacyFinanceOracle } from "../tests/fixtures-legacy-finance.mjs";
import { calculatePayroll } from "../src/server/finance.js";
import { multiplyCents } from "../src/server/numbers.js";
const filename = process.env.LEGACY_JSON_PATH || process.argv[2],
  month = process.env.COMPARE_MONTH || process.argv[3],
  output = process.env.COMPARE_OUTPUT;
if (!filename || !/^20\d\d-(0[1-9]|1[0-2])$/.test(month || "")) {
  console.error(
    "用法：node scripts/compare-legacy-finance.mjs /本机/旧版导出.json YYYY-MM（或 LEGACY_JSON_PATH、COMPARE_MONTH）",
  );
  process.exit(2);
}
const input = JSON.parse(await readFile(filename, "utf8")),
  db = input.db || input.data || input;
for (const name of [
  "lessons",
  "lessonParticipants",
  "teachers",
  "courseTypes",
  "teacherRates",
])
  if (!Array.isArray(db[name])) throw Error("缺少旧版集合 " + name);
for (const name of [
  "teacherPayments",
  "teacherAdjustments",
  "otherCosts",
  "studentPayments",
  "settlements",
  "students",
  "categories",
  "locations",
])
  db[name] ||= [];
db.settings ||= {};
db.settings.absencePolicies ||= {};
const cents = (value) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) throw Error("旧数据包含非法金额");
    return Math.round(n * 100);
  },
  selected = db.lessons.filter((l) => String(l.start).slice(0, 7) === month),
  oracle = legacyFinanceOracle(db, { month, financeMode: "teacher" });
const ctx = {
  settlements: [],
  snapshots: [],
  teachers: db.teachers,
  participants: db.lessonParticipants.map((p) => ({
    id: p.id,
    lesson_id: p.lessonId,
    student_id: p.studentId,
    attendance: p.attendance,
  })),
  rates: db.teacherRates.map((r) => ({
    teacher_id: r.teacherId,
    course_type_id: r.courseTypeId,
    format: r.format,
    rate_basis: "legacy",
    rate: cents(r.rate),
    effective_from: "1900-01-01",
    effective_to: "2099-12-31",
  })),
  lessons: selected.map((l) => ({
    id: l.id,
    teacher_id: l.teacherId,
    teacher_name: db.teachers.find((t) => t.id === l.teacherId)?.name || "",
    course_type_id: l.courseTypeId,
    format: l.format,
    start_at: l.start,
    status: l.status,
    units: Number(l.units) || 0,
    override_basis: "legacy",
    override_rate:
      db.settlements.some((s) => s.month === month && s.locked) &&
      l.lockedRate !== undefined
        ? cents(l.lockedRate)
        : l.overrideRate !== undefined && l.overrideRate !== ""
          ? cents(l.overrideRate)
          : null,
  })),
  payments: db.teacherPayments
    .filter((p) => p.month === month)
    .map((p) => ({ teacher_id: p.teacherId, amount: cents(p.amount) })),
  adjustments: db.teacherAdjustments
    .filter((p) => p.month === month)
    .map((p) => ({ teacher_id: p.teacherId, amount: cents(p.amount) })),
};
const actual = calculatePayroll(
    ctx,
    effectivePolicies({ absence_policies: db.settings.absencePolicies }),
  ),
  differences = [];
for (let index = 0; index < db.teachers.length; index++) {
  const teacher = db.teachers[index],
    expected = Math.round(
      selected
        .filter((l) => l.teacherId === teacher.id)
        .reduce((s, l) => s + oracle.teacherCost(l), 0) * 100,
    ),
    row = actual.summaries.find((r) => r.teacher_id === teacher.id);
  if (expected !== row.accrued_amount)
    differences.push({
      teacher_index: index,
      field: "accrued",
      legacy_cents: expected,
      new_cents: row.accrued_amount,
    });
  const paid = Math.round(oracle.paidTeacher(teacher.id, month) * 100);
  if (paid !== row.paid_amount)
    differences.push({
      teacher_index: index,
      field: "paid",
      legacy_cents: paid,
      new_cents: row.paid_amount,
    });
}
const report = {
  month,
  lessons: selected.length,
  teachers: db.teachers.length,
  comparison: "同一份JSON，原最终生效课酬函数 vs 新计算；按分比较",
  status: differences.length ? "FAIL" : "PASS",
  differences,
};
console.log(JSON.stringify(report, null, 2));
if (output) await writeFile(output, JSON.stringify(report, null, 2));
if (differences.length) process.exitCode = 1;
