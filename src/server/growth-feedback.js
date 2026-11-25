import { fail, randomId, now } from "./core.js";

import { invalid, text, object, ids, list } from "./content-document.js";

export function feedbackAliases(input) {
    const d = {
        ...input
    };
    if (d.public_comment !== undefined) {
        text(d.public_comment, "public_comment", 6e3);
        if (d.public_text !== undefined && d.public_text !== d.public_comment) invalid("公共点评别名不一致", "public_comment");
        d.public_text = d.public_comment;
    }
    if (d.attendance !== undefined && Array.isArray(d.people)) {
        const aliases = list(d.attendance, "attendance", 200), seen = new Set;
        for (const a of aliases) {
            if (!a || typeof a.student_id !== "string" || seen.has(a.student_id)) invalid("出勤别名重复或格式不正确", "attendance");
            seen.add(a.student_id);
            const p = d.people.find(x => x && x.student_id === a.student_id);
            if (!p) fail(404, "不存在", "not_found");
            if (p.attendance !== undefined && p.attendance !== a.status) invalid("出勤别名不一致", "attendance");
            p.attendance = a.status;
        }
    }
    return d;
}

export function feedbackMessage(v = {}) {
    object(v, "message");
    return Object.fromEntries([ "learned", "good", "attention", "homework" ].map(k => [ k, text(v[k] ?? "", "message." + k, 6e3) ]));
}

export async function feedbackPersonal(r, d, ctx, policy, oldRows = []) {
    if (d.personal === undefined && d.applied_suggestion_ids === undefined) return null;
    if (!policy.modules.growth_reports) fail(404, "不存在", "not_found");
    const applied = ids(d.applied_suggestion_ids ?? [], "applied_suggestion_ids", 30), seen = new Set;
    const personal = list(d.personal ?? [], "personal", 200).map(raw => {
        const x = object(raw, "personal");
        if (seen.has(x.student_id)) invalid("学员不能重复", "personal");
        seen.add(x.student_id);
        if (!ctx.participants.some(p => p.student_id === x.student_id)) fail(404, "不存在", "not_found");
        return {
            student_id: x.student_id,
            tags: ids(x.tags ?? [], "tags", 30),
            repertoire_ids: ids(x.repertoire_ids ?? [], "repertoire_ids", 100),
            note: text(x.note ?? "", "note", 12e3),
            message: feedbackMessage(x.message),
            image_ids: ids(x.image_ids ?? [], "image_ids", 30),
            applied_suggestion_ids: applied
        };
    });
    const rep = [ ...new Set(personal.flatMap(x => x.repertoire_ids)) ], images = [ ...new Set(personal.flatMap(x => x.image_ids)) ], refs = await r.growthFeedbackRefs(personal.map(x => x.student_id), rep, images, applied);
    if (refs.images.length !== images.length || refs.suggestions.length !== applied.length || refs.suggestions.some(x => x.kind !== "feedback.message")) fail(404, "不存在", "not_found");
    for (const x of personal) for (const id of x.repertoire_ids) if (!refs.repertoire.some(y => y.id === id && y.student_id === x.student_id)) fail(404, "不存在", "not_found");
    if (personal.some(p => p.image_ids.some(id => refs.images.some(x => x.id === id && x.hidden) && !oldRows.some(row => row.student_id === p.student_id && JSON.parse(row.doc_json).image_ids?.includes(id))))) invalid("新选照片已隐藏", "image_ids");
    return personal;
}

export function feedbackInserts(personal, record, submission, oldRows, publicText, homework, status = "pending", people = []) {
    if (!personal) return [];
    return people.map(person => {
        const given = personal.find(x => x.student_id === person.student_id), previous = oldRows.filter(x => x.student_id === person.student_id && x.status === "confirmed").sort((a, b) => b.seq - a.seq)[0], before = previous ? JSON.parse(previous.doc_json) : null;
        const unchanged = before && before.legacy_comment === person.comment;
        const x = given ? {
            ...given,
            structured: true
        } : unchanged ? {
            ...before
        } : {
            student_id: person.student_id,
            tags: [],
            repertoire_ids: [],
            note: person.comment || "",
            message: {
                learned: person.comment || "",
                good: "",
                attention: "",
                homework: homework || ""
            },
            image_ids: [],
            applied_suggestion_ids: [],
            structured: false
        };
        return {
            resource: "growth_feedback",
            growth_previous_image_ids: oldRows.filter(r => r.student_id === person.student_id).flatMap(r => JSON.parse(r.doc_json).image_ids || []),
            data: {
                id: randomId("fb"),
                lesson_id: record.id,
                submission_id: submission,
                student_id: person.student_id,
                seq: Math.max(0, ...oldRows.filter(y => y.student_id === person.student_id).map(y => y.seq)) + 1,
                doc_json: JSON.stringify({
                    ...x,
                    public_text: publicText,
                    homework: homework,
                    legacy_comment: person.comment || ""
                }),
                status: status,
                confirmed_at: status === "confirmed" ? now() : null,
                deleted_at: null
            }
        };
    });
}

export function feedbackDecisions(rows, submission, confirmed, blocked = []) {
    return rows.filter(x => x.submission_id === submission && x.status === "pending").map(row => ({
        resource: "growth_feedback",
        previous: row,
        data: {
            ...row,
            status: confirmed && !blocked.some(x => x.student_id === row.student_id) ? "confirmed" : "returned",
            confirmed_at: confirmed && !blocked.some(x => x.student_id === row.student_id) ? now() : null
        }
    }));
}

export function mergeReviewChanges(changes, lessonId, submissionId) {
    const combined = new Map;
    for (const c of changes) {
        const k = c.resource + ":" + c.data.id, old = combined.get(k);
        combined.set(k, old ? {
            ...old,
            data: {
                ...old.data,
                ...c.data
            }
        } : c);
    }
    const lesson = combined.get("lessons:" + lessonId);
    if (lesson && submissionId) lesson.data.current_submission_id = submissionId;
    return [ ...combined.values() ];
}
