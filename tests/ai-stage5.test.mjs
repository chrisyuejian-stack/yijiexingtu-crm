import test from "node:test";

import assert from "node:assert/strict";

import { school, call, ok, draft, seed, course, filled, accountToken, model, content, ai, until } from "./fixtures-ai.mjs";

test("YX5AI 成功只写AI专用记录，不改方案、内容或修订", () => school(async s => {
    const p = await filled(s), c = await content(s);
    const before = s.f.db.raw.prepare("SELECT doc_json,version FROM plans WHERE tenant_id=? AND id=?").get(s.t.id, p.id), cbefore = s.f.db.raw.prepare("SELECT doc_json,version FROM content_items WHERE tenant_id=? AND id=?").get(s.t.id, c.id);
    model(s, {
        suggestions: [ {
            payload: {
                fields: [ {
                    path: "title",
                    value: "文字建议"
                } ]
            },
            basis: []
        } ]
    });
    const r = ok(await ai(s, "plan/polish", {
        plan_id: p.id
    }));
    assert.equal(r.usage.used_today, 1);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.suggestions[0].kind, "plan.text");
    assert.deepEqual(s.f.db.raw.prepare("SELECT doc_json,version FROM plans WHERE tenant_id=? AND id=?").get(s.t.id, p.id), before);
    assert.deepEqual(s.f.db.raw.prepare("SELECT doc_json,version FROM content_items WHERE tenant_id=? AND id=?").get(s.t.id, c.id), cbefore);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM ai_usage WHERE tenant_id=?").get(s.t.id).n, 1);
}));

test("YX5AI v036旧快照加新报价=500元，模型金额作废，采用保存结果一致", () => school(async s => {
    let p = await filled(s);
    p = ok(await call(s, "plans/" + p.id, "PUT", {
        version: p.version,
        meta: {
            budget_cap: 550
        }
    }));
    const old = p.modules.courses.lines[0];
    await course(s, "钢琴一对一", 250);
    const c = await course(s, "新增乐理", 100);
    model(s, {
        suggestions: [ {
            payload: {
                variant: "recommended",
                lines: [ {
                    ...old,
                    snapshot: {
                        pricing: {
                            amount_cents: 1
                        }
                    },
                    amount: 1
                }, {
                    line_id: "tmp_fake",
                    stage_key: old.stage_key,
                    course_id: c.id,
                    qty: {
                        units: 1
                    },
                    amount: 999
                } ],
                computed: {
                    total: {
                        amount: 9999
                    }
                }
            }
        } ]
    });
    const r = ok(await ai(s, "plan/stage-courses", {
        plan_id: p.id,
        context: {
            tenant_id: "other",
            courses: [ {
                amount: 1
            } ]
        }
    })), v = r.suggestions[0].payload;
    assert.equal(v.computed.total.amount, 500);
    assert.equal(v.lines[0].line_id, old.line_id);
    assert.match(v.lines[1].line_id, /^tmp_/);
    assert.notEqual(v.lines[1].line_id, "tmp_fake");
    assert.equal(v.lines[0].snapshot, undefined);
    const saved = ok(await call(s, "plans/" + p.id, "PUT", {
        version: p.version,
        expected_price_list_rev: v.price_list_rev,
        modules: {
            courses: {
                lines: v.lines
            }
        }
    }));
    assert.equal(saved.computed.total.amount, 500);
    assert.equal(saved.modules.courses.lines[0].snapshot.pricing.amount_cents, 2e4);
}));

test("YX5AI 越界、未定价、超预算全部过滤，空建议200计一次并返回警告", () => school(async s => {
    const p = await filled(s), stage = p.modules.path.stages[0].key, unpriced = await course(s, "未定价", 1, "per_unit", {
        pricing: null
    });
    model(s, {
        suggestions: [ {
            payload: {
                variant: "recommended",
                lines: [ {
                    course_id: "crs_foreign",
                    stage_key: stage,
                    qty: {
                        units: 1
                    }
                } ]
            }
        }, {
            payload: {
                lines: [ {
                    course_id: unpriced.id,
                    stage_key: stage,
                    qty: {
                        units: 1
                    }
                } ]
            }
        }, {
            payload: {
                lines: [ {
                    course_id: p.modules.courses.lines[0].course_id,
                    stage_key: stage,
                    qty: {
                        units: 1e6
                    }
                } ]
            }
        } ]
    });
    const limited = ok(await call(s, "plans/" + p.id, "PUT", {
        version: p.version,
        meta: {
            budget_cap: 500
        }
    }));
    const r = ok(await ai(s, "plan/stage-courses", {
        plan_id: p.id
    }));
    assert.deepEqual(r.suggestions, []);
    assert.ok(r.warnings.length >= 3);
    assert.equal(r.usage.used_today, 1);
    assert.equal(ok(await call(s, "plans/" + p.id)).version, limited.version);
}));

test("YX5AI 推荐淘汰后首个合规备选成为推荐，最多三个配法", () => school(async s => {
    const p = await filled(s), l = p.modules.courses.lines[0];
    model(s, {
        suggestions: [ {
            payload: {
                variant: "recommended",
                lines: []
            }
        }, {
            payload: {
                variant: "alt",
                lines: [ l ]
            }
        }, {
            payload: {
                variant: "alt",
                lines: [ l ]
            }
        }, {
            payload: {
                variant: "alt",
                lines: [ l ]
            }
        }, {
            payload: {
                variant: "alt",
                lines: [ l ]
            }
        } ]
    });
    const r = ok(await ai(s, "plan/stage-courses", {
        plan_id: p.id
    }));
    assert.equal(r.suggestions.length, 3);
    assert.deepEqual(r.suggestions.map(x => x.payload.variant), [ "recommended", "alt", "alt" ]);
}));

test("YX5AI 停用旧行只读保留，不能通过新ID重新报价或改变其数量", () => school(async s => {
    const p = await filled(s), line = p.modules.courses.lines[0];
    await course(s, "钢琴一对一", 999, "per_unit", {
        active: false
    });
    model(s, {
        suggestions: [ {
            payload: {
                lines: [ {
                    ...line,
                    qty: {
                        units: 100
                    }
                }, {
                    course_id: line.course_id,
                    stage_key: line.stage_key,
                    qty: {
                        units: 2
                    }
                } ]
            }
        } ]
    });
    const r = ok(await ai(s, "plan/stage-courses", {
        plan_id: p.id
    }));
    assert.equal(r.suggestions[0].payload.computed.total.amount, 400);
    assert.equal(r.suggestions[0].payload.lines.length, 1);
    assert.deepEqual(r.suggestions[0].payload.lines[0].qty, {
        units: 2
    });
}));

test("YX5AI 文字path白名单、稳定ID定位与递归剔除分数字段", () => school(async s => {
    const p = await filled(s), stage = p.modules.path.stages[0].key;
    model(s, {
        suggestions: [ {
            payload: {
                score: 5,
                fields: [ {
                    path: "modules.path.stages[key=" + stage + "].goals",
                    value: [ "连贯演奏" ]
                }, {
                    path: "modules.path.stages[0].goals",
                    value: [ "不接受下标" ]
                }, {
                    path: "meta.budget_cap",
                    value: 1
                }, {
                    path: "scores",
                    value: [ 5 ]
                } ]
            }
        } ]
    });
    const r = ok(await ai(s, "plan/polish", {
        plan_id: p.id
    }));
    assert.equal(r.suggestions[0].payload.fields.length, 1);
    assert.ok(r.warnings.length >= 3);
    assert.ok(!JSON.stringify(r.suggestions).includes('"score"'));
}));

test("YX5AI adjust课程页与文字页使用不同kind", () => school(async s => {
    const p = await filled(s);
    model(s, {
        suggestions: [ {
            payload: {
                lines: p.modules.courses.lines
            }
        } ]
    });
    assert.equal(ok(await ai(s, "plan/adjust", {
        plan_id: p.id,
        page: "courses",
        instruction: "保留课程"
    })).suggestions[0].kind, "plan.stage_courses");
    model(s, {
        suggestions: [ {
            payload: {
                fields: [ {
                    path: "modules.assessment.text",
                    value: "评估文字"
                } ]
            }
        } ]
    });
    assert.equal(ok(await ai(s, "plan/adjust", {
        plan_id: p.id,
        page: "assessment",
        instruction: "润色"
    })).suggestions[0].kind, "plan.text");
}));

test("YX5AI 固定键重放、不同请求422、进行中409与单人并发最多2个", () => school(async s => {
    const c = await content(s), resolvers = [];
    model(s, () => new Promise(resolve => resolvers.push(resolve)));
    const key = crypto.randomUUID(), data = {
        content_id: c.id
    };
    const p1 = ai(s, "content/versions", data, key);
    await until(() => resolvers.length === 1);
    assert.equal(ok(await ai(s, "content/versions", data, key), 409).error, "in_progress");
    assert.equal(ok(await ai(s, "content/versions", {
        ...data,
        instruction: "不同"
    }, key), 422).error, "idempotency_mismatch");
    const p2 = ai(s, "content/versions", data);
    await until(() => resolvers.length === 2);
    assert.equal(ok(await ai(s, "content/versions", data), 429).error, "rate_limited");
    resolvers.forEach(r => r({
        suggestions: []
    }));
    const first = ok(await p1);
    assert.equal(ok(await ai(s, "content/outline", data, key), 422).error, "idempotency_mismatch");
    ok(await p2);
    assert.deepEqual(ok(await ai(s, "content/versions", data, key)), first);
    assert.equal(s.modelCalls.length, 2);
}));

test("YX5AI 十分钟缓存过期后从重放凭据恢复原usage和原建议，不增加记录或调用", () => school(async s => {
    const c = await content(s);
    model(s, {
        suggestions: [ {
            payload: {
                versions: {
                    short: "短",
                    medium: "中",
                    long: "长"
                }
            }
        } ]
    });
    const key = crypto.randomUUID(), data = {
        content_id: c.id
    };
    const first = ok(await ai(s, "content/versions", data, key));
    ok(await ai(s, "content/versions", data));
    s.f.db.raw.prepare("UPDATE ai_requests SET response=NULL,cache_expires_at=1 WHERE tenant_id=? AND idem_key=?").run(s.t.id, key);
    assert.deepEqual(ok(await ai(s, "content/versions", data, key)), first);
    assert.equal(s.modelCalls.length, 2);
    assert.equal(first.usage.used_today, 1);
    assert.equal(ok(await call(s, "ai/usage")).fast.used, 2);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM ai_usage WHERE tenant_id=?").get(s.t.id).n, 2);
}));

test("YX5AI 模型错误和两次解析失败不计次数，同键失败可重试", () => school(async s => {
    const c = await content(s);
    model(s, () => {
        throw Error("local model failure");
    });
    const key = crypto.randomUUID(), data = {
        content_id: c.id
    };
    assert.equal(ok(await ai(s, "content/versions", data, key), 502).error, "ai_unavailable");
    assert.equal(ok(await call(s, "ai/usage")).fast.used, 0);
    model(s, {
        suggestions: []
    });
    ok(await ai(s, "content/versions", data, key));
    assert.equal(ok(await call(s, "ai/usage")).fast.used, 1);
    model(s, {
        content: "not JSON"
    });
    ok(await ai(s, "content/versions", data), 502);
    assert.equal(s.modelCalls.length, 2);
    assert.equal(ok(await call(s, "ai/usage")).fast.used, 1);
}));

test("YX5AI 第81次快速请求429，深度独立，GET用量无需幂等键", () => school(async s => {
    const c = await content(s);
    model(s);
    for (let i = 0; i < 80; i++) ok(await ai(s, "content/versions", {
        content_id: c.id
    }));
    const denied = ok(await ai(s, "content/versions", {
        content_id: c.id
    }), 429);
    assert.equal(denied.error, "ai_quota_exceeded");
    assert.equal(denied.details.limit, 80);
    assert.match(denied.details.reset_at, /T00:00:00/);
    ok(await ai(s, "content/versions", {
        content_id: c.id,
        tier: "deep"
    }));
    const usage = ok(await call(s, "ai/usage"));
    assert.equal(usage.fast.used, 80);
    assert.equal(usage.deep.used, 1);
    const original = Date.now;
    Date.now = () => Date.parse(denied.details.reset_at) + 1;
    try {
        const {b64: b64, bytes: bytes, sha: sha} = await import("../src/server/core.js"), token = b64(bytes(32));
        await s.r.createSession(await sha(token), await s.r.user(s.user.id), {
            ip: "test",
            ua: "new-day"
        });
        assert.equal(ok(await ai(s, "content/versions", {
            content_id: c.id
        }, crypto.randomUUID(), token)).usage.used_today, 1);
    } finally {
        Date.now = original;
    }
}));

test("YX5AI 20账号并发抢剩余3次，仅3个模型调用且用量准确至80", () => school(async s => {
    const c = await content(s), people = [];
    for (let i = 0; i < 20; i++) people.push(await accountToken(s, [ "consultant" ]));
    const date = (new Date).toLocaleDateString("sv-SE", {
        timeZone: "Asia/Shanghai"
    });
    s.f.db.raw.prepare("INSERT INTO ai_quota_daily(tenant_id,id,date,tier,used) VALUES(?,?,?,?,77)").run(s.t.id, date + ":fast", date, "fast");
    const resolvers = [];
    model(s, () => new Promise(r => resolvers.push(r)));
    let denied = 0;
    const requests = people.map(person => ai(s, "content/versions", {
        content_id: c.id
    }, crypto.randomUUID(), person.token).then(r => {
        if (r.status === 429) denied++;
        return r;
    }));
    await until(() => resolvers.length === 3 && denied === 17);
    resolvers.forEach(r => r({
        suggestions: []
    }));
    const results = await Promise.all(requests);
    assert.equal(results.filter(r => r.status === 200).length, 3);
    assert.equal(results.filter(r => r.status === 429).length, 17);
    assert.deepEqual(results.filter(r => r.status === 200).map(r => r.body.usage.used_today).sort(), [ 78, 79, 80 ]);
    assert.equal(ok(await call(s, "ai/usage")).fast.used, 80);
}));

test("YX5AI 120秒预占自动不再占位，过期结算重新抢名额，重复结算不二次扣费", () => school(async s => {
    const {aiDate: aiDate} = await import("../src/server/ai.js");
    const at = Date.now(), record = {
        id: "air_direct",
        user_id: s.user.id,
        idem_key: crypto.randomUUID(),
        request_hash: "hash",
        path: "/api/ai/content/versions",
        hold_id: "hold_direct",
        date: aiDate(at),
        tier: "fast",
        deadline_at: at + 45e3
    };
    assert.equal((await s.r.aiAcquire(record, null, 1, at)).ok, true);
    assert.equal((await s.r.aiCapacity(s.user.id, record.date, "fast", 1, at + 120001)).held, 0);
    const response = {
        suggestions: [],
        warnings: [],
        usage: {
            tier: "fast",
            used_today: 0,
            limit: 1
        }
    }, metrics = {
        tool: "content",
        action: "versions",
        model: "local",
        prompt_tokens: 0,
        completion_tokens: 0,
        duration_ms: 120001
    };
    assert.equal((await s.r.aiFinish(record, response, [], metrics, 1, at + 120001)).ok, true);
    assert.equal(await s.r.aiDayUsed(record.date, "fast"), 1);
    assert.equal((await s.r.aiFinish(record, response, [], metrics, 10, at + 120002)).replay, true);
    assert.equal(await s.r.aiDayUsed(record.date, "fast"), 1);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM ai_usage WHERE tenant_id=?").get(s.t.id).n, 1);
}));

test("YX5AI 过期后配额已满丢弃结果并记录blocked_after_expiry", () => school(async s => {
    const {aiDate: aiDate} = await import("../src/server/ai.js"), at = Date.now(), record = {
        id: "air_expired",
        user_id: s.user.id,
        idem_key: crypto.randomUUID(),
        request_hash: "hash",
        path: "/api/ai/content/versions",
        hold_id: "hold_expired",
        date: aiDate(at),
        tier: "fast",
        deadline_at: at + 45e3
    };
    assert.equal((await s.r.aiAcquire(record, null, 1, at)).ok, true);
    s.f.db.raw.prepare("INSERT INTO ai_quota_daily(tenant_id,id,date,tier,used) VALUES(?,?,?,?,1)").run(s.t.id, record.date + ":fast", record.date, "fast");
    const done = await s.r.aiFinish(record, {
        suggestions: [],
        warnings: [],
        usage: {
            tier: "fast",
            used_today: 0,
            limit: 1
        }
    }, [], {
        tool: "content",
        action: "versions",
        model: "local",
        prompt_tokens: 1,
        completion_tokens: 1,
        duration_ms: 120001
    }, 1, at + 120001);
    assert.equal(done.blocked, true);
    assert.equal((await s.r.aiHold(record.hold_id)).status, "expired");
    assert.equal(s.f.db.raw.prepare("SELECT result FROM ai_usage WHERE tenant_id=?").get(s.t.id).result, "blocked_after_expiry");
    assert.equal(await s.r.aiDayUsed(record.date, "fast"), 1);
}));

test("YX5AI 跨日按预占日期结算；次日用量独立", () => school(async s => {
    const at = Date.parse("2026-11-14T23:59:50+08:00"), record = {
        id: "air_midnight",
        user_id: s.user.id,
        idem_key: crypto.randomUUID(),
        request_hash: "hash",
        path: "/api/ai/content/versions",
        hold_id: "hold_midnight",
        date: "2026-11-14",
        tier: "fast",
        deadline_at: at + 45e3
    };
    assert.equal((await s.r.aiAcquire(record, null, 80, at)).ok, true);
    await s.r.aiFinish(record, {
        suggestions: [],
        warnings: [],
        usage: {
            tier: "fast",
            used_today: 0,
            limit: 80
        }
    }, [], {
        tool: "content",
        action: "versions",
        model: "local",
        prompt_tokens: 1,
        completion_tokens: 1,
        duration_ms: 2e4
    }, 80, at + 2e4);
    assert.equal(await s.r.aiDayUsed("2026-11-14", "fast"), 1);
    assert.equal(await s.r.aiDayUsed("2026-11-15", "fast"), 0);
}));

test("YX5AI 批量基础预占min人数剩余额度，每位成功计次，一批只占一个并发名额", () => school(async s => {
    const {aiDate: aiDate} = await import("../src/server/ai.js"), at = Date.now(), date = aiDate(at), parent = {
        id: "air_batch",
        user_id: s.user.id,
        idem_key: crypto.randomUUID(),
        request_hash: "hash",
        path: "/api/ai/report/batch-draft",
        date: date,
        tier: "fast",
        deadline_at: at + 45e3
    };
    const batch = await s.r.aiReserveBatch(parent, s.students, 2, at);
    assert.equal(batch.ok, true);
    assert.equal(batch.records.length, 2);
    assert.equal(batch.skipped.length, 1);
    assert.equal((await s.r.aiCapacity(s.user.id, date, "fast", 2, at)).pending, 1);
    for (const record of batch.records) {
        await s.r.aiFinish(record, {
            suggestions: [],
            warnings: [],
            usage: {
                tier: "fast",
                used_today: 0,
                limit: 2
            }
        }, [], {
            tool: "growth_reports",
            action: "batch-draft",
            model: "local",
            prompt_tokens: 1,
            completion_tokens: 1,
            duration_ms: 1
        }, 2, at + 1);
    }
    const response = {
        suggestions: [],
        warnings: [],
        processed: batch.records.map(r => r.student_id),
        skipped: batch.skipped,
        usage: {
            tier: "fast",
            used_today: 2,
            limit: 2
        }
    };
    await s.r.aiCompleteBatch(parent, response, at + 2);
    assert.equal(await s.r.aiDayUsed(date, "fast"), 2);
    s.f.db.raw.prepare("UPDATE ai_requests SET response=NULL WHERE tenant_id=? AND id=?").run(s.t.id, parent.id);
    assert.deepEqual(await s.r.aiReplay(await s.r.aiRequestId(parent.id)), response);
}));

test("YX5AI 请求按机构隔离且忽略伪造tenant，家长财务教务看不到AI明细", () => school(async s => {
    const c = await content(s), other = await (await import("./fixtures-credit.mjs")).setup(s.f, 1, "ai-other");
    other.f = s.f;
    model(s);
    model(other);
    ok(await ai(other, "content/versions", {
        content_id: c.id
    }), 404);
    assert.equal(other.modelCalls.length, 0);
    const own = ok(await ai(s, "content/versions", {
        content_id: c.id,
        tenant_id: other.t.id,
        user_id: other.user.id
    }));
    assert.equal(own.usage.used_today, 1);
    assert.equal(ok(await call(other, "ai/usage")).fast.used, 0);
    const finance = await accountToken(s, [ "finance" ]), academic = await accountToken(s, [ "academic" ]);
    for (const person of [ finance, academic ]) {
        const usage = ok(await call(s, "ai/usage", "GET", undefined, person.token));
        assert.equal(usage.by_user, undefined);
        assert.equal(usage.by_tool, undefined);
        ok(await ai(s, "content/versions", {
            content_id: c.id
        }, crypto.randomUUID(), person.token), 403);
    }
    const {parent: parent} = await import("./fixtures-plans.mjs");
    const pa = await parent(s);
    assert.equal(ok(await call(s, "ai/usage", "GET", undefined, pa.token)).by_user, undefined);
    ok(await ai(s, "content/versions", {
        content_id: c.id
    }, crypto.randomUUID(), pa.token), 403);
}));

test("YX5AI 机构到期优先于配额、模块关闭不调用模型，生成中停用也不扣次", () => school(async s => {
    const c = await content(s);
    model(s);
    s.f.db.raw.prepare("UPDATE tenants SET expires_at='2000-01-01' WHERE id=?").run(s.t.id);
    assert.equal(ok(await ai(s, "content/versions", {
        content_id: c.id
    }), 403).error, "tenant_expired");
    s.f.db.raw.prepare("UPDATE tenants SET expires_at=NULL WHERE id=?").run(s.t.id);
    s.f.db.raw.prepare("UPDATE tenant_modules SET enabled=0 WHERE tenant_id=? AND id='content'").run(s.t.id);
    ok(await ai(s, "content/versions", {
        content_id: c.id
    }), 404);
    assert.equal(s.modelCalls.length, 0);
    s.f.db.raw.prepare("UPDATE tenant_modules SET enabled=1 WHERE tenant_id=? AND id='content'").run(s.t.id);
    model(s, () => {
        s.f.db.raw.prepare("UPDATE tenants SET status='paused' WHERE id=?").run(s.t.id);
        return {
            suggestions: []
        };
    });
    assert.equal(ok(await ai(s, "content/versions", {
        content_id: c.id
    }), 403).error, "tenant_expired");
    assert.equal(await s.r.aiDayUsed((new Date).toLocaleDateString("sv-SE", {
        timeZone: "Asia/Shanghai"
    }), "fast"), 0);
}));

test("YX5AI 咨询原话核对与学员隐私，伪造客户端上下文不进入模型", () => school(async s => {
    const p = await filled(s);
    s.f.db.raw.prepare("UPDATE students SET name=?,nickname=?,notes=? WHERE tenant_id=? AND id=?").run("周小雨", "周同学", "周小雨读谱偏弱，电话13812345678，希望加强读谱", s.t.id, s.students[0]);
    model(s, {
        suggestions: [ {
            payload: {
                fields: [ {
                    path: "modules.assessment.text",
                    value: "加强读谱",
                    quote: "希望加强读谱"
                }, {
                    path: "modules.assessment.source_note",
                    value: "伪造",
                    quote: "没有这句话"
                } ]
            }
        } ]
    });
    const r = ok(await ai(s, "plan/fill-from-consult", {
        plan_id: p.id,
        consult: "周小雨读谱偏弱，电话13812345678，希望加强读谱",
        context: {
            student: {
                phone: "13999998888",
                name: "客户伪造"
            }
        }
    }));
    assert.equal(r.suggestions[0].payload.fields.length, 1);
    const prompt = JSON.stringify(s.modelCalls[0].messages);
    assert.ok(prompt.includes("周同学"));
    for (const secret of [ "周小雨", "13812345678", "13999998888", "客户伪造" ]) assert.ok(!prompt.includes(secret), secret);
}));

test("YX5AI 缺幂等键、无效档位和外机构plan在预占前拒绝", () => school(async s => {
    const c = await content(s);
    model(s);
    ok(await call(s, "ai/content/versions", "POST", {
        content_id: c.id
    }), 422);
    ok(await ai(s, "content/versions", {
        content_id: c.id,
        tier: "bad"
    }), 422);
    ok(await ai(s, "plan/polish", {
        plan_id: "pln_foreign"
    }), 404);
    assert.equal(s.modelCalls.length, 0);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM ai_quota_holds WHERE tenant_id=?").get(s.t.id).n, 0);
}));

test("YX5AI 平台模型和机构覆盖生效，长文动作快速深度硬截止分别120/150秒", () => school(async s => {
    const c = await content(s);
    model(s, request => {
        assert.ok(request.signal instanceof AbortSignal);
        assert.ok(Math.abs(request.deadline_at - Date.now() - (request.tier === "fast" ? 120e3 : 150e3)) < 2e3);
        return {
            suggestions: []
        };
    });
    s.f.db.raw.prepare("INSERT INTO tenant_ai_overrides(tenant_id,id,fast_daily_limit,deep_daily_limit) VALUES(?,'limits',1,0)").run(s.t.id);
    const r = ok(await ai(s, "content/versions", {
        content_id: c.id,
        model: "injected",
        endpoint: "https://invalid.test"
    }));
    assert.equal(r.usage.limit, 1);
    assert.equal(s.modelCalls[0].model, "local-fast");
    assert.equal(ok(await ai(s, "content/versions", {
        content_id: c.id,
        tier: "deep"
    }), 429).details.limit, 0);
}));

test("YX5AI 硬截止后才返回的结果丢弃，解析重试不延长原截止", () => school(async s => {
    const c = await content(s), original = Date.now;
    let clock = original();
    Date.now = () => clock;
    try {
        model(s, (_, n) => {
            clock += 2e4;
            return n === 1 ? {
                content: "bad"
            } : {
                suggestions: []
            };
        });
        ok(await ai(s, "content/versions", {
            content_id: c.id
        }));
        assert.equal(s.modelCalls.length, 2);
        assert.equal(s.modelCalls[0].deadline_at, s.modelCalls[1].deadline_at);
        model(s, () => {
            clock += 121e3;
            return {
                suggestions: []
            };
        });
        assert.equal(ok(await ai(s, "content/versions", {
            content_id: c.id
        }), 502).error, "ai_timeout");
        assert.equal(ok(await call(s, "ai/usage")).fast.used, 1);
    } finally {
        Date.now = original;
    }
}));

test("YX5AI settings/propose仅建议，经过既有校验后可走修改卡片审批", () => school(async s => {
    await seed(s);
    const calendar = ok(await call(s, "settings/calendar"));
    const original = calendar.items.find(x => x.key === "grade_exam");
    model(s, {
        suggestions: [ {
            payload: {
                ops: [ {
                    op: "update",
                    entity: "calendar",
                    key: "grade_exam",
                    field: "months",
                    from: original.months,
                    to: [ 1, 11 ]
                } ],
                affected: {
                    plans_in_progress: 999
                }
            }
        } ]
    });
    const r = ok(await ai(s, "settings/propose", {
        instruction: "考级改到11月"
    }));
    assert.equal(r.suggestions[0].kind, "settings.change");
    assert.notEqual(r.suggestions[0].payload.affected.plans_in_progress, 999);
    assert.deepEqual(ok(await call(s, "settings/calendar")).items.find(x => x.key === "grade_exam").months, original.months);
    const card = ok(await call(s, "settings/changes", "POST", {
        suggestion_id: r.suggestions[0].id,
        payload: r.suggestions[0].payload
    }), 201);
    ok(await call(s, "settings/changes/" + card.id + "/approve", "POST", {
        version: card.version
    }));
    assert.deepEqual(ok(await call(s, "settings/calendar")).items.find(x => x.key === "grade_exam").months, [ 1, 11 ]);
}));

test("YX5AI 平台AI设置只给超管，可配置模型和限额且不回传密钥", () => school(async s => {
    const ops = async (method, data) => {
        const res = await s.f.request("https://console.school.test/api/ops/ai/settings", {
            method: method,
            headers: {
                Origin: "https://console.school.test",
                "Content-Type": "application/json",
                Cookie: s.f.adminCookie,
                "Cf-Access-Jwt-Assertion": s.f.access
            },
            body: data === undefined ? undefined : JSON.stringify(data)
        });
        const result = {
            status: res.status,
            body: await res.json()
        };
        aiExamples.push({
            request: {
                method: method,
                path: "/api/ops/ai/settings",
                host: "console.school.test",
                authenticated: true,
                headers: {
                    "Content-Type": "application/json",
                    "Cf-Access-Jwt-Assertion": "<Access JWT>",
                    Cookie: "<ops session>"
                },
                body: data ?? null
            },
            response: result
        });
        return result;
    };
    const current = ok(await ops("GET"));
    const saved = ok(await ops("PUT", {
        version: current.version,
        fast_daily_limit: 5,
        deep_daily_limit: 2,
        fast_model: "model-A",
        deep_model: "model-B",
        DEEPSEEK_API_KEY: "must-ignore"
    }));
    assert.equal(saved.fast_model, "model-A");
    assert.ok(!JSON.stringify(saved).includes("must-ignore"));
    assert.equal(saved.version, current.version + 1);
    ok(await ops("PUT", {
        version: current.version
    }), 409);
    ok(await call(s, "/api/ops/ai/settings"), 404);
}));

import { after } from "node:test";

import { mkdir, writeFile } from "node:fs/promises";

import { aiExamples } from "./fixtures-ai.mjs";

import { examples } from "./fixtures-plans.mjs";

after(async () => {
    await mkdir("work/stage5", {
        recursive: true
    });
    await writeFile("work/stage5/ai-http-" + (process.env.TEST_BUNDLE === "1" ? "bundle" : "source") + ".json", JSON.stringify({
        local_only: true,
        examples: [ ...aiExamples, ...examples.filter(x => /\/api\/ai\/usage/.test(x.request.path)) ]
    }, null, 2) + "\n");
});

test("YX5AI 结算数据库失败四项同事务回滚，成功重试只扣一次", () => school(async s => {
    const c = await content(s);
    model(s, {
        suggestions: [ {
            payload: {
                versions: {
                    short: "短",
                    medium: "中",
                    long: "长"
                }
            }
        } ]
    });
    const key = crypto.randomUUID(), data = {
        content_id: c.id
    };
    s.f.db.raw.exec("CREATE TRIGGER ai_test_fail BEFORE INSERT ON ai_usage WHEN NEW.result='ok' BEGIN SELECT RAISE(ABORT,'local_fail'); END");
    ok(await ai(s, "content/versions", data, key), 502);
    assert.equal(ok(await call(s, "ai/usage")).fast.used, 0);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM ai_suggestions WHERE tenant_id=?").get(s.t.id).n, 0);
    assert.equal(s.f.db.raw.prepare("SELECT status FROM ai_requests WHERE tenant_id=?").get(s.t.id).status, "failed");
    s.f.db.raw.exec("DROP TRIGGER ai_test_fail");
    ok(await ai(s, "content/versions", data, key));
    assert.equal(ok(await call(s, "ai/usage")).fast.used, 1);
}));

test("YX5AI 10分钟缓存清理仍可重放；两天后清请求/预占，七天后清未引用建议", () => school(async s => {
    const c = await content(s);
    model(s, {
        suggestions: [ {
            payload: {
                versions: {
                    short: "短",
                    medium: "中",
                    long: "长"
                }
            }
        } ]
    });
    const key = crypto.randomUUID(), first = ok(await ai(s, "content/versions", {
        content_id: c.id
    }, key)), at = Date.now();
    await s.r.aiCleanup(at + 600001);
    const record = await s.r.aiRequest(s.user.id, key);
    assert.equal(record.response, null);
    assert.deepEqual(await s.r.aiReplay(record), first);
    await s.r.aiCleanup(at + 2 * 864e5 + 1e3);
    assert.equal(await s.r.aiRequest(s.user.id, key), null);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM ai_quota_holds WHERE tenant_id=?").get(s.t.id).n, 0);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM ai_suggestions WHERE tenant_id=?").get(s.t.id).n, 1);
    await s.r.aiCleanup(at + 7 * 864e5 + 1e3);
    assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM ai_suggestions WHERE tenant_id=?").get(s.t.id).n, 0);
}));

test("YX5AI 被修改卡引用的过期建议保留审计外键，但不能再被采纳", () => school(async s => {
    await seed(s);
    const c = ok(await call(s, "settings/calendar")), exam = c.items.find(x => x.key === "grade_exam");
    model(s, {
        suggestions: [ {
            payload: {
                ops: [ {
                    op: "update",
                    entity: "calendar",
                    key: "grade_exam",
                    field: "months",
                    from: exam.months,
                    to: [ 11 ]
                } ]
            }
        } ]
    });
    const suggestion = ok(await ai(s, "settings/propose", {
        instruction: "调整考级"
    })).suggestions[0];
    const card = ok(await call(s, "settings/changes", "POST", {
        suggestion_id: suggestion.id,
        payload: suggestion.payload
    }), 201);
    await s.r.aiCleanup(Date.now() + 8 * 864e5);
    assert.ok(s.f.db.raw.prepare("SELECT id FROM ai_suggestions WHERE tenant_id=? AND id=?").get(s.t.id, suggestion.id));
    assert.deepEqual(s.f.db.raw.prepare("PRAGMA foreign_key_check").all(), []);
    assert.ok(ok(await call(s, "settings/changes")).items.some(x => x.id === card.id));
    s.f.db.raw.prepare("UPDATE ai_suggestions SET expires_at=1 WHERE tenant_id=? AND id=?").run(s.t.id, suggestion.id);
    ok(await call(s, "settings/changes", "POST", {
        suggestion_id: suggestion.id,
        payload: suggestion.payload
    }), 404);
}));

test("YX5AI 生产DeepSeek HTTP适配器仅访问固定地址，模型与密钥来自平台配置", () => school(async s => {
    const c = await content(s);
    s.f.db.raw.prepare("UPDATE ai_settings SET fast_model='configured-provider-model'").run();
    s.f.env.DEEPSEEK_API_KEY = "local-fake-provider-key";
    const original = globalThis.fetch;
    let seen = 0;
    globalThis.fetch = async (input, init) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url === "https://api.deepseek.com/chat/completions") {
            seen++;
            const data = JSON.parse(init.body);
            assert.equal(data.model, "configured-provider-model");
            assert.equal(init.headers.Authorization, "Bearer local-fake-provider-key");
            assert.equal(data.stream, false);
            assert.ok(init.signal instanceof AbortSignal);
            return Response.json({
                choices: [ {
                    message: {
                        content: JSON.stringify({
                            suggestions: []
                        })
                    }
                } ],
                usage: {
                    prompt_tokens: 11,
                    completion_tokens: 3
                }
            });
        }
        return original(input, init);
    };
    try {
        const r = ok(await ai(s, "content/versions", {
            content_id: c.id,
            model: "ignored",
            endpoint: "https://ignored.invalid"
        }));
        assert.equal(seen, 1);
        assert.equal(r.usage.used_today, 1);
        assert.equal(s.f.db.raw.prepare("SELECT prompt_tokens FROM ai_usage WHERE tenant_id=?").get(s.t.id).prompt_tokens, 11);
    } finally {
        globalThis.fetch = original;
    }
}));
