import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScenario } from '../scripts/e2e/scenario.mjs';
import { measureDatabase, apiTiming } from '../src/server/request-timing.js';
import { validateReadPaths } from '../src/server/read-batch.js';
async function setup() {
  const s=await createScenario();
  s.call=(path,role='supervisor',data)=>s.f.request(`http://localhost/${s.manifest.slug}/api/${path}`,{method:data===undefined?'GET':'POST',headers:{Origin:'http://localhost',Cookie:`channel_session=${s.tokens[role]}`,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  return s;
}
test('P4 batch whitelist rejects writes, traversal, absolute URLs and oversized arrays',()=>{
  for(const paths of [[],Array(13).fill('c2/home'),['credits/payments'],['c2/students/x/blocks'],['https://evil/c2/home'],['/c2/home'],['c2/students/../home'],['c2/home#x'],['c2/home\\x']]) assert.throws(()=>validateReadPaths(paths));
});
test('P4 batch parity for five roles, personal isolation, money projection and one authentication count',async()=>{
 const s=await setup();try {
 const paths=['c2/home','c2/students','c2/students/'+s.manifest.studentIds[1],'data/students/'+s.manifest.studentIds[1],'credits/packages','data/teachers','schedule','c2/students/counts','schedule-templates','c2/students/rec_000000000000000000000000'];
 for(const role of ['supervisor','academic','finance','teacher','student']) {
  s.f.db.raw.exec('DELETE FROM security_limits');
  const expected=[];for(const path of paths){const res=await s.call(path,role);expected.push({path,status:res.status,body:res.headers.get('content-type').includes('json')?await res.json():await res.text()});}
  s.f.db.raw.exec('DELETE FROM security_limits');
  const res=await s.call('read-batch',role,{paths});assert.equal(res.status,200);assert.deepEqual((await res.json()).results,expected,role);
  const counters=s.f.db.raw.prepare("SELECT key,count FROM security_limits WHERE key LIKE 'request%'").all();assert.equal(counters.length,1);assert.equal(counters[0].count,1);assert.ok(counters[0].key.startsWith('request-get:'));
  if(['teacher','student'].includes(role)){assert.equal(expected[2].status,403);assert.notEqual(expected[3].status,200);}
 }
 }finally{s.f.restore();}
});
test('P4 partial read-limit 429 preserves ordered accounting and permits zero-record sibling',async()=>{
 const s=await setup();try{
  const uid=s.f.db.raw.prepare("SELECT id FROM users WHERE tenant_id=? AND roles='[\"supervisor\"]'").get(s.manifest? s.f.db.raw.prepare('SELECT id FROM tenants WHERE slug=?').get(s.manifest.slug).id:'').id;
  const tid=s.f.db.raw.prepare('SELECT id FROM tenants WHERE slug=?').get(s.manifest.slug).id;
  s.f.db.raw.prepare('INSERT INTO security_limits(key,count,window_start,locked_until) VALUES(?,?,?,0)').run(`read:${tid}:${uid}`,49999,Math.floor(Date.now()/3600000)*3600000);
  const res=await s.call('read-batch','supervisor',{paths:['data/students','c2/students/counts','data/teachers']});const data=await res.json();assert.equal(res.status,200);assert.deepEqual(data.results.map(x=>x.status),[429,200,429]);assert.equal(data.results[0].body.code,'READ_LIMIT');
  assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM platform_audit WHERE action='读取量告警'").get().n,0);
 }finally{s.f.restore();}
});
test('P4 counts equal five legacy filters, including status, empty and out-of-range pages',async()=>{
 const s=await setup();try{
  const db=s.f.db.raw,tid=db.prepare('SELECT id FROM tenants WHERE slug=?').get(s.manifest.slug).id;
  db.prepare("INSERT INTO package_transactions(tenant_id,id,package_id,student_id,delta,type,date,created_at,created_by,updated_at,updated_by) SELECT tenant_id,'p4_low_balance',package_id,student_id,-9,'adjust','2026-11-12',0,'test',0,'test' FROM package_transactions WHERE tenant_id=? AND package_id=? LIMIT 1").run(tid,s.manifest.packageIds[0]);
  db.prepare("UPDATE students SET status='paused' WHERE tenant_id=? AND id=?").run(tid,s.manifest.studentIds[1]);
  const expected={};for(const [key,q] of Object.entries({active:'status=active',paused:'status=paused',archived:'status=archived',zero:'status=active&balance=zero',low:'status=active&balance=low'})){expected[key]=(await(await s.call('c2/students?'+q)).json()).total;}
  const res=await s.call('c2/students/counts');assert.equal(res.status,200);assert.deepEqual(await res.json(),expected);assert.ok(Number(res.headers.get('x-test-d1-queries'))<=3);
  assert.equal(expected.low,1);
  const page=await(await s.call('c2/students?offset=999')).json();assert.equal(page.total,1);assert.deepEqual(page.items,[]);
 }finally{s.f.restore();}
});
test('P4 brand lite uses versioned binary images, legacy unchanged and inactive tenant returns 404',async()=>{
 const s=await setup();try{
  const db=s.f.db.raw,tid=db.prepare('SELECT id FROM tenants WHERE slug=?').get(s.manifest.slug).id;
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
  db.prepare("UPDATE tenant_branding SET login_bg=?,logo=?,version=7 WHERE tenant_id=?").run(image,image,tid);
  const old=await(await s.call('public/brand')).json();assert.equal(old.login_bg,image);
  const lite=await(await s.call('public/brand?lite=1')).json();assert.ok(!('login_bg'in lite));assert.ok(!JSON.stringify(lite).includes('base64'));assert.ok(lite.login_bg_url.endsWith('?v=7'));
  const res=await s.call('public/brand/login-bg?v=7');assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'public, max-age=31536000, immutable');assert.equal(res.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await res.arrayBuffer()),Buffer.from(image.split(',')[1],'base64'));
  assert.equal((await s.call('public/brand/login-bg?v=6')).status,404);
  db.prepare("UPDATE tenants SET status='paused' WHERE id=?").run(tid);
  for(const path of ['public/brand','public/brand?lite=1','public/brand/login-bg?v=7'])assert.equal((await s.call(path)).status,404);
 }finally{s.f.restore();}
});
test('P4 metadata sums statements once, first exposes row/column and sanitizes region',async()=>{
 const stmt={bind(){return this},async all(){return {results:[{a:1}],meta:{timings:{sql_duration_ms:2},rows_read:3,rows_written:0,served_by_region:'APAC";secret'}}},async run(){return this.all()}};
 const db={prepare:()=>stmt,batch:async(items)=>Promise.all(items.map(x=>x.all()))};const timing={trips:0,dbMs:0};const wrapped=measureDatabase(db,timing);
 assert.deepEqual(await wrapped.prepare('x').first(),{a:1});assert.equal(await wrapped.prepare('x').first('a'),1);await wrapped.batch([wrapped.prepare('x'),wrapped.prepare('x')]);assert.equal(timing.trips,3);assert.equal(timing.sql_duration_ms,8);assert.equal(timing.rows_read,12);assert.equal(timing.rows_written,0);assert.ok(apiTiming(timing,performance.now()).includes('served_by_region;desc="APACsecret"'));
});
