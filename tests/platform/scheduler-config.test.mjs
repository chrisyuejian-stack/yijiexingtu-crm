import test from 'node:test';
import assert from 'node:assert/strict';
import {CronScheduler,matchingCrons} from '../../platform/scheduler.mjs';
import {loadConfig,checkDatabase} from '../../platform/config.mjs';
import {SqliteD1} from '../../platform/d1-sqlite.mjs';
import {fileFixture} from './helpers.mjs';
test('PLAT UTC 19:00 invokes daily then five-minute with exact minute and separate env',async()=>{
 const calls=[],envs=[];const at=Date.UTC(2026,10,18,19,0),scheduler=new CronScheduler({async scheduled(c,e,ctx){calls.push(c);envs.push(e);ctx.waitUntil(Promise.resolve());}},()=>({}),{now:()=>at-60000,log:()=>{}});
 await scheduler.tick(at+12000);assert.deepEqual(calls.map(x=>x.cron),['0 19 * * *','*/5 * * * *']);assert.ok(calls.every(x=>x.scheduledTime===at));assert.notEqual(envs[0],envs[1]);await scheduler.tick(at+30000);assert.equal(calls.length,2);assert.deepEqual(matchingCrons(Date.UTC(2026,10,19,3,0)),['*/5 * * * *']);assert.deepEqual(matchingCrons(at+60000),[]);
});
test('PLAT cron no overlap, tracks waitUntil, skips missed minutes and no startup backfill',async()=>{
 const at=Date.UTC(2026,10,18,18,55),calls=[],logs=[];let release;const hold=new Promise(r=>release=r);const scheduler=new CronScheduler({async scheduled(c,e,ctx){calls.push(c.cron);ctx.waitUntil(hold);}},()=>({}),{now:()=>at,log:r=>logs.push(r)});
 await scheduler.tick(at);assert.equal(calls.length,0);const running=scheduler.tick(at+5*60000);await new Promise(setImmediate);await scheduler.tick(at+10*60000);assert.equal(logs[0].event,'cron_skipped_busy');assert.equal(calls.length,1);release();await running;assert.equal(calls.length,2);await scheduler.tick(at+11*60000);assert.equal(calls.length,2);await scheduler.stop();
});
test('PLAT cron failure of daily still runs separately scheduled maintenance',async()=>{
 const at=Date.UTC(2026,10,18,19),calls=[];const s=new CronScheduler({async scheduled(c){calls.push(c.cron);if(c.cron==='0 19 * * *')throw Error('failure');}},()=>({}),{now:()=>at-60000,log:()=>{}});await s.tick(at);assert.deepEqual(calls,['0 19 * * *','*/5 * * * *']);
});
test('PLAT config role default, explicit off, original key formats, no AI_PROVIDER or wrong region',async()=>{
 const f=await fileFixture();try{
  const role={...f.variables,COS_AUTH:'role',COS_ROLE_NAME:'yxt-cos-role'};delete role.COS_SECRET_ID;delete role.COS_SECRET_KEY;assert.equal(loadConfig(role).cos.auth,'role');
  for(const mutate of [e=>delete e.ACCESS_MODE,e=>e.TURNSTILE_MODE='on',e=>e.FIELD_KEY='wrong',e=>e.HMAC_KEY='short',e=>e.PLATFORM_PHONE_HMAC_KEY='short',e=>e.COS_REGION='ap-beijing',e=>e.AI_PROVIDER='test',e=>e.CONSOLE_HOST=e.TENANT_HOST,e=>e.MAX_BODY_BYTES='999999999']){const e={...f.variables};mutate(e);assert.throws(()=>loadConfig(e));}
 }finally{await f.close();}
});
test('PLAT startup checks migration 0028 and foreign keys; missing version objects rejected',async()=>{
 const f=await fileFixture();const db=new SqliteD1(f.path);try{await checkDatabase(db);await db.exec('DROP TRIGGER plan_v2_element_identity');await assert.rejects(checkDatabase(db),/Missing 0028/);}finally{db.close();await f.close();}
});
