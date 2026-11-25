export class HttpError extends Error {
  constructor(status, message, code = "REQUEST_REJECTED") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const fail = (s, m, c) => {
  throw new HttpError(s, m, c);
};
export const now = () => Date.now();
export const bytes = (n) => crypto.getRandomValues(new Uint8Array(n));
export const b64 = (x) => {
  const data = new Uint8Array(x);
  let result = "";
  for (let i = 0; i < data.length; i += 16384)
    result += String.fromCharCode(...data.subarray(i, i + 16384));
  return btoa(result);
};
export const unb64 = (x) => Uint8Array.from(atob(x), (c) => c.charCodeAt(0));
export const randomId = (p) =>
  p +
  "_" +
  Array.from(bytes(12), (x) => x.toString(16).padStart(2, "0")).join("");
export const textBytes = (x) => new TextEncoder().encode(x);
export const equal = (a, b) => {
  a = String(a);
  b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
};
export const sha = async (x) =>
  b64(await crypto.subtle.digest("SHA-256", textBytes(x)));
export const json = (x, status = 200, headers = {}) =>
  new Response(JSON.stringify(x), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
export function string(x, label, max = 100, min = 1) {
  if (typeof x !== "string" || x.length < min || x.length > max)
    fail(400, label + "格式不正确");
  return x;
}
export function integer(x, label, min, max) {
  if (!Number.isInteger(x) || x < min || x > max)
    fail(400, label + "格式不正确");
  return x;
}
export function phone(x) {
  if (typeof x !== "string" || !/^1[3-9]\d{9}$/.test(x))
    fail(400, "手机号格式不正确");
  return x;
}
export function object(x) {
  if (!x || typeof x !== "object" || Array.isArray(x))
    fail(400, "请求格式不正确");
  return x;
}
export function version(x) {
  return integer(x, "版本", 1, 2147483647);
}
export async function body(req) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    fail(403, "请求来源不正确");
  if (!/^application\/json(?:;|$)/i.test(req.headers.get("content-type") || ""))
    fail(415, "请使用 JSON 请求");
  const reader = req.body?.getReader();
  let size = 0,
    chunks = [];
  if (reader)
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1048576) {
        await reader.cancel();
        fail(413, "请求内容过大");
      }
      chunks.push(value);
    }
  let data = new Uint8Array(size),
    offset = 0;
  for (const c of chunks) {
    data.set(c, offset);
    offset += c.length;
  }
  try {
    return object(JSON.parse(new TextDecoder().decode(data)));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    fail(400, "请求格式不正确");
  }
}
export function accessMode(env) {
  const value = env.ACCESS_MODE;
  if (value === undefined || value === "" || value === "on") return "on";
  if (value === "off") return "off";
  fail(503, "Access模式配置不正确", "CONFIG_INVALID");
}
export function turnstileMode(env) {
  const value = env.TURNSTILE_MODE;
  if (value === undefined || value === "" || value === "on") return "on";
  if (value === "off") return "off";
  fail(503, "人机验证模式配置不正确", "CONFIG_INVALID");
}
export function config(env) {
  const mode = accessMode(env),
    captchaMode = turnstileMode(env);
  for (const k of [
    "FIELD_KEY",
    "BACKUP_KEY",
    "HMAC_KEY",
    "PW_PEPPER",
    "PLATFORM_SETUP_KEY",
    ...(captchaMode === "on" ? ["TURNSTILE_SECRET"] : []),
  ])
    if (typeof env[k] !== "string" || !env[k])
      fail(503, "系统配置不完整，请联系维护人员", "CONFIG_MISSING");
  let key, backupKey;
  try {
    key = unb64(env.FIELD_KEY);
    backupKey = unb64(env.BACKUP_KEY);
  } catch {
    fail(503, "系统配置不正确", "CONFIG_INVALID");
  }
  if (
    key.length !== 32 ||
    backupKey.length !== 32 ||
    env.HMAC_KEY.length < 32 ||
    env.PW_PEPPER.length < 32 ||
    env.PLATFORM_SETUP_KEY.length < 32
  )
    fail(503, "系统密钥配置不正确", "CONFIG_INVALID");
  if (
    !env.CHANNEL_DB ||
    !env.CHANNEL_BACKUPS ||
    !env.TENANT_HOST ||
    !env.CONSOLE_HOST ||
    env.CONSOLE_HOST === env.TENANT_HOST ||
    (captchaMode === "on" && !env.TURNSTILE_SITE_KEY) ||
    (mode === "on" &&
      (!env.ACCESS_ISSUER || !env.ACCESS_AUD || !env.ACCESS_EMAILS))
  )
    fail(503, "系统配置不完整，请联系维护人员", "CONFIG_MISSING");
}
export function secureResponse(res, login = false, cacheControl = "no-store") {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries({
    "Cache-Control": cacheControl,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": `default-src 'none'; script-src 'self'${login ? " https://challenges.cloudflare.com" : ""}; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src ${login ? "https://challenges.cloudflare.com" : "'none'"}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`,
  }))
    out.headers.set(k, v);
  return out;
}
export const neutral404 = () =>
  new Response(
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>页面不存在</title><p>页面不存在，或该机构暂不可用</p></html>',
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
export const clientInfo = (req) => ({
  ip: req.headers.get("cf-connecting-ip") || "unknown",
  ua: (req.headers.get("user-agent") || "").slice(0, 300),
});
