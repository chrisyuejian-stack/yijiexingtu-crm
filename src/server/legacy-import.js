// Only the old education JSON is recognized. No old authentication, portal, application, AI, or bindings.
import {
  backupTables,
  restoreTables,
  IMPORT_SHAPES,
  TABLE_LABELS,
} from "./backup-model.js";
import { randomId, now, fail, string, phone } from "./core.js";
import { encrypt } from "./crypto.js";
import { moneyIn, quantityIn } from "./numbers.js";
import { day } from "./scheduling.js";
import { calculatePayroll } from "./finance.js";
import { effectivePolicies } from "./absence.js";
export const LEGACY_TABLES = {
  students: "students",
  teachers: "teachers",
  categories: "course_categories",
  courseTypes: "course_types",
  locations: "locations",
  teacherRates: "teacher_rates",
  scheduleTemplates: "schedule_templates",
  scheduleEnrollments: "schedule_enrollments",
  lessons: "lessons",
  lessonParticipants: "lesson_participants",
  packages: "packages",
  packageTransactions: "package_transactions",
  studentPayments: "student_payments",
  teacherPayments: "teacher_payments",
  teacherAdjustments: "teacher_adjustments",
  otherCosts: "other_costs",
  settlements: "settlements",
  studentStages: "student_stages",
  adjustments: "makeup_links",
  studentScheduleBlocks: "student_routines",
  crmNotes: "followup_notes",
  crmTasks: "followup_tasks",
};
const n = (value, fallback = 0) =>
  value === undefined || value === "" || value === null
    ? fallback
    : Number(value);
function q(value, zero = true) {
  return quantityIn(n(value), { zero, signed: true });
}
function time(value) {
  string(value, "历史课程时间", 40);
  day(value.slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d/.test(value))
    fail(400, "历史课程时间不正确");
  return value.slice(0, 16) + "+08:00";
}
const date = (value) => {
  if (!value) fail(400, "历史记录缺少日期，请人工核对后再导入");
  return day(String(value).slice(0, 10));
};
export async function convertLegacy(env, tenantId, raw, settings, admin) {
  const mapped = {},
    rows = Object.fromEntries(restoreTables.map((k) => [k, []])),
    warnings = [];
  for (const key of Object.keys(LEGACY_TABLES)) {
    if (!Array.isArray(raw[key] || [])) fail(400, "旧格式数据表不正确：" + key);
    mapped[key] = new Map();
    for (const r of raw[key] || []) {
      if (typeof r.id !== "string" || !r.id || mapped[key].has(r.id))
        fail(400, "历史数据有缺失或重复 ID：" + key);
      mapped[key].set(r.id, randomId("rec"));
    }
  }
  const ref = (key, id, optional = false) => {
    if (optional && !id) return null;
    const value = mapped[key]?.get(id);
    if (!value) fail(400, "历史关联缺失：" + key + "，请核对预览中的关联字段");
    return value;
  };
  const stamp = (id) => ({
    tenant_id: tenantId,
    id,
    created_at: now(),
    created_by: admin.id,
    updated_at: now(),
    updated_by: admin.id,
    version: 1,
    deleted_at: null,
  });
  const oldPolicies = settings.absencePolicies || {};
  // Explicitly saved booleans are retained; missing fields now use the approved shared defaults.
  const businessSettings = {
    absence_policies: effectivePolicies({ absence_policies: oldPolicies }),
    low_balance_threshold: n(settings.lowBalanceThreshold, 5),
    expiry_warning_days: 30,
  };
  if (!settings.absencePolicies || !Object.keys(oldPolicies).length)
    warnings.push(
      "未保存缺勤规则：未锁历史月份按已确认第14条采用当前默认规则；已锁快照保留旧额。",
    );
  for (const [key, table] of Object.entries(LEGACY_TABLES)) {
    let index = 0;
    for (const old of raw[key] || []) {
      if (
        ["lessons", "teacherRates"].includes(key) &&
        !["individual", "group", "class"].includes(old.format)
      )
        fail(400, "历史课程/课酬标准缺少有效课程形式，请人工核对");
      const row = { ...stamp(mapped[key].get(old.id)) };
      const str = (key, fallback = "") => String(old[key] ?? fallback);
      const money = (key, nullable = false, signed = false) =>
        moneyIn(old[key] === undefined && nullable ? null : n(old[key]), {
          nullable,
          signed,
        });
      if (key === "students")
        Object.assign(row, {
          name: str("name"),
          gender: str("gender"),
          birth_year: old.birthYear ? n(old.birthYear) : null,
          school: str("school"),
          grade: str("grade"),
          direction: str("direction"),
          status: ["active", "paused", "archived"].includes(old.status)
            ? old.status
            : "active",
          notes: str("notes", str("note")),
          parent_name: str("parentName"),
          sort_order: n(old.sortOrder, index),
          billing_mode: old.billingMode === "overall" ? "overall" : "package",
        });
      if (key === "teachers")
        Object.assign(row, {
          name: str("name"),
          subjects: JSON.stringify(
            Array.isArray(old.subjects) ? old.subjects : [],
          ),
          employment: str("employment", "part_time"),
          show_in_timetable:
            old.showInTimetable === 0 ||
            old.showInTimetable === false ||
            old.show_in_timetable === 0
              ? 0
              : 1,
          status:
            old.active === false || old.status === "archived"
              ? "archived"
              : "active",
          sort_order: n(old.sortOrder, index),
        });
      if (["students", "teachers"].includes(key)) {
        row.phone_enc = old.phone
          ? await encrypt(env, phone(String(old.phone)), tenantId + ":phone")
          : null;
        if (key === "students")
          row.parent_phone_enc = old.parentPhone
            ? await encrypt(
                env,
                phone(String(old.parentPhone)),
                tenantId + ":phone",
              )
            : null;
      }
      if (key === "categories")
        Object.assign(row, {
          name: str("name"),
          color: str("color", "#8B7BB5"),
          active: old.active === false ? 0 : 1,
          sort_order: n(old.sortOrder, index),
        });
      if (key === "courseTypes")
        Object.assign(row, {
          name: str("name"),
          category_id: ref("categories", old.categoryId),
          format: old.format || "individual",
          default_minutes: n(old.defaultMinutes || old.duration, 60),
          units_per_lesson: q(old.unitsPerLesson ?? old.units ?? 1),
          capacity: n(old.capacity, 200),
          active: old.active === false ? 0 : 1,
          sort_order: n(old.sortOrder, index),
        });
      if (key === "locations")
        Object.assign(row, {
          name: str("name"),
          campus: str("campus"),
          offsite: old.offsite ? 1 : 0,
          capacity: n(old.capacity, 200),
          active: old.active === false ? 0 : 1,
          sort_order: n(old.sortOrder, index),
        });
      if (key === "teacherRates")
        Object.assign(row, {
          teacher_id: ref("teachers", old.teacherId),
          course_type_id: ref("courseTypes", old.courseTypeId),
          format: old.format || "individual",
          rate_basis: "legacy",
          rate: money("rate"),
          effective_from: "1900-01-01",
          effective_to: "2099-12-31",
          created_at: now() - index,
        });
      if (key === "scheduleTemplates")
        Object.assign(row, {
          teacher_id: ref("teachers", old.teacherId),
          assistant_id: ref("teachers", old.assistantId, true),
          course_type_id: ref("courseTypes", old.courseTypeId),
          location_id: old.online ? null : ref("locations", old.locationId),
          weekday: n(old.weekday),
          start_time: str("time"),
          duration: n(old.duration, 60),
          units: q(old.units ?? 1),
          date_from: date(old.from),
          date_to: date(old.to),
          mode: old.online ? "online" : "offline",
          note: str("note"),
          active: old.active === false ? 0 : 1,
          class_id: null,
        });
      if (key === "scheduleEnrollments")
        Object.assign(row, {
          template_id: ref("scheduleTemplates", old.templateId),
          student_id: ref("students", old.studentId),
          date_from: date(old.from),
          date_to: date(old.to),
        });
      if (key === "lessons")
        Object.assign(row, {
          teacher_id: ref("teachers", old.teacherId),
          assistant_id: ref("teachers", old.assistantId, true),
          course_type_id: ref("courseTypes", old.courseTypeId),
          location_id: old.online ? null : ref("locations", old.locationId),
          template_id: ref("scheduleTemplates", old.templateId, true),
          occurrence_date: old.occurrenceDate ? date(old.occurrenceDate) : null,
          start_at: time(old.start),
          duration: n(old.duration, 60),
          units: q(old.units),
          mode: old.online ? "online" : "offline",
          format: old.format || "individual",
          status: old.status || "planned",
          note: str("note"),
          override_rate:
            old.overrideRate === undefined || old.overrideRate === ""
              ? null
              : money("overrideRate"),
          override_basis: "legacy",
          teacher_paid:
            old.status === "completed" ||
            ((raw.settlements || []).some(
              (x) => x.locked && x.month === String(old.start).slice(0, 7),
            )
              ? oldPolicies
              : businessSettings.absence_policies)[old.status]?.teacherPaid
              ? 1
              : 0,
          class_id: null,
          current_submission_id: null,
        });
      if (key === "lessonParticipants")
        Object.assign(row, {
          lesson_id: ref("lessons", old.lessonId),
          student_id: ref("students", old.studentId),
          attendance: old.attendance || "planned",
          deducted: q(old.deducted),
          package_id: ref("packages", old.packageId, true),
          makeup_for: ref("lessonParticipants", old.makeupFor, true),
        });
      if (key === "studentStages")
        Object.assign(row, {
          student_id: ref("students", old.studentId),
          name: str("name"),
          date_from: old.dateFrom ? date(old.dateFrom) : null,
          date_to: old.dateTo ? date(old.dateTo) : null,
          goal: str("goal"),
          status: "active",
        });
      if (key === "packages")
        Object.assign(row, {
          created_at: now() - (raw.packages?.length || 0) + index,
          student_id: ref("students", old.studentId),
          course_type_id: ref("courseTypes", old.courseTypeId),
          units_total: q(old.total),
          valid_from: old.validFrom ? date(old.validFrom) : null,
          valid_to: old.validTo ? date(old.validTo) : null,
          status: "active",
          unit_price: old.unitPrice === undefined ? null : money("unitPrice"),
          amount: old.amount === undefined ? null : money("amount"),
          stage_id: ref("studentStages", old.stageId, true),
          purchase_date: old.date ? date(old.date) : "",
          scope_kind: "type",
          category_id: null,
        });
      if (key === "packageTransactions") {
        const pack = (raw.packages || []).find((p) => p.id === old.packageId);
        if (!pack) fail(400, "历史流水缺少课时包");
        Object.assign(row, {
          package_id: ref("packages", old.packageId),
          student_id: ref("students", pack.studentId),
          delta: q(old.delta),
          type: str("type", "adjust"),
          date: date(old.date),
          participant_id: ref(
            "lessonParticipants",
            old.lessonParticipantId,
            true,
          ),
          reference_id: old.referenceId ? String(old.referenceId) : null,
          note: str("note"),
        });
      }
      if (key === "studentPayments")
        Object.assign(row, {
          student_id: ref("students", old.studentId),
          package_id: ref("packages", old.packageId, true),
          amount: money("amount"),
          paid_at: date(old.date),
          method: str("method"),
          note: str("note") + (old.stage ? " · " + old.stage : ""),
        });
      if (key === "teacherPayments")
        Object.assign(row, {
          teacher_id: ref("teachers", old.teacherId),
          month: str("month"),
          amount: money("amount"),
          paid_at: date(old.date),
          note: str("note"),
        });
      if (key === "teacherAdjustments")
        Object.assign(row, {
          teacher_id: ref("teachers", old.teacherId),
          month: str("month"),
          amount: money("amount", false, true),
          reason: str("reason", str("note", "历史课酬调整")),
        });
      if (key === "otherCosts")
        Object.assign(row, {
          date: date(old.date),
          category: str("category", "其他"),
          amount: money("amount"),
          note: str("note"),
        });
      if (key === "settlements")
        Object.assign(row, {
          month: str("month"),
          locked: old.locked ? 1 : 0,
          status: old.locked ? "approved" : "draft",
          submitted_at: null,
          submitted_by: null,
          submitted_revision: null,
          submitted_fingerprint: null,
          approved_at: old.lockedAt ? Date.parse(old.lockedAt) : null,
          approved_by: null,
          snapshot_token: old.locked ? randomId("snap") : null,
          total_amount: money("total"),
          tuition_amount: 0,
          cost_amount: 0,
          profit_amount: 0,
          summary: "{}",
          reason: "旧版已锁月份导入，非本系统审批；原始值保留在导入报告",
        });
      if (key === "adjustments") {
        const original = ref("lessonParticipants", old.originalParticipantId),
          target = rows.lesson_participants.find(
            (p) =>
              p.makeup_for === original &&
              (!old.targetLessonId ||
                p.lesson_id === ref("lessons", old.targetLessonId)),
          );
        if (!target) {
          warnings.push("补课历史记录未形成参与关联，需人工核对：" + old.id);
          continue;
        }
        Object.assign(row, {
          original_participant_id: original,
          target_participant_id: target.id,
          target_lesson_id: target.lesson_id,
          note: str("note"),
        });
      }
      if (key === "studentScheduleBlocks")
        Object.assign(row, {
          student_id: ref("students", old.studentId),
          weekday: n(old.weekday),
          time: str("timeText", str("time", "待通知")),
          content: [
            str("title"),
            str("note"),
            old.active === false ? "旧记录已停用" : "",
          ]
            .filter(Boolean)
            .join(" · "),
        });
      if (key === "crmNotes")
        Object.assign(row, {
          student_id: ref("students", old.studentId),
          at: old.at
            ? new Date(old.at)
                .toLocaleString("sv-SE", {
                  timeZone: "Asia/Shanghai",
                  hour12: false,
                })
                .replace(" ", "T") + "+08:00"
            : new Date(now()).toISOString(),
          content: str("text"),
        });
      if (key === "crmTasks") {
        Object.assign(row, {
          student_id: ref("students", old.studentId, true),
          title: str("title"),
          due_date: old.due ? date(old.due) : "",
          assignee_id: null,
          legacy_owner: str("owner"),
          done: old.status === "done" ? 1 : 0,
        });
        warnings.push("旧任务的文字负责人保留，账号待主管指派。");
      }
      if (
        [
          "students",
          "teachers",
          "categories",
          "courseTypes",
          "locations",
        ].includes(key) &&
        !row.name
      )
        fail(400, "历史档案名称不能为空");
      rows[table].push(row);
      index++;
    }
  }
  // Fixed templates in 0.9.3 also keep studentIds; synthesize only enrollments not already present.
  for (const old of raw.scheduleTemplates || [])
    for (const student of old.studentIds || []) {
      const template_id = ref("scheduleTemplates", old.id),
        student_id = ref("students", student);
      if (
        !rows.schedule_enrollments.some(
          (e) => e.template_id === template_id && e.student_id === student_id,
        )
      )
        rows.schedule_enrollments.push({
          ...stamp(randomId("rec")),
          template_id,
          student_id,
          date_from: date(old.from),
          date_to: date(old.to),
        });
    }
  // The old balance is total + transactions. Opening is synthesized exactly once, never double counted.
  for (const pack of rows.packages)
    if (pack.units_total)
      rows.package_transactions.push({
        ...stamp(randomId("txn")),
        package_id: pack.id,
        student_id: pack.student_id,
        delta: pack.units_total,
        type: "opening",
        date: pack.purchase_date,
        participant_id: null,
        reference_id: null,
        note: "旧版购买课时转期初流水",
      });
  const teacherMap = new Map(rows.teachers.map((x) => [x.id, x])),
    courseMap = new Map(rows.course_types.map((x) => [x.id, x])),
    roomMap = new Map(rows.locations.map((x) => [x.id, x]));
  for (const settlement of rows.settlements.filter((s) => s.locked)) {
    const month = settlement.month,
      oldRates = new Map(
        (raw.lessons || []).map((l) => [ref("lessons", l.id), l.lockedRate]),
      );
    const lessons = rows.lessons
      .filter((l) => l.start_at.startsWith(month))
      .map((l) => ({
        ...l,
        teacher_name: teacherMap.get(l.teacher_id)?.name,
        course_name: courseMap.get(l.course_type_id)?.name,
        category_id: courseMap.get(l.course_type_id)?.category_id,
        location_name: roomMap.get(l.location_id)?.name,
        override_rate:
          oldRates.get(l.id) !== undefined
            ? moneyIn(Number(oldRates.get(l.id)))
            : l.override_rate,
      }));
    const ctx = {
      lessons,
      participants: rows.lesson_participants,
      rates: rows.teacher_rates,
      teachers: rows.teachers,
      payments: [],
      adjustments: [],
      settlements: [],
      snapshots: [],
    };
    const pay = calculatePayroll(ctx, oldPolicies);
    for (const e of pay.lessons || pay.entries || [])
      rows.payroll_snapshots.push({
        ...stamp(randomId("snap")),
        month,
        snapshot_token: settlement.snapshot_token,
        lesson_id: e.id,
        teacher_id: e.teacher_id,
        rate: e.rate,
        rate_basis: e.rate_basis,
        quantity: e.quantity,
        amount: e.amount,
        lesson_json: JSON.stringify(e),
      });
  }
  for (const [table, records] of Object.entries(rows))
    for (const row of records) {
      for (const [field, spec] of Object.entries(IMPORT_SHAPES[table]))
        if (row[field] === undefined) {
          if (spec.has_default) row[field] = spec.default;
          else if (!spec.required) row[field] = null;
          else
            fail(
              400,
              (TABLE_LABELS[table] || "业务记录") +
                "缺少必要字段，请核对历史资料",
            );
        }
      if (table === "teacher_payments" && row.amount <= 0)
        fail(400, "历史课酬付款金额必须大于零，请人工核对");
      if (
        [
          "teacher_payments",
          "teacher_adjustments",
          "settlements",
          "payroll_snapshots",
        ].includes(table) &&
        !/^20\d{2}-(0[1-9]|1[0-2])$/.test(row.month)
      )
        fail(400, "历史结算月份格式不正确");
    }
  return { rows, settings: businessSettings, warnings: [...new Set(warnings)] };
}
