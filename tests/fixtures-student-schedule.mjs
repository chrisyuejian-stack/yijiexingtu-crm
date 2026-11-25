import assert from "node:assert/strict";
import { b64, bytes, sha } from "../src/server/core.js";
import { details, lesson, mutate, setup, status } from "./fixtures-credit.mjs";

export const weekPath = "schedule?from=2026-11-09&to=2026-11-16";
export const sampleClock = Date.parse("2026-11-10T00:10:00+08:00");

export async function studentScheduleSample(f) {
  const s = { ...await setup(f, 0, "p2"), f };
  const student = await s.create("students", { name: "唐一欣" });
  const peer = await s.create("students", { name: "单晓" });
  const removed = await s.create("students", { name: "Emily Zhang" });
  const literal = await s.create("students", { name: "<b>张</b>三&<i>测试</i>" });
  const otherTeacher = await s.create("teachers", { name: "另一位老师" });
  const refs = { teacher_id: s.teacher, course_type_id: s.type, location_id: s.room };
  const range = { date_from: "2026-11-01", date_to: "2026-11-30" };
  const templateData = { ...refs, ...range, duration: 45, units: 1, weekday: 0, start_time: "09:00" };
  const fixed = await s.create("schedule_templates", templateData);
  const enrollment = (template, studentId, period = range) => s.create("schedule_enrollments", {
    template_id: template, student_id: studentId, ...period,
  });
  const enrolled = await enrollment(fixed, student, { ...range, date_from: "2026-11-09" });
  await enrollment(fixed, peer);
  await enrollment(fixed, removed, { date_from: "2026-11-01", date_to: "2026-11-08" });
  const generated = await s.call("templates/generate", "POST", { from: "2026-11-09", to: "2026-11-09" });
  assert.equal(generated.body.generated, 1, generated.text);
  const original = (await s.call(weekPath)).body.items[0].id;
  const initial = await details(s, original);
  const attendance = await mutate(s, "credits/lessons/" + original + "/attendance", {
    lesson_version: initial.version,
    participants: initial.participants.map((p) => ({
      id: p.id, version: p.version, attendance: p.student_id === student ? "student_leave" : "attended",
    })),
  });
  assert.equal(attendance.status, 200, attendance.text);
  const left = (await details(s, original)).participants.find((p) => p.student_id === student);
  const makeup = await mutate(s, "credits/makeups", {
    original_participant_id: left.id,
    new_lesson: { ...refs, start_at: "2026-11-12T09:00", duration: 45, units: 1 },
  });
  assert.equal(makeup.status, 200, makeup.text);
  const cancelled = await lesson(s, "2026-11-13T09:00", [student]);
  assert.equal((await status(s, cancelled, "cancelled")).status, 200);
  const drop = await lesson(s, "2026-11-14T09:00", [student, peer]);
  const patch = await s.call("data/lessons/" + drop, "PATCH", { version: 1, student_ids: [peer] });
  assert.equal(patch.body.committed, true, patch.text);
  const foreignLesson = await lesson({ ...s, teacher: otherTeacher }, "2026-11-11T09:00", [student]);
  const classResult = await s.call("tools/classes", "POST", { name: "周末班", ...refs, ...range });
  assert.equal(classResult.status, 200, classResult.text);
  const cls = classResult.body.id;
  const classMember = await s.call("tools/class_members", "POST", { class_id: cls, student_id: student });
  assert.equal(classMember.status, 200, classMember.text);
  const classFixed = await s.create("schedule_templates", { ...templateData, weekday: 4, start_time: "16:00", class_id: cls });
  const otherFixed = await s.create("schedule_templates", { ...templateData, weekday: 1, teacher_id: otherTeacher });
  await enrollment(otherFixed, student, { ...range, date_from: "2026-11-10" });
  const disabled = await s.create("schedule_templates", { ...templateData, start_time: "13:00" });
  await enrollment(disabled, student);
  const disable = await s.call("data/schedule_templates/" + disabled, "PATCH", { version: 1, active: false });
  assert.equal(disable.status, 200, disable.text);
  const expired = await s.create("schedule_templates", { ...templateData, date_to: "2026-11-08", start_time: "14:00" });
  await enrollment(expired, student, { ...range, date_to: "2026-11-08" });
  return {
    ...s, student, peer, removed, literal, otherTeacher, original, makeup: makeup.body.lesson_id,
    cancelled, drop, foreignLesson, fixed, otherFixed, classFixed, enrolled, cls, classMember: classMember.body.id,
  };
}

export async function personalToken(s, role, id, phone) {
  const result = await s.call("accounts", "POST", {
    name: "课表验收", roles: [role], phone, [role + "_id"]: id,
  });
  assert.equal(result.status, 201, result.text);
  s.f.db.raw.prepare("UPDATE users SET must_change=0 WHERE tenant_id=? AND id=?").run(s.t.id, result.body.id);
  const user = await s.r.user(result.body.id), token = b64(bytes(32));
  await s.r.createSession(await sha(token), user, { ip: "test", ua: "p2" });
  return token;
}

export async function scheduleRequest(s, path, token = s.token) {
  const response = await s.f.request("https://school.test/" + s.t.slug + "/api/" + path, {
    headers: token ? { Cookie: "channel_session=" + token } : {},
  });
  const text = await response.text();
  const timing = response.headers.get("server-timing");
  const trips = Number(/\bdb;dur=[\d.]+;desc="(\d+)"/.exec(timing)?.[1]);
  assert.equal(trips, Number(response.headers.get("x-test-d1-queries")), path);
  return { status: response.status, text, timing, trips, body: text.startsWith("{") ? JSON.parse(text) : null };
}
