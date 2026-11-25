import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { fixture } from "../support.mjs";
import { setup, accountToken, pack, details, lesson, status } from "../fixtures-credit.mjs";
const OriginalDate=Date, at=Date.parse("2026-11-10T20:00:00+08:00");
globalThis.Date=class extends OriginalDate {
  constructor(...args){super(...(args.length?args:[at]));}
  static now(){return at;}
};
const f=await fixture();
try{
  const s={...await setup(f,2,"p3-query"),f}, samples={};
  async function sample(name,path,method="GET",data,token=s.token,console=false){
    const origin=console?"https://console.school.test":"https://school.test";
    const prefix=console?"/api/":"/"+s.t.slug+"/api/";
    const started=performance.now();
    const response=await f.request(origin+prefix+path,{
      method,headers:{Origin:origin,Cookie:console?f.adminCookie:"channel_session="+token,
        ...(console?{"Cf-Access-Jwt-Assertion":f.access}:{}),"Content-Type":"application/json"},
      body:data===undefined?undefined:JSON.stringify({operation_id:crypto.randomUUID(),...data}),
    });
    const timing=response.headers.get("server-timing");
    const trips=Number(/db;dur=[\d.]+;desc="(\d+)"/.exec(timing)?.[1]);
    assert.equal(trips,Number(response.headers.get("x-test-d1-queries")));
    assert.ok(trips<=40);
    samples[name]={path,method,status:response.status,trips,elapsed_ms:Number((performance.now()-started).toFixed(2)),statements:Number(response.headers.get("x-test-d1-statements")),timing};
    return response.json();
  }
  const refs={teacher_id:s.teacher,location_id:s.room,course_type_id:s.type,duration:45,units:1};
  const period={date_from:"2026-11-01",date_to:"2026-11-30"};
  const [a,b]=s.students, pkg=await pack(s,a,1);
  await pack(s,b);
  const stage=(await sample("stage-create","credits/stages","POST",{student_id:a,name:"示例阶段"})).id;
  await sample("stage-delete","credits/stages/"+stage,"DELETE",{version:1});
  await sample("legacy-tuition","credits/payments","POST",{student_id:a,package_id:pkg,amount:150,paid_at:"2026-11-10"});
  const id=await lesson(s,"2026-11-10T09:00",[a]);
  await sample("preview","c2/lessons/"+id+"/preview","POST",{});
  await sample("checkout","credits/lessons/"+id+"/status","POST",{lesson_version:1,status:"completed"});
  await sample("price-edit","credits/packages/"+pkg,"PATCH",{version:1,unit_price:125});
  const noPrice=(await sample("unpriced-package-create","credits/packages","POST",{student_id:b,course_type_id:s.type,units_total:2})).id;
  const original=await lesson(s,"2026-11-10T10:00",[b]);
  await status(s,original,"student_leave");
  const person=(await details(s,original)).participants[0];
  const made=await sample("makeup-create","credits/makeups","POST",{original_participant_id:person.id,
    new_lesson:{...refs,start_at:"2026-11-10T11:00"}});
  assert.ok(made.lesson_id);
  const link=(await sample("makeup-list","credits/makeups")).items[0];
  await sample("makeup-unlink","credits/makeups/"+link.id+"/unlink","POST",{version:link.version});
  await status(s,made.lesson_id,"cancelled");
  const unpricedLesson=await lesson(s,"2026-11-10T12:00",[b]);
  // Avoid the first package covering the whole course so the supplement is measurable.
  await sample("pause-for-unpriced","credits/packages/"+(await sample("packs","credits/packages")).items.find(p=>p.student_id===b&&p.id!==noPrice).id,"PATCH",{version:1,status:"paused"});
  await status(s,unpricedLesson,"completed");
  await sample("price-completion","credits/packages/"+noPrice,"PATCH",{version:1,unit_price:130});
  const t=(await sample("template-create","data/schedule_templates","POST",{...refs,...period,weekday:0,start_time:"13:00"})).id;
  await sample("enroll-create","data/schedule_enrollments","POST",{template_id:t,student_id:b,...period});
  await sample("generate","templates/generate","POST",{from:"2026-11-09",to:"2026-11-09"});
  const w=await sample("schedule","schedule?from=2026-11-09&to=2026-11-10");
  const old=w.items.find(l=>l.template_id===t);
  await sample("reschedule","data/lessons/"+old.id,"PATCH",{version:old.version,start_at:"2026-11-11T13:00"});
  await sample("generate-moved","templates/generate","POST",{from:"2026-11-09",to:"2026-11-09"});
  const finance=await accountToken(s,["finance"]);
  await sample("submit","finance/settlements/submit","POST",{month:"2026-11",version:0},finance.token);
  await sample("approve","finance/settlements/approve","POST",{month:"2026-11",version:1});
  await sample("report","finance/report?month=2026-11");
  await sample("tenant-me","me");
  await sample("console-me","me","GET",undefined,undefined,true);
  f.env.TURNSTILE_MODE="off";
  for (let i=1;i<=3;i++)
    await sample("bad-login-"+i,"login","POST",{phone:"13911112222",password:"BadPassword8"});
  f.db.raw.exec("DELETE FROM security_limits WHERE instr(key,'login')=1");
  await sample("login","login","POST",{phone:"13911112222",password:"PhaseTwoSecure9"});
  await writeFile("docs/p4/写操作API原始记录.json",JSON.stringify(samples,null,2));
  console.log(JSON.stringify(samples,null,2));
}finally{f.restore();globalThis.Date=OriginalDate;}
