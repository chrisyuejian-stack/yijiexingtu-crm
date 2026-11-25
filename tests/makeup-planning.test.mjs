import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture } from "./support.mjs";
import {
  setup,
  request,
  lesson,
  status,
  details,
  mutate,
  accountToken,
} from "./fixtures-credit.mjs";
import { schoolFixture } from "./fixtures-school.mjs";
import { adminCall } from "./fixtures-admin.mjs";
import { sha } from "../src/server/core.js";

const fixed = Date.parse("2026-11-04T20:00:00+08:00");
const path = (id, action) => "c2/makeups/" + id + "/" + action;
function ok(response, expected = 200) {
  assert.equal(response.status, expected, response.text);
  assert.ok(response.queries <= 40);
  return response.body;
}
async function atFixedTime(run) {
  const f = await fixture(),
    DateBefore = Date;
  globalThis.Date = class extends DateBefore {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  };
  try {
    await run(f);
  } finally {
    globalThis.Date = DateBefore;
    f.restore();
  }
}
const sample = (name, body, trips) => {
  if (process.env.MAKEUP_SAMPLE === "1")
    console.log("MAKEUP_SAMPLE " + JSON.stringify({ name, body, trips }));
};
async function importOriginal(f) {
  const s = { ...(await schoolFixture(f, "makeup100")), f };
  f.env.ACCESS_MODE = "off";
  const raw = JSON.parse(
    await readFile(
      new URL("../dev/mock/教务模拟数据_100人.json", import.meta.url),
    ),
  );
  const tables = Object.entries(raw).filter(
    ([, rows]) => Array.isArray(rows) && rows.length,
  );
  const admin = async (part, data) =>
    ok(await adminCall(f, "tenants/" + s.t.id + "/jobs" + part, "POST", data));
  const job = await admin("", {
    kind: "legacy",
    counts: Object.fromEntries(tables.map(([key, rows]) => [key, rows.length])),
    settings: raw.settings,
    reason: "原始一百人补课验收",
  });
  for (const [table, rows] of tables)
    for (let i = 0; i < rows.length; i += 200)
      await admin("/" + job.id + "/page", {
        table,
        rows: rows.slice(i, i + 200),
      });
  assert.equal(
    (await admin("/" + job.id + "/preview", {})).counts.students,
    100,
  );
  await admin("/" + job.id + "/commit", {});
  await s.r.createSession(await sha(s.token), s.user, {
    ip: "fixture",
    ua: "fixture",
  });
  return s;
}
test("补课 M1：100 人原始夹具三位学员的推荐分散、理由准确，每条均通过正式规则预查", () =>
  atFixedTime(async (f) => {
    const s = await importOriginal(f);
    const origins = f.db.raw
      .prepare(
        `
      SELECT p.id,p.student_id,a.name student_name,l.start_at,l.teacher_id
      FROM lesson_participants p JOIN lessons l ON l.tenant_id=p.tenant_id AND l.id=p.lesson_id
      JOIN students a ON a.tenant_id=p.tenant_id AND a.id=p.student_id AND a.status='active'
      WHERE p.tenant_id=? AND p.attendance='student_leave' AND p.makeup_for IS NULL AND p.deleted_at IS NULL
        AND l.start_at<'2026-11-04' AND NOT EXISTS(SELECT 1 FROM makeup_links m WHERE m.tenant_id=p.tenant_id AND m.original_participant_id=p.id AND m.deleted_at IS NULL)
      ORDER BY l.start_at DESC,p.id`,
      )
      .all(s.t.id);
    const expectedDates = new Map([
      ["萧天佑", 8],
      ["高天佑", 8],
      ["罗文博", 4],
      ["袁语嫣", 2],
      ["万安然", 0],
    ]);
    const latest = new Map(
      origins.reverse().map((row) => [row.student_name, row]),
    );
    const distinct = [...expectedDates.keys()].map((name) => latest.get(name));
    assert.equal(
      new Set(distinct.map((row) => row.student_id)).size,
      expectedDates.size,
    );
    for (const origin of distinct) {
      const response = await request(s, path(origin.id, "suggestions"));
      const result = ok(response);
      assert.ok(response.queries <= 12, String(response.queries));
      assert.deepEqual(result.context.window, {
        from: "2026-11-05",
        to: "2026-11-18",
      });
      assert.ok(result.items.length <= 8);
      const byDay = Object.groupBy(result.items, (x) =>
        x.start_at.slice(0, 10),
      );
      assert.equal(
        Object.keys(byDay).length,
        expectedDates.get(origin.student_name),
      );
      for (const entries of Object.values(byDay)) {
        assert.ok(entries.length <= 2);
        if (entries.length === 2)
          assert.ok(
            Math.abs(
              Date.parse(entries[0].start_at) - Date.parse(entries[1].start_at),
            ) >= 3600000,
          );
      }
      for (const row of result.items) {
        if (row.reason === "same_time") {
          const weekday = (value) =>
            new Date(value.slice(0, 10) + "T12:00:00Z").getUTCDay();
          assert.equal(weekday(row.start_at), weekday(origin.start_at));
          assert.equal(
            row.start_at.slice(11, 16),
            origin.start_at.slice(11, 16),
          );
        }
        const checked = await request(s, path(origin.id, "check"), "POST", row);
        assert.deepEqual(ok(checked), { ok: true, conflicts: [] });
      }
      sample("suggestions-" + origin.student_name, result, response.queries);
      if (!result.items.length) continue;
      const exampleDay = await request(
        s,
        path(origin.id, "day") +
          "?date=" +
          result.items[0].start_at.slice(0, 10),
      );
      sample("day-" + origin.student_name, ok(exampleDay), exampleDay.queries);
    }
  }));

test("补课 M2：当天时间轴仅暴露必要文字，含教室、学员及不可排时段，日期和机构均受限", () =>
  atFixedTime(async (f) => {
    const s = { ...(await setup(f, 2)), f },
      other = { ...(await setup(f, 1, "other")), f };
    const original = await lesson(s, "2026-11-02T15:30", [s.students[0]]);
    const part = (await details(s, original)).participants[0].id;
    await lesson(s, "2026-11-05T15:30", [s.students[1]]);
    await lesson(s, "2026-11-05T18:00", [s.students[0]]);
    await lesson(s, "2026-11-05T19:00", [s.students[1]]);
    ok(
      await request(s, "data/student_schedule_blocks", "POST", {
        student_id: s.students[0],
        weekday: 3,
        start_time: "08:00",
        end_time: "12:00",
        label: "上学",
      }),
    );
    const scarce = ok(await request(s, path(part, "suggestions")));
    assert.deepEqual(
      scarce.items.map((row) => [row.start_at, row.reason]),
      [
        ["2026-11-09T15:30+08:00", "same_time"],
        ["2026-11-16T15:30+08:00", "same_time"],
      ],
    );
    const endpoint = path(part, "day") + "?date=2026-11-05";
    const result = ok(await request(s, endpoint));
    assert.equal(result.teacher_usual, null);
    assert.ok(
      result.busy.some(
        (x) => x.who === "teacher" && x.from === "15:30" && x.label === "班课",
      ),
    );
    assert.ok(result.busy.some((x) => x.who === "room" && x.label === "班课"));
    assert.ok(
      result.busy.some((x) => x.who === "student" && x.label === "班课 · 教师"),
    );
    assert.ok(
      result.busy.some(
        (x) => x.who === "block" && x.label === "学员不可排（上学）",
      ),
    );
    assert.ok(!JSON.stringify(result).includes("学员1"));
    for (const date of ["2026-11-04", "2026-12-06", "2026-02-30"])
      ok(await request(s, path(part, "day") + "?date=" + date), 400);
    ok(await request(s, path(part, "day") + "?date=2026-12-05"));
    ok(await request(other, endpoint), 404);
    const student = await accountToken(s, ["student"], s.students[0]);
    ok(await request(s, endpoint, "GET", undefined, student.token), 403);
  }));

test("补课 M3：预查报告实际冲突，不写业务或审计，推荐后被占用仍拒绝正式保存", () =>
  atFixedTime(async (f) => {
    const s = { ...(await setup(f, 2)), f },
      other = { ...(await setup(f, 1, "check-other")), f };
    const original = await lesson(s, "2026-11-02T15:30", [s.students[0]]);
    ok(await status(s, original, "student_leave"));
    const part = (await details(s, original)).participants[0].id;
    const candidate = ok(await request(s, path(part, "suggestions"))).items[0];
    const check = (data) => request(s, path(part, "check"), "POST", data);
    const snapshot = () =>
      ["lessons", "lesson_participants", "makeup_links", "audit_log"].map(
        (table) =>
          f.db.raw
            .prepare("SELECT COUNT(*) n FROM " + table + " WHERE tenant_id=?")
            .get(s.t.id).n,
      );
    const before = snapshot();
    assert.deepEqual(ok(await check(candidate)), { ok: true, conflicts: [] });
    assert.deepEqual(snapshot(), before);
    await lesson(s, candidate.start_at, [s.students[1]]);
    const wd =
      (new Date(candidate.start_at.slice(0, 10) + "T12:00:00Z").getUTCDay() +
        6) %
      7;
    ok(
      await request(s, "data/student_schedule_blocks", "POST", {
        student_id: s.students[0],
        weekday: wd,
        start_time: "08:00",
        end_time: "09:00",
        label: "不可排",
      }),
    );
    const blockedByStudent = ok(
      await check({
        ...candidate,
        start_at: candidate.start_at.slice(0, 10) + "T08:00+08:00",
      }),
    );
    assert.deepEqual(blockedByStudent, {
      ok: false,
      conflicts: [{ who: "block", text: "学员该时段不可排" }],
    });
    const blockedBefore = snapshot();
    const blocked = await check(candidate);
    const result = ok(blocked);
    assert.equal(result.ok, false);
    assert.ok(
      result.conflicts.some(
        (x) => x.who === "teacher" && /已有课/.test(x.text),
      ),
    );
    assert.ok(
      result.conflicts.some((x) => x.who === "room" && /已占用/.test(x.text)),
    );
    assert.deepEqual(snapshot(), blockedBefore);
    sample("check-conflict", result, blocked.queries);
    const saved = ok(
      await mutate(s, "credits/makeups", {
        original_participant_id: part,
        new_lesson: {
          ...candidate,
          course_type_id: s.type,
          units: 1,
          force: false,
        },
      }),
    );
    assert.equal(saved.committed, false);
    assert.deepEqual(snapshot(), blockedBefore);
    ok(await request(other, path(part, "check"), "POST", candidate), 404);
    ok(await check({ ...candidate, teacher_id: other.teacher }), 404);
    const key = "request:" + s.t.id + ":" + s.user.id;
    f.db.raw
      .prepare(
        "UPDATE security_limits SET count=120,window_start=? WHERE key=?",
      )
      .run(Date.now(), key);
    ok(await check(candidate), 429);
  }));
