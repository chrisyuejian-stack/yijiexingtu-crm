import { requireCan } from "./accounts.js";
import { fail, now } from "./core.js";
import {
  day,
  nextDay,
  normalizeMakeupLesson,
  occupiesSchedule,
  prepareMakeupLesson,
  scheduleConflicts,
} from "./scheduling.js";

const reasons = [
  "same_time",
  "adjacent_after",
  "adjacent_before",
  "student_usual",
  "teacher_usual",
];
const weekdays = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const weekday = (date) => new Date(date + "T12:00:00Z").getUTCDay() || 7;
const minute = (time) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clock = (minutes) =>
  String(Math.floor(minutes / 60)).padStart(2, "0") +
  ":" +
  String(minutes % 60).padStart(2, "0");
const startMinute = (lesson) => minute(lesson.start_at.slice(11, 16));
const at = (date, time) => date + "T" + clock(time) + "+08:00";

function usual(history) {
  if (!history.length)
    return Array.from({ length: 7 }, (_, i) => ({
      weekday: i + 1,
      from: "08:00",
      to: "21:00",
      starts: [],
    }));
  const groups = Object.groupBy(history, (row) =>
    weekday(row.start_at.slice(0, 10)),
  );
  return Object.entries(groups)
    .filter(([, rows]) => rows.length >= 2)
    .map(([key, rows]) => ({
      weekday: Number(key),
      from: clock(Math.min(...rows.map(startMinute))),
      to: clock(
        Math.max(...rows.map((row) => startMinute(row) + row.duration)),
      ),
      starts: [...new Set(rows.map(startMinute))].sort((a, b) => a - b),
    }));
}
const windows = (rows) => rows.map(({ starts, ...row }) => row);

function summarize(original, teacher, room, course) {
  return {
    start_at: original.start_at,
    duration: original.duration,
    teacher_id: original.teacher_id,
    teacher_name: teacher?.name || "原课教师",
    location_id: original.location_id,
    location_name: original.mode === "online" ? "线上课" : (room?.name ?? null),
    course_name: course?.name || "原课程",
  };
}

function candidateData(original, student, start_at, changes = {}) {
  return {
    start_at,
    duration: original.duration,
    teacher_id: original.teacher_id,
    assistant_id: original.assistant_id,
    location_id: original.location_id,
    course_type_id: original.course_type_id,
    mode: original.mode,
    units: original.units,
    student_ids: [student],
    ...changes,
  };
}

function recommendations(
  row,
  student,
  snapshot,
  blocks,
  from,
  original,
  teacher,
  teacherUsual,
  studentUsual,
) {
  const byDay = Object.groupBy(snapshot.lessons.filter(occupiesSchedule), (x) =>
    x.start_at.slice(0, 10),
  );
  const found = [];
  for (let i = 0; i < 14; i++) {
    const date = nextDay(from, i);
    const wd = weekday(date),
      daily = byDay[date] || [];
    const usualTime = teacherUsual.find((x) => x.weekday === wd);
    const time = startMinute(original);
    const candidates = new Map();
    const add = (start, reason, reason_text) => {
      if (start < 0 || start + row.duration > 1440 || candidates.has(start))
        return;
      if (
        reason !== "same_time" &&
        (!usualTime ||
          start < minute(usualTime.from) ||
          start + row.duration > minute(usualTime.to))
      )
        return;
      candidates.set(start, { date, start, reason, reason_text });
    };
    if (wd === weekday(original.start_at.slice(0, 10))) {
      add(
        time,
        "same_time",
        "与原课同一时间（" + weekdays[wd] + " " + clock(time) + "）",
      );
    }
    const teacherLessons = daily.filter(
      (lesson) =>
        lesson.teacher_id === row.teacher_id ||
        lesson.assistant_id === row.teacher_id,
    );
    for (const lesson of teacherLessons)
      add(
        startMinute(lesson) + lesson.duration,
        "adjacent_after",
        "接在" + teacher + " " + clock(startMinute(lesson)) + " 的课之后",
      );
    for (const lesson of teacherLessons)
      add(
        startMinute(lesson) - row.duration,
        "adjacent_before",
        "接在" + teacher + " " + clock(startMinute(lesson)) + " 的课之前",
      );
    for (const window of [
      ...studentUsual.filter((x) => x.weekday === wd),
      ...studentUsual.filter((x) => x.weekday !== wd),
    ])
      for (const start of window.starts)
        add(
          start,
          "student_usual",
          window.weekday === wd
            ? "学员常上课的时刻（同星期）"
            : "学员其他日期常上课的时刻",
        );
    if (usualTime)
      for (
        let start = Math.ceil(minute(usualTime.from) / 15) * 15;
        start + row.duration <= minute(usualTime.to);
        start += 15
      )
        add(start, "teacher_usual", "在教师常用时段内");
    for (const candidate of candidates.values()) {
      const lesson = { ...row, start_at: at(date, candidate.start) };
      if (
        !scheduleConflicts(
          lesson,
          [student],
          { lessons: daily, participants: [] },
          blocks,
        ).length
      )
        found.push(candidate);
    }
  }
  const order = (a, b) =>
    reasons.indexOf(a.reason) - reasons.indexOf(b.reason) ||
    a.date.localeCompare(b.date);
  found.sort(order);
  const picked = [],
    daily = new Map();
  function pick(candidate) {
    const starts = daily.get(candidate.date) || [];
    if (
      starts.length === 2 ||
      starts.some((start) => Math.abs(start - candidate.start) < 60)
    )
      return;
    starts.push(candidate.start);
    daily.set(candidate.date, starts);
    picked.push(candidate);
  }
  for (const candidate of found) {
    if (daily.size === 3) break;
    if (!daily.has(candidate.date)) pick(candidate);
  }
  for (const candidate of found) {
    if (picked.length === 8) break;
    pick(candidate);
  }
  return picked.sort(order).map(({ date, start, reason, reason_text }) => ({
    start_at: at(date, start),
    duration: row.duration,
    reason,
    reason_text,
    teacher_id: row.teacher_id,
    location_id: row.location_id,
  }));
}

function busySlots(original, snapshot, blocks, date) {
  const busy = [];
  const teachers = [original.teacher_id, original.assistant_id].filter(Boolean);
  for (const lesson of snapshot.lessons.filter(occupiesSchedule)) {
    const from = lesson.start_at.slice(11, 16);
    const to = clock(startMinute(lesson) + lesson.duration);
    const course = lesson.course_name || "课程";
    const ownLabel = course + " · " + (lesson.teacher_name || "教师");
    if (
      [lesson.teacher_id, lesson.assistant_id].some((id) =>
        teachers.includes(id),
      )
    )
      busy.push({
        who: "teacher",
        from,
        to,
        label: lesson.own ? ownLabel : course,
      });
    if (lesson.own) busy.push({ who: "student", from, to, label: ownLabel });
    if (
      original.mode !== "online" &&
      lesson.mode !== "online" &&
      original.location_id &&
      lesson.location_id === original.location_id
    )
      busy.push({
        who: "room",
        from,
        to,
        label: lesson.own ? ownLabel : course,
      });
  }
  for (const block of blocks)
    if (block.weekday === weekday(date) - 1)
      busy.push({
        who: "block",
        from: block.start_time,
        to: block.end_time,
        label: block.label ? "学员不可排（" + block.label + "）" : "学员不可排",
      });
  return busy.sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );
}

async function explainConflicts(r, row, snapshot, conflicts) {
  const teacher = await r.businessGet("teachers", row.teacher_id);
  const assistant = row.assistant_id
    ? await r.businessGet("teachers", row.assistant_id)
    : null;
  const room = row.location_id
    ? await r.businessGet("locations", row.location_id)
    : null;
  const lessons = new Map(
    snapshot.lessons.map((lesson) => [lesson.id, lesson]),
  );
  return conflicts.flatMap((conflict) => {
    if (!conflict.lesson_id)
      return [{ who: "block", text: "学员该时段不可排" }];
    const lesson = lessons.get(conflict.lesson_id);
    const span =
      lesson.start_at.slice(11, 16) +
      "–" +
      clock(startMinute(lesson) + lesson.duration);
    const primary = [lesson.teacher_id, lesson.assistant_id].includes(
      row.teacher_id,
    );
    return conflict.reasons.map((reason) => {
      if (reason === "教师")
        return {
          who: "teacher",
          text:
            (primary ? teacher?.name : assistant?.name) +
            " " +
            span +
            " 已有课",
        };
      if (reason === "教室")
        return {
          who: "room",
          text: (room?.name || "教室") + " " + span + " 已占用",
        };
      return { who: "student", text: "学员 " + span + " 已有课" };
    });
  });
}

export async function makeupPlanning(
  req,
  env,
  tenant,
  r,
  user,
  policy,
  match,
  url,
  today,
  readBody,
) {
  const [, id, action] = match;
  if (req.method !== (action === "check" ? "POST" : "GET")) fail(404, "不存在");
  requireCan(user, policy, "attendance", "create");
  requireCan(user, policy, "lessons", "create");
  const part = await r.businessGet("lesson_participants", id);
  if (!part) fail(404, "不存在");
  const original = await r.businessGet("lessons", part.lesson_id);
  if (!original || original.source_course_id) fail(404, "不存在");
  if (part.makeup_for) fail(400, "不能把补课再次作为原课");
  const student = part.student_id;
  if (action === "check") {
    const d = await readBody(req);
    if (typeof d.start_at !== "string") fail(400, "课程时间格式不正确");
    const location =
      d.location_id === undefined ? original.location_id : d.location_id;
    const { row, snapshot, conflicts } = await prepareMakeupLesson(
      env,
      tenant,
      r,
      user,
      policy,
      candidateData(original, student, d.start_at, {
        teacher_id:
          d.teacher_id === undefined ? original.teacher_id : d.teacher_id,
        location_id: location,
        mode: location !== null ? "offline" : original.mode,
        duration: d.duration === undefined ? original.duration : d.duration,
      }),
    );
    return {
      ok: conflicts.length === 0,
      conflicts: conflicts.length
        ? await explainConflicts(r, row, snapshot, conflicts)
        : [],
    };
  }
  const tomorrow = nextDay(today);
  const selected =
    action === "day" ? day(url.searchParams.get("date")) : tomorrow;
  if (selected < tomorrow || selected > nextDay(today, 31))
    fail(400, "日期须在明天起31天内");
  const to = nextDay(selected, action === "day" ? 1 : 14);
  if (action === "day") await r.primeReferences({ studentIds: [student] });
  const normalized =
    action === "suggestions"
      ? await normalizeMakeupLesson(
          env,
          tenant,
          r,
          user,
          policy,
          candidateData(original, student, at(tomorrow, startMinute(original))),
        )
      : null;
  const snapshot = await r.makeupSchedule({
    teacher: original.teacher_id,
    assistant: original.assistant_id,
    room: original.location_id,
    student,
    from: selected,
    to,
    historyFrom: nextDay(today, -56),
    historyTo: tomorrow,
    at: now(),
  });
  const teacherUsual = usual(snapshot.history.filter((row) => row.teacher));
  const blocks = await r.blocksFor(student);
  if (action === "day") {
    const window = teacherUsual.find(
      (row) => row.weekday === weekday(selected),
    );
    return {
      date: selected,
      teacher_usual: window ? { from: window.from, to: window.to } : null,
      busy: busySlots(original, snapshot, blocks, selected),
    };
  }
  const room = original.location_id
    ? await r.businessGet("locations", original.location_id)
    : null;
  const teacher = await r.businessGet("teachers", original.teacher_id);
  const course = await r.businessGet("course_types", original.course_type_id);
  const studentUsual = usual(snapshot.history.filter((row) => row.own));
  const context = {
    original: summarize(original, teacher, room, course),
    teacher_usual: windows(teacherUsual),
    student_usual: windows(studentUsual),
    window: { from: selected, to: nextDay(to, -1) },
  };
  return {
    items: recommendations(
      normalized.row,
      student,
      snapshot,
      new Map([[student, blocks]]),
      selected,
      original,
      context.original.teacher_name,
      teacherUsual,
      studentUsual,
    ),
    context,
  };
}
