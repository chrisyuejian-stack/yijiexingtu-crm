import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture } from "./support.mjs";
import { setup, request, accountToken } from "./fixtures-credit.mjs";
import { adminCall } from "./fixtures-admin.mjs";
import { cleanupPromoUploads } from "../src/server/backup.js";
import sourceBackup from "../src/server/backup.js";
const backupWorker =
  process.env.TEST_BUNDLE === "1"
    ? (await import("../backup-dist/backup-worker.js")).default
    : sourceBackup;
const image =
  "data:image/png;base64," +
  (
    await readFile(new URL("./assets/promo-logo-a.png", import.meta.url))
  ).toString("base64");
const imageBytes = Buffer.from(image.split(",")[1], "base64").length;
const ok = (r, code = 200) => {
  assert.equal(r.status, code, r.text);
  assert.ok(r.queries <= 40);
  return r.body;
};
const context = async (f, suffix = "a") => ({
  ...(await setup(f, 1, suffix)),
  f,
});
const start = async (s) => ok(await request(s, "promo/images", "POST", {})).id;
const part = async (s, id) =>
  ok(
    await request(s, "promo/images/" + id + "/part", "POST", {
      index: 0,
      data: image,
    }),
  );
const finish = (s, id) =>
  request(s, "promo/images/" + id + "/complete", "POST", {});
function seed(f, s, n, bytes = 1) {
  for (let i = 0; i < n; i++)
    f.db.raw
      .prepare(
        "INSERT INTO promo_images(id,tenant_id,owner_id,kind,bytes,ready,created_at) VALUES(?,?,?,'brand',?,1,?)",
      )
      .run(
        "img_" + crypto.randomUUID().replaceAll("-", "").slice(0, 24),
        s.t.id,
        s.user.id,
        bytes,
        Date.now(),
      );
}
test("第八阶段收尾：每机构未完成上传最多5个，跨账号共享配额、并发不能突破，其他机构和平台不受限", async () => {
  const f = await fixture();
  try {
    const a = await context(f),
      b = await context(f, "b"),
      academic = await accountToken(a, ["academic"]);
    for (let i = 0; i < 4; i++) await start(a);
    const race = await Promise.all([
      request(a, "promo/images", "POST", {}),
      request(a, "promo/images", "POST", {}, academic.token),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    ok(await request(a, "promo/images", "POST", {}), 409);
    await start(b);
    for (let i = 0; i < 6; i++)
      ok(await adminCall(f, "promo/images", "POST", {}));
    const task = f.db.raw
      .prepare(
        "SELECT id FROM promo_images WHERE tenant_id=? AND ready=0 AND owner_id=? LIMIT 1",
      )
      .get(a.t.id, a.user.id);
    await part(a, task.id);
    ok(await finish(a, task.id));
    await start(a);
  } finally {
    f.restore();
  }
});
test("第八阶段收尾：完成图片50张/100MB原子限制，边界允许、并发拒绝超额，平台素材豁免", async () => {
  const f = await fixture();
  try {
    const a = await context(f),
      b = await context(f, "b");
    seed(f, a, 49);
    const ids = [await start(a), await start(a)];
    for (const id of ids) await part(a, id);
    const race = await Promise.all(ids.map((id) => finish(a, id)));
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) n FROM promo_images WHERE tenant_id=? AND ready=1",
        )
        .get(a.t.id).n,
      50,
    );
    seed(f, b, 1, 104857600 - imageBytes);
    const exact = await start(b);
    await part(b, exact);
    ok(await finish(b, exact));
    const excess = await start(b);
    await part(b, excess);
    const denied = await finish(b, excess);
    ok(denied, 409);
    assert.match(denied.text, /100MB/);
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT SUM(bytes) n FROM promo_images WHERE tenant_id=? AND ready=1",
        )
        .get(b.t.id).n,
      104857600,
    );
    const platform = { t: { id: "platform" }, user: { id: "adm_fixture" } };
    seed(f, platform, 51, 104857600);
    const pid = ok(await adminCall(f, "promo/images", "POST", {})).id;
    ok(
      await adminCall(f, "promo/images/" + pid + "/part", "POST", {
        index: 0,
        data: image,
      }),
    );
    ok(await adminCall(f, "promo/images/" + pid + "/complete", "POST", {}));
  } finally {
    f.restore();
  }
});
test("第八阶段收尾：5分钟Cron清理超24小时任务及全部分片/孤立对象，保留新任务和完成图；失败重试且不影响备份", async () => {
  const f = await fixture();
  try {
    const a = await context(f),
      b = await context(f, "b"),
      expired = await start(a),
      fresh = await start(b),
      ready = await start(a);
    await part(a, expired);
    await part(b, fresh);
    await part(a, ready);
    ok(await finish(a, ready));
    const prefix = "promo/" + a.t.id + "/" + expired + "/";
    await f.env.CHANNEL_MEDIA.put(prefix + "part/orphan", "orphan");
    await f.env.CHANNEL_MEDIA.put(prefix + "image", "orphan");
    f.db.raw
      .prepare("UPDATE promo_images SET created_at=? WHERE id=?")
      .run(Date.now() - 86400001, expired);
    ok(
      await request(a, "promo/images/" + expired + "/complete", "POST", {}),
      409,
    );
    const rawDelete = f.env.CHANNEL_MEDIA.delete.bind(f.env.CHANNEL_MEDIA);
    let failOnce = true;
    f.env.CHANNEL_MEDIA.delete = async (keys) => {
      if (failOnce) {
        failOnce = false;
        throw Error("模拟R2暂时失败");
      }
      return rawDelete(keys);
    };
    await assert.rejects(
      backupWorker.scheduled(
        { cron: "*/5 * * * *", scheduledTime: Date.now() },
        f.env,
        {},
      ),
      /模拟R2/,
    );
    assert.equal(
      f.db.raw.prepare("SELECT ready FROM promo_images WHERE id=?").get(expired)
        .ready,
      -1,
    );
    ok(
      await request(a, "promo/assets", "PUT", {
        logo_key: expired,
        qr_key: null,
      }),
      400,
    );

    const measured = await f.db.measure(async () => {
      await backupWorker.scheduled(
        { cron: "*/5 * * * *", scheduledTime: Date.now() },
        f.env,
        {},
      );
      return Response.json({ ok: true });
    });
    assert.ok(Number(measured.headers.get("x-test-d1-queries")) <= 40);
    assert.equal(
      f.db.raw.prepare("SELECT id FROM promo_images WHERE id=?").get(expired),
      undefined,
    );
    assert.ok(
      ![...f.env.CHANNEL_MEDIA.objects.keys()].some((k) =>
        k.startsWith(prefix),
      ),
    );
    assert.ok(
      f.db.raw.prepare("SELECT id FROM promo_images WHERE id=?").get(fresh),
    );
    assert.ok(
      await f.env.CHANNEL_MEDIA.get("promo/" + a.t.id + "/" + ready + "/image"),
    );
    ok(
      await request(a, "promo/images/" + expired + "/part", "POST", {
        index: 0,
        data: image,
      }),
      404,
    );
  } finally {
    f.restore();
  }
});
test("第八阶段收尾：过期清理与在途分片竞态不会留下孤立R2对象", async () => {
  const f = await fixture();
  try {
    const a = await context(f),
      id = await start(a),
      prefix = "promo/" + a.t.id + "/" + id + "/",
      raw = f.env.CHANNEL_MEDIA.put.bind(f.env.CHANNEL_MEDIA);
    f.env.CHANNEL_MEDIA.put = async (key, data) => {
      await raw(key, data);
      await cleanupPromoUploads(f.env, Date.now() + 86400001);
    };
    ok(
      await request(a, "promo/images/" + id + "/part", "POST", {
        index: 0,
        data: image,
      }),
      409,
    );
    assert.ok(
      ![...f.env.CHANNEL_MEDIA.objects.keys()].some((k) =>
        k.startsWith(prefix),
      ),
    );
    assert.equal(
      f.db.raw.prepare("SELECT id FROM promo_images WHERE id=?").get(id),
      undefined,
    );
  } finally {
    f.restore();
  }
});
