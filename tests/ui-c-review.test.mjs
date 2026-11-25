import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./support.mjs";
import {
  setup,
  request,
  accountToken,
  pack,
  mutate,
  lesson,
} from "./fixtures-credit.mjs";
import { adminCall } from "./fixtures-admin.mjs";

test("C复核：合作升学默认暂停，主管不能启用，机构和控制台接口拒绝，平台显式开启后恢复", async () => {
  const f = await fixture();
  try {
    f.db.raw
      .prepare("DELETE FROM platform_state WHERE id='referrals_enabled'")
      .run();
    const s = { ...(await setup(f, 1)), f };
    for (const method of ["GET", "POST"])
      assert.equal(
        (
          await request(
            s,
            "tools/referrals",
            method,
            method === "POST" ? {} : undefined,
          )
        ).status,
        403,
      );
    assert.equal(
      (await request(s, "me")).body.capabilities.referrals.read,
      false,
    );
    assert.equal((await adminCall(f, "me")).body.referrals_enabled, false);
    assert.equal((await adminCall(f, "referrals")).status, 404);
    assert.equal(
      (
        await adminCall(
          f,
          "tenants/" + s.t.id + "/business?path=%2Ftools%2Freferrals",
        )
      ).status,
      403,
    );
    assert.equal(
      (await s.call("settings", "PUT", { key: "REFERRALS_MODE", value: "on" }))
        .status,
      400,
    );
    assert.equal(
      (
        await adminCall(f, "platform/features/referrals", "PUT", {
          enabled: true,
        })
      ).status,
      200,
    );
    assert.equal((await request(s, "tools/referrals")).status, 200);
    assert.equal((await adminCall(f, "referrals")).status, 200);
  } finally {
    f.restore();
  }
});

test("C复核：收款与课时流水批量返回本机构学员姓名，学员仅见本人且查询预算不超限", async () => {
  const f = await fixture();
  try {
    const a = { ...(await setup(f, 2)), f };
    const b = { ...(await setup(f, 1, "b")), f };
    const renamed = await b.call("data/students/" + b.students[0], "PATCH", {
      version: 1,
      name: "外机构学员",
    });
    assert.equal(renamed.status, 200, renamed.text);
    for (const [s, id] of [
      [a, a.students[0]],
      [a, a.students[1]],
      [b, b.students[0]],
    ]) {
      const package_id = await pack(s, id);
      const result = await mutate(s, "credits/payments", {
        student_id: id,
        package_id,
        amount: 100,
        paid_at: "2026-11-04",
        method: "转账",
      });
      assert.equal(result.status, 200, result.text);
    }
    await a.call("settings", "PUT", {
      key: "student_view_payments",
      value: true,
    });
    await a.call("settings", "PUT", {
      key: "student_view_balance",
      value: true,
    });
    const learner = await accountToken(a, ["student"], a.students[0]);
    for (const kind of ["payments", "transactions"]) {
      const path = "credits/" + kind;
      const list = await request(a, path);
      assert.equal(list.status, 200, list.text);
      assert.ok(list.queries <= 40);
      assert.deepEqual(
        [...new Set(list.body.items.map((row) => row.student_name))].sort(),
        ["学员0", "学员1"],
      );
      assert.equal(
        (await request(a, path + "?student_id=" + b.students[0])).status,
        404,
      );
      const own = await request(a, path, "GET", undefined, learner.token);
      assert.equal(own.status, 200, own.text);
      assert.ok(own.body.items.length);
      assert.ok(
        own.body.items.every(
          (row) =>
            row.student_id === a.students[0] && row.student_name === "学员0",
        ),
      );
      const foreign = await request(b, path);
      assert.deepEqual(
        [...new Set(foreign.body.items.map((row) => row.student_name))],
        ["外机构学员"],
      );
    }
  } finally {
    f.restore();
  }
});

test("C复核：待办列表返回服务端总数，空页和续费分组分页准确", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f };
    await lesson(s, "2020-11-04T14:00");
    await pack(s, s.students[0], 1);
    for (const [path, expected] of [
      ["c2/unchecked", 1],
      ["c2/makeups", 0],
      ["c2/renewals?group=low", 1],
      ["c2/renewals?group=zero", 0],
      ["submissions?status=pending&from=2020-11-01&to=2020-11-30", 0],
    ]) {
      const page = await request(s, path);
      assert.equal(page.status, 200, page.text);
      assert.equal(page.body.total, expected, path);
      assert.equal(page.body.items.length, expected, path);
      assert.equal(page.body.next_offset, null);
      const beyond = await request(
        s,
        path + (path.includes("?") ? "&" : "?") + "offset=200",
      );
      assert.equal(beyond.status, 200, beyond.text);
      assert.equal(beyond.body.total, expected, path);
      assert.equal(beyond.body.items.length, 0);
      assert.ok(beyond.queries <= 40);
    }
  } finally {
    f.restore();
  }
});
