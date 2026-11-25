import test, { after } from "node:test";

import assert from "node:assert/strict";

import { mkdir, writeFile } from "node:fs/promises";

import { growthSchool, call, ok, batch, submitFeedback, confirmFeedback, readyDoc } from "./fixtures-growth.mjs";

import { model, ai, aiExamples, until } from "./fixtures-ai.mjs";

const prose = {
    texts: {
        progress: "节奏稳定",
        focus: "句尾注意",
        home_practice: [ "练习两遍" ],
        teacher_note: "节奏稳定"
    }
};

test("YX6AI 反馈草稿仅用主讲原文、剔除评分、不写提交，采用通过原保存", () => growthSchool(async s => {
    model(s, {
        suggestions: [ {
            target: {
                student_id: "foreign"
            },
            payload: {
                message: {
                    learned: "节奏练习",
                    good: "节奏稳定",
                    attention: "句尾注意",
                    homework: "练习两遍"
                },
                scores: [ {
                    value: 5
                } ]
            },
            basis: []
        } ]
    });
    const before = s.f.db.raw.prepare("SELECT COUNT(*) n FROM lesson_submissions").get().n;
    const a = ok(await ai(s, "feedback/compose", {
        lesson_id: s.lid,
        student_id: s.students[0],
        tags: [ "节奏稳定" ],
        note: "节奏练习，句尾注意，练习两遍"
    }, crypto.randomUUID(), s.teacherAccount.token));
    assert.equal(a.suggestions[0].kind, "feedback.message");
    assert.equal(a.suggestions[0].target.student_id, s.students[0]);
    assert.equal(a.suggestions[0].payload.scores, undefined);
    assert.ok(a.suggestions[0].basis.some(x => x.type === "feedback" && x.date === "2026-11-10" && x.quote === "节奏稳定" && x.ref === "draft_feedback:" + s.lid + ":" + s.students[0]));
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM lesson_submissions").get().n, before);
    const p = ok(await submitFeedback(s, {
        extra: {
            personal: [ {
                student_id: s.students[0],
                message: a.suggestions[0].payload.message
            } ],
            applied_suggestion_ids: [ a.suggestions[0].id ]
        }
    }));
    ok(await confirmFeedback(s, p.id));
    assert.ok(s.f.db.raw.prepare("SELECT doc_json FROM growth_feedback WHERE tenant_id=? AND student_id=?").get(s.t.id, s.students[0]).doc_json.includes(a.suggestions[0].id));
}));

test("YX6AI 报告仅取已确认反馈、真实target与人工分数，未确认文本不进入模型", () => growthSchool(async s => {
    const p = ok(await submitFeedback(s));
    ok(await confirmFeedback(s, p.id));
    await submitFeedback(s, {
        kind: "comments",
        extra: {
            personal: [ {
                student_id: s.students[0],
                note: "未确认秘密内容"
            } ]
        }
    });
    const b = await batch(s), row = await readyDoc(s, b.reports[0]);
    model(s, {
        suggestions: [ {
            target: {
                report_id: "foreign"
            },
            payload: {
                ...prose,
                scores: [ 5 ],
                stats: {
                    lessons: 999
                }
            },
            basis: []
        } ]
    });
    const before = JSON.stringify(await s.r.growthGet(row.id));
    const a = ok(await ai(s, "report/draft", {
        report_id: row.id,
        fields: [ "progress", "focus", "home_practice", "teacher_note" ]
    }, crypto.randomUUID(), s.teacherAccount.token));
    assert.equal(a.suggestions[0].kind, "report.text");
    assert.equal(a.suggestions[0].target.report_id, row.id);
    assert.equal(a.suggestions[0].payload.scores, undefined);
    assert.ok(!JSON.stringify(s.modelCalls).includes("未确认秘密内容"));
    assert.equal(JSON.stringify(await s.r.growthGet(row.id)), before);
    assert.ok(JSON.stringify(s.modelCalls).includes("节奏稳定"));
}));

test("YX6AI 批量按人计次、额度不足按输入顺序返回、业务占位未改变且可重放", () => growthSchool(async s => {
    const b = await batch(s);
    s.f.db.raw.prepare("UPDATE ai_settings SET fast_daily_limit=1").run();
    model(s, {
        suggestions: [ {
            payload: prose
        } ]
    });
    const before = JSON.stringify(await s.r.growthBatchReports(b.batch.id)), key = crypto.randomUUID(), input = {
        batch_id: b.batch.id,
        student_ids: s.students
    };
    const response = ok(await ai(s, "report/batch-draft", input, key));
    assert.equal(response.processed.length, 1);
    assert.equal(response.processed[0].student_id, s.students[0]);
    assert.equal(response.skipped[0].reason, "quota_exceeded");
    assert.equal(response.usage.used_today, 1);
    assert.equal(s.modelCalls.length, 1);
    assert.equal(JSON.stringify(await s.r.growthBatchReports(b.batch.id)), before);
    assert.deepEqual(ok(await ai(s, "report/batch-draft", input, key)), response);
    s.f.db.raw.prepare("UPDATE ai_requests SET response=NULL,cache_expires_at=0 WHERE tenant_id=?").run(s.t.id);
    assert.deepEqual(ok(await ai(s, "report/batch-draft", input, key)), response);
    assert.equal(s.modelCalls.length, 1);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM ai_usage WHERE tenant_id=? AND result='ok'").get(s.t.id).n, 1);
}));

test("YX6AI 批量跳过已开始、零合格不调用模型不计次、零余额429", () => growthSchool(async s => {
    const b = await batch(s);
    for (const row of b.reports) await readyDoc(s, row);
    model(s);
    const response = ok(await ai(s, "report/batch-draft", {
        batch_id: b.batch.id,
        student_ids: s.students
    }));
    assert.equal(response.processed.length, 0);
    assert.equal(response.skipped.length, 2);
    assert.ok(response.skipped.every(x => x.reason === "already_started"));
    assert.equal(s.modelCalls.length, 0);
    assert.equal(response.usage.used_today, 0);
    const b2 = await batch(s);
    s.f.db.raw.prepare("UPDATE ai_settings SET fast_daily_limit=0").run();
    const bad = ok(await ai(s, "report/batch-draft", {
        batch_id: b2.batch.id,
        student_ids: s.students
    }), 429);
    assert.equal(bad.error, "ai_quota_exceeded");
    assert.equal(s.modelCalls.length, 0);
}));

test("YX6AI 批量部分模型失败只计成功者、全部失败502且释放，失败键可重试", () => growthSchool(async s => {
    const b = await batch(s);
    let index = 0;
    model(s, () => {
        if (index++ === 0) throw Error("local");
        return {
            suggestions: [ {
                payload: prose
            } ]
        };
    });
    const response = ok(await ai(s, "report/batch-draft", {
        batch_id: b.batch.id,
        student_ids: s.students
    }));
    assert.equal(response.processed.length, 1);
    assert.equal(response.skipped[0].reason, "model_error");
    assert.equal(response.usage.used_today, 1);
    model(s, () => {
        throw Error("all error");
    });
    const key = crypto.randomUUID(), input = {
        batch_id: b.batch.id,
        student_ids: s.students
    };
    ok(await ai(s, "report/batch-draft", input, key), 502);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM ai_quota_holds WHERE tenant_id=? AND status='held'").get(s.t.id).n, 0);
    model(s, {
        suggestions: [ {
            payload: prose
        } ]
    });
    const good = ok(await ai(s, "report/batch-draft", input, key));
    assert.equal(good.processed.length, 2);
    assert.equal(good.usage.used_today, 3);
}));

test("YX6AI 批量并发最多4人，空合规建议仍按人计次，超过100拒绝", () => growthSchool(async s => {
    const b = await batch(s);
    let active = 0, peak = 0;
    model(s, async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise(r => setTimeout(r, 5));
        active--;
        return {
            suggestions: []
        };
    });
    const response = ok(await ai(s, "report/batch-draft", {
        batch_id: b.batch.id,
        student_ids: s.students
    }));
    assert.equal(response.processed.length, 2);
    assert.equal(response.suggestions.length, 0);
    assert.equal(response.usage.used_today, 2);
    assert.ok(peak <= 4);
    ok(await ai(s, "report/batch-draft", {
        batch_id: b.batch.id,
        student_ids: Array.from({
            length: 101
        }, (_, i) => "s" + i)
    }), 422);
}));

after(async () => {
    await mkdir("work/stage6", {
        recursive: true
    });
    await writeFile("work/stage6/ai-http-" + (process.env.TEST_BUNDLE === "1" ? "bundle" : "source") + ".json", JSON.stringify({
        local_only: true,
        examples: aiExamples
    }, null, 2));
});

test("YX6AI 十二人批量保持最多4并发且HTTP查询不超40，按输入顺序返回", () => growthSchool(async s => {
    for (let i = 0; i < 10; i++) s.students.push(await s.create("students", {
        name: "新增学员" + i
    }));
    const b = await batch(s), order = [ ...s.students ].reverse();
    let current = 0, peak = 0;
    model(s, async () => {
        current++;
        peak = Math.max(peak, current);
        await new Promise(r => setTimeout(r, 5));
        current--;
        return {
            suggestions: [ {
                payload: prose
            } ]
        };
    });
    const response = await ai(s, "report/batch-draft", {
        batch_id: b.batch.id,
        student_ids: order
    });
    const data = ok(response);
    assert.deepEqual(data.processed.map(x => x.student_id), order);
    assert.equal(peak, 4);
    assert.ok(response.queries <= 40);
    assert.equal(data.usage.used_today, 12);
    assert.ok((await s.r.growthBatchReports(b.batch.id)).every(x => x.progress === "not_started"));
}));

test("YX6AI 批量整批校验归属、请求体不符422、运行中重放409，不调用越权模型", () => growthSchool(async s => {
    const b = await batch(s);
    model(s, {
        suggestions: [ {
            payload: prose
        } ]
    });
    ok(await ai(s, "report/batch-draft", {
        batch_id: b.batch.id,
        student_ids: [ s.students[0], "foreign" ]
    }), 404);
    assert.equal(s.modelCalls.length, 0);
    let release;
    const gate = new Promise(r => release = r);
    model(s, async () => {
        await gate;
        return {
            suggestions: [ {
                payload: prose
            } ]
        };
    });
    const key = crypto.randomUUID(), input = {
        batch_id: b.batch.id,
        student_ids: s.students
    }, run = ai(s, "report/batch-draft", input, key);
    await until(() => s.modelCalls.length >= 2);
    ok(await ai(s, "report/batch-draft", input, key), 409);
    ok(await ai(s, "report/batch-draft", {
        ...input,
        instruction: "不同内容"
    }, key), 422);
    release();
    ok(await run);
}));

test("YX6AI 批量只占一个账号并发名额，另一请求可用，第三个429", () => growthSchool(async s => {
    const b = await batch(s);
    let release;
    const gate = new Promise(r => release = r);
    model(s, async () => {
        await gate;
        return {
            suggestions: [ {
                payload: prose
            } ]
        };
    });
    const first = ai(s, "report/batch-draft", {
        batch_id: b.batch.id,
        student_ids: s.students
    });
    await until(() => s.modelCalls.length >= 2);
    const second = ai(s, "report/draft", {
        report_id: b.reports[0].id,
        fields: [ "progress" ]
    });
    await until(() => s.modelCalls.length >= 3);
    const denied = ok(await ai(s, "report/draft", {
        report_id: b.reports[1].id,
        fields: [ "progress" ]
    }), 429);
    assert.equal(denied.error, "rate_limited");
    release();
    ok(await first);
    ok(await second);
}));

test("YX6AI 整批共用45秒截止，超时全部释放不计次，内部重试不延长", () => growthSchool(async s => {
    const b = await batch(s);
    const original = Date.now;
    let clock = original();
    Date.now = () => clock;
    model(s, req => {
        clock = req.deadline_at + 1;
        return {
            suggestions: [ {
                payload: prose
            } ]
        };
    });
    try {
        ok(await ai(s, "report/batch-draft", {
            batch_id: b.batch.id,
            student_ids: s.students
        }), 502);
        assert.equal(ok(await call(s, "ai/usage")).fast.used, 0);
        assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM ai_quota_holds WHERE status='held'").get().n, 0);
    } finally {
        Date.now = original;
    }
    let first = true;
    model(s, () => {
        if (first) {
            first = false;
            return {
                content: "{not JSON"
            };
        }
        return {
            suggestions: [ {
                payload: prose
            } ]
        };
    });
    const response = ok(await ai(s, "report/batch-draft", {
        batch_id: b.batch.id,
        student_ids: [ s.students[0] ]
    }));
    assert.equal(response.usage.used_today, 1);
    assert.equal(s.modelCalls.length, 2);
    assert.equal(s.modelCalls[0].deadline_at, s.modelCalls[1].deadline_at);
}));

test("YX6AI 批量结算故障整个事务回滚，失败键重试只结算一次", () => growthSchool(async s => {
    const b = await batch(s);
    model(s, {
        suggestions: [ {
            payload: prose
        } ]
    });
    s.f.db.raw.exec("CREATE TRIGGER growth_ai_fault BEFORE INSERT ON ai_usage WHEN NEW.result='ok' BEGIN SELECT RAISE(ABORT,'local_fault'); END");
    const key = crypto.randomUUID(), input = {
        batch_id: b.batch.id,
        student_ids: s.students
    };
    ok(await ai(s, "report/batch-draft", input, key), 502);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM ai_suggestions").get().n, 0);
    assert.equal(ok(await call(s, "ai/usage")).fast.used, 0);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM ai_quota_holds WHERE status='held'").get().n, 0);
    s.f.db.raw.exec("DROP TRIGGER growth_ai_fault");
    const good = ok(await ai(s, "report/batch-draft", input, key));
    assert.equal(good.usage.used_today, 2);
    assert.deepEqual(ok(await ai(s, "report/batch-draft", input, key)), good);
}));

test("YX6AI 生成中停用或关模块不计次、恢复会话后可重试", () => growthSchool(async s => {
    const b = await batch(s), key = crypto.randomUUID(), input = {
        batch_id: b.batch.id,
        student_ids: s.students
    };
    model(s, () => {
        s.f.db.raw.prepare("UPDATE tenants SET status='paused' WHERE id=?").run(s.t.id);
        return {
            suggestions: [ {
                payload: prose
            } ]
        };
    });
    assert.equal(ok(await ai(s, "report/batch-draft", input, key), 403).error, "tenant_expired");
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM ai_quota_daily").get().n, 0);
    s.f.db.raw.prepare("UPDATE tenants SET status='active' WHERE id=?").run(s.t.id);
    model(s, {
        suggestions: [ {
            payload: prose
        } ]
    });
    ok(await ai(s, "report/batch-draft", input, key));
    model(s, () => {
        s.f.db.raw.prepare("UPDATE tenant_modules SET enabled=0 WHERE tenant_id=? AND id='growth_reports'").run(s.t.id);
        return {
            suggestions: [ {
                payload: prose
            } ]
        };
    });
    assert.equal(ok(await ai(s, "report/batch-draft", input), 404).error, "not_found");
    assert.equal(s.f.db.raw.prepare("SELECT used FROM ai_quota_daily WHERE tenant_id=? AND tier='fast'").get(s.t.id).used, 2);
}));

test("YX6AI 一百人真实批量80名额，剩20位跳过且整个HTTP在40次查询内", () => growthSchool(async s => {
    const template = await s.r.businessGet("students", s.students[0]), changes = [];
    for (let i = 2; i < 100; i++) {
        const id = "scale_student_" + i;
        s.students.push(id);
        changes.push({
            resource: "students",
            data: {
                ...template,
                id: id,
                name: "测试学员" + i,
                nickname: "同学" + i,
                deleted_at: null
            }
        });
    }
    await s.r.commitBusiness(await s.r.dataVersion(), changes, s.user, "students", "fixture_scale");
    const b = await batch(s);
    model(s, {
        suggestions: [ {
            payload: prose
        } ]
    });
    const response = await ai(s, "report/batch-draft", {
        batch_id: b.batch.id,
        student_ids: s.students
    });
    const value = ok(response);
    assert.equal(value.processed.length, 80);
    assert.equal(value.skipped.length, 20);
    assert.equal(value.usage.used_today, 80);
    assert.equal(s.modelCalls.length, 80);
    assert.ok(response.queries <= 40, "HTTP queries=" + response.queries);
    assert.deepEqual(value.processed.map(x => x.student_id), s.students.slice(0, 80));
}));

test("YX6AI 大响应以凭据重建而不塞进单行缓存，重复不扣次", () => growthSchool(async s => {
    const b = await batch(s);
    const paragraph = "练习".repeat(6e3);
    model(s, {
        suggestions: [ {
            payload: {
                texts: {
                    progress: paragraph,
                    focus: paragraph,
                    teacher_note: paragraph,
                    home_practice: Array.from({
                        length: 12
                    }, () => "练习".repeat(1e3))
                }
            }
        } ]
    });
    const key = crypto.randomUUID(), input = {
        batch_id: b.batch.id,
        student_ids: s.students
    }, value = ok(await ai(s, "report/batch-draft", input, key));
    assert.equal(value.processed.length, 2);
    const request = await s.r.aiRequest(s.user.id, key);
    assert.equal(request.response, null);
    assert.deepEqual(ok(await ai(s, "report/batch-draft", input, key)), value);
    assert.equal(s.modelCalls.length, 2);
    assert.equal(ok(await call(s, "ai/usage")).fast.used, 2);
}));

test("YX6AI 报告模型只看本学员昵称和已确认原文，姓名及电话被隐去", () => growthSchool(async s => {
    const row = await s.r.businessGet("students", s.students[0]);
    ok(await call(s, "data/students/" + row.id, "PATCH", {
        version: row.version,
        name: "周子轩",
        nickname: "周同学"
    }));
    const feedback = ok(await submitFeedback(s, {
        extra: {
            personal: [ {
                student_id: row.id,
                note: "周子轩节奏稳定，联系13812345678",
                message: {
                    good: "周子轩节奏稳定"
                }
            } ]
        }
    }));
    ok(await confirmFeedback(s, feedback.id));
    const b = await batch(s);
    model(s, {
        suggestions: [ {
            payload: prose
        } ]
    });
    ok(await ai(s, "report/draft", {
        report_id: b.reports[0].id,
        fields: [ "progress" ]
    }, crypto.randomUUID(), s.teacherAccount.token));
    const prompt = JSON.stringify(s.modelCalls);
    assert.ok(!prompt.includes("周子轩"));
    assert.ok(!prompt.includes("13812345678"));
    assert.ok(prompt.includes("周同学"));
}));

test("YX6AI compose拒绝非主讲、别的学生曲目和48小时窗口外请求，均不调用模型", () => growthSchool(async s => {
    model(s, {
        suggestions: [ {
            payload: {
                message: {
                    good: "节奏稳定"
                }
            }
        } ]
    });
    const input = {
        lesson_id: s.lid,
        student_id: s.students[0],
        note: "节奏稳定"
    };
    ok(await ai(s, "feedback/compose", input, crypto.randomUUID(), s.token), 403);
    const other = ok(await call(s, "students/" + s.students[1] + "/repertoire", "POST", {
        name: "另一个学生的曲目"
    }, s.academic.token), 201);
    ok(await ai(s, "feedback/compose", {
        ...input,
        repertoire_ids: [ other.id ]
    }, crypto.randomUUID(), s.teacherAccount.token), 404);
    const original = Date.now;
    Date.now = () => original() + 49 * 36e5;
    try {
        ok(await ai(s, "feedback/compose", input, crypto.randomUUID(), s.teacherAccount.token), 403);
    } finally {
        Date.now = original;
    }
    assert.equal(s.modelCalls.length, 0);
}));

test("YX6AI 结算已提交但回执丢失，按持久结果返回成功，不误报不计次或重复结算", () => growthSchool(async s => {
    const b = await batch(s);
    model(s, {
        suggestions: [ {
            payload: prose
        } ]
    });
    const original = s.f.db.batch.bind(s.f.db);
    let injected = false;
    s.f.db.batch = async queries => {
        const result = await original(queries);
        if (!injected && queries.some(x => x.query.includes("receipt_json=json_set"))) {
            injected = true;
            throw Error("local_commit_ack_lost");
        }
        return result;
    };
    try {
        const key = crypto.randomUUID(), input = {
            batch_id: b.batch.id,
            student_ids: s.students
        }, value = ok(await ai(s, "report/batch-draft", input, key));
        assert.equal(value.usage.used_today, 2);
        assert.deepEqual(ok(await ai(s, "report/batch-draft", input, key)), value);
        assert.equal(s.modelCalls.length, 2);
    } finally {
        s.f.db.batch = original;
    }
}));
