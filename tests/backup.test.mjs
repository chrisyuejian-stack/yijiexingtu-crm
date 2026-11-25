import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./support.mjs";
import {
  setup,
  request,
  pack,
  lesson,
  status,
  accountToken,
} from "./fixtures-credit.mjs";
import {
  startBackup,
  continueBackup,
  backupManifest,
  backupPage,
} from "../src/server/backup.js";
import { schoolFixture } from "./fixtures-school.mjs";
import { adminCall } from "./fixtures-admin.mjs";
const ok = (r, code = 200) => {
  assert.equal(r.status, code, r.text);
  assert.ok(r.queries <= 40);
  return r.body;
};
test("第六阶段：定时全库加密备份、30天保留、按机构恢复演练、保留安全配置/审计、撤销会话、他机构不变", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f)), f },
      b = { ...(await setup(f, 1, "b")), f };
    await pack(s);
    await pack(b);
    const lid = await lesson(s);
    await status(s, lid, "completed");
    const before = f.db.raw
      .prepare("SELECT name FROM students WHERE tenant_id=? ORDER BY id")
      .all(s.t.id);
    const other = f.db.raw
      .prepare("SELECT * FROM students WHERE tenant_id=?")
      .all(b.t.id);
    const security = f.db.raw
      .prepare("SELECT id,roles,digest FROM users WHERE tenant_id=?")
      .all(s.t.id);
    const backup = await startBackup(f.env);
    while (!(await continueBackup(f.env)).done) {}
    const manifest = await backupManifest(f.env, backup.id);
    assert.ok(manifest.files.length);
    const stored = [...f.env.CHANNEL_BACKUPS.objects.values()].join("");
    assert.ok(!stored.includes("学员"));
    assert.ok(!stored.includes("主管"));
    const student = f.db.raw
      .prepare("SELECT id,version FROM students WHERE tenant_id=? LIMIT 1")
      .get(s.t.id);
    ok(
      await request(s, "data/students/" + student.id, "PATCH", {
        version: student.version,
        name: "恢复前修改",
      }),
    );
    const job = ok(
      await adminCall(f, "tenants/" + s.t.id + "/jobs", "POST", {
        kind: "restore",
        backup_id: backup.id,
        reason: "本地按机构恢复演练",
      }),
    );
    for (const p of job.manifest.required)
      ok(
        await adminCall(
          f,
          "tenants/" + s.t.id + "/jobs/" + job.id + "/page",
          "POST",
          p,
        ),
      );
    ok(
      await adminCall(
        f,
        "tenants/" + s.t.id + "/jobs/" + job.id + "/commit",
        "POST",
        {},
      ),
    );
    assert.deepEqual(
      f.db.raw
        .prepare("SELECT name FROM students WHERE tenant_id=? ORDER BY id")
        .all(s.t.id),
      before,
    );
    assert.deepEqual(
      f.db.raw.prepare("SELECT * FROM students WHERE tenant_id=?").all(b.t.id),
      other,
    );
    assert.deepEqual(
      f.db.raw
        .prepare("SELECT id,roles,digest FROM users WHERE tenant_id=?")
        .all(s.t.id),
      security,
    );
    assert.equal(
      f.db.raw
        .prepare("SELECT COUNT(*) n FROM sessions WHERE tenant_id=?")
        .get(s.t.id).n,
      0,
    );
    assert.equal(
      f.db.raw.prepare("SELECT COUNT(*) n FROM trusted_imports").get().n,
      0,
    );
    assert.ok(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM audit_log WHERE tenant_id=? AND action='restore'",
        )
        .get(s.t.id).n,
    );
  } finally {
    f.restore();
  }
});
test("第六阶段：旧 JSON 只导空机构，购买课时不重复记账；旧密码和会话不迁移，错误预览无业务写入", async () => {
  const f = await fixture();
  try {
    const s = { ...(await schoolFixture(f, "old")), f };
    const raw = {
      students: [{ id: "s", name: "旧学员", phone: "13900000009" }],
      teachers: [{ id: "t", name: "旧教师" }],
      categories: [{ id: "c", name: "基础" }],
      courseTypes: [
        { id: "type", categoryId: "c", name: "一对一", format: "individual" },
      ],
      locations: [{ id: "room", name: "教室" }],
      packages: [
        {
          id: "pkg",
          studentId: "s",
          courseTypeId: "type",
          total: 10,
          date: "2026-11-01",
        },
      ],
      lessons: [
        {
          id: "l",
          teacherId: "t",
          courseTypeId: "type",
          locationId: "room",
          start: "2026-11-01T09:00",
          format: "individual",
          duration: 90,
          units: 0.5,
          status: "completed",
        },
      ],
      lessonParticipants: [
        {
          id: "p",
          lessonId: "l",
          studentId: "s",
          attendance: "attended",
          deducted: 0.5,
        },
      ],
      packageTransactions: [
        {
          id: "tx",
          packageId: "pkg",
          lessonParticipantId: "p",
          delta: -0.5,
          type: "consume",
          date: "2026-11-01",
        },
      ],
      teacherRates: [
        {
          id: "rate",
          teacherId: "t",
          courseTypeId: "type",
          format: "individual",
          rate: 200,
        },
      ],
      settlements: [
        {
          id: "lock",
          month: "2026-11",
          locked: true,
          total: 100,
          lockedAt: "2026-11-02T00:00:00Z",
        },
      ],
    };
    raw.crmTasks = [
      {
        id: "todo",
        studentId: "",
        title: "内部提醒",
        due: "",
        owner: "旧负责人",
        status: "open",
      },
    ];
    const counts = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, v.length]),
    );
    const job = ok(
      await adminCall(f, "tenants/" + s.t.id + "/jobs", "POST", {
        kind: "legacy",
        counts,
        settings: {},
        reason: "旧格式导入验收测试",
      }),
    );
    for (const [table, rows] of Object.entries(raw))
      ok(
        await adminCall(
          f,
          "tenants/" + s.t.id + "/jobs/" + job.id + "/page",
          "POST",
          { table, rows },
        ),
      );
    const preview = ok(
      await adminCall(
        f,
        "tenants/" + s.t.id + "/jobs/" + job.id + "/preview",
        "POST",
        {},
      ),
    );
    assert.equal(preview.counts.payroll_snapshots, 1);
    ok(
      await adminCall(
        f,
        "tenants/" + s.t.id + "/jobs/" + job.id + "/commit",
        "POST",
        {},
      ),
    );
    const bal = f.db.raw
      .prepare(
        "SELECT SUM(delta) balance FROM package_transactions WHERE tenant_id=?",
      )
      .get(s.t.id);
    assert.equal(bal.balance, 9.5);
    assert.equal(
      f.db.raw
        .prepare("SELECT amount FROM payroll_snapshots WHERE tenant_id=?")
        .get(s.t.id).amount,
      10000,
    );
    assert.equal(
      f.db.raw
        .prepare("SELECT duration FROM lessons WHERE tenant_id=?")
        .get(s.t.id).duration,
      90,
    );
    assert.equal(
      f.db.raw
        .prepare("SELECT COUNT(*) n FROM users WHERE tenant_id=?")
        .get(s.t.id).n,
      1,
    );
    ok(
      await adminCall(f, "tenants/" + s.t.id + "/jobs", "POST", {
        kind: "legacy",
        counts,
        settings: {},
        reason: "重复导入必须被拒绝",
      }),
      409,
    );
  } finally {
    f.restore();
  }
});

test("第六阶段：恢复缺页和新账号关联阻断；损坏备份拒绝；失败不留下可信导入标记或半恢复", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f)), f };
    await pack(s);
    const backup = await startBackup(f.env);
    while (!(await continueBackup(f.env)).done) {}
    const third = await s.create("students", { name: "备份后新增学员" });
    await accountToken(s, ["student"], third);
    const before = JSON.stringify(
      f.db.raw
        .prepare("SELECT * FROM students WHERE tenant_id=? ORDER BY id")
        .all(s.t.id),
    );
    const job = ok(
      await adminCall(f, "tenants/" + s.t.id + "/jobs", "POST", {
        kind: "restore",
        backup_id: backup.id,
        reason: "关联阻断恢复测试",
      }),
    );
    ok(
      await adminCall(
        f,
        "tenants/" + s.t.id + "/jobs/" + job.id + "/commit",
        "POST",
        {},
      ),
      409,
    );
    for (const page of job.manifest.required)
      ok(
        await adminCall(
          f,
          "tenants/" + s.t.id + "/jobs/" + job.id + "/page",
          "POST",
          page,
        ),
      );
    const blocked = await adminCall(
      f,
      "tenants/" + s.t.id + "/jobs/" + job.id + "/commit",
      "POST",
      {},
    );
    ok(blocked, 409);
    assert.ok(blocked.text.includes("验收账号"));
    assert.equal(
      JSON.stringify(
        f.db.raw
          .prepare("SELECT * FROM students WHERE tenant_id=? ORDER BY id")
          .all(s.t.id),
      ),
      before,
    );
    assert.equal(
      f.db.raw.prepare("SELECT COUNT(*) n FROM trusted_imports").get().n,
      0,
    );
    ok(
      await adminCall(
        f,
        "tenants/" + s.t.id + "/jobs/" + job.id + "/cancel",
        "POST",
        {},
      ),
    );
    const key = backup.id + "/manifest.enc";
    const original = f.env.CHANNEL_BACKUPS.objects.get(key);
    f.env.CHANNEL_BACKUPS.objects.set(
      key,
      original.replace(/"cipher":"./, '"cipher":"!'),
    );
    ok(
      await adminCall(f, "tenants/" + s.t.id + "/jobs", "POST", {
        kind: "restore",
        backup_id: backup.id,
        reason: "损坏备份验证拒绝",
      }),
      400,
    );
  } finally {
    f.restore();
  }
});
test("第六阶段：暂存快照不随日常写入改变，断点续传；只清理超过30天的本应用备份", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f)), f };
    const backup = await startBackup(f.env);
    const row = (await request(s, "data/students/" + s.students[0])).body
      .record;
    ok(
      await request(s, "data/students/" + row.id, "PATCH", {
        version: row.version,
        name: "快照后改名",
      }),
    );
    await continueBackup(f.env, Date.now(), 1);
    const oldDay = new Date(Date.now() - 32 * 86400000)
        .toISOString()
        .slice(0, 10),
      newDay = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
    await f.env.CHANNEL_BACKUPS.put(
      "daily/" + oldDay + "/bak_old/file.enc",
      "old",
    );
    await f.env.CHANNEL_BACKUPS.put(
      "daily/" + newDay + "/bak_new/file.enc",
      "keep",
    );
    await f.env.CHANNEL_BACKUPS.put("other/file.enc", "unrelated");
    while (!(await continueBackup(f.env)).done) {}
    const page = await backupPage(f.env, backup.id, "students", 0, s.t.id);
    assert.ok(page.rows.some((r) => r.id === row.id && r.name === row.name));
    assert.ok(!page.rows.some((r) => r.name === "快照后改名"));
    assert.ok(
      !f.env.CHANNEL_BACKUPS.objects.has(
        "daily/" + oldDay + "/bak_old/file.enc",
      ),
    );
    assert.ok(
      f.env.CHANNEL_BACKUPS.objects.has(
        "daily/" + newDay + "/bak_new/file.enc",
      ),
    );
    assert.ok(f.env.CHANNEL_BACKUPS.objects.has("other/file.enc"));
    assert.equal(
      f.db.raw.prepare("SELECT COUNT(*) n FROM backup_snapshot_rows").get().n,
      0,
    );
  } finally {
    f.restore();
  }
});
test("第六阶段：旧金额负数、三位小数和超精度课时在预览中拒绝，原业务不变；暂存手机号加密", async () => {
  const f = await fixture();
  try {
    for (const amount of [-100, 12.345]) {
      const s = await schoolFixture(
        f,
        "bad-" + String(amount).replace(/[^0-9]/g, ""),
      );
      const raw = {
        students: [{ id: "s", name: "旧学员", phone: "13900000007" }],
        studentPayments: [
          { id: "p", studentId: "s", date: "2026-11-01", amount },
        ],
      };
      const job = ok(
        await adminCall(f, "tenants/" + s.t.id + "/jobs", "POST", {
          kind: "legacy",
          counts: { students: 1, studentPayments: 1 },
          settings: {},
          reason: "异常金额预检测试",
        }),
      );
      for (const [table, rows] of Object.entries(raw))
        ok(
          await adminCall(
            f,
            "tenants/" + s.t.id + "/jobs/" + job.id + "/page",
            "POST",
            { table, rows },
          ),
        );
      assert.equal(
        f.db.raw
          .prepare(
            "SELECT COUNT(*) n FROM data_job_rows WHERE tenant_id=? AND row_json LIKE '%13900000007%'",
          )
          .get(s.t.id).n,
        0,
      );
      ok(
        await adminCall(
          f,
          "tenants/" + s.t.id + "/jobs/" + job.id + "/preview",
          "POST",
          {},
        ),
        400,
      );
      assert.equal(
        f.db.raw
          .prepare("SELECT COUNT(*) n FROM students WHERE tenant_id=?")
          .get(s.t.id).n,
        0,
      );
      ok(
        await adminCall(
          f,
          "tenants/" + s.t.id + "/jobs/" + job.id + "/cancel",
          "POST",
          {},
        ),
      );
    }
  } finally {
    f.restore();
  }
});
test("第六阶段：只读查看、限时代管、过期/撤销/机构间租约均不能写，维护留双审计；机构端没有旁路", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f)), f },
      b = { ...(await setup(f, 1, "b")), f };
    const row = (await request(s, "data/students/" + s.students[0])).body
        .record,
      path = "tenants/" + s.t.id;
    const payload = {
      path: "/data/students/" + row.id,
      method: "PATCH",
      data: { version: row.version, name: "维护改名" },
    };
    ok(await adminCall(f, path + "/operate", "POST", payload), 403);
    const lease = ok(
      await adminCall(f, path + "/maintenance", "POST", {
        reason: "安全边界维护验收",
      }),
    );
    ok(
      await adminCall(f, "tenants/" + b.t.id + "/operate", "POST", {
        ...payload,
        lease: lease.id,
      }),
      403,
    );
    ok(
      await adminCall(f, path + "/operate", "POST", {
        ...payload,
        lease: lease.id,
      }),
    );
    assert.ok(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM audit_log WHERE tenant_id=? AND actor_label='系统维护'",
        )
        .get(s.t.id).n,
    );
    ok(await adminCall(f, path + "/maintenance/" + lease.id, "DELETE", {}));
    ok(
      await adminCall(f, path + "/operate", "POST", {
        ...payload,
        lease: lease.id,
      }),
      403,
    );
    const expired = ok(
      await adminCall(f, path + "/maintenance", "POST", {
        reason: "到期租约拒绝写入",
      }),
    );
    f.db.raw
      .prepare(
        "UPDATE maintenance_leases SET expires_at=0 WHERE tenant_id=? AND id=?",
      )
      .run(s.t.id, expired.id);
    ok(
      await adminCall(f, path + "/operate", "POST", {
        ...payload,
        lease: expired.id,
      }),
      403,
    );
    ok(
      await request(s, path + "/operate", "POST", {
        ...payload,
        lease: expired.id,
      }),
      404,
    );
  } finally {
    f.restore();
  }
});

test("第六阶段：恢复提交中遇到数据库约束错误，全部业务和可信标记原子回滚", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f)), f };
    await pack(s);
    const backup = await startBackup(f.env);
    while (!(await continueBackup(f.env)).done) {}
    const before = JSON.stringify(
        f.db.raw
          .prepare("SELECT * FROM packages WHERE tenant_id=?")
          .all(s.t.id),
      ),
      flows = JSON.stringify(
        f.db.raw
          .prepare(
            "SELECT * FROM package_transactions WHERE tenant_id=? ORDER BY id",
          )
          .all(s.t.id),
      );
    const job = ok(
      await adminCall(f, "tenants/" + s.t.id + "/jobs", "POST", {
        kind: "restore",
        backup_id: backup.id,
        reason: "数据库异常原子回滚验证",
      }),
    );
    for (const page of job.manifest.required)
      ok(
        await adminCall(
          f,
          "tenants/" + s.t.id + "/jobs/" + job.id + "/page",
          "POST",
          page,
        ),
      );
    // Fault injection in the local adapter only: authenticated backup pages cannot be changed by an HTTP client.
    f.db.raw
      .prepare(
        "UPDATE data_job_rows SET row_json=json_set(row_json,'$.amount',-1) WHERE tenant_id=? AND job_id=? AND table_name='packages'",
      )
      .run(s.t.id, job.id);
    ok(
      await adminCall(
        f,
        "tenants/" + s.t.id + "/jobs/" + job.id + "/commit",
        "POST",
        {},
      ),
      500,
    );
    assert.equal(
      JSON.stringify(
        f.db.raw
          .prepare("SELECT * FROM packages WHERE tenant_id=?")
          .all(s.t.id),
      ),
      before,
    );
    assert.equal(
      JSON.stringify(
        f.db.raw
          .prepare(
            "SELECT * FROM package_transactions WHERE tenant_id=? ORDER BY id",
          )
          .all(s.t.id),
      ),
      flows,
    );
    assert.equal(
      f.db.raw.prepare("SELECT COUNT(*) n FROM trusted_imports").get().n,
      0,
    );
    ok(
      await adminCall(
        f,
        "tenants/" + s.t.id + "/jobs/" + job.id + "/cancel",
        "POST",
        {},
      ),
    );
  } finally {
    f.restore();
  }
});
