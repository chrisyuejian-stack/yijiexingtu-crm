import {inlineText} from './content-inline.js';
import { defaultNickname } from "./student-nickname.js";

import { fail } from "./core.js";

import { contentDto, sources, text, invalid, blockText } from "./content-document.js";

export function privateSafe(value, student = null) {
    if (Array.isArray(value)) return value.map(x => privateSafe(x, student));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) => !/(phone|password|secret|token|phone_enc|parent_consent)/i.test(k)).map(([k, v]) => [ k, privateSafe(v, student) ]));
    if (typeof value === "string") {
        let v = value.replace(/(?:\+?86[- ]?)?1[3-9]\d{9}/g, "[手机号已隐去]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[邮箱已隐去]");
        if (student?.name && student.name !== student.nickname) v = v.replaceAll(student.name, student.nickname || "同学");
        return v;
    }
    return value;
}

function references(value, prefix, out) {
    if (Array.isArray(value)) value.forEach((v, i) => references(v, prefix + "." + i, out)); else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) references(v, prefix ? prefix + "." + k : k, out); else if (value !== null && value !== undefined && String(value) !== "") out[prefix] = String(value);
}

export async function aiContext(r, tool, action, input, user, policy) {
    const ctx = {
        tool: tool,
        action: action,
        instruction: text(input.instruction ?? "", "instruction", 1e4),
        target: {},
        refs: {},
        warnings: []
    };
    if (tool === "plan") {
        const id = text(input.plan_id, "plan_id", 100, false), row = await r.planGet(id);
        if (!row) fail(404, "不存在", "not_found");
        const parsed=JSON.parse(row.doc_json);if(parsed.doc_version===2)fail(409,'请使用新版方案AI接口','doc_version_conflict');
        const doc = parsed, catalog = await r.aiCatalog(row.student_id, row.source_lead_id), student = catalog.student || (catalog.lead ? {
            name: catalog.lead.name,
            nickname: defaultNickname(catalog.lead.name)
        } : JSON.parse((await r.planContext(row.context_id)).doc_json).student);
        ctx.instruction = privateSafe(ctx.instruction, student);
        const pasted=text(input.consult??'', 'consult', 20000);
        const followups=catalog.lead?await r.planLeadFollowups(catalog.lead.id):[];
        const consult = [pasted,...catalog.lead?[catalog.lead.note,...followups.map(x=>x.content)]:[]].filter(Boolean).join('\n');
        ctx.row = row;
        ctx.doc = doc;
        ctx.catalog = catalog;
        ctx.elements = await r.planElements(row.id);
        ctx.target = {
            plan_id: row.id
        };
        ctx.consult = privateSafe(consult, student);
        ctx.refs.consult = ctx.consult;
        const settings = catalog.settings;
        for (const [key, data] of Object.entries(settings)) references(data, key, ctx.refs);
        for (const course of catalog.courses) references({
            ...JSON.parse(course.doc_json),
            pricing: {
                ...JSON.parse(course.doc_json).pricing,
                amount: course.price_cents === null ? null : course.price_cents / 100
            }
        }, "course:" + course.id, ctx.refs);
        const modelDoc = {
            title: doc.title,
            meta: {
                start_month: doc.meta.start_month,
                target: doc.meta.target,
                budget_cap: doc.meta.budget_cap_cents === null ? null : doc.meta.budget_cap_cents / 100
            },
            modules: doc.modules
        };
        ctx.public = {
            plan: modelDoc,
            student: {
                nickname: student?.nickname || "同学",
                age: student?.birth_year ? (new Date).getUTCFullYear() - student.birth_year : null,
                grade: student?.grade || catalog.lead?.grade || "",
                subject: doc.subject,
                level: doc.modules.assessment.text
            },
            consult: ctx.consult,
            courses: catalog.courses.filter(x => x.active).map(x => ({
                id: x.id,
                ...JSON.parse(x.doc_json),
                price_cents: x.price_cents
            })),
            stage_types: catalog.stages.filter(x => x.active).map(x => ({
                id: x.id,
                ...JSON.parse(x.doc_json)
            })),
            rules: settings.course_rules || {
                items: []
            }
        };
        ctx.public = privateSafe(ctx.public, student);
        ctx.refs = privateSafe(ctx.refs, student);
    } else if (tool === "content") {
        ctx.tone = input.tone ?? 'balanced';
        if(!['formal','balanced','lively','playful'].includes(ctx.tone))invalid('语气不正确','tone');
        if(input.references!==undefined&&(typeof input.references!=='string'||input.references.length>8000))invalid('参考素材必须为不超过8000字的字符串','references');
        ctx.userReferences=input.references??'';
        const id = text(input.content_id, "content_id", 100, false), row = await r.contentGet(id);
        if (!row) fail(404, "不存在", "not_found");
        ctx.row = row;
        ctx.doc = JSON.parse(row.doc_json);
        ctx.textFormat=input.text_format??ctx.doc.text_format??'plain';if(!['plain','inline_v1'].includes(ctx.textFormat))invalid('正文格式不正确','text_format');
        ctx.selection = sources(input.sources ?? ctx.doc.sources);
        const data = await r.contentSources(ctx.selection);
        if (data.courses.length !== ctx.selection.course_ids.length) fail(404, "不存在", "not_found");
        ctx.data = data;
        ctx.target = {
            content_id: row.id
        };
        const courses = data.courses.map(x => {
            const d = {
                id: x.id,
                ...JSON.parse(x.doc_json)
            };
            if (ctx.selection.prices) d.pricing = d.pricing ? {
                ...d.pricing,
                amount: x.price_cents === null ? null : x.price_cents / 100
            } : null; else delete d.pricing;
            return d;
        });
        const profile = ctx.selection.profile ? data.profile : {};
        references(profile, "profile", ctx.refs);
        for (const c of courses) references(c, "course:" + c.id, ctx.refs);
        for (const image of data.gallery) references({
            tags: JSON.parse(image.tags_json),
            width: image.width,
            height: image.height
        }, "gallery:" + image.id, ctx.refs);
        const catalog = await r.aiCatalog();
        ctx.flagFacts = {profile:data.profile, courses:catalog.courses, selectedCourses:data.courses, teachers:(data.profile.teachers||[]).map(x=>x.name).filter(Boolean)};
        ctx.public = {
            text_format:ctx.textFormat,
            type: ctx.doc.type,
            subject: ctx.doc.subject,
            scene: ctx.doc.scene,
            title: ctx.doc.title,
            brief: ctx.doc.brief,
            blocks: ctx.doc.blocks,
            profile: profile,
            courses: courses,
            images: data.gallery.map(x => ({
                id: x.id,
                tags: JSON.parse(x.tags_json),
                width: x.width,
                height: x.height
            })),
            content_types: catalog.subjects.find(x => x.key === ctx.doc.subject)?.content_types || [],
            sources: ctx.selection
        };
        if (action === "rewrite") {
            if (!Number.isInteger(input.block_index) || input.block_index < 0 || input.block_index >= ctx.doc.blocks.length) invalid("请选择本内容中的块", "block_index");
            if (![ "polish", "shorten", "expand", "table", "list", "warmer", "professional", "custom" ].includes(input.mode)) invalid("改写方式不正确", "mode");
            ctx.instruction = text(input.instruction ?? "", "instruction", 500, input.mode !== "custom");
            ctx.target.block_index = input.block_index;
            ctx.public.selected_text = ctx.textFormat==='inline_v1'?inlineText(input.text ?? blockText(ctx.doc.blocks[input.block_index]),"text",20000):text(input.text ?? blockText(ctx.doc.blocks[input.block_index]), "text", 2e4);
            ctx.public.mode = input.mode;
        }
        if (action === "section") {
            ctx.target.section_key = text(input.section_key, "section_key", 100, false);
            ctx.public.section_key = ctx.target.section_key;
        }
        // Content sources contain no student records; selected institutional contact details are public business facts.
                ctx.public = structuredClone(ctx.public);
        ctx.refs = structuredClone(ctx.refs);
    } else {
        ctx.catalog = await r.aiCatalog();
        ctx.public = {
            instruction: ctx.instruction,
            courses: ctx.catalog.courses.map(x => ({
                id: x.id,
                version: x.version,
                ...JSON.parse(x.doc_json),
                price_cents: x.price_cents
            })),
            stages: ctx.catalog.stages.map(x => ({
                id: x.id,
                version: x.version,
                ...JSON.parse(x.doc_json)
            })),
            settings: ctx.catalog.settings,
            report_classes: ctx.catalog.report_classes.map(x => ({
                id: x.id,
                version: x.version,
                ...JSON.parse(x.doc_json)
            }))
        };
        for (const [key, data] of Object.entries(ctx.catalog.settings)) references(data, key, ctx.refs);
        ctx.public = privateSafe(ctx.public);
        ctx.refs = privateSafe(ctx.refs);
    }
    return ctx;
}
