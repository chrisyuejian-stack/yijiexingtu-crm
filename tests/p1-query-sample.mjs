import { fixture } from "./support.mjs";
import { setup, lesson, pack, mutate, status } from "./fixtures-credit.mjs";
import { adminCall } from "./fixtures-admin.mjs";
import assert from "node:assert/strict";
const original=Date.now, fixed=Date.parse("2026-11-10T12:00:00+08:00");
Date.now=()=>fixed;
const f=await fixture();
try {
 const s={...await setup(f,30,"p1-sample"),f};
 const planned=await lesson(s,"2026-11-10T09:00");
 for (const id of s.students.slice(0,6)) await pack(s,id,5);
 const old=await lesson(s,"2026-11-09T09:00");
 await status(s,old,"student_leave");
 const due=await mutate(s,"credits/payments",{student_id:s.students[0],kind:"tuition",amount:30,paid_at:"2026-11-09"});
 assert.equal(due.status,200,due.text);
 const msg=await adminCall(f,"announcements","POST",{title:"P1 通知",content:"正文",roles:["supervisor"],tenants:[s.t.id]});
 assert.equal(msg.status,200,msg.text);
 const pr=await adminCall(f,"promo","POST",{type:"message",title:"P1 推广",status:"published",audience:"all"});
 assert.equal(pr.status,200,pr.text);
 const results=[];
 for (const path of ["me","finance/receivable-summary","c2/unchecked","c2/unchecked?offset=50","c2/makeups","schedule?from=2026-11-09&to=2026-11-15","data/students","data/students?q=学员1","credits/packages","finance/report?month=2026-11","system-messages","c2/home","todo/summary","c2/renewals","public/brand"]) {
  const r=await f.request("https://school.test/"+s.t.slug+"/api/"+path,{headers:{Cookie:"channel_session="+s.token}});
  assert.equal(r.status,200,await r.clone().text());
  const trips=Number(r.headers.get("server-timing").match(/desc="(\d+)"/)[1]);
  assert.equal(trips,Number(r.headers.get("x-test-d1-queries")));
  const body=await r.json();
  results.push({path,trips,fields:Object.keys(body),size:body.items?.length,total:body.total,unread:body.unread_count});
 }
 console.log(JSON.stringify(results,null,2));
} finally { f.restore(); Date.now=original; }
