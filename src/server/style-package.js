import { invalid, object, text, ids } from "./content-document.js";

import { imageInfo } from "./tool-settings.js";

import { stableKey, packVersion, docTypes } from "./platform-validation.js";

export function assetPath(path) {
    if (typeof path !== "string" || path.length > 250 || path.startsWith("/") || path.includes("\\") || path.includes("..") || path.includes("\0") || path.includes(":") || path.includes("%") || path !== path.normalize("NFC") || !/\.(?:png|jpg|jpeg|webp)$/i.test(path) || path.split("/").some(segment => !/^[\p{L}\p{N}_-][\p{L}\p{N}_.-]*$/u.test(segment))) invalid("资源路径不正确", "asset_path");
    return path;
}

const crc = data => {
    let v = 4294967295;
    for (const b of data) {
        v ^= b;
        for (let i = 0; i < 8; i++) v = v >>> 1 ^ (v & 1 ? 3988292384 : 0);
    }
    return (v ^ 4294967295) >>> 0;
};

async function unzip(bytes) {
    if (bytes.length < 22 || bytes.length > 10 * 1024 * 1024) invalid("ZIP体积超限或损坏", "file");
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), dec = new TextDecoder("utf-8", {
        fatal: true
    });
    let e = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 101010256) {
        e = i;
        break;
    }
    if (e < 0 || v.getUint16(e + 4, true) || v.getUint16(e + 6, true) || v.getUint16(e + 8, true) !== v.getUint16(e + 10, true) || e + 22 + v.getUint16(e + 20, true) !== bytes.length) invalid("不支持此ZIP结构", "file");
    const count = v.getUint16(e + 10, true), end = v.getUint32(e + 16, true) + v.getUint32(e + 12, true);
    let at = v.getUint32(e + 16, true), total = 0;
    const files = new Map, intervals = [];
    if (!count || count > 200 || end !== e) invalid("ZIP目录不正确", "file");
    for (let i = 0; i < count; i++) {
        if (at + 46 > end || v.getUint32(at, true) !== 33639248) invalid("ZIP目录损坏", "file");
        const flags = v.getUint16(at + 8, true), method = v.getUint16(at + 10, true), sum = v.getUint32(at + 16, true), size = v.getUint32(at + 20, true), raw = v.getUint32(at + 24, true), n = v.getUint16(at + 28, true), ex = v.getUint16(at + 30, true), co = v.getUint16(at + 32, true), local = v.getUint32(at + 42, true), mode = v.getUint32(at + 38, true) >>> 16;
        let name;
        try {
            name = dec.decode(bytes.slice(at + 46, at + 46 + n));
        } catch {
            invalid("文件名编码不正确", "file");
        }
        at += 46 + n + ex + co;
        if (at > end || flags & 1 || ![ 0, 8 ].includes(method) || (mode & 61440) === 40960 || local + 30 > e || v.getUint32(local, true) !== 67324752 || v.getUint16(local + 8, true) !== method) invalid("ZIP含不支持结构", "file");
        const ln = v.getUint16(local + 26, true), le = v.getUint16(local + 28, true), start = local + 30 + ln + le;
        if (dec.decode(bytes.slice(local + 30, local + 30 + ln)) !== name || start + size > v.getUint32(e + 16, true) || intervals.some(([a, b]) => local < b && start + size > a)) invalid("ZIP数据范围不正确", "file");
        intervals.push([ local, start + size ]);
        if (name.startsWith("assets/") && name.endsWith("/") && raw === 0) {
            const dir = name.slice(7, -1);
            if (dir) assetPath(dir + "/directory.png");
            continue;
        }
        if (name !== "manifest.json" && (!name.startsWith("assets/") || !assetPath(name.slice(7)))) invalid("只允许manifest和图片", "file");
        if (files.has(name) || raw > (name === "manifest.json" ? 18e4 : 2 * 1024 * 1024) || (total += raw) > 10 * 1024 * 1024) invalid("重复文件或解压体积超限", "file");
        let data = bytes.slice(start, start + size);
        if (method === 8) {
            const reader = new Blob([ data ]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader(), chunks = [];
            let length = 0;
            for (;;) {
                const x = await reader.read();
                if (x.done) break;
                length += x.value.length;
                if (length > raw) {
                    await reader.cancel();
                    invalid("解压体积不符", "file");
                }
                chunks.push(x.value);
            }
            data = new Uint8Array(length);
            let off = 0;
            for (const x of chunks) {
                data.set(x, off);
                off += x.length;
            }
        }
        if (data.length !== raw || crc(data) !== sum) invalid("ZIP CRC校验失败", "file");
        files.set(name, data);
    }
    if (at !== end || !files.has("manifest.json")) invalid("缺少manifest", "file");
    return files;
}

const luminance = c => {
    const rgb = [ 1, 3, 5 ].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
};

export const contrast = (a, b) => {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};

export async function stylePackage(bytes) {
    const files = await unzip(bytes);
    let m;
    try {
        m = JSON.parse(new TextDecoder("utf-8", {
            fatal: true
        }).decode(files.get("manifest.json")));
    } catch {
        invalid("manifest不是JSON", "manifest");
    }
    object(m, "manifest");
    for (const key of [ "id", "name", "version", "doc_types", "subjects", "tokens", "components", "decor", "cover_text_modes", "thumbnail" ]) if (!(key in m)) invalid("manifest字段不完整", key);
    stableKey(m.id, "id");
    packVersion(m.version);
    text(m.name, "name", 100, false);
    const types = m.doc_types = ids(m.doc_types, "doc_types", 4);
    if (!types.length || types.some(x => !docTypes.includes(x))) invalid("文档类型不正确", "doc_types");
    m.subjects = ids(m.subjects, "subjects", 20);
    if (!m.subjects.length || m.subjects.some(x => ![ "*", "music_interest", "music_exam", "art_interest", "art_exam" ].includes(x))) invalid("学科范围不正确", "subjects");
    object(m.tokens, "tokens");
    const color = object(m.tokens.color, "color");
    for (const k of [ "primary", "ink", "paper", "accent", "muted" ]) if (!/^#[a-f0-9]{6}$/i.test(color[k] || "")) invalid("颜色须为固定六位HEX", "color." + k);
    if (typeof color.use_tenant_primary !== "boolean") invalid("主色开关不正确", "use_tenant_primary");
    const font = object(m.tokens.font, "font");
    for (const k of [ "display", "body", "latin" ]) if (![ "noto-sans-sc", "noto-serif-sc", "cormorant-italic" ].includes(font[k])) invalid("字体不在白名单", "font." + k);
    const variants = {
        "plan.cover": [ "stage", "folio", "journal" ],
        "plan.section_header": [ "numeral", "plain" ],
        "plan.stage_block": [ "band", "card" ],
        "plan.total_card": [ "solid", "outline" ],
        "report.header": [ "photo", "band" ],
        "feedback_card.header": [ "band", "plain" ]
    };
    const optionalVariants={"plan.timeline":["list","rail"],"plan.goals":["list","cards"],"plan.photos":["grid_2x3","grid_3x3"]};
    object(m.components, "components");
    if (Object.keys(m.components).some(k => !Object.hasOwn(variants, k)&&!Object.hasOwn(optionalVariants,k))) invalid("不支持的组件", "components");
    for (const [k, a] of Object.entries(variants)) if (!a.includes(m.components[k])) invalid("组件变体不正确", "components." + k);
    for(const [key,values] of Object.entries(optionalVariants))if(m.components[key]!==undefined&&!values.includes(m.components[key]))invalid("组件变体不正确","components."+key);
    object(m.decor, "decor");
    if (m.decor.cover_frame !== "none") invalid("装饰变体不正确", "decor");
    const paths = [];
    for (const value of [ m.decor.corner_image, m.thumbnail ]) if (value !== undefined && value !== null) {
        if (typeof value !== "string" || !value.startsWith("assets/")) invalid("图片必须引用包内资源", "assets");
        assetPath(value.slice(7));
        if (!files.has(value)) invalid("图片引用不存在", "assets");
        paths.push(value);
    }
    const modes = m.cover_text_modes = ids(m.cover_text_modes, "cover_text_modes", 4);
    if (!modes.length || modes.some(x => ![ "auto", "dark", "light", "panel" ].includes(x))) invalid("文字模式不正确", "cover_text_modes");
    if (contrast(color.ink, color.paper) < 4.5 || contrast(color.muted, color.paper) < 4.5) invalid("正文/辅助文字静态对比度不足4.5", "tokens.color");
    const usable = [];
    if (contrast("#FFFFFF", color.primary) >= 4.5) usable.push("light");
    if (contrast(color.ink, color.primary) >= 4.5) usable.push("dark");
    if (!usable.length) invalid("主色背景无合格文字模式", "tokens.color");
    // Reject extra nested strings capable of injecting CSS/URLs, including unused fields.
        const allowedTop = [ "id", "name", "version", "doc_types", "subjects", "tokens", "components", "decor", "cover_text_modes", "thumbnail" ];
    if (Object.keys(m).some(k => !allowedTop.includes(k)) || Object.keys(m.tokens).some(k => ![ "color", "font" ].includes(k)) || Object.keys(color).some(k => ![ "primary", "ink", "paper", "accent", "muted", "use_tenant_primary" ].includes(k)) || Object.keys(font).some(k => ![ "display", "body", "latin" ].includes(k)) || Object.keys(m.decor).some(k => ![ "cover_frame", "corner_image" ].includes(k))) invalid("manifest含未知字段", "manifest");
    const assets = [], warnings = [];
    for (const [name, data] of files) {
        if (name === "manifest.json") continue;
        const info = imageInfo(data), ext = name.split(".").at(-1).toLowerCase();
        if (!{
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            webp: "image/webp"
        }[ext] || info.mime !== {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            webp: "image/webp"
        }[ext]) invalid("真实图片格式与扩展名不符", "assets");
        if (info.width < 1600) warnings.push(name + "宽度小于1600");
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
        assets.push({
            path: name.slice(7),
            data: data,
            ...info,
            bytes: data.length,
            sha256: Array.from(digest, x => x.toString(16).padStart(2, "0")).join("")
        });
    }
    return {
        manifest: m,
        assets: assets,
        checks: {
            errors: [],
            warnings: warnings,
            usable_text_modes: usable,
            contrast: {
                ink_paper: contrast(color.ink, color.paper),
                muted_paper: contrast(color.muted, color.paper)
            }
        }
    };
}
