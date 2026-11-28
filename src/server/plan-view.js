import {editorV2,renderV2,checkV2} from './plan-v2-view.js';
import { computedResponse } from "./plan-math.js";

import { planIso, planImages } from "./plan-document.js";
import { planStudentMask } from "./student-nickname.js";

function priceFilter(doc) {
    for (const line of doc.modules.courses.lines) if (line.snapshot?.pricing) delete line.snapshot.pricing.amount_cents;
    for (const fee of doc.computed.optional_fees || []) delete fee.price_text;
    return doc;
}

export function editorPlan(row, prices = true) {
    if(JSON.parse(row.doc_json).doc_version===2)return editorV2(row,prices);
    const doc = JSON.parse(row.doc_json);
    doc.meta.budget_cap = doc.meta.budget_cap_cents === null ? null : doc.meta.budget_cap_cents / 100;
    delete doc.meta.budget_cap_cents;
    doc.computed = computedResponse(doc.computed);
    if (!prices) priceFilter(doc);
    return {
        ...doc,
        id: row.id,
        version: row.version,
        status: row.status,
        current_revision_id: row.current_revision_id,
        sent_revision_id: row.sent_revision_id,
        signed_revision_id: row.signed_revision_id,
        updated_at: planIso(row.updated_at),
        updated_by: row.updated_by
    };
}

export function renderPlan(row, revision, context, mediaBase) {
    if(JSON.parse(revision.doc_json).doc_version===2)return renderV2(row,revision,context,mediaBase);
    const doc = JSON.parse(revision.doc_json), out = structuredClone(doc), media = id => mediaBase + "/" + id + (mediaBase.endsWith("/gallery") ? "/file" : "");
    out.meta.budget_cap = out.meta.budget_cap_cents === null ? null : out.meta.budget_cap_cents / 100;
    delete out.meta.budget_cap_cents;
    out.computed = computedResponse(out.computed);
    if (!doc.style.show_unit_price) priceFilter(out);
    for (const stage of out.modules.path.stages) delete stage.stage_snapshot;
    for (const line of out.modules.courses.lines) {
        if (line.snapshot) {
            delete line.snapshot.course_version;
            delete line.snapshot.price_list_rev;
            delete line.snapshot.taken_at;
        }
    }
    for (const [key, part] of Object.entries(out.modules)) if (!part.visible) out.modules[key] = {
        visible: false
    };
    if (!doc.modules.courses.visible) {
        for (const s of out.computed.stages || []) delete s.amount;
        out.computed.optional_fees = [];
        if (out.computed.total) out.computed.total.bundles = [];
    }
    if (!doc.modules.fees.visible) {
        for (const s of out.computed.stages || []) delete s.amount;
        if (out.computed.total) delete out.computed.total.amount;
        out.computed.installments = [];
        out.computed.optional_fees = [];
        delete out.computed.budget;
    }
    if (doc.style.cover_image_id && doc.modules.cover.visible) out.style.cover_image_url = media(doc.style.cover_image_id);
    if (doc.modules.about.visible) out.modules.about.images = doc.modules.about.image_ids.map(id => ({
        id: id,
        url: media(id)
    }));
    const student = context.student || {}, mask = planStudentMask(student);
    const brand = {
        name: context.brand.name,
        logo: context.brand.logo,
        primary_color: context.brand.primary_color
    };
    if (doc.style.show_consultant && context.brand.qr_image_id) brand.qr_url = media(context.brand.qr_image_id);
    delete out.applied_suggestion_ids;
    delete out.student_id;
    delete out.source_lead_id;
    delete out.meta.consultant_id;
    const renderData = {
        ...out,
        id: row.id,
        revision_id: revision.id,
        student: {
            nickname: student.parent_consent_media ? (student.nickname || "") : (mask.rawNick && !mask.leaksLegal ? mask.rawNick : (mask.rawNick ? mask.safeName : "")),
            display_name: student.parent_consent_media ? student.name : mask.safeName
        },
        brand: brand,
        ...(doc.style.show_consultant && context.consultant ? {consultant: {name:context.consultant.name}} : {}),
        ...doc.modules.about.visible ? {
            profile: context.profile
        } : {},
        ...doc.modules.teachers.visible ? {
            teachers: context.teachers.map(({requested_id: requested_id, name: name, introduction: introduction, subjects: subjects}) => ({
                id: requested_id,
                name: name,
                introduction: introduction,
                subjects: subjects
            }))
        } : {}
    };
    return {
        render_data: student.parent_consent_media ? renderData : mask.redactValue(renderData),
        manifest: JSON.parse(revision.manifest_json)
    };
}

function luminance(hex) {
    if (!/^#[a-fA-F0-9]{6}$/.test(hex || "")) return null;
    const c = [ 1, 3, 5 ].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
}

export function planCheck(doc, context, manifest, sources, terms) {
    if(doc.doc_version===2)return checkV2(doc,context,manifest,sources,terms);
    const blocking = [], warnings = [], passed = [], item = (code, text, module, action = "review") => ({
        code: code,
        text: text,
        module: module,
        action: action
    });
    if (doc.computed.budget.over) blocking.push(item("over_budget", "课程总费用超过预算上限", "fees", "review_budget")); else passed.push(item("within_budget", "课程总费用未超过预算上限", "fees", "none"));
    for (const line of doc.modules.courses.lines) {
        const row = sources.courses.find(c => c.id === line.course_id), current = row ? JSON.parse(row.doc_json) : null;
        if (!row || row.deleted_at || !row.active) warnings.push(item("course_inactive", "课程已停用，保留原快照：" + line.snapshot.name, "courses")); else if (!current.pricing || row.price_cents !== line.snapshot.pricing.amount_cents || current.pricing.mode !== line.snapshot.pricing.mode || current.pricing.mode === "package" && current.pricing.units_per_package !== line.snapshot.pricing.units_per_package) warnings.push(item("price_outdated", "当前价目表与快照不同：" + line.snapshot.name, "courses", "reprice"));
    }
    for (let i = 1; i < doc.modules.path.stages.length; i++) if (doc.modules.path.stages[i].start <= doc.modules.path.stages[i - 1].end) warnings.push(item("stage_overlap", "阶段日期存在重叠", "path"));
    for (const stage of doc.modules.path.stages) if (stage.stage_snapshot?.anchor === "before_node" && stage.stage_snapshot.anchor_node === doc.meta.target.node_key && doc.meta.target.month && stage.start.slice(0, 7) > doc.meta.target.month) warnings.push(item("node_conflict", "冲刺阶段开始时间晚于目标节点月份", "path"));
    const texts = [ doc.title, doc.meta.target.text ];
    if (doc.modules.cover.visible) texts.push(doc.modules.cover.eyebrow, doc.modules.cover.subtitle);
    if (doc.modules.assessment.visible) texts.push(doc.modules.assessment.text, doc.modules.assessment.source_note, ...doc.modules.assessment.strengths, ...doc.modules.assessment.gaps, ...doc.modules.assessment.goals);
    if (doc.modules.path.visible) for (const s of doc.modules.path.stages) texts.push(s.name, ...s.goals);
    if (doc.modules.courses.visible) for (const l of doc.modules.courses.lines) texts.push(l.snapshot.name, l.note, l.frequency_text, ...l.includes.map(x => x.label));
    if (doc.modules.fees.visible) texts.push(doc.modules.fees.note, ...doc.computed.total.bundles, ...doc.computed.optional_fees.map(x => x.label), ...doc.modules.fees.custom.map(x => x.label));
    if (doc.modules.about.visible) texts.push(context.profile.introduction, context.profile.address, context.profile.class_hours, ...context.profile.features || [], ...context.profile.selling_points || []);
    if (doc.modules.teachers.visible) texts.push(...context.teachers.map(x => x.introduction));
    const combined = texts.filter(x => typeof x === "string").join("\n");
    const hits = terms.filter(t => combined.includes(t));
    if (hits.length) blocking.push(item("ad_law_terms", "含有禁用词：" + [ ...new Set(hits) ].join("、"), "assessment", "edit_text")); else passed.push(item("compliance_terms", "未发现词库中的禁用词", "assessment", "none"));
    if (doc.modules.about.visible && (!context.profile.address || /占位|待补充|机构档案|xxx/i.test(JSON.stringify(context.profile))) || doc.modules.teachers.visible && (!context.teachers.length || context.teachers.some(x => !x.introduction || /占位|待补充|机构档案|xxx/i.test(x.introduction)))) warnings.push(item("profile_placeholder", "机构档案或老师介绍仍需补充", "about", "edit_profile"));
    for (const id of planImages(doc, context, true)) {
        const image = sources.images.find(x => x.id === id);
        if (image && image.width < 1600) warnings.push(item("image_low_res", "图片宽度不足1600，打印可能模糊", "cover", "replace_image"));
    }
    const colors = manifest.tokens?.color || {}, mode = doc.style.text_mode_resolved || doc.style.text_mode;
    if (doc.modules.cover.visible && doc.style.cover_image_id && mode !== "panel") warnings.push(item("cover_contrast", "主图文字区域需由前端检查对比度并预览打印效果", "cover", "check_contrast")); else if (doc.modules.cover.visible) {
        const dark = mode === "dark" || mode === "auto" && manifest.components?.["plan.cover"] !== "stage", bg = mode === "panel" || !dark ? colors.use_tenant_primary ? context.brand.primary_color : colors.primary : colors.paper, fg = dark ? colors.ink : colors.paper, a = luminance(bg), b = luminance(fg);
        if (a !== null && b !== null && (Math.max(a, b) + .05) / (Math.min(a, b) + .05) < 4.5) warnings.push(item("cover_contrast", "封面文字与底色对比度低于4.5:1", "cover", "check_contrast"));
    }
    return {
        blocking: blocking,
        warnings: warnings,
        passed: passed
    };
}
