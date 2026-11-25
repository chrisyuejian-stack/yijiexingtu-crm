import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./support.mjs";
import { setup, request, accountToken, pack } from "./fixtures-credit.mjs";
import { randomId } from "../src/server/core.js";
import { mkdir, writeFile } from "node:fs/promises";
const ok = async (r, code = 200) => {
  assert.equal(r.status, code, r.text);
  assert.ok(r.queries <= 40);
  return r.body;
};
test("第六阶段：班级、跟进、线索、推荐均校验同机构关联；招生转正原子建档；名单、金额无个人泄漏", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 2)), f },
      other = { ...(await setup(f, 1, "b")), f };
    const cls = {
      name: "集训班",
      teacher_id: s.teacher,
      course_type_id: s.type,
      location_id: s.room,
      date_from: "2026-11-01",
      date_to: "2026-12-31",
    };
    const c = await ok(await request(s, "tools/classes", "POST", cls));
    await ok(
      await request(s, "tools/class_members", "POST", {
        class_id: c.id,
        student_id: other.students[0],
      }),
      404,
    );
    await ok(
      await request(s, "tools/class_members", "POST", {
        class_id: c.id,
        student_id: s.students[0],
      }),
    );
    const detail = await ok(await request(s, "tools/classes/" + c.id));
    assert.equal(detail.members.length, 1);
    await ok(await request(other, "tools/classes/" + c.id), 404);
    const academic = await accountToken(s, ["academic"]);
    await ok(
      await request(
        s,
        "tools/followup_notes",
        "POST",
        {
          student_id: s.students[0],
          at: "2026-11-02T10:00",
          content: "<img src=x onerror=alert(1)>",
        },
        academic.token,
      ),
    );
    await ok(
      await request(
        s,
        "tools/followup_notes",
        "POST",
        {
          student_id: other.students[0],
          at: "2026-11-02T10:00",
          content: "跨机构",
        },
        academic.token,
      ),
      404,
    );
    const lead = await ok(
      await request(s, "tools/leads", "POST", {
        name: "新线索",
        phone: "13900000009",
        source: "转介绍",
        stage: "trial",
        trial_at: "2026-11-02T10:00",
      }),
    );
    const raw = f.db.raw
      .prepare("SELECT phone_enc FROM leads WHERE tenant_id=? AND id=?")
      .get(s.t.id, lead.id);
    assert.ok(!raw.phone_enc.includes("13900000009"));
    const data = await ok(await request(s, "tools/leads/" + lead.id));
    assert.ok(!JSON.stringify(data).includes("13900000009"));
    const converted = await ok(
      await request(s, "tools/leads/" + lead.id + "/convert", "POST", {
        version: data.record.version,
      }),
    );
    assert.ok(converted.student_id);
    const parents = await ok(
      await request(s, "tools/referrals", "POST", {
        student_id: s.students[0],
        intention: "本科",
        parent_phone: "13900000008",
        consent_name: "同意人",
        consent_at: "2026-01-01T10:00",
        consent_method: "书面",
        consent_operator: "经办人",
      }),
    );
    assert.ok(parents.id);
    const rr = await ok(await request(s, "tools/referrals"));
    assert.ok(!JSON.stringify(rr).includes("13900000008"));
    const student = await accountToken(s, ["student"], s.students[0]);
    await ok(
      await request(s, "tools/classes", "GET", undefined, student.token),
      403,
    );
    await ok(
      await request(s, "tools/leads", "GET", undefined, student.token),
      403,
    );
    await pack(s, s.students[0], 2);
    const dashboard = await ok(
      await request(s, "workbench", "GET", undefined, academic.token),
    );
    assert.ok(!("tuition_amount" in dashboard));
    const renewal = await ok(
      await request(s, "renewals", "GET", undefined, academic.token),
    );
    assert.equal(renewal.items[0].balance, 2);
    assert.ok(!("amount" in renewal.items[0]));
  } finally {
    f.restore();
  }
});

test("第六阶段：网页空助教规范化为null；只生成所选班级；混入他课或跨机构学员拒绝", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 2)), f },
      other = { ...(await setup(f, 1, "b")), f };
    const created = await ok(
      await request(s, "tools/classes", "POST", {
        name: "固定班",
        teacher_id: s.teacher,
        course_type_id: s.type,
        location_id: s.room,
        date_from: "2026-11-01",
        date_to: "2026-11-30",
      }),
    );
    await ok(
      await request(s, "tools/classes/" + created.id + "/members", "POST", {
        student_ids: [s.students[0]],
      }),
    );
    const template = {
      class_id: created.id,
      teacher_id: s.teacher,
      assistant_id: "",
      course_type_id: s.type,
      location_id: s.room,
      weekday: 0,
      start_time: "14:00",
      duration: 45,
      units: 1,
      date_from: "2026-11-01",
      date_to: "2026-11-30",
    };
    const saved = await ok(
      await request(s, "data/schedule_templates", "POST", template),
    );
    const record = await ok(
      await request(s, "data/schedule_templates/" + saved.id),
    );
    assert.equal(record.record.assistant_id, null);
    await ok(
      await request(s, "data/lessons", "POST", {
        ...template,
        start_at: "2026-11-01T10:00",
        student_ids: [other.students[0]],
      }),
      404,
    );
    await ok(
      await request(s, "data/lessons", "POST", {
        ...template,
        start_at: "2026-11-01T10:00",
        student_ids: [s.students[1]],
      }),
      404,
    );
    const generated = await ok(
      await request(s, "templates/generate", "POST", {
        class_id: created.id,
        from: "2026-11-01",
        to: "2026-11-30",
      }),
    );
    assert.equal(generated.committed, true);
    assert.equal(generated.generated, 5);
  } finally {
    f.restore();
  }
});

test("第六阶段：顾问联系说明加密落库，公共品牌不泄露，授权续费通知解密并留审计", async () => {
  const { adminCall } = await import("./fixtures-admin.mjs");
  const f = await fixture();
  try {
    const s = { ...(await setup(f)), f },
      contact = "课程咨询13900000009";
    const detail = await adminCall(f, "tenants/" + s.t.id);
    const brand = detail.body.brand;
    await ok(
      await adminCall(f, "tenants/" + s.t.id + "/brand", "PUT", {
        ...brand,
        contact_text: contact,
      }),
    );
    const db = f.db.raw
      .prepare("SELECT contact_text FROM tenant_branding WHERE tenant_id=?")
      .get(s.t.id);
    assert.ok(db.contact_text.startsWith("v1."));
    assert.ok(!db.contact_text.includes("13900000009"));
    const read = await adminCall(f, "tenants/" + s.t.id);
    assert.equal(read.body.brand.contact_text, contact);
    const pub = await request(s, "public/brand");
    assert.ok(!pub.text.includes("13900000009"));
    assert.ok(!("contact_text" in pub.body));
    const academic = await accountToken(s, ["academic"]);
    const notice = await ok(
      await request(s, "renewal-brand", "GET", undefined, academic.token),
    );
    assert.equal(notice.contact_text, contact);
    assert.ok(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM audit_log WHERE tenant_id=? AND module='exports'",
        )
        .get(s.t.id).n,
    );
  } finally {
    f.restore();
  }
});
