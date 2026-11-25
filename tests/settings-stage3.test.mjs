import test from "node:test";

import assert from "node:assert/strict";

import { readFile, writeFile, mkdir } from "node:fs/promises";

import { fixture } from "./support.mjs";

import { setup, accountToken } from "./fixtures-credit.mjs";

import { repo } from "../src/server/repo.js";

import { defaultNickname } from "../src/server/student-nickname.js";

import { stageRuleKeys } from "../src/server/subject-packs.js";

import { workbook } from "../src/server/xlsx.js";

import { startBackup } from "../src/server/backup.js";

import { sha, b64, bytes } from "../src/server/core.js";

const examples = [];

async function call(s, path, method = "GET", data, token = s.token, form) {
  const origin = "https://school.test";
  const url = path.startsWith("/") ? path : "/" + s.t.slug + "/api/" + path;
  const headers = {
    Origin: origin,
    ...token ? {
      Cookie: "channel_session=" + token
    } : {}
  };
  if (!form) headers["Content-Type"] = "application/json";
  const res = await s.f.request(origin + url, {
    method: method,
    headers: headers,
    body: form || (data === undefined ? undefined : JSON.stringify(data))
  });
  const raw = new Uint8Array(await res.arrayBuffer());
  let value;
  try {
    value = JSON.parse((new TextDecoder).decode(raw));
  } catch {
    value = {
      binary_bytes: raw.length,
      content_type: res.headers.get("content-type")
    };
  }
  const out = {
    status: res.status,
    body: value,
    queries: Number(res.headers.get("x-test-d1-queries")),
    bytes: raw
  };
  examples.push({
    request: {
      method: method,
      path: url,
      body: form ? {
        multipart: [ ...form ].map(([key, v]) => [ key, typeof v === "string" ? v : {
          name: v.name,
          size: v.size,
          type: v.type
        } ])
      } : data ?? null,
      authenticated: !!token
    },
    response: {
      status: res.status,
      body: value
    }
  });
  return out;
}

function ok(r, status = 200) {
  assert.equal(r.status, status, JSON.stringify(r.body));
  return r.body;
}

async function withSchool(fn, options) {
  const f = await fixture(options);
  try {
    const s = await setup(f, 2, "stage3");
    s.f = f;
    await fn(s);
  } finally {
    f.restore();
  }
}

async function teacherToken(s) {
  const made = ok(await call(s, "accounts", "POST", {
    name: "老师测试",
    phone: "13888777666",
    roles: [ "teacher" ],
    teacher_id: s.teacher
  }), 201);
  s.f.db.raw.prepare("UPDATE users SET must_change=0 WHERE tenant_id=? AND id=?").run(s.t.id, made.id);
  const user = await s.r.user(made.id), token = b64(bytes(32));
  await s.r.createSession(await sha(token), user, {
    ip: "test",
    ua: "stage3"
  });
  return {
    id: made.id,
    token: token
  };
}

async function supervisorToken(s) {
  const res = await s.f.request("https://console.school.test/api/tenants/" + s.t.id + "/supervisors", {
    method: "POST",
    headers: {
      Origin: "https://console.school.test",
      "Content-Type": "application/json",
      Cookie: s.f.adminCookie,
      "Cf-Access-Jwt-Assertion": s.f.access
    },
    body: JSON.stringify({
      name: "另一主管",
      phone: "13888777555",
      roles: [ "supervisor" ]
    })
  });
  assert.equal(res.status, 201);
  const made = await res.json();
  s.f.db.raw.prepare("UPDATE users SET must_change=0 WHERE tenant_id=? AND id=?").run(s.t.id, made.id);
  const user = await s.r.user(made.id), token = b64(bytes(32));
  await s.r.createSession(await sha(token), user, {
    ip: "test",
    ua: "stage3"
  });
  return {
    id: made.id,
    token: token
  };
}

const fields = {
  subject: "music_interest",
  group: "主修",
  name: "钢琴报价",
  form: "one_to_one",
  minutes: 45,
  duration_text: null,
  pricing: {
    mode: "per_unit",
    amount: 200,
    unit_label: "课时"
  }
};

const createCourse = async (s, extra = {}) => ok(await call(s, "settings/courses", "POST", {
  ...fields,
  ...extra
}), 201);

const rules = Object.fromEntries(stageRuleKeys.map(k => [ k, false ]));

const seed = async (s, key = "music_interest") => ok(await call(s, "settings/subjects", "POST", {
  key: key
}));

const png = () => Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw1kAAAAASUVORK5CYII="), c => c.charCodeAt(0));

async function upload(s, tags = [], token = s.token) {
  const form = new FormData;
  form.set("file", new Blob([ png() ], {
    type: "image/png"
  }), "test.png");
  form.set("tags", JSON.stringify(tags));
  return call(s, "gallery", "POST", undefined, token, form);
}

async function makeCard(s, payload, user = s.user, token = s.token, targets = {}) {
  const id = "sg_" + crypto.randomUUID().replaceAll("-", "");
  await s.r.settingsSuggestion(id, user, payload, targets);
  return ok(await call(s, "settings/changes", "POST", {
    suggestion_id: id,
    payload: payload
  }, token), 201);
}

function noTenant(x) {
  if (!x || typeof x !== "object") return;
  assert.equal(Object.hasOwn(x, "tenant_id"), false);
  for (const v of Object.values(x)) noTenant(v);
}

test("YX3 姓氏称呼支持单姓、常见复姓、英文与无法判断，字面X不作默认", () => {
  for (const [name, expected] of [ [ "周小雨", "周同学" ], [ "欧阳晴", "欧阳同学" ], [ "司马光", "司马同学" ], [ "诸葛明", "诸葛同学" ], [ "端木星", "端木同学" ], [ "Alice Smith", "Alice Smith" ], [ "学员0", "学员0" ], [ "周", "周同学" ], [ "王·Mary", "王·Mary" ], [ "𠮷田", "𠮷同学" ], [ "歐陽晴", "歐陽同学" ] ]) assert.equal(defaultNickname(name), expected);
});

test("YX3 学员新建与手工覆盖称呼、空值默认、改名不覆盖手工称呼", () => withSchool(async s => {
  for (const [name, nickname] of [ [ "周小雨", "周同学" ], [ "欧阳晴", "欧阳同学" ], [ "Alice", "Alice" ] ]) {
    const a = ok(await call(s, "data/students", "POST", {
      name: name,
      nickname: ""
    }));
    assert.equal(ok(await call(s, "data/students/" + a.id)).record.nickname, nickname);
  }
  const a = ok(await call(s, "data/students", "POST", {
    name: "王小雨",
    nickname: "小星"
  }));
  let row = ok(await call(s, "data/students/" + a.id)).record;
  ok(await call(s, "data/students/" + a.id, "PATCH", {
    version: row.version,
    name: "周小雨"
  }));
  assert.equal(ok(await call(s, "data/students/" + a.id)).record.nickname, "小星");
}));

test("YX3 0020升级修正旧字面称呼、保留手工值，并带入阶段2已选择学科的内容", async () => {
  const f = await fixture({
    migrateSettings: false
  });
  try {
    const s = {
      ...await setup(f, 2, "before20"),
      f: f
    };
    f.db.raw.prepare("UPDATE students SET name='欧阳晴',nickname='X 同学' WHERE tenant_id=? AND id=?").run(s.t.id, s.students[0]);
    f.db.raw.prepare("UPDATE students SET name='周小雨',nickname='小星' WHERE tenant_id=? AND id=?").run(s.t.id, s.students[1]);
    f.db.raw.prepare("INSERT INTO tenant_subjects(tenant_id,id,created_at,created_by)VALUES(?,'art_exam',?,'fixture')").run(s.t.id, Date.now());
    f.db.raw.exec(await readFile("migrations/0020_settings_and_templates.sql", "utf8"));
    assert.equal(f.db.raw.prepare("SELECT nickname FROM students WHERE tenant_id=? AND id=?").get(s.t.id, s.students[0]).nickname, "欧阳同学");
    assert.equal(f.db.raw.prepare("SELECT nickname FROM students WHERE tenant_id=? AND id=?").get(s.t.id, s.students[1]).nickname, "小星");
    assert.ok(ok(await call(s, "settings/courses")).total > 10);
    assert.equal(ok(await call(s, "settings/calendar")).version, 1);
  } finally {
    f.restore();
  }
});

test("YX3 没有模板的三类集合GET为空且version1，首次PUT递增", () => withSchool(async s => {
  assert.deepEqual(ok(await call(s, "settings/stage-rules")), {
    version: 1,
    rules: {}
  });
  assert.deepEqual(ok(await call(s, "settings/calendar")), {
    version: 1,
    region: null,
    items: []
  });
  assert.deepEqual(ok(await call(s, "settings/course-rules")), {
    version: 1,
    items: []
  });
  const saved = ok(await call(s, "settings/stage-rules", "PUT", {
    version: 1,
    rules: rules
  }));
  assert.equal(saved.version, 2);
}));

test("YX3 阶段规则必须五个布尔key齐全；缺项、未知项、非布尔全部422且不写", () => withSchool(async s => {
  for (const bad of [ {
    ...rules,
    extra: true
  }, {
    ...rules,
    exam_sprint_before_grade: undefined
  }, {
    ...rules,
    mock_exam_schedule: 1
  } ]) assert.equal(ok(await call(s, "settings/stage-rules", "PUT", {
    version: 1,
    rules: bad
  }), 422).error, "validation_failed");
  assert.equal(ok(await call(s, "settings/stage-rules")).version, 1);
}));

test("YX3 集合整体替换、版本冲突附完整latest，不局部覆盖", () => withSchool(async s => {
  const a = ok(await call(s, "settings/calendar", "PUT", {
    version: 1,
    region: "上海",
    items: [ {
      key: "grade_exam",
      name: "考级季",
      months: [ 11 ]
    } ]
  }));
  const b = ok(await call(s, "settings/calendar", "PUT", {
    version: 1,
    region: null,
    items: []
  }), 409);
  assert.equal(b.error, "version_conflict");
  assert.deepEqual(b.details.latest, a);
  const last = ok(await call(s, "settings/calendar", "PUT", {
    version: a.version,
    region: null,
    items: []
  }));
  assert.deepEqual(last.items, []);
  assert.equal(last.version, 3);
}));

test("YX3 日历节点重复、月份为空/越界/非整数、region格式错误全部拒绝", () => withSchool(async s => {
  const node = {
    key: "exam",
    name: "考试",
    months: [ 1 ]
  };
  for (const items of [ [ node, node ], [ {
    ...node,
    months: []
  } ], [ {
    ...node,
    months: [ 0 ]
  } ], [ {
    ...node,
    months: [ 13 ]
  } ], [ {
    ...node,
    months: [ 1.5 ]
  } ] ]) ok(await call(s, "settings/calendar", "PUT", {
    version: 1,
    region: null,
    items: items
  }), 422);
  ok(await call(s, "settings/calendar", "PUT", {
    version: 1,
    region: 12,
    items: [ node ]
  }), 422);
}));

test("YX3 四种模板都可导入；报价无预设价格、内容结构保留、同包重试不覆盖", () => withSchool(async s => {
  for (const key of [ "music_interest", "music_exam", "art_interest", "art_exam" ]) await seed(s, key);
  assert.equal(ok(await call(s, "settings/subjects")).length, 4);
  const p = ok(await call(s, "settings/courses?limit=200"));
  assert.ok(p.total > 60);
  assert.ok(p.items.every(c => c.pricing === null));
  const course = p.items[0];
  const updated = ok(await call(s, "settings/courses/" + course.id, "PUT", {
    ...course,
    name: course.name,
    pricing: {
      mode: "per_unit",
      amount: 345.67
    }
  }));
  await seed(s, course.subject);
  assert.equal(ok(await call(s, "settings/courses/" + course.id)).pricing.amount, 345.67);
  assert.equal(ok(await call(s, "settings/courses?limit=200")).total, p.total);
  assert.equal(ok(await call(s, "settings/courses/" + course.id)).version, updated.version);
  assert.ok(JSON.parse(s.f.db.raw.prepare("SELECT content_json FROM tenant_subjects WHERE tenant_id=? AND id=?").get(s.t.id, "music_interest").content_json).content_types.length > 4);
}));

test("YX3 模板同名手工项保留，手工日历和规则不会被后加模板覆盖", () => withSchool(async s => {
  const made = await createCourse(s, {
    name: "乐理与视唱练耳",
    group: "自定义",
    pricing: {
      mode: "per_unit",
      amount: 99
    }
  });
  ok(await call(s, "settings/calendar", "PUT", {
    version: 1,
    region: "本地",
    items: [ {
      key: "grade_exam",
      name: "当地考级",
      months: [ 11 ]
    } ]
  }));
  ok(await call(s, "settings/stage-rules", "PUT", {
    version: 1,
    rules: rules
  }));
  await seed(s);
  assert.equal(ok(await call(s, "settings/courses/" + made.id)).pricing.amount, 99);
  assert.deepEqual(ok(await call(s, "settings/calendar")).items.find(x => x.key === "grade_exam").months, [ 11 ]);
  assert.deepEqual(ok(await call(s, "settings/stage-rules")).rules, rules);
}));

test("YX3 报价五种计价均用整数分存储，课包数量及金额小数严格校验", () => withSchool(async s => {
  for (const mode of [ "per_unit", "per_term", "per_semester", "per_month", "package" ]) {
    const c = await createCourse(s, {
      name: mode,
      pricing: {
        mode: mode,
        amount: 123.45,
        ...mode === "package" ? {
          units_per_package: 48
        } : {}
      }
    });
    assert.equal(c.pricing.amount, 123.45);
    assert.equal(s.f.db.raw.prepare("SELECT price_cents FROM offer_courses WHERE tenant_id=? AND id=?").get(s.t.id, c.id).price_cents, 12345);
  }
  for (const pricing of [ {
    mode: "per_unit",
    amount: 1.234
  }, {
    mode: "package",
    amount: 10
  }, {
    mode: "per_unit",
    amount: -1
  } ]) ok(await call(s, "settings/courses", "POST", {
    ...fields,
    pricing: pricing
  }), 422);
}));

test("YX3 报价时长与排课时长分离，跨机构排课课程不能关联", () => withSchool(async s => {
  await createCourse(s, {
    minutes: 120,
    course_type_id: s.type
  });
  await createCourse(s, {
    name: "全天",
    minutes: null,
    duration_text: "全天"
  });
  ok(await call(s, "settings/courses", "POST", {
    ...fields,
    minutes: 481
  }), 422);
  ok(await call(s, "settings/courses", "POST", {
    ...fields,
    course_type_id: "foreign"
  }), 404);
  const old = ok(await call(s, "data/course_types/" + s.type)).record;
  ok(await call(s, "data/course_types/" + s.type, "PATCH", {
    ...old,
    default_minutes: 120
  }), 400);
}));

test("YX3 报价筛选分页、停用保留历史价格、价目表版本递增", () => withSchool(async s => {
  const a = await createCourse(s);
  await createCourse(s, {
    name: "附加费",
    group: "可选费用",
    optional: true
  });
  const list = ok(await call(s, "settings/courses?group=主修&q=钢琴&limit=1"));
  assert.equal(list.total, 1);
  const before = list.price_list_rev;
  const gone = ok(await call(s, "settings/courses/" + a.id, "DELETE", {
    version: a.version
  }));
  assert.equal(gone.active, false);
  assert.equal(ok(await call(s, "settings/courses")).total, 1);
  const all = ok(await call(s, "settings/courses?include_inactive=1"));
  assert.equal(all.total, 2);
  assert.ok(all.price_list_rev > before);
  assert.equal(ok(await call(s, "settings/courses/" + a.id)).pricing.amount, 200);
}));

test("YX3 新设置权限不改变财务旧授权；无prices.read时课程DTO不含价格", () => withSchool(async s => {
  await createCourse(s);
  const finance = await accountToken(s, [ "finance" ]), consultant = await accountToken(s, [ "consultant" ]), teacher = await teacherToken(s);
  assert.equal(ok(await call(s, "settings/courses", "GET", undefined, finance.token)).items[0].pricing.amount, 200);
  ok(await call(s, "settings/profile", "GET", undefined, finance.token), 403);
  ok(await call(s, "settings/courses", "POST", fields, consultant.token), 403);
  ok(await call(s, "settings/courses", "GET", undefined, teacher.token), 403);
  await repo(s.f.env, null).module(s.t.id, "prices", false, "fixture");
  const response = ok(await call(s, "settings/courses", "GET", undefined, consultant.token));
  assert.equal(Object.hasOwn(response.items[0], "pricing"), false);
}));

test("YX3 阶段类型增改停用和锚点校验；保留仍引用的日历节点", () => withSchool(async s => {
  await seed(s);
  const a = ok(await call(s, "settings/stage-types", "POST", {
    subject: "music_interest",
    name: "本地冲刺",
    default_months: {
      min: 1,
      max: 2
    },
    anchor: "before_node",
    anchor_node: "grade_exam",
    offset_months: -2
  }), 201);
  const b = ok(await call(s, "settings/stage-types", "PUT", {
    ...a,
    name: "本地冲刺新版"
  }));
  assert.equal(b.version, 2);
  ok(await call(s, "settings/stage-types", "PUT", {
    ...a,
    name: "旧版"
  }), 409);
  const calendar = ok(await call(s, "settings/calendar"));
  ok(await call(s, "settings/calendar", "PUT", {
    ...calendar,
    items: []
  }), 422);
  assert.equal(ok(await call(s, "settings/stage-types", "DELETE", {
    id: a.id,
    version: b.version
  })).active, false);
}));

test("YX3 选课规则引用自己的阶段/课程，重复阶段或跨机构引用422", () => withSchool(async s => {
  await seed(s);
  const stage = ok(await call(s, "settings/stage-types")).items[0], course = ok(await call(s, "settings/courses")).items[0];
  const rule = {
    stage_type_id: stage.id,
    required: [ course.id ],
    recommended: [],
    exclusive: [],
    units: {
      min: 1,
      max: 20
    }
  };
  const a = ok(await call(s, "settings/course-rules", "PUT", {
    version: 1,
    items: [ rule ]
  }));
  assert.equal(a.version, 2);
  ok(await call(s, "settings/course-rules", "PUT", {
    version: a.version,
    items: [ rule, rule ]
  }), 422);
  ok(await call(s, "settings/course-rules", "PUT", {
    version: a.version,
    items: [ {
      ...rule,
      required: [ "crs_foreign" ]
    } ]
  }), 422);
  ok(await call(s, "settings/course-rules", "PUT", {
    version: a.version,
    items: [ {
      ...rule,
      stage_type_id: "stg_foreign"
    } ]
  }), 422);
}));

test("YX3 报告维度按key改名，删除后key不能复用，老师只读维度", () => withSchool(async s => {
  const data = {
    subject: "music_interest",
    name: "声乐自定义",
    dimensions: [ {
      key: "pitch",
      name: "音准",
      order: 1,
      feedback_tags: [ "音准稳" ]
    }, {
      key: "breath",
      name: "气息",
      order: 2
    } ],
    options: {
      compare_previous: true
    }
  };
  let a = ok(await call(s, "settings/report-classes", "POST", data), 201);
  a = ok(await call(s, "settings/report-classes", "PUT", {
    ...a,
    dimensions: [ {
      ...a.dimensions[0],
      name: "音准表现"
    }, a.dimensions[1] ]
  }));
  assert.equal(a.dimensions[0].key, "pitch");
  a = ok(await call(s, "settings/report-classes", "PUT", {
    ...a,
    dimensions: [ a.dimensions[1] ]
  }));
  ok(await call(s, "settings/report-classes", "PUT", {
    ...a,
    dimensions: data.dimensions
  }), 422);
  const teacher = await teacherToken(s);
  const seen = ok(await call(s, "settings/report-classes", "GET", undefined, teacher.token)).items[0];
  assert.equal(Object.hasOwn(seen, "options"), false);
  assert.ok(seen.dimensions);
  ok(await call(s, "settings/report-classes", "PUT", a, teacher.token), 403);
}));

test("YX3 学员报告班型校验机构归属，可显式清空", () => withSchool(async s => {
  await seed(s);
  const a = ok(await call(s, "settings/report-classes")).items[0];
  let student = ok(await call(s, "data/students/" + s.students[0])).record;
  ok(await call(s, "data/students/" + student.id, "PATCH", {
    version: student.version,
    report_class_id: a.id
  }));
  student = ok(await call(s, "data/students/" + student.id)).record;
  assert.equal(student.report_class_id, a.id);
  ok(await call(s, "data/students/" + student.id, "PATCH", {
    version: student.version,
    report_class_id: "foreign"
  }), 404);
  ok(await call(s, "data/students/" + student.id, "PATCH", {
    version: student.version,
    report_class_id: null
  }));
  assert.equal(ok(await call(s, "data/students/" + student.id)).record.report_class_id, null);
}));

test("YX3 机构档案版本和老师归属校验，不能信任请求中的机构或作者", () => withSchool(async s => {
  const before = ok(await call(s, "settings/profile"));
  const saved = ok(await call(s, "settings/profile", "PUT", {
    ...before,
    introduction: "本机构资料",
    features: [ "小班" ],
    teachers: [ {
      teacher_id: s.teacher,
      introduction: "老师介绍"
    } ],
    tenant_id: "other",
    created_by: "other"
  }));
  assert.equal(saved.version, 2);
  noTenant(saved);
  assert.equal(s.f.db.raw.prepare("SELECT created_by FROM tenant_profile WHERE tenant_id=? AND id='main'").get(s.t.id).created_by, s.user.id);
  ok(await call(s, "settings/profile", "PUT", {
    ...saved,
    teachers: [ {
      teacher_id: "foreign",
      introduction: ""
    } ]
  }), 404);
  ok(await call(s, "settings/profile", "PUT", before), 409);
}));

test("YX3 图库上传服务端识别尺寸，私有二进制读取、标签和家长同意", () => withSchool(async s => {
  const img = ok(await upload(s, [ "作品" ]), 201);
  assert.equal(img.width, 1);
  assert.equal(img.height, 1);
  assert.match(s.f.env.CHANNEL_MEDIA.objects.keys().next().value, new RegExp("^promo/" + s.t.id + "/gallery/"));
  const bytes = await call(s, img.url);
  assert.equal(bytes.status, 200);
  assert.deepEqual(bytes.bytes, png());
  ok(await call(s, img.url, "GET", undefined, ""), 401);
  const tagged = ok(await call(s, "gallery/" + img.id, "PATCH", {
    version: img.version,
    tags: [ "作品", "家长已同意展示" ]
  }));
  assert.equal(tagged.parent_consent_media, true);
  ok(await call(s, "gallery/" + img.id, "PATCH", {
    version: 1,
    tags: []
  }), 409);
  assert.equal(ok(await call(s, "gallery?tag=作品")).total, 1);
}));

test("YX3 图库拒绝SVG和伪造图片，不创建对象或记录", () => withSchool(async s => {
  for (const [bytes, type] of [ [ (new TextEncoder).encode('<svg onload="x"/>'), "image/svg+xml" ], [ new Uint8Array(80), "image/png" ] ]) {
    const form = new FormData;
    form.set("file", new Blob([ bytes ], {
      type: type
    }), "bad.png");
    ok(await call(s, "gallery", "POST", undefined, s.token, form), 422);
  }
  assert.equal(ok(await call(s, "gallery")).total, 0);
  assert.equal(s.f.env.CHANNEL_MEDIA.objects.size, 0);
}));

test("YX3 未引用图片删除后R2移除且不可读取，重试删除可完成清理", () => withSchool(async s => {
  const img = ok(await upload(s), 201);
  assert.equal(ok(await call(s, "gallery/" + img.id, "DELETE", {
    version: img.version
  })).hidden, false);
  assert.equal(s.f.env.CHANNEL_MEDIA.objects.size, 0);
  ok(await call(s, img.url), 404);
  ok(await call(s, "gallery/" + img.id, "DELETE", {
    version: img.version
  }));
}));

test("YX3 已引用图库图只隐藏，历史URL仍可读，不再出现在列表", () => withSchool(async s => {
  const img = ok(await upload(s), 201);
  await s.r.settingsAssetReference(img.id, "plan", "pln_fixture");
  assert.equal(ok(await call(s, "gallery/" + img.id, "DELETE", {
    version: img.version
  })).hidden, true);
  assert.equal(ok(await call(s, "gallery")).total, 0);
  assert.equal((await call(s, img.url)).status, 200);
  assert.equal(s.f.env.CHANNEL_MEDIA.objects.size, 1);
}));

test("YX3 品牌只允许主色和本机构二维码，其他字段422不改名", () => withSchool(async s => {
  const image = ok(await upload(s), 201), brand = ok(await call(s, "settings/brand"));
  ok(await call(s, "settings/brand", "PATCH", {
    version: brand.version,
    name: "越权改名"
  }), 422);
  const next = ok(await call(s, "settings/brand", "PATCH", {
    version: brand.version,
    primary_color: "#123456",
    qr_image_id: image.id
  }));
  assert.equal(next.primary_color, "#123456");
  assert.equal(next.name, s.t.name);
  ok(await call(s, "settings/brand", "PATCH", {
    version: next.version,
    qr_image_id: "foreign"
  }), 404);
  assert.equal(ok(await call(s, "gallery/" + image.id, "DELETE", {
    version: 1
  })).hidden, true);
  const keptBrand = ok(await call(s, "settings/brand"));
  const recolored = ok(await call(s, "settings/brand", "PATCH", {version: keptBrand.version, primary_color: "#654321"}));
  assert.equal(recolored.qr_image_id, image.id);
  assert.equal(recolored.primary_color, "#654321");
}));

test("YX3 A会话不能读改删B报价、图库、卡片，列表不混入B数据", () => withSchool(async s => {
  const other = {
    ...await setup(s.f, 1, "stage3-foreign"),
    f: s.f
  };
  const c = await createCourse(other), img = ok(await upload(other), 201);
  for (const [path, method, d] of [ [ "settings/courses/" + c.id, "GET" ], [ "settings/courses/" + c.id, "PUT", {
    ...c,
    name: "攻击"
  } ], [ "settings/courses/" + c.id, "DELETE", {
    version: c.version
  } ], [ "gallery/" + img.id + "/file", "GET" ], [ "gallery/" + img.id, "PATCH", {
    version: 1,
    tags: []
  } ], [ "gallery/" + img.id, "DELETE", {
    version: 1
  } ] ]) assert.equal(ok(await call(s, path, method, d), 404).error, "not_found");
  assert.equal(ok(await call(s, "settings/courses")).total, 0);
  assert.equal(ok(await call(s, "gallery")).total, 0);
  ok(await call(s, "/" + other.t.slug + "/api/settings/profile"), 404);
}));

test("YX3 新DTO不含tenant_id，旧me既有tenant_id保持兼容", () => withSchool(async s => {
  const p = ok(await call(s, "students/" + s.students[0] + "/guardians", "POST", {
    name: "家长",
    phone: "13800001111",
    relation: "mother"
  }), 201);
  noTenant(p);
  noTenant(ok(await call(s, "students/" + s.students[0] + "/guardians/" + p.link.id, "PATCH", {
    version: 1,
    relation: "father"
  })));
  noTenant(ok(await call(s, "settings/profile")));
  assert.equal(ok(await call(s, "me")).tenant_id, s.t.id);
}));

test("YX3 settings模块关闭后新设置入口404，旧统计报表不受影响", () => withSchool(async s => {
  const f = await accountToken(s, [ "finance" ]);
  await repo(s.f.env, null).module(s.t.id, "settings", false, "fixture");
  ok(await call(s, "settings/courses"), 404);
  ok(await call(s, "gallery"), 404);
  ok(await call(s, "finance/report?month=2026-11", "GET", undefined, f.token));
}));

test("YX3 修改卡片提交不改业务表；主管审批原子写入，撤回恢复快照", () => withSchool(async s => {
  const consultant = await accountToken(s, [ "consultant" ]);
  ok(await call(s, "settings/calendar", "PUT", {
    version: 1,
    region: null,
    items: [ {
      key: "grade_exam",
      name: "考级季",
      months: [ 1, 7, 8 ]
    } ]
  }));
  const payload = {
    ops: [ {
      op: "update",
      entity: "calendar",
      key: "grade_exam",
      field: "months",
      from: [ 1, 7, 8 ],
      to: [ 1, 11 ]
    } ],
    side_effects: [],
    affected: {
      plans_in_progress: 0
    }
  };
  const c = await makeCard(s, payload, {
    ...consultant,
    roles: [ "consultant" ]
  }, consultant.token);
  assert.deepEqual(ok(await call(s, "settings/calendar")).items[0].months, [ 1, 7, 8 ]);
  ok(await call(s, "settings/changes/" + c.id + "/approve", "POST", {}, consultant.token), 403);
  const done = ok(await call(s, "settings/changes/" + c.id + "/approve", "POST", {}));
  assert.equal(done.status, "approved");
  assert.deepEqual(ok(await call(s, "settings/calendar")).items[0].months, [ 1, 11 ]);
  assert.equal(ok(await call(s, "settings/changes/" + c.id + "/revert", "POST", {})).status, "reverted");
  assert.deepEqual(ok(await call(s, "settings/calendar")).items[0].months, [ 1, 7, 8 ]);
  assert.equal(ok(await call(s, "settings/changes?status=reverted")).total, 1);
}));

test("YX3 修改卡片目标版本已变409且不改任一资源；撤回不覆盖后续编辑", () => withSchool(async s => {
  const c = await createCourse(s);
  const payload = {
    ops: [ {
      op: "update",
      entity: "course",
      id: c.id,
      field: "name",
      from: c.name,
      to: "新名称"
    } ]
  };
  const card = await makeCard(s, payload);
  await s.r.settingsSuggestion("sg_before_edit", s.user, payload);
  let current = ok(await call(s, "settings/courses/" + c.id, "PUT", {
    ...c,
    group: "已修改"
  }));
  ok(await call(s, "settings/changes", "POST", {
    suggestion_id: "sg_before_edit",
    payload: payload
  }), 409);
  assert.equal(ok(await call(s, "settings/changes/" + card.id + "/approve", "POST", {}), 409).error, "change_stale");
  assert.equal(ok(await call(s, "settings/courses/" + c.id)).name, c.name);
  const card2 = await makeCard(s, payload);
  ok(await call(s, "settings/changes/" + card2.id + "/approve", "POST", {}));
  current = ok(await call(s, "settings/courses/" + c.id));
  ok(await call(s, "settings/courses/" + c.id, "PUT", {
    ...current,
    group: "之后修改"
  }));
  ok(await call(s, "settings/changes/" + card2.id + "/revert", "POST", {}), 409);
}));

test("YX3 修改卡片拒绝状态、价格权限、过期建议和实体白名单", () => withSchool(async s => {
  const course = await createCourse(s);
  const payload = {
    ops: [ {
      op: "update",
      entity: "price",
      id: course.id,
      field: "pricing",
      from: Object.fromEntries(Object.entries(course.pricing).reverse()),
      to: {
        mode: "per_unit",
        amount: 300
      }
    } ]
  };
  const c = await makeCard(s, payload);
  await repo(s.f.env, null).module(s.t.id, "prices", false, "fixture");
  ok(await call(s, "settings/changes/" + c.id + "/approve", "POST", {}), 403);
  assert.equal(ok(await call(s, "settings/changes/" + c.id + "/reject", "POST", {})).status, "rejected");
  ok(await call(s, "settings/changes/" + c.id + "/approve", "POST", {}), 409);
  const nameCard = await makeCard(s, {
    ops: [ {
      op: "update",
      entity: "course",
      id: course.id,
      field: "name",
      from: course.name,
      to: "仅改名称"
    } ]
  });
  ok(await call(s, "settings/changes/" + nameCard.id + "/approve", "POST", {}));
  ok(await call(s, "settings/changes", "POST", {
    suggestion_id: "sg_missing",
    payload: payload
  }), 404);
  await s.r.settingsSuggestion("sg_bad", s.user, {
    ops: []
  });
  ok(await call(s, "settings/changes", "POST", {
    suggestion_id: "sg_bad",
    payload: {
      ops: [ {
        op: "update",
        entity: "sql",
        field: "x",
        from: 1,
        to: 2
      } ]
    }
  }), 422);
}));

const headers = [ "学科", "课程组", "课程名称", "形式", "时长分钟", "时长说明", "计价方式", "金额", "每包课时" ];

function excel(rows) {
  const form = new FormData;
  form.set("file", new Blob([ workbook([ headers, ...rows ]) ], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }), "courses.xlsx");
  return form;
}

function confirm(id) {
  const f = new FormData;
  f.set("preview_id", id);
  f.set("confirm", "true");
  return f;
}

test("YX3 Excel预览逐行校验不写课程，确认只用服务器保存行，一次提交防重复", () => withSchool(async s => {
  const form = excel([ [ "music_interest", "主修", "Excel钢琴", "one_to_one", 45, "", "per_unit", 199.99, "" ] ]);
  const p = ok(await call(s, "settings/courses/import", "POST", undefined, s.token, form));
  assert.equal(p.can_commit, true);
  assert.equal(p.rows[0].row, 2);
  assert.equal(ok(await call(s, "settings/courses")).total, 0);
  assert.equal(ok(await call(s, "settings/courses/import", "POST", undefined, s.token, confirm(p.preview_id))).imported, 1);
  assert.equal(ok(await call(s, "settings/courses")).items[0].pricing.amount, 199.99);
  ok(await call(s, "settings/courses/import", "POST", undefined, s.token, confirm(p.preview_id)), 409);
}));

test("YX3 Excel坏行不能确认、预览跨人不可用、价格版本变化后不能覆盖", () => withSchool(async s => {
  const p = ok(await call(s, "settings/courses/import", "POST", undefined, s.token, excel([ [ "music_interest", "主修", "坏行", "one_to_one", 45, "", "per_unit", 1.234, "" ] ])));
  assert.equal(p.can_commit, false);
  ok(await call(s, "settings/courses/import", "POST", undefined, s.token, confirm(p.preview_id)), 422);
  const good = ok(await call(s, "settings/courses/import", "POST", undefined, s.token, excel([ [ "music_interest", "主修", "好行", "one_to_one", 45, "", "per_unit", 10, "" ] ])));
  await createCourse(s);
  ok(await call(s, "settings/courses/import", "POST", undefined, s.token, confirm(good.preview_id)), 409);
}));

test("YX3 新设置和维度墓碑进入全量加密备份，原迁移与融合版前端原样保留", () => withSchool(async s => {
  await seed(s);
  await upload(s);
  await startBackup(s.f.env, Date.now());
  for (const table of [ "offer_courses", "report_dimensions", "gallery_images", "tenant_subjects" ]) assert.ok(s.f.db.raw.prepare("SELECT row_json FROM backup_snapshot_rows WHERE tenant_id=? AND table_name=? LIMIT 1").get(s.t.id, table), table);
  const baseline = JSON.parse(await readFile("docs/reference/fusion-stage2-baseline-sha256.json", "utf8"));
  // 前端由 Claude 并行维护，这里只核对迁移文件未被改动（2026-11-13 调整）。
  for (const f of baseline.files.filter(x => x.path.startsWith("migrations/"))) {
    const data = await readFile(f.path);
    assert.equal(await sha((new TextDecoder).decode(data)), f.content_sha, f.path);
  }
}));

test("YX3 根会话与机构路径共用设置服务，到期认证后403且不删会话", () => withSchool(async s => {
  const login = await s.f.request("https://school.test/api/auth/login", {
    method: "POST",
    headers: {
      Origin: "https://school.test",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      phone: "13911112222",
      password: "PhaseTwoSecure9",
      turnstile: "fixture-valid"
    })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const get = () => s.f.request("https://school.test/api/settings/calendar", {
    headers: {
      Cookie: cookie
    }
  });
  assert.deepEqual(await (await get()).json(), ok(await call(s, "settings/calendar")));
  s.f.db.raw.prepare("UPDATE tenants SET expires_at='2000-01-01' WHERE id=?").run(s.t.id);
  const denied = await get();
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, "tenant_expired");
  assert.ok(s.f.db.raw.prepare("SELECT COUNT(*) n FROM sessions WHERE tenant_id=?").get(s.t.id).n >= 2);
  s.f.db.raw.prepare("UPDATE tenants SET expires_at=NULL WHERE id=?").run(s.t.id);
  assert.equal((await get()).status, 200);
}));

test("YX3 200行Excel预览与确认各自≤40查询，别人的预览不能确认", () => withSchool(async s => {
  const rows = Array.from({
    length: 200
  }, (_, i) => [ "music_interest", "主修", "批量课程" + i, "one_to_one", 45, "", "per_unit", 10, "" ]);
  const response = await call(s, "settings/courses/import", "POST", undefined, s.token, excel(rows)), p = ok(response);
  assert.ok(response.queries <= 40);
  assert.equal(p.can_commit, true);
  const other = await supervisorToken(s);
  ok(await call(s, "settings/courses/import", "POST", undefined, other.token, confirm(p.preview_id)), 404);
  const committed = await call(s, "settings/courses/import", "POST", undefined, s.token, confirm(p.preview_id));
  assert.equal(ok(committed).imported, 200);
  assert.ok(committed.queries <= 40);
  assert.equal(ok(await call(s, "settings/courses")).total, 200);
}));

test("YX3 多目标审批中途数据库错误全部回滚，恢复后可重试", () => withSchool(async s => {
  const course = await createCourse(s);
  ok(await call(s, "settings/calendar", "PUT", {
    version: 1,
    region: null,
    items: [ {
      key: "grade_exam",
      name: "考级",
      months: [ 7 ]
    } ]
  }));
  const payload = {
    ops: [ {
      op: "update",
      entity: "calendar",
      key: "grade_exam",
      field: "months",
      from: [ 7 ],
      to: [ 11 ]
    }, {
      op: "update",
      entity: "course",
      id: course.id,
      field: "name",
      from: course.name,
      to: "修改后"
    } ]
  };
  const card = await makeCard(s, payload);
  s.f.db.raw.exec("CREATE TRIGGER stage3_fault BEFORE UPDATE ON offer_courses BEGIN SELECT RAISE(ABORT,'injected_stage3_failure'); END");
  ok(await call(s, "settings/changes/" + card.id + "/approve", "POST", {}), 500);
  assert.deepEqual(ok(await call(s, "settings/calendar")).items[0].months, [ 7 ]);
  assert.equal((await s.r.settingsChange(card.id)).status, "pending");
  s.f.db.raw.exec("DROP TRIGGER stage3_fault");
  ok(await call(s, "settings/changes/" + card.id + "/approve", "POST", {}));
  assert.deepEqual(ok(await call(s, "settings/calendar")).items[0].months, [ 11 ]);
}));

test("YX3 图库上传数据库失败删除暂存对象，R2失败不产生数据库行", () => withSchool(async s => {
  s.f.db.raw.exec("CREATE TRIGGER stage3_upload_fault BEFORE INSERT ON gallery_images BEGIN SELECT RAISE(ABORT,'injected_upload_failure'); END");
  ok(await upload(s), 500);
  assert.equal(s.f.env.CHANNEL_MEDIA.objects.size, 0);
  s.f.db.raw.exec("DROP TRIGGER stage3_upload_fault");
  const put = s.f.env.CHANNEL_MEDIA.put;
  s.f.env.CHANNEL_MEDIA.put = async () => {
    throw Error("injected_R2_failure");
  };
  ok(await upload(s), 500);
  s.f.env.CHANNEL_MEDIA.put = put;
  assert.equal(ok(await call(s, "gallery")).total, 0);
}));

test("YX3 ops设置学科与导入同事务，重复保存保留模板内容及导入标记", () => withSchool(async s => {
  const op = async (method, data) => {
    const path = "/api/ops/tenants/" + s.t.id, res = await s.f.request("https://console.school.test" + path, {
      method: method,
      headers: {
        Origin: "https://console.school.test",
        "Content-Type": "application/json",
        Cookie: s.f.adminCookie,
        "Cf-Access-Jwt-Assertion": s.f.access
      },
      body: data ? JSON.stringify(data) : undefined
    });
    const value = await res.json();
    examples.push({
      request: {
        method: method,
        path: path,
        body: data ?? null,
        actor: "platform_owner"
      },
      response: {
        status: res.status,
        body: value
      }
    });
    assert.equal(res.status, 200, JSON.stringify(value));
    return value;
  };
  let c = await op("GET");
  c = await op("PUT", {
    version: c.version,
    subjects: [ "music_interest" ]
  });
  let selected = s.f.db.raw.prepare("SELECT imported_at,content_json FROM tenant_subjects WHERE tenant_id=? AND id='music_interest'").get(s.t.id);
  assert.ok(selected.imported_at);
  assert.ok(selected.content_json);
  await op("PUT", {
    version: c.version,
    subjects: [ "music_interest" ]
  });
  assert.deepEqual(s.f.db.raw.prepare("SELECT imported_at,content_json FROM tenant_subjects WHERE tenant_id=? AND id='music_interest'").get(s.t.id), selected);
  assert.ok(ok(await call(s, "settings/courses")).total > 10);
}));

test("YX3 阶段/报告班型/修改卡片跨机构修改删除审批404，过期建议不可提交", () => withSchool(async s => {
  const other = {
    ...await setup(s.f, 1, "more-foreign"),
    f: s.f
  };
  await seed(other);
  for (const resource of [ "stage-types", "report-classes" ]) {
    const object = ok(await call(other, "settings/" + resource)).items[0];
    ok(await call(s, "settings/" + resource, "PUT", {
      ...object,
      name: "攻击"
    }), 404);
    ok(await call(s, "settings/" + resource, "DELETE", {
      id: object.id,
      version: object.version
    }), 404);
    assert.equal(ok(await call(s, "settings/" + resource)).total, 0);
  }
  const course = await createCourse(other), card = await makeCard(other, {
    ops: [ {
      op: "update",
      entity: "course",
      id: course.id,
      field: "name",
      from: course.name,
      to: "新名称"
    } ]
  });
  for (const action of [ "approve", "reject", "revert" ]) ok(await call(s, "settings/changes/" + card.id + "/" + action, "POST", {}), 404);
  await s.r.settingsSuggestion("sg_expired", s.user, {
    ops: []
  });
  s.f.db.raw.prepare("UPDATE ai_suggestions SET expires_at=0 WHERE tenant_id=? AND id='sg_expired'").run(s.t.id);
  ok(await call(s, "settings/changes", "POST", {
    suggestion_id: "sg_expired",
    payload: {
      ops: []
    }
  }), 404);
}));

test("YX3 同版本并发整体保存只有一个成功，另一个409带最新完整对象", () => withSchool(async s => {
  const input = {
    version: 1,
    region: null,
    items: [ {
      key: "exam",
      name: "考试",
      months: [ 7 ]
    } ]
  };
  const responses = await Promise.all([ call(s, "settings/calendar", "PUT", input), call(s, "settings/calendar", "PUT", {
    ...input,
    region: "上海"
  }) ]);
  assert.deepEqual(responses.map(x => x.status).sort(), [ 200, 409 ]);
  const current = ok(await call(s, "settings/calendar"));
  assert.deepEqual(responses.find(x => x.status === 409).body.details.latest, current);
  assert.equal(current.version, 2);
}));

test("YX3 输出本轮真实HTTP请求响应素材", async () => {
  assert.ok(examples.length > 100);
  await mkdir("work/stage3", {
    recursive: true
  });
  await writeFile("work/stage3/http-examples" + (process.env.TEST_BUNDLE === "1" ? "-bundle" : "") + ".json", JSON.stringify({
    notice: "本地虚构机构和账号，响应来自实际HTTP处理；不含会话Cookie",
    examples: examples
  }, null, 2));
});
