import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBridge} from '../../platform/bridge.mjs';
import {loadAssets} from '../../platform/assets.mjs';
import {http} from './helpers.mjs';
const withServer=async(worker,fn,opts={})=>{const server=createBridge(worker,{shared:{}},{TENANT_HOST:'school.test',CONSOLE_HOST:'console.school.test'},{log:()=>{},...opts});await new Promise(r=>server.listen(0,'127.0.0.1',r));try{await fn(server.address().port);}finally{await new Promise(r=>server.close(r));}};
test('PLAT bridge overwrites forged cf headers, host allowlist, fresh env, streaming and cookies',()=>{
 let prior;
 return withServer({async fetch(req,env){assert.equal(req.headers.get('cf-connecting-ip'),'198.51.100.17');assert.equal(req.headers.get('cf-access-jwt-assertion'),null);assert.equal(req.headers.get('cf-ray'),null);assert.equal(new URL(req.url).protocol,'https:');assert.notEqual(env,prior);assert.equal(env.mark,undefined);env.mark='request';prior=env;const h=new Headers();h.append('Set-Cookie','a=1; Secure; Path=/');h.append('Set-Cookie','b=2; Secure; Path=/');return new Response('stream',{headers:h});}},async port=>{
  const headers={'cf-connecting-ip':'1.1.1.1','cf-access-jwt-assertion':'forged','cf-ray':'forged'};let r=await http(port,'/api/test',{headers});assert.equal(r.status,200);assert.equal(r.text,'stream');assert.equal(r.headers['set-cookie'].length,2);assert.equal((await http(port,'/',{headers})).status,200);assert.equal((await http(port,'/',{host:'evil.test'})).status,404);assert.equal((await http(port,'/',{headers:{'X-Real-IP':'bad'}})).status,400);
 });
});
test('PLAT bridge rejects advertised and streaming request bodies over limit with 413',()=>withServer({async fetch(){return new Response('ok');}},async port=>{
 assert.equal((await http(port,'/',{method:'POST',headers:{'Content-Length':'33'},body:'x'.repeat(33)})).status,413);assert.equal((await http(port,'/',{method:'POST',chunks:['x'.repeat(20),'y'.repeat(20)]})).status,413);assert.equal((await http(port,'/',{method:'POST',body:'short'})).status,200);
},{maxBodyBytes:32}));
test('PLAT bridge unhandled exceptions log id/path/frames without body or Cookie',async()=>{
 const logs=[];await withServer({async fetch(){throw Error('sensitive-body cookie-secret');}},async port=>{const r=await http(port,'/boom',{headers:{Cookie:'cookie-secret'},method:'POST',body:'sensitive-body'});assert.equal(r.status,500);assert.equal(logs[0].path,'/boom');assert.ok(logs[0].requestId);assert.ok(!JSON.stringify(logs).includes('sensitive-body'));assert.ok(!JSON.stringify(logs).includes('cookie-secret'));},{log:r=>logs.push(r)});
});
test('PLAT assets in-memory MIME/HEAD, traversal rejection and no Worker source exposure',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yxt-assets-'));try{await writeFile(join(dir,'index.html'),'html');await writeFile(join(dir,'_worker.js'),'private');const assets=await loadAssets(dir);let r=await assets.fetch(new Request('https://x/index.html'));assert.equal(await r.text(),'html');assert.match(r.headers.get('Content-Type'),/text\/html/);assert.equal(await (await assets.fetch(new Request('https://x/index.html',{method:'HEAD'}))).text(),'');for(const path of ['/%2e%2e%2fsecret','/%5csecret','/_worker.js','/missing'])assert.equal((await assets.fetch(new Request('https://x'+path))).status,404);await symlink('/etc/passwd',join(dir,'link'));await assert.rejects(loadAssets(dir),/symlinks/);}finally{await rm(dir,{recursive:true,force:true});}
});
