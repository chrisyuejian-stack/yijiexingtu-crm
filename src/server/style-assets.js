import { repo } from "./repo.js";

import { fail } from "./core.js";

import { can } from "./permissions.js";

import { assetPath } from "./style-package.js";

import { styleImage } from "./platform-ops.js";

export const styleAssetPath = p => /^\/api\/(?:styles\/[^/]+\/versions\/[^/]+\/assets\/.+|parent\/(?:plans|reports)\/[^/]+\/style-assets\/.+)$/.test(p);

export function referencedAsset(manifest, path) {
    return [ manifest.thumbnail, manifest.decor?.corner_image ].includes("assets/" + path);
}

export async function styleAssetsApi(req, env, resolved, user, policy, url) {
    if (!styleAssetPath(resolved.relative)) return undefined;
    if (req.method !== "GET") fail(404, "不存在", "not_found");
    const r = repo(env, resolved.tenant.id);
    if (!await r.platformOps.available()) fail(404, "不存在", "not_found");
    let m = /^\/api\/styles\/([^/]+)\/versions\/([^/]+)\/assets\/(.+)$/.exec(resolved.relative), path;
    try {
        path = assetPath(decodeURIComponent(m ? m[3] : resolved.relative.split("/style-assets/")[1]));
    } catch {
        fail(404, "不存在", "not_found");
    }
    if (m) {
        const row = await r.platformOps.tenantStyle(m[1], m[2], true);
        if (!row) fail(404, "不存在", "not_found");
        const types = JSON.parse(row.manifest_json).doc_types, modules = types.map(t => t === "plan" ? "plans" : t === "article" ? "content" : "growth_reports");
        if (!modules.some(k => policy.modules[k] && can(user, policy, k, "read", {
            teacher_id: user.teacher_id
        })) || user.roles.some(x => [ "parent", "student" ].includes(x))) fail(404, "不存在", "not_found");
        return styleImage(env, await r.platformOps.asset(m[1], m[2], path));
    }
    m = /^\/api\/parent\/(plans|reports)\/([^/]+)\/style-assets\/(.+)$/.exec(resolved.relative);
    if (!user.roles.some(x => [ "student", "parent" ].includes(x)) || !policy.modules[m[1] === "plans" ? "plans" : "growth_reports"]) fail(404, "不存在", "not_found");
    const row = await r.platformOps.parentStyleDoc(m[1], m[2], await r.planChildIds(user));
    if (!row) fail(404, "不存在", "not_found");
    const manifest = JSON.parse(row.manifest_json), style = JSON.parse(row.doc_json).style;
    if (!referencedAsset(manifest, path)) fail(404, "不存在", "not_found");
    return styleImage(env, await r.platformOps.asset(style.pack_id, style.pack_version, path));
}
