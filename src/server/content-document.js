import {inlineText,inlinePlain} from './content-inline.js';
import { HttpError, fail } from "./core.js";

import { subjectPacks } from "./subject-packs.js";

import { planIso } from "./plan-document.js";
import { planDate } from "./plan-math.js";

export const contentTypes = [ "article", "moments", "xhs", "poster_text", "group_notice", "event_invite" ];

export const contentStates = [ "draft", "ready", "copied", "published" ];

export function invalid(message, field = "body") {
    const e = new HttpError(422, message, "validation_failed");
    e.details = {
        fields: [ {
            field: field,
            message: message
        } ]
    };
    throw e;
}

export function text(v, field, max = 2e3, empty = true) {
    if (typeof v !== "string" || v.length > max || !empty && !v.trim() || /<\/?[a-z!][^>]*>/i.test(v)) invalid("请使用符合长度限制的纯文字，不要包含HTML标签", field);
    return v.trim();
}

export function object(v, field) {
    if (!v || typeof v !== "object" || Array.isArray(v)) invalid("须为对象", field);
    return v;
}

export function list(v, field, max = 100) {
    if (!Array.isArray(v) || v.length > max) invalid("数组格式或数量不正确", field);
    return v;
}

export function ids(v, field, max = 100) {
    const a = list(v, field, max).map(x => text(x, field, 100, false));
    if (new Set(a).size !== a.length) invalid("编号不能重复", field);
    return a;
}

export function sources(v = {}) {
    object(v, "sources");
    const flags = {};
    for (const key of [ "profile", "prices" ]) {
        const val = v[key] ?? false;
        if (typeof val !== "boolean") invalid("勾选项须为布尔值", "sources." + key);
        flags[key] = val;
    }
    return {
        ...flags,
        course_ids: ids(v.course_ids ?? [], "sources.course_ids"),
        gallery_tags: ids(v.gallery_tags ?? [], "sources.gallery_tags", 30)
    };
}

export function blocks(input, {basisCount: basisCount = null,textFormat='plain',warnings=[]} = {}) {
    const blockString=(v,field,max)=>textFormat==='inline_v1'?inlineText(v,field,max,true,warnings):text(v,field,max);
    return list(input, "blocks", 100).map((raw, i) => {
        const b = object(raw, "blocks[" + i + "]"), field = "blocks[" + i + "]";
        let out;
        if ([ "heading", "paragraph", "quote" ].includes(b.type)) {
            out = {
                type: b.type,
                text: blockString(b.text, field + ".text", 2e4)
            };
            if (b.type === "heading") {
                if (![ 2, 3 ].includes(b.level)) invalid("标题级别只能为2或3", field + ".level");
                out.level = b.level;
            }
        } else if (b.type === "list") {
            if (typeof b.ordered !== "boolean") invalid("ordered须为布尔值", field + ".ordered");
            out = {
                type: b.type,
                items: list(b.items, field + ".items", 100).map(x => blockString(x, field + ".items", 3e3)),
                ordered: b.ordered
            };
        } else if (b.type === "table") {
            const rows = list(b.rows, field + ".rows", 100).map(row => list(row, field + ".row", 20).map(x => blockString(x, field + ".cell", 3e3)));
            if (!rows.length || !rows[0].length || rows.some(x => x.length !== rows[0].length)) invalid("表格须有表头且每行列数相同", field + ".rows");
            out = {
                type: b.type,
                rows: rows
            };
        } else if (b.type === "image") out = {
            type: b.type,
            image_id: text(b.image_id, field + ".image_id", 100, false),
            caption: blockString(b.caption ?? "", field + ".caption", 1e3)
        }; else if (b.type === "divider") out = {
            type: b.type
        }; else invalid("不支持的内容块类型", field + ".type");
        if (basisCount !== null && b.basis !== undefined) out.basis = list(b.basis, field + ".basis", 100).map(n => {
            if (!Number.isInteger(n) || n < 0 || n >= basisCount) invalid("依据下标无效", field + ".basis");
            return n;
        });
        return out;
    });
}

// Optional article metadata is replaced as one object; omitted leaves the old value intact.
export function articleMetadata(value) {
    if (value === null) return null;
    object(value, "article");
    const out = {};
    for (const key of ["column", "author"]) {
        if (value[key] !== undefined) out[key] = text(value[key], "article." + key, 20);
    }
    if (value.header_image_id !== undefined) out.header_image_id = value.header_image_id === null ? null : text(value.header_image_id, "article.header_image_id", 100, false);
    if (value.publish_date !== undefined) {
        if (value.publish_date === null || value.publish_date === "") out.publish_date = null;
        else { planDate(value.publish_date, "article.publish_date"); out.publish_date = value.publish_date; }
    }
    if (value.footer !== undefined) {
        object(value.footer, "article.footer");
        out.footer = {};
        for (const key of ["qr", "address"]) if (value.footer[key] !== undefined) {
            if (typeof value.footer[key] !== "boolean") invalid("文末开关须为布尔值", "article.footer." + key);
            out.footer[key] = value.footer[key];
        }
    }
    return out;
}

export function contentImageIds(doc) {
    return [ ...new Set([...doc.blocks.filter(b => b.type === "image").map(b => b.image_id), doc.article?.header_image_id].filter(Boolean)) ];
}

export function prepareContent(d, old, style, warnings=[]) {
    const textFormat=d.text_format??old?.text_format??'plain';if(!['plain','inline_v1'].includes(textFormat))invalid('正文格式不正确','text_format');
    object(d, "content");
    const type = d.type ?? old?.type, subject = d.subject ?? old?.subject;
    if (!contentTypes.includes(type)) invalid("内容类型不正确", "type");
    if (!Object.hasOwn(subjectPacks, subject)) invalid("学科未开放", "subject");
    const scene = d.scene === undefined ? old?.scene ?? null : d.scene;
    return {
        type: type,
        text_format:textFormat,
        article: articleMetadata(d.article === undefined ? old?.article ?? null : d.article),
        subject: subject,
        scene: scene === null ? null : text(scene, "scene", 100),
        title: text(d.title ?? old?.title ?? "未命名内容", "title", 200, false),
        style: style,
        brief: text(d.brief ?? old?.brief ?? "", "brief", 1e4),
        sources: sources(d.sources ?? old?.sources ?? {}),
        blocks: blocks(d.blocks ?? old?.blocks ?? [],{textFormat,warnings}),
        applied_suggestion_ids: ids(d.applied_suggestion_ids ?? old?.applied_suggestion_ids ?? [], "applied_suggestion_ids", 30)
    };
}

export function contentDto(row) {
    return {
        ...JSON.parse(row.doc_json),
        text_format:JSON.parse(row.doc_json).text_format??"plain",
        article: row.article_json === undefined ? JSON.parse(row.doc_json).article ?? null : JSON.parse(row.article_json),
        id: row.id,
        version: row.version,
        status: row.status,
        author_id: row.author_id,
        created_at: planIso(row.created_at),
        updated_at: planIso(row.updated_at)
    };
}

export function contentConflict(row) {
    const e = new HttpError(409, "内容已被修改，请刷新后重试", "version_conflict");
    e.details = {
        latest: row ? contentDto(row) : null
    };
    throw e;
}

export function blockText(block,textFormat="plain") {
    const value=block.text ?? block.caption ?? block.items?.join("\n") ?? block.rows?.map(r => r.join(" | ")).join("\n") ?? "";return textFormat==="inline_v1"?inlinePlain(value):value;
}
