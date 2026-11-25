import { repo } from "./repo.js";

import { body, json, fail, HttpError, randomId, now, version } from "./core.js";

import { can } from "./permissions.js";

import { text, ids, list, object, invalid } from "./content-document.js";

import { planDate } from "./plan-math.js";

import { planIso } from "./plan-document.js";

import { lessonWindow } from "./presentation.js";

export const growthPath = p => /^\/api\/(?:feedback\/(?:today|[^/]+\/[^/]+\/copied)|students\/[^/]+\/repertoire|report-batches(?:\/[^/]+\/publish)?|reports\/[^/]+(?:\/(?:refresh-crm|ready|return|publish|unpublish))?|parent\/(?:reports\/[^/]+|children\/[^/]+\/feed|media\/[^/]+))$/.test(p);

const personal = u => u.roles.some(x => [ "student", "parent" ].includes(x));

const teacher = u => u.roles.includes("teacher");

const staff = u => u.roles.some(x => [ "supervisor", "academic" ].includes(x));

export function growthPermit(u, p, action, row) {
    if (!can(u, p, "growth_reports", action, row)) fail(403, "没有此操作权限", "forbidden");
}

export function reportDto(row, data = null) {
    const d = JSON.parse(row.doc_json), ctx = JSON.parse(row.context_json);
    if (data) d.scores = previousScores(d.scores, data, row.id);
    if (ctx.options.compare_previous === false) d.scores = d.scores.map(x => ({
        ...x,
        previous: null
    }));
    d.options = ctx.options;
    return {
        ...d,
        id: row.id,
        version: row.version,
        batch_id: row.batch_id,
        student_id: row.student_id,
        teacher_id: row.teacher_id,
        status: row.status,
        progress: row.progress,
        report_class_id: row.report_class_id
    };
}

export function previousScores(scores, data, id) {
    const prev = data.previous.find(x => x.report_id === id), values = prev ? JSON.parse(prev.doc_json).scores : [];
    return scores.map(s => ({
        key: s.key,
        value: s.value,
        previous: values.find(x => x.key === s.key)?.value ?? null
    }));
}

function conflict(row) {
    const e = new HttpError(409, "报告已被修改，请刷新", "version_conflict");
    e.details = {
        latest: row ? reportDto(row) : null
    };
    throw e;
}

function requireVersion(d, row) {
    if (version(d.version) !== row.version) conflict(row);
}

export function reportImageIds(d) {
    return [ ...new Set([ d.style?.header_image_id, ...d.artwork_image_ids || [], ...(d.mock_exams || []).flatMap(x => x.image_ids || []) ].filter(Boolean)) ];
}

export function reportWarnings(ctx) {
    return ctx.stats.includes("camp_days") && !ctx.camp.length ? [ "尚未关联集训排课课程，请核对统计或人工填写" ] : [];
}

function automaticStats(d, ctx, publishedDate = null) {
    if (ctx.stats.includes("mock_count")) d.stats.mock_count = {
        value: d.mock_exams.length,
        crm_value: d.mock_exams.length,
        source: "crm",
        overridden: false
    };
    if (ctx.stats.includes("days_to_exam")) {
        if (!ctx.exam_date) delete d.stats.days_to_exam; else if (publishedDate) {
            const n = (planDate(ctx.exam_date) - planDate(publishedDate)) / 864e5;
            d.stats.days_to_exam = {
                value: n,
                crm_value: n,
                source: "crm",
                overridden: false
            };
        }
    }
}

export function reportCheck(d, ctx) {
    const missing = [];
    for (const dim of d.dimensions_snapshot) if (!d.scores.some(s => s.key === dim.key && Number.isInteger(s.value) && s.value >= 1 && s.value <= 5)) missing.push("维度未评分：" + dim.name);
    for (const k of [ "progress", "focus", "teacher_note" ]) if (!d.texts[k]?.trim()) missing.push("文字未填：" + k);
    for (const k of [ "next_goals", "home_practice" ]) if (!d.texts[k]?.length) missing.push("文字未填：" + k);
    if (ctx.options.require_artwork && !d.artwork_image_ids.length) missing.push("请添加作品图片");
    if (missing.length) {
        const e = new HttpError(422, "报告尚未完成", "check_failed");
        e.details = {
            items: missing
        };
        throw e;
    }
}

function scalar(v, field) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e9) invalid("统计值须为非负数字", field);
    return v;
}

async function editedReport(r, row, d, u, ctx, data) {
    const old = JSON.parse(row.doc_json), doc = structuredClone(old);
    if (d.teacher_id !== undefined) {
        if (d.teacher_id !== null) text(d.teacher_id, "teacher_id", 100, false);
        if (!staff(u) && d.teacher_id !== row.teacher_id) fail(403, "不能重新分配报告", "forbidden");
        if (d.teacher_id !== null && !await r.businessGet("teachers", d.teacher_id)) fail(404, "不存在", "not_found");
        doc.teacher_id = d.teacher_id;
    }
    if (d.scores !== undefined) {
        const seen = new Set;
        doc.scores = list(d.scores, "scores", 30).map(s => {
            if (!s || !old.dimensions_snapshot.some(x => x.key === s.key) || seen.has(s.key)) invalid("评分维度不正确", "scores");
            seen.add(s.key);
            if (!Number.isInteger(s.value) || s.value < 1 || s.value > 5) invalid("评分须为1–5整数", "scores");
            return {
                key: s.key,
                value: s.value
            };
        });
        if (!u.roles.includes("academic") && !teacher(u) && JSON.stringify(doc.scores) !== JSON.stringify(old.scores.map(({key: key, value: value}) => ({
            key: key,
            value: value
        })))) fail(403, "评分仅由本人老师或教务填写", "forbidden");
    }
    if (d.mock_exams !== undefined) {
        doc.mock_exams = list(d.mock_exams, "mock_exams", 100).map(m => {
            object(m, "mock_exams");
            if (typeof m.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m.month)) invalid("模拟考月份不正确", "mock_exams");
            return {
                month: m.month,
                items: list(m.items, "mock_exams.items", 30).map(x => {
                    object(x, "mock_exams.items");
                    const full = scalar(x.full, "full"), score = scalar(x.score, "score");
                    if (!full || score > full) invalid("模拟考分数超出满分", "score");
                    return {
                        subject: text(x.subject, "subject", 100, false),
                        score: score,
                        full: full
                    };
                }),
                image_ids: ids(m.image_ids ?? [], "image_ids", 30)
            };
        });
        if (!u.roles.includes("academic") && !teacher(u) && JSON.stringify(doc.mock_exams) !== JSON.stringify(old.mock_exams)) fail(403, "模拟考仅由本人老师或教务填写", "forbidden");
    }
    if (d.texts !== undefined) {
        object(d.texts, "texts");
        for (const k of [ "progress", "focus", "teacher_note" ]) if (d.texts[k] !== undefined) doc.texts[k] = text(d.texts[k], "texts." + k, 12e3);
        for (const k of [ "next_goals", "home_practice" ]) if (d.texts[k] !== undefined) doc.texts[k] = list(d.texts[k], k, 30).map(x => text(x, k, 2e3));
    }
    if (d.stats !== undefined) {
        object(d.stats, "stats");
        for (const [k, v] of Object.entries(d.stats)) {
            if (!ctx.stats.includes(k)) invalid("统计项不在本报告配置中", "stats." + k);
            if ([ "mock_count", "days_to_exam" ].includes(k)) continue;
            object(v, "stats." + k);
            const value = scalar(v.value, "stats." + k);
            doc.stats[k] = {
                ...doc.stats[k],
                value: value,
                source: k.startsWith("manual_") ? "manual" : value === doc.stats[k]?.crm_value ? "crm" : "manual",
                overridden: k.startsWith("manual_") || value !== doc.stats[k]?.crm_value
            };
        }
    }
    if (d.artwork_image_ids !== undefined) doc.artwork_image_ids = ids(d.artwork_image_ids, "artwork_image_ids", 100);
    if (d.style !== undefined) {
        object(d.style, "style");
        if (d.style.pack_id !== undefined) text(d.style.pack_id, "style.pack_id", 100, false);
        if (d.style.pack_version !== undefined) text(d.style.pack_version, "style.pack_version", 100, false);
        if (d.style.pack_id !== undefined && (d.style.pack_id !== old.style.pack_id || d.style.pack_version !== undefined && d.style.pack_version !== old.style.pack_version)) {
            const pack = await r.planStyle(d.style.pack_id, d.style.pack_version ?? null);
            if (!pack) fail(404, "不存在", "not_found");
            if (!pack.active || !JSON.parse(pack.manifest_json).doc_types.includes("report")) invalid("风格不适用", "style");
            ctx.manifest = JSON.parse(pack.manifest_json);
            doc.style = {
                pack_id: pack.id,
                pack_version: pack.version
            };
        }
        if (d.style.header_image_id !== undefined) doc.style.header_image_id = d.style.header_image_id === null ? null : text(d.style.header_image_id, "header_image_id", 100, false);
    }
    if (d.renewal !== undefined) {
        object(d.renewal, "renewal");
        if (typeof d.renewal.visible !== "boolean") invalid("续费显示须为布尔值", "renewal");
        doc.renewal = {
            visible: d.renewal.visible,
            text: text(d.renewal.text ?? "", "renewal.text", 6e3)
        };
    }
    if (d.applied_suggestion_ids !== undefined) {
        doc.applied_suggestion_ids = ids(d.applied_suggestion_ids, "applied_suggestion_ids", 30);
        const fresh = doc.applied_suggestion_ids.filter(x => !old.applied_suggestion_ids?.includes(x));
        const refs = await r.growthFeedbackRefs([], [], [], fresh);
        if (refs.suggestions.length !== fresh.length || refs.suggestions.some(x => x.kind !== "report.text")) fail(404, "不存在", "not_found");
    }
    const images = reportImageIds(doc), refs = await r.growthFeedbackRefs([], [], images);
    if (refs.images.length !== images.length) fail(404, "不存在", "not_found");
    if (refs.images.some(x => x.hidden && !reportImageIds(old).includes(x.id))) invalid("新选图片已隐藏", "image_ids");
    doc.scores = previousScores(doc.scores, data, row.id);
    automaticStats(doc, ctx);
    doc.warnings = reportWarnings(ctx);
    return doc;
}

async function renderReport(r, row, children, base) {
    if (!children.includes(row.student_id) || !row.published_revision_id) fail(404, "不存在", "not_found");
    const rev = await r.growthRevision(row.published_revision_id);
    if (!rev) fail(404, "不存在", "not_found");
    const ctx = JSON.parse(rev.context_json), d = JSON.parse(rev.doc_json), student = await r.growthStudent(row.student_id);
    if (!student) fail(404, "不存在", "not_found");
    delete d.applied_suggestion_ids;
    delete d.reason;
    if (ctx.options.compare_previous === false) d.scores = d.scores.map(x => ({
        ...x,
        previous: null
    }));
    const image = id => base + "/parent/media/" + encodeURIComponent(id);
    if (d.style.header_image_id) d.style.header_image_url = image(d.style.header_image_id);
    if (student.parent_consent_media) {
        d.artwork_image_urls = d.artwork_image_ids.map(image);
        for (const m of d.mock_exams) m.image_urls = m.image_ids.map(image);
    } else {
        d.artwork_image_ids = [];
        for (const m of d.mock_exams) m.image_ids = [];
    }
    return {
        render_data: {
            ...d,
            student: {
                id: student.id,
                nickname: student.nickname
            },
            brand: ctx.brand,
            options: ctx.options
        },
        manifest: JSON.parse(rev.manifest_json),
        asset_base:base+"/parent/reports/"+encodeURIComponent(row.id)+"/style-assets/",
        revision_id: rev.id
    };
}

async function createBatch(r, d, u, p) {
    growthPermit(u, p, "write", {
        teacher_id: u.teacher_id
    });
    const students = ids(d.student_ids, "student_ids", 100);
    if (!students.length) invalid("请选择学生", "student_ids");
    const from = d.from, to = d.to;
    if (planDate(to) < planDate(from)) invalid("日期范围不正确", "to");
    const catalog = await r.growthCatalog(students);
    if (catalog.students.length !== students.length) fail(404, "不存在", "not_found");
    const owner = teacher(u) ? u.teacher_id : d.teacher_id ?? null;
    if (owner && !catalog.teachers.some(x => x.id === owner)) fail(404, "不存在", "not_found");
    if (teacher(u) && (await r.growthOwnedStudents(students, u.teacher_id)).length !== students.length) fail(404, "不存在", "not_found");
    const pack = await r.documentDefault("report"), brand = await r.brandLite();
    if (!pack) invalid("当前机构没有可用的成长报告风格包，请联系平台","style");
    if (!pack.active) invalid("默认报告风格已停用", "style");
    const manifest = JSON.parse(pack.manifest_json), batch = {
        id: randomId("gb"),
        name: text(d.name, "name", 200, false),
        from: from,
        to: to,
        teacher_id: owner
    };
    const reports = students.map((id, position) => {
        const student = catalog.students.find(x => x.id === id), classId = d.report_class_id ?? student.report_class_id, rc = catalog.classes.find(x => x.id === classId);
        if (!rc) {
            if (classId) fail(404, "不存在", "not_found");
            invalid("请先为学员补齐报告班型", "report_class_id");
        }
        if (!rc.active) invalid("班型已停用", "report_class_id");
        const cls = JSON.parse(rc.doc_json), options = cls.options || {}, keys = options.stats || (rc.subject === "art_exam" ? [ "camp_days", "mock_count", "days_to_exam" ] : [ "lessons", "attendance", "repertoire_done" ]), exam = catalog.calendar.items.find(x => x.key === "unified_exam")?.exact_date || null;
        const context = {
            class_id: rc.id,
            options: options,
            stats: keys,
            camp: catalog.camp,
            exam_date: exam,
            manifest: manifest,
            brand: {
                name: brand.display_name,
                primary_color: brand.theme_color
            },
            title: batch.name
        };
        const doc = {
            student_id: id,
            teacher_id: owner,
            period: {
                from: from,
                to: to
            },
            style: {
                pack_id: pack.id,
                pack_version: pack.version
            },
            dimensions_snapshot: cls.dimensions.map(({key: key, name: name, order: order}) => ({
                key: key,
                name: name,
                order: order
            })),
            stats: {},
            scores: [],
            mock_exams: [],
            texts: {
                progress: "",
                focus: "",
                next_goals: [],
                home_practice: [],
                teacher_note: ""
            },
            artwork_image_ids: [],
            renewal: {
                visible: false,
                text: ""
            },
            applied_suggestion_ids: [],
            warnings: reportWarnings(context)
        };
        return {
            id: randomId("gr"),
            position: position,
            student_id: id,
            teacher_id: owner,
            report_class_id: rc.id,
            doc_json: JSON.stringify(doc),
            context_json: JSON.stringify(context)
        };
    });
    const data = await r.growthReportData(reports);
    for (const row of reports) {
        const doc = JSON.parse(row.doc_json), ctx = JSON.parse(row.context_json), stats = data.stats.find(x => x.report_id === row.id) || {};
        for (const k of ctx.stats) if (![ "days_to_exam", "mock_count" ].includes(k)) {
            const n = k.startsWith("manual_") ? 0 : stats[k] || 0;
            doc.stats[k] = {
                value: n,
                crm_value: k.startsWith("manual_") ? null : n,
                source: k.startsWith("manual_") ? "manual" : "crm",
                overridden: k.startsWith("manual_")
            };
        }
        automaticStats(doc, ctx);
        row.doc_json = JSON.stringify(doc);
    }
    try {
        await r.growthCreateBatch(batch, reports, u, [ ...catalog.students, ...catalog.classes.filter(c => reports.some(x => x.report_class_id === c.id)).map(x => ({
            ...x,
            kind: "report_classes"
        })), ...catalog.teachers.filter(x => x.id === owner).map(x => ({
            ...x,
            kind: "teachers"
        })) ]);
    } catch (e) {
        if (/expected=actual/.test(String(e))) conflict(null);
        throw e;
    }
    return {
        batch: {
            ...batch,
            version: 1
        },
        reports: (await r.growthBatchReports(batch.id)).map(x => reportDto(x))
    };
}

export async function growthApi(req, env, resolved, u, p, url) {
    const path = resolved.relative;
    if (!growthPath(path)) return undefined;
    env.__identityContract = true;
    const r = repo(env, resolved.tenant.id), base = resolved.root ? "/api" : resolved.base.replace(/\/$/, "") + "/api";
    const parent = /^\/api\/parent\/(?:reports\/([^/]+)|children\/([^/]+)\/feed|media\/([^/]+))$/.exec(path);
    if (parent) {
        if (req.method !== "GET") fail(404, "不存在", "not_found");
        if (!personal(u)) fail(403, "没有权限", "forbidden");
        const children = await r.planChildIds(u);
        if (parent[1]) {
            if (!p.modules.growth_reports) fail(404, "不存在", "not_found");
            const row = await r.growthGet(parent[1]);
            if (!row) fail(404, "不存在", "not_found");
            return json(await renderReport(r, row, children, base));
        }
        if (parent[2]) {
            if (!children.includes(parent[2])) fail(404, "不存在", "not_found");
            if (!p.modules.plans && !p.modules.growth_reports) fail(404, "不存在", "not_found");
            const offset = Number(url.searchParams.get("offset") || 0), limit = Number(url.searchParams.get("limit") || 50);
            if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) invalid("分页不正确");
            const student = await r.growthStudent(parent[2]);
            if (!student) fail(404, "不存在", "not_found");
            const data = await r.growthCombinedFeed(parent[2], offset, limit, !!p.modules.plans, !!p.modules.growth_reports);
            return json({
                ...data,
                items: data.items.map(x => ({
                    ...x,
                    at: planIso(x.at),
                    ...x.type === "feedback" ? {
                        message: JSON.parse(x.doc_json).message,
                        tags: JSON.parse(x.doc_json).tags,
                        repertoire_ids: JSON.parse(x.doc_json).repertoire_ids || [],
                        public_comment: JSON.parse(x.doc_json).public_text || "",
                        image_ids: student.parent_consent_media ? JSON.parse(x.doc_json).image_ids || [] : [],
                        image_urls: student.parent_consent_media ? (JSON.parse(x.doc_json).image_ids || []).map(id => base + "/parent/media/" + encodeURIComponent(id)) : []
                    } : {},
                    doc_json: undefined
                })),
                next_offset: offset + limit < data.total ? offset + limit : null
            });
        }
        if (!p.modules.growth_reports) return undefined;
        const image = await r.growthParentMedia(parent[3], children);
        if (!image) return undefined;
        const file = await env.CHANNEL_MEDIA.get(image.r2_key);
        if (!file) fail(404, "不存在", "not_found");
        return new Response(Uint8Array.from(atob(await file.text()), c => c.charCodeAt(0)), {
            headers: {
                "Content-Type": image.mime,
                "Cache-Control": "private, no-store"
            }
        });
    }
    if (!p.modules.growth_reports) fail(404, "不存在", "not_found");
    if (path === "/api/feedback/today" && req.method === "GET") {
        if (!teacher(u)) fail(403, "仅老师可用", "forbidden");
        const day = new Date(now()).toLocaleDateString("sv-SE", {
            timeZone: "Asia/Shanghai"
        }), to = new Date(Date.parse(day + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);
        return json({
            items: (await r.growthToday(u.teacher_id, day, to)).map(x => ({
                ...x,
                status: x.submission_status || "not_submitted",
                can_submit: x.teacher_id === u.teacher_id && lessonWindow(x, now()).open && !x.locked && x.lesson_status === "planned" && can(u, p, "attendance", "submit", x),
                can_submit_comments: x.teacher_id === u.teacher_id && lessonWindow(x, now()).open && !x.locked && x.lesson_status !== "planned" && can(u, p, "comments", "create", x)
            }))
        });
    }
    const copied = /^\/api\/feedback\/([^/]+)\/([^/]+)\/copied$/.exec(path);
    if (copied && req.method === "POST") {
        const result = await r.growthCopied(copied[1], copied[2], u);
        if (!result) fail(404, "不存在", "not_found");
        if (!can(u, p, "feedback", "write", result.row) && !can(u, p, "feedback", "confirm", result.row)) fail(403, "没有权限", "forbidden");
        if (result.row.status !== "confirmed" || !result.current) fail(409, "仅可复制当前已确认版本", "invalid_state");
        await r.growthRecordCopy(result.row, u);
        return json({
            ok: true
        });
    }
    const rep = /^\/api\/students\/([^/]+)\/repertoire(?:\/([^/]+))?$/.exec(path);
    if (rep) {
        const student = await r.growthStudent(rep[1], teacher(u) ? u.teacher_id : null);
        if (!student) fail(404, "不存在", "not_found");
        growthPermit(u, p, req.method === "GET" ? "read" : "write", {
            teacher_id: u.teacher_id
        });
        if (personal(u)) fail(403, "没有权限", "forbidden");
        const rows = await r.growthRepertoire(student.id), dto = x => ({
            id: x.id,
            student_id: x.student_id,
            name: x.name,
            status: x.status,
            start_date: x.start_date,
            completed_date: x.completed_date,
            image_ids: JSON.parse(x.image_ids_json),
            version: x.version
        });
        if (req.method === "GET" && !rep[2]) return json({
            items: rows.map(dto)
        });
        if (![ "POST", "PUT" ].includes(req.method)) fail(404, "不存在", "not_found");
        const d = await body(req), old = rep[2] ? rows.find(x => x.id === rep[2]) : req.method === "PUT" ? rows.find(x => x.id === d.id) : null;
        if ((rep[2] || req.method === "PUT") && !old) fail(404, "不存在", "not_found");
        if (old && version(d.version) !== old.version) conflict(null);
        const value = {
            ...old,
            id: old?.id || randomId("rep"),
            student_id: student.id,
            name: text(d.name ?? old?.name, "name", 200, false),
            status: d.status ?? old?.status ?? "learning",
            start_date: d.start_date === undefined ? old?.start_date ?? null : d.start_date,
            completed_date: d.completed_date === undefined ? old?.completed_date ?? null : d.completed_date,
            image_ids_json: JSON.stringify(ids(d.image_ids ?? (old ? JSON.parse(old.image_ids_json) : []), "image_ids", 30)),
            deleted_at: null
        };
        if (![ "learning", "done" ].includes(value.status)) invalid("曲目状态不正确", "status");
        for (const k of [ "start_date", "completed_date" ]) if (value[k] !== null) planDate(value[k]);
        if (value.status === "done" && !value.completed_date) invalid("请填写完成日期", "completed_date");
        if (value.start_date && value.completed_date && value.start_date > value.completed_date) invalid("日期顺序不正确");
        const images = JSON.parse(value.image_ids_json), refs = await r.growthFeedbackRefs([], [], images);
        if (refs.images.length !== images.length) fail(404, "不存在", "not_found");
        await r.commitBusiness(await r.dataVersion(), [ {
            resource: "growth_repertoire",
            previous: old,
            data: value
        } ], u, "growth_reports", old ? "edit_repertoire" : "create_repertoire");
        return json(dto((await r.growthRepertoire(student.id)).find(x => x.id === value.id)), old ? 200 : 201);
    }
    const batch = /^\/api\/report-batches(?:\/([^/]+)(?:\/(publish))?)?$/.exec(path);
    if (batch) {
        if (!batch[1] && req.method === "POST") return json(await createBatch(r, await body(req), u, p), 201);
        const owner = teacher(u) ? u.teacher_id : url.searchParams.get("teacher_id") || null;
        if (req.method === "GET") {
            growthPermit(u, p, "read", {
                teacher_id: u.teacher_id
            });
            if (personal(u)) fail(403, "没有权限", "forbidden");
            if (!batch[1]) {
                const offset = Number(url.searchParams.get("offset") || 0), limit = Number(url.searchParams.get("limit") || 50);
                if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) invalid("分页不正确");
                const data = await r.growthBatches(owner, url.searchParams.get("term") || "", offset, limit), bs = data.items, rs = await r.growthReportsForBatches(bs.map(x => x.id), owner);
                return json({
                    items: bs.map(b => ({
                        id: b.id,
                        name: b.name,
                        from: b.from_date,
                        to: b.to_date,
                        teacher_id: b.teacher_id,
                        version: b.version,
                        reports: rs.filter(x => x.batch_id === b.id)
                    })),
                    total: data.total,
                    next_offset: offset + limit < data.total ? offset + limit : null
                });
            }
            const b = await r.growthBatch(batch[1]);
            if (!b) fail(404, "不存在", "not_found");
            const reports = (await r.growthBatchReports(b.id)).filter(x => !teacher(u) || x.teacher_id === u.teacher_id);
            if (teacher(u) && !reports.length) fail(404, "不存在", "not_found");
            return json({
                batch: {
                    id: b.id,
                    name: b.name,
                    from: b.from_date,
                    to: b.to_date,
                    version: b.version
                },
                reports: reports.map(x => reportDto(x))
            });
        }
        if (batch[2] && req.method === "POST") {
            const b = await r.growthBatch(batch[1]);
            if (!b) fail(404, "不存在", "not_found");
            growthPermit(u, p, "publish", {
                teacher_id: u.teacher_id
            });
            const d = await body(req), selected = ids(d.report_ids, "report_ids", 100), rows = await r.growthBatchReports(b.id);
            if (selected.some(id => !rows.some(x => x.id === id))) fail(404, "不存在", "not_found");
            for (const id of selected) {
                const row = rows.find(x => x.id === id);
                if (teacher(u) && row.teacher_id !== u.teacher_id) fail(404, "不存在", "not_found");
                growthPermit(u, p, "publish", row);
            }
            const entries = [], skipped = [], data = await r.growthReportData(rows.filter(x => selected.includes(x.id) && x.status === "ready"));
            for (const id of selected) {
                const row = rows.find(x => x.id === id);
                if (row.status !== "ready") {
                    skipped.push({
                        id: id,
                        reason: "not_ready"
                    });
                    continue;
                }
                const doc = JSON.parse(row.doc_json), context = JSON.parse(row.context_json);
                try {
                    reportCheck(doc, context);
                } catch (e) {
                    if (!(e instanceof HttpError)) throw e;
                    skipped.push({
                        id: id,
                        reason: e.code
                    });
                    continue;
                }
                automaticStats(doc, context, new Date(now()).toLocaleDateString("sv-SE", {
                    timeZone: "Asia/Shanghai"
                }));
                doc.scores = previousScores(doc.scores, data, row.id);
                entries.push({
                    row: row,
                    doc: doc,
                    context: context,
                    status: "published",
                    action: "publish",
                    published: true
                });
            }
            try {
                await r.growthCommitMany(entries, u);
            } catch (e) {
                if (/expected=actual/.test(String(e))) conflict(null);
                throw e;
            }
            const fresh = await r.growthBatchReports(b.id);
            return json({
                published: entries.map(x => reportDto(fresh.find(y => y.id === x.row.id))),
                skipped: skipped
            });
        }
        fail(404, "不存在", "not_found");
    }
    const report = /^\/api\/reports\/([^/]+)(?:\/(refresh-crm|ready|return|publish|unpublish))?$/.exec(path);
    if (report) {
        const row = await r.growthGet(report[1]);
        if (!row || teacher(u) && row.teacher_id !== u.teacher_id) fail(404, "不存在", "not_found");
        if (personal(u)) {
            if (req.method !== "GET" || report[2]) fail(403, "没有权限", "forbidden");
            const rendered = await renderReport(r, row, await r.planChildIds(u), base);
            return json({...rendered, feedback_count: await r.growthFeedbackCount(row.student_id, rendered.period.from, rendered.period.to)});
        }
        growthPermit(u, p, req.method === "GET" ? "read" : "write", row);
        if (req.method === "GET" && !report[2]) {
            const doc = reportDto(row, await r.growthReportData([row]));
            return json({...doc, feedback_count: await r.growthFeedbackCount(row.student_id, doc.period.from, doc.period.to)});
        }
        if (req.method === "PUT" && !report[2]) {
            const d = await body(req);
            requireVersion(d, row);
            return json(await changeReport(r, row, d, u, p, "save"));
        }
        if (req.method === "POST" && report[2]) {
            const d = await body(req);
            if (d.version !== undefined) requireVersion(d, row);
            return json(await changeReport(r, row, d, u, p, report[2]));
        }
    }
    fail(404, "不存在", "not_found");
}

async function changeReport(r, row, d, u, p, action) {
    const ctx = JSON.parse(row.context_json), data = await r.growthReportData([ row ]);
    let doc = JSON.parse(row.doc_json), status = row.status, clear = false, published = false;
    if (action === "save") {
        doc = await editedReport(r, row, d, u, ctx, data);
        status = "draft";
    } else if (action === "refresh-crm") {
        const values = data.stats.find(x => x.report_id === row.id) || {};
        for (const [k, v] of Object.entries(doc.stats)) if (!k.startsWith("manual_") && ![ "mock_count", "days_to_exam" ].includes(k)) v.crm_value = values[k] || 0;
        status = "draft";
    } else if (action === "ready") {
        if (row.status !== "draft") fail(409, "状态不允许完成", "invalid_state");
        reportCheck(doc, ctx);
        status = "ready";
    } else if (action === "return") {
        if (!staff(u)) fail(403, "没有权限", "forbidden");
        if (row.status !== "ready") fail(409, "状态不允许退回", "invalid_state");
        doc.reason = text(d.reason, "reason", 1e3, false);
        status = "draft";
    } else if (action === "publish") {
        growthPermit(u, p, "publish", row);
        if (row.status !== "ready" && !(teacher(u) && p.settings.teacher_can_publish_reports === true && row.status === "draft")) fail(409, "请先完成报告", "invalid_state");
        reportCheck(doc, ctx);
        status = "published";
        published = true;
        automaticStats(doc, ctx, new Date(now()).toLocaleDateString("sv-SE", {
            timeZone: "Asia/Shanghai"
        }));
        doc.scores = previousScores(doc.scores, data, row.id);
    } else if (action === "unpublish") {
        growthPermit(u, p, "unpublish", row);
        if (!row.published_revision_id) fail(409, "没有已发布版本", "invalid_state");
        doc.reason = text(d.reason, "reason", 1e3, false);
        clear = true;
        status = "ready";
    }
    try {
        await r.growthCommit(row, doc, ctx, status, action, u, published, clear);
    } catch (e) {
        if (/expected=actual/.test(String(e))) conflict(await r.growthGet(row.id));
        throw e;
    }
    return reportDto(await r.growthGet(row.id));
}
