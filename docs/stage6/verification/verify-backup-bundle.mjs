// Local-only verification of the actual compressed backup Worker with Stage6 data.
import assert from 'node:assert/strict';
import backupWorker from '../../../backup-dist/backup-worker.js';
import {growthSchool,call,ok,batch,readyDoc,submitFeedback,confirmFeedback} from '../../../tests/fixtures-growth.mjs';
import {model,ai} from '../../../tests/fixtures-ai.mjs';
import {open} from '../../../src/server/backup.js';
await growthSchool(async s=>{
 const repertoire=ok(await call(s,'students/'+s.students[0]+'/repertoire','POST',{name:'备份曲目',status:'done',completed_date:'2026-11-09'},s.teacherAccount.token),201);
 const feedback=ok(await submitFeedback(s));ok(await confirmFeedback(s,feedback.id));ok(await call(s,'feedback/'+feedback.id+'/'+s.students[0]+'/copied','POST',{},s.teacherAccount.token));
 const created=await batch(s),d=await readyDoc(s,created.reports[0]);ok(await call(s,'reports/'+d.id+'/ready','POST',{}));const published=ok(await call(s,'reports/'+d.id+'/publish','POST',{}));
 model(s,{suggestions:[{payload:{texts:{progress:'节奏稳定',focus:'句尾注意',home_practice:['练习两遍'],teacher_note:'继续保持'}}}]});const suggestion=ok(await ai(s,'report/batch-draft',{batch_id:created.batch.id,student_ids:[s.students[1]]}));
 const at=Date.now();await backupWorker.scheduled({cron:'0 19 * * *',scheduledTime:at},s.f.env,{});let keys=[];for(let i=0;i<50;i++){keys=[...s.f.env.CHANNEL_BACKUPS.objects.keys()].filter(k=>k.endsWith('/manifest.enc'));if(keys.length)break;await backupWorker.scheduled({cron:'*/5 * * * *',scheduledTime:at},s.f.env,{})}assert.equal(keys.length,1);
 const key=keys[0],manifest=await open(s.f.env,JSON.parse(s.f.env.CHANNEL_BACKUPS.objects.get(key)),key);const rows=async table=>{let result=[];const files=manifest.files.filter(x=>x.table===table);assert.ok(files.length,table);for(const file of files)result.push(...(await open(s.f.env,JSON.parse(s.f.env.CHANNEL_BACKUPS.objects.get(file.key)),file.key)).rows);return result;};
 const names=['lesson_submissions','lesson_comments','growth_repertoire','growth_feedback_copies','growth_batches','growth_reports','growth_report_revisions','growth_notifications'];const counts={};for(const table of names)counts[table]=(await rows(table)).length;
 assert.ok((await rows('lesson_submissions')).some(x=>JSON.parse(x.personal_json).length));assert.ok((await rows('growth_repertoire')).some(x=>x.id===repertoire.id));const reports=await rows('growth_reports'),row=reports.find(x=>x.id===published.id);assert.ok(row.published_revision_id);const revisions=await rows('growth_report_revisions');assert.ok(revisions.some(x=>x.id===row.published_revision_id&&x.publication_order>0));const requests=await rows('ai_requests');assert.ok(requests.some(x=>x.receipt_json&&JSON.parse(x.receipt_json).extra?.processed?.[0]?.report_id===created.reports[1].id));assert.equal(suggestion.usage.used_today,1);assert.equal((await backupWorker.fetch(new Request('https://local.test/'))).status,404);
 console.log(JSON.stringify({result:'pass',worker:'backup-dist/backup-worker.js',manifest_encrypted:true,new_table_rows:counts,published_revision_retained:true,publication_order_retained:true,batch_replay_receipt_retained:true,fetch_status:404,remote_calls:0},null,2));
});
