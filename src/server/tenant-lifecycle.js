import { fail, integer, now, sha, string, version } from "./core.js";
import { decrypt, verifyTotp } from "./crypto.js";
import { repo } from "./repo.js";
import { PURGE_TABLES } from "./purge-schema.js";

export const PURGE_COOLDOWN_MS = 7 * 86400000;

export async function platformCommand(admin, operationId, command, payload) {
  if (typeof operationId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(operationId))
    fail(400, "缺少有效操作编号");
  return {
    id: "op_" + await sha(JSON.stringify([admin.id, operationId])),
    fingerprint: await sha(JSON.stringify([command, payload])),
  };
}

const progress = (job) => ({
  id: job.id,
  status: "running",
  current_table: PURGE_TABLES[job.phase] ?? null,
  phase: job.phase,
  total_phases: PURGE_TABLES.length + 1,
  counts: JSON.parse(job.counts),
});

export async function tenantLifecycle(req, env, path, admin, ip, readBody) {
  const match = /^\/api\/tenants\/(ten_[a-f0-9]{24})\/(disable|enable|purge)(\/step)?$/.exec(path);
  if (!match) return undefined;
  if (admin.role !== "owner") fail(403, "没有权限");
  const [, id, command, stepRoute] = match, r = repo(env, null);
  const actor = { ...admin, ip };
  if (command === "purge" && req.method === "GET" && !stepRoute) {
    const job = await r.purgeJob(id);
    if (job) return progress(job);
    const receipt = await r.purgeReceipt(id);
    if (receipt) return receipt.result;
    fail(404, "不存在");
  }
  if (req.method !== "POST" || (stepRoute && command !== "purge"))
    fail(404, "不存在");
  const d = await readBody(req);
  if (stepRoute) {
    let job = await r.purgeJob(id);
    if (!job) {
      const receipt = await r.purgeReceipt(id);
      if (receipt?.result.id === d.job_id) return receipt.result;
      fail(404, "不存在");
    }
    if (job.id !== d.job_id) fail(404, "不存在");
    const phase = integer(d.phase, "作业阶段", 0, PURGE_TABLES.length);
    if (job.phase !== phase) return progress(job);
    // A request processes up to eight bounded D1 batches. If a batch fills,
    // return so large tables and transient failures remain resumable.
    for (let i = 0; i < 8 && job.phase < PURGE_TABLES.length; i++) {
      const current = job.phase;
      job = await r.purgeTableStep(job);
      if (!job) return (await r.purgeReceipt(id))?.result ?? fail(404, "不存在");
      if (job.phase === current) return progress(job);
    }
    if (job.phase < PURGE_TABLES.length) return progress(job);
    const prefix = "promo/" + id + "/";
    const objects = (await env.CHANNEL_MEDIA.list({ prefix, limit: 100 })).objects;
    if (objects.length) {
      await env.CHANNEL_MEDIA.delete(objects.map((object) => object.key));
      return progress(job);
    }
    const done = await r.finishPurge(job);
    return done || progress(await r.purgeJob(id) || job);
  }

  const reason = string(d.reason, "原因", 1000);
  if (command !== "purge") {
    const v = version(d.version), enable = command === "enable";
    const op = await platformCommand(admin, d.operation_id, command, [id, v, reason]);
    const replay = await r.platformOperation(op.id, op.fingerprint);
    if (replay) return replay;
    const row = await r.lifecycleState(id);
    if (!row) fail(404, "不存在");
    if (row.version !== v || await r.purgeJob(id)) fail(409, "机构状态已变化，请刷新");
    if (enable && (row.status !== "paused" || !row.disabled_at)) fail(409, "机构未停用");
    if (enable && row.expires_at && Date.parse(row.expires_at + "T23:59:59+08:00") <= now())
      fail(409, "机构已到期，请先更新到期日");
    if (!enable && row.disabled_at) fail(409, "机构已停用");
    return r.changeTenantLifecycle(id, row, enable, op, actor, reason);
  }

  const op = await platformCommand(admin, d.operation_id, command, [id, d.confirm_name, reason]);
  const replay = await r.platformOperation(op.id, op.fingerprint);
  if (replay) return replay;
  const existing = await r.purgeJob(id);
  if (existing) {
    if (existing.id === op.id && existing.fingerprint === op.fingerprint) return progress(existing);
    fail(409, "该机构已有删除作业");
  }
  const row = await r.lifecycleState(id), cutoff = now() - PURGE_COOLDOWN_MS;
  if (!row) fail(404, "不存在");
  if (row.status !== "paused" || row.disabled_at == null) fail(409, "请先停用机构");
  if (row.disabled_at > cutoff) fail(409, "停用后的 " + PURGE_COOLDOWN_MS / 86400000 + " 天冷静期尚未结束");
  if (d.confirm_name !== row.name) fail(400, "机构全名不一致");
  if (!await r.hasFreshExport(id)) fail(409, "请先完成最近 24 小时内的机构完整导出");
  const limit = "console-purge:" + admin.id;
  if (await r.limit(limit, 900000, 5, 900000, false)) fail(429, "动态口令尝试过多，请稍后再试");
  const auth = await r.ownerTotp(admin.id);
  const step = auth ? await verifyTotp(await decrypt(env, auth.totp_enc, "platform:totp"), d.totp, auth.last_totp_step) : -1;
  if (step < 0) {
    await r.limit(limit, 900000, 5, 900000);
    fail(401, "动态口令不正确或已使用");
  }
  const job = await r.startPurge(id, row, actor, op, reason, step, cutoff);
  await r.clearLimit(limit);
  return progress(job);
}
