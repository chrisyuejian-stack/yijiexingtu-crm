// Developer-only local verification. No remote bindings, credentials or HTTP.
import assert from 'node:assert/strict';
import { fixture } from '../../../tests/support.mjs';
import { setup } from '../../../tests/fixtures-credit.mjs';
import backupWorker from '../../../backup-dist/backup-worker.js';
import { open } from '../../../src/server/backup.js';
const f=await fixture();
try {
  const s=await setup(f,1,'backup-bundle-stage2');
  const linked=await s.call('students/'+s.students[0]+'/guardians','POST',{name:'本地备份家长',phone:'13800001111',relation:'mother'});
  assert.equal(linked.status,201,linked.text);
  const at=Date.now();
  await backupWorker.scheduled({cron:'0 19 * * *',scheduledTime:at},f.env,{});
  let manifests;
  for(let i=0;i<30;i++) {
    manifests=[...f.env.CHANNEL_BACKUPS.objects.keys()].filter(k=>k.endsWith('/manifest.enc'));
    if(manifests.length)break;
    await backupWorker.scheduled({cron:'*/5 * * * *',scheduledTime:at},f.env,{});
  }
  assert.equal(manifests.length,1);
  const key=manifests[0];
  const manifest=await open(f.env,JSON.parse(f.env.CHANNEL_BACKUPS.objects.get(key)),key);
  const guardianFile=manifest.files.find(x=>x.table==='guardian_links');
  assert.ok(guardianFile);assert.equal(manifest.tables.guardian_links,1);
  const guardian=await open(f.env,JSON.parse(f.env.CHANNEL_BACKUPS.objects.get(guardianFile.key)),guardianFile.key);
  assert.equal(guardian.rows[0].parent_user_id,linked.body.user.id);
  const studentFile=manifest.files.find(x=>x.table==='students');
  const students=await open(f.env,JSON.parse(f.env.CHANNEL_BACKUPS.objects.get(studentFile.key)),studentFile.key);
  assert.equal(students.rows[0].nickname,'X 同学');
  assert.equal((await backupWorker.fetch(new Request('https://local.test/'))).status,404);
  console.log(JSON.stringify({result:'pass',worker:'backup-dist/backup-worker.js',manifest_published:true,encrypted_guardian_rows:guardian.rows.length,student_new_fields_preserved:true,fetch_status:404,remote_calls:0}));
} finally { f.restore(); }
