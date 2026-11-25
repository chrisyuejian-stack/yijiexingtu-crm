import { HttpError } from "./core.js";

export function planValidation(message, field = "body", code = "validation_failed") {
    const error = new HttpError(422, message, code);
    error.details = {
        fields: [ {
            field: field,
            message: message
        } ]
    };
    throw error;
}

export function planDate(value, field = "date") {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + "T00:00:00Z")) || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value) planValidation("日期不正确", field);
    return Date.parse(value + "T00:00:00Z");
}

export function calendarWeeks(start, end) {
    const days = (planDate(end) - planDate(start)) / 864e5 + 1;
    if (days < 1) planValidation("阶段结束日期不能早于开始日期", "end");
    return Math.floor((2 * days + 7) / 14);
}

export function coveredMonths(start, end) {
    if (planDate(end) < planDate(start)) planValidation("阶段结束日期不能早于开始日期", "end");
    return (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(start.slice(5, 7)) + 1;
}

export function quantityHundredths(value, field = "qty") {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1e6 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) planValidation("数量须大于0，最多两位小数", field);
    return Math.round(value * 100);
}

export function planMoney(value, field = "amount") {
    if (value === null || value === undefined) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e8 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) planValidation("金额最多两位小数", field);
    return Math.round(value * 100);
}

export function centsProduct(cents, quantity) {
    const q = quantityHundredths(quantity), amount = Number((BigInt(cents) * BigInt(q) + 50n) / 100n);
    if (!Number.isSafeInteger(amount) || amount > 1e10) planValidation("方案金额超出支持范围", "qty");
    return amount;
}

export function allocateCents(total, ratios) {
    if (!Number.isSafeInteger(total) || total < 0 || !ratios.length || ratios.some(n => !Number.isInteger(n) || n < 1 || n > 1e4) || ratios.reduce((a, b) => a + b, 0) !== 1e4) planValidation("分期比例必须为1–10000整数，合计10000", "fees.custom");
    const rows = ratios.map((r, i) => {
        const product = BigInt(total) * BigInt(r);
        return {
            i: i,
            cents: Number(product / 10000n),
            remainder: Number(product % 10000n)
        };
    });
    let remaining = total - rows.reduce((n, r) => n + r.cents, 0);
    for (const row of [ ...rows ].sort((a, b) => b.remainder - a.remainder || a.i - b.i)) {
        if (!remaining) break;
        row.cents++;
        remaining--;
    }
    return rows.map(r => r.cents);
}

export const quantityKeys = {
    per_unit: "units",
    per_term: "terms",
    per_semester: "semesters",
    per_month: "months",
    package: "packages"
};

export function computePlan(doc) {
    const stages = doc.modules.path.stages.map(s => ({
        key: s.key,
        months: coveredMonths(s.start, s.end),
        calendar_weeks: calendarWeeks(s.start, s.end),
        teaching_weeks: s.teaching_weeks ?? null,
        weeks_display: s.teaching_weeks ?? calendarWeeks(s.start, s.end),
        units: 0,
        amount_cents: 0
    }));
    const byKey = new Map(stages.map(s => [ s.key, s ]));
    let total = 0, totalUnits = 0;
    const bundles = [], optional = [];
    for (const line of doc.modules.courses.lines) {
        const snapshot = line.snapshot, pricing = snapshot.pricing, key = quantityKeys[pricing.mode], q = line.qty[key];
        const amount = centsProduct(pricing.amount_cents, q);
        if (snapshot.optional) {
            optional.push({
                course_id: line.course_id,
                label: snapshot.name,
                price_text: "¥" + (pricing.amount_cents / 100).toFixed(2) + " / " + {
                    per_unit: "课时",
                    per_term: "期",
                    per_semester: "学期",
                    per_month: "月",
                    package: "包"
                }[pricing.mode]
            });
            continue;
        }
        const stage = byKey.get(line.stage_key);
        if (!stage) planValidation("课程行必须属于本方案阶段", "stage_key");
        stage.amount_cents += amount;
        total += amount;
        if (!Number.isSafeInteger(total) || total > 1e10) planValidation("方案总价超出支持范围", "courses");
        if (pricing.mode === "per_unit" || pricing.mode === "package") {
            const units = quantityHundredths(q) * (pricing.mode === "package" ? pricing.units_per_package : 1);
            totalUnits += units;
            stage.units += units;
        } else bundles.push(snapshot.name + " " + q + " " + {
            per_term: "期",
            per_semester: "学期",
            per_month: "月"
        }[pricing.mode]);
    }
    for (const stage of stages) stage.units /= 100;
    const fees = doc.modules.fees;
    let installments;
    if (fees.installments === "custom") {
        const values = allocateCents(total, fees.custom.map(x => x.ratio_bps));
        installments = fees.custom.map((x, i) => ({
            stage_key: x.stage_key,
            label: x.label,
            due: x.due,
            amount_cents: values[i]
        }));
    } else installments = stages.map((s, i) => ({
        stage_key: s.key,
        label: "第" + (i + 1) + "期 · " + doc.modules.path.stages[i].name,
        due: fees.due_dates[s.key] ?? null,
        amount_cents: s.amount_cents
    }));
    const cap = doc.meta.budget_cap_cents;
    const first = doc.modules.path.stages[0], last = doc.modules.path.stages.at(-1), months = first && last ? coveredMonths(first.start, last.end) : 0;
    return {
        stages: stages,
        total: {
            units: totalUnits / 100,
            bundles: bundles,
            amount_cents: total
        },
        budget: {
            cap_cents: cap,
            remaining_cents: cap === null ? null : cap - total,
            over: cap !== null && total > cap
        },
        installments: installments,
        optional_fees: optional,
        cover_numbers: [ {
            label: "规划周期",
            value: String(months),
            unit: "个月",
            sub: first && last ? first.start.slice(0, 7).replace("-", ".") + " – " + last.end.slice(0, 7).replace("-", ".") : ""
        } ]
    };
}

export function computedResponse(value) {
    if (Array.isArray(value)) return value.map(computedResponse);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, v]) => key.endsWith("_cents") ? [ key.slice(0, -6), v === null ? null : v / 100 ] : [ key, computedResponse(v) ]));
}
