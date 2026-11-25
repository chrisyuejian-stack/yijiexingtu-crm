import test from 'node:test';
import assert from 'node:assert/strict';
import {CosR2,createBuckets} from '../../platform/r2-cos.mjs';
import {RoleCredentials} from '../../platform/cos-auth.mjs';
import {MemoryCos} from './helpers.mjs';
const make=()=>{const sdk=new MemoryCos(),delays=[],r2=new CosR2(sdk,{bucket:'test-123',region:'ap-shanghai',sleepImpl:async x=>delays.push(x)});return {sdk,delays,r2};};
test('PLAT COS byte/string put/get/head round trip and missing keys',async()=>{
 const {r2,sdk}=make();await r2.put('x','你好');assert.equal((await r2.head('x')).size,6);const obj=await r2.get('x');assert.equal(await obj.text(),'你好');assert.equal(await new Response(obj.body).text(),'你好');assert.deepEqual([...new Uint8Array(await obj.arrayBuffer())],[...Buffer.from('你好')]);assert.equal(obj.etag,'test-etag');assert.ok(obj.uploaded instanceof Date);
 await r2.put('json','{"x":1}');assert.deepEqual(await (await r2.get('json')).json(),{x:1});await r2.put('bytes',new Uint8Array([0,255]).buffer);assert.equal((await r2.get('bytes')).size,2);assert.equal(await r2.get('none'),null);assert.equal(await r2.head('none'),null);assert.equal(sdk.calls[0].ContentType,'text/plain; charset=utf-8');
});
test('PLAT COS marker pagination, list metadata, delete array chunks and idempotence',async()=>{
 const {r2,sdk}=make();for(const key of ['p/a','p/b','p/c','other'])await r2.put(key,key);const first=await r2.list({prefix:'p/',limit:2});assert.deepEqual(first.objects.map(x=>x.key),['p/a','p/b']);assert.equal(first.truncated,true);assert.equal(first.cursor,'p/b');assert.equal((await r2.list({prefix:'p/',cursor:first.cursor,limit:2})).objects[0].key,'p/c');
 await r2.delete(Array.from({length:1001},(_,i)=>i===0?'p/a':'none'+i));assert.deepEqual(sdk.calls.filter(x=>x.method==='deleteMultipleObject').map(x=>x.Objects.length),[1000,1]);assert.equal(await r2.get('p/a'),null);await r2.delete('none');assert.equal((await r2.list({limit:9999})).truncated,false);assert.equal(sdk.calls.at(-1).MaxKeys,1000);
});
test('PLAT COS only network/5xx retry twice; 403 is not missing and not retried',async()=>{
 const {r2,sdk,delays}=make();sdk.faults.push({method:'putObject',error:Object.assign(Error('network'),{code:'ECONNRESET'})},{method:'putObject',error:Object.assign(Error('server'),{statusCode:503})});await r2.put('x','ok');assert.deepEqual(delays,[100,200]);const before=sdk.calls.length;sdk.faults.push({method:'getObject',error:Object.assign(Error('denied'),{statusCode:403})});await assert.rejects(r2.get('x'),e=>e.statusCode===403);assert.equal(sdk.calls.length,before+1);
 sdk.faults.push(...Array.from({length:3},()=>({method:'headObject',error:Object.assign(Error('server'),{statusCode:500})})));await assert.rejects(r2.head('x'),e=>e.statusCode===500);
});
test('PLAT CVM role expiry refresh at five minutes, coalesced metadata calls and SDK auth',async()=>{
 let clock=Date.now(),calls=0;const fetchImpl=async url=>{assert.equal(url,'http://metadata.tencentyun.com/latest/meta-data/cam/security-credentials/yxt-cos-role');calls++;return Response.json({Code:'Success',TmpSecretId:'id'+calls,TmpSecretKey:'key',Token:'token',ExpiredTime:Math.floor(clock/1000)+3600});};const role=new RoleCredentials('yxt-cos-role',{now:()=>clock,fetchImpl});
 await Promise.all([role.get(),role.get()]);assert.equal(calls,1);clock+=55*60000;assert.equal((await role.get()).TmpSecretId,'id2');assert.equal(calls,2);
 let options;await createBuckets({cos:{auth:'role',role:'yxt-cos-role',region:'ap-shanghai',media:'media-123',backups:'backups-123'}},{fetchImpl,sdkFactory:o=>{options=o;return new MemoryCos();}});assert.equal(options.SecretKey,undefined);let auth;options.getAuthorization({},x=>auth=x);assert.equal(auth.SecurityToken,'token');assert.equal(options.RetryTimes,0);
});
test('PLAT CVM bad role/expired or failed metadata rejects without credential fallback',async()=>{
 assert.throws(()=>new RoleCredentials('../other'),/Invalid/);await assert.rejects(new RoleCredentials('x',{fetchImpl:async()=>new Response('',{status:403})}).get(),/unavailable/);await assert.rejects(new RoleCredentials('x',{fetchImpl:async()=>Response.json({Code:'Success',TmpSecretId:'x',TmpSecretKey:'y',Token:'t',ExpiredTime:0})}).get(),/Invalid/);
});
