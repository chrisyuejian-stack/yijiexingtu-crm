import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createScenario,SCENARIO_NOW } from '../../scripts/e2e/scenario.mjs';
const RealDate=Date,at=Date.parse(SCENARIO_NOW);globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[at]))}static now(){return at}};
const samples=[];
try{
 for(const kind of ['payments','attendance'])for(let repeat=0;repeat<7;repeat++){
  const s=await createScenario(kind),m=s.manifest;
  async function call(path,role,method='GET',data){const start=performance.now();const res=await s.f.request(`http://localhost/${m.slug}/api/${path}`,{method,headers:{Origin:'http://localhost',Cookie:'channel_session='+s.tokens[role],'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify({operation_id:crypto.randomUUID(),...data})})});const body=await res.json();assert.equal(res.status,200,JSON.stringify(body));return {body,d1:Number(res.headers.get('x-test-d1-queries')),statements:Number(res.headers.get('x-test-d1-statements')),elapsed_ms:Number((performance.now()-start).toFixed(2)),timing:res.headers.get('server-timing')}}
  try{
   let result;
   if(kind==='payments') result=await call('credits/payments','finance','POST',{kind:'tuition',student_id:m.studentIds[0],amount:1600.50,paid_at:'2026-11-12',allocations:[{package_id:m.packageIds[0],amount:1200},{package_id:m.extraPackage,amount:300.25}]});
   else {const review=(await call('lessons/'+m.lesson+'/review','teacher')).body;await call('lessons/'+m.lesson+'/review','teacher','POST',{kind:'attendance',previous_id:null,comment_fingerprint:review.comment_fingerprint,public_text:'本地计时',homework:'',people:review.participants.map(p=>({participant_id:p.id,student_id:p.student_id,attendance:'attended',comment:''}))});const latest=(await call('lessons/'+m.lesson+'/review','teacher')).body.submission;result=await call('submissions/'+latest.id+'/confirm','academic','POST',{version:latest.version})}
   assert.equal(result.body.committed,true);const {body,...metrics}=result;samples.push({kind,repeat,...metrics});
  }finally{s.f.restore()}
 }
 await writeFile('docs/p4/缴费与销课确认计时.json',JSON.stringify({runs:7,scope:'每次全新虚构场景；只计成功首次提交API，不含准备、填表和后续刷新',samples},null,2));console.log(JSON.stringify(samples,null,2));
}finally{globalThis.Date=RealDate}
