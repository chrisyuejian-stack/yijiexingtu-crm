import { fixture } from "./support.mjs";

import { mobileSetup, MOBILE_NOW } from "./fixtures-mobile.mjs";

import { call, ok, seed, accountToken, parent } from "./fixtures-plans.mjs";

export { call, ok, seed, accountToken, parent };

export async function growthSchool(fn, count = 2) {
    const original = Date.now;
    Date.now = () => MOBILE_NOW;
    const f = await fixture();
    try {
        const s = await mobileSetup(f, count, "growth");
        s.f = f;
        s.academic = await accountToken(s, [ "academic" ]);
        await seed(s);
        s.reportClass = ok(await call(s, "settings/report-classes")).items[0];
        await fn(s);
    } finally {
        f.restore();
        Date.now = original;
    }
}

export async function submitFeedback(s, {kind: kind = "attendance", personal: personal = true, token: token = s.teacherAccount.token, extra: extra = {}} = {}) {
    const v = ok(await call(s, "lessons/" + s.lid + "/review", "GET", undefined, token));
    return call(s, "lessons/" + s.lid + "/review", "POST", {
        operation_id: "op_" + crypto.randomUUID(),
        kind: kind,
        previous_id: v.submission?.id || null,
        previous_version: v.submission?.version,
        comment_fingerprint: v.comment_fingerprint,
        public_text: "全班节奏练习",
        homework: "练习两遍",
        people: v.participants.map(p => ({
            participant_id: p.id,
            student_id: p.student_id,
            attendance: "attended",
            comment: "节奏稳定"
        })),
        ...personal ? {
            personal: v.participants.map(p => ({
                student_id: p.student_id,
                tags: [ "节奏稳定" ],
                repertoire_ids: [],
                note: "节奏稳定",
                message: {
                    learned: "节奏练习",
                    good: "节奏稳定",
                    attention: "句尾注意",
                    homework: "练习两遍"
                },
                image_ids: []
            }))
        } : {},
        ...extra
    }, token);
}

export async function confirmFeedback(s, id, action = "confirm") {
    return call(s, "submissions/" + id + "/" + action, "POST", {
        operation_id: "op_" + crypto.randomUUID(),
        version: 1,
        ...action === "return" ? {
            reason: "请补充"
        } : {}
    });
}

export async function batch(s, extra = {}) {
    return ok(await call(s, "report-batches", "POST", {
        name: "秋季报告",
        from: "2026-11-01",
        to: "2026-11-30",
        report_class_id: s.reportClass.id,
        teacher_id: s.teacher,
        student_ids: s.students,
        ...extra
    }), 201);
}

export async function readyDoc(s, row, token = s.academic.token) {
    return ok(await call(s, "reports/" + row.id, "PUT", {
        version: row.version,
        scores: row.dimensions_snapshot.map(x => ({
            key: x.key,
            value: 3,
            previous: 999
        })),
        texts: {
            progress: "节奏更稳定",
            focus: "注意句尾",
            teacher_note: "继续保持",
            next_goals: [ "练习下一首" ],
            home_practice: [ "每天练习" ]
        }
    }, token));
}
