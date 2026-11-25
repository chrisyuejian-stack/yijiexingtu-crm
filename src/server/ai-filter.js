import {inlineText,inlinePlain} from './content-inline.js';
import {contentFlags,suggestionText,unsafeContent} from './content-flags.js';
import { randomId } from "./core.js";

import { preparePlan } from "./plan-document.js";

import { computedResponse } from "./plan-math.js";

import { blocks, text, list, object, blockText } from "./content-document.js";

import { validateSettingProposal } from "./tool-settings.js";

const scoreKey = k => /^(scores?|ratings?|previous|mock_exams|评分|分数|得分)$/i.test(k);

function stripScores(v, warnings) {
    if (Array.isArray(v)) return v.map(x => stripScores(x, warnings));
    if (!v || typeof v !== "object") return v;
    const out = {};
    for (const [key, value] of Object.entries(v)) if (scoreKey(key)) {
        warnings.push("已剔除AI返回的分数字段");
    } else out[key] = stripScores(value, warnings);
    return out;
}

// 模型输出的常见偏差在校验前先规整（只改结构，不补造内容）：
// 别名字段、字符串当段落、标题级别缺失、列表缺 ordered、对象形式的要点、HTML 标签去掉。
// 规整后仍按原规则严格校验；保存正文时的校验不受影响。
const stripTags = v => typeof v === "string" ? v.replace(/<\/?[a-z!][^>]*>/gi, "") : v;
const asText = v => typeof v === "string" ? stripTags(v) : v && typeof v === "object" ? stripTags(String(v.text ?? v.content ?? v.title ?? v.value ?? "")) : v == null ? "" : String(v);
const asTexts = v => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n+/) : v == null ? [] : [v]).map(asText).map(x => x.replace(/^\s*(?:[-*•·]|\d+[.、)])\s*/, "").trim()).filter(Boolean);
const BLOCK_ALIAS = { h1: ["heading", 2], h2: ["heading", 2], h3: ["heading", 3], title: ["heading", 2], subtitle: ["heading", 3], subheading: ["heading", 3], header: ["heading", 2], p: ["paragraph"], text: ["paragraph"], para: ["paragraph"], ul: ["list", false], bullets: ["list", false], bullet_list: ["list", false], unordered_list: ["list", false], ol: ["list", true], numbered_list: ["list", true], ordered_list: ["list", true], blockquote: ["quote"], hr: ["divider"], separator: ["divider"] };
function normalizeBlocks(input, basisCount,textFormat="plain") {
    const arr = typeof input === "string" ? input.split(/\n{2,}/).filter(x => x.trim()) : Array.isArray(input) ? input : [];
    return arr.map(raw => {
        if (typeof raw === "string") return { type: "paragraph", text: stripTags(raw).trim() };
        if (!raw || typeof raw !== "object") return raw;
        const b = { ...raw };
        const t = String(b.type ?? "paragraph").toLowerCase();
        const alias = BLOCK_ALIAS[t];
        b.type = alias ? alias[0] : t;
        if (["heading", "paragraph", "quote"].includes(b.type)) b.text = asText(b.text ?? b.content ?? b.value ?? "").trim();
        if (b.type === "heading") b.level = b.level === 3 || b.level === "3" || alias?.[1] === 3 ? 3 : 2;
        if (b.type === "list") {
            b.items = textFormat==='inline_v1'?(Array.isArray(b.items)?b.items:[b.content??b.text??'']).map(asText).filter(Boolean):asTexts(b.items ?? b.content ?? b.text);
            b.ordered = typeof b.ordered === "boolean" ? b.ordered : alias?.[1] === true;
        }
        if (b.type === "table" && Array.isArray(b.rows)) {
            const rows = b.rows.filter(Array.isArray).map(r => r.map(asText));
            const w = Math.max(0, ...rows.map(r => r.length));
            b.rows = rows.map(r => [...r, ...Array(w - r.length).fill("")]);
        }
        if (b.type === "image" && b.caption != null) b.caption = asText(b.caption);
        if (b.basis !== undefined) {
            const ok = (Array.isArray(b.basis) ? b.basis : [b.basis]).filter(n => Number.isInteger(n) && n >= 0 && n < basisCount);
            if (ok.length) b.basis = ok; else delete b.basis;
        }
        return b;
    }).filter(b => !(b && ["heading", "paragraph", "quote"].includes(b.type) && !b.text) && !(b && b.type === "list" && !b.items?.length));
}
export function normalizeContentPayload(action, p, basisCount = 0,textFormat="plain") {
    const out = { ...p };
    if (action === "outline") {
        const list0 = p.sections ?? p.outline ?? p.items ?? [];
        out.sections = (Array.isArray(list0) ? list0 : []).map((s, i) => typeof s === "string" ? { key: "s" + (i + 1), title: stripTags(s).trim(), required: false, points: [] } : s && typeof s === "object" ? {
            key: String(s.key ?? s.id ?? "s" + (i + 1)).trim() || "s" + (i + 1),
            title: asText(s.title ?? s.name ?? s.heading ?? "").trim(),
            required: !!s.required,
            points: asTexts(s.points ?? s.bullets ?? s.content ?? [])
        } : s);
    } else if (action === "section" || action === "rewrite") {
        out.blocks = normalizeBlocks(p.blocks ?? p.content ?? p.paragraphs ?? p.text ?? [], basisCount,textFormat);
    } else if (action === "versions") {
        let v = p.versions ?? p;
        if (Array.isArray(v)) v = { short: v[0], medium: v[1], long: v[2] };
        if (v && typeof v === "object") out.versions = Object.fromEntries(["short", "medium", "long"].map(k => [k, asText(v[k] ?? v[{ short: "短", medium: "中", long: "长" }[k]] ?? "").trim()]));
    }
    return out;
}

function plain(v, max = 2e3) {
    return text(v ?? "", "AI文字", max);
}

function basisFor(raw, ctx, warnings) {
    const out = [];
    for (const item of Array.isArray(raw) ? raw.slice(0, 100) : []) {
        if (!item || typeof item !== "object") {
            out.push({
                type: "unsupported",
                text: "模型依据格式无效"
            });
            continue;
        }
        const type = item.type;
        if (![ "rule", "consult", "feedback", "profile", "ai_judgement", "unsupported" ].includes(type)) {
            out.push({
                type: "unsupported",
                text: "模型依据类型无效"
            });
            continue;
        }
        let entry = {
            type: type
        };
        if (type === "ai_judgement" || type === "unsupported") {
            entry.text = plain(item.text);
            out.push(entry);
            continue;
        }
        const ref = typeof item.ref === "string" ? item.ref : type === "consult" ? "consult" : null, source = ref ? ctx.refs[ref] : null, quote = typeof item.quote === "string" ? item.quote : "";
        if (!source || quote && !source.includes(quote) || !quote && item.text && !source.includes(String(item.text))) {
            out.push({
                type: "unsupported",
                text: "所标依据无法在本次勾选资料中核对：" + plain(item.text || quote)
            });
            warnings.push("已将无法核验的引用标为unsupported");
            continue;
        }
        entry = {
            type: type,
            ref: ref,
            ...quote ? {
                quote: plain(quote)
            } : {},
            ...item.text ? {
                text: plain(item.text)
            } : {}
        };
        out.push(entry);
    }
    return out;
}

function ensureEvidence(value, basis, ctx) {
    const sentences = String(value).split(/[。！？\n]/).map(x => x.trim()).filter(Boolean);
    for (const sentence of sentences) if (!Object.values(ctx.refs).some(source => String(source).includes(sentence)) && !basis.some(x => x.type === "unsupported" && x.text === sentence)) basis.push({
        type: "unsupported",
        text: sentence
    });
}

function textPayload(payload, ctx, kind, warnings) {
    const result = [];
    for (const f of Array.isArray(payload.fields) ? payload.fields.slice(0, 100) : []) {
        let p = f?.path;
        if (typeof p !== "string") {
            warnings.push("已丢弃无效文字path");
            continue;
        }
        if(p==='about'||p.startsWith('about.')||p==='modules.about'||p.startsWith('modules.about.'))continue;
        if(/^(assessment|cover|fees|path|courses)\./.test(p))p='modules.'+p;
        let array = false, valid = /^(title|modules\.cover\.(eyebrow|subtitle)|modules\.assessment\.(text|source_note)|modules\.fees\.note)$/.test(p);
        if (/^modules\.assessment\.(strengths|gaps|goals)$/.test(p)) {
            valid = true;
            array = true;
        }
        let m = /^modules\.path\.stages\[key=(stk_[A-Za-z0-9_-]+)\]\.(name|goals)$/.exec(p);
        if (m) {
            valid = ctx.doc.modules.path.stages.some(x => x.key === m[1]);
            array = m[2] === "goals";
        }
        m = /^modules\.courses\.lines\[line_id=(ln_[A-Za-z0-9_-]+)\]\.(frequency_text|note|includes)$/.exec(p);
        if (m) {
            valid = ctx.doc.modules.courses.lines.some(x => x.line_id === m[1]);
            if (m[2] === "includes") {
                try {
                    const includes = list(f.value, "includes", 50).map(x => ({
                        label: plain(x.label, 500),
                        form: plain(x.form, 100),
                        schedule_text: plain(x.schedule_text, 500),
                        duration_text: plain(x.duration_text, 100)
                    }));
                    if (valid) result.push({
                        path: p,
                        value: includes
                    });
                    continue;
                } catch {
                    valid = false;
                }
            }
        }
        if (kind === "plan.fields" && /^meta\.(start_month|budget_cap|target\.(node_key|month|text))$/.test(p)) {
            try {
                const quote = plain(f.quote);
                if (!quote || !ctx.consult.includes(quote)) throw Error("quote");
                let value = f.value;
                if (p === "meta.budget_cap") {
                    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e8 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) throw Error("budget");
                } else {
                    value = plain(value, 1e3);
                    if (/(start_month|target.month)$/.test(p) && !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw Error("month");
                    if (p === "meta.target.node_key" && !ctx.catalog.settings.calendar?.items.some(x => x.key === value)) throw Error("node");
                }
                result.push({
                    path: p,
                    value: value,
                    quote: quote
                });
                continue;
            } catch {
                warnings.push("已丢弃无法核验的咨询表单字段：" + p.slice(0, 150).replace(/[<>]/g, ""));
                continue;
            }
        }
        if (ctx.action === "adjust" && ctx.input.page !== "courses" && !(p.startsWith("modules." + ctx.input.page + ".") || ctx.input.page === "cover" && p === "title")) valid = false;
        if (!valid) {
            warnings.push("已丢弃越界文字path：" + p.slice(0, 150).replace(/[<>]/g, ""));
            continue;
        }
        try {
            const value = array ? list(f.value, "value", 30).map(x => plain(x, 1e3)) : plain(f.value, 12e3);
            if (kind === "plan.fields") {
                const quote = plain(f.quote);
                if (!quote || !ctx.consult.includes(quote)) {
                    warnings.push("已丢弃无法核对咨询原话的字段：" + p);
                    continue;
                }
                result.push({
                    path: p,
                    value: value,
                    quote: quote
                });
            } else result.push({
                path: p,
                value: value
            });
        } catch {
            warnings.push("已丢弃格式不正确的文字字段：" + p);
        }
    }
    return {
        fields: result
    };
}

function variants(raws, ctx, warnings) {
    const out = [], old = ctx.doc, existing = new Map(old.modules.courses.lines.map(l => [ l.line_id, l ])), current = new Map(ctx.catalog.courses.map(c => [ c.id, c ]));
    const readonly = old.modules.courses.lines.filter(l => {
        const c = current.get(l.course_id);
        return !c || !c.active || c.price_cents === null || !JSON.parse(c.doc_json).pricing;
    });
    for (const raw of raws.slice(0, 10)) {
        const payload = raw?.payload ?? raw, lines = [];
        if (!Array.isArray(payload?.lines)) {
            warnings.push("已丢弃没有计费行集合的配法");
            continue;
        }
        for (const [i, line] of payload.lines.entries()) {
            if (!line || typeof line !== "object") {
                warnings.push("已丢弃无效课程行");
                continue;
            }
            const saved = existing.get(line.line_id);
            if (saved) {
                if (line.course_id !== saved.course_id) {
                    warnings.push("已丢弃擅自更换旧行课程的行");
                    continue;
                }
                if (readonly.some(l => l.line_id === saved.line_id)) {
                    lines.push(structuredClone(saved));
                    continue;
                }
                lines.push({
                    ...line,
                    line_id: saved.line_id
                });
            } else {
                const c = current.get(line.course_id);
                if (typeof line.line_id === "string" && line.line_id.startsWith("ln_") || !c || !c.active || c.price_cents === null || !JSON.parse(c.doc_json).pricing) {
                    warnings.push("已丢弃不在启用报价范围内或未定价的课程");
                    continue;
                }
                lines.push({
                    ...line,
                    line_id: "tmp_" + randomId("ai") + "_" + i
                });
            }
        }
        for (const saved of readonly) if (!lines.some(l => l.line_id === saved.line_id)) lines.push(structuredClone(saved));
        if (!lines.length) {
            warnings.push("没有合规计费行，已丢弃该配法");
            continue;
        }
        try {
            const settings = ctx.catalog.settings, source = {
                courses: ctx.catalog.courses,
                prospect: ctx.row?.prospect_enc ? ctx.public.student : null,
                stages: ctx.catalog.stages,
                rules: {
                    ...settings.stage_rules || {
                        rules: {},
                        version: 1
                    },
                    exists: !!settings.stage_rules
                },
                price_list_rev: settings.prices?.version || 1,
                prices_exists: !!settings.prices
            };
            const prepared = preparePlan({
                modules: {
                    courses: {
                        lines: lines
                    }
                }
            }, old, source, ctx.elements, old.style);
            if (prepared.doc.computed.budget.over) {
                warnings.push("已丢弃超过预算上限的配法");
                continue;
            }
            let bad = false;
            for (const rule of settings.course_rules?.items || []) for (const stage of old.modules.path.stages.filter(s => s.stage_type_id === rule.stage_type_id)) {
                const set = new Set(prepared.doc.modules.courses.lines.filter(l => l.stage_key === stage.key).map(l => l.course_id)), calc = prepared.doc.computed.stages.find(s => s.key === stage.key);
                if (rule.required.some(id => !set.has(id)) || rule.exclusive.some(group => group.filter(id => set.has(id)).length > 1) || calc.units < rule.units.min || calc.units > rule.units.max) bad = true;
            }
            if (bad) {
                warnings.push("已丢弃不满足本机构选课规则的配法");
                continue;
            }
            const reverse = Object.fromEntries(Object.entries(prepared.id_map).map(([a, b]) => [ b, a ]));
            out.push({
                raw: raw,
                payload: {
                    variant: "alt",
                    price_list_rev: source.price_list_rev,
                    lines: prepared.doc.modules.courses.lines.map(({snapshot: snapshot, ...line}) => ({
                        ...line,
                        line_id: reverse[line.line_id] || line.line_id
                    })),
                    computed: computedResponse(prepared.doc.computed)
                }
            });
        } catch (e) {
            warnings.push("已丢弃无效配法：" + (e.status ? e.message : "数据格式不正确"));
        }
    }
    // Prefer a compliant explicitly recommended variant; otherwise promote the first survivor.
        const preferred = out.findIndex(x => (x.raw.payload ?? x.raw).variant === "recommended");
    if (preferred > 0) out.unshift(...out.splice(preferred, 1));
    return out.slice(0, 3).map((item, i) => ({
        ...item,
        payload: {
            ...item.payload,
            variant: i === 0 ? "recommended" : "alt"
        }
    }));
}

export async function filterAi(parsed, ctx, r) {
    const warnings = [], safe = ctx.tool === 'content' ? parsed : stripScores(parsed, warnings);
    let kind, items = [];
    if (ctx.tool === "plan") {
        kind = ctx.action === "stage-courses" || ctx.action === "adjust" && ctx.input.page === "courses" ? "plan.stage_courses" : ctx.action === "fill-from-consult" ? "plan.fields" : "plan.text";
        if (kind === "plan.stage_courses") items = variants(safe.suggestions, ctx, warnings); else for (const raw of safe.suggestions) {
            const payload = textPayload(raw.payload ?? {}, ctx, kind, warnings);
            if (payload.fields.length) items.push({
                raw: raw,
                payload: payload
            });
        }
    } else if (ctx.tool === "settings") {
        kind = "settings.change";
        for (const raw of safe.suggestions) {
            try {
                const payload = object(raw.payload, "payload");
                if (!Array.isArray(payload.ops) || !payload.ops.length || payload.ops.length > 8) throw Error("ops");
                const validated = await validateSettingProposal(r, payload);
                items.push({
                    raw: raw,
                    payload: validated.payload,
                    target_versions: validated.target_versions
                });
            } catch (e) {
                warnings.push("已丢弃无法校验或目标已变化的设置建议");
            }
        }
    } else {
        kind = "content." + ctx.action.replaceAll("-", "_");
        for (const raw of safe.suggestions) {
            try {
                const p = normalizeContentPayload(ctx.action, object(raw.payload, "payload"), Array.isArray(raw.basis) ? raw.basis.length : 0,ctx.textFormat);
                let payload;
                if (ctx.action === "outline") {
                    const defs = ctx.public.content_types.find(x => x.name === ctx.doc.scene) || ctx.public.content_types[0], required = defs?.required || [];
                    payload = {
                        sections: list(p.sections, "sections", 30).map(s => ({
                            key: text(s.key, "key", 100, false),
                            title: plain(s.title, 200),
                            required: !!s.required,
                            points: list(s.points ?? [], "points", 30).map(x => plain(x, 1e3))
                        }))
                    };
                    if (!payload.sections.length || new Set(payload.sections.map(x => x.key)).size !== payload.sections.length) throw Error("sections");
                    for (const title of required) if (!payload.sections.some(s => s.title === title)) payload.sections.push({
                        key: "required_" + payload.sections.length,
                        title: title,
                        required: true,
                        points: []
                    });
                } else if (ctx.action === "section" || ctx.action === "rewrite") {
                    payload = {
                        ...ctx.action === "section" ? {
                            section_key: ctx.target.section_key
                        } : {
                            mode: ctx.input.mode
                        },
                        blocks: blocks(p.blocks, {
                            basisCount: Array.isArray(raw.basis) ? raw.basis.length : 0,textFormat:ctx.textFormat,warnings
                        })
                    };
                    const allowed = new Set(ctx.data.gallery.map(x => x.id));
                    payload.blocks = payload.blocks.filter(b => {
                        if (b.type === "image" && !allowed.has(b.image_id)) {
                            warnings.push("已丢弃勾选图库范围以外的图片");
                            return false;
                        }
                        return true;
                    });
                } else if (ctx.action === "versions") {
                    object(p.versions, "versions");
                    payload = {
                        versions: Object.fromEntries([ "short", "medium", "long" ].map(k => [ k, ctx.textFormat==='inline_v1'?inlineText(p.versions[k],'versions.'+k,20000,false,warnings):text(p.versions[k], 'versions.'+k, 20000, false) ]))
                    };
                } else if (ctx.action === "images") {
                    const allowed = new Set(ctx.data.gallery.map(x => x.id));
                    payload = {
                        items: list(p.items, "items", 50).map(x => ({
                            section_key: plain(x.section_key, 100),
                            image_ids: list(x.image_ids, "image_ids", 20).filter(id => {
                                if (!allowed.has(id)) {
                                    warnings.push("已丢弃本次图库范围以外的图片");
                                    return false;
                                }
                                return true;
                            }),
                            reason: plain(x.reason)
                        })).filter(x => x.image_ids.length)
                    };
                } else {
                    payload = {
                        items: list(p.items, "items", 100).flatMap(x => {
                            if (!Number.isInteger(x.block_index) || x.block_index < 0 || x.block_index >= ctx.doc.blocks.length) {
                                warnings.push("已丢弃无法定位的核对项");
                                return [];
                            }
                            const quote = ctx.textFormat==='inline_v1'?inlinePlain(plain(x.quote,1e4)):plain(x.quote, 1e4);
                            if (!quote || !blockText(ctx.doc.blocks[x.block_index],ctx.textFormat).includes(quote)) {
                                warnings.push("已丢弃原文不匹配的核对项");
                                return [];
                            }
                            const source = typeof x.source === 'string' ? x.source : '', expected = ctx.refs[source] ?? '';
                            const flags=contentFlags(quote,ctx.flagFacts);
                            const mismatch=flags.find(f=>f.kind==='fact_mismatch');
                            const exactField=/^profile\.(address|contact_phone)$/.test(source)&&!!expected;
                            return [{result:mismatch||exactField&&!quote.includes(expected)&&!expected.includes(quote)?'mismatch':expected && (expected.includes(quote)||quote.includes(expected))?'ok':'needs_confirm',block_index:x.block_index,quote,expected:mismatch?.text||expected,source:mismatch?.source||(expected?source:'')}];
                        })
                    };
                }
                if (payload.blocks && !payload.blocks.length || payload.items && !payload.items.length) {
                    warnings.push("没有符合本次资料范围的内容建议");
                    continue;
                }
                items.push({
                    raw: raw,
                    payload: payload
                });
            } catch {
                warnings.push("已丢弃格式不正确的内容建议");
            }
        }
    }
    const suggestions = [];
    for (const item of items.slice(0, 20)) {
        const ownWarnings = [];
        let basis;
        try {
            basis = basisFor(item.raw.basis, ctx, ownWarnings);
        } catch {
            basis = [ {
                type: "unsupported",
                text: "模型提供的依据无法核验"
            } ];
            ownWarnings.push("已将格式错误的依据标为unsupported");
        }
        let flags;
        if(ctx.tool === 'content'){
            if(ctx.textFormat==='inline_v1'&&['rewrite','section','versions'].includes(ctx.action))item.payload.text_format='inline_v1';
            if(ctx.textFormat==='inline_v1'&&ctx.action==='fact-check')for(const hit of item.payload.items){const plain=blockText(ctx.doc.blocks[hit.block_index],ctx.textFormat),at=plain.indexOf(hit.quote);if(at>=0)hit.plain_span={start:[...plain.slice(0,at)].length,end:[...plain.slice(0,at)].length+[...hit.quote].length};}
            // References may be unverified: omit those entries, never discard creative text.
            basis = basis.filter(x=>x.type !== 'unsupported');
            ownWarnings.length=0;
            if(item.payload.blocks)for(const b of item.payload.blocks)delete b.basis;
            const value=suggestionText(item.payload);
            if(unsafeContent(value)){warnings.push('已丢弃不安全的内容建议');continue;}
            const facts=await r.contentFlagFacts(value);
            flags=contentFlags(value,{...ctx.flagFacts,...facts});
            if(ctx.action==='fact-check')for(const x of item.payload.items)if(x.result==='mismatch'&&value.includes(x.quote)&&!flags.some(f=>f.kind==='fact_mismatch'&&f.quote===x.quote))flags.push({kind:'fact_mismatch',quote:x.quote,text:'机构资料为 '+x.expected,source:x.source});
        }
        suggestions.push({
            id: randomId("sg"),
            kind: kind,
            target: ctx.target,
            payload: item.payload,
            basis: basis,
            warnings: ownWarnings,
            ...(flags ? {flags} : {}),
            ...item.target_versions ? {
                target_versions: item.target_versions
            } : {}
        });
        warnings.push(...ownWarnings);
    }
    if (!suggestions.length && !warnings.length) warnings.push("未找到符合本次条件的建议，请调整资料后再试");
    return {
        suggestions: suggestions,
        warnings: [ ...new Set(warnings) ]
    };
}
