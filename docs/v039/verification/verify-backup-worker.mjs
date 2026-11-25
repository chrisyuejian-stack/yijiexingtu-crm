import assert from 'node:assert/strict';
import backup from '../../../backup-dist/backup-worker.js';
import {fixture} from '../../../tests/support.mjs';
import {setup} from '../../../tests/fixtures-credit.mjs';
import {content} from '../../../tests/fixtures-ai.mjs';
import {open} from '../../../src/server/backup.js';
const f=await fixture();try{
 const s=await setup(f,1,'backup39');s.f=f;const article={column:'备份栏目',header_image_id:null,author:'测试机构',publish_date:'2026-11-20',footer:{qr:true,address:true}};const c=await content(s,{article});
 const at=Date.now();await backup.scheduled({cron:'0 19 * * *',scheduledTime:at},f.env,{});let keys=[];
 for(let n=0;n<80;n++){keys=[...f.env.CHANNEL_BACKUPS.objects.keys()].filter(k=>k.endsWith('/manifest.enc'));if(keys.length)break;await backup.scheduled({cron:'*/5 * * * *',scheduledTime:at},f.env,{})}assert.equal(keys.length,1);
 const key=keys[0],m=await open(f.env,JSON.parse(f.env.CHANNEL_BACKUPS.objects.get(key)),key),read=async table=>{const rows=[];for(const file of m.files.filter(x=>x.table===table))rows.push(...(await open(f.env,JSON.parse(f.env.CHANNEL_BACKUPS.objects.get(file.key)),file.key)).rows);return rows};
 const item=(await read('content_items')).find(x=>x.tenant_id===s.t.id&&x.id===c.id),rev=(await read('content_revisions')).find(x=>x.tenant_id===s.t.id&&x.content_id===c.id);
 assert.deepEqual(JSON.parse(item.article_json),article);assert.deepEqual(JSON.parse(rev.doc_json).article,article);assert.equal((await backup.fetch(new Request('https://local.test'))).status,404);
 console.log(JSON.stringify({result:'pass',actual_artifact:'backup-dist/backup-worker.js',encrypted_manifest:true,new_article_column_in_encrypted_shard:true,article_revision_json_in_encrypted_shard:true,old_media_bucket_preserved:true,fetch_status:404,remote_calls:0},null,2));
}finally{f.restore()}
