// Local adapter entry point. Never embeds account credentials or performs HTTP requests.
import { repo } from '../src/server/repo.js';
import { decrypt, platformPhoneIndex } from '../src/server/crypto.js';
export async function rebuildPlatformPhoneIndex(env, admin) {
  if (admin?.role !== 'owner') throw new Error('仅平台超级管理员可重建索引');
  const r=repo(env,null);let offset=0,processed=0;
  for (;;) {
    const rows=await r.identityIndexRows(offset,10);
    if(!rows.length) break;
    const prepared=[];
    for(const row of rows) prepared.push({...row,hash:await platformPhoneIndex(env,await decrypt(env,row.phone_enc,row.tenant_id+':phone'))});
    // Each page is atomic and version-checked; retry the repair if accounts changed.
    await r.identityIndexPage(prepared,admin.id);
    processed+=rows.length;offset+=rows.length;
  }
  await r.identityIndexFinish(admin.id);
  return {processed};
}
