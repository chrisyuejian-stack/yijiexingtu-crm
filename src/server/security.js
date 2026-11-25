import { repo } from "./repo.js";
// 统计实际返回的记录对象；同一响应中相同记录只算一次，计数不含金额或原文。
export function responseRecordCount(value) {
  const seen = new Set();
  let count = 0;
  const walk = (v, inArray = false) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const row of v) walk(row, true);
      return;
    }
    if (v.id) {
      const key = String(v.id);
      if (!seen.has(key)) {
        seen.add(key);
        count++;
      }
    } else if (inArray) count++;
    for (const child of Object.values(v))
      if (child && typeof child === "object") walk(child);
  };
  walk(value);
  return count;
}
export async function readResponseCount(req, env, response) {
  const readRequest =
    req.method === "GET" ||
    (req.method === "POST" &&
      /^(?:\/api\/c2\/lessons\/[^/]+\/preview|\/api\/c3\/templates\/preview)$/.test(
        new URL(req.url).pathname.replace(/^\/[^/]+\/api\//, "/api/"),
      ));
  if (!env.__reader || !readRequest || response.status !== 200) return;
  if (/\/api\/(me|sessions)$/.test(new URL(req.url).pathname)) return;
  let count = env.__exportRecordCount || 0;
  if ((response.headers.get("content-type") || "").includes("application/json"))
    count = responseRecordCount(await response.clone().json());
  return count;
}

export async function accountReadResponse(req, env, response) {
  const count = await readResponseCount(req, env, response);
  if (count !== undefined) await repo(env, env.__reader.tenantId).recordRead(env.__reader.user, count);
}
