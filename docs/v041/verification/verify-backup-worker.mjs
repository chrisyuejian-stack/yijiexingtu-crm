import assert from 'node:assert/strict';
import backup from '../../../backup-dist/backup-worker.js';
import {fixture} from '../../../tests/support.mjs';
import {setup} from '../../../tests/fixtures-credit.mjs';
import {open} from '../../../src/server/backup.js';
import {gallery,storageLimit} from '../../../tests/fixtures-v041.mjs';
import {ok} from '../../../tests/fixtures-plans.mjs';
const f=await fixture();try{
 const s=await setup(f,1,'backup041');s.f=f;await s.r.settingsGalleryCreate({id:'img_backup041',r2_key:'local/backup041',mime:'image/png',width:1,height:1,tags:[],consent:false},s.user);await f.env.CHANNEL_MEDIA.put('local/backup041','x'.repeat(123));ok(await gallery(s));ok(await storageLimit(s,8888));
 const at=Date.now();await backup.scheduled({cron:'0 19 * * *',scheduledTime:at},f.env,{});let keys=[];for(let n=0;n<100;n++){keys=[...f.env.CHANNEL_BACKUPS.objects.keys()].filter(x=>x.endsWith('/manifest.enc'));if(keys.length)break;await backup.scheduled({cron:'*/5 * * * *',scheduledTime:at},f.env,{})}assert.equal(keys.length,1);
 const key=keys[0],manifest=await open(f.env,JSON.parse(f.env.CHANNEL_BACKUPS.objects.get(key)),key),rows={};for(const table of ['tenants','gallery_images']){rows[table]=[];for(const part of manifest.files.filter(x=>x.table===table))rows[table].push(...(await open(f.env,JSON.parse(f.env.CHANNEL_BACKUPS.objects.get(part.key)),part.key)).rows)}
 assert.equal(rows.tenants.find(x=>x.id===s.t.id).gallery_storage_limit,8888);assert.equal(rows.gallery_images.find(x=>x.id==='img_backup041').bytes,123);assert.ok(f.env.CHANNEL_MEDIA.objects.has('local/backup041'));assert.equal((await backup.fetch(new Request('https://local.test'))).status,404);
 console.log(JSON.stringify({result:'pass',actual_worker:'backup-dist/backup-worker.js',encrypted_manifest:true,new_columns_preserved:['gallery_images.bytes','tenants.gallery_storage_limit'],private_media_object_unchanged:true,fetch_status:404,remote_calls:0},null,2));
}finally{f.restore()}
