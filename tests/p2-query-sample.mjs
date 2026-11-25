import assert from "node:assert/strict";
import { fixture } from "./support.mjs";
import { sampleClock, scheduleRequest, studentScheduleSample, weekPath } from "./fixtures-student-schedule.mjs";

const originalNow = Date.now;
Date.now = () => sampleClock;
let f;
try {
  f = await fixture();
  const s = await studentScheduleSample(f);
  const base = {
    students: "data/students",
    student: "data/students/" + s.student,
    c2_students: "c2/students?q=唐",
    search: "search?q=唐",
    templates: "data/schedule_templates",
    template: "data/schedule_templates/" + s.fixed,
    enrollments: "data/schedule_enrollments",
    enrollment: "data/schedule_enrollments/" + s.enrolled,
    lesson: "data/lessons/" + s.original,
    class: "tools/classes/" + s.cls,
    class_members: "tools/class_members?class_id=" + s.cls,
    class_member: "tools/class_members/" + s.classMember,
    week: weekPath,
    student_week: weekPath + "&student_id=" + s.student,
    week_empty: "schedule?from=2026-12-01&to=2026-12-08",
    fixed_rules: "students/" + s.student + "/fixed-rules",
  };
  base.student_week_empty = base.week_empty + "&student_id=" + s.student;
  const samples = {}, examples = {};
  for (const [key, path] of Object.entries(base)) {
    const { status, text, timing, trips, body } = await scheduleRequest(s, path);
    assert.ok(status === 200 || (key === "fixed_rules" && status === 404), text);
    samples[key] = { path, status, trips, timing };
    if (key === "student") {
      const { id, name, search_keys } = body.record;
      examples.student = { id, name, search_keys };
    }
    if (key === "template") examples.template_students = body.record.students;
    if (key === "class") examples.class_members = body.members;
    if (key === "fixed_rules" && status === 200) examples.fixed_rules = body;
    if (key === "student_week") {
      const fields = ["id", "start_at", "status", "own_attendance", "duration", "course_name", "teacher_name", "template_id"];
      examples.student_week = { ...body, items: body.items.map((item) =>
        Object.fromEntries(fields.map((field) => [field, item[field]]))) };
    }
  }
  console.log(JSON.stringify({ samples, examples }, null, 2));
} finally {
  f?.restore();
  Date.now = originalNow;
}
