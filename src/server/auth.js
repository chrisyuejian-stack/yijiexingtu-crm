import {
  fail,
  turnstileMode,
  now,
  bytes,
  b64,
  sha,
  equal,
  clientInfo,
  randomId,
  json,
  string,
  phone,
} from "./core.js";
import { repo } from "./repo.js";
import {
  hmac,
  phoneIndex,
  digestPassword,
  newPassword,
  encrypt,
  decrypt,
  verifyTotp,
  base32,
  validatePassword,
} from "./crypto.js";
import { publicUser } from "./permissions.js";
export const cookieName = "channel_session";
export function readCookie(req, name) {
  const matches = (req.headers.get("cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .filter((x) => x.startsWith(name + "="));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : "";
}
export const sessionCookie = (token, base, personal = false) =>
  `${cookieName}=${token}; Path=${base}; HttpOnly; Secure; SameSite=Strict; Max-Age=${personal ? 1209600 : 43200}`;
export const clearCookie = (base) =>
  `${cookieName}=; Path=${base}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
export async function tenantSessionHash(req) {
  const token = readCookie(req, cookieName);
  return /^[A-Za-z0-9+/]{43}=$/.test(token) ? sha(token) : null;
}
export async function authenticate(req, env, tenant, base, resolved) {
  const hash = resolved?.hash ?? await tenantSessionHash(req);
  if (!hash)
    fail(401, "请重新登录", "SESSION_INVALID");
  const r = repo(env, tenant.id),
    u = resolved?.auth === undefined ? await r.authenticateRequest(hash) : resolved.auth;
  if (
    !u ||
    u.tenant_id !== tenant.id ||
    u.expires_at <= now() ||
    (u.idle_ms && u.last_seen_at + u.idle_ms <= now())
  ) {
    await r.revokeSession(hash);
    fail(401, "请重新登录", "SESSION_INVALID");
  }
  u.roles = typeof u.roles === "string" ? JSON.parse(u.roles) : u.roles;
  u.token_hash = hash;
  env.__reader = { tenantId: tenant.id, user: u };
  if (!env.__identityStatus && (tenant.status !== "active" ||
      (tenant.expires_at && Date.parse(tenant.expires_at + "T23:59:59+08:00") <= now())))
    fail(403, "机构已到期或停用，请联系机构负责人", "tenant_expired");
  return u;
}
export async function loginTenant(req, env, tenant, base, data) {
  const r = repo(env, tenant.id),
    info = clientInfo(req);
  string(data.phone, "手机号", 64);
  string(data.password, "密码", 256);
  const mobile = /^1[3-9]\d{9}$/.test(data.phone) ? data.phone : "13800000000";
  const index = await phoneIndex(env, tenant.id, mobile),
    key = "login:" + tenant.id + ":" + index,
    ipKey = "login-ip:" + info.ip;
  // 默认仍需服务端验证；只有明确的生产配置off关闭挑战，失败日志和限流继续执行。
  const challengeDisabled = turnstileMode(env) === "off";
  const phoneLimit = challengeDisabled ? 3 : 5;
  const ipLimit = challengeDisabled ? 10 : 20;
  let verified = challengeDisabled;
  if (!verified)
    try {
      const response = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          body: new URLSearchParams({
            secret: env.TURNSTILE_SECRET,
            response: String(data.turnstile || "").slice(0, 4096),
            remoteip: info.ip,
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      const result = await response.json();
      verified =
        typeof data.turnstile === "string" &&
        data.turnstile.length > 0 &&
        result.success === true &&
        result.hostname === new URL(req.url).hostname &&
        result.action === "login";
    } catch {}
  const u = await r.userByPhone(index),
    computed = await digestPassword(
      env,
      data.password,
      u?.salt || "AAAAAAAAAAAAAAAAAAAAAA==",
    );
  const locked = await r.tenantLoginLimited(key, ipKey, phoneLimit, ipLimit);
  if (
    !verified ||
    locked ||
    !u ||
    !u.active ||
    !/^[1][3-9]\d{9}$/.test(data.phone) ||
    !equal(computed, u.digest)
  ) {
    const failureLocked = await r.tenantLoginLimited(key, ipKey, phoneLimit, ipLimit, true);
    await r.authEvent(
      u?.id,
      data.phone.slice(-4),
      locked || failureLocked ? "login_locked" : "login_failed",
      info,
    );
    fail(401, "手机号或密码不正确", "LOGIN_FAILED");
  }
  await r.clearLimit(key);
  const token = b64(bytes(32));
  await r.createSession(await sha(token), u, info, tenant.version);
  await r.authEvent(u.id, u.phone_last4, "login_success", info);
  if (req.cf?.city && req.cf?.country)
    await r.loginCity(
      u.id,
      await hmac(
        env.HMAC_KEY,
        tenant.id + ":city:" + req.cf.country + ":" + req.cf.city,
      ),
      info.ip,
    );
  return json({ user: publicUser(u), must_change: !!u.must_change, api_base: base === "/" ? "/api" : base.replace(/\/$/, "") + "/api" }, 200, {
    "Set-Cookie": sessionCookie(
      token,
      base,
      JSON.parse(u.roles).some((x) => ["teacher", "student", "parent"].includes(x)),
    ),
  });
}
export async function changeTenantPassword(env, tenant, user, data) {
  const r = repo(env, tenant.id),
    stored = await r.user(user.id);
  string(data.old_password, "原密码", 256);
  const digest = await digestPassword(env, data.old_password, stored.salt);
  if (!equal(digest, stored.digest)) fail(400, "原密码不正确");
  const mobile = await decrypt(env, stored.phone_enc, tenant.id + ":phone");
  validatePassword(data.password, mobile);
  if (equal(data.old_password, data.password))
    fail(400, "新密码不能与原密码相同");
  await r.password(
    user.id,
    stored.version,
    await newPassword(env, data.password),
    user,
    0,
  );
}
// Access JWT 必须验证签名、issuer、audience、有效期和邮箱白名单，不能只信任请求头存在。
const keyCache = new Map();
export async function requireAccess(req, env) {
  const token = req.headers.get("cf-access-jwt-assertion") || "";
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw Error();
    const decode = (x) =>
      Uint8Array.from(
        atob(
          x
            .replace(/-/g, "+")
            .replace(/_/g, "/")
            .padEnd(Math.ceil(x.length / 4) * 4, "="),
        ),
        (c) => c.charCodeAt(0),
      );
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0]))),
      claim = JSON.parse(new TextDecoder().decode(decode(parts[1])));
    const issuer = env.ACCESS_ISSUER.replace(/\/$/, "");
    if (
      !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) ||
      header.alg !== "RS256" ||
      claim.iss !== issuer ||
      !Array.isArray(claim.aud) ||
      !claim.aud.includes(env.ACCESS_AUD) ||
      !Number.isFinite(claim.exp) ||
      claim.exp * 1000 <= now() ||
      !Number.isFinite(claim.iat) ||
      claim.iat * 1000 > now() + 30000 ||
      (claim.nbf && claim.nbf * 1000 > now() + 30000) ||
      !env.ACCESS_EMAILS.split(",")
        .map((x) => x.trim().toLowerCase())
        .includes(String(claim.email || "").toLowerCase())
    )
      throw Error();
    let cache = keyCache.get(issuer);
    if (
      !cache ||
      cache.until < now() ||
      !cache.keys.some((k) => k.kid === header.kid)
    ) {
      const response = await fetch(issuer + "/cdn-cgi/access/certs", {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw Error();
      cache = { keys: (await response.json()).keys, until: now() + 300000 };
      keyCache.set(issuer, cache);
    }
    const jwk = cache.keys.find((k) => k.kid === header.kid);
    if (!jwk) throw Error();
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        decode(parts[2]),
        new TextEncoder().encode(parts[0] + "." + parts[1]),
      ))
    )
      throw Error();
    return claim;
  } catch {
    fail(403, "访问验证失败，请通过授权邮箱登录", "ACCESS_DENIED");
  }
}
export const platformCookie = (token) =>
  `__Host-channel_console=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`;
export async function authenticateAdmin(req, env) {
  const r = repo(env, null),
    token = readCookie(req, "__Host-channel_console"),
    hash = await sha(token),
    a = await r.authenticateAdminRequest(hash);
  if (!a) {
    await r.revokeAdmin(hash);
    fail(401, "请重新登录");
  }
  return { ...a, id: a.admin_id, name: a.username, hash };
}
export async function consultantEnrollment(req, env, actor, path, data) {
  const r = repo(env, null),
    ip = clientInfo(req).ip;
  if (path.endsWith("/prepare")) {
    const secret = base32(bytes(20)),
      until = now() + 300000;
    return {
      secret,
      until,
      proof: await hmac(
        env.HMAC_KEY,
        "consultant:" + actor.id + ":" + secret + ":" + until,
      ),
    };
  }
  string(data.username, "用户名", 32, 3);
  if (!/^[a-z0-9_.-]+$/.test(data.username)) fail(400, "用户名格式不正确");
  validatePassword(data.password);
  if (
    typeof data.secret !== "string" ||
    !/^[A-Z2-7]{32}$/.test(data.secret) ||
    !Number.isInteger(data.until) ||
    data.until < now() ||
    data.until > now() + 300000 ||
    !equal(
      data.proof,
      await hmac(
        env.HMAC_KEY,
        "consultant:" + actor.id + ":" + data.secret + ":" + data.until,
      ),
    )
  )
    fail(400, "验证器绑定已过期，请重新准备");
  const step = await verifyTotp(data.secret, data.totp);
  if (step < 0) fail(400, "动态口令不正确");
  const id = randomId("adm");
  await r.createConsultant(
    {
      id,
      username: data.username,
      ...(await newPassword(env, data.password)),
      totp_enc: await encrypt(env, data.secret, "platform:totp"),
      step,
    },
    actor.id,
    ip,
  );
  return { id, role: "consultant" };
}
export async function platformAuth(req, env, path, data) {
  const r = repo(env, null),
    info = clientInfo(req);
  if (path === "/api/setup/prepare" || path === "/api/setup") {
    if (await r.initialized()) fail(404, "页面不存在");
    if (await r.limit("console-setup:" + info.ip, 3600000, 21, 3600000))
      fail(429, "操作太频繁，请稍后再试");
    if (!equal(data.setup_key, env.PLATFORM_SETUP_KEY))
      fail(403, "初始化口令不正确");
    if (path.endsWith("prepare")) {
      const secret = base32(bytes(20)),
        until = now() + 300000;
      const proof = await hmac(env.HMAC_KEY, secret + ":" + until);
      return json({ secret, until, proof });
    }
    string(data.username, "用户名", 32, 3);
    if (!/^[a-z0-9_.-]+$/.test(data.username)) fail(400, "用户名格式不正确");
    validatePassword(data.password);
    if (
      typeof data.secret !== "string" ||
      !/^[A-Z2-7]{32}$/.test(data.secret) ||
      !Number.isInteger(data.until) ||
      data.until < now() ||
      data.until > now() + 300000 ||
      !equal(
        data.proof,
        await hmac(env.HMAC_KEY, data.secret + ":" + data.until),
      )
    )
      fail(400, "验证器绑定已过期，请重新准备");
    const step = await verifyTotp(data.secret, data.totp);
    if (step < 0) fail(400, "动态口令不正确");
    const id = randomId("adm"),
      password = await newPassword(env, data.password);
    await r.initAdmin(
      {
        id,
        username: data.username,
        ...password,
        totp_enc: await encrypt(env, data.secret, "platform:totp"),
        step,
      },
      info.ip,
    );
    return json({ ok: true });
  }
  if (path === "/api/login") {
    string(data.username, "用户名", 64);
    string(data.password, "密码", 256);
    const a = await r.admin(data.username),
      digest = await digestPassword(
        env,
        data.password,
        a?.salt || "AAAAAAAAAAAAAAAAAAAAAA==",
      );
    let step = -1;
    if (a)
      step = await verifyTotp(
        await decrypt(env, a.totp_enc, "platform:totp"),
        data.totp,
        a.last_totp_step,
      );
    const key = "console-login:" + info.ip,
      locked = await r.limit(key, 900000, 5, 900000, false);
    if (locked || !a || !a.active || !equal(digest, a.digest) || step < 0) {
      await r.limit(key, 900000, 5, 900000);
      await r.platformLog(
        a?.id || "unknown",
        "login_failed",
        null,
        "超管登录失败",
        info.ip,
      );
      fail(401, "用户名、密码或动态口令不正确");
    }
    await r.clearLimit(key);
    const token = b64(bytes(32));
    await r.newAdminSession(await sha(token), a, step, info);
    await r.platformLog(a.id, "login_success", null, "超管登录成功", info.ip);
    return json({ ok: true, role: a.role }, 200, {
      "Set-Cookie": platformCookie(token),
    });
  }
  fail(404, "页面不存在");
}
