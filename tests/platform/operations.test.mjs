import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {healthCheck} from '../../deploy/health-check.mjs';
import {runRclone} from '../../deploy/rclone-role.mjs';
import {parseCounts} from '../../deploy/verify.mjs';
import maintenance from '../../deploy/maintenance-pages/_worker.js';
import {loadCosSdk} from '../../platform/r2-cos.mjs';
import {fileFixture,MemoryCos} from './helpers.mjs';
import {startServer} from '../../server.mjs';
test('PLAT maintenance package rejects GET/POST on all paths without business writes',async()=>{
 for(const method of ['GET','POST'])for(const path of ['/','/api/auth/login','/api/data/students','/assets/tenant.js']){const response=await maintenance.fetch(new Request('https://school.test'+path,{method}));assert.equal(response.status,503);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Retry-After'),'3600');}
});
test('PLAT rclone child receives role credentials only in memory; no business keys are forwarded',async()=>{
 let calls=0,childOptions;await runRclone(['size','cos:bucket','--json'],{cos:{auth:'role',role:'yxt-cos-role'}},{fetchImpl:async()=>{calls++;return Response.json({Code:'Success',TmpSecretId:'temporary-id',TmpSecretKey:'temporary-key',Token:'session-token',ExpiredTime:Math.floor(Date.now()/1000)+3600});},spawnImpl:(bin,args,options)=>{assert.equal(bin,'rclone');childOptions=options;const child=new EventEmitter();queueMicrotask(()=>child.emit('exit',0,null));return child;}});assert.equal(calls,1);assert.equal(childOptions.env.RCLONE_CONFIG_COS_SESSION_TOKEN,'session-token');assert.equal(childOptions.env.FIELD_KEY,undefined);
});
test('PLAT health state alarms only on three consecutive failures and resets on success',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yxt-health-'));try{const state=join(dir,'state.json');for(let i=1;i<=3;i++){const r=await healthCheck({state,fetchImpl:async()=>new Response('',{status:503})});assert.equal(r.failures,i);assert.equal(r.alarm,i>=3);}assert.equal((await healthCheck({state,fetchImpl:async()=>new Response('ok')})).failures,0);}finally{await rm(dir,{recursive:true,force:true});}
});
test('PLAT source count JSON accepts D1 console single row and Wrangler shapes',()=>{
 assert.deepEqual(parseCounts([{counts:'{"students":3}'}]),{students:3});assert.deepEqual(parseCounts([{results:[{counts:'{"users":2}'}]}]),{users:2});assert.deepEqual(parseCounts([{table_name:'plans',row_count:5}]),{plans:5});
});
test('PLAT pinned official COS SDK loads offline without making service requests',()=>{
 const SDK=loadCosSdk(),client=new SDK({SecretId:'test',SecretKey:'test'});for(const method of ['putObject','getObject','headObject','deleteMultipleObject','getBucket'])assert.equal(typeof client[method],'function');
});
test('PLAT shutdown deadline closes/checkpoints DB and releases process lock despite pending cron',async()=>{
 const f=await fileFixture();let app;try{app=await startServer({config:f.config,port:0,shutdownMs:10,sdkFactory:()=>new MemoryCos(),log:()=>{},startScheduler:false});app.scheduler.active=new Promise(()=>{});const started=Date.now();await app.close();assert.ok(Date.now()-started<1000);assert.equal(app.db.closed,true);app=null;const next=await startServer({config:f.config,port:0,sdkFactory:()=>new MemoryCos(),log:()=>{},startScheduler:false});await next.close();}finally{await app?.close();await f.close();}
});

test('PLAT EnvironmentFile values remain literal, including dollar/backtick/backslash/hash; no shell evaluation',async()=>{
 const {parseEnvironmentFile,encodeEnvironmentValue}=await import('../../platform/env-file.mjs');
 for(const value of ['base64+/=','$(touch /tmp/never-run)','a`command`$HOME','quote"slash\\hash#',"single'quote"]){assert.equal(parseEnvironmentFile('KEY='+encodeEnvironmentValue(value)+'\n').KEY,value);}
 assert.equal(parseEnvironmentFile("# comment\nKEY='literal$()#'\n").KEY,'literal$()#');assert.throws(()=>encodeEnvironmentValue('line\nbreak'));
});

test('PLAT rehearsal cleanup is preview by default, preserves baseline keys and requires matching bucket identity',async()=>{
 const {recordStorage,cleanupRehearsal}=await import('../../deploy/rehearsal-storage.mjs');const {CosR2}=await import('../../platform/r2-cos.mjs');const sdk=new MemoryCos(),config={cos:{media:'media-123',backups:'backups-123'}},buckets={media:new CosR2(sdk,{bucket:'media-123',region:'ap-shanghai'}),backups:new CosR2(sdk,{bucket:'backups-123',region:'ap-shanghai'})};
 await buckets.media.put('original','keep');const before=await recordStorage(config,buckets);await buckets.media.put('rehearsal','remove');let plan=await cleanupRehearsal(before,config,buckets);assert.deepEqual(plan.media.added,['rehearsal']);assert.ok(await buckets.media.head('rehearsal'));await cleanupRehearsal(before,config,buckets,{apply:true});assert.equal(await buckets.media.head('rehearsal'),null);assert.ok(await buckets.media.head('original'));await assert.rejects(cleanupRehearsal({...before,mediaBucket:'wrong'},config,buckets),/different/);
});
