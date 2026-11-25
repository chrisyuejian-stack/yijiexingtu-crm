import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createScenario } from '../../scripts/e2e/scenario.mjs';
import candidate from '../../src/server/worker.js';
const baseline=(await import(pathToFileURL(process.env.P4_BASELINE+'/src/server/worker.js'))).default;
const RealDate=Date,at=Date.parse('2026-11-12T20:00:00+08:00');
globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[at]))}static now(){return at}};
const s=await createScenario(),slug=s.manifest.slug,id=s.manifest.studentIds[0],samples=[];
async function call(worker,path,data){const start=performance.now();const res=await s.f.db.measure(()=>worker.fetch(new Request(`http://localhost/${slug}/api/${path}`,{method:data===undefined?'GET':'POST',headers:{Origin:'http://localhost',Cookie:'channel_session='+s.tokens.supervisor,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}),s.f.env));const body=await res.json();assert.equal(res.status,200,JSON.stringify(body));return {path,status:res.status,body,d1:Number(res.headers.get('x-test-d1-queries')),statements:Number(res.headers.get('x-test-d1-statements')),ms:Number((performance.now()-start).toFixed(2))}}
try{
const home=['promo/recommend','c2/followups?group=overdue&owner=&offset=0','submissions?status=pending&from=2026-09-13&to=2026-11-13&offset=0','c2/followups?group=today&owner=&offset=0','c2/makeups?offset=0','c2/home','finance/receivable-summary','schedule?from=2026-11-12&to=2026-11-13','c2/renewals?group=debt&offset=0','system-messages?offset=0','c2/unchecked?offset=0','todo/summary'];
const detail=['credits/packages?student_id='+id,'data/students/'+id,'c2/students/'+id,'c2/students/'+id+'/history'];
const fiveCounts=['status=active','status=paused','status=archived','status=active&balance=zero','status=active&balance=low'].map(q=>'c2/students?'+q);
const list='c2/students?q=&status=active&balance=&offset=0',followup='tools/followup_tasks?offset=0&student_id='+id;
const fixed=['data/schedule_templates?offset=0&q=','data/schedule_enrollments?offset=0&q=','data/teachers?offset=0&q=','data/locations?offset=0&q=','data/course_types?offset=0&q=','data/course_categories?offset=0&q='];
for(const [page,before,after] of [['首页业务',home,[['read-batch',{paths:home}]]],['首页含启动',['me','public/brand',...home],[['me'],['public/brand?lite=1'],['read-batch',{paths:home}]]],['学员含默认详情',[list,...fiveCounts,...detail,followup],[['read-batch',{paths:[list,'c2/students/counts']}],['read-batch',{paths:detail}], [followup]]],['固定排课首次',fixed,[['read-batch',{paths:fixed}]]],['固定排课返回',fixed.slice(0,2),[['read-batch',{paths:fixed.slice(0,2)}]]]]){
 s.f.db.raw.exec('DELETE FROM security_limits');const old=[];for(const path of before)old.push(await call(baseline,path));
 s.f.db.raw.exec('DELETE FROM security_limits');const next=[];for(const [path,data]of after)next.push(await call(candidate,path,data));
 const oldByPath=new Map(old.map(r=>[r.path,r.body]));for(const r of next)if(r.path==='read-batch')for(const child of r.body.results){assert.equal(child.status,200);if(oldByPath.has(child.path))assert.deepEqual(child.body,oldByPath.get(child.path),child.path)}
 const brief=rows=>({api:rows.length,d1:rows.reduce((n,r)=>n+r.d1,0),statements:rows.reduce((n,r)=>n+r.statements,0),requests:rows.map(({body,...r})=>r)});
 samples.push({page,before:brief(old),after:brief(next)});
}
await writeFile('docs/p4/页面组合对照.json',JSON.stringify({scope:'本地两名虚构学员；直接调用真实新旧Worker，模拟Claude接入批量接口后的路径组合；不是已改前端的浏览器实测',samples},null,2));console.log(JSON.stringify(samples.map(({page,before,after})=>({page,before_api:before.api,before_d1:before.d1,after_api:after.api,after_d1:after.d1})),null,2));
}finally{s.f.restore();globalThis.Date=RealDate}
