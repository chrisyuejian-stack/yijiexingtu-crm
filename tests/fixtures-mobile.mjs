import assert from "node:assert/strict";
import {
  setup,
  pack,
  lesson,
  request,
  mutate,
  accountToken,
} from "./fixtures-credit.mjs";
import { b64, bytes, sha } from "../src/server/core.js";
export const MOBILE_NOW = Date.parse("2026-11-10T10:00+08:00");
export async function teacherToken(s, id = s.teacher) {
  const made = await s.call("accounts", "POST", {
    name: "手机教师",
    phone: "137" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0"),
    roles: ["teacher"],
    teacher_id: id,
  });
  assert.equal(made.status, 201, made.text);
  s.f.db.raw
    .prepare("UPDATE users SET must_change=0 WHERE tenant_id=? AND id=?")
    .run(s.t.id, made.body.id);
  const token = b64(bytes(32));
  await s.r.createSession(await sha(token), await s.r.user(made.body.id), {
    ip: "test",
    ua: "mobile",
  });
  return { token, id: made.body.id };
}
export async function mobileSetup(f, count = 2, suffix = "a") {
  const s = { ...(await setup(f, count, suffix)), f };
  for (const student of s.students) await pack(s, student, 20);
  s.lid = await lesson(s, "2026-11-10T10:00");
  s.teacherAccount = await teacherToken(s);
  s.student = await accountToken(s, ["student"], s.students[0]);
  await request(s, "settings", "PUT", {
    key: "teacher_self_checkin",
    value: true,
  });
  return s;
}
export async function review(s, id = s.lid, token = s.teacherAccount.token) {
  return request(s, "lessons/" + id + "/review", "GET", undefined, token);
}
export async function proposal(
  s,
  {
    id = s.lid,
    kind = "attendance",
    token = s.teacherAccount.token,
    text = "公共内容",
    comment = "个人点评",
    attendance = "attended",
    op,
    extra = {},
  } = {},
) {
  const res = await review(s, id, token);
  assert.equal(res.status, 200, res.text);
  const v = res.body;
  return mutate(
    s,
    "lessons/" + id + "/review",
    {
      kind,
      previous_id: v.submission?.id || null,
      previous_version: v.submission?.version,
      comment_fingerprint: v.comment_fingerprint,
      public_text: text,
      homework: "练习作业",
      people: v.participants.map((p) => ({
        participant_id: p.id,
        student_id: p.student_id,
        attendance,
        comment: comment + p.name,
      })),
      ...(op ? { operation_id: op } : {}),
      ...extra,
    },
    "POST",
    token,
  );
}
export async function decide(
  s,
  id,
  action = "confirm",
  version = 1,
  token = s.token,
) {
  return mutate(
    s,
    "submissions/" + id + "/" + action,
    { version, ...(action === "return" ? { reason: "请核对出勤" } : {}) },
    "POST",
    token,
  );
}
