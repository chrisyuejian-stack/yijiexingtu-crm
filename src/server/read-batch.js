import { body, fail, json } from "./core.js";
import { repo } from "./repo.js";
import { readResponseCount } from "./security.js";
const exact = new Set([
  "c2/home", "schedule", "c2/unchecked", "submissions", "c2/makeups",
  "finance/receivable-summary", "c2/renewals", "system-messages", "c2/followups",
  "c2/students", "c2/students/counts", "credits/packages", "schedule-templates",
  "data/schedule_templates", "data/schedule_enrollments", "data/teachers", "data/locations",
  "data/course_types", "data/course_categories", "data/students", "promo/recommend", "todo/summary",
]);
export function validateReadPaths(value) {
  if (!Array.isArray(value) || !value.length || value.length > 12) fail(400, "批量读取须包含 1–12 条路径");
  for (const path of value) {
    if (typeof path !== "string" || path.length > 2048 || /[\\#\s]/.test(path)) fail(400, "无效读取路径");
    const pathname = path.split("?")[0];
    if (!exact.has(pathname) && !/^(?:c2\/students\/[a-zA-Z0-9_-]+(?:\/history)?|data\/students\/[a-zA-Z0-9_-]+)$/.test(pathname)) fail(400, "路径不在只读白名单内");
  }
  return value;
}
export async function readBatch(req, env, resolved, dispatch) {
  const paths = validateReadPaths((await body(req))?.paths);
  const children = await Promise.all(paths.map(async (path) => {
    const url = new URL(resolved.base + "api/" + path, req.url);
    const child = new Request(url, { method: "GET", headers: req.headers });
    const response = await dispatch(child, url, { ...resolved, relative: "/api/" + url.pathname.split("/api/")[1] });
    const count = await readResponseCount(child, env, response);
    const value = (response.headers.get("content-type") || "").includes("application/json") ? await response.json() : await response.text();
    return { result: { path, status: response.status, body: value }, count: count || 0 };
  }));
  // Preserve input order and all threshold crossings; await accounting before returning.
  const errors = await repo(env, resolved.tenant.id).recordReads(env.__reader.user, children.map((item) => item.count));
  return json({ results: children.map(({ result }, index) => errors[index] ? { path: result.path, ...errors[index] } : result) });
}
