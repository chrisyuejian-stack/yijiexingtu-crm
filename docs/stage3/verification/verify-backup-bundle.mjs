// Developer-only local check of the actual compressed backup Worker.
import assert from 'node:assert/strict';
import { fixture } from '../../../tests/support.mjs';
import { setup } from '../../../tests/fixtures-credit.mjs';
import backupWorker from '../../../backup-dist/backup-worker.js';
import { open } from '../../../src/server/backup.js';
const f=await fixture();
try {
 const s=await setup(f,1,'stage3-backup');
 assert.equal((await s.call('settings/subjects','POST',{key:'art_interest'})).status,200);
 const c=await s.call('settings/courses','POST',{subject:'music_interest',group:'主修',name:'备份报价',form:'one_to_one',minutes:45,pricing:{mode:'per_unit',amount:123.45}});assert.equal(c.status,201);
 const at=Date.now();await backupWorker.scheduled({cron:'0 19 * * *',scheduledTime:at},f.env,{});
 let manifests=[];
 for(let i=0;i<30;i++){manifests=[...f.env.CHANNEL_BACKUPS.objects.keys()].filter(k=>k.endsWith('/manifest.enc'));if(manifests.length)break;await backupWorker.scheduled({cron:'*/5 * * * *',scheduledTime:at},f.env,{});}
 assert.equal(manifests.length,1);const key=manifests[0],manifest=await open(f.env,JSON.parse(f.env.CHANNEL_BACKUPS.objects.get(key)),key);
 const rows=async table=>{const file=manifest.files.find(x=>x.table===table);assert.ok(file,table);return(await open(f.env,JSON.parse(f.env.CHANNEL_BACKUPS.objects.get(file.key)),file.key)).rows;};
 const courses=await rows('offer_courses');assert.equal(courses.find(x=>x.id===c.body.id).price_cents,12345);
 assert.ok((await rows('report_dimensions')).length>0);assert.ok((await rows('tenant_subjects'))[0].content_json);assert.equal((await rows('students'))[0].nickname,'学员0');
 assert.equal((await backupWorker.fetch(new Request('https://local.test/'))).status,404);
 console.log(JSON.stringify({result:'pass',worker:'backup-dist/backup-worker.js',manifest_published:true,offer_course_rows:courses.length,price_cents:12345,dimensions_preserved:true,subject_content_preserved:true,nickname_correct:true,fetch_status:404,remote_calls:0}));
}finally{f.restore();}
