import test, { after } from "node:test";

import assert from "node:assert/strict";

import { growthSchool, call, ok, batch, readyDoc, parent, accountToken, submitFeedback, confirmFeedback } from "./fixtures-growth.mjs";

import { mkdir, writeFile } from "node:fs/promises";

import { examples } from "./fixtures-plans.mjs";

test("YX6G 批次普通创建占位、未开始与版本，未分配班型整批拒绝", () => growthSchool(async s => {
    ok(await call(s, "report-batches", "POST", {
        name: "未配置",
        from: "2026-11-01",
        to: "2026-11-30",
        student_ids: s.students
    }), 422);
    const b = await batch(s);
    assert.equal(b.reports.length, 2);
    assert.equal(b.reports[0].progress, "not_started");
    assert.equal(b.reports[0].tenant_id, undefined);
    assert.equal(ok(await call(s, "report-batches")).items.length, 1);
    assert.equal(ok(await call(s, "report-batches")).items[0].reports.length, 2);
    let d = await readyDoc(s, b.reports[0]);
    assert.equal(d.progress, "draft");
    assert.ok(d.scores.every(x => x.previous === null));
    ok(await call(s, "reports/" + d.id, "PUT", {
        version: 1,
        texts: {
            focus: "冲突"
        }
    }, s.academic.token), 409);
}));

test("YX6G 发布指针与新工作稿分离、撤回留审计，家长只能看绑定孩子", () => growthSchool(async s => {
    const b = await batch(s), pa = await parent(s);
    let d = await readyDoc(s, b.reports[0]);
    d = ok(await call(s, "reports/" + d.id + "/ready", "POST", {}));
    ok(await call(s, "reports/" + d.id + "/return", "POST", {
        reason: ""
    }), 422);
    d = ok(await call(s, "reports/" + d.id + "/return", "POST", {
        reason: "请补充下一期目标"
    }));
    assert.equal(d.status, "draft");
    d = ok(await call(s, "reports/" + d.id + "/ready", "POST", {}));
    d = ok(await call(s, "reports/" + d.id + "/publish", "POST", {}));
    const shown = ok(await call(s, "parent/reports/" + d.id, "GET", undefined, pa.token));
    ok(await call(s, "parent/reports/" + d.id, "POST", {}, pa.token), 404);
    ok(await call(s, "parent/children/" + s.students[0] + "/feed", "POST", {}, pa.token), 404);
    assert.equal(shown.render_data.texts.progress, "节奏更稳定");
    d = ok(await call(s, "reports/" + d.id, "PUT", {
        version: d.version,
        texts: {
            progress: "工作稿的新内容"
        }
    }, s.academic.token));
    assert.equal(d.status, "draft");
    assert.equal(ok(await call(s, "parent/reports/" + d.id, "GET", undefined, pa.token)).render_data.texts.progress, "节奏更稳定");
    ok(await call(s, "parent/reports/" + b.reports[1].id, "GET", undefined, pa.token), 404);
    ok(await call(s, "reports/" + d.id + "/unpublish", "POST", {
        reason: "更新后重发"
    }));
    ok(await call(s, "parent/reports/" + d.id, "GET", undefined, pa.token), 404);
    assert.ok(s.f.db.raw.prepare("SELECT * FROM growth_notifications WHERE tenant_id=?").get(s.t.id));
}));

test("YX6G 老师直发默认关、启用后仍检查必填，财务仍只用统计报表", () => growthSchool(async s => {
    const b = await batch(s), id = b.reports[0].id;
    ok(await call(s, "reports/" + id + "/publish", "POST", {}, s.teacherAccount.token), 403);
    ok(await call(s, "settings", "PUT", {
        key: "teacher_can_publish_reports",
        value: true
    }));
    ok(await call(s, "reports/" + id + "/publish", "POST", {}, s.teacherAccount.token), 422);
    let d = await readyDoc(s, b.reports[0], s.teacherAccount.token);
    d = ok(await call(s, "reports/" + id + "/publish", "POST", {}, s.teacherAccount.token));
    assert.equal(d.status, "published");
    const finance = await accountToken(s, [ "finance" ]);
    ok(await call(s, "reports/" + id, "GET", undefined, finance.token), 403);
    ok(await call(s, "finance/report?month=2026-11", "GET", undefined, finance.token));
    s.f.db.raw.prepare("UPDATE tenant_modules SET enabled=0 WHERE tenant_id=? AND id='growth_reports'").run(s.t.id);
    ok(await call(s, "reports/" + id), 404);
    ok(await call(s, "finance/report?month=2026-11", "GET", undefined, finance.token));
}));

test("YX6G 曲目完成口径、只刷新crm_value而保留人工数值", () => growthSchool(async s => {
    let rep = ok(await call(s, "students/" + s.students[0] + "/repertoire", "POST", {
        name: "小步舞曲",
        status: "learning",
        start_date: "2026-11-01"
    }, s.teacherAccount.token), 201);
    rep = ok(await call(s, "students/" + s.students[0] + "/repertoire", "PUT", {
        id: rep.id,
        version: rep.version,
        status: "done",
        completed_date: "2026-11-03"
    }, s.teacherAccount.token));
    assert.equal(ok(await call(s, "students/" + s.students[0] + "/repertoire", "GET", undefined, s.teacherAccount.token)).items[0].status, "done");
    assert.equal(rep.tenant_id, undefined);
    const submitted = ok(await submitFeedback(s));
    ok(await confirmFeedback(s, submitted.id));
    const b = await batch(s);
    let d = ok(await call(s, "reports/" + b.reports[0].id));
    assert.equal(d.stats.lessons.value, 1);
    assert.equal(d.stats.attendance.value, 1);
    assert.equal(d.stats.repertoire_done.value, 1);
    d = ok(await call(s, "reports/" + d.id, "PUT", {
        version: d.version,
        stats: {
            lessons: {
                value: 99,
                crm_value: 999
            }
        }
    }, s.teacherAccount.token));
    assert.equal(d.stats.lessons.crm_value, 1);
    d = ok(await call(s, "reports/" + d.id + "/refresh-crm", "POST", {}, s.teacherAccount.token));
    assert.equal(d.stats.lessons.value, 99);
    assert.equal(d.stats.lessons.crm_value, 1);
}));

after(async () => {
    await mkdir("work/stage6", {
        recursive: true
    });
    await writeFile("work/stage6/growth-http-" + (process.env.TEST_BUNDLE === "1" ? "bundle" : "source") + ".json", JSON.stringify({
        local_only: true,
        examples: examples
    }, null, 2));
});

test("YX6G 维度和班型选项锁快照，上一期按稳定key取已发布且排除撤回", () => growthSchool(async s => {
    let one = await batch(s, {
        from: "2026-09-01",
        to: "2026-09-30"
    }), d = await readyDoc(s, one.reports[0]);
    ok(await call(s, "reports/" + d.id + "/ready", "POST", {}));
    ok(await call(s, "reports/" + d.id + "/publish", "POST", {}));
    const cls = ok(await call(s, "settings/report-classes")).items.find(x => x.id === s.reportClass.id), oldName = cls.dimensions[0].name;
    ok(await call(s, "settings/report-classes", "PUT", {
        ...cls,
        dimensions: cls.dimensions.map((x, i) => ({
            ...x,
            name: i ? "维度" + i : "新名字"
        }))
    }));
    const two = await batch(s, {
        from: "2026-10-01",
        to: "2026-10-31"
    }), q = await readyDoc(s, two.reports[0]);
    assert.equal(q.scores[0].previous, 3);
    assert.equal(q.dimensions_snapshot[0].name, "新名字");
    assert.equal(ok(await call(s, "reports/" + d.id)).dimensions_snapshot[0].name, oldName);
    ok(await call(s, "reports/" + d.id + "/unpublish", "POST", {
        reason: "撤回上一期"
    }));
    assert.equal(ok(await call(s, "reports/" + q.id)).scores[0].previous, null);
}));

test("YX6G 集训只按显式排课映射、同日只算一天、配置/精确考期与报告快照", () => growthSchool(async s => {
    const cls = s.reportClass;
    ok(await call(s, "settings/report-classes", "PUT", {
        ...cls,
        options: {
            ...cls.options,
            stats: [ "camp_days", "mock_count", "days_to_exam" ]
        }
    }));
    let calendar = ok(await call(s, "settings/calendar"));
    calendar.items.push({
        key: "unified_exam",
        name: "统考",
        months: [ 12 ],
        exact_date: "2026-12-01"
    });
    ok(await call(s, "settings/calendar", "PUT", calendar));
    const {course: course} = await import("./fixtures-plans.mjs");
    await course(s, "名称普通但显式集训", 100, "per_unit", {
        form: "camp",
        course_type_id: s.type
    });
    const sub = ok(await submitFeedback(s));
    ok(await confirmFeedback(s, sub.id));
    const {lesson: lesson, status: status} = await import("./fixtures-credit.mjs");
    const extra = await lesson(s, "2026-11-10T09:00");
    ok(await status(s, extra, "completed"));
    const b = await batch(s);
    let d = ok(await call(s, "reports/" + b.reports[0].id));
    assert.equal(d.stats.camp_days.value, 1);
    assert.equal(d.stats.days_to_exam, undefined);
    assert.equal(d.stats.mock_count.value, 0);
    const courses = ok(await call(s, "settings/courses")).items;
    const camp = courses.find(x => x.name === "名称普通但显式集训");
    ok(await call(s, "settings/courses/" + camp.id, "DELETE", {
        version: camp.version
    }));
    d = ok(await call(s, "reports/" + d.id + "/refresh-crm", "POST", {}, s.teacherAccount.token));
    assert.equal(d.stats.camp_days.crm_value, 1);
    d = await readyDoc(s, d);
    d = ok(await call(s, "reports/" + d.id + "/ready", "POST", {}));
    d = ok(await call(s, "reports/" + d.id + "/publish", "POST", {}));
    assert.equal(d.stats.days_to_exam.value, 21);
    const fresh = await batch(s);
    assert.ok(fresh.reports[0].stats.camp_days);
}));

test("YX6G 校验伪造分数/previous/统计、模拟考满分、只读数字不被覆盖", () => growthSchool(async s => {
    const b = await batch(s), row = b.reports[0];
    for (const value of [ 0, 6, 2.5 ]) ok(await call(s, "reports/" + row.id, "PUT", {
        version: row.version,
        scores: [ {
            key: row.dimensions_snapshot[0].key,
            value: value
        } ]
    }, s.teacherAccount.token), 422);
    ok(await call(s, "reports/" + row.id, "PUT", {
        version: row.version,
        mock_exams: [ {
            month: "2026-11",
            items: [ {
                subject: "色彩",
                score: 101,
                full: 100
            } ]
        } ]
    }, s.teacherAccount.token), 422);
    ok(await call(s, "reports/" + row.id, "PUT", {
        version: row.version,
        scores: [ {
            key: "foreign",
            value: 3
        } ]
    }, s.teacherAccount.token), 422);
    const d = await readyDoc(s, row);
    assert.ok(d.scores.every(x => x.previous === null));
    ok(await call(s, "reports/" + d.id + "/ready", "POST", {}));
    const result = ok(await call(s, "report-batches/" + b.batch.id + "/publish", "POST", {
        report_ids: b.reports.map(x => x.id)
    }));
    assert.equal(result.published.length, 1);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].reason, "not_ready");
}));

test("YX6G 不同机构所有成长资源统一404，老师不能看他人，员工可分配", () => growthSchool(async s => {
    const {setup: setup} = await import("./fixtures-credit.mjs"), other = await setup(s.f, 1, "growth-other");
    other.f = s.f;
    const b = await batch(s);
    for (const method of [ "GET", "PUT", "POST" ]) {
        const endpoint = "reports/" + b.reports[0].id + (method === "POST" ? "/ready" : "");
        ok(await call(other, endpoint, method, method === "GET" ? undefined : {
            version: 1
        }), 404);
    }
    ok(await call(other, "report-batches/" + b.batch.id + "/publish", "POST", {
        report_ids: [ b.reports[0].id ]
    }), 404);
    ok(await call(other, "students/" + s.students[0] + "/repertoire"), 404);
    const {teacherToken: teacherToken} = await import("./fixtures-mobile.mjs");
    const id = await s.create("teachers", {
        name: "另一主讲"
    }), who = await teacherToken(s, id);
    ok(await call(s, "reports/" + b.reports[0].id, "GET", undefined, who.token), 404);
    const unassigned = await batch(s, {
        teacher_id: null
    });
    ok(await call(s, "reports/" + unassigned.reports[0].id, "GET", undefined, s.teacherAccount.token), 404);
    let row = ok(await call(s, "reports/" + unassigned.reports[0].id, "PUT", {
        version: 1,
        teacher_id: s.teacher
    }, s.academic.token));
    assert.equal(ok(await call(s, "reports/" + row.id, "GET", undefined, s.teacherAccount.token)).teacher_id, s.teacher);
}));

test("YX6G 报告图片绑定已发布修订、未授权不显示，跨孩子媒体404", () => growthSchool(async s => {
    await s.r.settingsGalleryCreate({
        id: "img_report",
        r2_key: "local/report.png",
        mime: "image/png",
        width: 1,
        height: 1,
        tags: [],
        consent: true
    }, s.user);
    await s.f.env.CHANNEL_MEDIA.put("local/report.png", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw1kAAAAASUVORK5CYII=");
    const b = await batch(s), pa = await parent(s);
    let row = await readyDoc(s, b.reports[0]);
    row = ok(await call(s, "reports/" + row.id, "PUT", {
        version: row.version,
        artwork_image_ids: [ "img_report" ]
    }, s.teacherAccount.token));
    ok(await call(s, "reports/" + row.id + "/ready", "POST", {}));
    ok(await call(s, "reports/" + row.id + "/publish", "POST", {}));
    assert.deepEqual(ok(await call(s, "parent/reports/" + row.id, "GET", undefined, pa.token)).render_data.artwork_image_ids, []);
    ok(await call(s, "parent/media/img_report", "GET", undefined, pa.token), 404);
    s.f.db.raw.prepare("UPDATE students SET parent_consent_media=1 WHERE tenant_id=? AND id=?").run(s.t.id, s.students[0]);
    assert.equal((await call(s, "parent/media/img_report", "GET", undefined, pa.token)).status, 200);
    const other = await accountToken(s, [ "student" ], s.students[1]);
    ok(await call(s, "parent/media/img_report", "GET", undefined, other.token), 404);
}));

test("YX6G 成长报告头图须遵循家长展示同意，未授权不返回URL且媒体404", () => growthSchool(async s => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw1kAAAAASUVORK5CYII=";
    await s.r.settingsGalleryCreate({
        id: "img_header",
        r2_key: "local/header.png",
        mime: "image/png",
        width: 1,
        height: 1,
        tags: [],
        consent: true
    }, s.user);
    await s.r.settingsGalleryCreate({
        id: "img_report",
        r2_key: "local/report.png",
        mime: "image/png",
        width: 1,
        height: 1,
        tags: [],
        consent: true
    }, s.user);
    await s.f.env.CHANNEL_MEDIA.put("local/header.png", png);
    await s.f.env.CHANNEL_MEDIA.put("local/report.png", png);
    const b = await batch(s), pa = await parent(s), other = await accountToken(s, [ "student" ], s.students[1]);
    let row = await readyDoc(s, b.reports[0]);
    row = ok(await call(s, "reports/" + row.id, "PUT", {
        version: row.version,
        artwork_image_ids: [ "img_report" ],
        style: {
            header_image_id: "img_header"
        }
    }, s.teacherAccount.token));
    ok(await call(s, "reports/" + row.id + "/ready", "POST", {}));
    row = ok(await call(s, "reports/" + row.id + "/publish", "POST", {}));
    // Simulate historical stored header_image_url / artwork_image_urls in a legacy published revision JSON
    const revRow = s.f.db.raw.prepare("SELECT r.* FROM growth_report_revisions r JOIN growth_reports g ON g.tenant_id=r.tenant_id AND g.published_revision_id=r.id WHERE g.tenant_id=? AND g.id=?").get(s.t.id, row.id);
    const legacyDoc = JSON.parse(revRow.doc_json);
    legacyDoc.style.header_image_url = "/legacy/header.png";
    legacyDoc.artwork_image_urls = [ "/legacy/report.png" ];
    const legacyRevId = "grv_legacy_header_test";
    s.f.db.raw.prepare("INSERT INTO growth_report_revisions(tenant_id,id,report_id,seq,doc_json,manifest_json,context_json,action,published_at,publication_order,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
        s.t.id, legacyRevId, row.id, revRow.seq + 1, JSON.stringify(legacyDoc), revRow.manifest_json, revRow.context_json, revRow.action, revRow.published_at, (revRow.publication_order || 0) + 1, revRow.created_at, revRow.created_by
    );
    s.f.db.raw.prepare("UPDATE growth_reports SET published_revision_id=? WHERE tenant_id=? AND id=?").run(legacyRevId, s.t.id, row.id);
    // Unauthenticated callers rejected with 401
    ok(await call(s, "parent/reports/" + row.id, "GET", undefined, ""), 401);
    ok(await call(s, "parent/media/img_header", "GET", undefined, ""), 401);
    // Unconsented child (parent_consent_media=0): no header/artwork IDs or URLs, media returns 404
    const deniedView = ok(await call(s, "parent/reports/" + row.id, "GET", undefined, pa.token));
    assert.equal(deniedView.render_data.style.header_image_id, null);
    assert.equal(deniedView.render_data.style.header_image_url, undefined);
    assert.deepEqual(deniedView.render_data.artwork_image_ids, []);
    assert.equal(deniedView.render_data.artwork_image_urls, undefined);
    ok(await call(s, "parent/media/img_header", "GET", undefined, pa.token), 404);
    ok(await call(s, "parent/media/img_report", "GET", undefined, pa.token), 404);
    ok(await call(s, "parent/reports/" + row.id, "GET", undefined, other.token), 404);
    ok(await call(s, "parent/media/img_header", "GET", undefined, other.token), 404);
    // Consented child (parent_consent_media=1): header and artwork accessible for bound parent only
    s.f.db.raw.prepare("UPDATE students SET parent_consent_media=1 WHERE tenant_id=? AND id=?").run(s.t.id, s.students[0]);
    const allowedView = ok(await call(s, "parent/reports/" + row.id, "GET", undefined, pa.token));
    assert.equal(allowedView.render_data.style.header_image_id, "img_header");
    assert.equal(allowedView.render_data.style.header_image_url, "/" + s.t.slug + "/api/parent/media/img_header");
    assert.deepEqual(allowedView.render_data.artwork_image_ids, [ "img_report" ]);
    assert.deepEqual(allowedView.render_data.artwork_image_urls, [ "/" + s.t.slug + "/api/parent/media/img_report" ]);
    assert.equal((await call(s, "parent/media/img_header", "GET", undefined, pa.token)).status, 200);
    assert.equal((await call(s, "parent/media/img_report", "GET", undefined, pa.token)).status, 200);
    ok(await call(s, "parent/reports/" + row.id, "GET", undefined, other.token), 404);
    ok(await call(s, "parent/media/img_header", "GET", undefined, other.token), 404);
    ok(await call(s, "parent/media/img_report", "GET", undefined, other.token), 404);
}));

test("YX6G 畸形嵌套值统一校验，不能用对象标量触发500或写入", () => growthSchool(async s => {
    const b = await batch(s), row = b.reports[0], before = JSON.stringify(await s.r.growthGet(row.id));
    for (const payload of [ {
        mock_exams: [ null ]
    }, {
        mock_exams: [ {
            month: "2026-11",
            items: [ null ]
        } ]
    }, {
        stats: {
            lessons: null
        }
    }, {
        teacher_id: {}
    }, {
        style: {
            pack_id: {}
        }
    }, {
        style: {
            pack_version: []
        }
    }, {
        texts: null
    } ]) {
        ok(await call(s, "reports/" + row.id, "PUT", {
            version: 1,
            ...payload
        }, s.teacherAccount.token), 422);
        assert.equal(JSON.stringify(await s.r.growthGet(row.id)), before);
    }
}));

test("YX6G 缺少精确日期不生成距考；自定义统计受配置约束、无映射提示且不按名字猜", () => growthSchool(async s => {
    const cls = s.reportClass;
    ok(await call(s, "settings/report-classes", "PUT", {
        ...cls,
        options: {
            ...cls.options,
            stats: [ "camp_days", "days_to_exam", "manual_practice" ]
        }
    }));
    const b = await batch(s);
    let d = await readyDoc(s, b.reports[0]);
    assert.equal(d.stats.camp_days.value, 0);
    assert.ok(d.warnings.some(x => x.includes("尚未关联")));
    assert.equal(d.stats.days_to_exam, undefined);
    d = ok(await call(s, "reports/" + d.id, "PUT", {
        version: d.version,
        stats: {
            manual_practice: {
                value: 12
            }
        }
    }, s.teacherAccount.token));
    assert.equal(d.stats.manual_practice.value, 12);
    ok(await call(s, "reports/" + d.id + "/ready", "POST", {}));
    d = ok(await call(s, "reports/" + d.id + "/publish", "POST", {}));
    assert.equal(d.stats.days_to_exam, undefined);
    const calendar = ok(await call(s, "settings/calendar"));
    calendar.items[0].exact_date = "2026-02-30";
    ok(await call(s, "settings/calendar", "PUT", calendar), 422);
}));

test("YX6G 关闭旧统计模块仍可读成长，批次分页只返回进度摘要，老师不能移交评分", () => growthSchool(async s => {
    const b = await batch(s);
    s.f.db.raw.prepare("UPDATE tenant_modules SET enabled=0 WHERE tenant_id=? AND id='reports'").run(s.t.id);
    ok(await call(s, "reports/" + b.reports[0].id));
    const listed = ok(await call(s, "report-batches?limit=1"));
    assert.equal(listed.total, 1);
    assert.equal(listed.items[0].reports[0].doc_json, undefined);
    assert.equal(listed.items[0].reports[0].tenant_id, undefined);
    ok(await call(s, "reports/" + b.reports[0].id, "PUT", {
        version: 1,
        teacher_id: null
    }, s.teacherAccount.token), 403);
}));

test("YX6G 需要作品的班型快照不能通过关闭新设置绕过完成检查", () => growthSchool(async s => {
    const c = s.reportClass;
    ok(await call(s, "settings/report-classes", "PUT", {
        ...c,
        options: {
            ...c.options,
            require_artwork: true
        }
    }));
    const b = await batch(s), d = await readyDoc(s, b.reports[0]);
    const fresh = ok(await call(s, "settings/report-classes")).items.find(x => x.id === c.id);
    ok(await call(s, "settings/report-classes", "PUT", {
        ...fresh,
        options: {
            ...fresh.options,
            require_artwork: false
        }
    }));
    const rejected = ok(await call(s, "reports/" + d.id + "/ready", "POST", {}, s.teacherAccount.token), 422);
    assert.equal(rejected.error, "check_failed");
    assert.equal(ok(await call(s, "reports/" + d.id)).options.require_artwork, true);
}));

test("YX6G 上一份按发布先后确定，同期且同毫秒也稳定，撤回后回退到仍发布者", () => growthSchool(async s => {
    async function publish(value) {
        const b = await batch(s);
        let d = await readyDoc(s, b.reports[0]);
        d = ok(await call(s, "reports/" + d.id, "PUT", {
            version: d.version,
            scores: d.scores.map(x => ({
                ...x,
                value: value
            }))
        }, s.academic.token));
        ok(await call(s, "reports/" + d.id + "/ready", "POST", {}));
        return ok(await call(s, "reports/" + d.id + "/publish", "POST", {}));
    }
    const first = await publish(3), second = await publish(4), third = await batch(s);
    assert.equal(ok(await call(s, "reports/" + third.reports[0].id)).scores[0]?.previous ?? (await readyDoc(s, third.reports[0])).scores[0].previous, 4);
    ok(await call(s, "reports/" + second.id + "/unpublish", "POST", {
        reason: "撤回"
    }));
    assert.equal(ok(await call(s, "reports/" + third.reports[0].id)).scores[0].previous, 3);
}));
