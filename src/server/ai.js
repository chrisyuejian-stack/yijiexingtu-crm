import {planV2AiContext,planV2Protocol,filterPlanV2} from './plan-v2-ai.js';
import {aiTimeoutMs,aiMaxTokens,aiFailureReason,aiFault,planTextProtocol} from './ai-policy.js';
import {growthAiContext,filterGrowthAi,growthAiBatch,growthProtocol} from './growth-ai.js';
import { repo } from "./repo.js";

import { body, json, fail, HttpError, randomId, now, sha } from "./core.js";

import { can } from "./permissions.js";

import { planIso } from "./plan-document.js";

import { planDate } from "./plan-math.js";

import { text, invalid, object } from "./content-document.js";

import { aiContext } from "./ai-context.js";

import { filterAi } from "./ai-filter.js";

export const aiPath = p => /^\/api\/ai\/(?:usage|plan\/(?:brief|fill-from-consult|stage-courses|polish|adjust)|content\/(?:outline|section|versions|rewrite|fact-check|images)|settings\/propose|feedback\/compose|report\/(?:draft|batch-draft))$/.test(p);

export const aiDate = at => new Date(at).toLocaleDateString("sv-SE", {
    timeZone: "Asia/Shanghai"
});

const canonical = (v, depth = 0) => {
    if (depth > 30) invalid("请求嵌套过深");
    return Array.isArray(v) ? v.map(x => canonical(x, depth + 1)) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [ k, canonical(v[k], depth + 1) ])) : v;
};

function quotaError(tier, limit, date) {
    const e = new HttpError(429, "今天的" + (tier === "fast" ? "快速" : "深度") + " AI次数已用完，明天0点恢复", "ai_quota_exceeded");
    e.details = {
        tier: tier,
        limit: limit,
        reset_at: planIso(Date.parse(date + "T00:00:00+08:00") + 864e5)
    };
    throw e;
}

function checkTenant(t) {
    if (!t || t.deleted_at) fail(404, "不存在", "not_found");
    if (t.status !== "active" || t.expires_at && Date.parse(t.expires_at + "T23:59:59+08:00") <= now()) fail(403, "机构已到期或停用", "tenant_expired");
}

function publicSuggestion(s) {
    return {
        id: s.id,
        kind: s.kind,
        target: s.target,
        payload: s.payload,
        basis: s.basis,
        warnings: s.warnings,
        ...(s.flags ? {flags:s.flags} : {})
    };
}

async function provider(env, request) {
    if (typeof env.AI_PROVIDER === "function") return env.AI_PROVIDER(request);
    const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
            Authorization: "Bearer " + env.DEEPSEEK_API_KEY,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: request.model,
            messages: request.messages,
            response_format: {
                type: "json_object"
            },
            max_tokens: request.max_tokens ?? (request.tier === "fast" ? 4096 : 8192),
            stream: false,
            ...(request.temperature !== undefined ? {temperature: request.temperature} : {})
        }),
        signal: request.signal
    });
    if (!res.ok) throw aiFault('provider_http_'+res.status);
    let value;
    try {
        const reader=res.body?.getReader(),chunks=[];let length=0;
        if(!reader)throw aiFault('protocol_invalid');
        for(;;){const x=await reader.read();if(x.done)break;length+=x.value.length;if(length>2*1024*1024){await reader.cancel();throw aiFault('response_too_large')}chunks.push(x.value);}
        const bytes=new Uint8Array(length);let at=0;for(const x of chunks){bytes.set(x,at);at+=x.length;}value=JSON.parse(new TextDecoder().decode(bytes));
    } catch(e) {if(e.ai_failure_reason||e.name==='AbortError')throw e;throw aiFault('protocol_invalid');}
    return {
        content: value.choices?.[0]?.message?.content,
        tokens: value.usage || {}
    };
}

function baseProtocol(ctx) {
    if(['feedback','report'].includes(ctx.tool)) return growthProtocol(ctx);
    const strict = ctx.tool === 'content' ? '内容创作优先：可以自由创作，使用常识、行业知识、热点话题、比喻和故事。勾选的机构资料、课程、往期内容和用户素材仅作参考，不必逐句有出处。不得编造本机构的具体价格、日期、老师姓名和履历、获奖或录取成绩、学员姓名和成绩；缺失时使用【待填：……】。语气='+(ctx.tone||'balanced')+'。' : '不得编造事实、不得生成评分。basis.type只能是rule/consult/feedback/profile/ai_judgement/unsupported，引用ref和quote必须来自给定资料。';
    return strict + '只返回JSON对象 {"suggestions":[{"payload":{},"basis":[],"warnings":[]}]}。不得写业务数据。' + (ctx.tool === "plan" ? "课程配法payload为{variant,lines}完整行集合，保留旧line_id与course_id；新行只用课程库course_id，不能给金额或快照。文字payload为{fields:[{path,value,quote}]}，阶段path按[key=stk_...]、课程行按[line_id=ln_...]定位，不使用数组下标。" : "内容块只允许heading(text,level2或3)、paragraph(text)、list(items字符串数组,ordered布尔)、table(rows字符串二维数组)、quote(text)、image(image_id,caption)、divider。不含HTML。") + "当前工具=" + ctx.tool + "；动作=" + ctx.action + "。" + (ctx.tool === "content" ? "payload遵循：outline={sections:[{key,title,required,points}]}；section={section_key,blocks}；versions={versions:{short,medium,long}}；rewrite={mode,blocks}；fact-check={items:[{result,block_index,quote,expected,source}]}；images={items:[{section_key,image_ids,reason}]}。所有文字字段都是纯字符串（不是对象、不含HTML或Markdown符号）；heading必须带level(2或3)；list必须带ordered(true/false)且items为字符串数组。示例：outline返回{\"suggestions\":[{\"payload\":{\"sections\":[{\"key\":\"intro\",\"title\":\"小标题\",\"required\":true,\"points\":[\"要点\"]}]},\"basis\":[],\"warnings\":[]}]}；section返回{\"suggestions\":[{\"payload\":{\"section_key\":\"intro\",\"blocks\":[{\"type\":\"heading\",\"text\":\"小标题\",\"level\":2},{\"type\":\"paragraph\",\"text\":\"正文\"},{\"type\":\"list\",\"items\":[\"一条\"],\"ordered\":false}]},\"basis\":[],\"warnings\":[]}]}；versions返回{\"suggestions\":[{\"payload\":{\"versions\":{\"short\":\"短版全文\",\"medium\":\"中版全文\",\"long\":\"长版全文\"}},\"basis\":[],\"warnings\":[]}]}。" : "") + (ctx.tool === "settings" ? 'payload为{ops:[{op:"update",entity,id?,key?,field,from,to}],side_effects:[],affected:{}}；entity限course/price/stage_type/stage_rule/calendar/course_rule/report_class，from使用当前实际值。' : "");
}

export function protocol(ctx) {if(ctx.v2)return planV2Protocol(ctx);const base=baseProtocol(ctx)+planTextProtocol(ctx);return ctx.tool==='content'&&ctx.textFormat==='inline_v1'?base.replace('不含HTML或Markdown符号','不含HTML；允许下述行内标记')+'\n正文格式 inline_v1：仅 **加粗**、*斜体*、==高亮==、[[品牌强调]]，同段成对，不嵌套。保留原有标记，可少量新增加粗/高亮。不得改动 article 元信息。':base;}

export async function aiApi(req, env, resolved, user, policy, url) {
    const path = resolved.relative;
    if (!aiPath(path)) return undefined;
    env.__identityContract = true;
    const r = repo(env, resolved.tenant.id), config = await r.aiConfig();
    if (path === "/api/ai/usage" && req.method === "GET") {
        const date = url.searchParams.get("date") || aiDate(now());
        planDate(date);
        const data = await r.aiUsage(date, user.roles.includes("supervisor")), daily = Object.fromEntries(data.daily.map(x => [ x.tier, x.used ]));
        return json({
            date: date,
            fast: {
                used: daily.fast || 0,
                limit: config.fast_limit
            },
            deep: {
                used: daily.deep || 0,
                limit: config.deep_limit
            },
            ...data.by_tool ? {
                by_tool: data.by_tool,
                by_user: data.by_user
            } : {},
            warnings: []
        });
    }
    if (path === "/api/ai/usage" || req.method !== "POST") fail(404, "不存在", "not_found");
    const [, tool, action] = /^\/api\/ai\/([^/]+)\/([^/]+)$/.exec(path);
    if(tool==='report' && action==='batch-draft') return growthAiBatch(req,env,resolved,user,policy,config,provider);
    const growing = ['feedback','report'].includes(tool);
    const module = growing ? 'growth_reports' : tool === "plan" ? "plans" : tool === "content" ? "content" : "settings";
    if (!policy.modules[module]) fail(404, "不存在", "not_found");
    if (!growing && (!can(user, policy, "ai", "use", {
        tool: module
    }) || !can(user, policy, module, tool === "settings" ? "propose" : "write", {
        settings_scope: "tools"
    }))) fail(403, "没有此操作权限", "forbidden");
    const d = await body(req), tier = d.tier ?? "fast",v2plan=tool==='plan'&&(d.doc_version===2||action==='brief'),received=now();
    if (![ "fast", "deep" ].includes(tier)) invalid("AI档位不正确", "tier");
    const key = req.headers.get("Idempotency-Key");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key || "")) invalid("请提供UUID格式的Idempotency-Key", "Idempotency-Key");
    if (tool === "plan" && !v2plan && action === "adjust" && ![ "cover", "assessment", "path", "courses", "fees", "teachers", "about" ].includes(d.page)) invalid("调整页不正确", "page");
    const hash = await sha(JSON.stringify(canonical(d))), old = await r.aiRequest(user.id, key);
    if (old && (old.request_hash !== hash || old.path !== path)) fail(422, "同一个幂等键不能用于不同请求", "idempotency_mismatch");
    if (old?.status === "done") return json(await r.aiReplay(old));
    if (old?.status === "pending" && old.deadline_at > now()) fail(409, "这个AI请求仍在处理中", "in_progress");
    const ctx = growing ? await growthAiContext(r,tool,action,d,user,policy) : v2plan?await planV2AiContext(r,action,d,user,env,resolved.tenant.id):await aiContext(r, tool, action, d, user, policy);
    if(v2plan)ctx.terms=(await r.planTerms()).map(x=>x.term);
    ctx.input = d;
    const model = config[tier + "_model"];
    if (!model || !env.DEEPSEEK_API_KEY && typeof env.AI_PROVIDER !== "function") fail(503, "请先在平台配置AI模型和服务密钥", "configuration_missing");
    const at = v2plan?received:now(), date = aiDate(at), limit = config[tier + "_limit"], deadline = at + aiTimeoutMs(tool,action,tier,v2plan?2:1), record = {
        ...(ctx.reference_audit?{reference_audit:ctx.reference_audit}:{}),
        id: old?.id || randomId("air"),
        user_id: user.id,
        idem_key: key,
        request_hash: hash,
        path: path,
        hold_id: randomId("hold"),
        date: date,
        tier: tier,
        deadline_at: deadline,
        hold_expires_at: Math.max(at+120000,deadline)
    };
    const acquired = await r.aiAcquire(record, old, limit, at);
    if (!acquired.ok) {
        await checkTenant(await r.tenant());
        const latest = acquired.latest;
        if (latest?.status === "done") return json(await r.aiReplay(latest));
        if (latest?.status === "pending" && latest.deadline_at > now() && latest.idem_key === key) fail(409, "这个AI请求仍在处理中", "in_progress");
        await r.aiRejected(record, {
            tool: module,
            action: action,
            model: model
        }, now());
        if (acquired.capacity.pending >= 2) fail(429, "同时最多进行两个AI请求，请稍后再试", "rate_limited");
        quotaError(tier, limit, date);
    }
    const controller = new AbortController, metrics = {
        tool: module,
        action: action,
        model: model,
        prompt_tokens: 0,
        completion_tokens: 0,
        duration_ms: 0
    }, messages = [ {
        role: "system",
        content: protocol(ctx)
    }, {
        role: "user",
        content: JSON.stringify({
            ...ctx.public,
            references: ctx.refs,
            ...(tool === "content" ? {tone:ctx.tone, user_references:ctx.userReferences} : {}),
            instruction: ctx.instruction
        })
    } ];
    let timer;
    try {
        const unavailable = new Promise((_, reject) => {
            timer = setTimeout(() => {
                controller.abort();
                reject(Error("AI_DEADLINE"));
            }, Math.max(1, deadline - now()));
        });
        let parsed;
        for (let attempt = 0; attempt < 2; attempt++) {
            if (now() >= deadline) throw Error("AI_DEADLINE");
            const result = await Promise.race([ provider(env, {
                model: model,
                tier: tier,
                messages: messages,
                signal: controller.signal,
                max_tokens: aiMaxTokens(tool,action,tier,v2plan?2:1),
                ...(tool === 'content' ? {temperature:1.1} : {}),
                deadline_at: deadline
            }), unavailable ]);
            for (const name of [ "prompt_tokens", "completion_tokens" ]) {
                const n = result.tokens?.[name];
                if (Number.isInteger(n) && n >= 0 && n <= 1e9) metrics[name] += n;
            }
            if(typeof result.content === "string" && result.content.length>5e5)throw Error("AI_RESPONSE_SIZE");
            try {
                const content = typeof result.content === "string" ? result.content.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, "") : null;
                if (!content || content.length > 5e5) throw Error("format");
                parsed = JSON.parse(content);
                if (!parsed || !Array.isArray(parsed.suggestions) || parsed.suggestions.length > 20 || parsed.suggestions.some(x => !x || typeof x !== "object" || !x.payload || typeof x.payload !== "object" || Array.isArray(x.payload))) throw Error("format");
                break;
            } catch {
                if (attempt === 1 || deadline-now()<30000) throw Error("AI_PROTOCOL_INVALID");
                messages.push({
                    role: "user",
                    content: "上一条未能解析，请严格返回指定JSON结构。"
                });
            }
        }
        if (now() >= deadline) throw Error("AI_DEADLINE");
        const filtered = growing ? filterGrowthAi(parsed,ctx) : v2plan?await filterPlanV2(parsed,ctx):await filterAi(parsed, ctx, r);
        await checkTenant(await r.tenant());
        const livePolicy = growing ? await r.growthLivePolicy() : await r.policy();
        if (!livePolicy.modules[module]) fail(404, "不存在", "not_found");
        if(now()>=deadline)throw Error("AI_DEADLINE");
        metrics.duration_ms = Math.max(0, now() - at);
        if(v2plan)for(const suggestion of filtered.suggestions)suggestion._request_id=record.id;
        const response = {
            suggestions: filtered.suggestions.map(publicSuggestion),
            warnings: filtered.warnings,
            usage: {
                tier: tier,
                used_today: 0,
                limit: limit
            }
        };
        if ((new TextEncoder).encode(JSON.stringify(response)).byteLength > 25e4) throw Error("AI_RESPONSE_SIZE");
        const finished = await r.aiFinish(record, response, filtered.suggestions, metrics, limit, now());
        if (finished.replay) return json(await r.aiReplay(finished.request));
        if (finished.blocked) {
            checkTenant(await r.tenant());
            quotaError(tier, limit, date);
        }
        if (finished.lost) fail(409, "该请求已结束或由重试请求接管", "in_progress");
        return json(await r.aiReplay(await r.aiRequestId(record.id)));
    } catch (e) {
        if(growing){const saved=await r.aiRequestId(record.id);if(saved?.status==='done')return json(await r.aiReplay(saved));}
        metrics.duration_ms = Math.max(0, now() - at);
        metrics.failure_reason=aiFailureReason(e);
        await r.aiFailure(record, metrics, now());
        if (e instanceof HttpError) throw e;
        fail(502, "AI暂时无法完成请求，请稍后重试，本次不计次数", metrics.failure_reason==='timeout'?"ai_timeout":"ai_unavailable");
    } finally {
        clearTimeout(timer);
        controller.abort();
    }
}

export async function aiOps(req, env, url, admin) {
    if (url.pathname !== "/api/ops/ai/settings") return undefined;
    const r = repo(env, null), old = await r.aiPlatformSettings();
    if (req.method === "GET") return json(old);
    if (req.method !== "PUT") fail(404, "不存在", "not_found");
    const d = await body(req);
    if (d.version !== old.version) {
        const e = new HttpError(409, "平台设置已变化", "version_conflict");
        e.details = {
            latest: old
        };
        throw e;
    }
    const value = {
        version: old.version
    };
    for (const tier of [ "fast", "deep" ]) {
        const n = d[tier + "_daily_limit"];
        if (!Number.isInteger(n) || n < 0 || n > 1e6) invalid("每日上限必须为非负整数", tier + "_daily_limit");
        value[tier + "_daily_limit"] = n;
        value[tier + "_model"] = text(d[tier + "_model"], tier + "_model", 200, false);
    }
    try {
        await r.aiSaveSettings(value, admin);
    } catch (e) {
        if (/expected=actual/.test(String(e))) {
            const error = new HttpError(409, "平台设置已变化", "version_conflict");
            error.details = {
                latest: await r.aiPlatformSettings()
            };
            throw error;
        }
        throw e;
    }
    return json(await r.aiPlatformSettings());
}
