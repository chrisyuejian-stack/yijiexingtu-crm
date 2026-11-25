import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {school,call,ok,filled} from './fixtures-plans.mjs';

test('YX5S 无会话可读取独立静态外壳，响应头和CSP与机构端一致',()=>school(async s=>{
 const shell=await call(s,'/s/not-a-valid-token','GET',undefined,null);ok(shell);assert.match(shell.headers.get('content-type'),/text\/html/);assert.equal(shell.headers.get('x-robots-tag'),'noindex');assert.equal(shell.headers.get('referrer-policy'),'no-referrer');assert.equal(shell.headers.get('cache-control'),'no-store');assert.equal(shell.headers.get('set-cookie'),null);assert.equal(shell.queries,0);
 const app=await call(s,'/app','GET',undefined,null);assert.equal(shell.headers.get('content-security-policy'),app.headers.get('content-security-policy'));assert.ok(!shell.text.includes('艺界星途'));assert.ok(shell.text.includes('/assets/tenant.js')&&!shell.text.includes('turnstile-key'));assert.ok(!shell.text.includes('__BASE__'));
}));
test('YX5S 有效、错误、过期、作废和机构到期的令牌均返回相同外壳，不计访问',()=>school(async s=>{
 const p=await filled(s);ok(await call(s,'plans/'+p.id+'/send','POST',{}));const link=ok(await call(s,'plans/'+p.id+'/share-links','POST',{}),201),token=link.url.split('/').at(-1),path='/s/'+token,db=s.f.db.raw;
 const original=await call(s,path,'GET',undefined,null);ok(original);assert.ok(!original.text.includes(token));assert.equal(original.queries,0);assert.equal(original.text,(await call(s,'/s/wrong','GET',undefined,null)).text);
 for(const change of ['expires_at=1','expires_at='+String(Date.now()+86400000)+',revoked_at=1']){db.prepare('UPDATE share_links SET '+change+' WHERE tenant_id=? AND id=?').run(s.t.id,link.id);const r=await call(s,path,'GET',undefined,null);ok(r);assert.equal(r.text,original.text);assert.equal(r.queries,0);}
 db.prepare("UPDATE tenants SET expires_at='2000-01-01' WHERE id=?").run(s.t.id);const expired=await call(s,path,'GET',undefined,null);ok(expired);assert.equal(expired.text,original.text);assert.equal(db.prepare('SELECT visits FROM share_links WHERE tenant_id=? AND id=?').get(s.t.id,link.id).visits,0);ok(await call(s,'/api/share/'+token,'GET',undefined,null),404);
}));
test('YX5S 数据API仍返回固定版本JSON并独立鉴权、计数与作废，外壳不影响它',()=>school(async s=>{
 let p=await filled(s);await s.r.settingsGalleryCreate({id:'img_alias',r2_key:'alias-local',mime:'image/png',width:1,height:1,tags:[],consent:false},s.user);await s.f.env.CHANNEL_MEDIA.put('alias-local','iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw1kAAAAASUVORK5CYII=');p=ok(await call(s,'plans/'+p.id,'PUT',{...p,style:{...p.style,cover_image_id:'img_alias'}}));ok(await call(s,'plans/'+p.id+'/send','POST',{}));const link=ok(await call(s,'plans/'+p.id+'/share-links','POST',{}),201),token=link.url.split('/').at(-1);
 const currentMedia=await call(s,'/api/share/'+token+'/media/img_alias','GET',undefined,null),legacyMedia=await call(s,'/s/'+token+'/media/img_alias','GET',undefined,null);assert.equal(currentMedia.status,200);assert.equal(legacyMedia.status,200);assert.equal(currentMedia.headers.get('content-type'),legacyMedia.headers.get('content-type'));assert.equal(currentMedia.text,legacyMedia.text);
 ok(await call(s,'/s/'+token,'GET',undefined,null));assert.equal(ok(await call(s,'plans/'+p.id+'/share-links')).items[0].visits,0);assert.equal(ok(await call(s,'/api/share/'+token,'GET',undefined,null)).render_data.id,p.id);assert.equal(ok(await call(s,'plans/'+p.id+'/share-links')).items[0].visits,1);
 ok(await call(s,'plans/'+p.id+'/share-links/'+link.id,'DELETE',{}));ok(await call(s,'/api/share/'+token,'GET',undefined,null),404);ok(await call(s,'/s/'+token,'GET',undefined,null));ok(await call(s,'/s/'+token+'/media/img_alias','GET',undefined,null),404);
}));
test('YX5S 外壳不受会话错误或分享IP限流影响，API继续限流',()=>school(async s=>{
 const {repo}=await import('../src/server/repo.js'),{sha}=await import('../src/server/core.js'),r=repo(s.f.env,null),ip='198.51.100.55';for(let i=0;i<60;i++)await r.limit('plan-share:'+await sha(ip),60000,60,60000);const res=await call(s,'/s/invalid','GET',undefined,null,{'Cookie':'__Host-yx_session=invalid','CF-Connecting-IP':ip});ok(res);assert.equal(res.queries,0);ok(await call(s,'/api/share/invalid','GET',undefined,null,{'CF-Connecting-IP':ip}),429);
}));
test('YX5S 外壳不进入控制台或机构路由，非GET受限、媒体仍按原令牌权限校验',()=>school(async s=>{
 ok(await call(s,'/s/token','POST',{},null),404);ok(await call(s,'/s/token/media/img_x','GET',undefined,null),404);const ops=await s.f.request('https://console.school.test/s/token');assert.notEqual(ops.status,200);
}));
test('YX5S 外壳打包为一个独立HTML，无内联脚本或事件，不改变前端页面内容',async()=>{
 const html=await readFile('src/share/index.html','utf8');assert.equal(await readFile('dist/share/index.html','utf8'),html);assert.ok(!/<script(?![^>]*\bsrc=)|\son\w+\s*=|style\s*=/i.test(html));assert.ok(!/艺界星途/.test(html));
});
