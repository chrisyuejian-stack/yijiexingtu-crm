import {refreshGalleryStorage} from './gallery-storage.js';
import { planPreview } from "./platform-preview-data.js";

import { repo } from "./repo.js";

import { body, json, fail, HttpError, randomId, b64 } from "./core.js";

import { subjectInput, subjectContent, stableKey, packVersion, docTypes } from "./platform-validation.js";

import { stylePackage, assetPath } from "./style-package.js";

import { invalid, ids, text } from "./content-document.js";

import { planDate } from "./plan-math.js";

const conflict = latest => {
    const e = new HttpError(409, "版本已变化，请刷新", "version_conflict");
    e.details = {
        latest: latest
    };
    throw e;
};

const dto = r => r && {
    key: r.key,
    name: r.name,
    pack_version: r.pack_version,
    version: r.version,
    status: r.status,
    content: JSON.parse(r.content_json),
    published_at: r.published_at
};

const styleDto = r => ({
    pack_id: r.id,
    name: r.name,
    pack_version: r.pack_version,
    version: r.version ?? 1,
    status: r.status ?? "published",
    scope: r.scope ?? "all",
    active: !!r.active,
    manifest: JSON.parse(r.manifest_json),
    checks: JSON.parse(r.checks_json || '{"errors":[],"warnings":[]}'),
    published_at: r.published_at,
    asset_base: "/api/ops/style-packs/" + encodeURIComponent(r.id) + "/versions/" + encodeURIComponent(r.pack_version) + "/assets/"
});

export async function styleImage(env, row) {
    if (!row) fail(404, "不存在", "not_found");
    const obj = await (env.CHANNEL_MEDIA?.get(row.r2_key));
    if (!obj) fail(404, "不存在", "not_found");
    return new Response(Uint8Array.from(atob(await obj.text()), x => x.charCodeAt(0)), {
        headers: {
            "Content-Type": row.mime,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store"
        }
    });
}

function examples(type, m) {
    const style = {
        pack_id: m.id,
        pack_version: m.version
    }, brand = {
        name: "平台示例机构",
        primary_color: m.tokens.color.primary
    }, student = {
        id: "example_student",
        nickname: "示例同学"
    }, period = {
        from: "2026-09-01",
        to: "2026-12-20"
    };
    if (type === "report") return {
        id: "example_report",
        version: 1,
        status: "published",
        progress: "published",
        style: style,
        brand: brand,
        student: student,
        period: period,
        stats: {
            lessons: {
                value: 14,
                crm_value: 14,
                source: "crm",
                overridden: false
            },
            attendance: {
                value: 14,
                crm_value: 14,
                source: "crm",
                overridden: false
            },
            repertoire_done: {
                value: 3,
                crm_value: 3,
                source: "crm",
                overridden: false
            }
        },
        dimensions_snapshot: [ {
            key: "reading",
            name: "读谱",
            order: 1
        }, {
            key: "rhythm",
            name: "节奏",
            order: 2
        }, {
            key: "practice",
            name: "练习习惯",
            order: 3
        } ],
        scores: [ {
            key: "reading",
            value: 3,
            previous: 2
        }, {
            key: "rhythm",
            value: 4,
            previous: 3
        }, {
            key: "practice",
            value: 3,
            previous: 3
        } ],
        mock_exams: [],
        texts: {
            progress: "平台示例：本期读谱更流畅",
            focus: "平台示例：继续练习句尾",
            next_goals: [ "完成下一阶段曲目" ],
            home_practice: [ "每日分段练习" ],
            teacher_note: "以上均为平台预览示例"
        },
        artwork_image_ids: [],
        artwork_image_urls: [],
        renewal: {
            visible: false,
            text: ""
        },
        options: {
            compare_previous: true,
            require_artwork: false,
            mock_exam: false,
            renewal_suggestion: false
        }
    };
    if (type === "feedback_card") return {
        id: "example_feedback",
        style: style,
        brand: brand,
        student: student,
        at: "2026-11-10T10:00:00+08:00",
        status: "confirmed",
        tags: [ "平台示例" ],
        repertoire_ids: [],
        message: {
            learned: "平台示例：节奏练习",
            good: "平台示例：节奏稳定",
            attention: "平台示例：句尾稍急",
            homework: "平台示例：每天慢练"
        },
        public_comment: "平台示例小组练习",
        image_ids: [],
        image_urls: []
    };
    if (type === "article") return {
        id: "example_article",
        style: style,
        brand: brand,
        type: "article",
        subject: "music_interest",
        title: "平台示例：秋季体验课",
        scene: "平台预览",
        blocks: [ {
            id: "example_heading",
            type: "heading",
            level: 2,
            text: "体验内容"
        }, {
            id: "example_paragraph",
            type: "paragraph",
            text: "这是平台示例内容，不代表任何机构的真实招生信息。"
        }, {
            id: "example_list",
            type: "list",
            ordered: false,
            items: [ "节奏体验", "报名方式由机构填写" ]
        } ],
        sources: {
            profile: false,
            prices: false,
            course_ids: [],
            gallery_tags: []
        },
        author: {
            name: "平台示例"
        },
        status: "draft"
    };
    return {
        ...structuredClone(planPreview),
        example: true,
        style: {
            ...planPreview.style,
            ...style
        },
        brand: brand
    };
}

async function uploadFile(req) {
    if (req.headers.get("origin") !== new URL(req.url).origin) fail(403, "请求来源不正确", "forbidden");
    if (!/^multipart\/form-data;/.test(req.headers.get("content-type") || "")) fail(415, "需要multipart文件", "validation_failed");
    const reader = req.body?.getReader(), chunks = [];
    let size = 0;
    if (!reader) invalid("缺少文件", "file");
    for (;;) {
        const x = await reader.read();
        if (x.done) break;
        size += x.value.length;
        if (size > 10 * 1024 * 1024 + 65536) {
            await reader.cancel();
            invalid("ZIP体积超限", "file", "style_pack_invalid");
        }
        chunks.push(x.value);
    }
    const bytes = new Uint8Array(size);
    let off = 0;
    for (const x of chunks) {
        bytes.set(x, off);
        off += x.length;
    }
    let form;
    try {
        form = await new Response(bytes, {
            headers: {
                "Content-Type": req.headers.get("content-type")
            }
        }).formData();
    } catch {
        invalid("multipart损坏", "file");
    }
    if ([ ...form.keys() ].some(x => x !== "file") || form.getAll("file").length !== 1 || typeof form.get("file")?.arrayBuffer !== "function") invalid("需要一个file文件", "file");
    return new Uint8Array(await form.get("file").arrayBuffer());
}

export async function platformOps(req, env, url, admin) {
    const path = url.pathname, r = repo(env, null).platformOps;
    if (!/^\/api\/ops\/(?:subject-packs|style-packs|compliance\/terms|ai\/usage|tenants\/[^/]+\/(?:ai-override|gallery-storage(?:\/recount)?))(?:\/|$)/.test(path)) return undefined;
    if (!await r.available()) fail(503, "请先完成平台数据库升级", "configuration_required");
    const storagePath=/^\/api\/ops\/tenants\/([^/]+)\/gallery-storage(\/recount)?$/.exec(path);
    if(storagePath){
        const t=await repo(env,storagePath[1]).tenant();if(!t||t.deleted_at)fail(404,'不存在','not_found');
        const scoped=repo(env,t.id);
        if(req.method==='GET'&&!storagePath[2])return json({id:t.id,...await scoped.galleryStorage()});
        if(req.method==='POST'&&storagePath[2]){await body(req);return json({id:t.id,...await refreshGalleryStorage(env,scoped)});}
        if(req.method==='PUT'&&!storagePath[2]){const d=await body(req);if(!Number.isSafeInteger(d.limit)||d.limit<0||d.limit>10*1024**4)invalid('容量上限须为非负整数字节','limit');if(d.version!==t.version)conflict({id:t.id,...await scoped.galleryStorage()});try{return json({id:t.id,...await scoped.galleryStorageSetLimit(d.limit,d.version,admin)})}catch(e){if(/expected=actual/.test(String(e)))conflict({id:t.id,...await scoped.galleryStorage()});throw e}}
        fail(404,'不存在','not_found');
    }
    if (path === "/api/ops/subject-packs") {
        if (req.method === "GET") {
            const rows = await r.subjects(), keys = [ ...new Set(rows.map(x => x.key)) ];
            return json({
                items: keys.map(key => ({
                    key: key,
                    name: rows.find(x => x.key === key).pack_name,
                    current_published_version: rows.find(x => x.key === key).current_published_version,
                    versions: rows.filter(x => x.key === key).map(dto)
                }))
            });
        }
        if (![ "POST", "PUT" ].includes(req.method)) fail(404, "不存在", "not_found");
        const d = await body(req), value = subjectInput(d), old = await r.subject(value.key, value.pack_version);
        if (d.name === undefined && old) value.name = old.name;
        if (req.method === "POST" && old) fail(409, "版本已存在", "duplicate");
        if (req.method === "PUT" && !old) fail(404, "不存在", "not_found");
        if (old?.status === "published") fail(409, "已发布内容不可修改", "invalid_state");
        if (old && d.version !== old.version) conflict(dto(old));
        try {
            return json(dto(await r.saveSubject(value, old, admin)), old ? 200 : 201);
        } catch (e) {
            if (/expected=actual/.test(String(e))) conflict(dto(await r.subject(value.key, value.pack_version)));
            if (/UNIQUE constraint/.test(String(e))) fail(409, "版本已存在", "duplicate");
            throw e;
        }
    }
    let m = /^\/api\/ops\/subject-packs\/([^/]+)\/versions\/([^/]+)\/publish$/.exec(path);
    if (m && req.method === "POST") {
        const d = await body(req), row = await r.subject(m[1], m[2]);
        if (!row) fail(404, "不存在", "not_found");
        if (row.status !== "draft") fail(409, "该版本已冻结", "invalid_state");
        if (d.version !== row.version) conflict(dto(row));
        const value = dto(row);
        subjectContent(value.content,value.key);
        try {
            return json(dto(await r.saveSubject(value, row, admin, true)));
        } catch (e) {
            if (/expected=actual/.test(String(e))) conflict(dto(await r.subject(m[1], m[2])));
            throw e;
        }
    }
    if (path === "/api/ops/style-packs/upload" && req.method === "POST") {
        let value;
        try {
            value = await stylePackage(await uploadFile(req));
        } catch (e) {
            if (e instanceof HttpError) {
                if (e.status === 422) e.code = "style_pack_invalid";
                e.details = {
                    ...e.details,
                    checks: {
                        errors: [ e.message ],
                        warnings: []
                    }
                };
                throw e;
            }
            invalid("压缩包无法读取", "file", "style_pack_invalid");
        }
        if (await r.style(value.manifest.id, value.manifest.version)) fail(409, "风格版本已经存在", "duplicate");
        const uploaded = [], nonce = randomId("upload");
        try {
            if (value.assets.length && !env.CHANNEL_MEDIA) fail(503, "图片存储未配置", "configuration_required");
            for (const image of value.assets) {
                image.r2_key = "styles/" + value.manifest.id + "/" + value.manifest.version + "/" + nonce + "/" + image.path;
                uploaded.push(image.r2_key);
                await env.CHANNEL_MEDIA.put(image.r2_key, b64(image.data));
            }
            const saved = await r.styleUpload(value, value.assets, admin);
            return json(styleDto(saved), 201);
        } catch (e) {
            const saved = await r.style(value.manifest.id, value.manifest.version);
            if (saved && saved.manifest_json === JSON.stringify(value.manifest) && (!value.assets.length || (await r.asset(value.manifest.id, value.manifest.version, value.assets[0].path))?.r2_key === uploaded[0])) return json(styleDto(saved), 201);
            if (uploaded.length) await env.CHANNEL_MEDIA.delete(uploaded);
            if (/UNIQUE constraint/.test(String(e))) fail(409, "风格版本已经存在", "duplicate");
            throw e;
        }
    }
    if (path === "/api/ops/style-packs/default" && req.method === "PUT") {
        const d = await body(req);
        if (!docTypes.includes(d.doc_type)) invalid("文档类型不正确", "doc_type");
        await r.defaultStyle(d.doc_type, text(d.pack_id, "pack_id", 100, false), admin);
        return json({
            items: await r.defaults()
        });
    }
    if (path === "/api/ops/style-packs" && req.method === "GET") {
        const rows = await r.styleRows(), keys = [ ...new Set(rows.map(x => x.id)) ];
        return json({
            items: keys.map(id => ({
                id: id,
                name: rows.find(x => x.id === id).name,
                active: !!rows.find(x => x.id === id).active,
                current_version: rows.find(x => x.id === id).current_version,
                versions: rows.filter(x => x.id === id).map(styleDto)
            })),
            defaults: await r.defaults()
        });
    }
    m = /^\/api\/ops\/style-packs\/([^/]+)(?:\/versions\/([^/]+)\/(preview|publish|assets\/(.+))|\/(disable))?$/.exec(path);
    if (m) {
        const id = m[1];
        if (!m[2] && !m[5] && req.method === "GET") {
            const rows = await r.styleRows(id);
            if (!rows.length) fail(404, "不存在", "not_found");
            return json({
                id: id,
                name: rows[0].name,
                active: !!rows[0].active,
                current_version: rows[0].current_version,
                versions: rows.map(styleDto),
                scopes: await r.styleTenants(id),
                used_count: await r.styleUsage(id)
            });
        }
        if (m[5] && req.method === "POST") {
            await body(req);
            await r.disableStyle(id, admin);
            return json({
                ok: true
            });
        }
        if (m[2]) {
            const row = await r.style(id, m[2]);
            if (!row) fail(404, "不存在", "not_found");
            if (m[4] && req.method === "GET") {
                let path;
                try {
                    path = assetPath(decodeURIComponent(m[4]));
                } catch {
                    fail(404, "不存在", "not_found");
                }
                return styleImage(env, await r.asset(id, m[2], path));
            }
            if (m[3] === "preview" && req.method === "POST") {
                await body(req);
                const manifest = JSON.parse(row.manifest_json);
                return json({
                    previews: manifest.doc_types.map(type => ({
                        doc_type: type,
                        render_data: {
                            ...examples(type, manifest),
                            example: true
                        },
                        manifest: manifest,
                        asset_base: styleDto(row).asset_base
                    }))
                });
            }
            if (m[3] === "publish" && req.method === "POST") {
                const d = await body(req);
                if (row.status !== "draft") fail(409, "风格版本已冻结", "invalid_state");
                if (d.version !== row.version) conflict(styleDto(row));
                if (![ "admin_only", "tenants", "all" ].includes(d.scope)) invalid("发布范围不正确", "scope");
                const tenants = ids(d.tenant_ids ?? [], "tenant_ids", 200);
                if (d.scope === "tenants" ? !tenants.length : tenants.length) invalid("机构范围不正确", "tenant_ids");
                if ((await r.validTenants(tenants)).length !== tenants.length) fail(404, "不存在", "not_found");
                try {
                    await r.publishStyle(row, d.scope, tenants, admin);
                } catch (e) {
                    if (/expected=actual/.test(String(e))) conflict(styleDto(await r.style(id, m[2])));
                    throw e;
                }
                return json(styleDto(await r.style(id, m[2])));
            }
        }
    }
    if (path === "/api/ops/compliance/terms") {
        if (req.method === "GET") return json({
            items: await r.compliance()
        });
        if (req.method === "PUT") {
            const d = await body(req), terms = ids(d.terms, "terms", 500);
            return json({
                items: await r.saveTerms(terms, admin)
            });
        }
    }
    m = /^\/api\/ops\/tenants\/([^/]+)\/ai-override$/.exec(path);
    if (m && req.method === "PUT") {
        const d = await body(req);
        for (const k of [ "fast_daily_limit", "deep_daily_limit" ]) if (d[k] !== null && (!Number.isInteger(d[k]) || d[k] < 0 || d[k] > 1e6)) invalid("上限须为非负整数或null", k);
        await r.aiOverride(m[1], d, admin);
        return json({
            id: m[1],
            fast_daily_limit: d.fast_daily_limit,
            deep_daily_limit: d.deep_daily_limit
        });
    }
    if (path === "/api/ops/ai/usage" && req.method === "GET") {
        const from = url.searchParams.get("from"), to = url.searchParams.get("to"), start = planDate(from), end = planDate(to);
        if (end < start || end - start > 366 * 864e5) invalid("日期范围须在一年内", "to");
        const group = url.searchParams.get("group") || "day";
        if (![ "day", "tenant", "tool" ].includes(group)) invalid("汇总方式不正确", "group");
        const tenant = url.searchParams.get("tenant_id") || null;
        return json({
            from: from,
            to: to,
            group: group,
            items: await r.usage(start - 8 * 36e5, end + 16 * 36e5, tenant, group)
        });
    }
    fail(404, "不存在", "not_found");
}
