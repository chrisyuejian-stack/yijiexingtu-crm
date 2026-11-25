import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./support.mjs";
import { schoolFixture } from "./fixtures-school.mjs";
import {
  personalToken, sampleClock, scheduleRequest, studentScheduleSample, weekPath,
} from "./fixtures-student-schedule.mjs";

async function withSchedule(run) {
  const originalNow = Date.now;
  Date.now = () => sampleClock;
  let f;
  try {
    f = await fixture();
    await run(await studentScheduleSample(f));
  } finally {
    f?.restore();
    Date.now = originalNow;
  }
}
async function get(s, path, token) {
  const result = await scheduleRequest(s, path, token);
  assert.equal(result.status, 200, result.text);
  return result.body;
}

test("P2 选学员：拼音、12 个多音字姓氏、英文和 HTML 字面姓名，各选择器字段一致", () => withSchedule(async (s) => {
  const expected = ["tangyixin", "tyx"];
  const surnames = [
    ["曾", "zeng", "ceng"], ["单", "shan", "chan", "dan"], ["仇", "qiu", "chou"],
    ["解", "xie", "jie"], ["查", "zha", "cha"], ["区", "ou", "qu"], ["朴", "piao", "pu"],
    ["繁", "po", "fan"], ["盖", "ge", "gai"], ["种", "chong", "zhong"],
    ["覃", "qin", "tan"], ["乐", "yue", "le"],
  ];
  for (const [surname] of surnames) await s.create("students", { name: surname + "明" });
  const all = (await get(s, "data/students")).items;
  const find = (id) => all.find((row) => row.id === id);
  assert.deepEqual(find(s.student).search_keys.slice(0, 2), expected);
  assert.deepEqual(find(s.removed).search_keys, ["emilyzhang", "ez"]);
  const literal = find(s.literal);
  assert.equal(literal.name, "<b>张</b>三&<i>测试</i>");
  assert.ok(literal.search_keys.includes(literal.name));
  for (const [surname, ...readings] of surnames) {
    const { search_keys: keys } = all.find((row) => row.name === surname + "明");
    assert.ok(keys.length <= 8 && keys.every((key) => /^[a-z]+$/.test(key)));
    for (const reading of readings) {
      assert.ok(keys.includes(reading + "ming"), keys.join(" "));
      assert.ok(keys.includes(reading[0] + "m"), keys.join(" "));
    }
  }
  const pairs = [
    [(await get(s, "data/students/" + s.student)).record],
    (await get(s, "c2/students?q=唐")).items,
    (await get(s, "search?q=唐")).groups.students,
    [(await get(s, "data/schedule_enrollments/" + s.enrolled)).record],
    (await get(s, "data/lessons/" + s.original)).record.participants.filter((row) => row.student_id === s.student),
    (await get(s, "tools/classes/" + s.cls)).members,
    (await get(s, "tools/class_members?class_id=" + s.cls)).items,
    [(await get(s, "tools/class_members/" + s.classMember)).record],
  ];
  for (const rows of pairs) {
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].search_keys.slice(0, 2), expected);
  }
}));

test("P2 学员周课表：已生成固定课、逐人请假、真实补课、取消、移除及空页查询预算", () => withSchedule(async (s) => {
  const full = await scheduleRequest(s, weekPath);
  const filtered = await scheduleRequest(s, weekPath + "&student_id=" + s.student);
  assert.equal(filtered.status, 200, filtered.text);
  assert.equal(full.trips, filtered.trips);
  assert.ok(filtered.trips <= 3);
  assert.deepEqual(Object.keys(filtered.body), ["items", "next_offset"]);
  const rows = Object.fromEntries(filtered.body.items.map((row) => [row.id, row]));
  assert.deepEqual(Object.keys(rows).sort(), [s.original, s.makeup, s.cancelled, s.foreignLesson].sort());
  assert.equal(rows[s.original].template_id, s.fixed);
  assert.equal(rows[s.original].own_attendance, "student_leave");
  assert.equal(rows[s.cancelled].status, "cancelled");
  assert.equal(rows[s.makeup].own_attendance, "planned");
  assert.equal(rows[s.drop], undefined);
  const blank = "schedule?from=2026-12-01&to=2026-12-08";
  const empty = await scheduleRequest(s, blank + "&student_id=" + s.student);
  assert.deepEqual(empty.body, { items: [], next_offset: null });
  assert.ok(empty.trips <= (await scheduleRequest(s, blank)).trips);
}));

test("P2 固定规则及模板名单：按北京时间有效期、班级继承、人数、拼音、索引与 D1 预算", () => withSchedule(async (s) => {
  const path = "students/" + s.student + "/fixed-rules";
  const statements = [], batch = s.f.db.batch.bind(s.f.db);
  s.f.db.batch = (queries) => {
    statements.push(...queries.filter(({ query }) => /FROM schedule_enrollments e/.test(query)));
    return batch(queries);
  };
  const result = await scheduleRequest(s, path);
  assert.equal(result.status, 200, result.text);
  assert.ok(result.trips <= 3);
  assert.deepEqual(result.body.items.map((row) => row.id), [s.fixed, s.otherFixed, s.classFixed]);
  const [first, boundary, classRule] = result.body.items;
  assert.deepEqual([first.weekday, first.start_time, first.end_time, first.date_from, first.date_to,
    first.teacher_name, first.location_name, first.course_name, first.is_group, first.member_count],
  [0, "09:00", "09:45", "2026-11-09", "2026-11-30", "教师", "教室", "班课", true, 2]);
  assert.equal(boundary.date_from, "2026-11-10");
  assert.equal(classRule.is_group, false);
  assert.equal(classRule.member_count, 1);
  const plans = statements.flatMap(({ query, params }) =>
    s.f.db.raw.prepare("EXPLAIN QUERY PLAN " + query).all(...params).map((row) => row.detail));
  for (const index of ["schedule_enrollments_student", "lesson_participants_student", "class_members_student", "schedule_templates_class"])
    assert.ok(plans.some((line) => line.startsWith("SEARCH") && line.includes(index) && line.includes("tenant_id=?")), plans.join("\n"));
  const templates = (await get(s, "data/schedule_templates")).items;
  for (const id of [s.fixed, s.classFixed]) {
    const list = templates.find((x) => x.id === id);
    const { record } = await get(s, "data/schedule_templates/" + id);
    assert.deepEqual(record.students, list.students);
    const learner = record.students.find((row) => row.id === s.student);
    assert.deepEqual(learner.search_keys.slice(0, 2), ["tangyixin", "tyx"]);
    assert.equal(learner.date_from, id === s.fixed ? "2026-11-09" : "2026-11-01");
  }
  assert.deepEqual((await get(s, "students/" + s.literal + "/fixed-rules")).items, []);
}));

test("P2 学员课表与固定规则权限：教师主讲和助教交集、学员仅本人、跨机构 404", () => withSchedule(async (s) => {
  const f = s.f;
  const a = await personalToken(s, "teacher", s.teacher, "13900000001");
  const b = await personalToken(s, "teacher", s.otherTeacher, "13900000002");
  const student = await personalToken(s, "student", s.student, "13900000003");
  const other = { ...await schoolFixture(f, "p2-other"), f };
  const added = await other.call("data/students", "POST", { name: "别机构学员" });
  assert.equal(added.status, 200, added.text);
  const foreignId = added.body.id;
  const assistantLesson = await s.call("data/lessons", "POST", {
    teacher_id: s.otherTeacher, assistant_id: s.teacher, location_id: s.room, course_type_id: s.type,
    duration: 45, units: 1, start_at: "2026-11-15T09:00", student_ids: [s.student],
  });
  assert.equal(assistantLesson.body.committed, true, assistantLesson.text);
  const filter = weekPath + "&student_id=" + s.student;
  const rules = "students/" + s.student + "/fixed-rules";
  const primary = (await get(s, filter, a)).items;
  assert.deepEqual(primary.map((row) => row.id), [s.original, s.makeup, s.cancelled, assistantLesson.body.id]);
  assert.equal(primary[0].own_attendance, "student_leave");
  assert.ok(!Object.hasOwn(primary[0], "own_deducted"));
  assert.ok(!Object.hasOwn(primary[0], "private_comment"));
  assert.deepEqual((await get(s, filter, b)).items.map((row) => row.id), [s.foreignLesson, assistantLesson.body.id]);
  assert.deepEqual((await get(s, rules, a)).items.map((row) => row.id), [s.fixed, s.classFixed]);
  assert.deepEqual((await get(s, rules, b)).items.map((row) => row.id), [s.otherFixed]);
  const self = await get(s, filter, student);
  assert.deepEqual(self, await get(s, weekPath, student));
  assert.equal(self.items[0].own_attendance, "student_leave");
  assert.deepEqual(self.items[0].participants_summary.names, ["唐一欣"]);
  assert.ok(!JSON.stringify(await get(s, rules, student)).includes("单晓"));
  for (const [token, id] of [[student, s.peer], [a, s.literal], [a, foreignId], [s.token, foreignId]]) {
    assert.equal((await scheduleRequest(s, weekPath + "&student_id=" + id, token)).status, 404);
    assert.equal((await scheduleRequest(s, "students/" + id + "/fixed-rules", token)).status, 404);
  }
  assert.equal((await scheduleRequest(s, rules, "")).status, 401);
}));
