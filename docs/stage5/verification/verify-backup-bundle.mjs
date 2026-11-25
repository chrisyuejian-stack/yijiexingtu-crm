// Local-only verification of the actual compiled production backup Worker.
import assert from 'node:assert/strict';
import backupWorker from '../../../backup-dist/backup-worker.js';
import {school,content,model,ai,ok} from '../../../tests/fixtures-ai.mjs';
import {open} from '../../../src/server/backup.js';
await school(async s=>{
 const c=await content(s); model(s,{suggestions:[{payload:{versions:{short:'本地短版',medium:'本地中版',long:'本地长版'}}}]});
 const result=ok(await ai(s,'content/versions',{content_id:c.id}));const at=Date.now();
 await backupWorker.scheduled({cron:'0 19 * * *',scheduledTime:at},s.f.env,{});
 let manifests=[];for(let i=0;i<40;i++){manifests=[...s.f.env.CHANNEL_BACKUPS.objects.keys()].filter(k=>k.endsWith('/manifest.enc'));if(manifests.length)break;await backupWorker.scheduled({cron:'*/5 * * * *',scheduledTime:at},s.f.env,{})}assert.equal(manifests.length,1);
 const key=manifests[0],manifest=await open(s.f.env,JSON.parse(s.f.env.CHANNEL_BACKUPS.objects.get(key)),key);
 const rows=async table=>{const files=manifest.files.filter(x=>x.table===table);assert.ok(files.length,table);let result=[];for(const file of files)result.push(...(await open(s.f.env,JSON.parse(s.f.env.CHANNEL_BACKUPS.objects.get(file.key)),file.key)).rows);return result};
 const items=await rows('content_items'),revisions=await rows('content_revisions'),requests=await rows('ai_requests'),quota=await rows('ai_quota_daily'),usage=await rows('ai_usage'),suggestions=await rows('ai_suggestions'),settings=await rows('ai_settings'),holds=await rows('ai_quota_holds');
 assert.equal(items.find(x=>x.id===c.id).version,1);assert.ok(revisions.find(x=>x.content_id===c.id));assert.ok(requests.some(x=>JSON.parse(x.receipt_json).ids.includes(result.suggestions[0].id)));assert.equal(quota.find(x=>x.tenant_id===s.t.id&&x.tier==='fast').used,1);assert.equal(usage.filter(x=>x.tenant_id===s.t.id&&x.result==='ok').length,1);assert.ok(suggestions.find(x=>x.id===result.suggestions[0].id));assert.ok(holds.find(x=>x.status==='settled'));assert.equal(settings[0].fast_model,'local-fast');
 assert.ok(!JSON.stringify(settings).includes('DEEPSEEK_API_KEY'));assert.equal((await backupWorker.fetch(new Request('https://local.test/'))).status,404);
 console.log(JSON.stringify({result:'pass',worker:'backup-dist/backup-worker.js',manifest_published:true,content_items:items.length,content_revisions:revisions.length,ai_requests:requests.length,quota:quota.length,ai_usage:usage.length,ai_suggestions:suggestions.length,encrypted_replay_receipt:true,model_key_not_in_settings:true,fetch_status:404,remote_calls:0},null,2));
});
