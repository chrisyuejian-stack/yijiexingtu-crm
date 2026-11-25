import { planValidation } from "./plan-math.js";

function monthNumber(month) {
    if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 2e3 || Number(month.slice(0, 4)) > 2100) planValidation("月份不正确", "month");
    return Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1;
}

const monthText = n => String(Math.floor(n / 12)).padStart(4, "0") + "-" + String(n % 12 + 1).padStart(2, "0");

const lastDay = n => new Date(Date.UTC(Math.floor(n / 12), n % 12 + 1, 0)).toISOString().slice(0, 10);

// Only returns a proposal. IDs remain temporary until the normal PUT assigns durable IDs.
export function buildSkeleton({start_month: start_month, target: target, options: options = {}}, types, rules, calendar, context = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options) || (options.insert_holiday_camp !== undefined && typeof options.insert_holiday_camp !== "boolean")) planValidation("options格式不正确","options");
    const start = monthNumber(start_month), end = monthNumber(target?.month);
    if (end < start || end - start >= 120) planValidation("目标月份须在起始月后的120个月内", "target.month");
    const active = types.filter(x => x.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id));
    if (!active.length) planValidation("请先配置启用的阶段类型", "stage_types", "out_of_scope");
    const nodes = calendar.items || [], candidates = [];
    const fallback = active.find(s => s.anchor === "normal") || active[0];
    for (const type of active) {
        const duration = type.default_months?.min || 1;
        if (type.anchor === "start") {
            candidates.push({
                type: type,
                start: start,
                end: start + duration - 1,
                priority: 90,
                tags: []
            });
            continue;
        }
        if (type.anchor === "normal") {
            if (rules.art_transition_stage && context.subject === "art_interest" && context.age >= 8 && context.age <= 10 && /过渡/.test(type.name)) candidates.push({
                type: type,
                start: start + 1,
                end: start + duration,
                priority: 95,
                tags: []
            });
            continue;
        }
        let matched = nodes.filter(n => n.key === type.anchor_node);
        if (type.anchor === "on_node" && type.anchor_node?.includes("camp")) {
            if (!(options.insert_holiday_camp ?? rules.insert_holiday_camp)) continue;
            matched = nodes.filter(n => n.key.includes("camp"));
        }
        if (type.anchor === "before_node" && type.anchor_node === "grade_exam" && !rules.exam_sprint_before_grade) continue;
        for (const node of matched) {
            const occurrences = [];
            if (node.key === target.node_key) occurrences.push(end); else for (let year = Math.floor(start / 12) - 1; year <= Math.floor(end / 12) + 1; year++) for (const m of node.months) occurrences.push(year * 12 + m - 1);
            for (const at of [ ...new Set(occurrences) ]) {
                let from = at + (type.offset_months || 0), to = from + duration - 1;
                if (type.anchor === "before_node") to = Math.min(to, at - 1);
                if (type.anchor === "after_node") from = Math.max(from, at + 1), to = from + duration - 1;
                if (type.anchor === "on_node" && node.key.includes("camp")) {
                    const year = Math.floor(at / 12);
                    from = year * 12 + Math.min(...node.months) - 1;
                    to = year * 12 + Math.max(...node.months) - 1;
                }
                if (to < start || from > end) continue;
                candidates.push({
                    type: type,
                    start: from,
                    end: to,
                    priority: type.anchor === "before_node" ? 100 : 80,
                    tags: [ node.key ]
                });
            }
        }
    }
    const assignments = [];
    for (let month = start; month <= end; month++) {
        const selected = candidates.filter(c => month >= c.start && month <= c.end).sort((a, b) => b.priority - a.priority || (a.type.order || 0) - (b.type.order || 0))[0];
        assignments.push({
            month: month,
            type: selected?.type || fallback,
            tags: selected?.tags || []
        });
    }
    const groups = [];
    for (const x of assignments) {
        const last = groups.at(-1), max = x.type.default_months?.max || 120;
        if (last && last.type.id === x.type.id && last.tags.join() === x.tags.join() && x.month - last.start < max) last.end = x.month; else groups.push({
            ...x,
            start: x.month,
            end: x.month
        });
    }
    return {
        stages: groups.map((g, i) => ({
            key: "tmp_stage_" + (i + 1),
            stage_type_id: g.type.id,
            name: g.type.name,
            start: monthText(g.start) + "-01",
            end: lastDay(g.end),
            teaching_weeks: null,
            weeks_note: "",
            goals: [ ...rules.art_exam_end_after_school_exam && target.node_key === "school_exam" && i === groups.length - 1 ? [ "校考后文化课冲刺由学校或合作机构负责，本方案不再排课" ] : [], ...rules.mock_exam_schedule ? [ g.tags.includes("unified_exam") ? "统考冲刺期每月安排1次模拟考" : "阶段末安排1次模拟考" ] : [] ],
            // Advisor guidance belongs only to the skeleton proposal, never parent-facing goals.
            hints: rules.exam_sprint_before_grade && g.type.anchor === "before_node" && g.type.anchor_node === "grade_exam" ? [ "选课时加入冲刺课程，课程与数量由顾问确认" ] : [],
            node_tags: g.tags
        }))
    };
}
