import { studentNickname } from './student-nickname.js';
import { matchesDebtScope } from "./debt.js";
import { withStudentSearchKeys } from "./student-search.js";
import { quantityIn, moneyOut } from "./numbers.js";
import { repo } from "./repo.js";
import {
  fail,
  string,
  integer,
  randomId,
  version,
  now,
  phone,
} from "./core.js";
import { can } from "./permissions.js";
import { requireCan } from "./accounts.js";
import { encrypt, decrypt } from "./crypto.js";
export const resources = {
  packages: "packages",
  students: "students",
  teachers: "settings",
  course_categories: "settings",
  course_types: "settings",
  locations: "settings",
  student_schedule_blocks: "students",
  schedule_templates: "templates",
  schedule_enrollments: "templates",
  lessons: "lessons",
};
const colors = [
  "#8B7BB5",
  "#5B8DB8",
  "#62A598",
  "#C99A54",
  "#B7768C",
  "#7B93AB",
  "#A48B69",
  "#8C9D62",
];
export function day(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail(400, "日期格式不正确");
  return value;
}
export function nextDay(value, n = 1) {
  return new Date(Date.parse(day(value) + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
}
function time(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    fail(400, "时间格式不正确");
  return value;
}
const minute = (value) =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const units = (value) => {
  const result = quantityIn(value, { max: 100 });
  if (result < 1) fail(400, "每节课至少 1 课时");
  return result;
};
function duration(value) {
  if (![30, 45, 60].includes(value))
    fail(400, "课程时长只能为 30、45 或 60 分钟");
  return value;
}
function boolean(value, defaultValue = 1) {
  if (value === undefined) return defaultValue;
  if (![true, false, 0, 1].includes(value)) fail(400, "开关格式不正确");
  return value ? 1 : 0;
}
function status(value) {
  if (!["active", "paused", "archived"].includes(value))
    fail(400, "档案状态不正确");
  return value;
}
function ids(value) {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 200 ||
    value.some((x) => typeof x !== "string") ||
    new Set(value).size !== value.length
  )
    fail(400, "学员列表不正确");
  return value;
}
async function reference(r, kind, id, active = true) {
  if (typeof id !== "string" || !id) fail(400, "缺少关联档案");
  const row = await r.businessGet(kind, id);
  if (!row) fail(404, "不存在");
  if (active && (row.active === 0 || (row.status && row.status !== "active")))
    fail(400, "关联档案已停用或归档");
  return row;
}
async function normalize(env, tenantId, r, resource, d, old) {
  const text = (key, max = 100) =>
    string(d[key] ?? old?.[key] ?? "", key, max, 0);
  let row = {
    id: old?.id || randomId(resource === "lessons" ? "les" : "rec"),
    deleted_at: null,
  };
  if (old) row = { ...old };
  // 课时包由 credits.js 统一写入，避免绕过购买/调整流水。
  if (resource === "packages") fail(404, "不存在");
  if (["students", "teachers"].includes(resource)) {
    row.name = string(d.name ?? old?.name, "姓名", 50);
    if (resource === "students") {
      row.billing_mode = d.billing_mode ?? old?.billing_mode ?? "package";
      if (!["package", "overall"].includes(row.billing_mode))
        fail(400, "收费模式不正确");
    }
    row.status = status(d.status ?? old?.status ?? "active");
    row.sort_order = integer(
      d.sort_order ?? old?.sort_order ?? 0,
      "排序",
      0,
      1000000,
    );
    row.phone_enc = old?.phone_enc || null;
    if (
      d.phone !== undefined &&
      d.phone !== null &&
      typeof d.phone !== "string"
    )
      fail(400, "手机号格式不正确");
    if (d.phone !== undefined)
      row.phone_enc = d.phone
        ? await encrypt(env, phone(d.phone), tenantId + ":phone")
        : null;
    if (resource === "students") {
      row.gender = text("gender", 10);
      row.birth_year = d.birth_year ?? old?.birth_year ?? null;
      if (row.birth_year !== null)
        integer(row.birth_year, "出生年份", 1900, 2100);
      for (const key of ["school", "grade", "direction", "parent_name"])
        row[key] = text(key);
      row.report_class_id = d.report_class_id === undefined ? old?.report_class_id ?? null : d.report_class_id;
      row.source_lead_id = d.source_lead_id === undefined ? old?.source_lead_id ?? null : d.source_lead_id;
      for (const key of ["report_class_id", "source_lead_id"])
        if (row[key] !== null) string(row[key], key, 100);
      if (row.source_lead_id && !(await r.identityLeadExists(row.source_lead_id)))
        fail(404, "不存在", "not_found");
      if (row.report_class_id && !(await r.settingsReferences("report_classes",[row.report_class_id])).length)
        fail(404,"不存在","not_found");
      row.nickname = studentNickname(row.name, d.nickname === undefined ? old?.nickname : d.nickname);
      string(row.nickname, "昵称", 50);
      if (d.parent_consent_media !== undefined && typeof d.parent_consent_media !== "boolean")
        fail(422, "家长展示同意须为布尔值", "validation_failed");
      row.parent_consent_media = d.parent_consent_media === undefined ? (old?.parent_consent_media ?? 0) : Number(d.parent_consent_media);
      row.notes = text("notes", 2000);
      row.parent_phone_enc = old?.parent_phone_enc || null;
      if (
        d.parent_phone !== undefined &&
        d.parent_phone !== null &&
        typeof d.parent_phone !== "string"
      )
        fail(400, "家长手机号格式不正确");
      if (d.parent_phone !== undefined)
        row.parent_phone_enc = d.parent_phone
          ? await encrypt(env, phone(d.parent_phone), tenantId + ":phone")
          : null;
    } else {
      row.show_in_timetable = integer(
        d.show_in_timetable === undefined
          ? (old?.show_in_timetable ?? 1)
          : d.show_in_timetable,
        "对外课表显示",
        0,
        1,
      );
      row.subjects = JSON.stringify(
        d.subjects ?? JSON.parse(old?.subjects || "[]"),
      );
      if (
        !Array.isArray(JSON.parse(row.subjects)) ||
        JSON.parse(row.subjects).some(
          (x) => typeof x !== "string" || x.length > 50,
        ) ||
        row.subjects.length > 2000
      )
        fail(400, "科目格式不正确");
      row.employment = d.employment ?? old?.employment ?? "part_time";
      if (!["full_time", "part_time"].includes(row.employment))
        fail(400, "聘用类型不正确");
    }
    return row;
  }
  if (["course_categories", "course_types", "locations"].includes(resource)) {
    row.name = string(d.name ?? old?.name, "名称", 100);
    row.active = boolean(d.active, old?.active ?? 1);
    row.sort_order = integer(
      d.sort_order ?? old?.sort_order ?? 0,
      "排序",
      0,
      1000000,
    );
    if (resource === "course_categories") {
      row.color = d.color ?? old?.color ?? colors[0];
      if (!colors.includes(row.color)) fail(400, "请选择预设课程颜色");
    }
    if (resource === "course_types") {
      row.category_id = d.category_id ?? old?.category_id;
      await reference(r, "course_categories", row.category_id);
      row.format = d.format ?? old?.format ?? "individual";
      if (!["individual", "group", "class"].includes(row.format))
        fail(400, "授课形式不正确");
      row.default_minutes = duration(
        d.default_minutes ?? old?.default_minutes ?? 45,
      );
      row.units_per_lesson = units(
        d.units_per_lesson ?? old?.units_per_lesson ?? 1,
      );
      row.capacity = integer(
        d.capacity ?? old?.capacity ?? 1,
        "人数上限",
        1,
        200,
      );
    }
    if (resource === "locations") {
      row.campus = text("campus");
      row.offsite = boolean(d.offsite, old?.offsite ?? 0);
      row.capacity = integer(d.capacity ?? old?.capacity ?? 1, "容量", 1, 200);
    }
    return row;
  }
  if (resource === "student_schedule_blocks") {
    row.student_id = d.student_id ?? old?.student_id;
    await reference(r, "students", row.student_id);
    row.weekday = integer(d.weekday ?? old?.weekday, "星期", 0, 6);
    row.start_time = time(d.start_time ?? old?.start_time);
    row.end_time = time(d.end_time ?? old?.end_time);
    if (row.end_time <= row.start_time) fail(400, "结束时间须晚于开始时间");
    row.label = text("label");
    row.active = boolean(d.active, old?.active ?? 1);
    return row;
  }
  if (resource === "schedule_enrollments") {
    row.template_id = d.template_id ?? old?.template_id;
    const template = await reference(r, "schedule_templates", row.template_id);
    if (template.class_id)
      fail(400, "这条固定课按班级名单排课，请先把学员加入班级", "CLASS_TEMPLATE_ROSTER");
    row.student_id = d.student_id ?? old?.student_id;
    await reference(r, "students", row.student_id);
    row.date_from = day(d.date_from ?? old?.date_from);
    row.date_to = day(d.date_to ?? old?.date_to);
    if (
      row.date_from > row.date_to ||
      row.date_from < template.date_from ||
      row.date_to > template.date_to
    )
      fail(400, "报名日期须在模板有效期内");
    for (const item of await r.enrollmentsFor(row.template_id))
      if (
        item.id !== row.id &&
        item.student_id === row.student_id &&
        item.date_from <= row.date_to &&
        item.date_to >= row.date_from
      )
        fail(409, "报名时间段重复");
    return row;
  }
  if (["lessons", "schedule_templates"].includes(resource)) {
    for (const key of [
      "teacher_id",
      "assistant_id",
      "course_type_id",
      "location_id",
    ])
      row[key] = d[key] ?? old?.[key] ?? null;
    if (row.assistant_id === "") row.assistant_id = null;
    const course = await reference(r, "course_types", row.course_type_id);
    await reference(r, "course_categories", course.category_id);
    await reference(r, "teachers", row.teacher_id);
    if (
      (await r.partnerManaged("teachers", row.teacher_id)) ||
      (await r.partnerManaged("course_types", row.course_type_id)) ||
      (row.assistant_id &&
        (await r.partnerManaged("teachers", row.assistant_id)))
    )
      fail(403, "合作课的专用讲师和课程不能用于机构排课");
    if (row.assistant_id) {
      await reference(r, "teachers", row.assistant_id);
      if (row.assistant_id === row.teacher_id) fail(400, "主讲与助教不能相同");
    }
    row.class_id = d.class_id ?? old?.class_id ?? null;
    if (row.class_id !== null) {
      const cls = await reference(r, "classes", row.class_id);
      if (cls.status !== "active") fail(400, "班级已归档");
    }
    row.mode = d.mode ?? old?.mode ?? "offline";
    if (!["offline", "online"].includes(row.mode)) fail(400, "上课方式不正确");
    if (row.mode === "online") row.location_id = null;
    else await reference(r, "locations", row.location_id);
    row.duration = duration(
      d.duration ?? old?.duration ?? course.default_minutes,
    );
    row.units = units(d.units ?? old?.units ?? course.units_per_lesson);
    row.note = text("note", 2000);
    if (resource === "lessons") {
      const start = d.start_at ?? old?.start_at;
      if (
        typeof start !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:\+08:00)?$/.test(start)
      )
        fail(400, "课程时间格式不正确");
      day(start.slice(0, 10));
      time(start.slice(11, 16));
      row.start_at = start.slice(0, 16) + "+08:00";
      row.status = old?.status || "planned";
      row.teacher_paid = old?.teacher_paid ?? 0;
      row.format = d.format ?? old?.format ?? course.format;
      if (!["individual", "group", "class"].includes(row.format))
        fail(400, "课程形式不正确");
      row.template_id = old?.template_id || null;
      row.occurrence_date = old?.occurrence_date || null;
      if (d.package_id !== undefined)
        fail(400, "课时包必须在学员参与记录中指定");
    } else {
      row.weekday = integer(d.weekday ?? old?.weekday, "星期", 0, 6);
      row.start_time = time(d.start_time ?? old?.start_time);
      row.date_from = day(d.date_from ?? old?.date_from);
      row.date_to = day(d.date_to ?? old?.date_to);
      if (row.date_from > row.date_to) fail(400, "模板日期范围不正确");
      if (row.class_id) {
        const cls = await reference(r, "classes", row.class_id);
        if (row.date_from < cls.date_from || row.date_to > cls.date_to)
          fail(400, "模板不在班级有效日期内");
      }
      row.active = boolean(d.active, old?.active ?? 1);
    }
    if (
      minute(
        resource === "lessons" ? row.start_at.slice(11, 16) : row.start_time,
      ) +
        row.duration >
      1440
    )
      fail(400, "课程不能跨越午夜");
    return row;
  }
  fail(404, "不存在");
}
export function occupiesSchedule(lesson) {
  return !["cancelled", "rescheduled", "teacher_leave"].includes(lesson.status);
}
export function scheduleConflicts(
  lesson,
  studentIds,
  snapshot,
  blocks,
  extra = [],
) {
  const date = lesson.start_at.slice(0, 10),
    start = minute(lesson.start_at.slice(11, 16)),
    end = start + lesson.duration,
    result = [];
  const teachers = [lesson.teacher_id, lesson.assistant_id].filter(Boolean);
  for (const item of [...snapshot.lessons, ...extra]) {
    if (
      item.id === lesson.id ||
      item.start_at.slice(0, 10) !== date ||
      !occupiesSchedule(item)
    )
      continue;
    const s = minute(item.start_at.slice(11, 16));
    if (start >= s + item.duration || end <= s) continue;
    const reasons = [];
    if (
      [item.teacher_id, item.assistant_id].some(
        (x) => x && teachers.includes(x),
      )
    )
      reasons.push("教师");
    if (
      lesson.mode !== "online" &&
      item.mode !== "online" &&
      lesson.location_id &&
      item.location_id === lesson.location_id
    )
      reasons.push("教室");
    const participants =
      item.student_ids ||
      snapshot.participants
        .filter((x) => x.lesson_id === item.id)
        .map((x) => x.student_id);
    if (participants.some((id) => studentIds.includes(id)))
      reasons.push("学员");
    if (reasons.length) result.push({ lesson_id: item.id, reasons });
  }
  const weekday = (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7;
  for (const id of studentIds)
    for (const block of blocks.get(id) || [])
      if (
        block.weekday === weekday &&
        start < minute(block.end_time) &&
        end > minute(block.start_time)
      )
        result.push({ student_id: id, reasons: ["学员不可排时段"] });
  return result;
}
export async function conflicts(r, lesson, studentIds, snapshot, extra = []) {
  const blocks = new Map();
  for (const id of studentIds) blocks.set(id, await r.blocksFor(id));
  return scheduleConflicts(lesson, studentIds, snapshot, blocks, extra);
}
async function validateParticipants(r, row, input, previous = []) {
  const list = Array.isArray(input) ? input : [];
  if (list.some((x) => !x || typeof x !== "object" || Array.isArray(x)))
    fail(400, "参与记录格式不正确");
  const studentIds = ids(list.map((x) => x.student_id));
  const type = await reference(r, "course_types", row.course_type_id);
  if (type.format === "individual" && list.length !== 1)
    fail(400, "一对一课程只能选择一名学员");
  if (list.length > type.capacity) fail(400, "超过课程人数上限");
  if (row.location_id) {
    const room = await reference(r, "locations", row.location_id);
    if (list.length > room.capacity) fail(400, "超过教室容量");
  }
  for (const p of list) {
    await reference(r, "students", p.student_id);
    const explicit = Object.hasOwn(p, "package_id");
    const packageId = explicit ? p.package_id : previous.find((old) => old.student_id === p.student_id)?.package_id;
    if (packageId) {
      if (explicit && typeof packageId !== "string") fail(400, "关联 ID 不正确");
      const pack = await r.businessGet("packages", packageId);
      if (explicit && !pack) fail(404, "不存在");
      const suitable = pack && pack.status === "active" && pack.student_id === p.student_id &&
        matchesDebtScope(pack, { course_type_id: row.course_type_id, category_id: type.category_id });
      if (explicit && !suitable) fail(400, "课时包归属或适用课程不正确");
      p.package_id = suitable ? pack.id : null;
    } else p.package_id = null;
    if (p.makeup_for) fail(400, "补课关联在下一阶段开放");
  }
  return studentIds;
}
function dto(user, resource, row) {
  if (user.roles.some((role) => ["teacher", "student"].includes(role))) {
    const allowed =
      resource === "lessons"
        ? [
            "id",
            "source_course_id",
            "source_session_id",
            "start_at",
            "duration",
            "units",
            "teacher_id",
            "assistant_id",
            "course_type_id",
            "location_id",
            "mode",
            "status",
            "course_name",
            "category_color",
            "teacher_name",
            "location_name",
            ...(user.roles.includes("teacher")
              ? ["review_status", "review_kind"]
              : [
                  "own_attendance",
                  "own_deducted",
                  "public_text",
                  "homework",
                  "private_comment",
                ]),
          ]
        : resource === "students"
          ? [
              "id",
              "name",
              "gender",
              "birth_year",
              "school",
              "grade",
              "direction",
              "status",
            ]
          : ["id", "name"];
    return Object.fromEntries(
      allowed
        .filter((key) => row[key] !== undefined)
        .map((key) => [key, row[key]]),
    );
  }
  const result = { ...row };
  delete result.tenant_id;
  delete result.teacher_paid;
  delete result.override_rate;
  delete result.locked_rate;
  delete result.override_basis;
  delete result.phone_enc;
  delete result.parent_phone_enc;
  if (
    user.roles.some((x) => ["teacher", "student"].includes(x)) &&
    resource === "lessons"
  )
    delete result.note;
  if (user.roles.includes("teacher")) {
    if (resource === "students") return { id: row.id, name: row.name };
    if (resource === "lessons") {
      delete result.note;
    }
  }
  if (user.roles.includes("student") && resource === "students") {
    delete result.notes;
    delete result.parent_name;
  }
  return result;
}
export async function addStudentSummaries(r, items, user) {
  const rows = await r.participantSummaries(
    items.map((l) => l.id),
    user.roles.includes("student") ? user.student_id : null,
  );
  applyStudentSummaries(items, user, rows);
}
function applyStudentSummaries(items, user, rows) {
  const groups = Object.groupBy(rows, (p) => p.lesson_id);
  for (const lesson of items) {
    const participants = groups[lesson.id] || [];
    if (
      user.roles.some((r) => ["supervisor", "academic", "finance"].includes(r))
    )
      lesson.participant_student_ids = participants.map((p) => p.student_id);
    lesson.participants_summary = {
      count: participants.length,
      names: participants
        .slice(
          0,
          participants[0]?.format === "individual" ? participants.length : 3,
        )
        .map((p) => p.name),
      class_name: user.roles.includes("student")
        ? null
        : participants[0]?.class_name || null,
    };
  }
}
function templateStudentDto({ template_id, ...student }) {
  return withStudentSearchKeys(student);
}
function pickerDto(user, resource, row) {
  const result = dto(user, resource, row);
  if (resource === "students") return withStudentSearchKeys(result);
  if (resource === "schedule_enrollments" && result.student_name !== undefined)
    return withStudentSearchKeys(result, result.student_name);
  return result;
}
async function permittedRecord(r, user, resource, row) {
  if (!row) return null;
  let ownership = row;
  if (resource === "students" && user.roles.includes("student"))
    ownership = { ...row, student_id: row.id };
  if (resource === "teachers" && user.roles.includes("teacher"))
    ownership = { ...row, teacher_id: row.id };
  if (resource === "lessons" && user.roles.includes("student")) {
    const parts = await r.participantsFor(row.id);
    if (!parts.some((x) => x.student_id === user.student_id)) return null;
    ownership = { ...row, student_id: user.student_id };
  }
  return ownership;
}
async function businessApiOnce(
  req,
  env,
  tenant,
  user,
  policy,
  path,
  url,
  bodyReader,
) {
  const match = /^\/api\/data\/([a-z_]+)(?:\/([^/]+))?(?:\/(contact))?$/.exec(
    path,
  );
  if (!match || !resources[match[1]]) fail(404, "不存在");
  const resource = match[1],
    id = match[2],
    module = resources[resource],
    r = repo(env, tenant.id);
  const personal = user.roles.some((x) => ["teacher", "student"].includes(x));
  if (match[3]) {
    if (req.method !== "POST" || !["students", "teachers"].includes(resource))
      fail(404, "不存在");
    requireCan(user, policy, "accounts", "reveal_phone");
    await bodyReader(req);
    const row = await r.businessGet(resource, id);
    if (!row) fail(404, "不存在");
    await r.audit(
      user,
      resources[resource],
      "reveal_contact",
      id,
      "查看完整联系方式",
    );
    return {
      phone: await decrypt(env, row.phone_enc, tenant.id + ":phone"),
      parent_phone:
        resource === "students"
          ? await decrypt(env, row.parent_phone_enc, tenant.id + ":phone")
          : "",
    };
  }
  if (req.method === "GET") {
    if (id) {
      const { row, roster } = resource === "schedule_templates"
        ? await r.templateDetail(id)
        : { row: resource === "schedule_enrollments"
            ? await r.pickerRecord(resource, id) : await r.businessGet(resource, id) };
      const owned = await permittedRecord(r, user, resource, row);
      if (!owned || !can(user, policy, module, "read", owned))
        fail(404, "不存在");
      const result = pickerDto(user, resource, row);
      if (resource === "schedule_templates") result.students = roster.map(templateStudentDto);
      if (
        ["students", "teachers"].includes(resource) &&
        user.roles.some((role) =>
          ["supervisor", "academic", "finance"].includes(role),
        )
      ) {
        for (const [key, source] of [
          ["phone", "phone_enc"],
          ["parent_phone", "parent_phone_enc"],
        ]) {
          if (source === "parent_phone_enc" && resource !== "students")
            continue;
          const value = row[source]
            ? await decrypt(env, row[source], tenant.id + ":phone")
            : "";
          result[key] = value
            ? value.slice(0, 3) + "****" + value.slice(-4)
            : "";
        }
      }
      if (resource === "lessons") {
        if (row.source_course_id && can(user, policy, "promo", "read")) {
          const [meeting] = await r.promoMeetings([row.id]);
          if (meeting)
            ({
              meeting_no: result.meeting_no,
              meeting_url: result.meeting_url,
            } = meeting);
        }
        let parts = await r.participantsFor(id);
        if (user.roles.includes("student"))
          parts = parts.filter((x) => x.student_id === user.student_id);
        await r.primeReferences({ studentIds: parts.map((p) => p.student_id) });
        result.participants = await Promise.all(
          parts.map(async (p) => {
            const name = (await r.businessGet("students", p.student_id))?.name;
            return withStudentSearchKeys({
              id: p.id,
              student_id: p.student_id,
              student_name: name,
              attendance: p.attendance,
              version: p.version,
              deducted: p.deducted,
              makeup_for: p.makeup_for,
            }, name);
          }),
        );
      }
      return { record: result };
    }
    requireCan(
      user,
      policy,
      module,
      "read",
      personal
        ? {
            id: user.id,
            teacher_id: user.teacher_id,
            student_id: user.student_id,
          }
        : undefined,
    );
    const offset = integer(
        Number(url.searchParams.get("offset") || 0),
        "分页",
        0,
        1000000,
      ),
      { rows, total, roster } = personal
        ? { rows: await r.personalList(resource, user, offset) }
        : await r.businessPage(resource, offset, string(url.searchParams.get("q") || "", "搜索", 100, 0)),
      items = [],
      students = roster ? Object.groupBy(roster, (row) => row.template_id) : {};
    for (const row of rows) {
      const owned =
        personal && resource === "lessons" && user.roles.includes("student")
          ? { ...row, student_id: user.student_id }
          : await permittedRecord(r, user, resource, row);
      if (owned && can(user, policy, module, "read", owned)) {
        const item = pickerDto(user, resource, row);
        if (resource === "schedule_templates")
          item.students = (students[row.id] || []).map(templateStudentDto);
        items.push(item);
      }
    }
    if (resource === "lessons") await addStudentSummaries(r, items, user);
    return {
      items,
      total,
      next_offset: rows.length === 200 ? offset + 200 : null,
    };
  }
  const action =
    req.method === "POST"
      ? "create"
      : req.method === "PATCH"
        ? "update"
        : req.method === "DELETE"
          ? "delete"
          : null;
  if (!action) fail(404, "不存在");
  requireCan(user, policy, module, action);
  const d = await bodyReader(req),
    revision = await r.dataVersion(),
    old = id ? await r.businessGet(resource, id) : null;
  if (id && !old) fail(404, "不存在");
  if (
    old?.source_course_id ||
    (old && (await r.partnerManaged(resource, old.id)))
  )
    fail(403, "合作课次及专用资料由合作方维护，不可修改或销课");
  if ((req.method !== "POST" && !id) || (req.method === "POST" && id))
    fail(404, "不存在");
  if (old && version(d.version) !== old.version)
    fail(409, "记录已被修改，请刷新");
  if (resource === "lessons")
    await r.assertUnlocked(
      [old?.start_at?.slice(0, 7), d.start_at?.slice(0, 7)].filter(Boolean),
    );
  if (action === "delete") {
    if (resource === "lessons") {
      if (old.status !== "planned") fail(409, "请先撤销销课或解除关联");
      const parts = await r.participantsFor(old.id);
      if (parts.some((p) => p.deducted || p.makeup_for))
        fail(409, "课程仍有销课或补课关联");
      const changes = parts.map((p) => ({
        resource: "lesson_participants",
        previous: p,
        data: { ...p, deleted_at: now() },
      }));
      changes.push({
        resource,
        previous: old,
        data: { ...old, deleted_at: now() },
      });
      await r.commitBusiness(revision, changes, user, module, "delete");
    } else {
      if (await r.references(resource, id))
        fail(409, "已有业务或账号引用，请改为停用/归档");
      await r.commitBusiness(
        revision,
        [{ resource, previous: old, data: { ...old, deleted_at: now() } }],
        user,
        module,
        "delete",
      );
    }
    return { ok: true };
  }
  if (
    ["lessons", "schedule_templates"].includes(resource) &&
    (d.class_id ?? old?.class_id)
  ) {
    requireCan(user, policy, "classes", "read");
    const cls = await reference(r, "classes", d.class_id ?? old.class_id);
    const members = await r.classMembers(cls.id);
    if (!members.length || members.length > 200)
      fail(400, "班级名单为空或人数过多");
    d.class_id = cls.id;
    if (resource === "lessons") {
      for (const key of ["student_ids", "participants"])
        if (d[key] !== undefined) {
          if (!Array.isArray(d[key]) || d[key].length > 200)
            fail(400, "学员名单格式不正确");
          for (const input of d[key]) {
            const id = key === "student_ids" ? input : input?.student_id;
            if (
              typeof id !== "string" ||
              !members.some((m) => m.student_id === id)
            )
              fail(404, "不存在");
          }
        }

      if (
        d.start_at &&
        (d.start_at.slice(0, 10) < cls.date_from ||
          d.start_at.slice(0, 10) > cls.date_to)
      )
        fail(400, "课程不在班级有效日期内");
      if (d.participants) {
        const supplied = new Map(d.participants.map((p) => [p.student_id, p]));
        d.participants = members.map((m) => supplied.get(m.student_id) || { student_id: m.student_id });
      } else d.student_ids = members.map((p) => p.student_id);
    }
  }
  const merged = { ...old, ...d };
  const previous = resource === "lessons" && old ? await r.participantsFor(old.id) : [];
  const candidates = Array.isArray(d.participants)
    ? d.participants
    : Array.isArray(d.student_ids)
      ? d.student_ids.map((student_id) => ({ student_id }))
      : previous.map(({ student_id }) => ({ student_id }));
  await r.primeReferences({
    studentIds: [
      merged.student_id,
      ...candidates.filter(Boolean).map((x) => x.student_id),
    ],
    teacherIds: [merged.teacher_id, merged.assistant_id],
    locationIds: [merged.location_id],
    typeIds: [merged.course_type_id],
    categoryIds: [merged.category_id],
    templateIds: [merged.template_id],
    packageIds: [...candidates.filter(Boolean), ...previous].map((x) => x.package_id),
  });
  const row = await normalize(env, tenant.id, r, resource, d, old),
    changes = [{ resource, previous: old, data: row }];
  if (resource === "lessons") {
    if (old && old.status !== "planned") fail(409, "本阶段只允许编辑待上课程");
    if (
      previous.some(
        (p) => p.deducted || p.makeup_for || p.attendance !== "planned",
      )
    )
      fail(409, "请先撤销出勤并处理补课关联，再编辑课程");
    if (d.student_ids !== undefined && !Array.isArray(d.student_ids))
      fail(400, "学员列表格式不正确");
    const input = Array.isArray(d.participants)
      ? d.participants.map((p) => p && { ...p })
      : d.participants ?? candidates;
    const studentIds = await validateParticipants(r, row, input, previous);
    const snapshot = await r.scheduleWindow(
      row.start_at.slice(0, 10),
      nextDay(row.start_at.slice(0, 10)),
    );
    const found = await conflicts(r, row, studentIds, snapshot);
    if (found.length && !d.force) {
      return { conflicts: found, committed: false };
    }
    if (d.force !== undefined && typeof d.force !== "boolean")
      fail(400, "强制排课开关不正确");
    for (const part of previous)
      if (!studentIds.includes(part.student_id)) {
        if (part.deducted || part.makeup_for) fail(409, "参与记录仍有关联");
        changes.push({
          resource: "lesson_participants",
          previous: part,
          data: { ...part, deleted_at: now() },
        });
      }
    for (const p of input) {
      const prior = previous.find((x) => x.student_id === p.student_id);
      changes.push({
        resource: "lesson_participants",
        previous: prior,
        data: prior
          ? { ...prior, package_id: p.package_id }
          : {
              id: randomId("part"),
              lesson_id: row.id,
              student_id: p.student_id,
              attendance: "planned",
              deducted: 0,
              package_id: p.package_id || null,
              makeup_for: null,
              deleted_at: null,
            },
      });
    }
  }
  await r.commitBusiness(
    revision,
    changes,
    user,
    module,
    d.force ? "force_schedule" : action,
  );
  return { id: row.id, committed: true };
}
async function generateTemplatesOnce(req, env, tenant, user, policy, data) {
  requireCan(user, policy, "templates", "create");
  requireCan(user, policy, "lessons", "create");
  const r = repo(env, tenant.id),
    revision = await r.dataVersion(),
    from = day(data.from),
    to = day(data.to);
  if (to < from || (Date.parse(to) - Date.parse(from)) / 86400000 > 370)
    fail(400, "单次日期范围最多370天");
  const months = [];
  for (let date = from; date <= to; date = nextDay(date))
    if (!months.includes(date.slice(0, 7))) months.push(date.slice(0, 7));
  await r.assertUnlocked(months);
  const snapshot = await r.scheduleWindow(from, nextDay(to), true),
    existing = new Set(snapshot.lessons.filter((l) => l.template_id).map((l) => l.template_id + ":" + l.occurrence_date)),
    changes = [],
    extra = [],
    problems = [];
  let skipped = 0;
  const classId = data.class_id ?? null;
  if (classId !== null) {
    requireCan(user, policy, "classes", "read");
    await reference(r, "classes", classId);
  }
  const page = await r.generationTemplates(from, to, classId);
  if (page.length > 1000) fail(400, "模板过多，请分期生成");
  await r.primeReferences({ templateIds: page.map((x) => x.id), from, to });
  if (page.some((t) => t.class_id)) requireCan(user, policy, "classes", "read");
  const classRosters = await r.classRosterMap(
    page.map((t) => t.class_id).filter(Boolean),
  );
  const allEnrollments = [];
  for (const template of page)
    allEnrollments.push(
      ...(template.class_id
        ? (classRosters[template.class_id] || []).map((p) => ({
            ...p,
            date_from: template.date_from,
            date_to: template.date_to,
          }))
        : await r.enrollmentsFor(template.id)),
    );
  await r.primeReferences({
    studentIds: [...new Set(allEnrollments.map((x) => x.student_id))],
    teacherIds: [
      ...new Set(page.flatMap((x) => [x.teacher_id, x.assistant_id])),
    ],
    locationIds: [...new Set(page.map((x) => x.location_id))],
    typeIds: [...new Set(page.map((x) => x.course_type_id))],
  });
  {
    for (const template of page.filter((x) => x.active)) {
      await reference(r, "teachers", template.teacher_id);
      const enrollments = template.class_id
        ? (classRosters[template.class_id] || [])
            .filter((p) => p.class_status === "active")
            .map((p) => ({
              ...p,
              date_from:
                p.date_from > template.date_from
                  ? p.date_from
                  : template.date_from,
              date_to:
                p.date_to < template.date_to ? p.date_to : template.date_to,
            }))
        : await r.enrollmentsFor(template.id);
      if (enrollments.length > 1000) fail(400, "模板报名记录过多");
      for (let date = from; date <= to; date = nextDay(date)) {
        if (
          date < template.date_from ||
          date > template.date_to ||
          (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7 !==
            template.weekday
        )
          continue;
        if (existing.has(template.id + ":" + date)) {
          skipped++;
          continue;
        }
        const participants = enrollments
          .filter((e) => e.date_from <= date && e.date_to >= date)
          .map((e) => ({ student_id: e.student_id }));
        if (!participants.length) continue;
        const row = await normalize(
          env,
          tenant.id,
          r,
          "lessons",
          {
            ...template,
            id: undefined,
            start_at: date + "T" + template.start_time,
          },
          null,
        );
        row.template_id = template.id;
        row.occurrence_date = date;
        const students = await validateParticipants(r, row, participants);
        const found = await conflicts(r, row, students, snapshot, extra);
        problems.push(
          ...found.map((x) => ({ ...x, date, template_id: template.id })),
        );
        extra.push({ ...row, student_ids: students });
        changes.push({ resource: "lessons", data: row });
        for (const p of participants)
          changes.push({
            resource: "lesson_participants",
            data: {
              id: randomId("part"),
              lesson_id: row.id,
              student_id: p.student_id,
              attendance: "planned",
              deducted: 0,
              package_id: null,
              makeup_for: null,
              deleted_at: null,
            },
          });
        if (changes.length > 10000)
          fail(400, "本次课程及参与记录超过10000条，请缩小生成范围");
        if (extra.length > 200) fail(400, "单次最多生成200节，请缩小范围");
      }
    }
  }
  if (data.preview === true)
    return {
      committed: false,
      preview: true,
      items: extra.map((l) => ({
        start_at: l.start_at,
        duration: l.duration,
        teacher_id: l.teacher_id,
        course_type_id: l.course_type_id,
        location_id: l.location_id,
      })),
      conflicts: problems,
      generated: extra.length,
      skipped,
    };
  if (problems.length)
    return { committed: false, conflicts: problems, generated: 0, skipped };
  if (changes.length)
    await r.commitBusiness(revision, changes, user, "templates", "generate");
  return { committed: true, generated: extra.length, skipped };
}

function requireScheduleRead(user, policy) {
  requireCan(user, policy, "schedule", "read", {
    id: user.id, teacher_id: user.teacher_id, student_id: user.student_id,
  });
}
function requireStudentScheduleScope(user, policy, studentId) {
  if (
    (user.roles.includes("student") && studentId !== user.student_id) ||
    !can(user, policy, "students", "read", { student_id: studentId, teacher_id: user.teacher_id })
  )
    fail(404, "不存在");
}
export async function fixedRulesView(env, tenant, user, policy, studentId) {
  requireScheduleRead(user, policy);
  requireStudentScheduleScope(user, policy, studentId);
  const teacher = user.roles.includes("teacher") ? user.teacher_id : null;
  const date = new Date(now() + 28800000).toISOString().slice(0, 10);
  const rows = await repo(env, tenant.id).studentFixedRules(studentId, teacher, date);
  return { items: rows.map((row) => ({ ...row, is_group: row.member_count > 1 })) };
}

export async function scheduleView(env, tenant, user, policy, url) {
  const from = day(url.searchParams.get("from")),
    to = day(url.searchParams.get("to"));
  if (to <= from || (Date.parse(to) - Date.parse(from)) / 86400000 > 31)
    fail(400, "查询范围须为1至31天");
  requireScheduleRead(user, policy);
  const studentId = url.searchParams.get("student_id") || null;
  if (studentId) requireStudentScheduleScope(user, policy, studentId);
  const offset = integer(
      Number(url.searchParams.get("offset") || 0),
      "分页",
      0,
      1000000,
    ),
    r = repo(env, tenant.id),
    { rows, participants, meetings } = await r.scheduleWeek(
      from, to, offset, user, studentId, can(user, policy, "promo", "read"),
    );
  const items = [];
  for (const row of rows) {
    const owned = user.roles.includes("student")
      ? { ...row, student_id: user.student_id }
      : await permittedRecord(r, user, "lessons", row);
    if (owned && can(user, policy, "schedule", "read", owned)) {
      const item = dto(user, "lessons", row);
      if (user.roles.includes("teacher") && studentId && can(user, policy, "attendance", "read", owned))
        item.own_attendance = row.own_attendance;
      if (!can(user, policy, "comments", "read", owned))
        for (const key of ["public_text", "homework", "private_comment"])
          delete item[key];
      items.push(item);
    }
  }
  const byLesson = new Map(meetings.map((meeting) => [meeting.id, meeting]));
  for (const row of items)
    if (byLesson.has(row.id)) Object.assign(row, byLesson.get(row.id));
  applyStudentSummaries(items, user, participants);
  return { items, next_offset: rows.length === 200 ? offset + 200 : null };
}

export async function reorderBusiness(env, tenant, user, policy, data) {
  const resource = data.resource;
  if (
    ![
      "students",
      "teachers",
      "course_categories",
      "course_types",
      "locations",
    ].includes(resource)
  )
    fail(400, "不支持此排序");
  requireCan(user, policy, resources[resource], "update");
  if (
    !Array.isArray(data.records) ||
    !data.records.length ||
    data.records.length > 200 ||
    data.records.some(
      (x) => !x || typeof x !== "object" || typeof x.id !== "string",
    ) ||
    new Set(data.records.map((x) => x.id)).size !== data.records.length
  )
    fail(400, "排序列表不正确");
  const r = repo(env, tenant.id),
    revision = await r.dataVersion(),
    changes = [];
  const offset = integer(data.offset ?? 0, "排序位置", 0, 1000000);
  await r.primeReferences({
    studentIds: resource === "students" ? data.records.map((x) => x.id) : [],
    teacherIds: resource === "teachers" ? data.records.map((x) => x.id) : [],
    locationIds: resource === "locations" ? data.records.map((x) => x.id) : [],
    typeIds: resource === "course_types" ? data.records.map((x) => x.id) : [],
    categoryIds:
      resource === "course_categories" ? data.records.map((x) => x.id) : [],
  });
  for (let index = 0; index < data.records.length; index++) {
    const input = data.records[index],
      old = await r.businessGet(resource, input.id);
    if (!old) fail(404, "不存在");
    if (version(input.version) !== old.version) fail(409, "记录已修改，请刷新");
    changes.push({
      resource,
      previous: old,
      data: { ...old, sort_order: offset + index },
    });
  }
  await r.commitBusiness(
    revision,
    changes,
    user,
    resources[resource],
    "reorder",
  );
  return { ok: true };
}

export async function businessApi(
  req,
  env,
  tenant,
  user,
  policy,
  path,
  url,
  bodyReader,
) {
  let cached;
  const read = async (request) => {
    if (cached === undefined) cached = await bodyReader(request);
    return cached;
  };
  for (let attempt = 0; ; attempt++) {
    try {
      return await businessApiOnce(
        req,
        env,
        tenant,
        user,
        policy,
        path,
        url,
        read,
      );
    } catch (e) {
      if (e.code !== "SCHEDULE_RETRY" || attempt >= 2) throw e;
    }
  }
}
export async function generateTemplates(req, env, tenant, user, policy, data) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await generateTemplatesOnce(req, env, tenant, user, policy, data);
    } catch (e) {
      if (e.code !== "SCHEDULE_RETRY" || attempt >= 2) throw e;
    }
  }
}

export async function normalizeMakeupLesson(
  env,
  tenant,
  r,
  user,
  policy,
  data,
) {
  requireCan(user, policy, "lessons", "create");
  await r.primeReferences({
    studentIds: data.student_ids,
    teacherIds: [data.teacher_id, data.assistant_id],
    typeIds: [data.course_type_id],
    locationIds: [data.location_id],
  });
  const row = await normalize(env, tenant.id, r, "lessons", data, null),
    students = await validateParticipants(
      r,
      row,
      data.student_ids.map((student_id) => ({ student_id })),
    );
  return { row, students };
}

export async function prepareMakeupLesson(env, tenant, r, user, policy, data) {
  const { row, students } = await normalizeMakeupLesson(
    env,
    tenant,
    r,
    user,
    policy,
    data,
  );
  const date = row.start_at.slice(0, 10);
  const snapshot = await r.scheduleWindow(date, nextDay(date));
  const found = await conflicts(r, row, students, snapshot);
  return { row, conflicts: data.force === true ? [] : found, snapshot };
}

export async function prepareStudent(env, tenantId, r, data) {
  return normalize(env, tenantId, r, "students", data, null);
}
export async function prepareTeacher(env, tenantId, r, data) {
  return normalize(env, tenantId, r, "teachers", data, null);
}
