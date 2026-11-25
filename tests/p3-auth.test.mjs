import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./support.mjs";
import { setup, accountToken, request } from "./fixtures-credit.mjs";
import { adminCall } from "./fixtures-admin.mjs";

test("P3 会话：机构和控制台续期每分钟最多一次，读写各自限额且不增加鉴权往返", async () => {
  const f=await fixture(), realNow=Date.now;
  let clock=realNow();
  Date.now=()=>clock;
  try {
    const s={...await setup(f,2,"p3-auth"),f};
    const student=await accountToken(s,["student"],s.students[0]);
    const db=f.db.raw;
    const tenantLast=()=>db.prepare("SELECT last_seen_at FROM sessions WHERE tenant_id=? AND user_id=?").get(s.t.id,s.user.id).last_seen_at;
    const consoleLast=()=>db.prepare("SELECT last_seen_at FROM platform_sessions WHERE admin_id='adm_fixture'").get().last_seen_at;
    const before=tenantLast(), adminBefore=consoleLast();
    clock+=30000;
    assert.equal((await request(s,"me")).queries,2);
    assert.equal((await adminCall(f,"me")).queries,2);
    assert.equal(tenantLast(),before);
    assert.equal(consoleLast(),adminBefore);
    clock+=31000;
    assert.equal((await request(s,"me")).status,200);
    assert.equal((await adminCall(f,"me")).status,200);
    assert.equal(tenantLast(),clock);
    assert.equal(consoleLast(),clock);

    const limit=db.prepare("INSERT OR REPLACE INTO security_limits(key,count,window_start,locked_until) VALUES(?,?,?,0)");
    const key=(prefix,id)=>prefix+s.t.id+":"+id;
    limit.run(key("request-get:",s.user.id),239,clock);
    assert.equal((await request(s,"me")).status,200);
    assert.equal((await request(s,"me")).status,429);
    assert.equal((await request(s,"settings","PUT",{key:"student_view_balance",value:true})).status,200);
    limit.run(key("request:",s.user.id),120,clock);
    assert.equal((await request(s,"settings","PUT",{key:"student_view_balance",value:false})).status,429);

    limit.run(key("request:",student.id),60,clock);
    assert.equal((await request(s,"password","POST",{old_password:"x",password:"y"},student.token)).status,429);
    assert.equal((await request(s,"me","GET",undefined,student.token)).status,200);

    limit.run("console-request-get:adm_fixture",240,clock);
    assert.equal((await adminCall(f,"me")).status,429);
    assert.equal((await adminCall(f,"platform/features/referrals","PUT",{enabled:true})).status,200);
    limit.run("console-request:adm_fixture",120,clock);
    assert.equal((await adminCall(f,"platform/features/referrals","PUT",{enabled:false})).status,429);
  }finally{Date.now=realNow; f.restore();}
});

test("P3 人机验证：控制台提示 off，on 或默认没有警告，租户概览不暴露平台警告", async () => {
  const f=await fixture();
  try{
    const s={...await setup(f,1,"p3-warning"),f};
    for(const [mode,warnings] of [[undefined,[]],["on",[]],["off",["人机验证未开启"]]]){
      if(mode===undefined) delete f.env.TURNSTILE_MODE;
      else f.env.TURNSTILE_MODE=mode;
      const overview=await adminCall(f,"me");
      assert.equal(overview.status,200,overview.text);
      assert.deepEqual(overview.body.security_warnings,warnings);
      assert.equal(Object.hasOwn((await request(s,"me")).body,"security_warnings"),false);
    }
  }finally{f.restore();}
});
