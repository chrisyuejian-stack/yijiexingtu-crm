import {createDecipheriv,createHash} from 'node:crypto';
import {open,unlink,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createGunzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

export async function restoreFileSnapshot(input,output,backupKey) {
  const size=(await stat(input)).size,header=Buffer.alloc(18),tag=Buffer.alloc(16),source=await open(input,'r');
  try{await source.read(header,0,18,0);await source.read(tag,0,16,size-16);}finally{await source.close();}
  if(header.subarray(0,6).toString()!=='YXTFS1'||size<34)throw Error('Not a YXT file snapshot');
  const key=createHash('sha256').update(Buffer.from(backupKey,'base64')).update('yxt-file-snapshot-v1').digest(),decipher=createDecipheriv('aes-256-gcm',key,header.subarray(6,18));decipher.setAAD(Buffer.from('yxt-file-snapshot-v1'));decipher.setAuthTag(tag);
  const file=await open(output,'wx',0o600);
  try {await pipeline(createReadStream(input,{start:18,end:size-17}),decipher,createGunzip(),file.createWriteStream());const db=new DatabaseSync(output,{readOnly:true});try{if(Object.values(db.prepare('PRAGMA integrity_check').get())[0]!=='ok')throw Error('Restored integrity_check failed');}finally{db.close();}}
  catch(error){await file.close().catch(()=>{});await unlink(output).catch(()=>{});throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const [input,output]=process.argv.slice(2);if(!input||!output||!process.env.BACKUP_KEY)throw Error('Usage: node deploy/restore-file-snapshot.mjs encrypted-file NEW.sqlite (BACKUP_KEY from environment)');await restoreFileSnapshot(input,output,process.env.BACKUP_KEY);console.log('RESTORE OK; validate offline before replacing the service database.');}catch(error){console.error('RESTORE FAILED:',error.message);process.exitCode=1;}}
