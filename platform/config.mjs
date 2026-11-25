import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const nonempty=(env,key)=>{if(typeof env[key]!=='string'||!env[key])throw Error('Missing '+key);return env[key];};
export function loadConfig(env=process.env) {
  if(Number(process.versions.node.split('.')[0])<24)throw Error('Node 24 or newer is required');
  const vars={};
  for(const k of ['FIELD_KEY','HMAC_KEY','PW_PEPPER','BACKUP_KEY','PLATFORM_PHONE_HMAC_KEY','PLATFORM_SETUP_KEY','DEEPSEEK_API_KEY','TENANT_HOST','CONSOLE_HOST'])vars[k]=nonempty(env,k);
  for(const k of ['FIELD_KEY','BACKUP_KEY']) {
    const raw=Buffer.from(vars[k],'base64');if(raw.length!==32||raw.toString('base64')!==vars[k])throw Error('Invalid '+k+' (expected canonical 32-byte base64)');
  }
  for(const k of ['HMAC_KEY','PW_PEPPER','PLATFORM_PHONE_HMAC_KEY','PLATFORM_SETUP_KEY'])if(vars[k].length<32)throw Error('Invalid '+k);
  for(const k of ['TURNSTILE_MODE','ACCESS_MODE']){
    // Preserve the business switches; do not silently turn an enabled mode off.
    if(env[k]!=='off')throw Error(k+' must explicitly be off for this Tencent deployment');vars[k]=env[k];
  }
  vars.REFERRALS_MODE=env.REFERRALS_MODE??'off';
  if(!['off','on'].includes(vars.REFERRALS_MODE))throw Error('Invalid REFERRALS_MODE');
  if(env.AI_PROVIDER!==undefined)throw Error('AI_PROVIDER is forbidden in production configuration');
  for(const k of ['TENANT_HOST','CONSOLE_HOST'])if(!/^(?=.{1,253}$)[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9]+$/.test(vars[k]))throw Error('Invalid '+k);
  if(vars.TENANT_HOST===vars.CONSOLE_HOST)throw Error('Hosts must differ');
  const port=Number(env.PORT??8787),maxBodyBytes=Number(env.MAX_BODY_BYTES??33554432);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT');
  if(!Number.isInteger(maxBodyBytes)||maxBodyBytes<1||maxBodyBytes>33554432)throw Error('Invalid MAX_BODY_BYTES');
  const cos={region:nonempty(env,'COS_REGION'),media:nonempty(env,'COS_BUCKET_MEDIA'),backups:nonempty(env,'COS_BUCKET_BACKUPS'),auth:env.COS_AUTH??'role'};
  if(cos.region!=='ap-shanghai')throw Error('COS_REGION must match the Shanghai CVM: ap-shanghai');
  if(cos.media===cos.backups)throw Error('Use separate media and backup buckets');
  for(const name of [cos.media,cos.backups])if(!/^[a-z0-9][a-z0-9-]*-\d+$/.test(name))throw Error('Invalid COS bucket name');
  if(cos.auth==='role')cos.role=nonempty(env,'COS_ROLE_NAME');
  else if(cos.auth==='keys'){cos.secretId=nonempty(env,'COS_SECRET_ID');cos.secretKey=nonempty(env,'COS_SECRET_KEY');}
  else throw Error('COS_AUTH must be role or keys');
  return {vars,cos,port,maxBodyBytes,dbPath:resolve(nonempty(env,'DB_PATH')),distDir:resolve(nonempty(env,'DIST_DIR')),backupPath:resolve(nonempty(env,'BACKUP_WORKER_PATH'))};
}

export async function checkDatabase(d1) {
  const db=d1.database,quick=db.prepare('PRAGMA quick_check').all();
  if(quick.length!==1||Object.values(quick[0])[0]!=='ok')throw Error('SQLite quick_check failed');
  if(db.prepare('PRAGMA foreign_keys').get().foreign_keys!==1)throw Error('SQLite foreign_keys disabled');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('SQLite foreign_key_check failed');
  // Existing migrations have no mandatory migration ledger. Verify every 0028 object
  // and the 0027 columns, rather than inventing/re-writing a version in the old DB.
  const tables=['plan_templates','plan_sample_templates','plan_reference_flags','plan_briefs','plan_v2_conversions','plan_v2_elements'];
  for(const name of tables)if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))throw Error('Database must be upgraded through 0028: '+name);
  for(const name of ['plan_v2_element_identity','plan_v2_conversion_identity'])if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name))throw Error('Missing 0028 trigger: '+name);
  for(const [table,column] of [['gallery_images','bytes'],['tenants','gallery_storage_limit']])if(!db.prepare('PRAGMA table_info('+table+')').all().some(x=>x.name===column))throw Error('Missing 0027 column: '+column);
}
export async function checkBuild(config) {
  const workerPath=resolve(config.distDir,'_worker.js');
  const [worker,backup]=await Promise.all([readFile(workerPath),readFile(config.backupPath)]);
  if(!worker.length||!backup.length)throw Error('Missing build artifacts');
  return {workerPath,workerSha256:createHash('sha256').update(worker).digest('hex'),backupSha256:createHash('sha256').update(backup).digest('hex')};
}
export async function existingDatabase(path) {const file=await stat(path);if(!file.isFile())throw Error('DB_PATH must be an existing imported database');}
export async function checkBuckets(buckets) {
  for(const bucket of [buckets.media,buckets.backups]) {
    try{await bucket.list({prefix:'__yxt_startup_probe__/',limit:1});
    await bucket.head('__yxt_startup_probe__/nonexistent-'+crypto.randomUUID());}catch(error){throw Error('COS self-check failed: '+String(error?.statusCode||'network')+' '+String(error?.code||'unknown').replace(/[^A-Za-z0-9_-]/g,''));}
  }
}
