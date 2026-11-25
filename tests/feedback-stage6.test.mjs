import test, { after } from "node:test";

import assert from "node:assert/strict";

import { growthSchool, call, ok, parent, submitFeedback, confirmFeedback } from "./fixtures-growth.mjs";

test("YX6F 结构化反馈待确认不扣课、不公开，确认后家长可见；新点评待审仍看旧版", () => growthSchool(async s => {
    const pa = await parent(s), before = s.f.db.raw.prepare("SELECT COUNT(*) n FROM package_transactions").get().n, p = ok(await submitFeedback(s));
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM package_transactions").get().n, before);
    assert.equal(ok(await call(s, "parent/children/" + s.students[0] + "/feed", "GET", undefined, pa.token)).items.length, 0);
    ok(await call(s, "feedback/" + p.id + "/" + s.students[0] + "/copied", "POST", {}, s.teacherAccount.token), 409);
    ok(await confirmFeedback(s, p.id));
    ok(await call(s, "feedback/" + p.id + "/" + s.students[0] + "/copied", "POST", {}, s.teacherAccount.token));
    const reviewed = ok(await call(s, "lessons/" + s.lid + "/review", "GET", undefined, s.teacherAccount.token));
    assert.equal(reviewed.personal.find(x => x.student_id === s.students[0]).copied_count, 1);
    let feed = ok(await call(s, "parent/children/" + s.students[0] + "/feed", "GET", undefined, pa.token));
    assert.equal(feed.items[0].message.good, "节奏稳定");
    const q = ok(await submitFeedback(s, {
        kind: "comments",
        extra: {
            personal: [ {
                student_id: s.students[0],
                message: {
                    good: "新点评"
                },
                tags: [],
                repertoire_ids: [],
                image_ids: []
            } ]
        }
    }));
    feed = ok(await call(s, "parent/children/" + s.students[0] + "/feed", "GET", undefined, pa.token));
    assert.equal(feed.items[0].message.good, "节奏稳定");
    ok(await call(s, "feedback/" + p.id + "/" + s.students[0] + "/copied", "POST", {}, s.teacherAccount.token));
    ok(await confirmFeedback(s, q.id, "return"));
    assert.equal(ok(await call(s, "parent/children/" + s.students[0] + "/feed", "GET", undefined, pa.token)).items[0].message.good, "节奏稳定");
}));

test("YX6F 自动确认同事务扣课，失败回滚不发布；别名冲突422、老师当日课", () => growthSchool(async s => {
    ok(await call(s, "settings", "PUT", {
        key: "feedback_auto_confirm",
        value: true
    }));
    const today = ok(await call(s, "feedback/today", "GET", undefined, s.teacherAccount.token));
    assert.equal(today.items.length, 1);
    ok(await submitFeedback(s, {
        extra: {
            public_comment: "冲突"
        }
    }), 422);
    const p = ok(await submitFeedback(s));
    const db = s.f.db.raw;
    assert.equal(db.prepare("SELECT status FROM lesson_submissions WHERE tenant_id=? AND id=?").get(s.t.id, p.id).status, "confirmed");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM growth_feedback WHERE tenant_id=? AND status='confirmed'").get(s.t.id).n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM lesson_participants WHERE tenant_id=? AND deducted=1").get(s.t.id).n, 2);
}));

test("YX6F 缺省personal保持旧纯文字提交，旧确认可复制并进入时间线", () => growthSchool(async s => {
    const pa = await parent(s), p = ok(await submitFeedback(s, {
        personal: false
    }));
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM growth_feedback WHERE status='confirmed'").get().n, 0);
    ok(await confirmFeedback(s, p.id));
    const feed = ok(await call(s, "parent/children/" + s.students[0] + "/feed", "GET", undefined, pa.token));
    assert.equal(feed.items.length, 1);
    assert.ok(feed.items[0].message.learned.includes("节奏稳定"));
    ok(await call(s, "feedback/" + p.id + "/" + s.students[0] + "/copied", "POST", {}, s.teacherAccount.token));
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM growth_feedback_copies").get().n, 1);
}));

test("YX6F 出勤别名冲突422、缺people按旧校验拒绝，外机构曲目/图不能进入提交", () => growthSchool(async s => {
    ok(await submitFeedback(s, {
        extra: {
            attendance: [ {
                student_id: s.students[0],
                status: "student_no_show"
            } ]
        }
    }), 422);
    const v = ok(await call(s, "lessons/" + s.lid + "/review", "GET", undefined, s.teacherAccount.token));
    ok(await call(s, "lessons/" + s.lid + "/review", "POST", {
        operation_id: "op_" + crypto.randomUUID(),
        kind: "attendance",
        previous_id: null,
        comment_fingerprint: v.comment_fingerprint,
        attendance: [ {
            student_id: s.students[0],
            status: "attended"
        } ]
    }, s.teacherAccount.token), 400);
    ok(await submitFeedback(s, {
        extra: {
            personal: [ {
                student_id: s.students[0],
                repertoire_ids: [ "foreign" ],
                message: {
                    good: "好"
                }
            } ]
        }
    }), 404);
    ok(await submitFeedback(s, {
        extra: {
            personal: [ {
                student_id: s.students[0],
                image_ids: [ "foreign" ],
                message: {
                    good: "好"
                }
            } ]
        }
    }), 404);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM lesson_submissions").get().n, 0);
}));

test("YX6F 自动确认全体欠课受阻仍待审，部分受阻只公开实际确认者", () => growthSchool(async s => {
    const {mutate: mutate} = await import("./fixtures-credit.mjs");
    for (const id of s.students) ok(await mutate(s, "credits/adjust", {
        package_id: s.f.db.raw.prepare("SELECT id FROM packages WHERE student_id=? AND tenant_id=?").get(id, s.t.id).id,
        delta: -20,
        reason: "测试耗尽"
    }));
    ok(await call(s, "settings", "PUT", {
        key: "max_debt_units",
        value: 0
    }));
    ok(await call(s, "settings", "PUT", {
        key: "feedback_auto_confirm",
        value: true
    }));
    const p = ok(await submitFeedback(s));
    assert.equal(p.committed, false);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM growth_feedback WHERE status='confirmed'").get().n, 0);
    ok(await call(s, "feedback/" + p.id + "/" + s.students[0] + "/copied", "POST", {}, s.teacherAccount.token), 409);
}));

test("YX6F 助教只读、开关仅主管，事务失败没有半份结构化数据", () => growthSchool(async s => {
    const {teacherToken: teacherToken} = await import("./fixtures-mobile.mjs");
    const id = await s.create("teachers", {
        name: "助教"
    }), assistant = await teacherToken(s, id), lesson = await s.r.businessGet("lessons", s.lid);
    ok(await call(s, "data/lessons/" + s.lid, "PATCH", {
        version: lesson.version,
        assistant_id: id
    }));
    ok(await submitFeedback(s, {
        token: assistant.token
    }), 403);
    ok(await call(s, "settings", "PUT", {
        key: "feedback_auto_confirm",
        value: true
    }, s.academic.token), 403);
    s.f.db.raw.exec("CREATE TRIGGER growth_test_fault BEFORE UPDATE OF personal_json ON lesson_submissions BEGIN SELECT RAISE(ABORT,'local_fault'); END");
    ok(await submitFeedback(s), 500);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM lesson_submissions").get().n, 0);
    assert.equal(s.f.db.raw.prepare("SELECT current_submission_id FROM lessons WHERE id=?").get(s.lid).current_submission_id, null);
}));

test("YX6F 自动确认部分受阻，公共点评也不能变成受阻孩子的已确认反馈", () => growthSchool(async s => {
    const {mutate: mutate} = await import("./fixtures-credit.mjs");
    ok(await mutate(s, "credits/adjust", {
        package_id: s.f.db.raw.prepare("SELECT id FROM packages WHERE student_id=? AND tenant_id=?").get(s.students[0], s.t.id).id,
        delta: -20,
        reason: "耗尽一位"
    }));
    ok(await call(s, "settings", "PUT", {
        key: "max_debt_units",
        value: 0
    }));
    ok(await call(s, "settings", "PUT", {
        key: "feedback_auto_confirm",
        value: true
    }));
    const pa = await parent(s), result = ok(await submitFeedback(s));
    assert.equal(result.blocked.length, 1);
    assert.equal(ok(await call(s, "parent/children/" + s.students[0] + "/feed", "GET", undefined, pa.token)).items.length, 0);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM growth_feedback WHERE status='confirmed'").get().n, 1);
    ok(await call(s, "feedback/" + result.id + "/" + s.students[0] + "/copied", "POST", {}, s.teacherAccount.token), 409);
}));

test("YX6F 相同操作重放不重复提交，修改内容复用操作号仍冲突", () => growthSchool(async s => {
    const {examples: examples} = await import("./fixtures-plans.mjs");
    const response = ok(await submitFeedback(s));
    const item = examples.findLast(x => x.request.method === "POST" && x.request.path.endsWith("/review"));
    assert.deepEqual(ok(await call(s, "lessons/" + s.lid + "/review", "POST", item.request.body, s.teacherAccount.token)), response);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM lesson_submissions").get().n, 1);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM growth_feedback").get().n, 2);
    ok(await call(s, "lessons/" + s.lid + "/review", "POST", {
        ...item.request.body,
        public_text: "不同"
    }, s.teacherAccount.token), 409);
}));

test("YX6F 普通点评也能替换旧结构化版本，窗口外员工更正不重新扣课", () => growthSchool(async s => {
    const pa = await parent(s), first = ok(await submitFeedback(s));
    ok(await confirmFeedback(s, first.id));
    const second = ok(await submitFeedback(s, {
        kind: "comments",
        personal: false,
        extra: {
            people: ok(await call(s, "lessons/" + s.lid + "/review", "GET", undefined, s.teacherAccount.token)).participants.map(x => ({
                participant_id: x.id,
                student_id: x.student_id,
                comment: "纯文字新版"
            }))
        }
    }));
    ok(await confirmFeedback(s, second.id));
    assert.equal(ok(await call(s, "parent/children/" + s.students[0] + "/feed", "GET", undefined, pa.token)).items[0].message.learned, "纯文字新版");
    const count = s.f.db.raw.prepare("SELECT COUNT(*) n FROM package_transactions").get().n, v = ok(await call(s, "lessons/" + s.lid + "/review"));
    ok(await call(s, "lessons/" + s.lid + "/comments", "PUT", {
        operation_id: "op_" + crypto.randomUUID(),
        comment_fingerprint: v.comment_fingerprint,
        public_text: "员工更正",
        people: v.participants.map(x => ({
            participant_id: x.id,
            student_id: x.student_id,
            comment: "纯文字新版"
        })),
        personal: [ {
            student_id: s.students[0],
            message: {
                good: "员工确认的新版本"
            }
        } ]
    }));
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM package_transactions").get().n, count);
    assert.equal(ok(await call(s, "parent/children/" + s.students[0] + "/feed", "GET", undefined, pa.token)).items[0].message.good, "员工确认的新版本");
}));

test("YX6F 关闭成长模块不破坏原纯文字出勤流程，结构化入口返回404", () => growthSchool(async s => {
    s.f.db.raw.prepare("UPDATE tenant_modules SET enabled=0 WHERE tenant_id=? AND id='growth_reports'").run(s.t.id);
    ok(await submitFeedback(s), 404);
    const old = ok(await submitFeedback(s, {
        personal: false
    }));
    ok(await confirmFeedback(s, old.id));
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM growth_feedback").get().n, 0);
    ok(await call(s, "feedback/today", "GET", undefined, s.teacherAccount.token), 404);
}));

import { mkdir, writeFile } from "node:fs/promises";

import { examples } from "./fixtures-plans.mjs";

after(async () => {
    await mkdir("work/stage6", {
        recursive: true
    });
    await writeFile("work/stage6/feedback-http-" + (process.env.TEST_BUNDLE === "1" ? "bundle" : "source") + ".json", JSON.stringify({
        local_only: true,
        examples: examples
    }, null, 2));
});

test("YX6F 自动确认后点评可更新但出勤不能重提，不产生第二份销课", () => growthSchool(async s => {
    ok(await call(s, "settings", "PUT", {
        key: "feedback_auto_confirm",
        value: true
    }));
    const first = ok(await submitFeedback(s)), before = s.f.db.raw.prepare("SELECT COUNT(*) n FROM package_transactions").get().n;
    const second = ok(await submitFeedback(s, {
        kind: "comments",
        extra: {
            personal: [ {
                student_id: s.students[0],
                message: {
                    good: "新确认点评"
                }
            } ]
        }
    }));
    assert.equal(s.f.db.raw.prepare("SELECT status FROM lesson_submissions WHERE id=?").get(second.id).status, "confirmed");
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM package_transactions").get().n, before);
    ok(await submitFeedback(s), 409);
    const pa = await parent(s);
    assert.equal(ok(await call(s, "parent/children/" + s.students[0] + "/feed", "GET", undefined, pa.token)).items[0].message.good, "新确认点评");
}));
