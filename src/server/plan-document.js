import {v2Sources,v2Images} from './plan-v2-fields.js';
import { randomId, now, fail } from "./core.js";

import { planValidation, planDate, calendarWeeks, quantityHundredths, quantityKeys, planMoney, computePlan } from "./plan-math.js";

import { subjectPacks } from "./subject-packs.js";

export const planIso = at => new Date(at + 8 * 36e5).toISOString().replace("Z", "+08:00");

export const planText = (v, field, max = 100, empty = false) => {
    if (typeof v !== "string" || v.length > max || !empty && !v.trim()) planValidation(field + "格式不正确", field);
    return v.trim();
};

export const planArray = (v, field, max = 200) => {
    if (!Array.isArray(v) || v.length > max) planValidation(field + "数组格式或数量不正确", field);
    return v;
};

export function stringList(v, field, max = 30) {
    return planArray(v, field, max).map(x => planText(x, field, 1e3));
}

function boolean(v, old, fallback = true) {
    if (v === undefined) return old ?? fallback;
    if (typeof v !== "boolean") planValidation("开关必须为布尔值");
    return v;
}

function object(v, field) {
    if (!v || typeof v !== "object" || Array.isArray(v)) planValidation(field + "必须为对象", field);
    return v;
}

function month(v, field, nullable = false) {
    if (v === null && nullable) return null;
    if (typeof v !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v) || Number(v.slice(0, 4)) < 2e3 || Number(v.slice(0, 4)) > 2100) planValidation("月份不正确", field);
    return v;
}

function integer(v, field, min, max) {
    if (!Number.isInteger(v) || v < min || v > max) planValidation(field + "必须为范围内整数", field);
    return v;
}

const defaultModules = () => ({
    cover: {
        visible: true,
        eyebrow: "",
        subtitle: ""
    },
    assessment: {
        visible: true,
        text: "",
        strengths: [],
        gaps: [],
        goals: [],
        source_note: ""
    },
    path: {
        visible: true,
        stages: []
    },
    courses: {
        visible: true,
        lines: []
    },
    fees: {
        visible: true,
        installments: "per_stage",
        custom: [],
        due_dates: {},
        note: ""
    },
    teachers: {
        visible: true,
        teacher_ids: []
    },
    about: {
        visible: false,
        image_ids: []
    }
});

export function requestedSources(d, old = {}) {
    if(d.doc_version===2)return v2Sources(d);
    const modules = d.modules || old.modules || defaultModules(), list = v => Array.isArray(v) ? v : [];
    return {
        courses: [ ...new Set(list(modules.courses?.lines ?? old.modules?.courses?.lines).map(x => x?.course_id).filter(x => typeof x === "string")) ],
        stages: [ ...new Set(list(modules.path?.stages ?? old.modules?.path?.stages).map(x => x?.stage_type_id).filter(x => typeof x === "string")) ],
        images: [ ...new Set([ d.style?.cover_image_id ?? old.style?.cover_image_id, ...list(modules.about?.image_ids ?? old.modules?.about?.image_ids) ].filter(x => typeof x === "string")) ],
        teachers: list(modules.teachers?.teacher_ids ?? old.modules?.teachers?.teacher_ids).filter(x => typeof x === "string"),
        student_id: d.student_id === undefined ? old.student_id ?? null : d.student_id,
        lead_id: d.source_lead_id === undefined ? old.source_lead_id ?? null : d.source_lead_id
    };
}

export function preparePlan(d, old, sources, elements, style) {
    object(d, "doc");
    const previous = old || {
        modules: defaultModules(),
        meta: {
            budget_cap_cents: null,
            target: {
                node_key: null,
                month: null,
                text: ""
            }
        }
    }, oldModules = previous.modules || defaultModules(), m = d.modules === undefined ? {} : object(d.modules, "modules"), stamp = planIso(now()), id_map = {}, used = new Set, refs = [], writes = [];
    const doc = {
        student_id: d.student_id === undefined ? old?.student_id ?? null : d.student_id,
        source_lead_id: d.source_lead_id === undefined ? old?.source_lead_id ?? null : d.source_lead_id,
        subject: d.subject ?? old?.subject,
        title: planText(d.title ?? old?.title, "title", 200),
        style: style
    };
    if (!doc.student_id && !doc.source_lead_id && !sources.prospect) planValidation('学员、线索、意向信息至少一个','student_id');
    if (!Object.hasOwn(subjectPacks, doc.subject)) planValidation("学科未开放", "subject");
    if (doc.student_id !== null) {
        planText(doc.student_id, "student_id", 100);
        if (doc.student_id !== old?.student_id) {
            if (!sources.student) fail(404, "不存在", "not_found");
            refs.push({
                kind: "students",
                id: doc.student_id,
                version: sources.student.version
            });
        }
    }
    if (doc.source_lead_id !== null) {
        planText(doc.source_lead_id, "source_lead_id", 100);
        if (doc.source_lead_id !== old?.source_lead_id) {
            if (!sources.lead) fail(404, "不存在", "not_found");
            refs.push({
                kind: "leads",
                id: doc.source_lead_id,
                version: sources.lead.version
            });
        }
    }
    for (const key of [ "cover", "assessment", "path", "courses", "fees", "teachers", "about" ]) if (m[key] !== undefined) object(m[key], "modules." + key);
    const meta = d.meta === undefined ? {} : object(d.meta, "meta"), oldMeta = previous.meta || {};
    const target = {
        ...oldMeta.target || {},
        ...meta.target === undefined ? {} : object(meta.target, "meta.target")
    };
    doc.meta = {
        start_month: month(meta.start_month ?? oldMeta.start_month ?? planIso(now()).slice(0, 7), "meta.start_month"),
        budget_cap_cents: meta.budget_cap === undefined ? oldMeta.budget_cap_cents ?? null : planMoney(meta.budget_cap, "meta.budget_cap"),
        target: {
            node_key: target.node_key ?? null,
            month: month(target.month ?? null, "meta.target.month", true),
            text: planText(target.text ?? "", "meta.target.text", 1e3, true)
        },
        consultant_id: meta.consultant_id === undefined ? oldMeta.consultant_id ?? null : meta.consultant_id
    };
    if (doc.meta.target.node_key !== null) planText(doc.meta.target.node_key, "meta.target.node_key", 100);
    if (doc.meta.consultant_id !== null) planText(doc.meta.consultant_id, "meta.consultant_id", 100);
    doc.modules = {};
    for (const [kind, fields] of [ [ "cover", {
        eyebrow: 200,
        subtitle: 1e3
    } ], [ "assessment", {
        text: 12e3,
        source_note: 2e3
    } ] ]) {
        const part = m[kind] || {}, before = oldModules[kind] || {};
        doc.modules[kind] = {
            visible: boolean(part.visible, before.visible)
        };
        for (const [key, max] of Object.entries(fields)) doc.modules[kind][key] = planText(part[key] ?? before[key] ?? "", kind + "." + key, max, true);
        if (kind === "assessment") for (const key of [ "strengths", "gaps", "goals" ]) doc.modules[kind][key] = stringList(part[key] ?? before[key] ?? [], kind + "." + key);
    }
    function stable(input, kind, index) {
        const prefix = kind === "line" ? "ln_" : "stk_";
        let id = input;
        if (input === undefined || input === null || input === "" || typeof input === "string" && input.startsWith("tmp_")) {
            if (input) planText(input, kind + ".temp_id", 120);
            id = randomId(kind === "line" ? "ln" : "stk");
            const key = input || kind + "s[" + index + "]";
            if (Object.hasOwn(id_map, key)) planValidation("临时ID不能重复", kind);
            id_map[key] = id;
        } else {
            planText(input, kind + ".id", 120);
            if (!input.startsWith(prefix)) planValidation("稳定ID格式不正确", kind);
            if (!elements.some(x => x.id === input && x.kind === kind)) fail(404, "不存在", "not_found");
        }
        if (used.has(id)) planValidation("稳定ID不能重复", kind);
        used.add(id);
        return id;
    }
    const path = m.path || {}, stageInput = planArray(path.stages ?? oldModules.path.stages, "path.stages", 100);
    let previousEnd = null;
    const stages = stageInput.map((s, i) => {
        object(s, "stage");
        const key = stable(s.key, "stage", i);
        const start = planDate(s.start, "stage.start"), end = planDate(s.end, "stage.end");
        if (end < start || previousEnd !== null && start !== previousEnd + 864e5) planValidation("阶段必须按日期连续排列，不能重叠或留空", "path.stages");
        previousEnd = end;
        planText(s.stage_type_id, "stage_type_id", 100);
        const existing = oldModules.path.stages.find(x => x.key === key), registered = elements.find(x => x.id === key);
        let snap = existing?.stage_type_id === s.stage_type_id ? existing.stage_snapshot : registered?.target_id === s.stage_type_id && registered.snapshot_json ? JSON.parse(registered.snapshot_json) : null;
        if (!snap) {
            const type = sources.stages.find(x => x.id === s.stage_type_id && !x.deleted_at);
            if (!type) fail(404, "不存在", "not_found");
            if (!type.active) planValidation("新增阶段类型已停用", "stage_type_id", "out_of_scope");
            const t = JSON.parse(type.doc_json);
            snap = {
                name: t.name,
                anchor: t.anchor,
                anchor_node: t.anchor_node,
                offset_months: t.offset_months,
                rule_keys: Object.keys(sources.rules.rules).filter(k => sources.rules.rules[k]),
                type_version: type.version,
                rules_version: sources.rules.version,
                taken_at: stamp
            };
            refs.push({
                kind: "stages",
                id: type.id,
                version: type.version
            });
            if (sources.rules.exists) refs.push({
                kind: "rules",
                id: "main",
                version: sources.rules.version
            });
        }
        const weeks = s.teaching_weeks ?? null;
        if (weeks !== null) integer(weeks, "teaching_weeks", 1, 1e4);
        const note = planText(s.weeks_note ?? "", "weeks_note", 1e3, true);
        if (weeks !== null && !note) planValidation("手填教学周必须说明原因", "weeks_note");
        const result = {
            key: key,
            stage_type_id: s.stage_type_id,
            name: planText(s.name ?? snap.name, "stage.name", 100),
            start: s.start,
            end: s.end,
            teaching_weeks: weeks,
            weeks_note: note,
            goals: stringList(s.goals ?? [], "stage.goals"),
            node_tags: stringList(s.node_tags ?? [], "node_tags"),
            stage_snapshot: snap
        };
        writes.push({
            id: key,
            kind: "stage",
            target_id: s.stage_type_id,
            snapshot_json: JSON.stringify(snap)
        });
        return result;
    });
    doc.modules.path = {
        visible: boolean(path.visible, oldModules.path.visible),
        stages: stages
    };
    const stageKeys = new Set(stages.map(s => s.key));
    const stageRef = (id, field) => {
        const key = id_map[id] || id;
        if (!stageKeys.has(key)) planValidation("阶段引用必须是本方案当前阶段", field);
        return key;
    };
    const courses = m.courses || {}, lineInput = planArray(courses.lines ?? oldModules.courses.lines, "courses.lines", 200);
    let newLines = 0;
    const lines = lineInput.map((line, i) => {
        object(line, "line");
        const id = stable(line.line_id, "line", i), registered = elements.find(x => x.id === id), existing = oldModules.courses.lines.find(x => x.line_id === id);
        planText(line.course_id, "course_id", 100);
        if (registered && registered.target_id !== line.course_id) planValidation("已有课程行不能更换课程，请删除后新增", "course_id");
        let snap = existing?.snapshot || (registered?.snapshot_json ? JSON.parse(registered.snapshot_json) : null);
        if (!snap) {
            const course = sources.courses.find(x => x.id === line.course_id && !x.deleted_at);
            if (!course) fail(404, "不存在", "not_found");
            const c = JSON.parse(course.doc_json);
            if (!course.active || !c.pricing || course.price_cents === null) planValidation("新课程必须启用且已定价", "course_id", "out_of_scope");
            snap = {
                name: c.name,
                form: c.form,
                minutes: c.minutes ?? null,
                duration_text: c.duration_text ?? null,
                optional: !!c.optional,
                pricing: {
                    mode: c.pricing.mode,
                    amount_cents: course.price_cents,
                    units_per_package: c.pricing.mode === "package" ? c.pricing.units_per_package : null
                },
                course_version: course.version,
                price_list_rev: sources.price_list_rev,
                taken_at: stamp
            };
            refs.push({
                kind: "courses",
                id: course.id,
                version: course.version
            });
            if (sources.prices_exists) refs.push({
                kind: "prices",
                id: "main",
                version: sources.price_list_rev
            });
            newLines++;
        }
        const quantity = object(line.qty, "qty"), qkey = quantityKeys[snap.pricing.mode];
        if (!qkey || Object.keys(quantity).length !== 1 || !Object.hasOwn(quantity, qkey)) planValidation("qty只能填写计价方式对应的数量字段", "qty");
        quantityHundredths(quantity[qkey]);
        const includes = planArray(line.includes ?? [], "includes", 50).map(x => ({
            label: planText(object(x, "includes").label, "includes.label", 500),
            form: planText(x.form ?? "", "includes.form", 100, true),
            schedule_text: planText(x.schedule_text ?? "", "includes.schedule_text", 500, true),
            duration_text: planText(x.duration_text ?? "", "includes.duration_text", 100, true)
        }));
        const result = {
            line_id: id,
            stage_key: stageRef(line.stage_key, "line.stage_key"),
            course_id: line.course_id,
            qty: {
                [qkey]: quantity[qkey]
            },
            frequency_text: planText(line.frequency_text ?? "", "frequency_text", 500, true),
            note: planText(line.note ?? "", "line.note", 2e3, true),
            ai_filled: boolean(line.ai_filled, undefined, false),
            includes: includes,
            snapshot: snap
        };
        writes.push({
            id: id,
            kind: "line",
            target_id: line.course_id,
            snapshot_json: JSON.stringify(snap)
        });
        return result;
    });
    doc.modules.courses = {
        visible: boolean(courses.visible, oldModules.courses.visible),
        lines: lines
    };
    const fee = {
        ...oldModules.fees,
        ...m.fees
    }, mode = fee.installments ?? "per_stage";
    if (![ "per_stage", "custom" ].includes(mode)) planValidation("只支持按阶段或自定义比例分期", "fees.installments");
    const custom = planArray(fee.custom ?? [], "fees.custom", 100).map(x => ({
        stage_key: object(x, "fees.custom").stage_key == null ? null : stageRef(x.stage_key, "fees.custom.stage_key"),
        label: planText(x.label, "fees.custom.label", 30),
        due: x.due == null ? null : (planDate(x.due, "fees.custom.due"), x.due),
        ratio_bps: integer(x.ratio_bps, "ratio_bps", 1, 1e4)
    }));
    if (mode === "per_stage" && custom.length || mode === "custom" && (!custom.length || custom.reduce((sum, x) => sum + x.ratio_bps, 0) !== 1e4)) planValidation("按阶段分期custom须为空；自定义比例合计必须为10000", "fees.custom");
    const due = {};
    for (const [key, value] of Object.entries(object(fee.due_dates ?? {}, "fees.due_dates"))) {
        const official = stageRef(key, "fees.due_dates");
        if (value !== null) planDate(value, "fees.due_dates");
        due[official] = value;
    }
    doc.modules.fees = {
        visible: boolean(fee.visible, oldModules.fees.visible),
        installments: mode,
        custom: custom,
        due_dates: due,
        note: planText(fee.note ?? "", "fees.note", 3e3, true)
    };
    const teachers = {
        ...oldModules.teachers,
        ...m.teachers
    };
    doc.modules.teachers = {
        visible: boolean(teachers.visible, oldModules.teachers.visible),
        teacher_ids: stringList(teachers.teacher_ids ?? [], "teacher_ids", 30)
    };
    if (new Set(doc.modules.teachers.teacher_ids).size !== doc.modules.teachers.teacher_ids.length) planValidation("老师不能重复", "teacher_ids");
    const about = {
        ...oldModules.about,
        ...m.about
    };
    doc.modules.about = {
        visible: boolean(about.visible, oldModules.about.visible, false),
        image_ids: stringList(about.image_ids ?? [], "image_ids", 50)
    };
    doc.applied_suggestion_ids = stringList(d.applied_suggestion_ids ?? old?.applied_suggestion_ids ?? [], "applied_suggestion_ids", 30);
    doc.computed = computePlan(doc);
    return {
        doc: doc,
        id_map: id_map,
        elements: writes,
        refs: refs,
        newLines: newLines
    };
}

export function planImages(doc, context, visibleOnly = false) {
    if(doc.doc_version===2)return [...new Set([...v2Images(doc,visibleOnly),...(doc.style.show_consultant&&context?.brand?.qr_image_id?[context.brand.qr_image_id]:[])])];
    const ids = [];
    if (!visibleOnly || doc.modules.cover.visible) if (doc.style.cover_image_id) ids.push(doc.style.cover_image_id);
    if (!visibleOnly || doc.modules.about.visible) ids.push(...doc.modules.about.image_ids);
    if (doc.style.show_consultant && context.brand.qr_image_id) ids.push(context.brand.qr_image_id);
    return [ ...new Set(ids) ];
}
