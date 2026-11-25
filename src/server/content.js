import { repo } from "./repo.js";

import { body, json, fail, randomId, version } from "./core.js";

import { can } from "./permissions.js";

import { sources, object, prepareContent, contentDto, contentConflict, contentImageIds, contentStates, text, invalid } from "./content-document.js";

export const contentPath = p => /^\/api\/content(?:\/[^/]+(?:\/status)?)?$/.test(p);

export async function contentApi(req, env, resolved, user, policy, url) {
    const path = resolved.relative;
    if (!contentPath(path)) return undefined;
    env.__identityContract = true;
    if (!policy.modules.content) fail(404, "不存在", "not_found");
    const action = req.method === "GET" ? "read" : "write";
    if (!can(user, policy, "content", action)) fail(403, "没有此操作权限", "forbidden");
    const r = repo(env, resolved.tenant.id), m = /^\/api\/content(?:\/([^/]+)(\/status)?)?$/.exec(path);
    if (m[1] === "scenes" && req.method === "GET") return json({
        items: await r.contentScenes(url.searchParams.get("subject")),warnings:[]
    });
    if (!m[1] && req.method === "GET") {
        const offset = Number(url.searchParams.get("offset") || 0), limit = Number(url.searchParams.get("limit") || 50);
        if (!Number.isInteger(offset) || offset < 0 || offset > 1e6 || !Number.isInteger(limit) || limit < 1 || limit > 200) invalid("分页不正确");
        const data = await r.contentList({
            type: url.searchParams.get("type"),
            scene: url.searchParams.get("scene"),
            status: url.searchParams.get("status"),
            author: url.searchParams.get("author"),
            offset: offset,
            limit: limit
        });
        return json({
            ...data,
            items: data.items.map(contentDto),
            next_offset: offset + limit < data.total ? offset + limit : null,warnings:[]
        });
    }
    const row = m[1] ? await r.contentGet(m[1]) : null;
    if (m[1] && !row) fail(404, "不存在", "not_found");
    if (!m[2] && req.method === "GET") return json({...contentDto(row),warnings:[]});
    if (row && !m[2] && req.method === "DELETE") {
        const d = await body(req);
        if (d.version !== undefined && version(d.version) !== row.version) contentConflict(row);
        try {
            await r.contentCommit(row, null, user, "delete");
        } catch (e) {
            if (/expected=actual/.test(String(e))) contentConflict(await r.contentGet(row.id));
            throw e;
        }
        return json({
            ok: true,warnings:[]
        });
    }
    if (m[2] && req.method === "POST") {
        const d = await body(req);
        if (version(d.version) !== row.version) contentConflict(row);
        if (!contentStates.includes(d.status)) invalid("内容状态不正确", "status");
        try {
            await r.contentCommit(row, {
                doc: {...JSON.parse(row.doc_json), article: contentDto(row).article},
                manifest: JSON.parse(row.manifest_json),
                status: d.status
            }, user, "status");
        } catch (e) {
            if (/expected=actual/.test(String(e))) contentConflict(await r.contentGet(row.id));
            throw e;
        }
        return json({...contentDto(await r.contentGet(row.id)),warnings:[]});
    }
    if (!(!row && req.method === "POST" || row && !m[2] && req.method === "PUT")) fail(404, "不存在", "not_found");
    const d = await body(req), old = row ? {...JSON.parse(row.doc_json), article: contentDto(row).article} : null;
    if (row && version(d.version) !== row.version) contentConflict(row);
    const requested = object(d.style ?? old?.style ?? {}, "style"), packId = requested.pack_id ?? old?.style.pack_id ?? (await r.documentDefault("article"))?.id, packVersion = requested.pack_version ?? (packId === old?.style.pack_id ? old.style.pack_version : null);
    if(!packId)invalid("当前机构没有可用的招生内容风格包，请联系平台","style.pack_id");
    text(packId, "style.pack_id", 100, false);
    if (packVersion !== null) text(packVersion, "style.pack_version", 50, false);
    let manifest, style;
    if (row && packId === old.style.pack_id && packVersion === old.style.pack_version) {
        manifest = JSON.parse(row.manifest_json);
        style = old.style;
    } else {
        const pack = await r.planStyle(packId, packVersion);
        if (!pack) fail(404, "不存在", "not_found");
        if (!pack.active) invalid("风格包已停用", "style.pack_id");
        manifest = JSON.parse(pack.manifest_json);
        if(!manifest.doc_types.includes("article"))invalid("风格不支持招生内容","style.pack_id");
        style = {
            pack_id: pack.id,
            pack_version: pack.version
        };
    }
    const formatWarnings=[],doc = prepareContent(d, old, style,formatWarnings);
    const refs = await r.contentSources(doc.sources, contentImageIds(doc));
    const header = doc.article?.header_image_id;
    if (header && !refs.images.some(x => x.id === header)) fail(422, "头图必须属于本机构图库", "invalid_image");
    if (header && refs.images.some(x => x.id === header && x.hidden) && old?.article?.header_image_id !== header) fail(422, "不能新选已隐藏的头图", "invalid_image");
    if (refs.courses.length !== doc.sources.course_ids.length || refs.images.length !== contentImageIds(doc).length) fail(404, "不存在", "not_found");
    if (refs.images.some(x => x.hidden && (!old || !contentImageIds(old).includes(x.id)))) invalid("新选图片已隐藏", "blocks");
    const fresh = doc.applied_suggestion_ids.filter(id => !old?.applied_suggestion_ids.includes(id));
    if (fresh.length && (await r.contentSuggestionIds(fresh)).length !== fresh.length) fail(404, "不存在", "not_found");
    const id = row?.id || randomId("cnt");
    try {
        await r.contentCommit(row, {
            id: id,
            doc: doc,
            manifest: manifest,
            status: row?.status || "draft"
        }, user, row ? "save" : "create");
    } catch (e) {
        if (/expected=actual/.test(String(e)) && header) {
            const latestRefs = await r.contentSources({course_ids: [], gallery_tags: []}, [header]);
            if (!latestRefs.images.length) fail(422, "头图必须属于本机构图库", "invalid_image");
        }
        if (/expected=actual/.test(String(e))) contentConflict(await r.contentGet(id));
        throw e;
    }
    return json({...contentDto(await r.contentGet(id)),warnings:formatWarnings}, row ? 200 : 201);
}
