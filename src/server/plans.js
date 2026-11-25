import {v2Text} from './plan-v2-text.js';
import {planTemplatesApi,resolveTemplate} from './plan-v2-templates.js';
import {prepareV2,validateV2Input} from './plan-v2-document.js';
import {convertV1,canonical} from './plan-v2-convert.js';
import {computeV2} from './plan-v2-math.js';
import {v2TeacherIds,v2Declarations} from './plan-v2-fields.js';
import {v2ExtraPath,v2Extras,v2EditorResponse,v2Hash} from './plan-v2-operations.js';
import {shiftV2} from './plan-v2-dates.js';
import {verifyAdoptedCards} from './plan-v2-cards.js';
import {normalizeProspect,storedProspect,readProspect,prospectLead,conversionData} from './plan-prospects.js';
import {styleImage} from './platform-ops.js';
import {assetPath} from './style-package.js';
import {referencedAsset} from './style-assets.js';
import { repo } from "./repo.js";

import { body, json, fail, HttpError, randomId, now, version, sha, b64, bytes, unb64, clientInfo, neutral404 } from "./core.js";

import { can } from "./permissions.js";

import { preparePlan, requestedSources, planImages, planText, planArray, stringList, planIso } from "./plan-document.js";

import { planValidation, computePlan, computedResponse, centsProduct, quantityKeys } from "./plan-math.js";

import { editorPlan, renderPlan, planCheck } from "./plan-view.js";

import { buildSkeleton } from "./plan-skeleton.js";

import { defaultNickname } from "./student-nickname.js";

export const planPath = p => v2ExtraPath(p) || /^\/api\/(?:plans(?:\/[^/]+(?:\/(?:convert-student|duplicate|revisions(?:\/[^/]+\/restore)?|skeleton|send|sign|archive|check|reprice|export|share-links(?:\/[^/]+)?))?)?|parent\/(?:plans\/[^/]+|children\/[^/]+\/feed|media\/[^/]+)|styles(?:\/[^/]+\/versions\/[^/]+)?|compliance\/terms)$/.test(p);

const staff = u => u.roles.some(r => [ "supervisor", "academic", "consultant", "finance" ].includes(r));

const personal = u => u.roles.some(r => [ "parent", "student" ].includes(r));

const raced = e => /CHECK constraint failed: expected=actual/.test(String(e?.message));

function permit(u, p, action = "read") {
    if (!can(u, p, "plans", action)) fail(403, "没有此操作权限", "forbidden");
}

function editing(row) {
    if (row.signed_revision_id || row.status === "signed" || row.status === "archived") fail(409, "当前方案已锁定，请复制成新方案后修改", "invalid_state");
}

function conflict(row, prices = true) {
    const e = new HttpError(409, "方案或引用的数据已变化，请刷新后重试", "version_conflict");
    e.details = {
        latest: row ? editorPlan(row, prices) : null
    };
    throw e;
}

function page(url) {
    const offset = Number(url.searchParams.get("offset") || 0), limit = Number(url.searchParams.get("limit") || 50);
    if (!Number.isInteger(offset) || offset < 0 || offset > 1e6 || !Number.isInteger(limit) || limit < 1 || limit > 200) planValidation("分页参数不正确");
    return {
        offset: offset,
        limit: limit
    };
}

const paged = (p, offset, limit) => ({
    ...p,
    next_offset: offset + limit < p.total ? offset + limit : null
});

function dto(revision) {
    return {
        id: revision.id,
        version: revision.seq,
        action: revision.action,
        sent_at: revision.sent_at === null ? null : planIso(revision.sent_at),
        created_at: planIso(revision.created_at),
        created_by: revision.created_by
    };
}

function unwrap(d) {
    if (d.doc !== undefined) {
        if (!d.doc || typeof d.doc !== "object" || Array.isArray(d.doc)) planValidation("doc必须为对象", "doc");
        return {
            ...d.doc,
            ...d.applied_suggestion_ids !== undefined ? {
                applied_suggestion_ids: d.applied_suggestion_ids
            } : {}
        };
    }
    return d;
}

async function chooseStyle(r, input, old, row) {
    const d = input ?? {}, previous = old?.style || {};
    if (!d || typeof d !== "object" || Array.isArray(d)) planValidation("style必须为对象", "style");
    const packId = d.pack_id ?? previous.pack_id ?? null, requestedVersion = d.pack_version ?? (packId === previous.pack_id ? previous.pack_version : null);
    if (packId !== null) planText(packId,"style.pack_id",100);
    if (requestedVersion !== null) planText(requestedVersion,"style.pack_version",50);
    let manifest, pack;
    if (row && packId === previous.pack_id && requestedVersion === previous.pack_version) {
        manifest = JSON.parse(row.manifest_json);
        pack = {
            id: packId,
            version: requestedVersion
        };
    } else {
        pack = await r.planStyle(packId, requestedVersion);
        if (!pack) {if(packId===null)planValidation("当前机构没有可用的课程方案风格包，请联系平台","style.pack_id","style_pack_invalid");fail(404,"不存在","not_found");}
        if (!pack.active) planValidation("风格包已停用", "style.pack_id", "style_pack_invalid");
        manifest = JSON.parse(pack.manifest_json);
        if(!manifest.doc_types.includes("plan"))planValidation("风格不支持课程方案","style.pack_id");
    }
    const mode = d.text_mode ?? previous.text_mode ?? "auto", resolved = d.text_mode_resolved ?? previous.text_mode_resolved ?? null;
    if (![ "auto", "dark", "light", "panel" ].includes(mode) || resolved !== null && ![ "dark", "light", "panel" ].includes(resolved)) planValidation("封面文字模式不正确", "style.text_mode");
    const point = d.focal_point ?? previous.focal_point ?? {
        x: .5,
        y: .5
    };
    if (!point || typeof point.x !== "number" || typeof point.y !== "number" || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1 || !Number.isFinite(point.x + point.y)) planValidation("封面焦点须在0–1之间", "style.focal_point");
    const flags = {};
    for (const [key, fallback] of [ [ "show_unit_price", false ], [ "show_latin_eyebrow", true ], [ "show_consultant", true ] ]) {
        const value = d[key] ?? previous[key] ?? fallback;
        if (typeof value !== "boolean") planValidation("样式开关须为布尔值", "style." + key);
        flags[key] = value;
    }
    const image = d.cover_image_id === undefined ? previous.cover_image_id ?? null : d.cover_image_id;
    if (image !== null) planText(image, "style.cover_image_id", 100);
    return {
        style: {
            pack_id: pack.id,
            pack_version: pack.version,
            cover_image_id: image,
            text_mode: mode,
            ...resolved ? {
                text_mode_resolved: resolved
            } : {},
            focal_point: {
                x: point.x,
                y: point.y
            },
            ...flags
        },
        manifest: manifest
    };
}

function contextFor(doc, old, sources, refs, actor) {
    let student = old?.student;
    if (!student || student.id !== doc.student_id || old?.source_lead_id !== doc.source_lead_id) {
        const s = sources.student || sources.lead || sources.prospect;
        if (!s) fail(404, "不存在", "not_found");
        student = {
            id: doc.student_id,
            name: s.name,
            nickname: s.nickname || defaultNickname(s.name),
            grade: s.grade || "",
            direction: s.direction || "",
            birth_year: s.birth_year ?? null,
            parent_consent_media: !!s.parent_consent_media
        };
    }
    const b = sources.brand, brand = old?.brand || {
        name: b.display_name,
        logo: b.logo,
        primary_color: b.theme_color,
        qr_image_id: b.qr_image_id ?? null
    };
    const p = sources.profile, profile = old?.profile || {
        introduction: p.introduction || "",
        features: p.features || [],
        address: p.address || "",
        class_hours: p.class_hours || "",
        contact_phone: p.contact_phone || "",
        selling_points: p.selling_points || []
    };
    const teachers = (doc.doc_version===2?v2TeacherIds(doc):doc.modules.teachers.teacher_ids).map(id => {
        const saved = old?.teachers?.find(x => x.requested_id === id);
        if (saved) return saved;
        const t = sources.teachers.find(x => x.requested_id === id);
        if (!t) fail(404, "不存在", "not_found");
        refs.push({
            kind: "teachers",
            id: t.id,
            version: t.version
        });
        return {
            requested_id: id,
            id: t.id,
            name: t.name,
            subjects: JSON.parse(t.subjects || "[]"),
            introduction: (p.teachers || []).find(x => x.teacher_id === t.id)?.introduction || ""
        };
    });
    let consultant = old?.consultant || null;
    if (doc.meta.consultant_id && consultant?.id !== doc.meta.consultant_id) {
        const u = sources.consultant;
        if (!u || !JSON.parse(u.roles).some(x => [ "supervisor", "academic", "consultant", "finance" ].includes(x))) fail(404, "不存在", "not_found");
        consultant = {
            id: u.id,
            name: u.name
        };
        refs.push({
            kind: "users",
            id: u.id,
            version: u.version
        });
    }
    if (!doc.meta.consultant_id) consultant = null;
    return {
        student: student,
        source_lead_id: doc.source_lead_id,
        brand: brand,
        profile: profile,
        teachers: teachers,
        consultant: consultant
    };
}

async function sourcesFor(r, d, old, context) {
    if(d.doc_version===2)validateV2Input(d);
    const request = requestedSources(d, old);
    if (context?.brand?.qr_image_id) request.images.push(context.brand.qr_image_id);
    request.consultant_id = d.meta?.consultant_id === undefined ? old?.meta?.consultant_id ?? null : d.meta.consultant_id;
    for (const key of [ "student_id", "lead_id", "consultant_id" ]) if (request[key] !== null) planText(request[key], key, 100);
    return r.planWorkspace(request);
}

function validateImages(doc, context, sources, oldDoc, oldContext, refs, trusted = false) {
    const prior = oldDoc ? new Set(planImages(oldDoc, oldContext, false)) : new Set;
    for (const id of planImages(doc, context, false)) {
        const image = sources.images.find(x => x.id === id);
        if (!image) fail(doc.doc_version===2?422:404, "请选择本机构可用图库图片", doc.doc_version===2?"invalid_image":"not_found");
        if (image.hidden && !trusted && !prior.has(id) && id !== context.brand.qr_image_id) planValidation("新选图片已隐藏，请换一张", "image_ids", "out_of_scope");
        refs.push({
            kind: "images",
            id: id,
            version: image.version
        });
    }
}

function makeNext(before, id, doc, contextId, manifest, actor) {
    return {
        ...before || {},
        id: id,
        student_id: doc.student_id,
        source_lead_id: doc.source_lead_id,
        subject: doc.subject,
        title: doc.title,
        status: before?.status || "draft",
        doc_json: JSON.stringify(doc),
        context_id: contextId,
        manifest_json: JSON.stringify(manifest),
        version: (before?.version || 0) + 1,
        sent_revision_id: before?.sent_revision_id || null,
        signed_revision_id: before?.signed_revision_id || null,
        signed_at: before?.signed_at || null,
        archived_at: before?.archived_at || null,
        created_at: before?.created_at || now(),
        created_by: before?.created_by || actor.id,
        updated_at: now(),
        updated_by: actor.id,
        applied_suggestion_ids: doc.applied_suggestion_ids || []
    };
}

async function commitRevision(r, before, id, doc, ctx, manifest, elements, refs, actor, action = "save", sent = false, idMap = {}, mutation = null) {
    const prior = before ? await r.planContext(before.context_id) : null, contextId = prior && prior.doc_json === JSON.stringify(ctx) ? prior.id : randomId("pctx");
    const context = contextId === prior?.id ? null : {
        id: contextId,
        doc_json: JSON.stringify(ctx)
    };
    const next = makeNext(before, id, doc, contextId, manifest, actor), revision = {
        id: randomId("rev"),
        seq: next.version,
        doc_json: next.doc_json,
        manifest_json: next.manifest_json,
        image_ids: planImages(doc, ctx, false)
    };
    next.current_revision_id = revision.id;
    if (sent) {
        revision.sent_at = now();
        next.status = "sent";
        next.sent_revision_id = revision.id;
    }
    try {
        await r.planCommit(before, next, {
            revision: revision,
            elements: elements,
            context: context,
            refs: refs,
            action: action,
            mutation
        }, actor);
    } catch (e) {
        if (raced(e)) conflict(await r.planGet(id));
        throw e;
    }
    return {
        row: await r.planGet(id),
        id_map: idMap
    };
}

async function savePlan(r, row, d, actor, policy, env, tenant) {
    if(d.template){if(!can(actor,policy,'plan_templates','write'))fail(403,'没有模版权限','forbidden');await resolveTemplate(r,d.template.id,d.template.version);if(d.template.pricing!=='current')planValidation('模版使用当前价目表','template.pricing');}
    const allocatedId=row?.id||randomId('pln');
    const input0=unwrap(d);let prospect=row?await readProspect(env,tenant,row):null,lead=null,mutation=null;
    if(!row){
        if(input0.lead_id!==undefined){if(input0.source_lead_id&&input0.source_lead_id!==input0.lead_id)planValidation('线索编号冲突','lead_id');input0.source_lead_id=input0.lead_id;}
        if([input0.student_id,input0.source_lead_id,input0.prospect].filter(x=>x!==null&&x!==undefined).length!==1)planValidation('学员、线索、意向信息必须恰好一个','prospect');
        if(input0.create_lead!==undefined&&typeof input0.create_lead!=='boolean')planValidation('create_lead必须为布尔值','create_lead');
        if(input0.create_lead&&!input0.prospect)planValidation('仅新意向可同时创建线索','create_lead');
        if(input0.prospect){
            prospect=normalizeProspect(input0.prospect);
            mutation={prospect:await storedProspect(env,tenant,allocatedId,prospect),changes:[]};
            if(input0.create_lead){
                if(!can(actor,policy,'leads','create'))fail(403,'没有新建线索权限','forbidden');
                lead=await prospectLead(env,tenant,prospect,actor);input0.source_lead_id=lead.id;
                mutation.revision=await r.dataVersion();mutation.changes.push({resource:'leads',data:lead});
            }
        }
    }else {if(input0.prospect!==undefined)planValidation('意向原始资料只读','prospect');if(row.student_id&&input0.student_id!==undefined&&input0.student_id!==row.student_id)planValidation('已转正方案不可更换学员','student_id');}
    // Contact data must never enter plan documents, immutable snapshots, or AI requests.
    const {prospect:unused,create_lead:ignored,lead_id:alias,...clean}=input0;
    d={...d,...clean};delete d.prospect;delete d.create_lead;delete d.lead_id;if(d.doc)d.doc=clean;

    const input = unwrap(d), old = row ? JSON.parse(row.doc_json) : null;
    if (row) {
        editing(row);
        if (version(d.version) !== row.version) conflict(row, can(actor, policy, "prices", "read"));
    }
    if (!row && input.meta?.consultant_id === undefined) input.meta = {
        ...input.meta || {},
        consultant_id: actor.id
    };
    const oldContext = row ? JSON.parse((await r.planContext(row.context_id)).doc_json) : null, source = await sourcesFor(r, input, old || {}, oldContext);
    source.prospect=prospect;if(lead)source.lead={...lead,version:1};
    if(old?.doc_version===2&&input.doc_version!==2)fail(409,'请使用新版编辑器保存方案','doc_version_conflict');
    let comparison=old?.doc_version===2?old:old&&input.doc_version===2?convertV1(old,oldContext,row):old;
    if(input.doc_version===2&&d.date_shift){if(!row||d.date_shift.base_version!==row.version)conflict(row);comparison=shiftV2(comparison,d.date_shift.months).doc;}
    const selected = await chooseStyle(r, input.style, old, row), prepared = input.doc_version===2?prepareV2(input,comparison,source,row?await r.planElements(row.id):[],row?await r.planV2Elements(row.id):[],selected.style):preparePlan(input, old, source, row ? await r.planElements(row.id) : [], selected.style);
    if(input.doc_version===2){
        if(d.expected_price_list_rev!==undefined&&(!Number.isInteger(d.expected_price_list_rev)||d.expected_price_list_rev<1))planValidation('价格修订须为正整数','expected_price_list_rev');
        if(prepared.newLines&&d.expected_price_list_rev===undefined)planValidation('新增价目表课程须确认价格修订','expected_price_list_rev');
        if(prepared.newLines&&source.prices_exists)prepared.refs.push({kind:'prices',id:'main',version:source.price_list_rev});
        if(input.student_id&&input.student_id!==old?.student_id){if(!source.student)fail(404,'不存在','not_found');prepared.refs.push({kind:'students',id:source.student.id,version:source.student.version});}
        if(input.source_lead_id&&input.source_lead_id!==old?.source_lead_id){if(!source.lead)fail(404,'不存在','not_found');prepared.refs.push({kind:'leads',id:source.lead.id,version:source.lead.version});}
        if(d.applied_cards!==undefined&&(!row||!Array.isArray(d.applied_cards)||d.applied_cards.some(x=>!x||typeof x!=='object'||typeof x.suggestion_id!=='string')))planValidation('采用记录格式不正确','applied_cards');
        const added=d.applied_suggestion_ids??[],cardIds=(d.applied_cards||[]).map(x=>x.suggestion_id);
        if(!Array.isArray(added)||added.length>30||added.some(x=>typeof x!=='string'))planValidation('建议引用格式不正确','applied_suggestion_ids');
        prepared.doc.applied_suggestion_ids=[...new Set([...(old?.applied_suggestion_ids||[]),...added,...cardIds])];
        if(prepared.doc.applied_suggestion_ids.length>30)planValidation('单份方案建议引用最多30条，请检查采用记录','applied_suggestion_ids');
        const conversion=old&&old.doc_version!==2?{revision_id:row.current_revision_id,original_json:row.doc_json,source_hash:await v2Hash(canonical(old)),projection_hash:await v2Hash(canonical(convertV1(old,oldContext,row)))}:null;
        if(d.applied_cards?.length){const ids=d.applied_cards.map(x=>x.suggestion_id),suggestions=(await r.planV2Suggestions(ids)).map(x=>({...JSON.parse(x.doc_json),_request_id:x.request_id}));verifyAdoptedCards(suggestions,d.applied_cards,prepared.doc,row,prepared.id_map);}
        mutation={...mutation,v2:{elements:prepared.v2_elements,conversion,adoptions:d.applied_cards||[]}};
    }
    if (!selected.manifest.subjects?.includes("*") && !selected.manifest.subjects?.includes(prepared.doc.subject)) planValidation("风格包不适用于这个学科", "style.pack_id", "style_pack_invalid");
    if(lead)prepared.refs=prepared.refs.filter(x=>!(x.kind==='leads'&&x.id===lead.id));
    const context = contextFor(prepared.doc, oldContext, source, prepared.refs, actor);
    validateImages(prepared.doc, context, source, old, oldContext, prepared.refs);
    const oldSuggestions = new Set(old?.applied_suggestion_ids || []), newSuggestions = prepared.doc.applied_suggestion_ids.filter(x => !oldSuggestions.has(x));
    if (newSuggestions.length) {
        const valid = await r.planSuggestionIds(newSuggestions);
        if (valid.length !== new Set(newSuggestions).size) fail(404, "不存在", "not_found");
        prepared.refs.push(...newSuggestions.map(id => ({
            kind: "suggestions",
            id: id
        })));
    }
    if (prepared.newLines && d.expected_price_list_rev !== undefined && d.expected_price_list_rev !== source.price_list_rev) {
        const e = new HttpError(409, "价目表已变化，请确认最新计算后再保存", "price_changed");
        const reverse = Object.fromEntries(Object.entries(prepared.id_map).map(([a, b]) => [ b, a ]));
        const calculated = computedResponse(prepared.doc.computed);
        for (const stage of calculated.stages) stage.key = reverse[stage.key] || stage.key;
        for (const item of calculated.installments) item.stage_key = reverse[item.stage_key] || item.stage_key;
        e.details = {
            price_list_rev: source.price_list_rev,
            computed: calculated
        };
        throw e;
    }
    return commitRevision(r, row, allocatedId, prepared.doc, context, selected.manifest, prepared.elements, prepared.refs, actor, row ? "save" : "create", false, prepared.id_map, mutation);
}

async function revisionBundle(r, row, id) {
    if (id !== undefined && id !== null) planText(id,"revision_id",120);
    const revision = id ? await r.planRevision(row.id, id) : {
        id: row.current_revision_id,
        seq: row.version,
        doc_json: row.doc_json,
        context_id: row.context_id,
        manifest_json: row.manifest_json,
        image_ids_json: JSON.stringify([])
    };
    if (!revision) fail(404, "不存在", "not_found");
    const context = await r.planContext(revision.context_id);
    if (!context) fail(404, "不存在", "not_found");
    return {
        revision: revision,
        context: JSON.parse(context.doc_json)
    };
}

async function checkBundle(r, row, id) {
    const result = await revisionBundle(r, row, id), doc = JSON.parse(result.revision.doc_json), sources = await sourcesFor(r, doc, doc, result.context);
    return {
        ...result,
        doc: doc,
        sources: sources,
        check: planCheck(doc, result.context, JSON.parse(result.revision.manifest_json), sources, (await r.planTerms()).map(x => x.term))
    };
}

function requirePassed(check, actor, force = []) {
    if (!Array.isArray(force) || force.some(x => x !== "over_budget")) planValidation("只允许主管确认超预算导出", "force");
    const remaining = check.blocking.filter(x => !(x.code === "over_budget" && force.includes("over_budget") && actor.roles.includes("supervisor")));
    if (remaining.length) {
        const e = new HttpError(422, "检查未通过，请先处理阻断项", "check_failed");
        e.details = {
            ...check,
            blocking: remaining
        };
        throw e;
    }
}

function registerElements(doc) {
    return [ ...doc.modules.path.stages.map(s => ({
        id: s.key,
        kind: "stage",
        target_id: s.stage_type_id,
        snapshot_json: JSON.stringify(s.stage_snapshot)
    })), ...doc.modules.courses.lines.map(l => ({
        id: l.line_id,
        kind: "line",
        target_id: l.course_id,
        snapshot_json: JSON.stringify(l.snapshot)
    })) ];
}

async function parentPlan(r, row, actor, base) {
    if (!personal(actor)) fail(403, "没有权限", "forbidden");
    if (![ "sent", "signed" ].includes(row.status)) fail(404, "不存在", "not_found");
    const visible = row.signed_revision_id || row.sent_revision_id, b = await revisionBundle(r, row, visible), children = await r.planChildIds(actor);
    if (!children.includes(b.revision.student_id)) fail(404, "不存在", "not_found");
    return {...renderPlan(row, b.revision, b.context, base + "/parent/media"),asset_base:base+"/parent/plans/"+encodeURIComponent(row.id)+"/style-assets/"};
}

function versionOptional(d, row) {
    if (d.version !== undefined && version(d.version) !== row.version) conflict(row);
}

function mediaResponse(image, obj) {
    if (!obj) fail(404, "不存在", "not_found");
    return obj.text().then(text => new Response(unb64(text), {
        headers: {
            "Content-Type": image.mime,
            "Cache-Control": "private, max-age=60",
            "X-Content-Type-Options": "nosniff"
        }
    }));
}

function selectedLines(doc, value) {
    if (value === undefined || value === null) return doc.modules.courses.lines.filter(x=>doc.doc_version!==2||x.pricing_source==='catalog').map(x => x.line_id);
    const ids = stringList(value, "line_ids", 200);
    if (new Set(ids).size !== ids.length || ids.some(id => !doc.modules.courses.lines.some(x => x.line_id === id))) planValidation("只能选择本方案的课程行", "line_ids");
    if(doc.doc_version===2&&ids.some(id=>doc.modules.courses.lines.find(x=>x.line_id===id).pricing_source==='manual'))planValidation('自由课程请手工修改单价','line_ids');
    return ids;
}

async function reprice(r, row, ids, actor, write, d = {}) {
    editing(row);
    if (write) versionOptional({
        ...d,
        version: version(d.version)
    }, row);
    const doc = JSON.parse(row.doc_json), source = await sourcesFor(r, doc, doc, null), selected = selectedLines(doc, ids), updated = structuredClone(doc), rows = [], refs = [];
    for (const line of updated.modules.courses.lines) {
        if(doc.doc_version===2&&line.pricing_source==='manual')continue;
        const oldAmount = line.snapshot.optional ? 0 : centsProduct(line.snapshot.pricing.amount_cents, line.qty[quantityKeys[line.snapshot.pricing.mode]]), current = source.courses.find(c => c.id === line.course_id), data = current ? JSON.parse(current.doc_json) : null;
        let status = "unchanged", newAmount = oldAmount;
        if (!current || current.deleted_at || !current.active) status = "course_inactive"; else if (!data.pricing || current.price_cents === null) status = "unpriced"; else if (selected.includes(line.line_id)) {
            if (data.pricing.mode !== line.snapshot.pricing.mode) planValidation("计价方式已变化，请删除旧行并新增课程行后填写新数量", "line_ids", "out_of_scope");
            const pricing = {
                mode: data.pricing.mode,
                amount_cents: current.price_cents,
                units_per_package: data.pricing.mode === "package" ? data.pricing.units_per_package : null
            };
            status = current.price_cents === line.snapshot.pricing.amount_cents && pricing.units_per_package === line.snapshot.pricing.units_per_package ? "unchanged" : "changed";
            line.snapshot = {
                ...line.snapshot,
                name: data.name,
                form: data.form,
                minutes: data.minutes ?? null,
                duration_text: data.duration_text ?? null,
                optional: !!data.optional,
                pricing: pricing,
                course_version: current.version,
                price_list_rev: source.price_list_rev,
                taken_at: planIso(now())
            };
            if(doc.doc_version===2){line.units_per_package=pricing.units_per_package;line.optional=!!data.optional;}
            newAmount = line.snapshot.optional ? 0 : centsProduct(pricing.amount_cents, line.qty[quantityKeys[pricing.mode]]);
            refs.push({
                kind: "courses",
                id: current.id,
                version: current.version
            });
        }
        if (write && selected.includes(line.line_id) && [ "course_inactive", "unpriced" ].includes(status)) planValidation("所选课程已停用或没有价格，不能刷新", "line_ids", "out_of_scope");
        rows.push({
            line_id: line.line_id,
            name: line.snapshot.name,
            old_amount: oldAmount / 100,
            new_amount: newAmount / 100,
            status: status
        });
    }
    updated.computed = updated.doc_version===2?computeV2(updated):computePlan(updated);
    const preview = {
        lines: rows,
        total: {
            old: doc.doc_version===2?doc.computed.total.amount:doc.computed.total.amount_cents / 100,
            new: updated.doc_version===2?updated.computed.total.amount:updated.computed.total.amount_cents / 100
        },
        budget_over: updated.computed.budget.over,
        price_list_rev: source.price_list_rev
    };
    if (!write) return preview;
    if (source.prices_exists) refs.push({
        kind: "prices",
        id: "main",
        version: source.price_list_rev
    });
    const ctx = JSON.parse((await r.planContext(row.context_id)).doc_json);
    return commitRevision(r, row, row.id, updated, ctx, JSON.parse(row.manifest_json), registerElements(updated), refs, actor, "reprice");
}

async function duplicate(r, row, d, actor, env, tenant) {
    const b = await revisionBundle(r, row, d.revision_id), doc = JSON.parse(b.revision.doc_json), map = {};
    if(doc.doc_version===2){
        for(const x of v2Declarations(doc))map[x.id]=randomId(({stage:'stk',line:'ln',group:'grp',teacher_group:'tgrp',teacher:'tm',goal_group:'gg',goal:'goal',photo:'pg',fee:'fee',installment:'ins',score:'sc',node:'nd'})[x.kind]);
        const walk=v=>{if(Array.isArray(v))return v.map(walk);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,k==='due_dates'?Object.fromEntries(Object.entries(x).map(([a,b])=>[map[a]||a,b])):['id','key','line_id','stage_key','group_id'].includes(k)?map[x]||x:walk(x)]));return v;};
        doc.modules=walk(doc.modules);
    }
    if(doc.doc_version!==2)for (const s of doc.modules.path.stages) map[s.key] = randomId("stk");
    if(doc.doc_version!==2)for (const l of doc.modules.courses.lines) map[l.line_id] = randomId("ln");
    if(doc.doc_version!==2)for (const s of doc.modules.path.stages) s.key = map[s.key];
    if(doc.doc_version!==2)for (const l of doc.modules.courses.lines) {
        l.line_id = map[l.line_id];
        l.stage_key = map[l.stage_key];
    }
    doc.modules.fees.due_dates = Object.fromEntries(Object.entries(doc.modules.fees.due_dates).map(([k, v]) => [ map[k]||k, v ]));
    for (const fee of doc.modules.fees.custom) if (fee.stage_key) fee.stage_key = map[fee.stage_key]||fee.stage_key;
    doc.student_id = d.student_id === undefined ? doc.student_id : d.student_id;
    doc.source_lead_id = d.source_lead_id === undefined ? doc.source_lead_id : d.source_lead_id;
    doc.title = doc.doc_version===2?v2Text(d.title??doc.title+"（副本）","title",200,true):planText(d.title ?? doc.title + "（副本）", "title", 200);
    if (!doc.student_id && !doc.source_lead_id && !row.prospect_enc) planValidation("学员、线索、意向信息至少一个", "student_id");
    const sources = await sourcesFor(r, doc, doc, b.context), refs = [];
    if (doc.student_id && doc.student_id !== JSON.parse(b.revision.doc_json).student_id) {
        if (!sources.student) fail(404, "不存在", "not_found");
        refs.push({
            kind: "students",
            id: doc.student_id,
            version: sources.student.version
        });
    }
    if (doc.source_lead_id && doc.source_lead_id !== JSON.parse(b.revision.doc_json).source_lead_id) {
        if (!sources.lead) fail(404, "不存在", "not_found");
        refs.push({
            kind: "leads",
            id: doc.source_lead_id,
            version: sources.lead.version
        });
    }
    const ctx = contextFor(doc, b.context, sources, refs, actor);
    validateImages(doc, ctx, sources, JSON.parse(b.revision.doc_json), b.context, refs, true);
    doc.computed = doc.doc_version===2?computeV2(doc):computePlan(doc);
    const id=randomId('pln'),p=await readProspect(env,tenant,row),mutation={...p?{prospect:await storedProspect(env,tenant,id,p)}:{},...doc.doc_version===2?{v2:{elements:v2Declarations(doc).filter(x=>!['stage','line'].includes(x.kind)).map(x=>({id:x.id,kind:x.kind}))}}:{}};
    return commitRevision(r, null, id, doc, ctx, JSON.parse(b.revision.manifest_json), registerElements(doc), refs, actor, 'duplicate', false, map, mutation);
}

async function plansApiImpl(req, env, resolved, actor, policy, url) {
    const path = resolved.relative;
    if (!planPath(path)) return undefined;
    env.__identityContract = true;
    const r = repo(env, resolved.tenant.id), base = resolved.root ? "/api" : resolved.base.replace(/\/$/, "") + "/api";
    if (path === "/api/compliance/terms" && req.method === "GET") return json({
        items: (await r.planTerms()).map(x => x.term)
    });
    if (path.startsWith("/api/styles")) {
        const historical = /^\/api\/styles\/[^/]+\/versions\/[^/]+$/.test(path);
        const type = url.searchParams.get("doc_type");
        const module = type === "article" ? "content" : ["report","feedback_card"].includes(type) ? "growth_reports" : "plans";
        const available = historical ? ["plans", "content", "growth_reports"].filter(key => policy.modules[key]) : policy.modules[module] ? [module] : [];
        if (!available.length) fail(404, "不存在", "not_found");
        if (!(staff(actor) || actor.roles.includes("teacher")) || !available.some(key => can(actor, policy, key, "read", {teacher_id:actor.teacher_id}))) fail(403, "没有权限", "forbidden");
        if (req.method !== "GET") fail(404, "不存在", "not_found");
        const versionPath = /^\/api\/styles\/([^/]+)\/versions\/([^/]+)$/.exec(path);
        if (versionPath) {
            const s = await r.planStyle(versionPath[1], versionPath[2], true);
            if (!s) fail(404, "不存在", "not_found");
            const manifest = JSON.parse(s.manifest_json);
            const legacyRead = available.some(key => ["plans", "content"].includes(key) && can(actor, policy, key, "read"));
            const growthRead = available.includes("growth_reports") && can(actor, policy, "growth_reports", "read", {teacher_id:actor.teacher_id});
            const legacyDocument = manifest.doc_types.some(type => ["plan", "article"].includes(type));
            const growthDocument = manifest.doc_types.some(type => ["report", "feedback_card"].includes(type));
            if (!(legacyDocument && legacyRead || growthDocument && growthRead)) fail(404, "不存在", "not_found");
            return json({
                id: s.id,
                name: s.name,
                version: s.version,
                manifest,
                asset_base:base+"/styles/"+encodeURIComponent(s.id)+"/versions/"+encodeURIComponent(s.version)+"/assets/"
            });
        }
        return json({
            items: (await r.planStyles(url.searchParams.get("doc_type") || "plan")).map(s => ({
                id: s.id,
                name: s.name,
                version: s.version,
                thumbnail: JSON.parse(s.manifest_json).thumbnail,
                asset_base:base+"/styles/"+encodeURIComponent(s.id)+"/versions/"+encodeURIComponent(s.version)+"/assets/",
                manifest: JSON.parse(s.manifest_json)
            }))
        });
    }
    if (!policy.modules.plans) fail(404, "不存在", "not_found");
    const parent = /^\/api\/parent\/(?:plans\/([^/]+)|children\/([^/]+)\/feed|media\/([^/]+))$/.exec(path);
    if (parent) {
        if (req.method !== "GET" || !personal(actor)) fail(403, "没有权限", "forbidden");
        const children = await r.planChildIds(actor);
        if (parent[1]) {
            const row = await r.planGet(parent[1]);
            if (!row) fail(404, "不存在", "not_found");
            return json(await parentPlan(r, row, actor, base));
        }
        if (parent[2]) {
            if (!children.includes(parent[2])) fail(404, "不存在", "not_found");
            const {offset: offset, limit: limit} = page(url), p = await r.planFeed(parent[2], offset, limit);
            return json(paged({
                items: p.items.map(x => ({
                    type: "plan",
                    id: x.id,
                    title: x.title,
                    status: x.status,
                    student_id: x.student_id,
                    revision_id: x.revision_id,
                    at: planIso(x.sent_at)
                })),
                total: p.total
            }, offset, limit));
        }
        const image = await r.planParentMedia(parent[3], children);
        if (!image) fail(404, "不存在", "not_found");
        return mediaResponse(image, await env.CHANNEL_MEDIA.get(image.r2_key));
    }
    if(v2ExtraPath(path)){
        const template=await planTemplatesApi(req,env,resolved,actor,policy,r);if(template!==undefined)return template;
        const extra=await v2Extras(req,env,resolved,actor,policy,r,{chooseStyle,sourcesFor,contextFor,validateImages});
        if(extra!==undefined)return extra;
    }
    const m = /^\/api\/plans(?:\/([^/]+)(?:\/(convert-student|duplicate|revisions|skeleton|send|sign|archive|check|reprice|export|share-links)(?:\/([^/]+)(?:\/(restore))?)?)?)?$/.exec(path);
    if (!m) fail(404, "不存在", "not_found");
    if (!m[1]) {
        if (req.method === "GET") {
            if (!staff(actor) && !personal(actor)) fail(403, "没有权限", "forbidden");
            if (staff(actor)) permit(actor, policy);
            const party=url.searchParams.get('party');if(party!==null&&!['student','lead','prospect'].includes(party))planValidation('party不正确','party');
            const reference=url.searchParams.get('reference');if(reference!==null&&(!['true','false'].includes(reference)||!can(actor,policy,'plan_references','write')))fail(reference==='true'||reference==='false'?403:422,'参考筛选不可用',reference==='true'||reference==='false'?'forbidden':'validation_failed');
            const {offset: offset, limit: limit} = page(url), p = await r.planList({
                reference:reference===null?null:reference==='true',include_reference:can(actor,policy,'plan_references','write'),
                party,
                student_id: url.searchParams.get("student_id"),
                lead_id: url.searchParams.get("lead_id"),
                status: url.searchParams.get("status"),
                q: url.searchParams.get("q") || "",
                offset: offset,
                limit: limit,
                children: personal(actor) ? await r.planChildIds(actor) : null
            });
            return json(paged({
                items: p.items.map(x => {
                    const doc = JSON.parse(x.visible_doc || x.doc_json);
                    return {
                        id: x.id,
                        doc_version:doc.doc_version??1,
                        reference_enabled:can(actor,policy,'plan_references','write')?!!x.reference_enabled:undefined,
                        title: doc.title||'未命名方案',
                        subject: doc.subject,
                        status: x.status,
                        student_id: x.visible_student_id ?? x.student_id,
                        source_lead_id:x.source_lead_id==='prospect:'+x.id?null:x.source_lead_id,
                        party:personal(actor)?'student':x.party,
                        party_name:personal(actor)?undefined:x.party_name,
                        version: personal(actor) ? undefined : x.version,
                        total: computedResponse(doc.computed.total),
                        updated_at: planIso(x.visible_at || x.updated_at),
                        ...x.visible_revision_id ? {
                            revision_id: x.visible_revision_id
                        } : {}
                    };
                }),
                total: p.total
            }, offset, limit));
        }
        if (req.method === "POST") {
            permit(actor, policy, "write");
            const saved = await savePlan(r, null, await body(req), actor, policy, env, resolved.tenant.id);
            return json({
                ...editorPlan(saved.row, can(actor, policy, "prices", "read")),
                id_map: saved.id_map
            }, 201);
        }
        fail(404, "不存在", "not_found");
    }
    if (!staff(actor)) {
        if (personal(actor) && !m[2] && req.method === "GET") {
            const row = await r.planGet(m[1]);
            if (!row) fail(404, "不存在", "not_found");
            return json(await parentPlan(r, row, actor, base));
        }
        fail(403, "没有权限", "forbidden");
    }
    permit(actor, policy);
    const row = await r.planGet(m[1]);
    if (!row) fail(404, "不存在", "not_found");
    const action = m[2];
    if(action==='convert-student'&&req.method==='POST'){
        if(!can(actor,policy,'students','create'))fail(403,'没有新建学员权限','forbidden');
        const d=await body(req),converted=await conversionData(env,resolved.tenant.id,r,row,d),{student,lead,revision,link}=converted;
        const doc=JSON.parse(row.doc_json);doc.student_id=student.id;
        const ctx=JSON.parse((await r.planContext(row.context_id)).doc_json);
        ctx.student={id:student.id,name:student.name,nickname:student.nickname||defaultNickname(student.name),grade:student.grade||'',direction:student.direction||'',birth_year:student.birth_year??null,parent_consent_media:!!student.parent_consent_media};
        const changes=[];if(!link)changes.push({resource:'students',data:student});
        if(lead)changes.push({resource:'leads',previous:lead,data:{...lead,stage:'enrolled',student_id:student.id}});
        const saved=await commitRevision(r,row,row.id,doc,ctx,JSON.parse(row.manifest_json),[],link?[{kind:'students',id:student.id,version:student.version}]:[],actor,'convert_student',false,{}, {revision,changes,action:'convert_student'});
        return json({...editorPlan(saved.row,can(actor,policy,'prices','read')),student_id:student.id});
    }
    if (m[3] && !(action === "share-links" && req.method === "DELETE") && !(action === "revisions" && m[4] === "restore" && req.method === "POST")) fail(404,"不存在","not_found");
    if (!action) {
        if (req.method === "GET") return json(await v2EditorResponse(r,row,env,resolved.tenant.id,actor,policy));
        if (req.method === "PUT") {
            permit(actor, policy, "write");
            const saved = await savePlan(r, row, await body(req), actor, policy, env, resolved.tenant.id);
            return json({
                ...editorPlan(saved.row, can(actor, policy, "prices", "read")),
                id_map: saved.id_map
            });
        }
        if (req.method === "DELETE") {
            permit(actor, policy, "write");
            if (row.status !== "draft") fail(409, "只能删除草稿", "invalid_state");
            const d = await body(req);
            versionOptional(d, row);
            await r.planCommit(row, {
                ...row,
                deleted_at: now(),
                version: row.version + 1
            }, {
                action: "delete",
                revoke: true
            }, actor);
            return json({
                ok: true
            });
        }
        fail(404, "不存在", "not_found");
    }
    if (action === "revisions" && !m[3] && req.method === "GET") {
        const {offset: offset, limit: limit} = page(url), p = await r.planRevisions(row.id, offset, limit);
        return json(paged({
            items: p.items.map(dto),
            total: p.total
        }, offset, limit));
    }
    if (action === "check" && req.method === "GET") return json((await checkBundle(r, row)).check);
    if (action === "reprice" && req.method === "GET") {
        const ids = url.searchParams.has("line_ids") ? url.searchParams.getAll("line_ids").flatMap(x => x.split(",")) : undefined;
        return json(await reprice(r, row, ids, actor, false));
    }
    if (action === "share-links" && req.method === "GET") {
        if (!can(actor, policy, "plans", "share")) fail(403, "没有权限", "forbidden");
        const {offset: offset, limit: limit} = page(url), p = await r.planLinks(row.id, offset, limit);
        return json(paged({
            items: p.items.map(x => ({
                ...x,
                expires_at: planIso(x.expires_at),
                created_at: planIso(x.created_at),
                revoked_at: x.revoked_at === null ? null : planIso(x.revoked_at)
            })),
            total: p.total
        }, offset, limit));
    }
    if (action === "share-links" && m[3] && req.method === "DELETE") {
        permit(actor, policy, "share");
        const d = await body(req);
        await r.planRevokeLink(row.id, m[3], d.version, actor);
        return json({
            ok: true
        });
    }
    if (req.method !== "POST") fail(404, "不存在", "not_found");
    const d = await body(req);
    if (action === "export") {
        const b = await checkBundle(r, row, d.revision_id);
        requirePassed(b.check, actor, d.force || []);
        if(b.doc.doc_version===2&&b.doc.modules.courses.lines.some(x=>x.pricing_source==='manual')&&d.acknowledgements?.manual_pricing!==true)planValidation('请确认非价目表课程及另议项','acknowledgements','check_failed');
        await r.planExportAudit(row, b.revision.id, d.force || [], actor);
        return json({
            ...renderPlan(row, b.revision, b.context, base + "/gallery"),
            checks: b.check
        });
    }
    if (action === "share-links") {
        permit(actor, policy, "share");
        if (row.status === "archived" || !row.sent_revision_id) fail(409, "请先发送方案再生成链接", "invalid_state");
        const b = await checkBundle(r, row, row.sent_revision_id);
        requirePassed(b.check, actor, []);
        const days = d.expires_in_days ?? 30;
        if (!Number.isInteger(days) || days < 1 || days > 180) planValidation("分享有效期为1–180天", "expires_in_days");
        const token = b64(bytes(32)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""), link = {
            id: randomId("shr"),
            revision_id: b.revision.id,
            token_hash: await sha(token),
            expires_at: now() + days * 864e5
        };
        await r.planCreateLink(row, link, actor);
        return json({
            id: link.id,
            url: new URL("/s/" + token, "https://" + env.TENANT_HOST).href,
            expires_at: planIso(link.expires_at)
        }, 201);
    }
    permit(actor, policy, "write");
    if (action === "duplicate") {
        const result = await duplicate(r, row, d, actor, env, resolved.tenant.id);
        return json({
            ...editorPlan(result.row, can(actor, policy, "prices", "read")),
            id_map: result.id_map
        }, 201);
    }
    if (action === "skeleton") {
        const settings = await r.planSkeletonSettings(row.subject), source = await r.planWorkspace({
            student_id: row.student_id
        });
        return json(buildSkeleton(d, settings.types, settings.rules, settings.calendar, {
            subject: row.subject,
            age: source.student?.birth_year ? Number(d.start_month?.slice(0, 4)) - source.student.birth_year : null
        }));
    }
    if (action === "reprice") {
        const saved = await reprice(r, row, d.line_ids, actor, true, d);
        return json({
            ...editorPlan(saved.row, can(actor, policy, "prices", "read")),
            id_map: saved.id_map
        });
    }
    if (action === "revisions" && m[3] && m[4] === "restore") {
        const b = await revisionBundle(r, row, m[3]);
        editing(row);
        versionOptional(d, row);
        let doc = JSON.parse(b.revision.doc_json);
        if(JSON.parse(row.doc_json).doc_version===2&&doc.doc_version!==2)doc=convertV1(doc,b.context,row);
        if(row.student_id){doc.student_id=row.student_id;doc.source_lead_id=row.source_lead_id;b.context.student=JSON.parse((await r.planContext(row.context_id)).doc_json).student;}
        doc.computed = doc.doc_version===2?computeV2(doc):computePlan(doc);
        const saved = await commitRevision(r, row, row.id, doc, b.context, JSON.parse(b.revision.manifest_json), registerElements(doc), [], actor, "restore");
        return json({
            ...editorPlan(saved.row, can(actor, policy, "prices", "read")),
            id_map: {}
        });
    }
    if (action === "send") {
        editing(row);
        versionOptional(d, row);
        const b = await checkBundle(r, row);
        requirePassed(b.check, actor, []);
        if(b.doc.doc_version===2&&b.doc.modules.courses.lines.some(x=>x.pricing_source==='manual')&&d.acknowledgements?.manual_pricing!==true)planValidation('请确认非价目表课程及另议项','acknowledgements','check_failed');
        const saved = await commitRevision(r, row, row.id, b.doc, b.context, JSON.parse(row.manifest_json), [], [], actor, "send", true);
        return json(editorPlan(saved.row, can(actor, policy, "prices", "read")));
    }
    if (action === "sign") {
        if (d.revision_id !== undefined && d.revision_id !== null) planText(d.revision_id,"revision_id",120);
        const revision = await r.planRevision(row.id, d.revision_id || row.sent_revision_id);
        if (!revision || !revision.sent_at) fail(404, "不存在或尚未发送", "not_found");
        const signedDoc=JSON.parse(revision.doc_json);if(signedDoc.doc_version===2){const calc=computeV2(signedDoc);if(!calc.total.complete||calc.total.has_tbd||calc.installment_status!=='balanced')planValidation('签约前须确认全部价格和分期','fees','check_failed');}
        editing(row);
        versionOptional(d, row);
        await r.planCommit(row, {
            ...row,
            status: "signed",
            signed_revision_id: revision.id,
            signed_at: now(),
            version: row.version + 1
        }, {
            action: "sign"
        }, actor);
        return json(editorPlan(await r.planGet(row.id), can(actor, policy, "prices", "read")));
    }
    if (action === "archive") {
        versionOptional(d, row);
        if (row.status === "archived") fail(409, "方案已归档", "invalid_state");
        await r.planCommit(row, {
            ...row,
            status: "archived",
            archived_at: now(),
            version: row.version + 1
        }, {
            action: "archive",
            revoke: true
        }, actor);
        return json(editorPlan(await r.planGet(row.id), can(actor, policy, "prices", "read")));
    }
    fail(404, "不存在", "not_found");
}

export async function plansPublic(req, env, url) {
    if (url.hostname !== env.TENANT_HOST) return null;
    const match = /^\/(?:api\/share|s)\/([^/]+)(?:\/media\/([^/]+)|\/style-assets\/(.+))?$/.exec(url.pathname);
    if (!match) return null;
    env.__planPublic = true;
    if (req.method !== "GET") return neutral404();
    const p = repo(env, null), ip = clientInfo(req).ip, key = "plan-share:" + await sha(ip);
    if (await p.limit(key, 6e4, 60, 6e4)) return json({
        error: "rate_limited",
        message: "访问过于频繁，请稍后重试"
    }, 429);
    const token = /^[A-Za-z0-9_-]{43}$/.test(match[1]) ? match[1] : "invalid";
    const owner = await p.planShareOwner(await sha(token));
    if (!owner) return neutral404();
    const r = repo(env, owner.tenant_id), revision = await r.planShareOpen(owner.id, now(), !match[2]&&!match[3]);
    if (!revision) return neutral404();
    const context = await r.planContext(revision.context_id);
    if (!context) return neutral404();
    const ctx = JSON.parse(context.doc_json), doc = JSON.parse(revision.doc_json), images = planImages(doc, ctx, true);
    if(match[3]) {
        try{const path=assetPath(decodeURIComponent(match[3])),manifest=JSON.parse(revision.manifest_json);if(!referencedAsset(manifest,path))return neutral404();const asset=await r.platformOps.asset(doc.style.pack_id,doc.style.pack_version,path);if(!asset)return neutral404();return await styleImage(env,asset);}catch(e){if(e.status===404||e.status===422||e instanceof URIError)return neutral404();throw e;}
    }
    if (match[2]) {
        if (!images.includes(match[2])) return neutral404();
        const image = await r.settingsGallery(match[2]);
        if (!image) return neutral404();
        const object = await env.CHANNEL_MEDIA.get(image.r2_key);
        if (!object) return neutral404();
        return mediaResponse(image, object);
    }
    return json({...renderPlan({id:revision.plan_id},revision,ctx,"/api/share/"+match[1]+"/media"),asset_base:"/api/share/"+match[1]+"/style-assets/"});
}

export async function plansApi(req, env, resolved, actor, policy, url) {
    try {
        return await plansApiImpl(req, env, resolved, actor, policy, url);
    } catch (e) {
        if (raced(e)) {
            const id = /^\/api\/plans\/([^/]+)/.exec(resolved.relative)?.[1];
            conflict(id ? await repo(env, resolved.tenant.id).planGet(id) : null, can(actor, policy, "prices", "read"));
        }
        throw e;
    }
}
