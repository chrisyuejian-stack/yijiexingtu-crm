import { repo } from "./repo.js";
import { tenantSessionHash } from "./auth.js";
import { now, fail } from "./core.js";
const reserved = new Set(
  "console admin api app assets static login logout platform www help docs status health robots.txt favicon.ico".split(
    " ",
  ),
);
export const validSlug = (s) =>
  typeof s === "string" &&
  /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/.test(s) &&
  !reserved.has(s);
// 唯一负责从请求定位机构的函数。路由和前端均不自行查 slug。
export async function resolveTenant(request, env, requiresAuth) {
  const url = new URL(request.url),
    segment = url.pathname.split("/")[1] || "";
  const slugRelative = "/" + url.pathname.split("/").slice(2).join("/");
  const domainAuth = requiresAuth?.(url.pathname);
  const slugAuth = requiresAuth?.(slugRelative);
  const hash = domainAuth || slugAuth ? await tenantSessionHash(request) : null;
  const found = await repo(env, null).resolve(
    url.hostname,
    url.hostname === env.TENANT_HOST && validSlug(segment) ? segment : null,
    hash ? { hash, domainAuth, slugAuth } : null,
  );
  if (!found) return null;
  const t = found.tenant;
  const statusException = (found.domain ? url.pathname : slugRelative) === "/api/auth/status";
  if (t.deleted_at || (!found.auth && !statusException && (t.status !== "active" ||
    (t.expires_at && Date.parse(t.expires_at + "T23:59:59+08:00") <= now()))))
    return null;
  if (hash && !found.auth && (domainAuth || slugAuth)) {
    const owner = await repo(env, null).identitySessionOwner(hash);
    if (owner && owner.tenant_id !== t.id) {
      fail(404, "不存在", "not_found");
    }
  }
  const base = found.domain ? "/" : "/" + t.slug + "/";
  const relative = found.domain ? url.pathname : slugRelative;
  return {
    tenant: t,
    hash,
    auth: found.auth,
    base,
    relative,
    alias: !!found.alias,
    redirect: found.alias
      ? base + url.pathname.split("/").slice(2).join("/") + url.search
      : null,
  };
}
