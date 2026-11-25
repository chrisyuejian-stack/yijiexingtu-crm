import {styleAssetPath,styleAssetsApi} from './style-assets.js';
import {growthPath,growthApi} from './growth.js';
import { aiPath, aiApi } from './ai.js';
import { contentPath, contentApi } from './content.js';
import { planPath, plansApi, plansPublic } from './plans.js';
import { toolSettingsPath, toolSettingsApi } from './tool-settings.js';
import { identityRoot, identityOps, identityTenant, identityParentScope, identityPath, identityErrorCode, identityLabels, clearRootCookie } from "./identity.js";
import { platformPhoneIndex, phoneIndex } from "./crypto.js";
import { tenantLifecycle } from "./tenant-lifecycle.js";
import { maxDebtUnits } from "./debt.js";
import { apiTiming, measureDatabase } from "./request-timing.js";
import { rebuild3Api } from "./rebuild3.js";
import { rebuildApi } from "./rebuild.js";
import { BRAND_IMAGE_BUDGET, boundedText } from "./d1-limits.js";
import { promoTenant, promoConsole, PROMO_LABELS } from "./promo.js";
import { readBatch } from "./read-batch.js";
import { accountReadResponse } from "./security.js";
import { importsApi, IMPORT_HEADERS } from "./imports.js";
import { adminTools } from "./admin-tools.js";
import { toolsApi, LEAD_STAGES } from "./tools.js";
import { reviewApi, timetableApi } from "./reviews.js";
import {
  MODULE_LABELS,
  ACTION_LABELS,
  LESSON_LABELS,
  ATTENDANCE_LABELS,
  REVIEW_LABELS,
  AUTH_EVENT_LABELS,
  RATE_UNITS,
  beijingTime,
} from "./presentation.js";
import { effectivePolicies } from "./absence.js";
import { financeApi } from "./finance.js";
import { moneyOut, quantityIn } from "./numbers.js";
import { creditApi } from "./credits.js";
import {
  businessApi,
  addStudentSummaries,
  day,
  generateTemplates,
  scheduleView,
  fixedRulesView,
  reorderBusiness,
} from "./scheduling.js";
import {
  config,
  accessMode,
  turnstileMode,
  secureResponse,
  neutral404,
  json,
  body,
  fail,
  HttpError,
  string,
  integer,
  version,
  clientInfo,
  now,
} from "./core.js";
import { repo } from "./repo.js";
import { resolveTenant, validSlug } from "./tenant.js";
import {
  requireAccess,
  authenticateAdmin,
  platformAuth,
  consultantEnrollment,
  authenticate,
  loginTenant,
  clearCookie,
  changeTenantPassword,
} from "./auth.js";
import { modules, can, publicUser, projectRecord } from "./permissions.js";
import {
  requireCan,
  rolesInput,
  createAccount,
  resetAccount,
} from "./accounts.js";
import { encrypt, decrypt } from "./crypto.js";
import { randomId } from "./core.js";
const staticTenant = new Set(["/assets/tenant.js", "/assets/tenant.css"]);
const staticConsole = new Set([
  "/console-assets/console.js",
  "/console-assets/console.css",
  "/console-assets/pinyin-pro.js",
]);
const offsetOf = (url) => {
  const n = Number(url.searchParams.get("offset") || 0);
  return integer(n, "分页", 0, 1000000);
};
const idPattern = /^[a-z]+_[a-f0-9]{24}$/;
function recordId(x) {
  if (!idPattern.test(x)) fail(404, "不存在");
  return x;
}
function dateValue(x) {
  if (x === null || x === "") return null;
  if (
    typeof x !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(x) ||
    Number.isNaN(Date.parse(x)) ||
    new Date(x).toISOString().slice(0, 10) !== x
  )
    fail(400, "到期日格式不正确");
  return x;
}
function tenantData(data) {
  if (!validSlug(data.slug))
    fail(400, "机构路径须为 3–40 位小写字母、数字或连字符，且不能使用保留字");
  return {
    slug: data.slug,
    name: string(data.name, "机构名称", 100),
    type: ["音乐培训", "音乐艺考", "美术艺考", "其他"].includes(data.type)
      ? data.type
      : "其他",
    city: string(data.city ?? "", "城市", 50, 0),
    status: data.status === "paused" ? "paused" : "active",
    expires_at: dateValue(data.expires_at),
    staff_seat_limit: integer(data.staff_seat_limit, "员工上限", 1, 10000),
    student_seat_limit: integer(data.student_seat_limit, "学员上限", 0, 100000),
  };
}
function imageValue(x) {
  if (x === null || x === "") return null;
  if (typeof x !== "string") fail(400, "图片格式不正确");
  boundedText(
    x,
    BRAND_IMAGE_BUDGET,
    "品牌图片（压缩后的 data URL 最多" + BRAND_IMAGE_BUDGET + "字节）",
  );
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
    x,
  );
  if (!match) fail(400, "仅支持 PNG、JPEG、WebP 图片");
  let b;
  try {
    b = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  } catch {
    fail(400, "图片格式不正确");
  }
  if (b.length > 2097152 || b.length < 16) fail(400, "图片大小不正确");
  const png =
      [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v) &&
      String.fromCharCode(...b.slice(12, 16)) === "IHDR",
    jpeg =
      b[0] === 255 &&
      b[1] === 216 &&
      b[2] === 255 &&
      b.at(-2) === 255 &&
      b.at(-1) === 217,
    webp =
      String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...b.slice(8, 12)) === "WEBP";
  if (!{ png, jpeg, webp }[match[1]]) fail(400, "图片真实格式不正确");
  return x;
}
async function serve(env, req, path, replacements = {}) {
  const response = await env.ASSETS.fetch(
    new Request(new URL(path, req.url), { method: "GET" }),
  );
  if (!response.ok) return neutral404();
  if (Object.keys(replacements).length) {
    let html = await response.text();
    for (const [k, v] of Object.entries(replacements))
      html = html.replaceAll(k, v);
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return response;
}
async function serveStatic(env, req, url) {
  const response = await serve(env, req, url.pathname);
  if (response.ok) {
    const versions = url.searchParams.getAll("v");
    env.__cacheControl =
      versions.length === 1 && /^[a-f0-9]{8,64}$/.test(versions[0])
        ? "public, max-age=31536000, immutable"
        : "no-cache";
  }
  return response;
}

async function consoleApi(req, env, url) {
  const path = url.pathname,
    r = repo(env, null);
  if (
    req.method === "POST" &&
    ["/api/setup/prepare", "/api/setup", "/api/login"].includes(path)
  )
    return platformAuth(req, env, path, await body(req));
  const a = await authenticateAdmin(req, env),
    info = clientInfo(req);
  if (
    a.role !== "owner" &&
    !(
      a.role === "consultant" &&
      (/^\/api\/promo(?:\/|$)/.test(path) ||
        (path === "/api/me" && req.method === "GET") ||
        (path === "/api/logout" && req.method === "POST"))
    )
  )
    fail(403, "没有权限");
  if (path === "/api/platform/accounts" && req.method === "GET")
    return json({ items: await r.platformAccounts(offsetOf(url)) });
  if (
    ["/api/platform/accounts", "/api/platform/accounts/prepare"].includes(
      path,
    ) &&
    req.method === "POST"
  )
    return json(await consultantEnrollment(req, env, a, path, await body(req)));
  const account = /^\/api\/platform\/accounts\/([A-Za-z0-9_-]{1,80})$/.exec(
    path,
  );
  if (account && req.method === "PATCH") {
    const d = await body(req);
    if (typeof d.active !== "boolean") fail(400, "启用状态不正确");
    await r.setPlatformAccountActive(
      account[1],
      Number(d.active),
      a.id,
      info.ip,
    );
    return json({ ok: true });
  }
  if (path === "/api/platform/features/referrals") {
    if (req.method === "GET")
      return json({ enabled: await r.referralsEnabled() });
    if (req.method === "PUT") {
      const d = await body(req);
      if (typeof d.enabled !== "boolean") fail(400, "开关格式不正确");
      await r.setReferralsEnabled(d.enabled, a.id, info.ip);
      return json({ enabled: d.enabled });
    }
  }
  const promoResult = await promoConsole(req, env, url, a, body);
  if (promoResult !== undefined)
    return promoResult instanceof Response ? promoResult : json(promoResult);
  if (
    /^\/api\/(?:referrals|tenants\/[^/]+\/referrals)(?:\/|$)/.test(path) &&
    !(await r.referralsEnabled())
  )
    return neutral404();
  const lifecycle = await tenantLifecycle(req, env, path, a, info.ip, body);
  if (lifecycle !== undefined) return json(lifecycle);
  const toolResult = await adminTools(req, env, url, a, body);
  if (toolResult !== undefined)
    return toolResult instanceof Response ? toolResult : json(toolResult);
  if (path === "/api/me" && req.method === "GET")
    return json({
      username: a.username,
      role: a.role,
      referrals_enabled: a.role === "owner" && (await r.referralsEnabled()),
      security_warnings: turnstileMode(env) === "off" ? ["人机验证未开启"] : [],
      labels: {
        modules: MODULE_LABELS,
        actions: ACTION_LABELS,
        lessons: LESSON_LABELS,
        attendance: ATTENDANCE_LABELS,
        leads: LEAD_STAGES,
      },
    });
  if (path === "/api/logout" && req.method === "POST") {
    await body(req);
    await r.revokeAdmin(a.hash);
    return json({ ok: true }, 200, {
      "Set-Cookie":
        "__Host-channel_console=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
    });
  }
  if (path === "/api/logs" && req.method === "GET")
    return json({ items: await r.platformLogs(offsetOf(url)) });
  if (path === "/api/alerts" && req.method === "GET")
    return json({ items: await r.platformAlerts(offsetOf(url)) });
  if (path === "/api/tenants" && req.method === "GET")
    return json({ items: await r.listTenants(offsetOf(url)) });
  if (path === "/api/tenants" && req.method === "POST") {
    const data = await body(req),
      t = tenantData(data);
    if (await r.slugTaken(t.slug)) fail(409, "机构路径不可用");
    t.id = randomId("ten");
    t.contact_enc = await encrypt(
      env,
      string(data.contact || "", "联系人", 200, 0),
      t.id + ":contact",
    );
    await r.createTenant(t, a.id, modules);
    return json({ id: t.id }, 201);
  }
  const match =
    /^\/api\/tenants\/([^/]+)(?:\/(brand|modules|supervisors|reset-password))?$/.exec(
      path,
    );
  if (!match) return neutral404();
  const id = recordId(match[1]),
    tr = repo(env, id),
    t = await tr.tenant();
  if (!t) fail(404, "不存在");
  const section = match[2];
  if (req.method === "GET" && !section)
    return json({
      tenant: (({ contact_enc, ...rest }) => rest)(t),
      brand: await (async () => {
        const b = await tr.brand();
        return {
          ...b,
          image_budget: BRAND_IMAGE_BUDGET,
          contact_text: await decrypt(env, b.contact_text, id + ":contact"),
        };
      })(),
      policy: await tr.policy(),
      users: (await tr.users()).map(publicUser),
    });
  if (await r.purgeJob(id)) fail(409, "机构删除作业进行中");
  if (req.method === "PATCH" && !section) {
    const data = await body(req),
      next = tenantData(data);
    if (t.disabled_at != null && next.status === "active")
      fail(409, "请通过恢复启用操作恢复机构");
    if (await r.slugTaken(next.slug, t.id)) fail(409, "机构路径不可用");
    await r.updateTenant(id, version(data.version), next, a.id);
    return json({ ok: true });
  }
  if (req.method === "PUT" && section === "brand") {
    const data = await body(req);
    if (!/^#[a-f0-9]{6}$/i.test(data.theme_color || ""))
      fail(400, "主题色格式不正确");
    await r.saveBrand(
      id,
      version(data.version),
      {
        display_name: string(data.display_name, "显示名称", 100),
        logo: imageValue(data.logo),
        consultant_qr: imageValue(data.consultant_qr),
        contact_text: await encrypt(
          env,
          string(data.contact_text || "", "联系说明", 200, 0),
          id + ":contact",
        ),
        login_bg: imageValue(data.login_bg),
        theme_color: data.theme_color,
        welcome_text: string(data.welcome_text || "", "欢迎语", 60, 0),
      },
      a.id,
    );
    return json({ ok: true });
  }
  if (req.method === "PUT" && section === "modules") {
    const data = await body(req);
    if (!modules.includes(data.module) || typeof data.enabled !== "boolean")
      fail(400, "模块格式不正确");
    await r.module(id, data.module, data.enabled, a.id);
    return json({ ok: true });
  }
  if (req.method === "POST" && section === "supervisors") {
    const data = await body(req);
    if (JSON.stringify(data.roles) !== JSON.stringify(["supervisor"]))
      fail(400, "此入口只创建主管");
    const result = await createAccount(env, t, a, null, data, true);
    await r.platformLog(a.id, "create_supervisor", id, "创建机构主管", info.ip);
    return json(result, 201);
  }
  if (req.method === "POST" && section === "reset-password") {
    const data = await body(req);
    recordId(data.user_id);
    const result = await resetAccount(env, t, a, data.user_id, true);
    await r.platformLog(a.id, "reset_password", id, "重置账号密码", info.ip);
    return json(result);
  }
  return neutral404();
}
const tenantAuthenticatedApi = (path) =>
    identityPath(path) || toolSettingsPath(path) || planPath(path) || contentPath(path) || aiPath(path) || growthPath(path) || styleAssetPath(path) ||
    ["/api/read-batch", "/api/schedule-templates"].includes(path) ||
    /^\/api\/c[23]\//.test(path) ||
    /^\/api\/students\/[^/]+\/fixed-rules$/.test(path) ||
    /^\/api\/promo(?:\/|$)/.test(path) ||
    [
      "/api/imports/template",
      "/api/imports/preview",
      "/api/imports/commit",
    ].includes(path) ||
    /^\/api\/tools\/[a-z_]+(?:\/[^/]+)?(?:\/(convert|contact|members))?$/.test(
      path,
    ) ||
    /^\/api\/system-messages(?:\/[^/]+\/read)?$/.test(path) ||
    [
      "/api/finance/receivable-summary",
      "/api/search",
      "/api/todo/summary",
      "/api/workbench",
      "/api/renewals",
      "/api/renewals/remind",
      "/api/renewal-brand",
      "/api/renewal-settings",
      "/api/followup-assignees",
    ].includes(path) ||
    /^\/api\/lessons\/[^/]+\/(review|comments)$/.test(path) ||
    /^\/api\/submissions\/[^/]+\/(confirm|return)$/.test(path) ||
    ["/api/submissions", "/api/brand-timetable", "/api/schedule-next"].includes(
      path,
    ) ||
    /^\/api\/finance\/(rates|payments|adjustments|costs|tuition)(?:\/[^/]+)?$/.test(
      path,
    ) ||
    [
      "/api/finance/payroll",
      "/api/finance/report",
      "/api/finance/settlement",
      "/api/export",
    ].includes(path) ||
    /^\/api\/finance\/settlements\/(submit|approve|unlock|reject)$/.test(
      path,
    ) ||
    /^\/api\/finance\/lessons\/[^/]+\/rate$/.test(path) ||
    /^\/api\/credits\/(?:balance(?:\/(?:redeem|adjust))?|payments\/[^/]+\/(?:resolve|reverse))$/.test(path) ||
    /^\/api\/credits\/(packages|transactions|payments|stages|makeups)(?:\/[^/]+)?$/.test(
      path,
    ) ||
    /^\/api\/credits\/lessons\/[^/]+\/(attendance|status|undo|delete)$/.test(
      path,
    ) ||
    /^\/api\/credits\/makeups\/[^/]+\/unlink$/.test(path) ||
    [
      "/api/credits/transfer",
      "/api/credits/adjust",
      "/api/credits/makeups",
    ].includes(path) ||
    /^\/api\/data\/(students|teachers|course_categories|course_types|locations|student_schedule_blocks|schedule_templates|schedule_enrollments|lessons|packages)(?:\/[^/]+)?(?:\/contact)?$/.test(
      path,
    ) ||
    path === "/api/templates/generate" ||
    path === "/api/schedule" ||
    path === "/api/reorder" ||
    path === "/api/absence-policies" ||
    path === "/api/me" ||
    path === "/api/logout" ||
    path === "/api/password" ||
    path === "/api/accounts" ||
    path === "/api/rights" ||
    path === "/api/settings" ||
    path === "/api/logs" ||
    /^\/api\/accounts\/[^/]+(?:\/(reset-password|phone|sessions)(?:\/[^/]+)?)?$/.test(
      path,
    ) ||
    path === "/api/sessions" ||
    /^\/api\/sessions\/[^/]+$/.test(path);

const tenantHtmlRoutes = new Set([
      "/",
      "/login",
      "/app",
      "/app/",
      "/app/accounts",
      "/app/profile",
      "/app/logs",
      "/app/students",
      "/app/teachers",
      "/app/schedule",
      "/app/templates",
      "/app/settings",
    ]);

async function tenantApi(req, env, resolved, url, context) {
  const { tenant: t, base, relative: path } = resolved,
    r = repo(env, t.id);
  if (identityPath(path) || toolSettingsPath(path) || planPath(path) || contentPath(path) || aiPath(path) || growthPath(path) || styleAssetPath(path)) env.__identityContract = true;
  env.__identityStatus = path === "/api/auth/status";
  if (env.__identityStatus && !resolved.hash)
    return json({ authenticated: false, api_base: base.replace(/\/$/, "") + "/api",
      tenant_status: t.status !== "active" ? "paused" :
        (t.expires_at && Date.parse(t.expires_at + "T23:59:59+08:00") <= now() ? "expired" : "active") });
  if (["/api/public/brand/login-bg", "/api/public/brand/logo"].includes(path) && req.method === "GET") {
    const version = url.searchParams.get("v");
    if (!/^[1-9][0-9]{0,14}$/.test(version || "")) return neutral404();
    const row = await r.brandImage(path.endsWith("/logo") ? "logo" : "login_bg", Number(version));
    if (!row?.image) return neutral404();
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(row.image);
    if (!match) return neutral404();
    let bytes;
    try { bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0)); }
    catch { return neutral404(); }
    env.__cacheControl = "public, max-age=31536000, immutable";
    return new Response(bytes, { headers: { "Content-Type": "image/" + match[1] } });
  }
  if (path === "/api/public/brand" && req.method === "GET") {
    if (url.searchParams.get("lite") === "1") {
      const b = await r.brandLite();
      env.__cacheControl = "private, max-age=60";
      return json({ display_name:b.display_name, theme_color:b.theme_color, welcome_text:b.welcome_text,
        logo:b.has_logo ? base + "api/public/brand/logo?v=" + b.version : null,
        login_bg_url:b.has_bg ? base + "api/public/brand/login-bg?v=" + b.version : null });
    }
    const b = await r.brand();
    env.__cacheControl = "private, max-age=60";
    return json({
      display_name: b.display_name,
      logo: b.logo,
      login_bg: b.login_bg,
      theme_color: b.theme_color,
      welcome_text: b.welcome_text,
    });
  }
  if (path === "/api/public/theme.css" && req.method === "GET") {
    const b = await r.brand();
    const color = /^#[a-f0-9]{6}$/i.test(b.theme_color)
      ? b.theme_color
      : "#2B4C7E";
    return new Response(":root { --theme: " + color + "; }", {
      headers: { "Content-Type": "text/css; charset=utf-8" },
    });
  }
  if (["/api/login", "/api/auth/login"].includes(path) && req.method === "POST")
    return loginTenant(req, env, t, base, await body(req));
  if (!tenantAuthenticatedApi(path)) return neutral404();
  let user = context?.user ?? await authenticate(req, env, t, base, resolved);
  const policy = context?.policy ?? await r.policy();
  if (
    user.must_change &&
    !["/api/me", "/api/password", "/api/logout", "/api/auth/status"].includes(path)
  )
    fail(403, "请先修改初始密码", "PASSWORD_CHANGE_REQUIRED");
  const identityResult = await identityTenant(req, env, resolved, user, policy, url);
  if (identityResult !== undefined) return identityResult;
  const styleAssetResult=await styleAssetsApi(req,env,resolved,user,policy,url);
  if(styleAssetResult!==undefined)return styleAssetResult;
  const aiResult = await aiApi(req, env, resolved, user, policy, url);
  if (aiResult !== undefined) return aiResult;
  const contentResult = await contentApi(req, env, resolved, user, policy, url);
  if (contentResult !== undefined) return contentResult;
  const growthResult = await growthApi(req,env,resolved,user,policy,url);
  if(growthResult !== undefined) return growthResult;
  const plansResult = await plansApi(req, env, resolved, user, policy, url);
  if (plansResult !== undefined) return plansResult;
  const settingsResult = await toolSettingsApi(req, env, resolved, user, policy, url);
  if (settingsResult !== undefined) return settingsResult;
  user = await identityParentScope(user, r, path, url);
  if (path === "/api/read-batch" && req.method === "POST")
    return readBatch(req, env, resolved, async (child, childUrl, childResolved) => {
      try { return await tenantApi(child, env, childResolved, childUrl, { user, policy }); }
      catch (error) { return errorResponse(error, env, childUrl); }
    });
  if (path === "/api/schedule-templates" && req.method === "GET") {
    const alias = "/api/data/schedule_templates";
    return tenantApi(req, env, { ...resolved, relative: alias }, url, { user, policy });
  }
  if (path === "/api/schedule-next" && req.method === "GET") {
    const scope = { teacher_id: user.teacher_id, student_id: user.student_id };
    requireCan(user, policy, "schedule", "read", scope);
    const row = await r.nextLesson(
      user,
      now(),
      beijingTime(now()).slice(0, 10),
    );
    if (
      row &&
      !can(user, policy, "schedule", "read", {
        ...row,
        ...(user.roles.includes("student")
          ? { student_id: user.student_id }
          : {}),
      })
    )
      return json({ record: null });
    if (row) await addStudentSummaries(r, [row], user);
    return json({
      record: row
        ? Object.fromEntries(
            [
              "id",
              "start_at",
              "duration",
              "units",
              "mode",
              "status",
              "course_name",
              "source_course_id",
              "source_session_id",
              "teacher_name",
              "location_name",
              "participants_summary",
            ].map((k) => [k, row[k]]),
          )
        : null,
    });
  }
  if (path.startsWith("/api/c3/"))
    return json(await rebuild3Api(req, env, t, user, policy, path, url, body));
  if (/^\/api\/c[23]\//.test(path))
    return json(await rebuildApi(req, env, t, user, policy, path, url, body));
  if (path.startsWith("/api/promo")) {
    const result = await promoTenant(
      req,
      env,
      t,
      user,
      policy,
      path,
      url,
      body,
    );
    return result instanceof Response ? result : json(result);
  }
  if (path.startsWith("/api/imports/")) {
    const result = await importsApi(req, env, t, user, policy, path, url, body);
    return result instanceof Response ? result : json(result);
  }
  if (
    path.startsWith("/api/tools/") ||
    path.startsWith("/api/system-messages") ||
    [
      "/api/finance/receivable-summary",
      "/api/search",
      "/api/todo/summary",
      "/api/workbench",
      "/api/renewals",
      "/api/renewals/remind",
      "/api/renewal-brand",
      "/api/renewal-settings",
      "/api/followup-assignees",
    ].includes(path)
  )
    return json(await toolsApi(req, env, t, user, policy, path, url, body));
  if (path.startsWith("/api/lessons/") || path.startsWith("/api/submissions"))
    return json(await reviewApi(req, env, t, user, policy, path, url, body));
  if (path === "/api/brand-timetable" && req.method === "GET")
    return json(await timetableApi(env, t, user, policy, url));
  if (path === "/api/reorder" && req.method === "PUT")
    return json(await reorderBusiness(env, t, user, policy, await body(req)));
  if (path === "/api/schedule" && req.method === "GET")
    return json(await scheduleView(env, t, user, policy, url));
  const fixedRules = /^\/api\/students\/([^/]+)\/fixed-rules$/.exec(path);
  if (fixedRules && req.method === "GET")
    return json(await fixedRulesView(env, t, user, policy, fixedRules[1]));
  if (path === "/api/absence-policies") {
    if (req.method === "GET") {
      requireCan(user, policy, "settings", "read");
      return json({
        policies: effectivePolicies(policy.settings),
      });
    }
    if (req.method === "PUT") {
      requireCan(user, policy, "settings", "configure_absence");
      const data = await body(req),
        policies = {};
      for (const key of [
        "student_leave",
        "student_no_show",
        "teacher_leave",
        "cancelled",
      ]) {
        if (
          typeof data.policies?.[key]?.deduct !== "boolean" ||
          typeof data.policies?.[key]?.teacherPaid !== "boolean"
        )
          fail(400, "规则格式不正确");
        policies[key] = {
          deduct: data.policies[key].deduct,
          teacherPaid: data.policies[key].teacherPaid,
        };
      }
      await r.saveSetting("absence_policies", policies, user);
      return json({ ok: true });
    }
  }
  if (path.startsWith("/api/finance/") || path === "/api/export") {
    const result = await financeApi(req, env, t, user, policy, path, url, body);
    return result instanceof Response ? result : json(result);
  }
  if (
    path.startsWith("/api/credits/") ||
    /^\/api\/data\/packages(?:\/[^/]+)?$/.test(path) ||
    (req.method === "DELETE" && /^\/api\/data\/lessons\/[^/]+$/.test(path))
  )
    return json(await creditApi(req, env, t, user, policy, path, url, body));
  if (path.startsWith("/api/data/"))
    return json(await businessApi(req, env, t, user, policy, path, url, body));
  if (path === "/api/templates/generate" && req.method === "POST")
    return json(
      await generateTemplates(req, env, t, user, policy, await body(req)),
    );
  if (path === "/api/me" && req.method === "GET") {
    const referrals = await r.referralsEnabled();
    return json({
      features: { referrals },
      user: publicUser(user),
      labels: {
        import_headers: IMPORT_HEADERS,
        lead_stages: LEAD_STAGES,
        modules: MODULE_LABELS,
        actions: ACTION_LABELS,
        lessons: LESSON_LABELS,
        attendance: ATTENDANCE_LABELS,
        reviews: REVIEW_LABELS,
        events: AUTH_EVENT_LABELS,
        rate_units: RATE_UNITS,
        promo: PROMO_LABELS,
      },
      tenant_id: t.id,
      api_base: resolved.root ? "/api" : base.replace(/\/$/, "") + "/api",
      // 前端外壳用：根地址登录时没有机构路径，靠机构代号取品牌、显示老师/家长登录地址。不增加查询。
      tenant_slug: t.slug,
      module_labels: { ...MODULE_LABELS, ...identityLabels },
      policy: { ...policy, settings: { ...policy.settings, max_debt_units: maxDebtUnits(policy.settings) } },
      capabilities: Object.fromEntries(
        [...modules,"plan_templates","plan_references"].map((module) => [
          module,
          Object.fromEntries(
            [
              "read", "write", "share", "publish", "unpublish", "manage", "use", "propose",
              "read_finance",
              "create",
              "update",
              "delete",
              "export",
              "approve",
              "adjust",
              "transfer",
              "submit",
              "unlock",
              "confirm",
              "return",
              "correct",
              "create_personal",
              "reset_personal",
              "reveal_phone",
            ].map((action) => [
              action,
              (module !== "referrals" || referrals) &&
                can(
                  user,
                  policy,
                  module,
                  action,
                  module === "accounts" &&
                    ["create_personal", "reset_personal"].includes(action)
                    ? { roles: ["student"] }
                    : module === "profile"
                      ? user
                      : {
                          teacher_id: user.teacher_id,
                          student_id: user.student_id,
                        },
                ),
            ]),
          ),
        ]),
      ),
      limits: { staff: t.staff_seat_limit, student: t.student_seat_limit },
    });
  }
  if (path === "/api/logout" && req.method === "POST") {
    await body(req);
    await r.revokeSession(user.token_hash);
    return json({ ok: true }, 200, { "Set-Cookie": resolved.root ? clearRootCookie() : clearCookie(base) });
  }
  if (path === "/api/password" && req.method === "POST") {
    requireCan(user, policy, "profile", "update", user);
    await changeTenantPassword(env, t, user, await body(req));
    return json({ ok: true }, 200, { "Set-Cookie": resolved.root ? clearRootCookie() : clearCookie(base) });
  }
  if (path === "/api/accounts" && req.method === "GET") {
    requireCan(user, policy, "accounts", "read");
    const offset = offsetOf(url),
      [items, total] = await Promise.all([r.users(offset), r.userCount()]);
    return json({
      items: items.map(publicUser),
      total,
      next_offset: offset + 200 < total ? offset + 200 : null,
    });
  }
  if (path === "/api/accounts" && req.method === "POST") {
    return json(
      await createAccount(env, t, user, policy, await body(req)),
      201,
    );
  }
  if (path === "/api/rights" && req.method === "PUT") {
    requireCan(user, policy, "accounts", "manage_rights");
    const d = await body(req);
    const batch = Object.hasOwn(d, "changes");
    const changes = batch ? d.changes : [d];
    if (!Array.isArray(changes) || changes.length < 1 || changes.length > 100)
      fail(400, "每次保存须包含 1 至 100 项权限");
    const actions = [
      "read",
      "create",
      "update",
      "delete",
      "export",
      "approve",
      "create_personal",
      "rates_update",
      "adjust",
      "transfer",
      "submit",
    ];
    const unique = new Map();
    for (const change of changes) {
      if (
        !change ||
        typeof change !== "object" ||
        Array.isArray(change) ||
        !["academic", "finance"].includes(change.role) ||
        !modules.includes(change.module) ||
        change.module === "accounts" ||
        !actions.includes(change.action) ||
        typeof change.allowed !== "boolean"
      )
        fail(400, "权限配置不正确");
      const { role, module, action, allowed } = change;
      unique.set(role + ":" + module + ":" + action, {
        role,
        module,
        action,
        allowed,
      });
    }
    if (batch) await r.saveRightsBatch([...unique.values()], user);
    else await r.saveRights(d.role, d.module, d.action, d.allowed, user);
    return json({ ok: true });
  }
  if (path === "/api/settings" && req.method === "GET") {
    requireCan(user, policy, "settings", "read");
    return json({ feedback_auto_confirm:false,teacher_can_publish_reports:false,...policy.settings, max_debt_units: maxDebtUnits(policy.settings) });
  }
  if (path === "/api/settings" && req.method === "PUT") {
    requireCan(user, policy, "accounts", "manage_settings");
    const d = await body(req);
    if (d.key === "max_debt_units") {
      quantityIn(d.value, { zero: true });
    } else if (d.key === "default_schedule_view") {
      if (!["time", "teacher", "location", "list"].includes(d.value))
        fail(400, "课表视图不正确");
    } else if (
      ![
        "student_view_payments",
        "student_view_balance",
        "teacher_self_checkin",
        "teacher_view_student_balance",
        "academic_can_create_accounts",
        "academic_can_reset_accounts",
        "feedback_auto_confirm",
        "teacher_can_publish_reports",
      ].includes(d.key) ||
      typeof d.value !== "boolean"
    )
      fail(400, "设置格式不正确");
    if(["feedback_auto_confirm","teacher_can_publish_reports"].includes(d.key)&&!user.roles.includes("supervisor")) fail(403,"仅主管可修改","forbidden");
    await r.saveSetting(d.key, d.value, user);
    return json({ ok: true });
  }
  if (path === "/api/logs" && req.method === "GET") {
    const full = can(user, policy, "logs", "read");
    if (!full) requireCan(user, policy, "logs", "read_finance");
    const from = url.searchParams.get("from") || "",
      to = url.searchParams.get("to") || "";
    if (from) day(from);
    if (to) day(to);
    if (from && to && from > to) fail(400, "开始日期不能晚于结束日期");
    const filters = {
      actor: string(url.searchParams.get("actor") || "", "操作人", 100, 0),
      module: string(url.searchParams.get("module") || "", "模块", 80, 0),
      action: string(url.searchParams.get("action") || "", "操作", 80, 0),
      from: from ? Date.parse(from + "T00:00:00+08:00") : 0,
      to: to ? Date.parse(to + "T00:00:00+08:00") + 86400000 : 8640000000000000,
    };
    const kind = url.searchParams.get("kind") === "login" ? "login" : "audit",
      offset = offsetOf(url),
      [items, total] = await Promise.all([
        r.logs(kind, offset, !full, filters),
        r.logs(kind, offset, !full, filters, true),
      ]);
    return json({
      total,
      next_offset: offset + 200 < total ? offset + 200 : null,
      items: items.map((row) => {
        const out = { ...row };
        for (const key of ["before_json", "after_json"]) {
          if (!out[key]) continue;
          try {
            out[key] = JSON.stringify(
              projectRecord(
                user,
                policy,
                row.module,
                row.money_version === 1
                  ? moneyOut(JSON.parse(out[key]))
                  : JSON.parse(out[key]),
              ),
            );
          } catch {
            out[key] = null;
          }
        }
        return out;
      }),
    });
  }
  if (path === "/api/sessions" && req.method === "GET") {
    requireCan(user, policy, "profile", "read", user);
    return json({ items: await r.sessions(user.id) });
  }
  if (path.startsWith("/api/sessions/") && req.method === "DELETE") {
    await body(req);
    requireCan(user, policy, "profile", "update", user);
    await r.revokeDevice(user.id, recordId(path.split("/").at(-1)), user);
    return json({ ok: true });
  }
  const m =
    /^\/api\/accounts\/([^/]+)(?:\/(reset-password|phone|sessions)(?:\/([^/]+))?)?$/.exec(
      path,
    );
  if (m) {
    if (m[2] === "reset-password" && req.method === "POST") {
      await body(req);
      return json(
        await resetAccount(env, t, user, recordId(m[1]), false, policy),
      );
    }
    requireCan(user, policy, "accounts", "read");
    const target = await r.user(recordId(m[1]));
    if (!target) fail(404, "不存在");
    if (!m[2] && req.method === "GET")
      return json({ user: publicUser(target) });
    if (!m[2] && req.method === "PATCH") {
      requireCan(user, policy, "accounts", "update", target);
      const d = await body(req);
      const roles = rolesInput(d.roles);
      if (
        JSON.parse(target.roles).includes("supervisor") ||
        roles.includes("supervisor")
      )
        fail(403, "主管账号请联系系统维护管理");
      const previousRoles = JSON.parse(target.roles);
      if (
        roles.some((x) => ["teacher", "student", "parent"].includes(x)) ||
        previousRoles.some((x) => ["teacher", "student", "parent"].includes(x))
      ) {
        if (JSON.stringify(roles) !== target.roles)
          fail(400, "个人账号与员工角色不能互换");
        if (d.active && roles[0] !== "parent") {
          const kind = roles[0] === "teacher" ? "teachers" : "students",
            profile = await r.businessGet(
              kind,
              roles[0] === "teacher" ? target.teacher_id : target.student_id,
            );
          if (!profile || profile.status !== "active")
            fail(400, "请先重新启用关联档案");
        }
      }
      if (typeof d.active !== "boolean") fail(400, "账号状态不正确");
      await r.updateUser(
        target.id,
        version(d.version),
        {
          name: string(d.name, "姓名", 50),
          roles: JSON.stringify(roles),
          active: d.active ? 1 : 0,
          ...(d.phone !== undefined ? {
            phone_hmac: await phoneIndex(env, t.id, d.phone),
            phone_enc: await encrypt(env, d.phone, t.id + ":phone"),
            phone_last4: d.phone.slice(-4),
            platform_phone_hmac: await platformPhoneIndex(env, d.phone),
          } : {}),
        },
        user,
      );
      return json({ ok: true });
    }
    if (m[2] === "phone" && req.method === "POST") {
      await body(req);
      requireCan(user, policy, "accounts", "reveal_phone", target);
      await r.audit(
        user,
        "accounts",
        "reveal_phone",
        target.id,
        "查看完整手机号",
      );
      return json({
        phone: await decrypt(env, target.phone_enc, t.id + ":phone"),
      });
    }
    if (m[2] === "sessions" && req.method === "GET")
      return json({ items: await r.sessions(target.id) });
    if (m[2] === "sessions" && m[3] && req.method === "DELETE") {
      await body(req);
      requireCan(user, policy, "accounts", "update");
      await r.revokeDevice(target.id, recordId(m[3]), user);
      return json({ ok: true });
    }
  }
  return neutral404();
}
async function dispatch(req, env, url) {
  if (url.hostname === env.CONSOLE_HOST) {
    if (url.pathname.startsWith("/api/ops/")) return identityOps(req, env, url);
    const mode = accessMode(env);
    if (mode === "on") await requireAccess(req, env);
    if (staticConsole.has(url.pathname) && ["GET", "HEAD"].includes(req.method))
      return serveStatic(env, req, url);
    if (url.pathname.startsWith("/api/")) return consoleApi(req, env, url);
    if (url.pathname === "/" && req.method === "GET")
      return serve(env, req, "/console.html", {
        __ACCESS_NOTICE__:
          mode === "off"
            ? '<p id="access-notice" class="muted center" role="note">当前未启用 Cloudflare Access 外层保护</p>'
            : "",
      });
    return neutral404();
  }
  // 在进行机构识别前即拒绝控制台资源，防止 Pages 静态回退泄漏。
  if (
    url.pathname.startsWith("/console") ||
    url.pathname === "/_worker.js" ||
    url.pathname.startsWith("/src/") ||
    url.pathname.endsWith(".map")
  )
    return neutral404();
  if (
    staticTenant.has(url.pathname) &&
    ["GET", "HEAD"].includes(req.method) &&
    url.hostname === env.TENANT_HOST
  )
    return serveStatic(env, req, url);
  // 根地址（管理者入口）：/ 转到 /login；/login 与 /app 下的页面给同一个前端外壳，基础路径为 /。
  // 只给静态外壳，不读任何机构数据；登录状态由前端调用 /api/me 判断（未登录 401 → /login）。
  if (
    url.hostname === env.TENANT_HOST &&
    ["GET", "HEAD"].includes(req.method) &&
    tenantHtmlRoutes.has(url.pathname)
  ) {
    if (url.pathname === "/")
      return new Response(null, { status: 302, headers: { Location: "/login" } });
    return serve(env, req, "/tenant.html", {
      __BASE__: "/",
      __TURNSTILE_MODE__: turnstileMode(env),
      __SITEKEY__:
        turnstileMode(env) === "on"
          ? env.TURNSTILE_SITE_KEY.replace(/[^a-zA-Z0-9_-]/g, "")
          : "",
    });
  }
  // Public page shell never resolves the token or enters the institution login shell.
  if (url.hostname === env.TENANT_HOST && req.method === "GET" && /^\/s\/[^/]+$/.test(url.pathname)) {
    env.__shareShell = true;
    return serve(env, req, "/share/index.html");
  }
  const publicPlan = await plansPublic(req, env, url);
  if (publicPlan) return publicPlan;
  const identity = await identityRoot(req, env, url, tenantAuthenticatedApi);
  if (identity?.response) return identity.response;
  if (identity?.resolved) {
    env.__tenantResolved = identity.resolved;
    return tenantApi(req, env, identity.resolved, url);
  }
  const relativeIdentityPath = "/" + url.pathname.split("/").slice(2).join("/");
  if (identityPath(relativeIdentityPath) || toolSettingsPath(relativeIdentityPath) || planPath(relativeIdentityPath) || contentPath(relativeIdentityPath) || aiPath(relativeIdentityPath)) env.__identityContract = true;
  const htmlMethod = ["GET", "HEAD"].includes(req.method);
  const resolved = await resolveTenant(req, env, (path) =>
    tenantAuthenticatedApi(path) || (htmlMethod && path.startsWith("/app") && tenantHtmlRoutes.has(path)),
  );
  env.__tenantResolved = resolved;
  if (!resolved) return neutral404();
  if (staticTenant.has(url.pathname) && ["GET", "HEAD"].includes(req.method))
    return serveStatic(env, req, url);
  if (resolved.alias) {
    if (!["GET", "HEAD"].includes(req.method)) return neutral404();
    return new Response(null, {
      status: 308,
      headers: { Location: resolved.redirect },
    });
  }
  if (resolved.relative.startsWith("/api/"))
    return tenantApi(req, env, resolved, url);
  if (
    htmlMethod && tenantHtmlRoutes.has(resolved.relative)
  ) {
    if (resolved.relative === "/")
      return new Response(null, {
        status: 302,
        headers: { Location: resolved.base + "login" },
      });
    if (resolved.relative.startsWith("/app")) {
      try {
        await authenticate(req, env, resolved.tenant, resolved.base, resolved);
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 401 || error.code !== "SESSION_INVALID") throw error;
        return new Response(null, {
          status: 302,
          headers: { Location: resolved.base + "login", "Set-Cookie": clearCookie(resolved.base) },
        });
      }
    }
    return serve(env, req, "/tenant.html", {
      __BASE__: resolved.base,
      __TURNSTILE_MODE__: turnstileMode(env),
      __SITEKEY__:
        turnstileMode(env) === "on"
          ? env.TURNSTILE_SITE_KEY.replace(/[^a-zA-Z0-9_-]/g, "")
          : "",
    });
  }
  return neutral404();
}
function errorResponse(e, env, url) {
  let response;
      // 艺界星途阶段 2：身份与机构接口的数据库约束错误转换成约定的错误码。
      if (env.__identityContract && /UNIQUE constraint failed: guardian_links/.test(String(e?.message)))
        e = new HttpError(409, "该家长已绑定这个学员", "duplicate");
      if (/guardian_limit/.test(String(e?.message))) e = new HttpError(422, "一个孩子最多4位家长，一个家长最多10个孩子", "validation_failed");
      else if (/staff_seat_limit/.test(String(e?.message))) e = new HttpError(403, "管理账号数量已达上限", "seat_limit_reached");
      else if (/guardian_parent_invalid|guardian_student_invalid/.test(String(e?.message))) e = new HttpError(404, "不存在", "not_found");
      if (e.code === "seat_limit_reached") e.status = 403;
      if (["tenant_expired", "not_found"].includes(e.code)) env.__identityContract = true;
      if (e instanceof HttpError) {
        response =
          e.status === 404
            ? neutral404()
            : json(
                {
                  error: e.message,
                  code: e.code,
                  ...(e.details ? { details: e.details } : {}),
                },
                e.status,
              );
        if (e.status === 401 && url.hostname !== env.CONSOLE_HOST) {
          const resolved = env.__tenantResolved;
          if (resolved)
            response.headers.set("Set-Cookie", resolved.root ? clearRootCookie() : clearCookie(resolved.base));
        }
      } else if (/partner_readonly/.test(String(e?.message))) {
        response = json(
          {
            error: "合作课次及名单由专用入口维护，不参与机构销课",
            code: "PARTNER_READONLY",
          },
          403,
        );
      } else if (
        /invalid_teacher_reference|invalid_student_reference|profile_in_use/.test(
          String(e?.message),
        )
      ) {
        response = json(
          {
            error: "关联档案状态或引用已变化，请刷新重试",
            code: "REFERENCE_CONFLICT",
          },
          409,
        );
      } else if (/tenant_disabled/.test(String(e?.message))) {
        response = json({ error: "机构已停用或正在删除", code: "TENANT_DISABLED" }, 409);
      } else if (/UNIQUE constraint|slug_reserved/.test(String(e?.message))) {
        response = json(
          { error: "记录或机构路径已存在，请刷新后重试", code: "CONFLICT" },
          409,
        );
      } else {
        const incident = randomId("err");
        console.error("request_failure", incident, e?.name);
        response = json(
          { error: "暂时无法完成操作，请稍后重试", code: incident },
          500,
        );
      }
  return response;
}
const worker = {
  async fetch(req, env) {
    const timerStart = performance.now(),
      timing = { trips: 0, dbMs: 0 };
    env = {
      ...env,
      CHANNEL_DB: measureDatabase(env.CHANNEL_DB, timing),
      __requestScope: true,
      __readRequest: req.method === "GET" || req.method === "HEAD" || (req.method === "POST" && /^\/(?:[^/]+\/)?api\/read-batch$/.test(new URL(req.url).pathname)),
    }; // 每个请求独立的仓储缓存，绝不跨请求复用授权或业务快照。
    const started = now(),
      url = new URL(req.url);
    let response;
    try {
      config(env);
      response = await dispatch(req, env, url);
      await accountReadResponse(req, env, response);
    } catch (e) {
      response = errorResponse(e, env, url);
    }
    if (env.__identityContract) {
      if (response.status === 404) response = json({ error: "not_found", message: "不存在" }, 404);
      else if (response.status >= 400) {
        const value = await response.clone().json().catch(() => null);
        if (value) {
          const code = identityErrorCode({ code: value.code || value.error, status: response.status });
          const headers = response.headers.get("Set-Cookie");
          response = json({ error: code, message: value.message || value.error, ...(value.details ? { details: value.details } : {}), ...(code === "possible_duplicate" && Array.isArray(value.details?.duplicates) ? {duplicates:value.details.duplicates} : {}) }, response.status);
          if (headers) response.headers.set("Set-Cookie", headers);
        }
      }
    }
    // 所有中性 404 使用相同模板、响应头及最低耗时；真实网络延迟无法保证逐毫秒相等。
    if (response.status === 404) {
      const remaining = 200 - (now() - started);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    }
    const secured = secureResponse(
      response,
      response.status === 200 &&
        (response.headers.get("content-type") || "").startsWith("text/html") &&
        url.hostname !== env.CONSOLE_HOST &&
        /\/login\/?$/.test(url.pathname) &&
        turnstileMode(env) === "on",
      response.status === 200 ? env.__cacheControl : undefined,
    );
    if (env.__shareShell) secured.headers.set("X-Robots-Tag", "noindex");
    else if (env.__planPublic) secured.headers.set("X-Robots-Tag", "noindex, nofollow");
    if (/^\/(?:[^/]+\/)?api\//.test(url.pathname))
      secured.headers.set("Server-Timing", apiTiming(timing, timerStart));
    return secured;
  },
};
export default worker;
