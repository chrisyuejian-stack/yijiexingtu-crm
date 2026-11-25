// Produce local HTTP examples from real handlers. Model and storage are local test doubles.
import {writeFile,mkdir} from 'node:fs/promises';
import {growthSchool,call,ok,batch,readyDoc,parent,submitFeedback,confirmFeedback} from '../../../tests/fixtures-growth.mjs';
import {examples} from '../../../tests/fixtures-plans.mjs';
import {ai,model,aiExamples} from '../../../tests/fixtures-ai.mjs';
await growthSchool(async s=>{
 const pa=await parent(s);
 ok(await call(s,'settings'));ok(await call(s,'styles?doc_type=report','GET',undefined,s.teacherAccount.token));ok(await call(s,'styles?doc_type=feedback_card','GET',undefined,s.teacherAccount.token));ok(await call(s,'styles/stp_growth_folio/versions/1.0.0','GET',undefined,s.teacherAccount.token));
 ok(await call(s,'feedback/today','GET',undefined,s.teacherAccount.token));
 let rep=ok(await call(s,'students/'+s.students[0]+'/repertoire','POST',{name:'小步舞曲',status:'learning',start_date:'2026-11-01'},s.teacherAccount.token),201);
 rep=ok(await call(s,'students/'+s.students[0]+'/repertoire','PUT',{id:rep.id,version:rep.version,status:'done',completed_date:'2026-11-09'},s.teacherAccount.token));ok(await call(s,'students/'+s.students[0]+'/repertoire','GET',undefined,s.teacherAccount.token));
 model(s,{suggestions:[{payload:{message:{learned:'节奏练习',good:'节奏稳定',attention:'句尾注意',homework:'练习两遍'}}}]});
 ok(await ai(s,'feedback/compose',{lesson_id:s.lid,student_id:s.students[0],tags:['节奏稳定'],repertoire_ids:[rep.id],note:'节奏练习，句尾注意，练习两遍'},crypto.randomUUID(),s.teacherAccount.token));
 const pending=ok(await submitFeedback(s));ok(await call(s,'submissions?status=pending&from=2026-11-01&to=2026-11-30'));ok(await confirmFeedback(s,pending.id));
 ok(await call(s,'feedback/'+pending.id+'/'+s.students[0]+'/copied','POST',{},s.teacherAccount.token));
 const update=ok(await submitFeedback(s,{kind:'comments'}));ok(await confirmFeedback(s,update.id,'return'));
 const v=ok(await call(s,'lessons/'+s.lid+'/review','GET',undefined,s.teacherAccount.token));
 ok(await call(s,'lessons/'+s.lid+'/comments','PUT',{operation_id:'op_'+crypto.randomUUID(),comment_fingerprint:v.comment_fingerprint,public_text:'全班节奏练习',homework:'练习两遍',people:v.participants.map(p=>({participant_id:p.id,student_id:p.student_id,comment:'节奏稳定'}))}));
 const b=await batch(s);ok(await call(s,'report-batches?teacher_id='+s.teacher+'&term=秋季'));let doc=ok(await call(s,'reports/'+b.reports[0].id));
 model(s,{suggestions:[{payload:{texts:{progress:'节奏稳定',focus:'句尾注意',home_practice:['练习两遍'],teacher_note:'节奏稳定'}}}]});
 ok(await ai(s,'report/draft',{report_id:doc.id,fields:['progress','focus','home_practice','teacher_note'],tier:'fast'},crypto.randomUUID(),s.teacherAccount.token));
 ok(await ai(s,'report/batch-draft',{batch_id:b.batch.id,student_ids:s.students,tier:'fast'},crypto.randomUUID(),s.teacherAccount.token));
 doc=await readyDoc(s,doc);doc=ok(await call(s,'reports/'+doc.id+'/refresh-crm','POST',{},s.teacherAccount.token));doc=ok(await call(s,'reports/'+doc.id+'/ready','POST',{},s.teacherAccount.token));doc=ok(await call(s,'reports/'+doc.id+'/return','POST',{reason:'请补充目标'}));doc=ok(await call(s,'reports/'+doc.id+'/ready','POST',{},s.teacherAccount.token));doc=ok(await call(s,'reports/'+doc.id+'/publish','POST',{}));
 ok(await call(s,'parent/reports/'+doc.id,'GET',undefined,pa.token));ok(await call(s,'parent/children/'+s.students[0]+'/feed','GET',undefined,pa.token));doc=ok(await call(s,'reports/'+doc.id+'/unpublish','POST',{reason:'补充信息后重发'}));ok(await call(s,'report-batches/'+b.batch.id+'/publish','POST',{report_ids:b.reports.map(r=>r.id)}));
 ok(await call(s,'settings','PUT',{key:'feedback_auto_confirm',value:true}));ok(await call(s,'settings','PUT',{key:'teacher_can_publish_reports',value:true}));ok(await call(s,'ai/usage?date=2026-11-10'));
});
await mkdir('work/stage6',{recursive:true});const file='work/stage6/extra-http-'+(process.env.TEST_BUNDLE==='1'?'bundle':'source')+'.json';await writeFile(file,JSON.stringify({local_only:true,examples,ai_examples:aiExamples},null,2));console.log(JSON.stringify({result:'pass',file,business_http:examples.length,ai_http:aiExamples.length,remote_calls:0}));
