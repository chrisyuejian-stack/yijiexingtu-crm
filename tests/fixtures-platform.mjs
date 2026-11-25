import assert from "node:assert/strict";

import { deflateRawSync } from "node:zlib";

export const platformExamples = [];

export async function ops(f, path, method = "GET", data, cookie = f.adminCookie) {
    const url = "https://" + f.env.CONSOLE_HOST + "/api/ops/" + path, headers = {
        Origin: "https://" + f.env.CONSOLE_HOST,
        Cookie: cookie || "",
        "Cf-Access-Jwt-Assertion": f.access
    };
    let body;
    if (data instanceof FormData) body = data; else {
        headers["Content-Type"] = "application/json";
        if (data !== undefined) body = JSON.stringify(data);
    }
    const response = await f.request(url, {
        method: method,
        headers: headers,
        body: body
    });
    const raw = new Uint8Array(await response.arrayBuffer());
    let value;
    try {
        value = JSON.parse((new TextDecoder).decode(raw));
    } catch {
        value = response.headers.get("content-type")?.startsWith("image/") ? {
            binary: true,
            mime: response.headers.get("content-type"),
            base64: Buffer.from(raw).toString("base64")
        } : (new TextDecoder).decode(raw);
    }
    const requestBody = data instanceof FormData ? {
        multipart: true,
        file: "style.zip"
    } : data ?? null;
    platformExamples.push({
        request: {
            method: method,
            path: new URL(url).pathname,
            body: requestBody,
            actor: cookie ? "platform_admin" : "anonymous"
        },
        response: {
            status: response.status,
            body: value
        }
    });
    return {
        status: response.status,
        body: value,
        text: JSON.stringify(value),
        queries: Number(response.headers.get("x-test-d1-queries"))
    };
}

export const ok = (r, status = 200) => {
    assert.equal(r.status, status, r.text);
    return r.body;
};

export function zipFiles(entries, compressed = true) {
    let offset = 0;
    const local = [], central = [];
    const crc = b => {
        let x = 4294967295;
        for (const n of b) {
            x ^= n;
            for (let k = 0; k < 8; k++) x = x >>> 1 ^ (x & 1 ? 3988292384 : 0);
        }
        return (x ^ 4294967295) >>> 0;
    };
    for (const [name, val] of Object.entries(entries)) {
        const bytes = Buffer.from(typeof val === "string" ? val : val), packed = compressed ? deflateRawSync(bytes) : bytes, n = Buffer.from(name), sum = crc(bytes), h = Buffer.alloc(30), c = Buffer.alloc(46);
        h.writeUInt32LE(67324752);
        h.writeUInt16LE(2048, 6);
        h.writeUInt16LE(compressed ? 8 : 0, 8);
        h.writeUInt32LE(sum, 14);
        h.writeUInt32LE(packed.length, 18);
        h.writeUInt32LE(bytes.length, 22);
        h.writeUInt16LE(n.length, 26);
        c.writeUInt32LE(33639248);
        c.writeUInt16LE(2048, 8);
        c.writeUInt16LE(compressed ? 8 : 0, 10);
        c.writeUInt32LE(sum, 16);
        c.writeUInt32LE(packed.length, 20);
        c.writeUInt32LE(bytes.length, 24);
        c.writeUInt16LE(n.length, 28);
        c.writeUInt32LE(offset, 42);
        local.push(h, n, packed);
        central.push(c, n);
        offset += h.length + n.length + packed.length;
    }
    const dir = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(101010256);
    end.writeUInt16LE(Object.keys(entries).length, 8);
    end.writeUInt16LE(Object.keys(entries).length, 10);
    end.writeUInt32LE(dir.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([ ...local, dir, end ]);
}

export const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw1kAAAAASUVORK5CYII=", "base64");

export function manifest(f, id = "test_style", version = "1.0.0") {
    const m = JSON.parse(f.db.raw.prepare("SELECT manifest_json FROM style_pack_versions WHERE pack_id='stp_folio' AND version='1.0.0'").get().manifest_json);
    return {
        ...m,
        id: id,
        version: version,
        name: "测试风格",
        doc_types: [ "plan", "report", "feedback_card", "article" ],
        decor: {
            cover_frame: "none",
            corner_image: "assets/pic.png"
        },
        thumbnail: "assets/pic.png"
    };
}

export async function upload(f, m = manifest(f), extra = {}) {
    const form = new FormData;
    form.set("file", new Blob([ zipFiles({
        "manifest.json": JSON.stringify(m),
        "assets/pic.png": png,
        ...extra
    }) ], {
        type: "application/zip"
    }), "style.zip");
    return ops(f, "style-packs/upload", "POST", form);
}

export async function publish(f, row, scope = "all", tenant_ids = []) {
    return ops(f, "style-packs/" + row.pack_id + "/versions/" + row.pack_version + "/publish", "POST", {
        scope: scope,
        tenant_ids: tenant_ids,
        version: row.version
    });
}
