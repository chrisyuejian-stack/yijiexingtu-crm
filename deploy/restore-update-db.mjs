// This recovery helper deliberately uses only Node built-ins. A verified copy is
// stored beside each update snapshot, so pruning/rolling back code cannot lose it.
import {DatabaseSync,backup} from 'node:sqlite';
import {readFile,stat,mkdir,chmod,rename,unlink,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,dirname,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
const execute=promisify(execFile);
export async function digestFile(path) {const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
function integrity(path) {const db=new DatabaseSync(path,{readOnly:true,enableForeignKeyConstraints:true});try{const rows=db.prepare('PRAGMA quick_check').all();if(rows.length!==1||Object.values(rows[0])[0]!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Snapshot integrity/foreign key check failed');}finally{db.close();}}
export async function restoreUpdateSnapshot(snapshot,{confirmed=false,stopService}={}) {
  if(!confirmed)throw Error('Database is NOT restored. Explicit --confirm-data-loss is required.');
  snapshot=resolve(snapshot);const meta=JSON.parse(await readFile(snapshot+'.meta.json','utf8'));
  if(meta.schema!==1||meta.snapshot!==snapshot||await digestFile(snapshot)!==meta.sha256)throw Error('Snapshot metadata/hash mismatch');
  if(meta.operationLock)try{const pid=Number(await readFile(meta.operationLock,'utf8'));try{process.kill(pid,0);throw Error('Deployment is active; do not restore concurrently');}catch(error){if(error.code!=='ESRCH')throw error;}}catch(error){if(error.code!=='ENOENT')throw error;}
  integrity(snapshot);
  await mkdir(dirname(meta.maintenanceFlag),{recursive:true});await writeFile(meta.maintenanceFlag,'',{mode:0o644});
  if(stopService)await stopService();else await execute('systemctl',['stop',meta.service]);
  try{await stat(meta.dbPath+'.node-lock');throw Error('Database writer still owns the process lock');}catch(error){if(error.code!=='ENOENT')throw error;}
  const info=await stat(meta.dbPath),rescue=join(dirname(snapshot),'before-manual-restore-'+Date.now()+'-'+crypto.randomUUID()+'.sqlite');
  let db=new DatabaseSync(meta.dbPath,{enableForeignKeyConstraints:true});
  try{await backup(db,rescue);await chmod(rescue,0o600);const checkpoint=db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();if(checkpoint.busy)throw Error('SQLite checkpoint busy; keep maintenance and stop readers before restore');}finally{db.close();}
  const temporary=join(dirname(snapshot),'restore-'+crypto.randomUUID()+'.sqlite');
  try{
    db=new DatabaseSync(snapshot,{readOnly:true});try{await backup(db,temporary);}finally{db.close();}await chmod(temporary,0o600);integrity(temporary);
    if(process.getuid?.()===0){const {chown}=await import('node:fs/promises');await chown(temporary,info.uid,info.gid);}
    // Service is stopped, rescue is durable, and old WAL has been checkpointed.
    await unlink(meta.dbPath+'-wal').catch(e=>{if(e.code!=='ENOENT')throw e;});await unlink(meta.dbPath+'-shm').catch(e=>{if(e.code!=='ENOENT')throw e;});await rename(temporary,meta.dbPath);
    return {restored:true,dbPath:meta.dbPath,rescue,maintenanceKept:true};
  }catch(error){await unlink(temporary).catch(()=>{});throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{if(process.getuid?.()!==0)throw Error('Recovery must be run as root');const [snapshot,...flags]=process.argv.slice(2);if(!snapshot)throw Error('Supply the update snapshot path');console.log(JSON.stringify(await restoreUpdateSnapshot(snapshot,{confirmed:flags.includes('--confirm-data-loss')}),null,2));console.log('数据库已恢复，维护仍保持；请先核对代码版本、登录与数据，再解除维护。');}
  catch(error){console.error('RESTORE FAILED:',error.message);process.exitCode=1;}
}
