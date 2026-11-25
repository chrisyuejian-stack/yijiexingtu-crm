import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture } from "./support.mjs";
import { setup, lesson, pack, status, accountToken } from "./fixtures-credit.mjs";
import { adminCall } from "./fixtures-admin.mjs";
import { randomId } from "../src/server/core.js";

const trips = (response) => Number(response.headers.get("server-timing")?.match(/desc="(\d+)"/)?.[1]);
function within(response, max) {
  assert.equal(response.status, 200);
  assert.equal(trips(response), Number(response.headers.get("x-test-d1-queries")));
  assert.ok(trips(response) <= max);
}
async function withSchool(run) {
  const f = await fixture();
  try { await run({ ...await setup(f, 2, "p1"), f }); }
  finally { f.restore(); }
}
const get = (s, path, token = s.token) => s.f.request(
  "https://school.test/" + s.t.slug + "/api/" + path, { headers: { Cookie: "channel_session=" + token } },
);

test("P1 路由与鉴权：绑定域名一趟，旧路径和无效路由不扣账号限额，停用或跨机构拒绝", () => withSchool(async (s) => {
  const { f } = s, headers = { Cookie: "channel_session=" + s.token };
  f.db.raw.prepare("INSERT INTO tenant_domains(domain,tenant_id,kind,verified) VALUES(?,?,?,1)").run("school-custom.test", s.t.id, "custom");
  f.db.raw.prepare("INSERT INTO tenant_slug_aliases(slug,tenant_id,expires_at) VALUES(?,?,?)").run("p1-old-school",s.t.id,Date.now()+60000);
  const key = "request-get:" + s.t.id + ":" + s.user.id;
  const used = () => f.db.raw.prepare("SELECT count FROM security_limits WHERE key=?").get(key)?.count || 0;
  const before = used();
  const direct = await f.request("https://school-custom.test/api/me", { headers });
  within(direct,2);
  assert.equal((await direct.json()).user.id,s.user.id);
  assert.equal(used(),before+1);
  assert.equal((await f.request("https://school.test/p1-old-school/api/me",{headers})).status,308);
  assert.equal((await get(s,"not-registered")).status,404);
  assert.equal((await get(s,"public/brand")).status,200);
  assert.equal(used(),before+1);
  const other = { ...await setup(f,1,"p1-other"),f };
  assert.equal((await get(other,"me",s.token)).status,404);
  assert.equal(used(),before+1);
  f.db.raw.prepare("UPDATE tenants SET status='paused' WHERE id=?").run(s.t.id);
  const suspended = await f.request("https://school-custom.test/api/me",{headers});
  assert.equal(suspended.status,403);
  assert.equal((await suspended.json()).error,"tenant_expired");
  assert.equal(used(),before+1);
}));

test("P1 首页和消息：一批读取，仍按角色裁剪；独立读量计数照常执行", () => withSchool(async (s) => {
  const { f } = s;
  const today = new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Shanghai"});
  await lesson(s,today+"T09:00");
  const previous = await lesson(s,"2020-11-10T09:00",[s.students[0]]);
  assert.equal((await status(s,previous,"completed")).status,200);
  await pack(s,s.students[1],2);
  assert.equal((await adminCall(f,"announcements","POST",{
    title:"只给教务",content:"机构通知",roles:["academic"],tenants:[s.t.id],
  })).status,200);
  assert.equal((await adminCall(f,"promo","POST",{
    type:"message",title:"推广通知",status:"published",audience:"all",
  })).status,200);
  const academic = await accountToken(s,["academic"]);
  const finance = await accountToken(s,["finance"]);
  const home = await get(s,"c2/home",academic.token);
  within(home,4);
  const result = await home.json();
  assert.equal(result.lessons.length,1);
  assert.equal(result.lessons[0].participants_summary.count,2);
  assert.equal(result.week.length,1);
  assert.ok(!("tuition_amount" in result));
  const todo = await (await get(s,"todo/summary",academic.token)).json();
  assert.equal(todo.renewal_debt,1);
  assert.equal(todo.renewal_low,1);
  for (const [key, value] of Object.entries(result.counts)) assert.equal(value,todo[key],key);
  const messages = await get(s,"system-messages",academic.token);
  within(messages,3);
  assert.equal((await messages.json()).unread_count,2);
  const noPromo = await get(s,"system-messages",finance.token);
  within(noPromo,3);
  assert.deepEqual(await noPromo.json(), { items:[], unread_count:0 });
  assert.ok(f.db.raw.prepare("SELECT count FROM security_limits WHERE key=?").get("read:"+s.t.id+":"+academic.id).count>0);
}));

test("P1 缓存：品牌短缓存，已授权成功读取图片才长缓存，按会话隔开", () => withSchool(async (s) => {
  const { f } = s;
  const brand = await get(s,"public/brand","");
  assert.equal(brand.headers.get("cache-control"),"private, max-age=60");
  assert.equal((await get(s,"public/theme.css")).headers.get("cache-control"),"no-store");
  assert.equal((await get(s,"me")).headers.get("cache-control"),"no-store");
  const img = randomId("img");
  f.db.raw.prepare("INSERT INTO promo_images(id,tenant_id,owner_id,kind,mime,width,height,ready,created_at) VALUES(?,'platform','fixture','poster','image/png',1080,1000,1,?)").run(img,Date.now());
  const png = await readFile(new URL("./assets/promo-logo-a.png", import.meta.url));
  await f.env.CHANNEL_MEDIA.put("promo/platform/"+img+"/image","data:image/png;base64,"+png.toString("base64"));
  assert.equal((await adminCall(f,"promo","POST",{
    type:"material",title:"本机构封面",status:"published",audience:"selected",tenant_ids:[s.t.id],cover:img,
  })).status,200);
  const p = "promo/images/"+img;
  const response = await get(s,p);
  assert.equal(response.status,200);
  assert.equal(response.headers.get("cache-control"),"private, max-age=86400, immutable");
  assert.equal(response.headers.get("vary"),"Cookie");
  assert.equal(response.headers.get("x-content-type-options"),"nosniff");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
  const consoleResponse = await f.request("https://console.school.test/api/"+p,{
    headers:{Cookie:f.adminCookie,"Cf-Access-Jwt-Assertion":f.access},
  });
  assert.equal(consoleResponse.status,200);
  assert.match(consoleResponse.headers.get("vary"),/Cf-Access-Jwt-Assertion/);
  assert.equal(consoleResponse.headers.get("cache-control"),"private, max-age=86400, immutable");
  const other = { ...await setup(f,1,"p1-cache-other"),f };
  for (const [r, status] of [[await get(s,p,""),401],[await get(other,p),404],[await get(s,"promo/images/"+randomId("img")),404]]) {
    assert.equal(r.status,status);
    assert.equal(r.headers.get("cache-control"),"no-store");
  }
}));

test("P1 查询计划：续费流水、欠课与月收款使用按机构限定的索引", () => withSchool(async (s) => {
  const { f } = s, statements = [];
  const execute = f.db.batch.bind(f.db);
  f.db.batch = (queries) => {
    for (const query of queries)
      if (/^\s*(WITH|SELECT)/i.test(query.query) && /package_transactions|credit_debts|student_payments/.test(query.query))
        statements.push(query);
    return execute(queries);
  };
  await get(s,"c2/home");
  await get(s,"finance/report?month=2026-11");
  const plans = statements.flatMap(({query,params}) => f.db.raw.prepare("EXPLAIN QUERY PLAN "+query).all(...params).map((r) => r.detail));
  for (const table of ["p1_credit_ledger_active", "p1_credit_debt_active", "p1_payments_date_active"])
    assert.ok(plans.some((detail) => detail.startsWith("SEARCH") && detail.includes(table) && detail.includes("tenant_id=?")),plans.join("\n"));
}));
