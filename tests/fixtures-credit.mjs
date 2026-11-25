import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fixture } from "./support.mjs";
import { schoolFixture } from "./fixtures-school.mjs";
import { randomId, bytes, b64, sha } from "../src/server/core.js";
import { repo } from "../src/server/repo.js";
export async function setup(f, count = 2, suffix = "a") {
  const s = await schoolFixture(f, suffix),
    create = async (resource, data) => {
      const r = await s.call("data/" + resource, "POST", data);
      assert.equal(r.status, 200, r.text);
      return r.body.id;
    };
  const teacher = await create("teachers", { name: "教师" }),
    room = await create("locations", { name: "教室", capacity: 40 }),
    cat = await create("course_categories", { name: "基础" }),
    type = await create("course_types", {
      name: "班课",
      category_id: cat,
      format: "group",
      capacity: 40,
    }),
    students = [];
  for (let i = 0; i < count; i++)
    students.push(await create("students", { name: "学员" + i }));
  return { ...s, teacher, room, cat, type, students, create };
}
export async function request(s, path, method = "GET", data, token = s.token) {
  const response = await s.f.request(
      "https://school.test/" + s.t.slug + "/api/" + path,
      {
        method,
        headers: {
          Origin: "https://school.test",
          Cookie: "channel_session=" + token,
          "Content-Type": "application/json",
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      },
    ),
    text = await response.text();
  const body = text.startsWith("{") ? JSON.parse(text) : {};
  return {
    status: response.status,
    body,
    text,
    queries: Number(response.headers.get("x-test-d1-queries")),
    statements: Number(response.headers.get("x-test-d1-statements")),
  };
}
export async function mutate(
  s,
  path,
  data = {},
  method = "POST",
  token = s.token,
) {
  return request(
    s,
    path,
    method,
    { operation_id: randomId("op"), ...data },
    token,
  );
}
export async function pack(
  s,
  student = s.students[0],
  units = 10,
  type = s.type,
) {
  const result = await mutate(s, "credits/packages", {
    student_id: student,
    course_type_id: type,
    units_total: units,
    unit_price: 100,
    purchase_date: new Date(
      Date.UTC(
        2026,
        0,
        1 + (s._packageSequence = (s._packageSequence || 0) + 1),
      ),
    )
      .toISOString()
      .slice(0, 10),
  });
  assert.equal(result.status, 200, result.text);
  return result.body.id;
}
export async function lesson(
  s,
  date = "2026-11-10T09:00",
  students = s.students,
) {
  const result = await s.call("data/lessons", "POST", {
    start_at: date,
    teacher_id: s.teacher,
    course_type_id: s.type,
    location_id: s.room,
    duration: 45,
    units: 1,
    student_ids: students,
  });
  assert.equal(result.body.committed, true, result.text);
  return result.body.id;
}
export async function details(s, id) {
  return (await request(s, "data/lessons/" + id)).body.record;
}
export async function status(s, id, value, op) {
  const d = await details(s, id);
  return mutate(s, "credits/lessons/" + id + "/status", {
    lesson_version: d.version,
    status: value,
    ...(op ? { operation_id: op } : {}),
  });
}
export async function balance(s, id) {
  return (await request(s, "credits/packages/" + id)).body.record.balance;
}
export async function assertInvariant(s) {
  const rows = s.f.db.raw
    .prepare(
      "SELECT p.id,ROUND(COALESCE(SUM(t.delta),0),2) balance FROM packages p LEFT JOIN package_transactions t ON t.tenant_id=p.tenant_id AND t.package_id=p.id WHERE p.tenant_id=? GROUP BY p.id",
    )
    .all(s.t.id);
  for (const row of rows) {
    assert.ok(row.balance >= -0.001);
    assert.equal(await balance(s, row.id), row.balance);
  }
}
export async function accountToken(s, roles, studentId = null) {
  const r = await s.call("accounts", "POST", {
    name: "验收账号",
    phone: "139" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0"),
    roles,
    ...(studentId ? { student_id: studentId } : {}),
  });
  assert.equal(r.status, 201, r.text);
  s.f.db.raw
    .prepare("UPDATE users SET must_change=0 WHERE tenant_id=?")
    .run(s.t.id);
  const user = await s.r.user(r.body.id),
    token = b64(bytes(32));
  await s.r.createSession(await sha(token), user, { ip: "test", ua: "credit" });
  return { token, id: user.id };
}
