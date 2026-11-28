import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./support.mjs";
import { setup } from "./fixtures-credit.mjs";
import { schoolFixture } from "./fixtures-school.mjs";
import { school, call, ok, filled, parent } from "./fixtures-plans.mjs";
import { createV2, manualDoc } from "./fixtures-v2.mjs";
import { ops } from "./fixtures-platform.mjs";
import { renderPlan } from "../src/server/plan-view.js";
import { renderV2 } from "../src/server/plan-v2-view.js";
import { computeV2 } from "../src/server/plan-v2-math.js";
import { computePlan } from "../src/server/plan-math.js";

const PASSWORD = "PhaseTwoSecure9";
const postJson = async (f, path, body, extraHeaders = {}) => {
  const res = await f.request("https://school.test" + path, {
    method: "POST",
    headers: {
      Origin: "https://school.test",
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test("G1：非法手机号独立限流，不会锁死真实账号 13800000000（租户路径与根路径）", async () => {
  const f = await fixture();
  try {
    f.env.TURNSTILE_MODE = "off";
    const s = await schoolFixture(f, "g1");
    s.f = f;
    const created = ok(
      await call(s, "accounts", "POST", {
        phone: "13800000000",
        name: "真实一三八用户",
        roles: ["academic"],
      }),
      201,
    );
    for (let i = 0; i < 3; i++) {
      assert.equal(
        (await postJson(f, "/" + s.t.slug + "/api/auth/login", { phone: "not-a-phone", password: "Bad" })).status,
        401,
      );
    }
    // 13800000000 仍能用正确密码登录（机构路径）
    assert.equal(
      (await postJson(f, "/" + s.t.slug + "/api/auth/login", { phone: "13800000000", password: created.temporary_password })).status,
      200,
    );

    // 根路径连续 3 次非法手机号也不会锁死全平台索引的 13800000000
    for (let i = 0; i < 3; i++) {
      assert.equal(
        (await postJson(f, "/api/auth/login", { phone: "not-a-phone", password: "Bad" })).status,
        401,
      );
    }
    assert.equal(
      (await postJson(f, "/api/auth/login", { phone: "13800000000", password: created.temporary_password })).status,
      200,
    );
  } finally {
    f.restore();
  }
});

test("G2：租户登录 IP 限流按 tenant_id 隔离，A 机构失败不锁同 IP 的 B 机构", async () => {
  const f = await fixture();
  try {
    f.env.TURNSTILE_MODE = "off";
    const a = await schoolFixture(f, "ip-a");
    const b = await schoolFixture(f, "ip-b");
    const ip = { "CF-Connecting-IP": "203.0.113.10" };
    for (let i = 0; i < 10; i++) {
      assert.equal(
        (await postJson(f, "/" + a.t.slug + "/api/auth/login", { phone: "139" + String(10000000 + i), password: "WrongPassword9" }, ip)).status,
        401,
      );
    }
    // A 机构已被同一 IP 锁住
    assert.equal(
      (await postJson(f, "/" + a.t.slug + "/api/auth/login", { phone: "13911112222", password: PASSWORD }, ip)).status,
      401,
    );
    // 同 IP 访问 B 机构仍可正常登录
    assert.equal(
      (await postJson(f, "/" + b.t.slug + "/api/auth/login", { phone: "13911112222", password: PASSWORD }, ip)).status,
      200,
    );
  } finally {
    f.restore();
  }
});

test("G3：费用或课程模块隐藏及关闭单价时，渲染与家长列表不泄漏对应金额", () =>
  school(async (s) => {
    const pa = await parent(s);

    // v2: 费用隐藏 -> 剔除 total/subtotal/discount/installments/budget/stages/lines 金额，包括家长列表
    const dFeeOff = manualDoc(s, null, false);
    dFeeOff.modules.courses.lines[0].manual_unit_price = 200;
    dFeeOff.modules.fees.visible = false;
    let pFeeOff = await createV2(s, dFeeOff);
    pFeeOff = ok(await call(s, "plans/" + pFeeOff.id + "/send", "POST", { version: pFeeOff.version, acknowledgements: { manual_pricing: true } }));
    const linkFeeOff = ok(await call(s, "plans/" + pFeeOff.id + "/share-links", "POST", {}), 201);
    for (const r of [
      ok(await call(s, "parent/plans/" + pFeeOff.id, "GET", undefined, pa.token)),
      ok(await call(s, "/api/share/" + linkFeeOff.url.split("/").at(-1), "GET", undefined, null)),
    ]) {
      const c = r.render_data.computed;
      assert.equal(r.render_data.modules.fees.visible, false);
      assert.equal(c.total.amount, undefined);
      assert.equal(c.total.known_amount, undefined);
      assert.equal(c.subtotal, undefined);
      assert.equal(c.discount, undefined);
      assert.deepEqual(c.installments, []);
      assert.deepEqual(c.optional_fees, []);
      assert.equal(c.budget, undefined);
      assert.equal(c.budget_comparison, undefined);
      assert.equal(c.stages[0].amount, undefined);
      assert.equal(c.stages[0].known_amount, undefined);
      assert.equal(c.lines[0].amount, undefined);
    }
    const parentList = ok(await call(s, "plans", "GET", undefined, pa.token));
    const listedFeeOff = parentList.items.find((x) => x.id === pFeeOff.id);
    assert.equal(listedFeeOff.total.amount, undefined);
    assert.equal(listedFeeOff.total.known_amount, undefined);

    // v2: 课程隐藏 -> 清空 lines/bundles/阶段金额；show_unit_price=false -> 剔除 computed.lines[].amount，同时保留费用可见时的 total
    const dCourseOff = manualDoc(s);
    Object.assign(dCourseOff.modules.courses.lines[0], { billing_mode: "per_unit", manual_unit_price: 200 });
    dCourseOff.modules.courses.visible = false;
    dCourseOff.computed = computeV2(dCourseOff);
    const rvCourseOff = renderV2(
      { id: "pln_c", updated_at: Date.now() },
      { id: "rev_c", doc_json: JSON.stringify(dCourseOff), manifest_json: "{}" },
      { student: { name: "周小雨", nickname: "周同学", parent_consent_media: true }, brand: { name: "艺界" } },
      "/api/share/t/media",
    );
    assert.deepEqual(rvCourseOff.render_data.computed.lines, []);
    assert.deepEqual(rvCourseOff.render_data.computed.total.bundles, []);
    assert.equal(rvCourseOff.render_data.computed.stages[0].amount, undefined);
    assert.equal(rvCourseOff.render_data.computed.stages[0].known_amount, undefined);

    const dUnitOff = manualDoc(s);
    Object.assign(dUnitOff.modules.courses.lines[0], { billing_mode: "per_unit", manual_unit_price: 200 });
    dUnitOff.style.show_unit_price = false;
    dUnitOff.computed = computeV2(dUnitOff);
    const rvUnitOff = renderV2(
      { id: "pln_u", updated_at: Date.now() },
      { id: "rev_u", doc_json: JSON.stringify(dUnitOff), manifest_json: "{}" },
      { student: { name: "周小雨", nickname: "周同学", parent_consent_media: true }, brand: { name: "艺界" } },
      "/api/share/t/media",
    );
    assert.equal(rvUnitOff.render_data.computed.lines[0].amount, undefined);
    assert.equal(rvUnitOff.render_data.computed.total.amount, 400);

    // v1: renderPlan 在费用或课程隐藏时同样剔除 computed 金额
    const v1 = await filled(s);
    const v1Rev = await s.r.planRevision(v1.id, v1.current_revision_id);
    const v1Doc = JSON.parse(v1Rev.doc_json);
    v1Doc.modules.fees.visible = false;
    v1Doc.computed = computePlan(v1Doc);
    const rv1FeeOff = renderPlan(
      { id: v1.id, updated_at: Date.now() },
      { id: v1Rev.id, doc_json: JSON.stringify(v1Doc), manifest_json: v1Rev.manifest_json },
      { student: { name: "学员", nickname: "学同学", parent_consent_media: true }, brand: { name: "艺界" }, profile: {}, teachers: [] },
      "/api/share/t/media",
    );
    assert.equal(rv1FeeOff.render_data.computed.total.amount, undefined);
    assert.deepEqual(rv1FeeOff.render_data.computed.installments, []);
    assert.equal(rv1FeeOff.render_data.computed.budget, undefined);
    assert.equal(rv1FeeOff.render_data.computed.stages[0].amount, undefined);

    v1Doc.modules.fees.visible = true;
    v1Doc.modules.courses.visible = false;
    const rv1CourseOff = renderPlan(
      { id: v1.id, updated_at: Date.now() },
      { id: v1Rev.id, doc_json: JSON.stringify(v1Doc), manifest_json: v1Rev.manifest_json },
      { student: { name: "学员", nickname: "学同学", parent_consent_media: true }, brand: { name: "艺界" }, profile: {}, teachers: [] },
      "/api/share/t/media",
    );
    assert.equal(rv1CourseOff.render_data.computed.stages[0].amount, undefined);
    assert.deepEqual(rv1CourseOff.render_data.computed.optional_fees, []);
    assert.deepEqual(rv1CourseOff.render_data.computed.total.bundles, []);
  }));

test("G4：未同意展示媒体时，v1/v2 标题正文及单字名、非纯汉字名统一脱敏且不泄露原名", () =>
  school(async (s) => {
    // v1：标题、测评、目标里的法定姓名一并脱敏
    const v1 = await filled(s);
    const v1Rev = await s.r.planRevision(v1.id, v1.current_revision_id);
    const v1Doc = JSON.parse(v1Rev.doc_json);
    v1Doc.title = "张三的方案";
    v1Doc.modules.assessment.text = "张三节奏不稳";
    v1Doc.modules.assessment.goals = ["张三冲刺"];
    const rv1 = renderPlan(
      { id: v1.id, updated_at: Date.now() },
      { id: v1Rev.id, doc_json: JSON.stringify(v1Doc), manifest_json: v1Rev.manifest_json },
      { student: { name: "张三", nickname: "张同学", parent_consent_media: false }, brand: { name: "艺界" }, profile: {}, teachers: [] },
      "/api/share/t/media",
    );
    assert.equal(rv1.render_data.student.display_name, "张同学");
    assert.ok(!JSON.stringify(rv1).includes("张三"));

    // v2 单字名：独立出现的「李」脱敏，词内「行李」不被误伤
    const dSingle = manualDoc(s, null, false);
    dSingle.title = "李的学习方案";
    dSingle.modules.basic.student_name = "李";
    dSingle.modules.assessment.text = "李今天节奏不稳；请自备行李";
    dSingle.computed = computeV2(dSingle);
    const rvSingle = renderV2(
      { id: "pln_s", updated_at: Date.now() },
      { id: "rev_s", doc_json: JSON.stringify(dSingle), manifest_json: "{}" },
      { student: { name: "李", nickname: "小同学", parent_consent_media: false }, brand: { name: "艺界" } },
      "/api/share/t/media",
    );
    assert.equal(rvSingle.render_data.modules.assessment.text, "小同学今天节奏不稳；请自备行李");
    assert.equal(rvSingle.render_data.title, "小同学的学习方案");

    // v2 非纯汉字名（John Smith、张·三）：未填单独昵称时回退「同学」，不回传原名
    for (const legalName of ["John Smith", "张·三"]) {
      const dForeign = manualDoc(s, null, false);
      dForeign.title = legalName + " 的方案";
      dForeign.modules.basic.student_name = legalName;
      dForeign.modules.assessment.text = legalName + " 音准较好";
      dForeign.computed = computeV2(dForeign);
      const rv = renderV2(
        { id: "pln_f", updated_at: Date.now() },
        { id: "rev_f", doc_json: JSON.stringify(dForeign), manifest_json: "{}" },
        { student: { name: legalName, nickname: legalName, parent_consent_media: false }, brand: { name: "艺界" } },
        "/api/share/t/media",
      );
      assert.equal(rv.render_data.student.display_name, "同学");
      assert.equal(rv.render_data.student.nickname, "同学");
      assert.ok(!JSON.stringify(rv).includes(legalName), `仍包含原名 ${legalName}`);
    }
  }));

test("G6：停用或到期机构的公开品牌接口返回与未知代号一致的占位信息", async () => {
  const f = await fixture();
  try {
    const s = await setup(f, 1, "probe");
    const unknownRes = await f.request("https://school.test/api/public/tenant-brand?slug=missing-slug-999");
    assert.equal(unknownRes.status, 200);
    const placeholder = await unknownRes.json();

    // 停用前返回真实机构名
    const activeRes = await f.request("https://school.test/api/public/tenant-brand?slug=" + s.t.slug);
    assert.equal((await activeRes.json()).name, s.t.name);

    // 停用后与未知代号完全一致
    const cfg = ok(await ops(f, "tenants/" + s.t.id));
    ok(await ops(f, "tenants/" + s.t.id + "/suspend", "POST", { version: cfg.version, reason: "停用排查" }));
    const pausedRes = await f.request("https://school.test/api/public/tenant-brand?slug=" + s.t.slug);
    assert.equal(pausedRes.status, 200);
    assert.deepEqual(await pausedRes.json(), placeholder);

    // 恢复后设过期时间同样返回占位
    const cfg2 = ok(await ops(f, "tenants/" + s.t.id));
    ok(await ops(f, "tenants/" + s.t.id + "/resume", "POST", { version: cfg2.version, reason: "恢复" }));
    f.db.raw.prepare("UPDATE tenants SET expires_at='2020-01-01' WHERE id=?").run(s.t.id);
    const expiredRes = await f.request("https://school.test/api/public/tenant-brand?slug=" + s.t.slug);
    assert.equal(expiredRes.status, 200);
    assert.deepEqual(await expiredRes.json(), placeholder);
  } finally {
    f.restore();
  }
});
