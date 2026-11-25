import {validateSamplePlans} from './plan-v2-samples.js';
import { invalid, text, object, list, ids } from "./content-document.js";

import { stageRuleKeys, subjectPacks } from "./subject-packs.js";

import { planDate } from "./plan-math.js";

export const docTypes = [ "plan", "report", "feedback_card", "article" ];

export const stableKey = (v, field = "key") => {
    text(v, field, 80, false);
    if (!/^[a-z][a-z0-9_-]{0,79}$/.test(v)) invalid("稳定key格式不正确", field);
    return v;
};

export function packVersion(v) {
    text(v, "pack_version", 50, false);
    if (!/^\d+\.\d+(?:\.\d+)?(?:-[a-z0-9.-]+)?$/.test(v)) invalid("版本号格式不正确", "pack_version");
    return v;
}

const str = (v, f, max = 200) => text(v, f, max, false), bool = (v, f) => {
    if (typeof v !== "boolean") invalid("须为布尔值", f);
    return v;
};

const integer = (v, f, min, max) => {
    if (!Number.isInteger(v) || v < min || v > max) invalid("整数范围不正确", f);
    return v;
};

const unique = (values, f) => {
    if (new Set(values).size !== values.length) invalid("不能重复", f);
};

function keyed(v, f, max) {
    const rows = list(v, f, max);
    unique(rows.map(x => stableKey(object(x, f).key, f + ".key")), f);
    unique(rows.map(x => str(x.name, f + ".name")), f + ".name");
    return rows;
}

function rejectIds(v, depth = 0) {
    if (depth > 20) invalid("模板嵌套过深", "content");
    if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
            if (/(?:^|_)id$/.test(k) || [ "tenant_id", "course_type_id", "stage_type_id", "course_id", "created_by", "id", "amount", "price_cents", "computed", "snapshot" ].includes(k)) invalid("模板不能带机构ID", k);
            rejectIds(x, depth + 1);
        }
    }
}

export function subjectContent(raw,subjectKey=null) {
    object(raw, "content");
    const {sample_plans:samplePlans,...legacy}=raw;
    rejectIds(legacy);
    const d = structuredClone(legacy);
    for (const key of [ "courses", "stages", "rules", "calendar", "course_rules", "classes", "content_types", "constraints", "tone" ]) if (d[key] === undefined) invalid("模板字段不完整", "content." + key);
    for (const c of keyed(d.courses, "courses", 200)) {
        str(c.group, "group");
        if (![ "one_to_one", "group", "small_class", "package", "camp" ].includes(c.form)) invalid("课程形式不正确", "form");
        if (c.pricing !== null) invalid("平台模板不含价格", "pricing");
        if (c.minutes !== null) integer(c.minutes, "minutes", 15, 480);
        if (c.duration_text !== null) str(c.duration_text, "duration_text", 100);
        if (c.minutes === null && !c.duration_text) invalid("请填写时长", "minutes");
        bool(c.active, "active");
        if (c.optional !== undefined) bool(c.optional, "optional");
    }
    const nodes = keyed(d.calendar, "calendar", 100);
    // months are numbers, not IDs.
        for (const n of nodes) {
        list(n.months, "months", 12);
        if (!n.months.length) invalid("月份不能为空", "months");
        unique(n.months, "months");
        n.months.forEach(x => integer(x, "months", 1, 12));
        if (n.exact_date !== undefined && n.exact_date !== null) planDate(n.exact_date);
        if (n.next_year !== undefined) bool(n.next_year, "next_year");
        if (n.note !== undefined) text(n.note, "note", 1e3);
    }
    const nodeKeys = new Set(nodes.map(n => n.key));
    for (const s of keyed(d.stages, "stages", 100)) {
        object(s.default_months, "default_months");
        integer(s.default_months.min, "min", 1, 120);
        integer(s.default_months.max, "max", s.default_months.min, 120);
        if (![ "start", "normal", "on_node", "before_node", "after_node" ].includes(s.anchor)) invalid("阶段锚点不正确", "anchor");
        if (([ "on_node", "before_node", "after_node" ].includes(s.anchor) || s.anchor_node !== null) && !nodeKeys.has(s.anchor_node)) invalid("阶段节点不存在", "anchor_node");
        integer(s.offset_months, "offset_months", -120, 120);
        bool(s.active, "active");
    }
    object(d.rules, "rules");
    if (Object.keys(d.rules).length !== 5 || Object.keys(d.rules).some(k => !stageRuleKeys.includes(k))) invalid("必须包含五个阶段规则", "rules");
    for (const k of stageRuleKeys) bool(d.rules[k], k);
    const courses = new Set(d.courses.map(x => x.key)), stages = new Set(d.stages.map(x => x.key)), seen = new Set;
    for (const r of list(d.course_rules, "course_rules", 100)) {
        object(r, "course_rules");
        if (!stages.has(r.stage_key) || seen.has(r.stage_key)) invalid("阶段引用不存在或重复", "stage_key");
        seen.add(r.stage_key);
        for (const name of [ "required", "recommended" ]) for (const key of ids(r[name], name, 100)) if (!courses.has(key)) invalid("课程引用不存在", name);
        for (const group of list(r.exclusive, "exclusive", 100)) for (const key of ids(group, "exclusive", 100)) if (!courses.has(key)) invalid("互斥课程不存在", "exclusive");
        object(r.units, "units");
        integer(r.units.min, "units.min", 0, 1e5);
        integer(r.units.max, "units.max", r.units.min, 1e5);
    }
    for (const c of keyed(d.classes, "classes", 100)) {
        const dims = keyed(c.dimensions, "dimensions", 30);
        if (!dims.length) invalid("班型缺少维度", "dimensions");
        for (const dim of dims) {
            integer(dim.order, "order", 0, 1e4);
            ids(dim.feedback_tags, "feedback_tags", 50);
        }
        object(c.options, "options");
        for (const k of [ "compare_previous", "mock_exam", "require_artwork", "renewal_suggestion" ]) bool(c.options[k], k);
        if (c.options.stats !== undefined) {
            const stats = ids(c.options.stats, "stats", 3);
            if (stats.some(k => ![ "lessons", "attendance", "repertoire_done", "camp_days", "mock_count", "days_to_exam" ].includes(k) && !/^manual_[a-z0-9_]+$/.test(k))) invalid("统计项不正确", "stats");
        }
    }
    for (const c of list(d.content_types, "content_types", 100)) {
        str(c.name, "content_types.name");
        ids(c.required, "required", 100);
        ids(c.optional, "optional", 100);
    }
    object(d.constraints, "constraints");
    ids(d.constraints.prohibited_terms, "prohibited_terms", 200);
    for (const k of [ "policy_source", "student_privacy", "report_basis" ]) str(d.constraints[k], k, 2e3);
    str(d.tone, "tone", 1e3);
    if(samplePlans!==undefined){d.sample_plans=validateSamplePlans(samplePlans,d);if(subjectKey&&d.sample_plans.some(x=>x.doc.subject!==subjectKey))invalid('方案示例须与所属学科一致','sample_plans');}
    return d;
}

export function subjectInput(d) {
    object(d, "body");
    if (!Object.hasOwn(subjectPacks, d.key)) invalid("学科未开放", "key");
    return {
        key: d.key,
        name: str(d.name ?? subjectPacks[d.key].name, "name", 100),
        pack_version: packVersion(d.pack_version),
        content: subjectContent(d.content,d.key)
    };
}
