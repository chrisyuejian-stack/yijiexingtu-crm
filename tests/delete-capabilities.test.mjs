import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./support.mjs";
import { adminCall } from "./fixtures-admin.mjs";
import { setup, request, accountToken, mutate, lesson, status, pack } from "./fixtures-credit.mjs";
import { schoolFixture } from "./fixtures-school.mjs";
import { decrypt, totp } from "../src/server/crypto.js";
import { randomId } from "../src/server/core.js";
import { PURGE_TABLES } from "../src/server/purge-schema.js";

const day = 86400000;
function expect(response, status = 200) {
  assert.equal(response.status, status, response.text);
  if (response.queries) assert.ok(response.queries <= 40);
  return response.body;
}
async function withSchool(fn) {
  const f = await fixture();
  try { await fn({ ...await setup(f, 2, "d1"), f }); }
  finally { f.restore(); }
}
const control = (s, path, method = "GET", data) =>
  adminCall(s.f, "tenants/" + s.t.id + (path ? "/" + path : ""), method, data);
const operation = () => ({ operation_id: randomId("op"), reason: "验收删除流程" });
const disable = async (s) => {
  const body = { ...operation(), version: expect(await control(s, "")).tenant.version };
  expect(await control(s, "disable", "POST", body));
  assert.deepEqual(expect(await control(s, "disable", "POST", body)), { ok: true, status: "paused" });
};
const older = (s) => s.f.db.raw.prepare("UPDATE tenants SET disabled_at=? WHERE id=?").run(Date.now()-8*day, s.t.id);
const getPage = (s, run, table, offset = 0) =>
  control(s, "export?export_id=" + run.export_id + "&table=" + table + "&offset=" + offset);
async function completeExport(s) {
  const run = expect(await control(s, "export/start", "POST", {}));
  expect(await getPage(s, run, run.tables.at(-1)), 409);
  let page;
  for (const table of run.tables) {
    let offset = 0;
    do {
      page = expect(await getPage(s, run, table, offset));
      offset = page.next_offset;
    } while (offset !== null);
  }
  assert.equal(page.completed, true);
  return run;
}
async function purgeBody(s) {
  const admin = s.f.db.raw.prepare("SELECT totp_enc FROM platform_admins WHERE role='owner'").get();
  const secret = await decrypt(s.f.env, admin.totp_enc, "platform:totp");
  return { ...operation(), confirm_name: s.t.name, totp: await totp(secret, Math.floor(Date.now()/30000)) };
}
async function page(s, path, token = s.token) {
  return s.f.request("https://school.test/" + s.t.slug + "/" + path, {
    headers: { Cookie: "channel_session=" + token },
  });
}

test("D1 停用封闭机构所有入口、保留会话；恢复后有效会话可继续使用", () => withSchool(async (s) => {
  const student = await accountToken(s, ["student"], s.students[0]);
  const promoted = expect(await adminCall(s.f, "promo", "POST", {
    type: "message", title: "推广通知", status: "published", audience: "all",
  })).id;
  s.f.env.TURNSTILE_MODE = "off";
  expect(await s.call("me"));
  expect(await request(s, "me", "GET", undefined, student.token));
  assert.equal((await page(s, "login")).status, 200);
  await disable(s);
  const paused = expect(await control(s, "")).tenant;
  assert.equal(paused.status, "paused");
  assert.ok(paused.disabled_at && paused.disabled_by && paused.disabled_reason);
  assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM sessions WHERE tenant_id=?").get(s.t.id).n, 2);
  for (const [path, token] of [["login", s.token], ["app/", student.token], ["api/public/brand", s.token], ["api/brand-timetable", student.token]]) {
    const response = await page(s, path, token);
    assert.equal(response.status, path === "app/" || path === "api/brand-timetable" ? 403 : 404, path);
    assert.match(await response.text(), path === "app/" || path === "api/brand-timetable" ? /机构已到期或停用/ : /该机构暂不可用/);
  }
  expect(await s.call("login", "POST", { phone: "13911112222", password: "PhaseTwoSecure9" }), 404);
  expect(await s.call("promo/" + promoted + "/application", "POST", { est_size: 2 }), 403);
  expect(await control(s, "", "PATCH", { ...paused, status: "active" }), 409);
  expect(await control(s, "enable", "POST", { ...operation(), version: paused.version }));
  expect(await s.call("me"));
  expect(await request(s, "me", "GET", undefined, student.token));
  expect(await s.call("login", "POST", { phone: "13911112222", password: "PhaseTwoSecure9" }));
}));

test("D1 删除前置：必须停用、满冷静期、完整近期导出、名称相同和新 TOTP", () => withSchool(async (s) => {
  const body = await purgeBody(s);
  expect(await control(s, "purge", "POST", body), 409);
  await disable(s);
  assert.match(expect(await control(s, "purge", "POST", body), 409).error, /冷静期/);
  older(s);
  assert.match(expect(await control(s, "purge", "POST", body), 409).error, /完整导出/);
  const incomplete = expect(await control(s, "export/start", "POST", {}));
  expect(await getPage(s, incomplete, incomplete.tables[0]));
  expect(await control(s, "purge", "POST", body), 409);
  await completeExport(s);
  s.f.db.raw.prepare("UPDATE tenant_data_versions SET version=version+1 WHERE tenant_id=?").run(s.t.id);
  expect(await control(s, "purge", "POST", body), 409);
  await completeExport(s);
  s.f.db.raw.prepare("UPDATE tenant_export_runs SET completed_at=? WHERE tenant_id=?").run(Date.now()-25*3600000, s.t.id);
  expect(await control(s, "purge", "POST", body), 409);
  s.f.db.raw.prepare("UPDATE tenant_export_runs SET completed_at=? WHERE tenant_id=?").run(Date.now(), s.t.id);
  expect(await control(s, "purge", "POST", { ...body, confirm_name: s.t.name + " " }), 400);
  expect(await control(s, "purge", "POST", { ...body, totp: undefined }), 401);
  const owner = s.f.db.raw.prepare("SELECT id FROM platform_admins WHERE role='owner'").get().id;
  s.f.db.raw.prepare("UPDATE platform_admins SET role='consultant' WHERE id=?").run(owner);
  expect(await control(s, "purge", "POST", body), 403);
  s.f.db.raw.prepare("UPDATE platform_admins SET role='owner',last_totp_step=? WHERE id=?").run(Math.floor(Date.now()/30000), owner);
  expect(await control(s, "purge", "POST", body), 401);
}));

test("D1 删除可续跑：多批数据、D1/R2 故障、跨机构、单条审计及路径释放", () => withSchool(async (s) => {
  const other = await schoolFixture(s.f, "d1-other");
  const l = await lesson(s);
  expect(await status(s, l, "completed"));
  expect(await mutate(s, "credits/payments", { student_id: s.students[0], kind: "tuition", amount: 30 }));
  const db = s.f.db.raw;
  const insert = db.prepare("INSERT INTO auth_log(tenant_id,id,at,event,ip,ua) VALUES(?,?,?,?,?,?)");
  for (let n=0;n<205;n++) insert.run(s.t.id, "qa-"+n, Date.now(), "test", "", "");
  insert.run(other.t.id, "qa-other", Date.now(), "test", "", "");
  await s.f.env.CHANNEL_MEDIA.put("promo/"+s.t.id+"/img/data", "tenant");
  await s.f.env.CHANNEL_MEDIA.put("promo/"+other.t.id+"/img/data", "other");
  await s.f.env.CHANNEL_MEDIA.put("promo/platform/img/data", "platform");
  await s.f.env.CHANNEL_BACKUPS.put("daily/2026-11-01/old", "existing-platform-backup");
  const { startBackup } = await import("../src/server/backup.js");
  const backup = await startBackup(s.f.env);
  assert.ok(backup.id);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM backup_snapshot_rows WHERE tenant_id=?").get(s.t.id).n > 0);
  await disable(s); older(s); await completeExport(s);
  const body = await purgeBody(s);
  let job = expect(await control(s, "purge", "POST", body));
  assert.deepEqual(expect(await control(s, "purge", "POST", body)), job);
  expect(await control(s, "enable", "POST", { ...operation(), version: expect(await control(s, "")).tenant.version }), 409);
  const step = () => control(s, "purge/step", "POST", { job_id: job.id, phase: job.phase });
  db.exec("CREATE TRIGGER qa_stop_delete BEFORE DELETE ON students BEGIN SELECT RAISE(ABORT,'qa_failure'); END");
  let attempts = 0, failure;
  while (attempts++ < 30) {
    const r = await step();
    if (r.status !== 200) { failure = r; break; }
    job = expect(r);
  }
  assert.equal(failure?.status, 500, failure?.text);
  job = expect(await control(s, "purge"));
  assert.equal(job.current_table, "students");
  assert.equal(job.counts.auth_log, 205);
  expect(await s.call("login", "POST", { phone: "13911112222", password: "PhaseTwoSecure9" }), 404);
  db.exec("DROP TRIGGER qa_stop_delete");
  const media = s.f.env.CHANNEL_MEDIA;
  const deleteMedia = media.delete.bind(media);
  media.delete = async () => { throw Error("qa media failure"); };
  failure = null;
  while (attempts++ < 60) {
    const r = await step();
    if (r.status !== 200) { failure = r; break; }
    job = expect(r);
  }
  assert.equal(failure?.status, 500);
  assert.equal((await page(s, "login")).status, 404);
  media.delete = deleteMedia;
  job = expect(await control(s, "purge"));
  while (job.status !== "completed" && attempts++ < 80) job = expect(await step());
  assert.equal(job.status, "completed");
  assert.equal(job.counts.auth_log, 205);
  assert.equal(job.counts.students, 2);
  assert.ok(job.counts.credit_debts > 0);
  assert.ok(job.counts.backup_snapshot_rows > 0);
  assert.deepEqual(expect(await control(s, "purge", "POST", body)), job);
  expect(await control(s, ""), 404);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  for (const { name } of tables) {
    const columns = db.prepare("PRAGMA table_info("+name+")").all();
    if (!columns.some((x) => x.name === "tenant_id")) continue;
    assert.ok(PURGE_TABLES.includes(name) || ["tenant_export_runs","tenant_purge_jobs"].includes(name), name);
    const count = db.prepare("SELECT COUNT(*) n FROM "+name+" WHERE tenant_id=?").get(s.t.id).n;
    assert.equal(count, name === "platform_audit" ? 1 : 0, name);
  }
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(await media.get("promo/"+s.t.id+"/img/data"), null);
  assert.ok(await media.get("promo/"+other.t.id+"/img/data"));
  assert.ok(await media.get("promo/platform/img/data"));
  assert.ok(await s.f.env.CHANNEL_BACKUPS.get("daily/2026-11-01/old"));
  expect(await other.call("me"));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM auth_log WHERE tenant_id=? AND id='qa-other'").get(other.t.id).n, 1);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM backup_snapshot_rows WHERE tenant_id=?").get(other.t.id).n > 0);
  const logs = expect(await adminCall(s.f, "logs")).items;
  assert.equal(logs.find((x) => x.action === "purge_tenant").tenant_name, s.t.name);
  expect(await adminCall(s.f, "tenants", "POST", { ...s.t, name: "路径重新使用" }), 201);
}));

test("D1 学习阶段与课时包：软删、版本、幂等和关联拒绝；可解除阶段关联", () => withSchool(async (s) => {
  const st = expect(await mutate(s, "credits/stages", { student_id: s.students[0], name: "阶段" })).id;
  const pkg = expect(await mutate(s, "credits/packages", {
    student_id: s.students[0], course_type_id: s.type, units_total: 0, stage_id: st,
  })).id;
  const path = "credits/stages/" + st;
  assert.match(expect(await mutate(s, path, { version: 1 }, "DELETE"), 409).error, /被课时包引用/);
  expect(await mutate(s, "credits/packages/"+pkg, { version: 1, stage_id: null }, "PATCH"));
  expect(await mutate(s, path, { version: 2 }, "DELETE"), 409);
  const body = { ...operation(), version: 1 };
  const deleted = expect(await request(s, path, "DELETE", body));
  assert.deepEqual(expect(await request(s, path, "DELETE", body)), deleted);
  expect(await request(s, path), 404);
  expect(await mutate(s, "data/packages/"+pkg, { version: 2 }, "DELETE"));
  const used = await pack(s);
  assert.match(expect(await mutate(s, "data/packages/"+used, { version: 1 }, "DELETE"), 409).error, /课时流水/);
}));

test("D1 推广：只删已下架的无关联内容，同批清理目标、已读、海报产出", () => withSchool(async (s) => {
  const db = s.f.db.raw;
  const id = expect(await adminCall(s.f, "promo", "POST", {
    type: "message", title: "删除推广", status: "published", audience: "selected", tenant_ids: [s.t.id],
  })).id;
  expect(await request(s, "promo/"+id+"/read", "POST", {}));
  const img = randomId("img"), tpl = randomId("poster");
  db.prepare("INSERT INTO promo_images(id,tenant_id,owner_id,kind,mime,width,height,ready,created_at) VALUES(?,'platform','fixture','poster','image/png',1080,1000,1,?)").run(img,Date.now());
  db.prepare("INSERT INTO poster_templates(id,campaign_id,image_key,width,height,slots) VALUES(?,?,?,?,?,?)").run(tpl,id,img,1080,1000,"{}");
  db.prepare("INSERT INTO poster_outputs(tenant_id,id,template_id,user_id,action,at) VALUES(?,?,?,?,'view',?)").run(s.t.id,randomId("poster"),tpl,s.user.id,Date.now());
  expect(await adminCall(s.f, "promo/"+id, "DELETE", { ...operation(), version: 1 }), 409);
  expect(await adminCall(s.f, "promo/"+id+"/state", "PUT", { status:"archived", version:1 }));
  const body = { ...operation(), version: 2 };
  const deleted = expect(await adminCall(s.f, "promo/"+id, "DELETE", body));
  assert.deepEqual(expect(await adminCall(s.f, "promo/"+id, "DELETE", body)), deleted);
  for (const table of ["campaign_targets","campaign_reads","poster_templates","poster_outputs"])
    assert.equal(db.prepare("SELECT COUNT(*) n FROM "+table).get().n,0);
  expect(await adminCall(s.f,"promo/"+id),404);

  db.prepare("INSERT INTO promo_images(id,tenant_id,owner_id,kind,mime,width,height,ready,created_at) VALUES(?,'platform','fixture','detail','image/png',750,1000,1,?)").run(randomId("img"),Date.now());
  const detail = db.prepare("SELECT id FROM promo_images WHERE kind='detail'").get().id;
  const course = expect(await adminCall(s.f, "promo", "POST", {
    type: "course", title: "已经报名", status: "published", audience: "all",
    detail_image_key: detail, lecturer: "教师", min_size: 2, seat_price: 120, suggested_price: 200,
    apply_deadline: Date.now()+day, sessions: [{ start_at: new Date(Date.now()+2*day).toISOString().slice(0,10)+"T19:00", duration:45 }],
  })).id;
  expect(await request(s,"promo/"+course+"/application","POST",{ est_size:2, unsure:false }));
  expect(await adminCall(s.f,"promo/"+course+"/state","PUT",{ status:"archived",version:1 }));
  assert.match(expect(await adminCall(s.f,"promo/"+course,"DELETE",{ ...operation(),version:2 }),409).error,/保持下架/);
}));

test("D1 平台公告：撤回后不再送达和计未读，平台历史可见", () => withSchool(async (s) => {
  const title = "即将撤回的公告";
  const id = expect(await adminCall(s.f,"announcements","POST",{title,content:"正文",roles:["supervisor"],tenants:[s.t.id]})).id;
  const before = expect(await request(s,"system-messages"));
  assert.match(JSON.stringify(before),new RegExp(title));
  assert.equal(before.unread_count,1);
  const body = operation(), path = "announcements/"+id+"/withdraw";
  const withdrawn = expect(await adminCall(s.f,path,"POST",body));
  assert.deepEqual(expect(await adminCall(s.f,path,"POST",body)),withdrawn);
  const after = expect(await request(s,"system-messages"));
  assert.doesNotMatch(JSON.stringify(after),new RegExp(title));
  assert.equal(after.unread_count,0);
  assert.equal(expect(await adminCall(s.f,"announcements?status=published")).items.length,0);
  const list = expect(await adminCall(s.f,"announcements?status=withdrawn")).items;
  assert.equal(list[0].id,id);
  assert.equal(list[0].status,"withdrawn");
  assert.equal(list[0].withdrawal_reason,body.reason);
}));
