import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fixture } from './support.mjs';
import { schoolFixture } from './fixtures-school.mjs';
import { setup, accountToken, request } from './fixtures-credit.mjs';
import { rolesInput } from '../src/server/accounts.js';
import { repo } from '../src/server/repo.js';
import { can, modules } from '../src/server/permissions.js';
import { sha, b64, bytes } from '../src/server/core.js';
import { encrypt, phoneIndex, platformPhoneIndex, newPassword } from '../src/server/crypto.js';
import { rebuildPlatformPhoneIndex } from '../scripts/rebuild-platform-phone-index.mjs';
import { startBackup } from '../src/server/backup.js';
const PASSWORD='PhaseTwoSecure9';
const examples=[];
async function call(f,path,method='GET',data,cookie='',ops=false,extra={}) {
  const origin=ops?'https://console.school.test':'https://school.test';
  const response=await f.request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(ops?{'Cf-Access-Jwt-Assertion':f.access}:{}),...extra},body:data===undefined?undefined:JSON.stringify(data)});
  const text=await response.text();let body;try {body=JSON.parse(text);}catch {body={text};}
  if(path.includes('/auth/')||path.includes('/guardians')||path.includes('/parents/')||path.includes('/ops/')||path.includes('/parent/children')||path.includes('/public/tenant-brand')||path.endsWith('/api/me')||path.endsWith('/api/password')||path.includes('/supervisors')||/\/api\/(?:accounts|data\/students)(?:\/|$)/.test(path))
    examples.push({request:{method,path,body:data??null,actor:ops?'platform_admin':cookie.startsWith('__Host-yx')?'root_session':'path_session_or_anonymous'},response:{status:response.status,body}});
  return {status:response.status,body,text,cookie:response.headers.get('set-cookie')?.split(';')[0],queries:Number(response.headers.get('x-test-d1-queries'))};
}
function ok(x,status=200) {assert.equal(x.status,status,x.text);return x.body;}
const admin=(f,path,method='GET',d)=>call(f,'/api/ops/'+path,method,d,f.adminCookie,true);
const scoped=(s,path,method='GET',d,token=s.token)=>call(s.f,'/'+s.t.slug+'/api/'+path,method,d,'channel_session='+token);
async function root(f,phone='13911112222',password=PASSWORD) {return call(f,'/api/auth/login','POST',{phone,password,turnstile:'fixture-valid'});}
async function parent(s,student=s.students[0],phone='13800001111') {return ok(await scoped(s,'students/'+student+'/guardians','POST',{phone,name:'测试家长',relation:'mother'}),201);}
async function loginParent(s,created,phone='13800001111') {
  const result=await scoped(s,'auth/login','POST',{phone,password:created.temporary_password,turnstile:'fixture-valid'});
  ok(result);s.f.db.raw.prepare('UPDATE users SET must_change=0 WHERE tenant_id=? AND id=?').run(s.t.id,created.user.id);
  return result.cookie;
}
async function withSetup(fn,n=2) {const f=await fixture();try {await fn({...await setup(f,n,'identity'),f});}finally {f.restore();}}

// §7 11,19a: count actual PBKDF2 operations, rather than comparing wall-clock time.
test('YX2 根登录0/1/3/5候选均固定五槽，超过5候选告警且不泄漏其他机构',async()=>{
  const f=await fixture();try {
    const original=crypto.subtle.deriveBits.bind(crypto.subtle);let count=0;
    const measure=async()=>{count=0;crypto.subtle.deriveBits=async(...a)=>{count++;return original(...a);};try{return await root(f);}finally{crypto.subtle.deriveBits=original;assert.equal(count,5);}};
    ok(await measure(),401);
    await schoolFixture(f,'one');ok(await measure());
    await schoolFixture(f,'two');await schoolFixture(f,'three');assert.equal(ok(await measure()).choices.length,3);
    await schoolFixture(f,'four');await schoolFixture(f,'five');assert.equal(ok(await measure()).choices.length,5);
    await schoolFixture(f,'six');assert.equal(ok(await measure()).choices.length,5);
    assert.ok(f.db.raw.prepare("SELECT COUNT(*) n FROM platform_audit WHERE action='平台手机号候选告警'").get().n>0);
  }finally{f.restore();}
});
test('YX2 多机构选择只列密码通过项，选择令牌120秒/一次有效且只存哈希',async()=>{
  const f=await fixture();try {
    const a=await schoolFixture(f,'ca'),b=await schoolFixture(f,'cb');
    const choices=ok(await root(f));assert.equal(choices.need_tenant_choice,true);assert.equal(choices.ttl,120);
    const token=choices.choices.find(x=>x.name===a.t.name).choice_token;
    assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM login_choices WHERE token_hash=?').get(token).n,0);
    const selected=await call(f,'/api/auth/login/choose','POST',{choice_token:token});assert.equal(ok(selected).api_base,'/api');
    assert.equal(ok(await call(f,'/api/me','GET',undefined,selected.cookie)).tenant_id,a.t.id);
    ok(await call(f,'/api/auth/login/choose','POST',{choice_token:token}),401);
    ok(await call(f,'/api/auth/login/choose','POST',{choice_token:choices.choices.find(x=>x.name===b.t.name).choice_token}),401);
    const again=ok(await root(f));f.db.raw.prepare('UPDATE login_choices SET expires_at=0').run();
    ok(await call(f,'/api/auth/login/choose','POST',{choice_token:again.choices[0].choice_token}),401);
  }finally{f.restore();}
});
test('YX2 单机构匹配直接建根会话，多候选只有一个密码匹配不泄漏其他机构',async()=>{
  const f=await fixture();try {
    const a=await schoolFixture(f,'password-a'),b=await schoolFixture(f,'password-b');
    await b.r.password(b.user.id,1,await newPassword(f.env,'DifferentSecret9X'),{id:'fixture',name:'测试'},0);
    const response=await root(f);assert.equal(ok(response).need_tenant_choice,undefined);assert.match(response.cookie,/^__Host-yx_session=/);
    assert.equal(ok(await call(f,'/api/me','GET',undefined,response.cookie)).tenant_id,a.t.id);
    assert.equal(f.db.raw.prepare("SELECT kind FROM sessions WHERE tenant_id=? ORDER BY created_at DESC LIMIT 1").get(a.t.id).kind,'root');
  }finally{f.restore();}
});
test('YX2 登录限流同时按手机号与IP，固定五槽仍执行，15分钟后恢复',async t=>{
  const f=await fixture();try {
    await schoolFixture(f,'limit');f.env.TURNSTILE_MODE='off';
    for(let i=0;i<3;i++) ok(await root(f,'13911112222','WrongPassword9'),401);
    ok(await root(f),401);
    assert.ok(f.db.raw.prepare("SELECT COUNT(*) n FROM security_limits WHERE key LIKE 'root-login:%' AND locked_until>0").get().n>0);
    t.mock.timers.enable({apis:['Date'],now:Date.now()+900001});ok(await root(f));
    for(let i=0;i<11;i++) await root(f,'138'+String(10000000+i),'WrongPassword9');
    ok(await root(f),401);
  }finally{f.restore();}
});
test('YX2 根登录拒绝老师/家长/学员账号，路径登录返回api_base及受限Cookie',()=>withSetup(async s=>{
  const p=await parent(s);ok(await root(s.f,'13800001111',p.temporary_password),401);
  const teacher=ok(await scoped(s,'accounts','POST',{phone:'13800002222',name:'老师',roles:['teacher'],teacher_id:s.teacher}),201);
  ok(await root(s.f,'13800002222',teacher.temporary_password),401);
  const student=ok(await scoped(s,'accounts','POST',{phone:'13800003333',name:'学员',roles:['student'],student_id:s.students[1]}),201);
  ok(await root(s.f,'13800003333',student.temporary_password),401);
  const response=await scoped(s,'auth/login','POST',{phone:'13911112222',password:PASSWORD,turnstile:'fixture-valid'});
  assert.equal(ok(response).api_base,'/'+s.t.slug+'/api');assert.match(response.cookie,/^channel_session=/);
  assert.equal(ok(await scoped(s,'auth/status')).api_base,'/'+s.t.slug+'/api');
  assert.equal(ok(await call(s.f,'/api/auth/status')).authenticated,false);
}));
test('YX2 路径A会话不能访问B，根/路径会话不得互冒用',()=>withSetup(async s=>{
  const other=await schoolFixture(s.f,'foreign');
  ok(await call(s.f,'/'+other.t.slug+'/api/me','GET',undefined,'channel_session='+s.token),404);
  const login=ok(await root(s.f)),choice=login.choices.find(x=>x.name===s.t.name);
  const selected=await call(s.f,'/api/auth/login/choose','POST',{choice_token:choice.choice_token});ok(selected);
  const raw=selected.cookie.split('=').slice(1).join('=');
  ok(await call(s.f,'/'+s.t.slug+'/api/me','GET',undefined,'channel_session='+raw),401);
  ok(await call(s.f,'/api/me','GET',undefined,'__Host-yx_session='+s.token),401);
}));
test('YX2 停用/到期403不删会话；status与品牌例外；恢复后原会话继续用',()=>withSetup(async s=>{
  const rootSession=await root(s.f);ok(rootSession);
  const before=s.f.db.raw.prepare('SELECT COUNT(*) n FROM sessions WHERE tenant_id=?').get(s.t.id).n;
  let config=ok(await admin(s.f,'tenants/'+s.t.id));
  ok(await admin(s.f,'tenants/'+s.t.id+'/suspend','POST',{version:config.version,reason:'试用停用'}));
  for(const [path,cookie] of [['/api/me',rootSession.cookie],['/'+s.t.slug+'/api/me','channel_session='+s.token]]) {
    const result=await call(s.f,path,'GET',undefined,cookie);assert.equal(ok(result,403).error??result.body.code,'tenant_expired');
  }
  assert.equal(s.f.db.raw.prepare('SELECT COUNT(*) n FROM sessions WHERE tenant_id=?').get(s.t.id).n,before);
  assert.equal(ok(await call(s.f,'/api/auth/status','GET',undefined,rootSession.cookie)).tenant_status,'paused');
  assert.equal(ok(await call(s.f,'/'+s.t.slug+'/api/auth/status')).tenant_status,'paused');
  ok(await call(s.f,'/api/public/tenant-brand?slug='+s.t.slug));
  config=ok(await admin(s.f,'tenants/'+s.t.id));ok(await admin(s.f,'tenants/'+s.t.id+'/resume','POST',{version:config.version,reason:'恢复试用'}));
  ok(await call(s.f,'/api/me','GET',undefined,rootSession.cookie));ok(await scoped(s,'me'));
  config=ok(await admin(s.f,'tenants/'+s.t.id));ok(await admin(s.f,'tenants','PUT',{id:s.t.id,version:config.version,expires_at:'2000-01-01'}));
  ok(await scoped(s,'me'),403);config=ok(await admin(s.f,'tenants/'+s.t.id));
  ok(await admin(s.f,'tenants','PUT',{id:s.t.id,version:config.version,expires_at:null}));ok(await scoped(s,'me'));
}));
test('YX2 停用期间自然过期会话恢复后仍401；改slug仍撤销所有会话',()=>withSetup(async s=>{
  let config=ok(await admin(s.f,'tenants/'+s.t.id));ok(await admin(s.f,'tenants/'+s.t.id+'/suspend','POST',{version:config.version,reason:'测试自然过期'}));
  s.f.db.raw.prepare('UPDATE sessions SET expires_at=0 WHERE tenant_id=?').run(s.t.id);
  config=ok(await admin(s.f,'tenants/'+s.t.id));ok(await admin(s.f,'tenants/'+s.t.id+'/resume','POST',{version:config.version,reason:'恢复'}));ok(await scoped(s,'me'),401);
  ok(await root(s.f));config=ok(await admin(s.f,'tenants/'+s.t.id));ok(await admin(s.f,'tenants','PUT',{id:s.t.id,version:config.version,slug:'changed-school'}));
  assert.equal(s.f.db.raw.prepare('SELECT COUNT(*) n FROM sessions WHERE tenant_id=?').get(s.t.id).n,0);
}));
test('YX2 家长绑定多孩子、不改原密码、解绑立即不可见及自动停用恢复',()=>withSetup(async s=>{
  const first=await parent(s),cookie=await loginParent(s,first);
  assert.equal(ok(await call(s.f,'/'+s.t.slug+'/api/parent/children','GET',undefined,cookie)).items.length,1);
  const second=await parent(s,s.students[1]);assert.equal(second.temporary_password,undefined);
  assert.equal(ok(await call(s.f,'/'+s.t.slug+'/api/parent/children','GET',undefined,cookie)).items.length,2);
  ok(await scoped(s,'students/'+s.students[0]+'/guardians/'+first.link.id,'DELETE',{}));
  ok(await call(s.f,'/'+s.t.slug+'/api/data/students/'+s.students[0],'GET',undefined,cookie),404);
  assert.equal(ok(await call(s.f,'/'+s.t.slug+'/api/parent/children','GET',undefined,cookie)).items.length,1);
  ok(await scoped(s,'students/'+s.students[1]+'/guardians/'+second.link.id,'DELETE',{}));
  const disabled=await s.r.user(first.user.id);assert.equal(disabled.active,0);assert.equal(disabled.disabled_reason,'no_children');
  const rebound=await parent(s);assert.equal(rebound.user.active,true);assert.equal(rebound.temporary_password,undefined);
  assert.equal(s.f.db.raw.prepare('SELECT COUNT(*) n FROM platform_phone_index WHERE tenant_id=? AND user_id=?').get(s.t.id,first.user.id).n,0);
}));
test('YX2 家长手动停用不会被重新绑定恢复，员工启用后可重绑',()=>withSetup(async s=>{
  const p=await parent(s);ok(await scoped(s,'parents/'+p.user.id+'/disable','POST',{}));
  assert.equal((await s.r.user(p.user.id)).disabled_reason,'manual');
  assert.equal(ok(await scoped(s,'students/'+s.students[1]+'/guardians','POST',{phone:'13800001111',name:'家长',relation:'father'}),409).error,'account_disabled');
  const u=await s.r.user(p.user.id);ok(await scoped(s,'accounts/'+u.id,'PATCH',{version:u.version,name:u.name,roles:['parent'],active:true}));
  await parent(s,s.students[1]);
}));
test('YX2 家长CRUD乐观锁、关系校验、密码重置、重复绑定及员工手机号冲突',()=>withSetup(async s=>{
  const p=await parent(s),list=ok(await scoped(s,'students/'+s.students[0]+'/guardians'));assert.equal(list.items.length,1);
  assert.match(p.link.created_at,/\+08:00$/);
  const base='students/'+s.students[0]+'/guardians/'+p.link.id;
  const changed=ok(await scoped(s,base,'PATCH',{version:1,relation:'grandparent'}));assert.equal(changed.link.relation,'grandparent');
  assert.ok(ok(await scoped(s,base,'PATCH',{version:1,relation:'father'}),409).details.latest);
  ok(await scoped(s,base,'PATCH',{version:2,relation:'invalid'}),422);
  ok(await scoped(s,'students/'+s.students[0]+'/guardians','POST',{phone:'13800001111',name:'重复',relation:'mother'}),409);
  assert.equal(ok(await scoped(s,'students/'+s.students[0]+'/guardians','POST',{phone:'13911112222',name:'员工',relation:'father'}),409).error,'phone_in_use');
  const reset=ok(await scoped(s,'parents/'+p.user.id+'/reset-password','POST',{}));assert.ok(reset.temporary_password);assert.notEqual(reset.temporary_password,p.temporary_password);
  assert.ok((await s.r.logs('audit',0)).some(x=>x.module==='parents'));
}));
test('YX2 家长和学员可并存，四位家长与十个孩子数量限制原子执行',()=>withSetup(async s=>{
  for(let i=0;i<4;i++)await parent(s,s.students[0],'1380000'+String(1111+i));
  ok(await scoped(s,'students/'+s.students[0]+'/guardians','POST',{phone:'13800009999',name:'超限',relation:'other'}),422);
  assert.equal(await s.r.userByPhone(await phoneIndex(s.f.env,s.t.id,'13800009999')),null);
  for(let i=0;i<9;i++) {const id=ok(await scoped(s,'data/students','POST',{name:'其他孩子'+i})).id;await parent(s,id);}
  const extra=ok(await scoped(s,'data/students','POST',{name:'第11个孩子'})).id;
  ok(await scoped(s,'students/'+extra+'/guardians','POST',{phone:'13800001111',name:'超限',relation:'other'}),422);
  ok(await scoped(s,'accounts','POST',{phone:'13899990000',name:'学生本人',roles:['student'],student_id:s.students[0]}),201);
}));
test('YX2 A机构不能读改删B的家长绑定或账号，家长不能自行绑孩子',()=>withSetup(async s=>{
  const b={...await setup(s.f,1,'foreign-guardian'),f:s.f},p=await parent(b);
  for(const [path,method,d] of [
    ['students/'+b.students[0]+'/guardians','GET'],['students/'+b.students[0]+'/guardians/'+p.link.id,'PATCH',{version:1,relation:'father'}],
    ['students/'+b.students[0]+'/guardians/'+p.link.id,'DELETE',{}],['parents/'+p.user.id+'/disable','POST',{}],['parents/'+p.user.id+'/reset-password','POST',{}]]) ok(await scoped(s,path,method,d),404);
  const own=await parent(s),cookie=await loginParent(s,own);
  ok(await call(s.f,'/'+s.t.slug+'/api/students/'+s.students[0]+'/guardians','POST',{phone:'13800007777',name:'越权',relation:'father'},cookie),403);
}));
test('YX2 新角色组合合法性与权限并集，个人角色不能混用',async()=>{
  assert.deepEqual(rolesInput(['supervisor','consultant','academic','finance']),['supervisor','consultant','academic','finance']);
  for(const one of ['teacher','student','parent']) {assert.deepEqual(rolesInput([one]),[one]);assert.throws(()=>rolesInput([one,'consultant']));}
  const policy={modules:Object.fromEntries(modules.map(x=>[x,true])),settings:{},rights:[]};
  assert.equal(can({roles:['consultant']},policy,'plans','write'),true);
  assert.equal(can({roles:['consultant']},policy,'prices','write'),false);
  assert.equal(can({roles:['consultant']},policy,'settings','propose'),true);
  assert.equal(can({roles:['teacher'],teacher_id:'t'},policy,'growth_reports','write',{teacher_id:'other',student_id:'s'}),false);
  assert.equal(can({roles:['parent'],guardian_student_ids:['s']},policy,'growth_reports','read',{student_id:'s',status:'draft'}),false);
  assert.equal(can({roles:['parent'],guardian_student_ids:['s']},policy,'growth_reports','read',{student_id:'s',status:'published'}),true);
});
test('YX2 财务计管理席位，老师和家长不计；停用员工释放席位，重新启用受限制',()=>withSetup(async s=>{
  const finance=ok(await scoped(s,'accounts','POST',{phone:'13810000001',name:'财务',roles:['finance']}),201);
  s.f.db.raw.prepare('UPDATE tenants SET staff_seat_limit=2 WHERE id=?').run(s.t.id);
  const denied=await scoped(s,'accounts','POST',{phone:'13810000002',name:'顾问',roles:['consultant']});assert.equal(ok(denied,403).code??denied.body.error,'seat_limit_reached');
  ok(await scoped(s,'accounts','POST',{phone:'13810000003',name:'老师',roles:['teacher'],teacher_id:s.teacher}),201);await parent(s);
  let u=await s.r.user(finance.id);ok(await scoped(s,'accounts/'+u.id,'PATCH',{version:u.version,name:u.name,roles:['finance'],active:false}));
  ok(await scoped(s,'accounts','POST',{phone:'13810000004',name:'顾问',roles:['consultant']}),201);
  u=await s.r.user(finance.id);ok(await scoped(s,'accounts/'+u.id,'PATCH',{version:u.version,name:u.name,roles:['finance'],active:true}),403);
}));
test('YX2 平台手机号索引随创建、改号、角色、启停账号及机构启停同步',()=>withSetup(async s=>{
  const made=ok(await scoped(s,'accounts','POST',{phone:'13810000101',name:'员工',roles:['consultant']}),201);
  const count=()=>s.f.db.raw.prepare('SELECT COUNT(*) n FROM platform_phone_index WHERE tenant_id=? AND user_id=?').get(s.t.id,made.id).n;
  assert.equal(count(),1);let u=await s.r.user(made.id);
  ok(await scoped(s,'accounts/'+u.id,'PATCH',{version:u.version,name:u.name,roles:['academic'],active:true,phone:'13810000102'}));
  const row=s.f.db.raw.prepare('SELECT phone_hmac_platform FROM platform_phone_index WHERE tenant_id=? AND user_id=?').get(s.t.id,u.id);
  assert.equal(row.phone_hmac_platform,await platformPhoneIndex(s.f.env,'13810000102'));
  u=await s.r.user(u.id);ok(await scoped(s,'accounts/'+u.id,'PATCH',{version:u.version,name:u.name,roles:['academic'],active:false}));assert.equal(count(),0);
  u=await s.r.user(u.id);ok(await scoped(s,'accounts/'+u.id,'PATCH',{version:u.version,name:u.name,roles:['academic'],active:true}));assert.equal(count(),1);
  // Repository-level repair/import role transitions must also maintain index safety.
  s.f.db.raw.prepare("UPDATE users SET roles='[\"parent\"]' WHERE tenant_id=? AND id=?").run(s.t.id,u.id);assert.equal(count(),0);
  s.f.db.raw.prepare("UPDATE users SET roles='[\"academic\"]' WHERE tenant_id=? AND id=?").run(s.t.id,u.id);assert.equal(count(),1);
  let t=ok(await admin(s.f,'tenants/'+s.t.id));ok(await admin(s.f,'tenants/'+s.t.id+'/suspend','POST',{version:t.version,reason:'索引停用'}));assert.equal(count(),0);
  t=ok(await admin(s.f,'tenants/'+s.t.id));ok(await admin(s.f,'tenants/'+s.t.id+'/resume','POST',{version:t.version,reason:'索引恢复'}));assert.equal(count(),1);
}));
test('YX2 平台索引重建脚本权限检查、密钥独立、修复缺失索引',()=>withSetup(async s=>{
  s.f.db.raw.prepare('UPDATE users SET platform_phone_hmac=NULL WHERE tenant_id=?').run(s.t.id);
  await assert.rejects(()=>rebuildPlatformPhoneIndex(s.f.env,{role:'consultant',id:'bad'}));
  assert.ok((await rebuildPlatformPhoneIndex(s.f.env,{role:'owner',id:'adm_fixture'})).processed>=1);
  assert.notEqual(await platformPhoneIndex(s.f.env,'13911112222'),await phoneIndex(s.f.env,s.t.id,'13911112222'));
  ok(await root(s.f));
}));
test('YX2 学员新增字段保存读取，伪造跨机构来源线索拒绝',()=>withSetup(async s=>{
  let old=ok(await scoped(s,'data/students/'+s.students[0])).record;
  ok(await scoped(s,'data/students/'+old.id,'PATCH',{version:old.version,nickname:'小星',parent_consent_media:true,source_lead_id:null,report_class_id:null}));
  const updated=ok(await scoped(s,'data/students/'+old.id)).record;assert.equal(updated.nickname,'小星');assert.equal(updated.parent_consent_media,1);
  ok(await scoped(s,'data/students/'+old.id,'PATCH',{version:updated.version,source_lead_id:'rec_ffffffffffffffffffffffff'}),404);
}));
test('YX2 ops机构创建、列表分页、修改、模块标签、学科与覆盖配置、并发和Access',async()=>{
  const f=await fixture();try {
    const created=ok(await admin(f,'tenants','POST',{name:'星光测试',slug:'starlight-test',staff_seat_limit:4,expires_at:'2026-12-31',subjects:['music_interest'],modules:{growth_reports:false},ai_override:{fast_daily_limit:12,deep_daily_limit:null}}),201);
    assert.equal(created.modules.school_db,false);assert.equal(created.modules.growth_reports,false);assert.equal(created.modules.reports,true);
    assert.equal(created.module_labels.growth_reports,'成长报告');assert.equal(created.module_labels.reports,'统计报表');assert.equal(created.subjects[0].key,'music_interest');
    const list=ok(await admin(f,'tenants?offset=0&limit=1'));assert.equal(list.total,1);assert.equal(list.next_offset,null);
    const updated=ok(await admin(f,'tenants','PUT',{id:created.id,version:created.version,name:'星光更新'}));assert.equal(updated.name,'星光更新');
    assert.ok(ok(await admin(f,'tenants','PUT',{id:created.id,version:created.version,name:'覆盖'}),409).details.latest);
    ok(await admin(f,'tenants','POST',{name:'重复',slug:'starlight-test'}),409);
    ok(await admin(f,'tenants','POST',{name:'保留字',slug:'api'}),422);
    ok(await call(f,'/api/ops/tenants','GET',undefined,'',true),401);
    ok(await call(f,'/api/ops/tenants','GET',undefined,f.adminCookie,true,{'Cf-Access-Jwt-Assertion':'bad'}),403);
  }finally{f.restore();}
});
test('YX2 超管撤销会话需要二次确认，只撤本机构且有审计',()=>withSetup(async s=>{
  const other=await schoolFixture(s.f,'retained-other');ok(await root(s.f));
  const t=ok(await admin(s.f,'tenants/'+s.t.id));
  ok(await admin(s.f,'tenants/'+s.t.id+'/revoke-sessions','POST',{version:t.version,reason:'强制下线',confirm_name:'错误'}),422);
  ok(await admin(s.f,'tenants/'+s.t.id+'/revoke-sessions','POST',{version:t.version,reason:'强制下线',confirm_name:t.name}));
  assert.equal(s.f.db.raw.prepare('SELECT COUNT(*) n FROM sessions WHERE tenant_id=?').get(s.t.id).n,0);
  ok(await scoped(s,'me'),401);ok(await other.call('me'));
  assert.ok(s.f.db.raw.prepare("SELECT COUNT(*) n FROM platform_audit WHERE tenant_id=? AND action='revoke_sessions'").get(s.t.id).n>0);
}));
test('YX2 统计报表与成长报告权限/模块完全独立，财务仍能查询与导出统计报表',()=>withSetup(async s=>{
  const fin=await accountToken(s,['finance']);
  ok(await request(s,'finance/report?month=2026-11','GET',undefined,fin.token));
  const exported=await s.f.request('https://school.test/'+s.t.slug+'/api/export?kind=report&month=2026-11',{headers:{Cookie:'channel_session='+fin.token}});assert.equal(exported.status,200);
  const p=await s.r.policy();assert.equal(can({roles:['finance']},p,'reports','read'),true);assert.equal(can({roles:['finance']},p,'growth_reports','read'),false);
  assert.equal(can({roles:['academic']},p,'reports','read'),true);assert.equal(can({roles:['academic']},p,'growth_reports','write'),true);
  await repo(s.f.env,null).module(s.t.id,'growth_reports',false,'adm_fixture');
  ok(await request(s,'finance/report?month=2026-11','GET',undefined,fin.token));
  await repo(s.f.env,null).module(s.t.id,'growth_reports',true,'adm_fixture');await repo(s.f.env,null).module(s.t.id,'reports',false,'adm_fixture');
  const current=await repo({...s.f.env},s.t.id).policy();assert.equal(can({roles:['academic']},current,'growth_reports','read'),true);assert.equal(can({roles:['finance']},current,'reports','read'),false);
  const me=ok(await scoped(s,'me'));assert.equal(me.module_labels.growth_reports,'成长报告');assert.equal(me.module_labels.reports,'统计报表');
  ok(await scoped(s,'reports/rpt_not_implemented','GET',undefined,fin.token),404);
}));
test('YX2 新字段和家长绑定进入加密备份快照',()=>withSetup(async s=>{
  const p=await parent(s);await startBackup(s.f.env,Date.now());
  const row=s.f.db.raw.prepare("SELECT row_json FROM backup_snapshot_rows WHERE tenant_id=? AND table_name='guardian_links'").get(s.t.id);
  assert.ok(row);assert.equal(JSON.parse(row.row_json).parent_user_id,p.user.id);
  const student=s.f.db.raw.prepare("SELECT row_json FROM backup_snapshot_rows WHERE tenant_id=? AND table_name='students' LIMIT 1").get(s.t.id);const savedStudent=JSON.parse(student.row_json);assert.equal(savedStudent.nickname,savedStudent.name);
}));
test('YX2 根路径在认证前拒绝控制台与未知路由，路径新接口跨机构返回not_found',()=>withSetup(async s=>{
  for(const path of ['/api/overview','/api/tenants','/api/ops/tenants','/api/not-registered']) {
    assert.equal(ok(await call(s.f,path),404).error,'not_found');
    assert.equal(ok(await call(s.f,path,'GET',undefined,'channel_session='+s.token),404).error,'not_found');
  }
  const b=await schoolFixture(s.f,'typed-foreign');
  assert.equal(ok(await call(s.f,'/'+b.t.slug+'/api/parent/children','GET',undefined,'channel_session='+s.token),404).error,'not_found');
}));
test('YX2 顾问兼财务权限取并集，教务可管家长，平台顾问不能管理机构',()=>withSetup(async s=>{
  const combo=await accountToken(s,['consultant','finance']);
  const me=ok(await scoped(s,'me','GET',undefined,combo.token));
  assert.equal(me.capabilities.leads.create,true);assert.equal(me.capabilities.plans.write,true);assert.equal(me.capabilities.reports.read,true);assert.equal(me.capabilities.growth_reports.write,false);
  const academic=await accountToken(s,['academic']);
  ok(await scoped(s,'students/'+s.students[0]+'/guardians','POST',{phone:'13811112222',name:'教务开通',relation:'father'},academic.token),201);
  s.f.db.raw.prepare("UPDATE platform_admins SET role='consultant' WHERE id='adm_fixture'").run();
  ok(await admin(s.f,'tenants'),403);
}));
test('YX2 ops停用状态字段生效、品牌图片按实际字节检查、写入竞态回滚且返回最新版本',()=>withSetup(async s=>{
  let t=ok(await admin(s.f,'tenants/'+s.t.id));
  const paused=ok(await admin(s.f,'tenants','PUT',{id:s.t.id,version:t.version,status:'paused'}));assert.equal(paused.status,'paused');
  ok(await scoped(s,'me'),403);
  t=ok(await admin(s.f,'tenants','PUT',{id:s.t.id,version:paused.version,status:'active'}));ok(await scoped(s,'me'));
  ok(await admin(s.f,'tenants','PUT',{id:s.t.id,version:t.version,logo:'data:image/png;base64,'+Buffer.from('<svg onload="x"></svg>').toString('base64')}),422);
  const original=s.f.db.batch.bind(s.f.db);let injected=false;
  s.f.db.batch=async statements=>{
    if(!injected&&statements.some(x=>x.query?.includes('UPDATE tenants SET slug='))) {
      injected=true;s.f.db.raw.prepare('UPDATE tenants SET version=version+1 WHERE id=?').run(s.t.id);
    }
    return original(statements);
  };
  const result=ok(await admin(s.f,'tenants','PUT',{id:s.t.id,version:t.version,name:'不应写入的覆盖'}),409);
  assert.equal(result.error,'version_conflict');assert.equal(result.details.latest.version,t.version+1);
  assert.equal((await s.r.tenant()).name,s.t.name);
}));
test('YX2 手动停用且解绑全部孩子后可先启用再重绑，家长me只返回机构信息',()=>withSetup(async s=>{
  const p=await parent(s);const cookie=await loginParent(s,p);
  const me=ok(await call(s.f,'/'+s.t.slug+'/api/me','GET',undefined,cookie));
  assert.equal(me.brand.name,s.t.name);assert.equal(me.policy,undefined);assert.equal(me.module_labels,undefined);assert.ok(!JSON.stringify(me).includes('艺界星途'));
  ok(await scoped(s,'parents/'+p.user.id+'/disable','POST',{}));
  ok(await scoped(s,'students/'+s.students[0]+'/guardians/'+p.link.id,'DELETE',{}));
  let u=await s.r.user(p.user.id);assert.equal(u.disabled_reason,'manual');
  ok(await scoped(s,'accounts/'+u.id,'PATCH',{version:u.version,name:u.name,roles:['parent'],active:true}));
  const rebound=await parent(s);assert.equal(rebound.user.active,true);
}));
test('YX2 新机构可由超管沿用主管开通接口，初始改密后根登录与账号列表可用',async()=>{
  const f=await fixture();try {
    const t=ok(await admin(f,'tenants','POST',{name:'新机构开通演示',slug:'new-owner-demo',staff_seat_limit:3}),201);
    const opened=ok(await call(f,'/api/tenants/'+t.id+'/supervisors','POST',{name:'新主管',phone:'13823456789',roles:['supervisor']},f.adminCookie,true),201);
    let login=await root(f,'13823456789',opened.temporary_password);assert.equal(ok(login).must_change,true);
    ok(await call(f,'/api/password','POST',{old_password:opened.temporary_password,password:'OwnerSecure9Z'},login.cookie));
    login=await root(f,'13823456789','OwnerSecure9Z');assert.equal(ok(login).must_change,false);
    const users=ok(await call(f,'/api/accounts','GET',undefined,login.cookie)).items;
    assert.equal(users.length,1);assert.deepEqual(users[0].roles,['supervisor']);assert.equal(users[0].phone,'***6789');
  }finally{f.restore();}
});
test('YX2 接口例子为本次HTTP调用真实响应，写出前端模拟素材',async()=>{
  assert.ok(examples.length>30);await mkdir('work/stage2',{recursive:true});
  await writeFile('work/stage2/http-examples'+(process.env.TEST_BUNDLE==='1'?'-bundle':'')+'.json',JSON.stringify({notice:'本地虚构机构和账号；未连接线上；响应来自实际HTTP测试',examples},null,2)+'\n');
});
