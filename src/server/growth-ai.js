import {aiFailureReason} from './ai-policy.js';
import { repo } from "./repo.js";

import { fail, HttpError, randomId, now, body, json, sha } from "./core.js";

import { can } from "./permissions.js";

import { text, ids, list, object, invalid } from "./content-document.js";

import { privateSafe } from "./ai-context.js";

import { lessonWindow } from "./presentation.js";

import { feedbackMessage } from "./growth-feedback.js";

import { reportDto } from "./growth.js";

export function growthProtocol(ctx) {
    return '只返回JSON {"suggestions":[{"payload":{},"basis":[{"type":"feedback","ref":"给定ref","date":"反馈日期","quote":"原话"}],"warnings":[]}]}。只整理当前老师给定或已确认原文，不编造事实，不与其他学员比较，先说进步再说问题，不给分数或统计数字字段。' + (ctx.tool === "feedback" ? "payload={message:{learned,good,attention,homework}}，只整理本次tags/repertoire/note。" : "payload={texts:{progress,focus,home_practice:字符串数组,teacher_note}}，只返回fields请求字段，不生成next_goals。");
}

const paragraphs = value => typeof value === "string" ? value.split(/[。！!？?\n]+/).map(x => x.trim()).filter(Boolean) : Array.isArray(value) ? value.flatMap(paragraphs) : value && typeof value === "object" ? Object.values(value).flatMap(paragraphs) : [];

function permission(u, p, ctx) {
    if (!can(u, p, "ai", "use", {
        tool: ctx.tool === "feedback" ? "feedback" : "growth_reports",
        teacher_id: ctx.teacher_id
    }) || !can(u, p, ctx.tool === "feedback" ? "feedback" : "growth_reports", "write", {
        teacher_id: ctx.teacher_id
    })) fail(403, "没有此操作权限", "forbidden");
}

function feedbackText(doc) {
    return [ doc.public_text, doc.homework, doc.note, doc.legacy_comment, ...doc.tags || [], ...Object.values(doc.message || {}) ].filter(Boolean).join("\n");
}

export async function growthAiContext(r, tool, action, d, u, p, loaded = null) {
    const ctx = {
        tool: tool,
        action: action,
        refs: {},
        dates: {},
        instruction: text(d.instruction ?? "", "instruction", 1e4)
    };
    if (tool === "feedback") {
        const lessonId = text(d.lesson_id, "lesson_id", 100, false), studentId = text(d.student_id, "student_id", 100, false), view = await r.reviewContext(lessonId, null, false, u.teacher_id), lesson = view.lessons[0];
        if (!lesson || !view.participants.some(x => x.student_id === studentId)) fail(404, "不存在", "not_found");
        if (!u.roles.includes("teacher") || lesson.teacher_id !== u.teacher_id) fail(403, "仅主讲老师可用", "forbidden");
        if (!lessonWindow(lesson, now()).open || view.settlements[0]?.locked) fail(403, "不在可提交窗口", "forbidden");
        const student = await r.growthStudent(studentId, u.teacher_id);
        if (!student) fail(404, "不存在", "not_found");
        const tags = ids(d.tags ?? [], "tags", 30), repIds = ids(d.repertoire_ids ?? [], "repertoire_ids", 100), refs = await r.growthFeedbackRefs([ studentId ], repIds, []);
        if (refs.repertoire.length !== repIds.length || refs.repertoire.some(x => x.student_id !== studentId)) fail(404, "不存在", "not_found");
        const note = text(d.note ?? "", "note", 12e3), ref = "draft_feedback:" + lessonId + ":" + studentId;
        ctx.target = {
            lesson_id: lessonId,
            student_id: studentId
        };
        ctx.teacher_id = lesson.teacher_id;
        ctx.refs[ref] = privateSafe([ ...tags, ...refs.repertoire.map(x => x.name), note ].join("\n"), student);
        ctx.dates[ref] = lesson.start_at.slice(0, 10);
        ctx.public = {
            student: {
                nickname: student.nickname
            },
            tags: privateSafe(tags, student),
            repertoire: refs.repertoire.map(x => ({
                id: x.id,
                name: x.name
            })),
            note: privateSafe(note, student)
        };
        ctx.instruction = privateSafe(ctx.instruction, student);
    } else {
        const row = loaded?.row ?? await r.growthGet(text(d.report_id, "report_id", 100, false));
        if (!row || u.roles.includes("teacher") && row.teacher_id !== u.teacher_id) fail(404, "不存在", "not_found");
        const data = loaded?.data ?? await r.growthReportData([ row ]), student = data.students.find(x => x.id === row.student_id);
        if (!student) fail(404, "不存在", "not_found");
        ctx.row = row;
        ctx.teacher_id = row.teacher_id;
        ctx.target = {
            report_id: row.id,
            student_id: row.student_id
        };
        ctx.fields = ids(d.fields ?? [ "progress", "focus", "home_practice", "teacher_note" ], "fields", 4);
        if (!ctx.fields.length || ctx.fields.some(x => ![ "progress", "focus", "home_practice", "teacher_note" ].includes(x))) invalid("报告AI字段不正确", "fields");
        const feedback = data.feedback.filter(x => x.report_id === row.id).map(x => {
            ctx.refs[x.id] = privateSafe(feedbackText(x.doc), student);
            ctx.dates[x.id] = x.date;
            return {
                id: x.id,
                date: x.date,
                text: ctx.refs[x.id]
            };
        });
        ctx.public = {
            student: {
                nickname: student.nickname
            },
            report: privateSafe(reportDto(row, data), student),
            feedback: feedback,
            fields: ctx.fields
        };
        ctx.instruction = privateSafe(ctx.instruction, student);
    }
    permission(u, p, ctx);
    return ctx;
}

export function filterGrowthAi(parsed, ctx) {
    const warnings = [], suggestions = [];
    for (const raw of parsed.suggestions) {
        try {
            const payload = object(raw.payload, "payload");
            if (/"(?:score|scores|stats|previous|mock_exams)"\s*:/.test(JSON.stringify(payload))) warnings.push("已剔除模型提供的评分或统计字段");
            let safe;
            if (ctx.tool === "feedback") safe = {
                message: feedbackMessage(payload.message)
            }; else {
                const source = object(payload.texts, "texts"), texts = {};
                for (const k of ctx.fields) {
                    if (source[k] === undefined) continue;
                    texts[k] = k === "home_practice" ? list(source[k], k, 30).map(x => text(x, k, 2e3)) : text(source[k], k, 12e3);
                }
                if (!Object.keys(texts).length) throw Error("empty");
                safe = {
                    texts: texts
                };
            }
            const basis = [];
            for (const b of Array.isArray(raw.basis) ? raw.basis.slice(0, 100) : []) {
                const quote = typeof b?.quote === "string" ? b.quote : "", ref = b?.ref;
                if (b?.type === "feedback" && typeof ref === "string" && ctx.refs[ref] && quote && ctx.refs[ref].includes(quote)) {
                    basis.push({
                        type: "feedback",
                        ref: ref,
                        date: ctx.dates[ref],
                        quote: quote
                    });
                } else basis.push({
                    type: "unsupported",
                    text: "模型依据无法从本次老师原文核对"
                });
            }
            const sentences = paragraphs(safe);
            for (const sentence of sentences) {
                const match = Object.entries(ctx.refs).find(([, source]) => source.includes(sentence));
                if (match) {
                    const [ref] = match;
                    if (!basis.some(x => x.type === "feedback" && x.ref === ref && x.quote === sentence)) basis.push({
                        type: "feedback",
                        ref: ref,
                        date: ctx.dates[ref],
                        quote: sentence
                    });
                } else basis.push({
                    type: "unsupported",
                    text: sentence
                });
            }
            if (sentences.some(x => /(其他同学|全班最|比.{0,12}同学|全班排名)/.test(x))) {
                warnings.push("已丢弃与其他学员比较的建议");
                continue;
            }
            if (!sentences.length) {
                warnings.push("已丢弃空文字建议");
                continue;
            }
            const own = basis.some(x => x.type === "unsupported") ? [ "资料里找不到依据的文字需要人工核对" ] : [];
            suggestions.push({
                id: randomId("sg"),
                kind: ctx.tool === "feedback" ? "feedback.message" : "report.text",
                target: ctx.target,
                payload: safe,
                basis: basis,
                warnings: own
            });
            warnings.push(...own);
        } catch {
            warnings.push("已丢弃格式不正确的反馈/报告建议");
        }
    }
    if (!suggestions.length && !warnings.length) warnings.push("没有符合本次资料的建议");
    return {
        suggestions: suggestions,
        warnings: [ ...new Set(warnings) ]
    };
}

export async function growthAiBatch(req, env, resolved, u, p, config, provider) {
    const r = repo(env, resolved.tenant.id), d = await body(req), tier = d.tier ?? "fast";
    if (!p.modules.growth_reports) fail(404, "不存在", "not_found");
    if (![ "fast", "deep" ].includes(tier)) invalid("AI档位不正确", "tier");
    const key = req.headers.get("Idempotency-Key");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key || "")) invalid("需要UUID幂等键", "Idempotency-Key");
    text(d.instruction ?? "", "instruction", 1e4);
    const requested = ids(d.student_ids, "student_ids", 100);
    if (!requested.length) invalid("请选择学生", "student_ids");
    const batch = await r.growthBatch(text(d.batch_id, "batch_id", 100, false));
    if (!batch) fail(404, "不存在", "not_found");
    const reports = await r.growthBatchReports(batch.id), selected = requested.map(id => reports.find(x => x.student_id === id));
    if (selected.some(x => !x || u.roles.includes("teacher") && x.teacher_id !== u.teacher_id)) fail(404, "不存在", "not_found");
    for (const row of selected) permission(u, p, {
        tool: "report",
        teacher_id: row.teacher_id
    });
    const canonical = (v, depth = 0) => {
        if (depth > 30) invalid("请求嵌套过深");
        return Array.isArray(v) ? v.map(x => canonical(x, depth + 1)) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [ k, canonical(v[k], depth + 1) ])) : v;
    }, hash = await sha(JSON.stringify(canonical(d))), old = await r.aiRequest(u.id, key), path = resolved.relative;
    if (old && (old.request_hash !== hash || old.path !== path)) fail(422, "幂等键内容不同", "idempotency_mismatch");
    if (old?.status === "done") return json(await r.aiReplay(old));
    if (old?.status === "pending" && old.deadline_at > now()) fail(409, "请求仍在处理", "in_progress");
    const eligible = selected.filter(x => x.progress === "not_started"), skipped = selected.filter(x => x.progress !== "not_started").map(x => ({
        student_id: x.student_id,
        report_id: x.id,
        reason: "already_started"
    })), at = now(), date = new Date(at).toLocaleDateString("sv-SE", {
        timeZone: "Asia/Shanghai"
    }), limit = config[tier + "_limit"], model = config[tier + "_model"];
    if (eligible.length && (!model || !env.DEEPSEEK_API_KEY && typeof env.AI_PROVIDER !== "function")) fail(503, "请先配置AI", "configuration_missing");
    const parent = {
        id: old?.id || randomId("air"),
        user_id: u.id,
        idem_key: key,
        request_hash: hash,
        path: path,
        hold_id: randomId("batch"),
        date: date,
        tier: tier,
        deadline_at: at + (tier === "fast" ? 45e3 : 9e4)
    };
    const reserved = await r.growthAiReserve(parent, eligible.map(x => x.student_id), old, limit, at);
    if (!reserved.ok) {
        const tenant = await r.tenant();
        if (tenant.status !== "active" || tenant.expires_at && Date.parse(tenant.expires_at + "T23:59:59+08:00") <= now()) fail(403, "机构已到期或停用", "tenant_expired");
        const latest = await r.aiRequest(u.id, key);
        if (latest?.status === "done") return json(await r.aiReplay(latest));
        if (latest?.status === "pending" && latest.deadline_at > now()) fail(409, "请求仍在处理", "in_progress");
        const capacity = await r.aiCapacity(u.id, date, tier, limit, now());
        await r.aiRejected(parent, {
            tool: "growth_reports",
            action: "batch-draft",
            model: model || ""
        }, now());
        if (capacity.pending >= 2) fail(429, "同时最多两个请求", "rate_limited");
        const e = new HttpError(429, "今日AI额度已用完", "ai_quota_exceeded");
        e.details = {
            tier: tier,
            limit: limit,
            reset_at: new Date(Date.parse(date + "T00:00:00+08:00") + 864e5).toISOString()
        };
        throw e;
    }
    for (const id of reserved.skipped) skipped.push({
        student_id: id,
        report_id: eligible.find(x => x.student_id === id).id,
        reason: "quota_exceeded"
    });
    try {
        const data = eligible.length ? await r.growthReportData(eligible) : null, contexts = new Map;
        for (const row of eligible) contexts.set(row.student_id, await growthAiContext(r, "report", "draft", {
            ...d,
            fields: [ "progress", "focus", "home_practice", "teacher_note" ],
            report_id: row.id
        }, u, p, {
            row: row,
            data: data
        }));
        let cursor = 0;
        const outcomes = new Array(reserved.records.length);
        const worker = async () => {
            while (cursor < reserved.records.length) {
                const index = cursor++, record = reserved.records[index], ctx = contexts.get(record.student_id), metrics = {
                    tool: "growth_reports",
                    action: "batch-draft",
                    model: model,
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    duration_ms: 0
                }, controller = new AbortController;
                let timer;
                if (now() >= parent.deadline_at) {
                    outcomes[index] = {
                        record: record,
                        metrics: metrics,
                        error: "deadline"
                    };
                    continue;
                }
                try {
                    const timeout = new Promise((_, reject) => {
                        timer = setTimeout(() => {
                            controller.abort();
                            reject(Error("deadline"));
                        }, Math.max(1, parent.deadline_at - now()));
                    }), messages = [ {
                        role: "system",
                        content: growthProtocol(ctx)
                    }, {
                        role: "user",
                        content: JSON.stringify({
                            ...ctx.public,
                            references: ctx.refs,
                            instruction: ctx.instruction
                        })
                    } ];
                    let parsed;
                    for (let attempt = 0; attempt < 2; attempt++) {
                        if (now() >= parent.deadline_at) throw Error("deadline");
                        const result = await Promise.race([ provider(env, {
                            model: model,
                            tier: tier,
                            messages: messages,
                            deadline_at: parent.deadline_at,
                            signal: controller.signal
                        }), timeout ]);
                        for (const k of [ "prompt_tokens", "completion_tokens" ]) if (Number.isInteger(result.tokens?.[k]) && result.tokens[k] >= 0 && result.tokens[k] <= 1e9) metrics[k] += result.tokens[k];
                        if(typeof result.content==='string'&&result.content.length>5e5)throw Error("AI_RESPONSE_SIZE");
                        try {
                            if (typeof result.content !== "string" || result.content.length > 5e5) throw Error("format");
                            parsed = JSON.parse(result.content.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""));
                            if (!parsed || !Array.isArray(parsed.suggestions) || parsed.suggestions.length > 20 || parsed.suggestions.some(x => !x || !x.payload || typeof x.payload !== "object" || Array.isArray(x.payload))) throw Error("format");
                            break;
                        } catch {
                            if (attempt === 1 || parent.deadline_at-now()<30000) throw Error("AI_PROTOCOL_INVALID");
                            messages.push({
                                role: "user",
                                content: "请严格返回指定JSON"
                            });
                        }
                    }
                    if (now() >= parent.deadline_at) throw Error("deadline");
                    outcomes[index] = {
                        record: record,
                        metrics: metrics,
                        ...filterGrowthAi(parsed, ctx)
                    };
                } catch (e) {
                    metrics.failure_reason=aiFailureReason(e);
                    outcomes[index] = {
                        record: record,
                        metrics: metrics,
                        error: controller.signal.aborted || e.message === "deadline" ? "deadline" : "model_error"
                    };
                } finally {
                    clearTimeout(timer);
                    metrics.duration_ms = Math.max(0, now() - at);
                }
            }
        };
        await Promise.all(Array.from({
            length: Math.min(4, reserved.records.length)
        }, () => worker()));
        const live = await r.tenant(), policy = await r.growthLivePolicy();
        if (live.status !== "active" || live.expires_at && Date.parse(live.expires_at + "T23:59:59+08:00") <= now() || !policy.modules.growth_reports) {
            await r.growthAiAbort(parent, reserved.records, model, now());
            fail(live.status !== "active" || live.expires_at && Date.parse(live.expires_at + "T23:59:59+08:00") <= now() ? 403 : 404, "机构不可用", live.status !== "active" || live.expires_at && Date.parse(live.expires_at + "T23:59:59+08:00") <= now() ? "tenant_expired" : "not_found");
        }
        const suggestions = [], processed = [], warnings = [];
        for (const item of outcomes) {
            const row = eligible.find(x => x.student_id === item.record.student_id);
            if (item.error) skipped.push({
                student_id: row.student_id,
                report_id: row.id,
                reason: item.error,
                failure_reason:item.metrics.failure_reason||'other'
            }); else {
                suggestions.push(...item.suggestions);
                processed.push({
                    student_id: row.student_id,
                    report_id: row.id,
                    suggestion_ids: item.suggestions.map(x => x.id)
                });
                warnings.push(...item.warnings);
            }
        }
        const order = x => requested.indexOf(x.student_id);
        processed.sort((a, b) => order(a) - order(b));
        skipped.sort((a, b) => order(a) - order(b));
        const response = {
            suggestions: suggestions,
            processed: processed,
            skipped: skipped,
            warnings: [ ...new Set(warnings) ],
            usage: {
                tier: tier,
                used_today: 0,
                limit: limit
            }
        };
        const allFailed = eligible.length > 0 && processed.length === 0 && reserved.records.length > 0;
        await r.growthAiSettle(parent, outcomes, response, limit, now(), allFailed);
        if (allFailed) fail(502, "AI暂时无法完成，本次不计次数", outcomes.every(x=>x.metrics.failure_reason==='timeout')?"ai_timeout":"ai_unavailable");
        return json(await r.aiReplay(await r.aiRequestId(parent.id)));
    } catch (e) {
        const saved = await r.aiRequestId(parent.id);
        if (saved?.status === "done") return json(await r.aiReplay(saved));
        await r.growthAiAbort(parent, reserved.records, model, now());
        if (saved && saved.hold_id !== parent.hold_id) fail(409, "已由重试请求接管", "in_progress");
        if (e instanceof HttpError) throw e;
        fail(502, "AI结果暂时无法保存，本次不计次数", "ai_unavailable");
    }
}
