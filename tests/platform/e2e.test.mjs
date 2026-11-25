import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {startServer} from '../../server.mjs';
import {fileFixture,MemoryCos,http} from './helpers.mjs';
import {manualDoc} from '../fixtures-v2.mjs';
import {totp,decrypt} from '../../src/server/crypto.js';

test('PLAT E2E built Workers via server.mjs: real HTTP logins/student/plan/COS gallery/full encrypted backup',async()=>{
 const f=await fileFixture(),sdk=new MemoryCos(),logs=[];let app;
 try{
  app=await startServer({config:f.config,port:0,sdkFactory:()=>sdk,log:x=>logs.push(x),startScheduler:false});const port=app.server.address().port,base='/'+f.school.t.slug+'/api',exchanges=[];
  const call=async(path,method='GET',body,extra={})=>{const data=Buffer.isBuffer(body)||typeof body==='string'?body:body===undefined?undefined:JSON.stringify(body);const response=await http(port,path,{method,headers:{Origin:'https://school.test',...body!==undefined?{'Content-Type':'application/json'}:{},...extra},body:data});exchanges.push({method,path,status:response.status});return response;};
  const rootLogin=await call('/api/auth/login','POST',{phone:'13911112222',password:'PhaseTwoSecure9'});assert.equal(rootLogin.status,200,rootLogin.text);assert.equal(rootLogin.json.api_base,'/api');const rootCookie=rootLogin.headers['set-cookie'].map(x=>x.split(';')[0]).join('; ');assert.equal((await call('/api/me','GET',undefined,{Cookie:rootCookie})).status,200);
  let response=await call(base+'/auth/login','POST',{phone:'13911112222',password:'PhaseTwoSecure9'});assert.equal(response.status,200,response.text);assert.equal(response.json.api_base,base);assert.ok(response.headers['set-cookie']);const cookie=response.headers['set-cookie'].map(x=>x.split(';')[0]).join('; ');
  const headers={Cookie:cookie};response=await call(base+'/data/students','POST',{name:'本地适配学员'},headers);assert.equal(response.status,200,response.text);const student=response.json.id;
  const doc=manualDoc({...f.school,students:[student]},200);response=await call(base+'/plans','POST',{doc},headers);assert.equal(response.status,201,response.text);assert.equal(response.json.computed.total.amount,400);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw1kAAAAASUVORK5CYII=','base64'),form=new FormData();form.set('file',new Blob([png],{type:'image/png'}),'test.png');form.set('tags','[]');const encoded=new Request('https://school.test/upload',{method:'POST',body:form});response=await call(base+'/gallery','POST',Buffer.from(await encoded.arrayBuffer()),{...headers,'Content-Type':encoded.headers.get('Content-Type')});
  assert.equal(response.status,201,response.text);const image=response.json;
  response=await call(base+'/gallery/'+image.id+'/file','GET',undefined,headers);assert.equal(response.status,200);
  const secret=await decrypt(f.f.env,f.f.db.raw.prepare("SELECT totp_enc FROM platform_admins WHERE username='fixture'").get().totp_enc,'platform:totp');
  response=await http(port,'/api/login',{method:'POST',host:'console.school.test',headers:{Origin:'https://console.school.test','Content-Type':'application/json'},body:JSON.stringify({username:'fixture',password:'FixtureSecure8Z',totp:await totp(secret,Math.floor(Date.now()/30000))})});assert.equal(response.status,200,response.text);assert.ok(response.headers['set-cookie']);
  let at=new Date();at.setUTCHours(19,0,0,0);if(at.getTime()<=Date.now())at=new Date(at.getTime()+86400000);await app.scheduler.tick(at.getTime());
  for(let i=1;i<=80;i++){const run=app.db.database.prepare("SELECT status FROM backup_runs ORDER BY at DESC LIMIT 1").get();if(run?.status==='completed')break;await app.scheduler.tick(at.getTime()+i*300000);}
  assert.equal(app.db.database.prepare("SELECT status FROM backup_runs ORDER BY at DESC LIMIT 1").get().status,'completed');const manifests=[...sdk.objects.keys()].filter(x=>x.startsWith('test-backup-123/daily/')&&x.endsWith('/manifest.enc'));assert.equal(manifests.length,1);assert.ok([...sdk.objects.keys()].some(x=>x.startsWith('test-media-123/')));
  const workerSha256=createHash('sha256').update(await readFile('dist/_worker.js')).digest('hex');assert.equal(workerSha256,(await readFile('SHA256SUMS.txt','utf8')).match(/^([a-f0-9]{64})  dist\/_worker\.js$/m)?.[1]);assert.equal(logs.find(x=>x.event==='started').workerSha256,workerSha256);
  await assert.rejects(startServer({config:f.config,port:0,sdkFactory:()=>sdk,log:()=>{},startScheduler:false}),/Another process/);
  await mkdir('work/platform/verification',{recursive:true});await writeFile('work/platform/verification/platform-e2e.json',JSON.stringify({environment:'local file SQLite + memory COS SDK + real loopback HTTP + current built Workers',workerSha256,exchanges,platformLogin:200,backupCompleted:true,mediaObjects:[...sdk.objects.keys()].filter(x=>x.startsWith('test-media-123/')).length,noExternalServices:true},null,2)+'\n');
 }finally{await app?.close();await f.close();}
});
test('PLAT server startup failure releases file lock and does not bind public interfaces',async()=>{
 const f=await fileFixture();try{
  const sdk=new MemoryCos();sdk.faults.push({method:'getBucket',error:Object.assign(Error('permission denied'),{statusCode:403})});await assert.rejects(startServer({config:f.config,port:0,sdkFactory:()=>sdk,log:()=>{},startScheduler:false}),/COS self-check failed: 403/);
  const app=await startServer({config:f.config,port:0,sdkFactory:()=>sdk,log:()=>{},startScheduler:false});assert.equal(app.server.address().address,'127.0.0.1');await app.close();
 }finally{await f.close();}
});
