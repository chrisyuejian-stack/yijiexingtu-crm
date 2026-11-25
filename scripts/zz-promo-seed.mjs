// 仅本机预览用（绝不进入 dist）：给推广中心补几条更像真实使用的演示内容，便于截图检查。
// 全部通过真实接口写入（控制台 + 机构端），资料虚构。
import { readFileSync } from "node:fs";
export async function seedPromoRich(f, t, token, imgDir) {
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
      body: data === undefined ? undefined : JSON.stringify(admin ? data : { operation_id: crypto.randomUUID(), ...data }),
    });
    const text = await res.text();
    if (res.status !== 200) throw Error(path + " " + text);
    return JSON.parse(text);
  };
  const upload = async (file, kind) => {
    const id = (await call("promo/images", "POST", { kind })).id,
      data = "data:image/png;base64," + readFileSync(imgDir + "/" + file).toString("base64");
    for (let i = 0; i < data.length; i += 500000)
      await call("promo/images/" + id + "/part", "POST", { index: i / 500000, data: data.slice(i, i + 500000) });
    await call("promo/images/" + id + "/complete", "POST", {});
    return id;
  };
  const [p1, p2, p3, long] = await Promise.all([upload("p1.png", "poster"), upload("p2.png", "poster"), upload("p3.png", "poster"), upload("long.png", "content")]);
  const DAY = 86400000,
    now = Date.now(),
    bj = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
  const weekly = (firstMs, count, hm, duration, meeting = true) =>
    Array.from({ length: count }, (_, i) => ({
      start_at: bj(firstMs + i * 7 * DAY) + "T" + hm,
      duration,
      meeting_no: meeting ? "123 456 789" : "",
      meeting_url: meeting ? "https://meeting.tencent.com/dm/demo" + (i + 1) : "",
    }));
  const slots = {
    logo: { x: 60, y: 1660, width: 160, height: 160 },
    qr: { x: 820, y: 1640, width: 200, height: 200 },
    text: { x: 250, y: 1700, width: 520, height: 60, font_size: 34, color: "#333333", align: "left" },
  };
  const make = async (data, poster) => {
    const id = (await call("promo", "POST", { audience: "selected", tenant_ids: [t.id], status: "published", ...data })).id;
    if (poster) await call("promo/" + id + "/posters", "POST", { image_key: poster, slots });
    return id;
  };
  // 1) 招募中、本机构未申请
  await make(
    {
      type: "course",
      title: "国际音乐素养课 · 冬季班",
      summary: "24 周线上小班，帮孩子建立听懂音乐、表达音乐的能力",
      body: "适合小学四年级至初三，零乐理基础。每周六上午腾讯会议上课，机构统一组织学员上线。",
      cover: p1,
      detail_image_key: long,
      publish_at: now - 3600000,
      lecturer: "Chris",
      seat_price: 280,
      suggested_price: 480,
      min_size: 20,
      apply_deadline: now + 16 * DAY,
      sessions: weekly(now + 30 * DAY, 24, "10:00", 60),
    },
    p1,
  );
  // 2) 讲座：本机构已申请
  const lecture = await make(
    {
      type: "course",
      title: "家长讲座：音乐留学是一条什么路",
      summary: "一次讲清楚音乐留学的路径、时间线和准备",
      body: "面向家长的线上讲座，可邀请本机构家长参加。",
      cover: p2,
      detail_image_key: long,
      publish_at: now - 7200000,
      lecturer: "Chris",
      format: "lecture",
      is_free: 1,
      seat_price: null,
      suggested_price: null,
      min_size: 1,
      apply_deadline: now + 10 * DAY,
      sessions: weekly(now + 15 * DAY, 1, "19:30", 60),
    },
    p2,
  );
  const contact = (await call("promo/" + lecture, "GET", undefined, false)).contacts[0];
  await call("promo/" + lecture + "/application", "POST", { est_size: 15, unsure: false, contact_user_id: contact.id, note: "家长群已预告" }, false);
  // 3) 已开班：申请 → 顾问确认 3 席 → 开班 → 登记 3 名学员
  const opened = await make(
    {
      type: "course",
      title: "音乐聆听体验课 · 秋季",
      summary: "6 次课从“听”开始认识不同风格的音乐",
      body: "面向小学四年级至初三学生的线上聆听课。6 次课从“听”开始认识不同风格的音乐，不需要乐理基础。由枫琴统一授课，机构负责组织学员上线。",
      cover: p3,
      detail_image_key: long,
      publish_at: now - 20 * DAY,
      lecturer: "Chris",
      seat_price: 200,
      suggested_price: 360,
      min_size: 3,
      apply_deadline: now + 2 * 3600000,
      sessions: weekly(now + 1 * DAY, 6, "19:00", 45),
    },
    p3,
  );
  await call("promo/" + opened + "/application", "POST", { est_size: 4, unsure: false, contact_user_id: contact.id, note: "已有 4 位家长有意向" }, false);
  let admin = await call("promo/" + opened);
  const app = admin.applications[0];
  await call("promo/" + opened + "/applications/" + app.id, "PUT", { status: "confirmed", confirmed_size: 3, version: app.version, consultant: "王顾问" });
  admin = await call("promo/" + opened);
  // 枫琴已确认收到这家机构的席位费（只是标记，不进入机构财务）
  const confirmed = admin.applications[0];
  await call("promo/" + opened + "/applications/" + confirmed.id + "/paid", "PUT", { version: confirmed.version, paid: true });
  admin = await call("promo/" + opened);
  await call("promo/" + opened + "/open", "POST", { version: admin.course.version });
  const tenantView = await call("promo/" + opened, "GET", undefined, false);
  const students = f.db.raw.prepare("SELECT id FROM students WHERE tenant_id=? AND status='active' ORDER BY name LIMIT 3").all(t.id);
  await call("promo/" + opened + "/roster", "PUT", { version: tenantView.application.version, student_ids: students.map((s) => s.id) }, false);
  // 4) 招生物料、5) 通知
  await make({ type: "material", title: "机构合作介绍", summary: "枫琴 × 本机构国际音乐教育合作", body: "可发朋友圈或家长群。", cover: p3, publish_at: now - 3 * DAY }, p3);
  await make({ type: "message", title: "冬季班开放申请", summary: "国际音乐素养课冬季班 11-20 截止申请，请提前统计意向学员。", body: "国际音乐素养课冬季班开放申请，截止前统计好意向人数即可申请名额。", publish_at: now - 1800000 });
  return { opened, lecture };
}
