import assert from 'node:assert/strict';
import backupWorker from '../../../backup-dist/backup-worker.js';
import {fixture} from '../../../tests/support.mjs';
import {setup} from '../../../tests/fixtures-credit.mjs';
import {call} from '../../../tests/fixtures-plans.mjs';
import {ops,ok,upload,publish} from '../../../tests/fixtures-platform.mjs';
import {open} from '../../../src/server/backup.js';
const f=await fixture();try{
 const s=await setup(f,1,'platform-backup');s.f=f;ok(await call(s,'settings/subjects','POST',{key:'music_interest'}));const style=ok(await upload(f),201);ok(await publish(f,style,'tenants',[s.t.id]));
 const at=Date.now();await backupWorker.scheduled({cron:'0 19 * * *',scheduledTime:at},f.env,{});let keys=[];
 for(let i=0;i<60;i++){keys=[...f.env.CHANNEL_BACKUPS.objects.keys()].filter(k=>k.endsWith('/manifest.enc'));if(keys.length)break;await backupWorker.scheduled({cron:'*/5 * * * *',scheduledTime:at},f.env,{})}assert.equal(keys.length,1);const key=keys[0],manifest=await open(f.env,JSON.parse(f.env.CHANNEL_BACKUPS.objects.get(key)),key);const counts={},rows={};for(const table of ['subject_packs','subject_pack_versions','setting_template_refs','style_version_meta','style_version_tenants','style_assets','style_defaults']){const files=manifest.files.filter(x=>x.table===table);assert.ok(files.length,table);rows[table]=[];for(const file of files)rows[table].push(...(await open(f.env,JSON.parse(f.env.CHANNEL_BACKUPS.objects.get(file.key)),file.key)).rows);assert.ok(rows[table].length,table);counts[table]=rows[table].length;}
 const asset=rows.style_assets.find(x=>x.pack_id==='test_style');assert.ok(asset?.sha256);assert.ok(f.env.CHANNEL_MEDIA.objects.has(asset.r2_key));assert.ok(rows.style_version_tenants.some(x=>x.tenant_id===s.t.id));assert.equal((await backupWorker.fetch(new Request('https://local.test'))).status,404);
 console.log(JSON.stringify({result:'pass',worker:'backup-dist/backup-worker.js',encrypted_manifest:true,platform_and_tenant_rows:counts,style_asset_hash_and_r2_key_preserved:true,original_private_media_object_retained:true,scope_tenant_preserved:true,remote_calls:0},null,2));
}finally{f.restore();}
