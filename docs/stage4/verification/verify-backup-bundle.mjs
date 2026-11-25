// Local-only developer verification of the actual compressed production backup Worker.
import assert from 'node:assert/strict';
import backupWorker from '../../../backup-dist/backup-worker.js';
import {school,filled,call,ok} from '../../../tests/fixtures-plans.mjs';
import {open} from '../../../src/server/backup.js';
await school(async s=>{
 const plan=await filled(s);const sent=ok(await call(s,'plans/'+plan.id+'/send','POST',{}));const link=ok(await call(s,'plans/'+plan.id+'/share-links','POST',{}),201),token=link.url.split('/').at(-1),at=Date.now();
 await backupWorker.scheduled({cron:'0 19 * * *',scheduledTime:at},s.f.env,{});
 let manifests=[];for(let i=0;i<40;i++){manifests=[...s.f.env.CHANNEL_BACKUPS.objects.keys()].filter(k=>k.endsWith('/manifest.enc'));if(manifests.length)break;await backupWorker.scheduled({cron:'*/5 * * * *',scheduledTime:at},s.f.env,{})}assert.equal(manifests.length,1);
 const key=manifests[0],manifest=await open(s.f.env,JSON.parse(s.f.env.CHANNEL_BACKUPS.objects.get(key)),key);
 const rows=async table=>{const files=manifest.files.filter(x=>x.table===table);assert.ok(files.length,table);let result=[];for(const file of files)result.push(...(await open(s.f.env,JSON.parse(s.f.env.CHANNEL_BACKUPS.objects.get(file.key)),file.key)).rows);return result};
 const plans=await rows('plans'),revisions=await rows('plan_revisions'),links=await rows('share_links');assert.equal(plans.find(x=>x.id===plan.id).sent_revision_id,sent.sent_revision_id);assert.ok(revisions.find(x=>x.id===sent.sent_revision_id));assert.ok(!JSON.stringify(links).includes(token));assert.equal(links[0].id,link.id);
 for(const table of ['plan_contexts','plan_elements','style_packs','style_pack_versions','compliance_terms'])assert.ok((await rows(table)).length,table);
 assert.equal((await backupWorker.fetch(new Request('https://local.test/'))).status,404);console.log(JSON.stringify({result:'pass',worker:'backup-dist/backup-worker.js',manifest_published:true,plans:plans.length,revisions:revisions.length,links:links.length,token_plaintext:false,style_versions_retained:true,fetch_status:404,remote_calls:0}));
});
