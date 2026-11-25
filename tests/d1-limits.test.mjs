import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixture, LocalD1 } from "./support.mjs";
import { setup, request } from "./fixtures-credit.mjs";
import { adminCall } from "./fixtures-admin.mjs";
import { repo } from "../src/server/repo.js";
import { schoolFixture } from "./fixtures-school.mjs";
import { decrypt } from "../src/server/crypto.js";
import { startBackup } from "../src/server/backup.js";
const basePNG = readFileSync(
  new URL("./assets/promo-logo-a.png", import.meta.url),
);
const image = (length) => {
  // A decodable PNG with a valid CRC-checked tEXt chunk, not a forged header.
  const prefix = "data:image/png;base64,";
  const bytes = Math.floor((length - prefix.length) / 4) * 3;
  const payload = Buffer.concat([
    Buffer.from("padding\0"),
    Buffer.alloc(bytes - basePNG.length - 20, 65),
  ]);
  const typeAndData = Buffer.concat([Buffer.from("tEXt"), payload]);
  let crc = 0xffffffff;
  for (const value of typeAndData) {
    crc ^= value;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4),
    footer = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return (
    prefix +
    Buffer.concat([
      basePNG.subarray(0, -12),
      header,
      typeAndData,
      footer,
      basePNG.subarray(-12),
    ]).toString("base64")
  );
};

test("D1限制模拟：模式50字节、单值/整行200万、参数100、SQL10万边界", async () => {
  const d = new LocalD1();
  try {
    assert.equal(
      (await d.prepare("SELECT ? LIKE ? AS n").bind("A", "a").first()).n,
      1,
    );
    await assert.rejects(
      d.prepare("SELECT ? LIKE ?").bind("x", "中".repeat(17)).first(),
      /D1_PATTERN/,
    );
    await assert.rejects(
      d.prepare("SELECT ? GLOB ?").bind("x", "x".repeat(51)).first(),
      /D1_PATTERN/,
    );
    assert.equal(
      (
        await d
          .prepare("SELECT ? GLOB ? AS n")
          .bind("x", "?".repeat(50))
          .first()
      ).n,
      0,
    );
    assert.throws(
      () => d.prepare("SELECT ?").bind(new Uint8Array(2000001)),
      /D1_VALUE/,
    );
    assert.equal(
      (await d.prepare("SELECT ? AS n").bind(new Uint8Array(2000000)).first()).n
        .length,
      2000000,
    );
    await assert.rejects(
      d.prepare("SELECT 'x' LIKE '" + "x".repeat(51) + "'").first(),
      /D1_PATTERN/,
    );
    assert.throws(
      () => d.prepare("SELECT ?").bind("x".repeat(2000001)),
      /D1_VALUE/,
    );
    assert.throws(
      () => d.prepare("SELECT 1").bind(...Array(101).fill(1)),
      /D1_TOO_MANY/,
    );
    assert.throws(
      () => d.prepare("SELECT 1 /*" + "x".repeat(100000) + "*/"),
      /D1_SQL/,
    );
    assert.equal(
      (await d.prepare("SELECT ? AS v").bind("x".repeat(2000000)).first()).v
        .length,
      2000000,
    );
    d.raw.exec("CREATE TABLE big(a TEXT,b TEXT)");
    await assert.rejects(
      d
        .prepare("INSERT INTO big VALUES(?,?)")
        .bind("x".repeat(1100000), "x".repeat(1000000))
        .run(),
      /D1_ROW/,
    );
    assert.equal(d.raw.prepare("SELECT COUNT(*) n FROM big").get().n, 0);
  } finally {
    d.limits.close();
    d.raw.close();
  }
});
test("D1回归：真实cf城市登录成功、同城不告警、异城一小时仅告警一次", async () => {
  const f = await fixture();
  try {
    const s = await setup(f, 0);
    for (const [city, n] of [
      ["上海", 0],
      ["上海", 0],
      ["北京", 1],
      ["北京", 1],
      ["上海", 1],
    ]) {
      const r = await f.request(
        "https://school.test/" + s.t.slug + "/api/login",
        {
          method: "POST",
          headers: {
            Origin: "https://school.test",
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.33",
          },
          cf: { country: "CN", city },
          body: JSON.stringify({
            phone: "13911112222",
            password: "PhaseTwoSecure9",
            turnstile: "fixture-valid",
          }),
        },
      );
      assert.equal(r.status, 200, await r.text());
      assert.equal(
        f.db.raw
          .prepare(
            "SELECT COUNT(*) n FROM platform_audit WHERE action='异地登录告警'",
          )
          .get().n,
        n,
      );
    }
  } finally {
    f.restore();
  }
});
test("D1回归：五类搜索100中文、百分号下划线反斜线字面匹配及ASCII大小写", async () => {
  const f = await fixture();
  try {
    const s = { ...(await setup(f, 1)), f };
    for (const table of [
      "students",
      "teachers",
      "course_categories",
      "course_types",
      "locations",
    ]) {
      f.db.raw
        .prepare("UPDATE " + table + " SET name=? WHERE tenant_id=?")
        .run("AbC%_\\测试", s.t.id);
      for (const [q, n] of [
        ["中".repeat(100), 0],
        ["%_\\", 1],
        ["abc", 1],
        ["%".repeat(100), 0],
      ]) {
        const r = await request(
          s,
          "data/" + table + "?q=" + encodeURIComponent(q),
        );
        assert.equal(r.status, 200, r.text);
        assert.equal(r.body.items.length, n);
      }
    }
  } finally {
    f.restore();
  }
});
test("D1回归：三张最大品牌图片可保存并备份，超限图片在写入前明确拒绝", async () => {
  const f = await fixture();
  try {
    const s = await setup(f, 0),
      img = image(260000);
    let detail = await adminCall(f, "tenants/" + s.t.id);
    const data = {
      ...detail.body.brand,
      logo: img,
      login_bg: img,
      consultant_qr: img,
      display_name: "品牌机构",
      theme_color: "#112233",
    };
    const r = await adminCall(f, "tenants/" + s.t.id + "/brand", "PUT", data);
    assert.equal(r.status, 200, r.text);
    const row = f.db.raw
      .prepare("SELECT * FROM tenant_branding WHERE tenant_id=?")
      .get(s.t.id);
    assert.ok(Buffer.byteLength(JSON.stringify(row)) < 800000);
    detail = await adminCall(f, "tenants/" + s.t.id);
    const too = await adminCall(f, "tenants/" + s.t.id + "/brand", "PUT", {
      ...data,
      version: detail.body.brand.version,
      logo: image(270000),
    });
    assert.equal(too.status, 413, too.text);
    const backup = await startBackup(f.env);
    assert.ok(backup.id);
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM backup_snapshot_rows WHERE snapshot_id=? AND table_name='tenant_branding' AND tenant_id=?",
        )
        .get(backup.id, s.t.id).n,
      1,
    );
  } finally {
    f.restore();
  }
});
test("D1回归：最大合法审计完整保留、批量审计按字节拆行且事务原子", async () => {
  const f = await fixture();
  try {
    const s = await setup(f, 0),
      r = repo(f.env, s.t.id),
      actor = { id: s.user.id, name: "主管" };
    // 4,000 characters is within the 6,000-character followup cap; a bulk history exceeds 2MB.
    const changes = Array.from({ length: 220 }, (_, i) => ({
      resource: "followup_notes",
      data: {
        id: "note_" + String(i).padStart(24, "0"),
        student_id: null,
        at: Date.now(),
        content: "中".repeat(4000),
      },
    }));
    // Followup FK needs an existing student; create it with the ordinary API.
    const res = await s.call("data/students", "POST", { name: "审计学员" });
    assert.equal(res.status, 200, res.text);
    for (const x of changes) x.data.student_id = res.body.id;
    const revision = await r.dataVersion();
    await r.commitBusiness(revision, changes, actor, "followups", "create");
    const rows = f.db.raw
      .prepare(
        "SELECT before_json,after_json FROM audit_log WHERE tenant_id=? AND module='followups'",
      )
      .all(s.t.id);
    assert.ok(rows.length > 10);
    assert.equal(rows.flatMap((x) => JSON.parse(x.after_json)).length, 220);
    for (const row of rows)
      assert.ok(
        Buffer.byteLength(row.before_json) +
          Buffer.byteLength(row.after_json) <=
          200000,
      );
    const before = f.db.raw
      .prepare("SELECT COUNT(*) n FROM followup_notes")
      .get().n;
    const too = [
      {
        ...changes[0],
        data: {
          ...changes[0].data,
          id: "note_reject",
          content: "x".repeat(210000),
        },
      },
    ];
    await assert.rejects(
      r.commitBusiness(
        await r.dataVersion(),
        too,
        actor,
        "followups",
        "create",
      ),
      (e) => e.status === 413,
    );
    assert.equal(
      f.db.raw.prepare("SELECT COUNT(*) n FROM followup_notes").get().n,
      before,
    );
    await startBackup(f.env);
  } finally {
    f.restore();
  }
});
test("D1回归：历史超大记录备份预检回滚，不产生半快照或SQLITE_TOOBIG", async () => {
  const f = await fixture();
  try {
    const s = await setup(f, 0);
    // Bypass application validation to represent pre-existing legacy data.
    f.db.raw
      .prepare(
        "UPDATE tenant_branding SET logo=?,login_bg=?,consultant_qr=? WHERE tenant_id=?",
      )
      .run(image(650000), image(650000), image(650000), s.t.id);
    await assert.rejects(
      startBackup(f.env),
      (e) => e.status === 413 && e.code === "D1_SIZE_LIMIT",
    );
    assert.equal(
      f.db.raw.prepare("SELECT COUNT(*) n FROM backup_snapshots").get().n,
      0,
    );
    assert.equal(
      f.db.raw.prepare("SELECT COUNT(*) n FROM backup_snapshot_rows").get().n,
      0,
    );
  } finally {
    f.restore();
  }
});
test("D1回归：清单/导入行超限预先拒绝，推广GLOB断言及JSON函数32参数生效", async () => {
  const {
    boundedText,
    MANIFEST_BUDGET,
    LEGACY_ROW_BUDGET,
    assertPattern,
    auditChunks,
    AUDIT_PAIR_BUDGET,
  } = await import("../src/server/d1-limits.js");
  assert.equal(
    boundedText("中".repeat(85333) + "x", MANIFEST_BUDGET, "清单").length,
    85334,
  );
  assert.throws(
    () => boundedText("中".repeat(85334), MANIFEST_BUDGET, "清单"),
    (e) => e.status === 413,
  );
  assert.throws(
    () =>
      boundedText(
        "x".repeat(LEGACY_ROW_BUDGET + 1),
        LEGACY_ROW_BUDGET,
        "旧数据单行",
      ),
    (e) => e.status === 413,
  );
  const pair = auditChunks([["x".repeat(AUDIT_PAIR_BUDGET - 12), null]]);
  assert.ok(
    Buffer.byteLength(pair[0][0]) + Buffer.byteLength(pair[0][1]) <=
      AUDIT_PAIR_BUDGET,
  );
  assert.throws(
    () => auditChunks([["x".repeat(AUDIT_PAIR_BUDGET), null]]),
    (e) => e.status === 413,
  );
  assert.equal(
    Buffer.byteLength(assertPattern("grp_" + "a".repeat(24) + ":*")),
    30,
  );
  assert.throws(
    () => assertPattern("中".repeat(17)),
    (e) => e.status === 503,
  );
  const d = new LocalD1();
  try {
    assert.throws(
      () =>
        d.prepare(
          "SELECT json_object(" + Array(17).fill("'k',1").join(",") + ")",
        ),
      /FUNCTION_ARGUMENTS/,
    );
  } finally {
    d.limits.close();
    d.raw.close();
  }
});
test("D1回归：50万字节旧JSON行加密暂存成功、超1字节拒绝且原行不变", async () => {
  const f = await fixture();
  try {
    const s = await schoolFixture(f);
    const job = await adminCall(f, "tenants/" + s.t.id + "/jobs", "POST", {
      kind: "legacy",
      counts: { students: 1 },
      settings: {},
      reason: "旧数据字节预算验收",
    });
    assert.equal(job.status, 200, job.text);
    const row = { id: "legacy_001", name: "历史学员", note: "" };
    row.note = "x".repeat(500000 - Buffer.byteLength(JSON.stringify(row)));
    const path = "tenants/" + s.t.id + "/jobs/" + job.body.id + "/page";
    const saved = await adminCall(f, path, "POST", {
      table: "students",
      rows: [row],
    });
    assert.equal(saved.status, 200, saved.text);
    const before = f.db.raw
      .prepare("SELECT row_json FROM data_job_rows WHERE job_id=?")
      .get(job.body.id).row_json;
    assert.ok(Buffer.byteLength(before) < 800000);
    const plain = await decrypt(
      f.env,
      JSON.parse(before).cipher,
      s.t.id + ":legacy:" + job.body.id,
    );
    assert.equal(Buffer.byteLength(plain), 500000);
    assert.deepEqual(JSON.parse(plain), row);
    row.note += "x";
    const rejected = await adminCall(f, path, "POST", {
      table: "students",
      rows: [row],
    });
    assert.equal(rejected.status, 413, rejected.text);
    assert.equal(
      f.db.raw
        .prepare("SELECT row_json FROM data_job_rows WHERE job_id=?")
        .get(job.body.id).row_json,
      before,
    );
  } finally {
    f.restore();
  }
});
test("D1回归：实际备份Worker两条Cron处理最大品牌行，宽表JSON保留null且可解密", async () => {
  const backupWorker =
    process.env.TEST_BUNDLE === "1"
      ? (await import("../backup-dist/backup-worker.js")).default
      : (await import("../src/server/backup.js")).default;
  const { backupManifest, open } = await import("../src/server/backup.js");
  const f = await fixture();
  try {
    const s = await setup(f, 0);
    const detail = await adminCall(f, "tenants/" + s.t.id);
    const img = image(260000);
    const put = await adminCall(f, "tenants/" + s.t.id + "/brand", "PUT", {
      ...detail.body.brand,
      logo: img,
      login_bg: img,
      consultant_qr: img,
    });
    assert.equal(put.status, 200, put.text);
    await backupWorker.scheduled(
      { cron: "0 19 * * *", scheduledTime: Date.now() },
      f.env,
      {},
    );
    let n = 0;
    while (
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM backup_snapshots WHERE status='running'",
        )
        .get().n &&
      n++ < 20
    )
      await backupWorker.scheduled(
        { cron: "*/5 * * * *", scheduledTime: Date.now() },
        f.env,
        {},
      );
    const snapshot = f.db.raw
      .prepare(
        "SELECT id,status FROM backup_snapshots ORDER BY at DESC LIMIT 1",
      )
      .get();
    assert.equal(snapshot.status, "completed");
    const manifest = await backupManifest(f.env, snapshot.id);
    const file = manifest.files.find((x) => x.table === "tenant_branding");
    const object = await f.env.CHANNEL_BACKUPS.get(file.key);
    const page = await open(f.env, JSON.parse(await object.text()), file.key);
    assert.equal(page.rows[0].logo, img);
    assert.equal(page.rows[0].login_bg, img);
    assert.equal(page.rows[0].consultant_qr, img);
    const userFile = manifest.files.find((x) => x.table === "users");
    const userObject = await f.env.CHANNEL_BACKUPS.get(userFile.key);
    const record = (
      await open(f.env, JSON.parse(await userObject.text()), userFile.key)
    ).rows[0];
    assert.equal(record.teacher_id, null);
    assert.equal(record.student_id, null);
    assert.equal(
      (await backupWorker.fetch(new Request("https://backup.test/"), f.env, {}))
        .status,
      404,
    );
  } finally {
    f.restore();
  }
});
