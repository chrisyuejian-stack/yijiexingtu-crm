// 本机演示夹具，绝不进入dist。所有资料虚构，图为代码生成底色。
import { deflateSync } from "node:zlib";
export function demoPoster(w = 1080, h = 1920) {
  const
    raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const at = y * (w * 3 + 1) + 1 + x * 3,
        col =
          y < 300
            ? [38, 70, 104]
            : y > 1640
              ? [244, 241, 248]
              : [
                  59 + Math.floor(y / 90),
                  83 + Math.floor(x / 180),
                  116 + Math.floor(y / 100),
                ];
      raw[at] = col[0];
      raw[at + 1] = col[1];
      raw[at + 2] = col[2];
    }
  }
  const crc = (b) => {
      let c = 0xffffffff;
      for (const v of b) {
        c ^= v;
        for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
      }
      return (c ^ 0xffffffff) >>> 0;
    },
    chunk = (t, b) => {
      const len = Buffer.alloc(4),
        sum = Buffer.alloc(4),
        name = Buffer.from(t);
      len.writeUInt32BE(b.length);
      sum.writeUInt32BE(crc(Buffer.concat([name, b])));
      return Buffer.concat([len, name, b, sum]);
    },
    ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return (
    "data:image/png;base64," +
    Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]).toString("base64")
  );
}
export async function seedPromoDemo(f, t, token) {
  const call = async (path, method = "GET", data, admin = true) => {
    const origin = admin ? "http://127.0.0.1:4173" : "http://localhost:4173",
      url = origin + (admin ? "/api/" : "/preview-school/api/") + path;
    const res = await f.request(url, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: admin ? f.adminCookie : "channel_session=" + token,
        "cf-access-jwt-assertion": f.access,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const text = await res.text();
    if (res.status !== 200) throw Error(path + " " + text);
    return JSON.parse(text);
  };
  const image = (await call("promo/images", "POST", { kind: "poster" })).id,
    png = demoPoster();
  for (let i = 0; i < png.length; i += 500000)
    await call("promo/images/" + image + "/part", "POST", {
      index: i / 500000,
      data: png.slice(i, i + 500000),
    });
  await call("promo/images/" + image + "/complete", "POST", {});
  // 课程详情长图：后端要求宽 750px
  const detail = (await call("promo/images", "POST", { kind: "detail" })).id,
    long = demoPoster(750, 1600);
  for (let i = 0; i < long.length; i += 500000)
    await call("promo/images/" + detail + "/part", "POST", { index: i / 500000, data: long.slice(i, i + 500000) });
  await call("promo/images/" + detail + "/complete", "POST", {});
  const now = Date.now(),
    at =
      new Date(now + 86400000 + 8 * 3600000).toISOString().slice(0, 10) +
      "T19:00";
  const course = (
    await call("promo", "POST", {
      type: "course",
      title: "合作艺术课堂 · 课程演示",
      summary: "线上课堂与机构招生合作",
      body: "本页为本机虚构演示。合作课程统一安排，机构负责登记参加学员。",
      cover: image,
      detail_image_key: detail,
      audience: "selected",
      tenant_ids: [t.id],
      status: "published",
      publish_at: now - 1000,
      lecturer: "演示讲师",
      seat_price: 120,
      suggested_price: 180,
      min_size: 2,
      apply_deadline: now + 3600000,
      sessions: [
        {
          start_at: at,
          duration: 45,
          meeting_no: "演示会议号",
          meeting_url: "https://meeting.tencent.com/example",
        },
      ],
    })
  ).id;
  const material = (
    await call("promo", "POST", {
      type: "material",
      title: "机构合作招生物料",
      summary: "打开即是本机构品牌海报，可下载或长按保存。",
      body: "底图、机构Logo、顾问二维码和联合合作署名在浏览器内合成。",
      audience: "all",
      status: "published",
      publish_at: now - 2000,
      cover: image,
    })
  ).id;
  const slots = {
    logo: { x: 60, y: 1680, width: 160, height: 120 },
    qr: { x: 820, y: 1660, width: 200, height: 200 },
    text: {
      x: 60,
      y: 1850,
      width: 960,
      height: 50,
      font_size: 28,
      color: "#333333",
      align: "left",
    },
  };
  for (const id of [course, material])
    await call("promo/" + id + "/posters", "POST", { image_key: image, slots });
  await call("promo", "POST", {
    type: "message",
    title: "合作课程安排提醒",
    summary: "合作课程已开放申请",
    body: "请核对课程时间与本机构的参加人数。",
    audience: "all",
    status: "published",
    publish_at: now - 3000,
  });
  await call(
    "promo/" + course + "/application",
    "POST",
    { est_size: 2, unsure: false, note: "演示申请，等待顾问联系" },
    false,
  );
  if (process.env.PREVIEW_OPEN === "1") {
    let detail = await call("promo/" + course);
    const app = detail.applications[0];
    await call("promo/" + course + "/applications/" + app.id, "PUT", {
      version: app.version,
      status: "confirmed",
      confirmed_size: 2,
      consultant: "演示顾问",
    });
    detail = await call("promo/" + course);
    await call("promo/" + course + "/open", "POST", {
      version: detail.course.version,
    });
    const own = await call("promo/" + course, "GET", undefined, false);
    const students = f.db.raw
      .prepare(
        "SELECT id FROM students WHERE tenant_id=? AND deleted_at IS NULL ORDER BY name LIMIT 2",
      )
      .all(t.id);
    await call(
      "promo/" + course + "/roster",
      "PUT",
      {
        version: own.application.version,
        student_ids: students.map((s) => s.id),
      },
      false,
    );
  }
  return { course, material };
}

export async function seedPromoBrands(f, t, token) {
  const { readFile } = await import("node:fs/promises"),
    { repo } = await import("../src/server/repo.js"),
    { modules } = await import("../src/server/permissions.js"),
    { randomId, b64, bytes, sha } = await import("../src/server/core.js"),
    { newPassword, phoneIndex, encrypt } =
      await import("../src/server/crypto.js");
  const image = async (name) =>
    "data:image/png;base64," +
    (
      await readFile(new URL("../tests/assets/" + name, import.meta.url))
    ).toString("base64");
  const tenant2 = {
    ...t,
    id: randomId("ten"),
    slug: "preview-partner",
    name: "合作预览",
    type: "音乐培训",
  };
  await repo(f.env, null).createTenant(tenant2, "fixture", modules);
  const r = repo(f.env, tenant2.id),
    person = {
      id: randomId("usr"),
      name: "合作机构教务",
      roles: '["academic"]',
      phone_hmac: await phoneIndex(f.env, tenant2.id, "13900000009"),
      phone_enc: await encrypt(f.env, "13900000009", tenant2.id + ":phone"),
      phone_last4: "0009",
      ...(await newPassword(f.env, b64(bytes(32)))),
    };
  await r.createUser(person, { id: "fixture", name: "系统维护" });
  f.db.raw
    .prepare("UPDATE users SET must_change=0 WHERE tenant_id=?")
    .run(tenant2.id);
  const secondToken = b64(bytes(32));
  await r.createSession(await sha(secondToken), person, {
    ip: "local",
    ua: "preview",
  });
  const brand = await r.brand();
  await repo(f.env, null).saveBrand(
    tenant2.id,
    brand.version,
    {
      ...brand,
      logo: await image("promo-logo-b.png"),
      consultant_qr: await image("promo-qr-b.png"),
    },
    "adm_fixture",
  );
  const call = async (path, data) => {
    const res = await f.request(
      "http://localhost:4173/" + t.slug + "/api/" + path,
      {
        method: "POST",
        headers: {
          Origin: "http://localhost:4173",
          "Content-Type": "application/json",
          Cookie: "channel_session=" + token,
        },
        body: JSON.stringify(data),
      },
    );
    const out = await res.json();
    if (res.status !== 200) throw Error(JSON.stringify(out));
    return out;
  };
  const upload = async (name) => {
    const id = (await call("promo/images", {})).id;
    await call("promo/images/" + id + "/part", {
      index: 0,
      data: await image(name),
    });
    await call("promo/images/" + id + "/complete", {});
    return id;
  };
  const logo = await upload("promo-logo-a.png"),
    qr = await upload("promo-qr-a.png");
  const res = await f.request(
    "http://localhost:4173/" + t.slug + "/api/promo/assets",
    {
      method: "PUT",
      headers: {
        Origin: "http://localhost:4173",
        "Content-Type": "application/json",
        Cookie: "channel_session=" + token,
      },
      body: JSON.stringify({ logo_key: logo, qr_key: qr }),
    },
  );
  if (res.status !== 200) throw Error(await res.text());
  return { [tenant2.slug]: secondToken };
}
