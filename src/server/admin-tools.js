import { platformCommand } from "./tenant-lifecycle.js";
import { boundedText, LEGACY_ROW_BUDGET } from "./d1-limits.js";
import { repo } from "./repo.js";
import { fail, string, integer, randomId, now, sha, json } from "./core.js";
import { decrypt, encrypt } from "./crypto.js";
import { backupManifest, backupPage, seal } from "./backup.js";
import {
  restoreTables,
  BUSINESS_SETTINGS,
  TABLE_LABELS,
} from "./backup-model.js";
import { LEGACY_TABLES, convertLegacy } from "./legacy-import.js";
import { businessApi, scheduleView, generateTemplates } from "./scheduling.js";
import { creditApi } from "./credits.js";
import { financeApi } from "./finance.js";
import { reviewApi } from "./reviews.js";
import { toolsApi } from "./tools.js";
const off = (url) =>
  integer(Number(url.searchParams.get("offset") || 0), "分页", 0, 1000000);
function reason(value) {
  return string(value, "操作原因", 1000, 5);
}
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(400, "格式不正确");
  return value;
}
export async function adminTools(req, env, url, admin, readBody) {
  const path = url.pathname,
    platform = repo(env, null);
  if (path === "/api/overview" && req.method === "GET")
    return {
      items: await platform.overview(off(url)),
      backups: await platform.backupRuns(),
    };
  if (path === "/api/backups" && req.method === "GET")
    return { items: await platform.backupRuns() };
  if (path === "/api/referrals" && req.method === "GET") {
    const rows = await platform.platformReferrals(off(url));
    await platform.platformLog(
      admin.id,
      "referrals_view",
      null,
      "查看合作升学推荐联系方式",
      "",
    );
    return {
      items: await Promise.all(
        rows.map(async (r) => ({
          id: r.id,
          tenant_id: r.tenant_id,
          tenant_name: r.tenant_name,
          name: r.name,
          grade: r.grade,
          direction: r.direction,
          intention: r.intention,
          parent_phone: await decrypt(
            env,
            r.parent_phone_enc,
            r.tenant_id + ":phone",
          ),
          consent_name: r.consent_name,
          consent_at: r.consent_at,
          consent_method: r.consent_method,
          consent_operator: r.consent_operator,
          status: r.status,
          created_at: r.created_at,
        })),
      ),
    };
  }
  const withdrawal = /^\/api\/announcements\/(msg_[a-f0-9]{24})\/withdraw$/.exec(path);
  if (withdrawal && req.method === "POST") {
    const d = await readBody(req), reason = string(d.reason, "原因", 1000);
    const op = await platformCommand(admin, d.operation_id, "withdraw_announcement", [withdrawal[1], reason]);
    return platform.withdrawAnnouncement(withdrawal[1], op, admin, reason);
  }
  if (path === "/api/announcements") {
    if (req.method === "GET") {
      const status = url.searchParams.get("status") || "";
      if (!["", "published", "withdrawn"].includes(status)) fail(400, "公告状态不正确");
      return { items: await platform.announcements(off(url), status) };
    }
    if (req.method === "POST") {
      const d = await readBody(req),
        roles = d.roles,
        tenants = d.tenants;
      if (
        !Array.isArray(roles) ||
        !roles.length ||
        new Set(roles).size !== roles.length ||
        roles.some(
          (r) =>
            ![
              "supervisor",
              "academic",
              "finance",
              "teacher",
              "student",
            ].includes(r),
        )
      )
        fail(400, "可见角色不正确");
      if (
        !Array.isArray(tenants) ||
        !tenants.length ||
        tenants.length > 200 ||
        new Set(tenants).size !== tenants.length ||
        tenants.some(
          (x) => typeof x !== "string" || !/^ten_[a-f0-9]{24}$/.test(x),
        )
      )
        fail(400, "发送机构不正确，每次最多200个");
      const row = {
        id: randomId("msg"),
        title: string(d.title, "标题", 100),
        content: string(d.content, "正文", 6000),
        roles,
        starts_at: integer(d.starts_at ?? now(), "显示时间", 0, 4102444800000),
        ends_at:
          d.ends_at === null || d.ends_at === undefined
            ? null
            : integer(d.ends_at, "结束时间", 0, 4102444800000),
      };
      if (row.ends_at !== null && row.ends_at <= row.starts_at)
        fail(400, "结束时间需晚于开始时间");
      await platform.publishAnnouncement(row, tenants, admin);
      return { id: row.id };
    }
  }
  const exportStart = /^\/api\/tenants\/(ten_[a-f0-9]{24})\/export\/start$/.exec(path);
  if (exportStart && req.method === "POST") {
    await readBody(req);
    const export_id = await platform.startExportRun(exportStart[1], admin.id);
    return { export_id, tables: [...restoreTables, "tenant_settings"] };
  }
  const m =
    /^\/api\/tenants\/(ten_[a-f0-9]{24})\/(overview|referrals|maintenance|business|operate|export-schema|export|jobs)(?:\/([^/]+))?(?:\/(page|preview|commit|cancel))?$/.exec(
      path,
    );
  if (!m) return undefined;
  const [, tenantId, section, id, action] = m,
    r = repo(env, tenantId),
    t = await r.tenant();
  if (!t) fail(404, "不存在");
  if (await platform.purgeJob(tenantId)) fail(409, "机构删除作业进行中");
  if (action && section !== "jobs") fail(404, "不存在");
  if (id && !["jobs", "referrals", "maintenance"].includes(section))
    fail(404, "不存在");
  if (section === "export-schema" && req.method === "GET")
    return {
      tables: [...restoreTables, "tenant_settings"],
      legacy_tables: Object.keys(LEGACY_TABLES),
      labels: TABLE_LABELS,
      legacy_labels: Object.fromEntries(
        Object.entries(LEGACY_TABLES).map(([k, v]) => [k, TABLE_LABELS[v]]),
      ),
    };
  if (section === "maintenance" && id && req.method === "DELETE") {
    await readBody(req);
    await r.endMaintenance(id, admin);
    return { ok: true };
  }
  if (section === "referrals" && id && req.method === "POST") {
    await readBody(req);
    await r.receiveReferral(id, admin);
    return { ok: true };
  }
  if (section === "maintenance" && !id && req.method === "POST") {
    const d = await readBody(req),
      lease = { id: randomId("mnt"), reason: reason(d.reason) };
    await r.startMaintenance(lease, admin);
    return { id: lease.id, expires_at: now() + 30 * 60000 };
  }
  if (section === "business" || section === "operate") {
    const readonly = section === "business";
    if (
      (readonly && req.method !== "GET") ||
      (!readonly && req.method !== "POST")
    )
      fail(404, "不存在");
    const d = readonly ? {} : await readBody(req),
      lease =
        !readonly &&
        typeof d.lease === "string" &&
        /^mnt_[a-f0-9]{24}$/.test(d.lease)
          ? await r.maintenanceLease(d.lease, admin)
          : null;
    if (!readonly && !lease) fail(403, "请先填写原因开启30分钟代管");
    if (lease)
      env.__maintenance = { tenantId, id: lease.id, adminId: admin.id };
    const actor = {
        id: admin.id,
        name: "系统维护",
        roles: ["supervisor", "finance"],
        teacher_id: null,
        student_id: null,
      },
      policy = await r.policy();
    const sub = readonly ? url.searchParams.get("path") : d.path;
    if (
      typeof sub !== "string" ||
      !/^\/(data\/[a-z_]+(?:\/[a-z]+_[a-f0-9]{24})?|schedule|templates\/generate|finance\/(rates|payments|adjustments|costs|tuition|payroll|report|settlement)(?:\/[a-z]+_[a-f0-9]{24})?|credits\/(packages|transactions|payments|stages|makeups|adjust|transfer)(?:\/[a-z]+_[a-f0-9]{24})?|credits\/lessons\/[a-z]+_[a-f0-9]{24}\/(attendance|status|undo|delete)|tools\/[a-z_]+(?:\/[a-z]+_[a-f0-9]{24})?|submissions|lessons\/[a-z]+_[a-f0-9]{24}\/(review|comments))$/.test(
        sub,
      )
    )
      fail(404, "不存在");
    const method = readonly ? "GET" : d.method;
    if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method))
      fail(400, "操作方式不正确");
    const target = new URL(req.url);
    target.pathname = "/api" + sub;
    target.search = readonly
      ? url.searchParams.get("query") || ""
      : d.query || "";
    if (target.search.length > 2000) fail(400, "查询过长");
    const request = new Request(target, { method, headers: req.headers });
    const data = async () => object(d.data || {}),
      route = target.pathname;
    let result;
    if (/^\/api\/data\/packages(?:\/[^/]+)?$/.test(route))
      result = await creditApi(
        request,
        env,
        t,
        actor,
        policy,
        route,
        target,
        data,
      );
    else if (route.startsWith("/api/data/"))
      result = await businessApi(
        request,
        env,
        t,
        actor,
        policy,
        route,
        target,
        data,
      );
    else if (route === "/api/schedule" && method === "GET")
      result = await scheduleView(env, t, actor, policy, target);
    else if (route === "/api/templates/generate" && method === "POST")
      result = await generateTemplates(
        request,
        env,
        t,
        actor,
        policy,
        await data(),
      );
    else if (route.startsWith("/api/finance/"))
      result = await financeApi(
        request,
        env,
        t,
        actor,
        policy,
        route,
        target,
        data,
      );
    else if (route.startsWith("/api/credits/"))
      result = await creditApi(
        request,
        env,
        t,
        actor,
        policy,
        route,
        target,
        data,
      );
    else if (route.startsWith("/api/tools/"))
      result = await toolsApi(
        request,
        env,
        t,
        actor,
        policy,
        route,
        target,
        data,
      );
    else
      result = await reviewApi(
        request,
        env,
        t,
        actor,
        policy,
        route,
        target,
        data,
      );
    if (readonly && result && typeof result === "object") {
      const rows = result.items || (result.record ? [result.record] : []),
        names = await r.lookupNames(rows),
        byId = new Map(names.map((x) => [x.id, x.name]));
      for (const row of rows)
        for (const [key, label] of [
          ["student_id", "student_name"],
          ["teacher_id", "teacher_name"],
          ["course_type_id", "course_name"],
          ["location_id", "location_name"],
          ["class_id", "class_name"],
          ["assignee_id", "assignee_name"],
        ])
          if (row[key] && !row[label])
            row[label] = byId.get(row[key]) || "历史档案";
    }
    await platform.platformLog(
      admin.id,
      readonly ? "business_view" : "maintenance_write",
      tenantId,
      (lease?.reason || "只读查看") + " " + method + " " + sub,
      "",
    );
    return result;
  }
  if (section === "export" && req.method === "GET") {
    const table = url.searchParams.get("table"),
      offset = off(url);
    if (!restoreTables.includes(table) && table !== "tenant_settings")
      fail(404, "不存在");
    const token = url.searchParams.get("export_id");
    const tables = [...restoreTables, "tenant_settings"];
    const index = tables.indexOf(table);
    const run = token ? await platform.exportRun(tenantId, token, admin.id) : null;
    if (token && (!run || index > run.table_index ||
      (index === run.table_index && offset > run.next_offset)))
      fail(409, "导出凭证无效或分页不连续");
    const rows = await r.businessExport(table, offset);
    const envelope = await seal(env, { tenant_id: tenantId, schema: 10, table, rows },
      tenantId + ":export:" + table + ":" + offset);
    const next_offset = rows.length === 200 ? offset + 200 : null;
    const advance = run && !run.completed_at && index === run.table_index && offset === run.next_offset;
    const completed = advance && next_offset === null && index === tables.length - 1;
    if (advance)
      await platform.advanceExport(run, next_offset === null ? index + 1 : index, next_offset ?? 0, completed);
    else if (!run)
      await platform.platformLog(admin.id, "tenant_export", tenantId, "加密导出 " + table + " " + rows.length + "条", "");
    return { table, offset, envelope, next_offset,
      ...(run ? { export_id: token, completed: !!(run.completed_at || completed) } : {}),
    };
  }
  if (section === "jobs") {
    if (req.method === "GET" && !id) return { items: await r.jobs() };
    if (req.method === "POST" && !id) {
      const d = await readBody(req);
      if (!["legacy", "restore"].includes(d.kind)) fail(400, "作业类型不正确");
      const revision = await r.dataVersion();
      if (d.kind === "legacy" && !(await r.emptyBusiness()))
        fail(409, "旧版 JSON 仅可导入业务数据为空的机构");
      let manifest;
      if (d.kind === "restore") {
        const source = await backupManifest(env, d.backup_id);
        if (!source.tenant_ids?.includes(tenantId))
          fail(400, "该备份不包含当前机构，拒绝恢复");
        manifest = {
          backup_id: source.id,
          required: source.files
            .filter(
              (x) =>
                (restoreTables.includes(x.table) ||
                  x.table === "tenant_settings") &&
                x.tenants?.includes(tenantId),
            )
            .map((x) => ({ table: x.table, offset: x.offset })),
          done: [],
        };
      } else {
        const counts = object(d.counts),
          settings = object(d.settings || {});
        for (const [key, value] of Object.entries(counts))
          if (
            !Object.hasOwn(LEGACY_TABLES, key) ||
            !Number.isInteger(value) ||
            value < 0 ||
            value > 20000
          )
            fail(400, "旧数据表计数不正确");
        manifest = {
          counts,
          settings: {
            absencePolicies: settings.absencePolicies || {},
            lowBalanceThreshold: settings.lowBalanceThreshold,
          },
          preview: null,
        };
      }
      const job = {
        id: randomId("job"),
        kind: d.kind,
        reason: reason(d.reason),
        source_tenant: tenantId,
        manifest,
      };
      await r.createJob(job, admin, revision);
      return { id: job.id, manifest };
    }
    if (!id) fail(404, "不存在");
    const job = await r.job(id);
    if (!job) fail(404, "不存在");
    if (req.method === "GET" && !action)
      return {
        id: job.id,
        kind: job.kind,
        status: job.status,
        manifest: JSON.parse(job.manifest_json),
      };
    if (req.method !== "POST" || !action) fail(404, "不存在");
    const d = await readBody(req);
    if (action === "cancel") {
      await r.cancelJob(id, admin);
      return { ok: true };
    }
    if (job.status === "completed" && action === "commit")
      return { ok: true, already_completed: true };
    if (job.status !== "staging") fail(409, "作业已结束");
    let manifest = JSON.parse(job.manifest_json);
    if (action === "page") {
      if (job.kind === "restore") {
        const item = manifest.required.find(
          (x) => x.table === d.table && x.offset === d.offset,
        );
        if (!item) fail(400, "恢复批次不正确");
        const page = await backupPage(
          env,
          manifest.backup_id,
          item.table,
          item.offset,
          tenantId,
        );
        await r.stageJob(id, item.table, page.rows);
        if (
          !manifest.done.some(
            (x) => x.table === item.table && x.offset === item.offset,
          )
        )
          manifest.done.push(item);
      } else {
        if (
          !Object.hasOwn(LEGACY_TABLES, d.table) ||
          !Array.isArray(d.rows) ||
          !d.rows.length ||
          d.rows.length > 200 ||
          d.rows.some(
            (x) => !x || typeof x.id !== "string" || !x.id || x.id.length > 200,
          )
        )
          fail(400, "旧数据批次不正确");
        const protectedRows = await Promise.all(
          d.rows.map(async (row) => ({
            id: row.id,
            cipher: await encrypt(
              env,
              boundedText(JSON.stringify(row), LEGACY_ROW_BUDGET, "旧数据单行"),
              tenantId + ":legacy:" + id,
            ),
          })),
        );
        await r.stageJob(id, "raw:" + d.table, protectedRows);
        manifest.preview = null;
      }
      await r.updateJobManifest(id, job.manifest_json, manifest);
      return { ok: true, manifest };
    }
    const staged = await r.stagedRows(id);
    if (staged.length > 20000)
      fail(400, "导入数据超过本期暂存上限，请联系维护人员评估；本次不写入业务");
    if (job.kind === "legacy" && action === "preview") {
      const raw = Object.create(null);
      for (const row of staged.filter((x) => x.table_name.startsWith("raw:"))) {
        const data = JSON.parse(row.row_json),
          table = row.table_name.slice(4);
        (raw[table] ||= []).push(
          JSON.parse(
            await decrypt(env, data.cipher, tenantId + ":legacy:" + id),
          ),
        );
      }
      for (const [key, count] of Object.entries(manifest.counts))
        if ((raw[key] || []).length !== count)
          fail(409, "旧数据尚未上传完整：" + key);
      const converted = await convertLegacy(
        env,
        tenantId,
        raw,
        manifest.settings,
        admin,
      );
      await r.stageConverted(id, converted.rows);
      manifest.preview = {
        counts: Object.fromEntries(
          Object.entries(converted.rows).map(([k, v]) => [k, v.length]),
        ),
        settings: converted.settings,
        warnings: converted.warnings,
      };
      await r.updateJobManifest(id, job.manifest_json, manifest);
      return manifest.preview;
    }
    if (action === "commit") {
      let settings;
      if (job.kind === "legacy") {
        if (!manifest.preview) fail(409, "请先预览校验导入结果");
        if (!(await r.emptyBusiness()))
          fail(409, "目标机构已有业务数据，拒绝覆盖");
        settings = manifest.preview.settings;
      } else {
        if (manifest.done.length !== manifest.required.length)
          fail(409, "备份尚未暂存完整");
        const missingPartner = await r.promoRestoreMissing(id);
        if (missingPartner.length)
          fail(
            409,
            "备份缺少当前合作课参课学员档案：" +
              missingPartner.map((x) => x.name).join("、"),
          );
        const broken = await r.restoreReferences(id);
        if (broken.length)
          fail(
            409,
            "恢复会破坏账号与档案关联，请先核对：" +
              broken.map((x) => x.name).join("、"),
          );
        settings = Object.fromEntries(
          staged
            .filter((x) => x.table_name === "tenant_settings")
            .map((x) => JSON.parse(x.row_json))
            .filter((x) => BUSINESS_SETTINGS.includes(x.id))
            .map((x) => [x.id, JSON.parse(x.value)]),
        );
      }
      await r.finalizeJob(
        id,
        admin,
        job.kind,
        settings,
        manifest.preview?.counts || {},
      );
      return { ok: true };
    }
    fail(404, "不存在");
  }
  return undefined;
}
