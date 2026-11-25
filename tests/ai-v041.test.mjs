import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {school,call,ok,content,model,ai,filled} from './fixtures-ai.mjs';
import {httpExamples,ops} from './fixtures-v041.mjs';
import {aiFailureReason} from '../src/server/ai-policy.js';
import {HttpError} from '../src/server/core.js';
const usage=s=>s.f.db.raw.prepare('SELECT * FROM ai_usage WHERE tenant_id=? ORDER BY created_at,id').all(s.t.id);
const lastFailure=s=>usage(s).at(-1).result;
const record=(route,data,r)=>httpExamples.push({request:{method:'POST',path:'/api/ai/'+route,body:data,headers:{'Idempotency-Key':'<fresh UUID>'}},response:{status:r.status,body:r.body}});

test('V041 G1 动作时限120/150和其他45/90，max_tokens按动作，额度预占覆盖长请求',()=>school(async s=>{
 const c=await content(s),p=await filled(s);
 const routes=[['content/section',{content_id:c.id,section_key:'intro',title:'介绍',points:['体验']}],['content/versions',{content_id:c.id}],['content/rewrite',{content_id:c.id,block_index:0,mode:'polish'}],['plan/fill-from-consult',{plan_id:p.id,consult:'本地咨询'}],['plan/adjust',{plan_id:p.id,page:'assessment',instruction:'调整文字'}],['content/outline',{content_id:c.id}],['plan/polish',{plan_id:p.id}]];
 for(const [route,data] of routes)for(const tier of ['fast','deep']){model(s,request=>{const isLong=!['content/outline','plan/polish'].includes(route),expected=isLong?(tier==='fast'?120000:150000):(tier==='fast'?45000:90000);assert.ok(Math.abs(request.deadline_at-Date.now()-expected)<1000);assert.equal(request.max_tokens,route==='content/section'?4096:route==='content/versions'?6144:tier==='fast'?4096:8192);return {suggestions:[]}});ok(await ai(s,route,{...data,tier}));const q=s.f.db.raw.prepare('SELECT deadline_at,hold_id FROM ai_requests WHERE tenant_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(s.t.id);const h=await s.r.aiHold(q.hold_id);assert.ok(h.expires_at>=q.deadline_at)}
}));

test('V041 G1 超时返回ai_timeout、记录timeout、不计次、不记录输入或模型内容',()=>school(async s=>{
 const c=await content(s),original=Date.now;let clock=original();Date.now=()=>clock;
 try{model(s,()=>{clock+=120001;return {content:JSON.stringify({suggestions:[],private_model:'不可记录的模型内容'})}});const data={content_id:c.id,instruction:'不可记录的用户输入'};const r=await ai(s,'content/versions',data);record('content/versions',data,r);assert.equal(ok(r,502).error,'ai_timeout');assert.equal(lastFailure(s),'timeout');assert.equal(ok(await call(s,'ai/usage')).fast.used,0);const log=JSON.stringify(usage(s));assert.ok(!log.includes('不可记录'));assert.ok(!JSON.stringify(s.f.db.raw.prepare('SELECT * FROM ai_requests WHERE tenant_id=?').all(s.t.id)).includes('不可记录'))}finally{Date.now=original}
}));

test('V041 G1 深度长请求149秒完成可结算，预占150秒内不被当过期',()=>school(async s=>{
 const c=await content(s),original=Date.now;let clock=original();Date.now=()=>clock;
 try{model(s,()=>{clock+=149000;return {suggestions:[]}});const r=ok(await ai(s,'content/versions',{content_id:c.id,tier:'deep'}));assert.equal(r.usage.used_today,1);assert.equal(usage(s)[0].result,'ok');assert.equal(usage(s)[0].duration_ms,149000)}finally{Date.now=original}
}));

test('V041 G1 剩余29999毫秒不重试，恰好30000毫秒可重试且不延长截止',()=>school(async s=>{
 const c=await content(s),original=Date.now;let clock=original();Date.now=()=>clock;
 try{model(s,()=>{clock+=90001;return {content:'invalid'}});ok(await ai(s,'content/versions',{content_id:c.id}),502);assert.equal(s.modelCalls.length,1);assert.equal(lastFailure(s),'protocol_invalid');assert.equal(ok(await call(s,'ai/usage')).fast.used,0);
 model(s,(_,n)=>{clock+=n===1?90000:1000;return n===1?{content:'invalid'}:{suggestions:[]}});ok(await ai(s,'content/versions',{content_id:c.id}));assert.equal(s.modelCalls.length,2);assert.equal(s.modelCalls[0].deadline_at,s.modelCalls[1].deadline_at);assert.equal(ok(await call(s,'ai/usage')).fast.used,1)}finally{Date.now=original}
}));

test('V041 G1 HTTP401/402/404/503原因保留，机构只返回ai_unavailable且不计次',()=>school(async s=>{
 const c=await content(s),originalFetch=globalThis.fetch;model(s);s.f.env.DEEPSEEK_API_KEY='local-test-key-not-live';delete s.f.env.AI_PROVIDER;
 try{for(const status of [401,402,404,503]){globalThis.fetch=async(url,init)=>{if(String(url).startsWith('https://api.deepseek.com/')){const b=JSON.parse(init.body);assert.equal(b.max_tokens,6144);return new Response('sensitive-provider-text',{status})}return originalFetch(url,init)};const r=await ai(s,'content/versions',{content_id:c.id});record('content/versions',{content_id:c.id},r);assert.equal(ok(r,502).error,'ai_unavailable');assert.equal(lastFailure(s),'provider_http_'+status)}assert.equal(ok(await call(s,'ai/usage')).fast.used,0);assert.ok(!JSON.stringify(usage(s)).includes('sensitive-provider-text'))}finally{globalThis.fetch=originalFetch}
}));

test('V041 G1 协议错误、响应超大、其他异常分类，不额外计次或保存原文',()=>school(async s=>{
 const c=await content(s);
 for(const [value,expected,calls] of [[{content:'invalid private text'},'protocol_invalid',2],[{content:'x'.repeat(500001)},'response_too_large',1],[()=>{throw Error('private failure')},'other',1]]){model(s,value);ok(await ai(s,'content/versions',{content_id:c.id}),502);assert.equal(lastFailure(s),expected);assert.equal(s.modelCalls.length,calls)}assert.equal(ok(await call(s,'ai/usage')).fast.used,0);assert.ok(!JSON.stringify(usage(s)).includes('private'));
 assert.equal(aiFailureReason(new HttpError(403,'private','forbidden')),'other');
}));

test('V041 G1 提供方JSON包装损坏或超过2MiB受限，无真实网络',()=>school(async s=>{
 const c=await content(s),old=globalThis.fetch;model(s);s.f.env.DEEPSEEK_API_KEY='local-test-key-not-live';delete s.f.env.AI_PROVIDER;
 try{for(const [body,reason] of [['not JSON','protocol_invalid'],['x'.repeat(2*1024*1024+1),'response_too_large']]){globalThis.fetch=async(url,init)=>String(url).startsWith('https://api.deepseek.com/')?new Response(body):old(url,init);ok(await ai(s,'content/versions',{content_id:c.id}),502);assert.equal(lastFailure(s),reason)}assert.equal(ok(await call(s,'ai/usage')).fast.used,0)}finally{globalThis.fetch=old}
}));

test('V041 G1 平台按day/tenant/tool附failure_reasons，旧失败归other',()=>school(async s=>{
 const c=await content(s);model(s,()=>{const e=Error('no body');e.ai_failure_reason='provider_http_402';throw e});ok(await ai(s,'content/versions',{content_id:c.id}),502);
 model(s,{content:'invalid'});ok(await ai(s,'content/versions',{content_id:c.id}),502);model(s);ok(await ai(s,'content/versions',{content_id:c.id}));
 const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});for(const group of ['day','tenant','tool']){const r=ok(await ops(s,'ai/usage?from='+day+'&to='+day+'&group='+group+'&tenant_id='+s.t.id));assert.equal(r.items.reduce((n,x)=>n+x.failed,0),2);const reasons=r.items[0].failure_reasons;assert.equal(reasons.provider_http_402,1);assert.equal(reasons.protocol_invalid,1);assert.equal(Object.values(reasons).reduce((n,x)=>n+x,0),r.items[0].failed)}
}));

test('V041 G2 省略modules前缀可采用，about静默丢弃，稳定路径及金额仍受保护',()=>school(async s=>{
 let p=await filled(s);const before=p.computed.total.amount,quote='需要提升节奏';model(s,{suggestions:[{payload:{fields:[{path:'assessment.text',value:'节奏需要加强',quote},{path:'assessment.goals',value:['保持练习'],quote},{path:'cover.subtitle',value:'成长方案',quote},{path:'fees.note',value:'按约定缴费',quote},{path:'about',value:'不能改',quote},{path:'modules.about.text',value:'不能改',quote}]}}]});
 const r=await ai(s,'plan/fill-from-consult',{plan_id:p.id,consult:quote});record('plan/fill-from-consult',{plan_id:p.id,consult:quote},r);const advice=ok(r);assert.ok(!advice.warnings.some(x=>x.includes('about')));const fields=advice.suggestions[0].payload.fields;assert.deepEqual(fields.map(x=>x.path),['modules.assessment.text','modules.assessment.goals','modules.cover.subtitle','modules.fees.note']);const doc=structuredClone(p);for(const f of fields){const a=f.path.split('.');let o=doc;for(const key of a.slice(0,-1))o=o[key];o[a.at(-1)]=f.value}p=ok(await call(s,'plans/'+p.id,'PUT',doc));assert.equal(p.modules.assessment.text,'节奏需要加强');assert.equal(p.computed.total.amount,before);
 assert.ok(s.modelCalls[0].messages[0].content.includes('"modules.assessment.text"'));assert.ok(s.modelCalls[0].messages[0].content.includes('完整格式示例'));
}));

test('V041 G2 仍拒绝数组下标/错误稳定ID/金额path，adjust只返回本页文字',()=>school(async s=>{
 const p=await filled(s);model(s,{suggestions:[{payload:{fields:[{path:'assessment.text',value:'应丢弃异页'},{path:'cover.subtitle',value:'可用副标题'},{path:'fees.total',value:'999'},{path:'path.stages[0].name',value:'不能按下标定位'}]}}]});const res=ok(await ai(s,'plan/adjust',{plan_id:p.id,page:'cover',instruction:'改副标题'}));assert.equal(res.suggestions[0].payload.fields.length,1);assert.equal(res.suggestions[0].payload.fields[0].path,'modules.cover.subtitle');assert.ok(res.warnings.length>=2);const prompt=s.modelCalls[0].messages[0].content;assert.ok(prompt.includes('"path":"title"'));
}));

test('V041 G3 custom改写只定位选中块，instruction传模型，正文和article不自动写入',()=>school(async s=>{
 const c=await content(s,{blocks:[{type:'paragraph',text:'第一张卡'},{type:'paragraph',text:'第二张卡'}],article:{author:'人工作者'}});const before=await s.r.contentGet(c.id);model(s,{suggestions:[{payload:{mode:'custom',blocks:[{type:'paragraph',text:'活泼的第二张卡'}]}}]});const input={content_id:c.id,block_index:1,mode:'custom',instruction:'只改成活泼语气'};const r=await ai(s,'content/rewrite',input);record('content/rewrite',input,r);const result=ok(r);assert.equal(result.suggestions[0].target.block_index,1);const ctx=JSON.parse(s.modelCalls[0].messages[1].content);assert.equal(ctx.instruction,input.instruction);assert.equal(ctx.selected_text,'第二张卡');assert.deepEqual(await s.r.contentGet(c.id),before);
}));

test('V041 G3 custom要求非空且≤500字，其他mode可加instruction',()=>school(async s=>{
 const c=await content(s);model(s);
 for(const extra of [{mode:'custom'},{mode:'custom',instruction:' '},{mode:'custom',instruction:'字'.repeat(501)},{mode:'polish',instruction:'字'.repeat(501)}])ok(await ai(s,'content/rewrite',{content_id:c.id,block_index:0,...extra}),422);
 ok(await ai(s,'content/rewrite',{content_id:c.id,block_index:0,mode:'custom',instruction:'字'.repeat(500)}));ok(await ai(s,'content/rewrite',{content_id:c.id,block_index:0,mode:'polish',instruction:'保持原意'}));assert.equal(JSON.parse(s.modelCalls.at(-1).messages[1].content).instruction,'保持原意');
}));

after(async()=>{await mkdir('work/v041',{recursive:true});await writeFile('work/v041/http-ai-'+(process.env.TEST_BUNDLE==='1'?'bundle':'source')+'.json',JSON.stringify({local_only:true,examples:httpExamples},null,2)+'\n')});
