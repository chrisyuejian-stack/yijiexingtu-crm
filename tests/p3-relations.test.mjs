import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fixture } from "./support.mjs";
import { setup, lesson, details, mutate, request, status, pack, balance, accountToken } from "./fixtures-credit.mjs";
import { b64, bytes, sha } from "../src/server/core.js";

const NativeDate = Date;
const ok = (response, expected = 200) => {
  assert.equal(response.status, expected, response.text);
  assert.ok(response.queries === undefined || response.queries <= 40);
  return response.body;
};
const earned = async (s, month) => ok(await request(s, "finance/report?month=" + month)).earned_amount;
const checkout = (s, month, version, action, token = s.token) =>
  mutate(s, "finance/settlements/" + action, { month, version, ...(action === "unlock" ? { reason: "测试跨月撤销" } : {}) }, "POST", token);
const packageFor = async (s, extra = {}) =>
  ok(await mutate(s, "credits/packages", { student_id:s.students[0], course_type_id:s.type, units_total:2, ...extra })).id;
const txns = (s) => s.f.db.raw.prepare("SELECT x.type,e.* FROM credit_income_entries e JOIN package_transactions x USING(tenant_id,id) WHERE e.tenant_id=? ORDER BY e.created_at,e.id").all(s.t.id);
const current = async (s, table, id) => s.r.businessGet(table, id);

async function school(run, opts) {
  let clock = Date.parse("2026-11-10T20:00:00+08:00");
  const setClock = (date) => { clock = Date.parse(date); };
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  };
  let f;
  try {
    f = await fixture(opts);
    await run({ ...await setup(f, 2, "p3"), f }, setClock);
  } finally {
    f?.restore();
    globalThis.Date = NativeDate;
  }
}

async function renewSession(s) {
  s.token = b64(bytes(32));
  await s.r.createSession(await sha(s.token), await s.r.user(s.user.id), { ip:"test", ua:"p3" });
}

test("P3 F1：单价及收费方式不重写入账，锁月读快照，跨月撤销引用原流水原金额", () => school(async (s, clock) => {
  const p = await pack(s);
  const id = await lesson(s, "2026-11-10T09:00", [s.students[0]]);
  ok(await status(s,id,"completed"));
  assert.equal(await earned(s,"2026-11"),100);
  let row = await current(s,"packages",p);
  ok(await mutate(s,"credits/packages/"+p,{version:row.version,unit_price:200},"PATCH"));
  assert.equal(await earned(s,"2026-11"),100);
  const student = await current(s,"students",s.students[0]);
  ok(await s.call("data/students/"+student.id,"PATCH",{version:student.version,billing_mode:"overall"}));
  assert.equal(await earned(s,"2026-11"),100);
  const finance = await accountToken(s,["finance"]);
  ok(await checkout(s,"2026-11",0,"submit",finance.token));
  ok(await checkout(s,"2026-11",1,"approve"));
  clock("2026-12-01T08:00:00+08:00"); await renewSession(s);
  row = await current(s,"packages",p);
  ok(await mutate(s,"credits/packages/"+p,{version:row.version,unit_price:350},"PATCH"));
  assert.equal(await earned(s,"2026-11"),100);
  ok(await checkout(s,"2026-11",2,"unlock"));
  const d=await details(s,id);
  ok(await mutate(s,"credits/lessons/"+id+"/undo",{lesson_version:d.version}));
  assert.equal(await earned(s,"2026-11"),100);
  assert.equal(await earned(s,"2026-12"),-100);
  const [original,reversal]=txns(s);
  assert.deepEqual([original.amount,original.source,reversal.amount,reversal.source],[10000,"checkout",-10000,"reversal"]);
  assert.equal(original.reversed_by,reversal.id);
}));

test("P3 F1：未定价流水在补价日入账且审计，已冲回的未定价流水不再入账", () => school(async (s, clock) => {
  const p = await packageFor(s);
  const id = await lesson(s,"2026-11-10T09:00",[s.students[0]]);
  ok(await status(s,id,"completed"));
  const second = await lesson(s,"2026-11-10T10:00",[s.students[0]]);
  ok(await status(s,second,"completed"));
  ok(await status(s,second,"planned"));
  assert.equal(await earned(s,"2026-11"),0);
  const finance = await accountToken(s,["finance"]);
  ok(await checkout(s,"2026-12",0,"submit",finance.token));
  ok(await checkout(s,"2026-12",1,"approve"));
  clock("2026-12-01T08:00:00+08:00"); await renewSession(s);
  const patch = () => mutate(s,"credits/packages/"+p,{version:1,unit_price:120},"PATCH");
  assert.equal(ok(await patch(),409).code,"PRICE_COMPLETION_LOCKED");
  ok(await checkout(s,"2026-12",2,"unlock"));
  ok(await patch());
  assert.equal(await earned(s,"2026-11"),0);
  assert.equal(await earned(s,"2026-12"),120);
  const posted = txns(s).filter((e)=>e.source==="price_completion");
  assert.equal(posted.length,1);
  assert.equal(posted[0].booked_on,"2026-12-01");
  assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM audit_log WHERE tenant_id=? AND action='price_completion'").get(s.t.id).n,1);
}));

test("P3 F1：0018 为旧流水生成估算和未定价标记，原流水逐列保持", () => school(async s => {
  const priced=await pack(s), unpriced=await packageFor(s);
  const id=await lesson(s,"2026-11-10T09:00",[s.students[0]]);
  const part=(await details(s,id)).participants[0].id;
  const insert=s.f.db.raw.prepare("INSERT INTO package_transactions(tenant_id,id,package_id,student_id,delta,type,date,participant_id,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,-1,'consume','2026-11-10',?,0,'fixture',0,'fixture')");
  for(const [id,p] of [["p3-old-priced",priced],["p3-old-unpriced",unpriced]])
    insert.run(s.t.id,id,p,s.students[0],part);
  const read=()=>s.f.db.raw.prepare("SELECT * FROM package_transactions WHERE tenant_id=? ORDER BY id").all(s.t.id);
  const before=read();
  s.f.db.raw.exec(await readFile(new URL("../migrations/0018_credit_income_and_schedule_guards.sql",import.meta.url),"utf8"));
  assert.deepEqual(read(),before);
  assert.deepEqual(txns(s).map(({id,amount,source,unpriced_units})=>[id,amount,source,unpriced_units]),[
    ["p3-old-priced",10000,"legacy_estimate",0],["p3-old-unpriced",0,"legacy_no_price",1],
  ]);
  assert.equal(await earned(s,"2026-11"),100);
}, { migrateIncome: false }));

test("P3 F2：预演、销课、欠课补扣都按原课日期，含到期当天与补销历史课", () => school(async s => {
  const expired=await packageFor(s,{unit_price:100,valid_to:"2026-11-01"});
  const future=await packageFor(s,{unit_price:100,valid_from:"2026-11-09"});
  const hist=await packageFor(s,{unit_price:100,valid_from:"2026-11-02",valid_to:"2026-11-02",units_total:0.5});
  const id=await lesson(s,"2026-11-02T09:00",[s.students[0]]);
  const preview=ok(await request(s,"c2/lessons/"+id+"/preview","POST",{}));
  assert.equal(preview.items[0].available_units,0.5);
  ok(await status(s,id,"completed"));
  assert.deepEqual(await Promise.all([expired,future,hist].map(p=>balance(s,p))),[2,2,0]);
  const pending=()=>s.f.db.raw.prepare("SELECT remaining_units FROM credit_debts WHERE tenant_id=? AND deleted_at IS NULL").get(s.t.id).remaining_units;
  assert.equal(pending(),0.5);
  const unrelated=await packageFor(s,{unit_price:100,valid_from:"2026-11-10"});
  assert.equal(pending(),0.5);
  const repaid=await packageFor(s,{unit_price:100,valid_to:"2026-11-02"});
  assert.equal(pending(),0);
  assert.deepEqual(await Promise.all([unrelated,repaid].map(p=>balance(s,p))),[2,1.5]);
  assert.equal(await earned(s,"2026-11"),100);
}));

test("P3 F3：结算逐人校验，班课部分待销、21 节上限及批准前跨过开课时间", () => school(async (s, clock) => {
  await pack(s,s.students[0],1);
  ok(await s.call("settings","PUT",{key:"max_debt_units",value:0}));
  const partial=await lesson(s,"2026-11-10T09:00");
  assert.equal(ok(await status(s,partial,"completed")).blocked.length,1);
  const finance=await accountToken(s,["finance"]);
  const denied=ok(await checkout(s,"2026-11",0,"submit",finance.token),409);
  assert.equal(denied.code,"PENDING_CHECKOUT");
  assert.deepEqual(denied.details,{total:1,items:[{start_at:"2026-11-10T09:00+08:00",course_name:"班课",teacher_name:"教师",student_names:["学员1"]}]});
  assert.match(denied.error,/2026-11-10 09:00:00.*班课.*教师.*学员1/);
  for(let i=0;i<20;i++)
    await lesson(s,"2026-11-"+String(Math.floor(i/10)+1).padStart(2,"0")+"T"+String(8+i%10).padStart(2,"0")+":00",[s.students[0]]);
  const capped=ok(await checkout(s,"2026-11",0,"submit",finance.token),409);
  assert.equal(capped.details.total,21); assert.equal(capped.details.items.length,20);
  const dec=await lesson(s,"2026-12-01T09:00",[s.students[0]]);
  clock("2026-12-01T08:55:00+08:00"); await renewSession(s);
  const financeToken=b64(bytes(32));
  await s.r.createSession(await sha(financeToken),await s.r.user(finance.id),{ip:"test",ua:"p3"});
  ok(await checkout(s,"2026-12",0,"submit",financeToken));
  clock("2026-12-01T09:01:00+08:00");
  assert.equal(ok(await checkout(s,"2026-12",1,"approve"),409).code,"PENDING_CHECKOUT");
  assert.equal((await details(s,dec)).status,"planned");
}));

const refs = (s) => ({teacher_id:s.teacher,location_id:s.room,course_type_id:s.type,duration:45,units:1});
const make = (s, original, time) =>
  mutate(s,"credits/makeups",{original_participant_id:original,new_lesson:{...refs(s),start_at:"2026-11-10T"+time}});
const bounds={date_from:"2026-11-01",date_to:"2026-11-30"};
const template=(s, extra={})=>s.create("schedule_templates",{...refs(s),...bounds,weekday:0,start_time:"09:00",...extra});
const enroll=(s,t,student)=>s.call("data/schedule_enrollments","POST",{template_id:t,student_id:student,...bounds});
const gen=(s)=>s.call("templates/generate","POST",{from:"2026-11-09",to:"2026-11-09"});

test("P3 S1：解除补课扣课受限时两份关联和流水均保留，解除成功时一并更新", () => school(async s => {
  const p=await pack(s,s.students[0],1);
  const id=await lesson(s,"2026-11-08T09:00",[s.students[0]]);
  ok(await status(s,id,"student_no_show"));
  const original=(await details(s,id)).participants[0];
  const made=ok(await make(s,original.id,"10:00"));
  ok(await status(s,made.lesson_id,"completed"));
  ok(await s.call("settings","PUT",{key:"max_debt_units",value:0}));
  const link=ok(await request(s,"credits/makeups")).items[0];
  const before=txns(s);
  const unlink=()=>mutate(s,"credits/makeups/"+link.id+"/unlink",{version:link.version});
  assert.equal(ok(await unlink(),409).code,"MAKEUP_UNLINK_BLOCKED");
  assert.deepEqual(txns(s),before);
  assert.equal(ok(await request(s,"credits/makeups")).items.length,1);
  assert.equal((await details(s,made.lesson_id)).participants[0].makeup_for,original.id);
  ok(await mutate(s,"credits/adjust",{package_id:p,delta:1,reason:"补充课时"}));
  ok(await unlink());
  assert.equal(ok(await request(s,"credits/makeups")).items.length,0);
  const person=(await details(s,made.lesson_id)).participants[0];
  assert.equal(person.makeup_for,null);
  assert.equal(person.deducted,1);
  assert.equal(await balance(s,p),0);
}));

test("P3 补课：并发最多一条有效关联，取消、再次缺席允许重约，完成后禁止", () => school(async s => {
  const id=await lesson(s,"2026-11-08T09:00",[s.students[0]]);
  ok(await status(s,id,"student_leave"));
  const original=(await details(s,id)).participants[0].id;
  const simultaneous=await Promise.all([make(s,original,"10:00"),make(s,original,"11:00")]);
  const first=ok(simultaneous.find(x=>x.status===200));
  assert.equal(ok(simultaneous.find(x=>x.status===409),409).code,"MAKEUP_ALREADY_ACTIVE");
  ok(await status(s,first.lesson_id,"cancelled"));
  const second=ok(await make(s,original,"12:00"));
  ok(await status(s,second.lesson_id,"student_no_show"));
  const third=ok(await make(s,original,"13:00"));
  const cancelled = await details(s,first.lesson_id);
  const [person] = cancelled.participants;
  const restore = await mutate(s,"credits/lessons/"+cancelled.id+"/attendance",{
    lesson_version:cancelled.version,
    participants:[{id:person.id,version:person.version,attendance:"attended"}],
  });
  assert.equal(ok(restore,409).code,"MAKEUP_ALREADY_ACTIVE");
  assert.equal((await details(s,first.lesson_id)).status,"cancelled");
  ok(await status(s,third.lesson_id,"completed"));
  assert.equal(ok(await make(s,original,"14:00"),409).code,"MAKEUP_ALREADY_ACTIVE");
  assert.equal(ok(await request(s,"credits/makeups")).items.length,3);
}));

test("P3 S2/S3：跨日改期按原发生日跳过，同批其余模板生成，班级模板拒绝独立报名", () => school(async s => {
  const a=await template(s);
  ok(await enroll(s,a,s.students[0]));
  assert.equal(ok(await gen(s)).generated,1);
  const l=ok(await request(s,"schedule?from=2026-11-09&to=2026-11-10")).items[0];
  ok(await s.call("data/lessons/"+l.id,"PATCH",{version:l.version,start_at:"2026-11-10T09:00"}));
  const b=await template(s,{start_time:"10:00"});
  ok(await enroll(s,b,s.students[1]));
  assert.deepEqual(ok(await gen(s)),{committed:true,generated:1,skipped:1});
  const cls=ok(await s.call("tools/classes","POST",{name:"班级",...refs(s),...bounds})).id;
  ok(await s.call("tools/class_members","POST",{class_id:cls,student_id:s.students[0]}));
  const t=await template(s,{class_id:cls,start_time:"11:00"});
  const result=ok(await enroll(s,t,s.students[1]),400);
  assert.equal(result.code,"CLASS_TEMPLATE_ROSTER");
  assert.equal(result.error,"这条固定课按班级名单排课，请先把学员加入班级");
  assert.equal(ok(await gen(s)).generated,1);
  const rows=ok(await request(s,"schedule?from=2026-11-09&to=2026-11-10")).items;
  assert.deepEqual(rows.find(x=>x.template_id===t).participant_student_ids,[s.students[0]]);
}));

test("P3 S4：改课程清除不适用的旧包、同大类保留、显式清空和显式错误都生效", () => school(async s => {
  const student=s.students[0], originalPack=await pack(s,student);
  const categoryPack=await packageFor(s,{scope_kind:"category"});
  const a=ok(await s.call("data/lessons","POST",{...refs(s),start_at:"2026-11-10T09:00",participants:[{student_id:student,package_id:originalPack}]})).id;
  const another=await s.create("course_types",{name:"新细分",category_id:s.cat,format:"group",capacity:40});
  const actual=async()=>{
    const d=await details(s,a);
    return {d,p:await current(s,"lesson_participants",d.participants[0].id)};
  };
  const edit=async (data,expected=200)=>ok(await s.call("data/lessons/"+a,"PATCH",{version:(await actual()).d.version,...data}),expected);
  await edit({course_type_id:another,student_ids:[student]});
  assert.equal((await actual()).p.package_id,null);
  await edit({participants:[{student_id:student,package_id:originalPack}]},400);
  await edit({participants:[{student_id:student,package_id:categoryPack}]});
  assert.equal((await actual()).p.package_id,categoryPack);
  await edit({course_type_id:s.type,student_ids:[student]});
  assert.equal((await actual()).p.package_id,categoryPack);
  await edit({participants:[{student_id:student,package_id:null}]});
  assert.equal((await actual()).p.package_id,null);
}));

test("P3 F4/F5：旧版超收分配到预收，关联阶段不得删除，旧缴费编辑不能制造超收", () => school(async s => {
  const student_id=s.students[0], p=await pack(s,student_id,1);
  const paid=async (data)=>ok(await mutate(s,"credits/payments",{student_id,paid_at:"2026-11-10",...data}));
  const first=await paid({package_id:p,amount:20});
  assert.equal(ok(await mutate(s,"finance/tuition/"+first.id,{version:1,amount:101},"PATCH"),409).code,"PAYMENT_OVERFLOW_EDIT");
  const old=await paid({package_id:p,amount:150});
  assert.equal(old.deposit_amount,70);
  assert.deepEqual(old.allocations,[{package_id:p,amount:80}]);
  assert.equal(ok(await request(s,"credits/packages/"+p)).record.paid_amount,100);
  assert.equal(ok(await request(s,"credits/balance?student_id="+student_id)).balance,70);
  const stage=ok(await mutate(s,"credits/stages",{student_id,name:"保留引用"})).id;
  const add=await paid({stage_id:stage,kind:"tuition",amount:30});
  const removal=()=>mutate(s,"credits/stages/"+stage,{version:1},"DELETE");
  assert.match(ok(await removal(),409).error,/缴费分类/);
  ok(await mutate(s,"credits/payments/"+add.id+"/reverse",{version:1,reason:"取消该缴费"}));
  ok(await removal());
}));

test("P3 F1 备份恢复：新版保留冻结估价，0018 前的备份只生成缺失估算", () => school(async s => {
  const { backupManifest, seal } = await import("../src/server/backup.js");
  const { adminCall } = await import("./fixtures-admin.mjs");
  const backupWorker = process.env.TEST_BUNDLE === "1"
    ? (await import("../backup-dist/backup-worker.js")).default
    : (await import("../src/server/backup.js")).default;
  const p=await pack(s);
  const id=await lesson(s,"2026-11-10T09:00",[s.students[0]]);
  ok(await status(s,id,"completed"));
  ok(await mutate(s,"credits/packages/"+p,{version:1,unit_price:250},"PATCH"));
  const frozen=txns(s);
  await backupWorker.scheduled({cron:"0 19 * * *",scheduledTime:Date.now()},s.f.env,{});
  const latest=()=>s.f.db.raw.prepare("SELECT id,status FROM backup_snapshots ORDER BY at DESC LIMIT 1").get();
  for(let i=0;i<20&&latest().status==="running";i++)
    await backupWorker.scheduled({cron:"*/5 * * * *",scheduledTime:Date.now()},s.f.env,{});
  const snapshot=latest();
  assert.equal(snapshot.status,"completed");
  const manifest=await backupManifest(s.f.env,snapshot.id);
  assert.equal(manifest.tables.credit_income_entries,1);

  const restore=async()=>{
    const root="tenants/"+s.t.id+"/jobs";
    const job=ok(await adminCall(s.f,root,"POST",{kind:"restore",backup_id:snapshot.id,reason:"P3 估价恢复验证"}));
    for(const page of job.manifest.required) ok(await adminCall(s.f,root+"/"+job.id+"/page","POST",page));
    ok(await adminCall(s.f,root+"/"+job.id+"/commit","POST",{}));
  };
  await restore();
  assert.deepEqual(txns(s),frozen);
  const key=snapshot.id+"/manifest.enc";
  const oldManifest={...manifest,files:manifest.files.filter((x)=>x.table!=="credit_income_entries"),tables:{...manifest.tables}};
  delete oldManifest.tables.credit_income_entries;
  await s.f.env.CHANNEL_BACKUPS.put(key,JSON.stringify(await seal(s.f.env,oldManifest,key)));
  await restore();
  assert.deepEqual(txns(s).map((row)=>[row.id,row.amount,row.source]),[[frozen[0].id,25000,"legacy_estimate"]]);
}));
