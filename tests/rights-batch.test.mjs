import { test } from "node:test";
import assert from "node:assert/strict";
import { sha } from "../src/server/core.js";
import { fixture } from "./support.mjs";
import { request } from "./fixtures-credit.mjs";
import { schoolFixture } from "./fixtures-school.mjs";

const changes = [
  { role: "academic", module: "students", action: "read", allowed: false },
  { role: "academic", module: "lessons", action: "create", allowed: true },
  { role: "finance", module: "tuition", action: "read", allowed: true },
];
const rights = (f, tenant) =>
  f.db.raw
    .prepare(
      "SELECT role,module,action,allowed,version FROM tenant_role_rights WHERE tenant_id=? ORDER BY id",
    )
    .all(tenant);
const audits = (f, tenant) =>
  f.db.raw
    .prepare(
      "SELECT summary FROM audit_log WHERE tenant_id=? AND action='rights'",
    )
    .all(tenant);

test("R1 批量权限：三项保存只撤销一次会话，另一机构不受影响", async () => {
  const f = await fixture();
  try {
    const a = { ...(await schoolFixture(f, "batch-a")), f };
    const b = { ...(await schoolFixture(f, "batch-b")), f };
    assert.equal((await request(b, "rights", "PUT", changes[0])).status, 200);
    await b.r.createSession(await sha(b.token), b.user, {
      ip: "fixture",
      ua: "fixture",
    });
    const before = rights(f, b.t.id);
    const batches = [];
    const executeBatch = f.db.batch.bind(f.db);
    f.db.batch = (statements) => {
      if (
        statements.some(({ query }) =>
          query.includes("INSERT INTO tenant_role_rights"),
        )
      ) {
        batches.push(statements.map(({ query }) => query));
      }
      return executeBatch(statements);
    };

    const response = await request(a, "rights", "PUT", {
      changes,
      tenant_id: b.t.id,
    });
    assert.equal(response.status, 200, response.text);
    assert.deepEqual(response.body, { ok: true });
    assert.equal(response.queries, 2);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 3);
    assert.equal(
      batches[0].filter((sql) => sql.includes("DELETE FROM sessions")).length,
      1,
    );
    assert.equal(
      batches[0].filter((sql) => sql.includes("INSERT INTO audit_log")).length,
      1,
    );
    const actual = rights(f, a.t.id);
    assert.equal(actual.length, 3);
    for (const change of changes) {
      const row = actual.find(
        (row) =>
          row.role === change.role &&
          row.module === change.module &&
          row.action === change.action,
      );
      assert.equal(row.allowed, Number(change.allowed));
      assert.equal(row.version, 1);
    }
    assert.deepEqual(
      audits(f, a.t.id).map((row) => row.summary),
      ["修改角色权限 3 项，机构会话已失效"],
    );
    assert.equal((await request(a, "me")).status, 401);
    assert.deepEqual(rights(f, b.t.id), before);
    assert.equal((await request(b, "me")).status, 200);
  } finally {
    f.restore();
  }
});

test("R1 批量权限：空数组、超限、非法项整批拒绝，合法重复以最后一项为准", async () => {
  const f = await fixture();
  try {
    const s = { ...(await schoolFixture(f, "batch-invalid")), f };
    for (const input of [
      [],
      Array(101).fill(changes[0]),
      [changes[0], null],
      [changes[0], { ...changes[1], role: "supervisor" }],
      [changes[0], { ...changes[1], module: "accounts" }],
      [changes[0], { ...changes[1], action: "manage_rights" }],
      [{ ...changes[0], allowed: 1 }, changes[0]],
    ]) {
      const r = await request(s, "rights", "PUT", { changes: input });
      assert.equal(r.status, 400, r.text);
    }
    assert.deepEqual(rights(f, s.t.id), []);
    assert.deepEqual(audits(f, s.t.id), []);
    assert.equal((await request(s, "me")).status, 200);
    const limit = await request(s, "rights", "PUT", {
      changes: [
        ...Array(99).fill(changes[0]),
        { ...changes[0], allowed: true },
      ],
    });
    assert.equal(limit.status, 200, limit.text);
    const stored = rights(f, s.t.id);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].allowed, 1);
    assert.equal(stored[0].version, 1);
  } finally {
    f.restore();
  }
});

test("R1 批量权限：旧格式兼容，教务和财务两种格式均拒绝", async () => {
  const f = await fixture();
  try {
    for (const role of ["academic", "finance"]) {
      const s = { ...(await schoolFixture(f, "batch-" + role, role)), f };
      for (const input of [changes[0], { changes }])
        assert.equal((await request(s, "rights", "PUT", input)).status, 403);
      assert.deepEqual(rights(f, s.t.id), []);
    }
    const s = { ...(await schoolFixture(f, "batch-legacy")), f };
    const r = await request(s, "rights", "PUT", changes[0]);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body, { ok: true });
    assert.equal(rights(f, s.t.id)[0].allowed, 0);
    assert.deepEqual(
      audits(f, s.t.id).map((row) => row.summary),
      ["修改角色权限，机构会话已失效"],
    );
    assert.equal((await request(s, "me")).status, 401);
  } finally {
    f.restore();
  }
});
