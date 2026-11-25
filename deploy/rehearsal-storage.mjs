import {readFile,writeFile,stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig} from '../platform/config.mjs';
import {createBuckets} from '../platform/r2-cos.mjs';

async function inventory(bucket) {
  const keys=[];let cursor;
  do{const page=await bucket.list({cursor,limit:1000});keys.push(...page.objects.map(x=>({key:x.key,size:x.size})));cursor=page.truncated?page.cursor:undefined;}while(cursor);
  return keys;
}
export async function recordStorage(config,buckets) {return {schema:1,at:new Date().toISOString(),mediaBucket:config.cos.media,backupBucket:config.cos.backups,media:await inventory(buckets.media),backups:await inventory(buckets.backups)};}
export async function cleanupRehearsal(before,config,buckets,{apply=false}={}) {
  if(before.schema!==1||before.mediaBucket!==config.cos.media||before.backupBucket!==config.cos.backups)throw Error('Rehearsal manifest belongs to different buckets');
  const after=await recordStorage(config,buckets),plan={};
  for(const kind of ['media','backups']){if(!Array.isArray(before[kind]))throw Error('Invalid rehearsal manifest');const old=new Set(before[kind].map(x=>x.key)),current=new Set(after[kind].map(x=>x.key));plan[kind]={added:after[kind].filter(x=>!old.has(x.key)).map(x=>x.key),missingBaseline:before[kind].filter(x=>!current.has(x.key)).map(x=>x.key)};}
  if(apply)for(const kind of ['media','backups'])await buckets[kind].delete(plan[kind].added);
  return {applied:apply,...plan};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [action,file,...flags]=process.argv.slice(2);if(!file||!['record','cleanup'].includes(action))throw Error('Usage: record manifest.json | cleanup manifest.json [--confirm-rehearsal-only]');
  const config=loadConfig(),buckets=await createBuckets(config);
  if(action==='record'){await writeFile(file,JSON.stringify(await recordStorage(config,buckets),null,2)+'\n',{flag:'wx',mode:0o600});console.log('Rehearsal storage manifest recorded; no objects changed.');}
  else {
    try{await stat(config.dbPath+'.node-lock');throw Error('Stop the Node service before rehearsal cleanup');}catch(error){if(error.code!=='ENOENT')throw error;}
    const result=await cleanupRehearsal(JSON.parse(await readFile(file,'utf8')),config,buckets,{apply:flags.includes('--confirm-rehearsal-only')});console.log(JSON.stringify(result,null,2));
  }
 }catch(error){console.error('REHEARSAL STORAGE FAILED:',error.message);process.exitCode=1;}
}
