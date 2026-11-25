import {readFile,readdir,lstat,mkdir,writeFile,rm,stat} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {encodeZip,decodeZip,safeArchivePath} from './zip.mjs';

export const hashBytes=data=>createHash('sha256').update(data).digest('hex');
export const validVersion=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value)&&value!=='.'&&value!=='..';
const allowed=name=>['server.mjs','package.json','release.json','SHA256SUMS'].includes(name)||['dist/','backup-dist/','platform/','migrations/','deploy/'].some(p=>name.startsWith(p));
const required=['server.mjs','package.json','dist/_worker.js','backup-dist/backup-worker.js','platform/config.mjs','deploy/update.sh','deploy/rollback.sh','deploy/npm/package-lock.json'];
export function validateEntries(entries) {
  const files=new Map(entries.map(e=>[e.name,e]));if(files.size!==entries.length)throw Error('Duplicate archive files');
  for(const name of files.keys()){safeArchivePath(name);if(!allowed(name)||name.split('/').includes('node_modules'))throw Error('Unexpected release payload: '+name);}
  if(!files.has('SHA256SUMS')||!files.has('release.json'))throw Error('Release metadata/checksum file missing');
  const hashes=new Map();
  for(const line of files.get('SHA256SUMS').data.toString('utf8').trim().split('\n')){
    const m=/^([a-f0-9]{64})  (.+)$/.exec(line);if(!m)throw Error('Invalid SHA256SUMS line');safeArchivePath(m[2]);if(m[2]==='SHA256SUMS'||hashes.has(m[2]))throw Error('Duplicate/self checksum');hashes.set(m[2],m[1]);
  }
  if(hashes.size!==files.size-1)throw Error('Unlisted payload file');
  for(const [name,digest] of hashes)if(!files.has(name)||hashBytes(files.get(name).data)!==digest)throw Error('SHA256 mismatch: '+name);
  for(const name of required)if(!files.has(name))throw Error('Required release file missing: '+name);
  const meta=JSON.parse(files.get('release.json').data.toString('utf8'));
  if(meta.schema!==1||!validVersion(meta.version)||!Array.isArray(meta.migrations)||!meta.migrations.length)throw Error('Invalid release metadata');
  for(const [path,digest] of Object.entries(meta.artifacts||{}))if(!files.has(path)||hashBytes(files.get(path).data)!==digest)throw Error('Build artifact fingerprint mismatch');
  for(const path of ['dist/_worker.js','backup-dist/backup-worker.js'])if(!meta.artifacts?.[path])throw Error('Build fingerprint missing');
  const migrations=[...files.keys()].filter(x=>x.startsWith('migrations/')).sort();
  if(migrations.length!==meta.migrations.length)throw Error('Migration inventory mismatch');
  for(let i=0;i<migrations.length;i++){const row=meta.migrations[i],name=migrations[i],m=/^migrations\/(\d{4})_[a-z0-9_]+\.sql$/.exec(name);if(!m||Number(m[1])!==i+1||row.version!==i+1||row.name!==name.slice(11)||row.sha256!==hashBytes(files.get(name).data))throw Error('Migration inventory/hash mismatch');}
  if(meta.maxMigration!==migrations.length)throw Error('Incorrect maxMigration');
  return meta;
}
export async function verifyReleaseDirectory(directory) {
  const entries=[];
  async function walk(path='') {for(const name of await readdir(join(directory,path))){const file=join(path,name),info=await lstat(join(directory,file));if(info.isSymbolicLink())throw Error('Release symlinks forbidden');if(info.isDirectory())await walk(file);else if(info.isFile())entries.push({name:file.split('\\').join('/'),data:await readFile(join(directory,file)),mode:info.mode});else throw Error('Release special file forbidden');}}
  await walk();return validateEntries(entries);
}
export async function extractRelease(archive,directory) {
  const info=await stat(archive);if(info.size>256*1024*1024)throw Error('Release ZIP exceeds 256 MiB');
  const raw=await readFile(archive),entries=decodeZip(raw),metadata=validateEntries(entries);
  try{const sidecar=(await readFile(archive+'.sha256','utf8')).trim().split(/\s+/)[0];if(!/^[a-f0-9]{64}$/.test(sidecar)||hashBytes(raw)!==sidecar)throw Error('ZIP sidecar SHA256 mismatch');}catch(error){if(error.code!=='ENOENT')throw error;}
  await mkdir(directory,{recursive:false,mode:0o750});
  try{for(const entry of entries){const path=join(directory,entry.name);await mkdir(join(path,'..'),{recursive:true,mode:0o750});await writeFile(path,entry.data,{flag:'wx',mode:/\.(?:sh|command)$/.test(entry.name)?0o750:0o640});}return metadata;}
  catch(error){await rm(directory,{recursive:true,force:true});throw error;}
}
export async function createReleasePackage(source,output,{version}={}) {
  source=resolve(source);const pkg=JSON.parse(await readFile(join(source,'package.json'),'utf8'));
  version=version||pkg.version+'-tencent.'+new Date().toISOString().replace(/[-:.]/g,'')+'.'+randomBytes(3).toString('hex');if(!validVersion(version))throw Error('Invalid release version');
  const entries=[];
  async function walk(prefix) {
    for(const name of (await readdir(join(source,prefix))).sort()){
      if(['node_modules','packages','verification'].includes(name))continue;
      const path=join(prefix,name).split('\\').join('/');
      if((/(?:^|\.)(?:env|pem|key|p12|pfx)(?:\.|$)/.test(name)&&!name.endsWith('.example'))||['rclone.conf','ops.htpasswd'].includes(name))continue;
      if(path===relative(source,resolve(output)).split('\\').join('/')||/\.(?:zip|sqlite|db)(?:\..*)?$/.test(name)||['changes.patch','文件清单.json'].includes(name)||name==='app.env'||name==='cert.env')continue;
      const info=await lstat(join(source,path));if(info.isSymbolicLink())throw Error('Package source symlinks forbidden');
      if(info.isDirectory())await walk(path);else if(info.isFile())entries.push({name:path,data:await readFile(join(source,path)),mode:info.mode});
    }
  }
  for(const prefix of ['dist','backup-dist','platform','migrations','deploy'])await walk(prefix);
  for(const name of ['server.mjs','package.json'])entries.push({name,data:await readFile(join(source,name))});
  const migrations=entries.filter(e=>e.name.startsWith('migrations/')).sort((a,b)=>a.name.localeCompare(b.name)).map(e=>({version:Number(e.name.slice(11,15)),name:e.name.slice(11),sha256:hashBytes(e.data)}));
  const artifacts=Object.fromEntries(entries.filter(e=>e.name==='dist/_worker.js'||e.name==='backup-dist/backup-worker.js').map(e=>[e.name,hashBytes(e.data)]));
  const meta={schema:1,version,applicationVersion:pkg.version,createdAt:new Date().toISOString(),maxMigration:migrations.length,migrations,artifacts};
  entries.push({name:'release.json',data:Buffer.from(JSON.stringify(meta,null,2)+'\n')});entries.sort((a,b)=>a.name.localeCompare(b.name));
  entries.push({name:'SHA256SUMS',data:Buffer.from(entries.map(e=>hashBytes(e.data)+'  '+e.name).join('\n')+'\n')});validateEntries(entries);
  const data=encodeZip(entries);await mkdir(join(resolve(output),'..'),{recursive:true});await writeFile(output,data,{flag:'wx',mode:0o600});await writeFile(output+'.sha256',hashBytes(data)+'  '+output.split('/').at(-1)+'\n',{flag:'wx',mode:0o600});
  return {version,output:resolve(output),sha256:hashBytes(data),files:entries.length,metadata:meta};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const [action,...args]=process.argv.slice(2);if(action==='verify-dir')console.log(JSON.stringify(await verifyReleaseDirectory(resolve(args[0]))));else if(action==='extract'){if(!args[0]||!args[1])throw Error('extract ZIP NEW_DIRECTORY');console.log(JSON.stringify(await extractRelease(resolve(args[0]),resolve(args[1]))));}else throw Error('Usage: verify-dir DIRECTORY | extract ZIP NEW_DIRECTORY');}catch(error){console.error('PACKAGE ERROR:',error.message);process.exitCode=1;}}
