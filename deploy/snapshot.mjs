import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,rm,writeFile,appendFile,stat,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReadStream,createWriteStream} from 'node:fs';
import {createGzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {createCipheriv,randomBytes,createHash} from 'node:crypto';
import {loadConfig} from '../platform/config.mjs';
import {createBuckets} from '../platform/r2-cos.mjs';

export async function fileSnapshot(config,bucket,{now=Date.now}={}) {
  const dir=await mkdtemp(join(tmpdir(),'yxt-snapshot-'));let db;
  try {
    const file=join(dir,'snapshot.sqlite'),packed=join(dir,'snapshot.sqlite.gz.enc');
    db=new DatabaseSync(config.dbPath,{readOnly:true});await backup(db,file);db.close();db=null;await chmod(file,0o600);
    // Local file snapshots contain all sensitive data. Compress THEN encrypt using
    // a domain-separated key from the existing BACKUP_KEY, never upload clear SQL.
    const key=createHash('sha256').update(Buffer.from(config.vars.BACKUP_KEY,'base64')).update('yxt-file-snapshot-v1').digest(),iv=randomBytes(12);
    const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('yxt-file-snapshot-v1'));
    await writeFile(packed,Buffer.concat([Buffer.from('YXTFS1'),iv]),{flag:'wx',mode:0o600});
    await pipeline(createReadStream(file),createGzip(),cipher,createWriteStream(packed,{flags:'a'}));
    await appendFile(packed,cipher.getAuthTag());
    const keyName='files/'+new Date(now()).toISOString().replaceAll(':','-')+'-'+crypto.randomUUID()+'.sqlite.gz.enc';
    const size=(await stat(packed)).size;
    await bucket.putFile(keyName,packed,{httpMetadata:{contentType:'application/octet-stream'}});
    let cursor;do {const page=await bucket.list({prefix:'files/',cursor,limit:1000});const expired=page.objects.filter(x=>x.uploaded.getTime()<now()-14*86400000).map(x=>x.key);if(expired.length)await bucket.delete(expired);cursor=page.truncated?page.cursor:undefined;}while(cursor);
    return {key:keyName,bytes:size,retentionDays:14,encrypted:true};
  }finally{db?.close();await rm(dir,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const config=loadConfig(),buckets=await createBuckets(config);console.log(JSON.stringify(await fileSnapshot(config,buckets.backups)));}catch(error){console.error('SNAPSHOT ERROR:',error.message);process.exitCode=1;}}
