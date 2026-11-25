import {DatabaseSync,backup} from 'node:sqlite';
import {readFile,writeFile,readdir,mkdir,rename,rm,symlink,realpath,lstat,stat,open,unlink,copyFile,chmod} from 'node:fs/promises';
import {join,resolve,dirname,basename,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {extractRelease,validVersion} from './release-package.mjs';
import {migrationFiles,migrationPlan,applyMigrations,ledgerVersion} from './migrate.mjs';
import {digestFile} from './restore-update-db.mjs';

const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const shell=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
const inside=(root,path)=>path.startsWith(root+'/')&&path!==root;
async function atomicJson(path,value){const temporary=path+'.tmp-'+crypto.randomUUID(),file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(value,null,2)+'\n');await file.sync();}finally{await file.close();}await rename(temporary,path);}
async function exclusiveLock(path){
  for(let attempt=0;attempt<2;attempt++)try{const file=await open(path,'wx',0o600);await file.writeFile(String(process.pid));return async()=>{await file.close();await unlink(path);};}
  catch(error){if(error.code!=='EEXIST')throw error;const pid=Number(await readFile(path,'utf8'));if(!Number.isInteger(pid)||pid<1)throw Error('Invalid deployment lock; inspect it before retry');try{process.kill(pid,0);throw Error('Another deployment operation is running');}catch(e){if(e.code!=='ESRCH')throw e;}await unlink(path);}
  throw Error('Cannot acquire deployment lock');
}
async function switchCurrent(settings,version){if(!validVersion(version))throw Error('Invalid version');const target=join(settings.releases,version);if(await realpath(target)!==target)throw Error('Release directory must not be a symlink');const temporary=join(settings.appRoot,'.current-'+crypto.randomUUID());await symlink(target,temporary);await rename(temporary,settings.current);}
async function currentVersion(settings){const info=await lstat(settings.current);if(!info.isSymbolicLink())throw Error('current must be a symbolic link');const path=await realpath(settings.current);if(!inside(settings.releases,path)||dirname(path)!==settings.releases||!validVersion(basename(path)))throw Error('current points outside versioned releases');return {version:basename(path),path};}
async function metadata(path,version){try{const data=JSON.parse(await readFile(join(path,'release.json'),'utf8'));if(data.version!==version)throw Error('Release directory/metadata version mismatch');return data;}catch(error){if(error.code!=='ENOENT')throw error;const files=await migrationFiles(join(path,'migrations'));return {schema:1,version,maxMigration:files.length,legacy:true};}}
async function prepareSettings(options){
  for(const name of ['prepareDependencies','stopService','startService','healthCheck'])if(typeof options.ops?.[name]!=='function')throw Error('Missing deployment operation '+name);
  const appRoot=resolve(options.appRoot),dataRoot=resolve(options.dataRoot||join(dirname(dirname(options.dbPath)),basename(dirname(options.dbPath))+'-deploy')),dbPath=resolve(options.dbPath),releases=join(appRoot,'releases');
  if(inside(releases,dbPath))throw Error('DB_PATH must be persistent and outside releases');
  const stateRoot=join(dataRoot,'deploy'),snapshots=join(dataRoot,'release-snapshots');
  for(const path of [dataRoot,stateRoot,snapshots]){await mkdir(path,{recursive:true,mode:0o700});const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid()||(info.mode&0o077))throw Error('Deployment state/snapshots require a private operator-owned directory');}
  return {...options,appRoot,dataRoot,dbPath,releases,current:join(appRoot,'current'),stateRoot,snapshots,statePath:join(stateRoot,'state.json'),maintenanceFlag:resolve(options.maintenanceFlag),service:options.service||'yijiexingtu'};
}
async function readState(settings,current){
  let state;try{state=JSON.parse(await readFile(settings.statePath,'utf8'));if(state.schema!==1||!state.releases)throw Error('Unknown deployment state');}catch(error){if(error.code!=='ENOENT')throw error;state={schema:1,current:current.version,previous:null,sequence:0,releases:{},events:[],pending:null};}
  if(!state.releases[current.version]){const meta=await metadata(current.path,current.version);state.releases[current.version]={version:current.version,previous:null,sequence:state.sequence,maxMigration:meta.maxMigration,legacy:!!meta.legacy};}
  if(!state.pending&&state.current!==current.version)throw Error('Deployment state/current mismatch; keep maintenance and inspect before updating');
  return state;
}
async function saveState(settings,state){state.events=state.events.slice(-100);await atomicJson(settings.statePath,state);}
export async function updateSnapshot(settings,version,kind){
  const path=join(settings.snapshots,version+'-'+crypto.randomUUID()+'-'+kind+'.sqlite');const db=new DatabaseSync(settings.dbPath,{readOnly:true});
  try{await backup(db,path);}finally{db.close();}await chmod(path,0o600);
  const helper=path+'.restore.mjs';await copyFile(new URL('./restore-update-db.mjs',import.meta.url),helper);await chmod(helper,0o600);
  const meta={schema:1,snapshot:path,sha256:await digestFile(path),databaseVersion:ledgerVersion(path)??28,createdAt:new Date().toISOString(),version,kind,dbPath:settings.dbPath,maintenanceFlag:settings.maintenanceFlag,service:settings.service,operationLock:join(settings.stateRoot,'operation.lock')};
  await atomicJson(path+'.meta.json',meta);return {path,helper,sha256:meta.sha256,databaseVersion:meta.databaseVersion,restoreCommand:'/usr/bin/node '+shell(helper)+' '+shell(path)+' --confirm-data-loss'};
}
async function maintenance(settings){await mkdir(dirname(settings.maintenanceFlag),{recursive:true});await writeFile(settings.maintenanceFlag,'',{mode:0o644});}
async function clearMaintenance(settings,wasMaintenance){if(!wasMaintenance)await unlink(settings.maintenanceFlag).catch(error=>{if(error.code!=='ENOENT')throw error;});}
async function noWriter(settings){if(await exists(settings.dbPath+'.node-lock'))throw Error('Database process lock remains after stopping service');}
async function compatibleSnapshot(state,maxVersion){
  const records=[state.lastFailure,...Object.values(state.releases).sort((a,b)=>b.sequence-a.sequence)];
  for(const record of records)for(const snapshot of [record?.rollbackSnapshot,record?.frozen])if(snapshot&&snapshot.databaseVersion<=maxVersion&&await exists(snapshot.path)&&await exists(snapshot.helper))return snapshot;
  return null;
}
function hasDatabaseChanges(settings,version,record){
  if(record?.migrations?.applied?.length)return true;
  const db=new DatabaseSync(settings.dbPath,{readOnly:true});try{if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations' AND type='table'").get())return false;return !!db.prepare('SELECT 1 FROM schema_migrations WHERE release=? AND bootstrap=0 LIMIT 1').get(version);}finally{db.close();}
}
async function prune(settings,state){
  const current=state.current,previous=state.previous,records=Object.values(state.releases).filter(x=>!x.pruned).sort((a,b)=>b.sequence-a.sequence),keep=new Set([current,...previous?[previous]:[]]);
  for(const record of records){if(keep.size>=5)break;keep.add(record.version);}
  for(const record of records)if(!keep.has(record.version)){await rm(join(settings.releases,record.version),{recursive:true,force:true});record.pruned=true;}
  for(const record of Object.values(state.releases))if(record.previous&&state.releases[record.previous]?.pruned)record.previous=null;
  state.previous=state.releases[state.current]?.previous||null;
}
export async function updateRelease(archive,options){
  const settings=await prepareSettings(options),unlock=await exclusiveLock(join(settings.stateRoot,'operation.lock'));
  let staging,targetPath,current,state,record,entered=false,switched=false,migrated=false,wasMaintenance=false,createdTarget=false;
  try{
    current=await currentVersion(settings);state=await readState(settings,current);if(state.pending)throw Error('Interrupted deployment detected; run rollback.sh before another update');
    staging=join(settings.releases,'.incoming-'+crypto.randomUUID());const meta=await extractRelease(resolve(archive),staging);targetPath=join(settings.releases,meta.version);
    if(await exists(targetPath))throw Error('Version already exists; publish a new immutable version');
    await settings.ops.prepareDependencies(staging,current.path);
    const files=await migrationFiles(join(staging,'migrations')),plan=await migrationPlan(settings.dbPath,files,join(current.path,'migrations')),previousMeta=await metadata(current.path,current.version);
    const databaseAhead=plan.version>previousMeta.maxMigration;
    const online=await updateSnapshot(settings,meta.version,'online');
    // Do not publish a half-prepared version. Dependencies and ZIP hashes are already checked.
    await rename(staging,targetPath);staging=null;createdTarget=true;
    wasMaintenance=await exists(settings.maintenanceFlag);
    record={version:meta.version,previous:current.version,maxMigration:meta.maxMigration,sequence:state.sequence+1,online,wasMaintenance,databaseChangedForPrevious:databaseAhead,rollbackSnapshot:databaseAhead?await compatibleSnapshot(state,previousMeta.maxMigration):null,startedAt:new Date().toISOString(),phase:'prepared'};
    state.pending=record;await saveState(settings,state);
    await maintenance(settings);entered=true;await settings.ops.stopService();await noWriter(settings);
    record.frozen=await updateSnapshot(settings,meta.version,'frozen');if(!databaseAhead)record.rollbackSnapshot=record.frozen;record.phase='before_migrations';await saveState(settings,state);
    record.migrations=await applyMigrations(settings.dbPath,files,join(current.path,'migrations'),meta.version);migrated=databaseAhead||record.migrations.applied.length>0;record.databaseChangedForPrevious=migrated;record.phase='migrated';await saveState(settings,state);
    await switchCurrent(settings,meta.version);switched=true;record.phase='switched';await saveState(settings,state);
    await settings.ops.startService(targetPath);
    if(!await settings.ops.healthCheck(targetPath))throw Error('New version health check failed');
    state.sequence=record.sequence;record.phase='healthy';state.releases[meta.version]=record;state.current=meta.version;state.previous=current.version;await prune(settings,state);
    state.pending=null;state.events.push({at:new Date().toISOString(),action:'update',version:meta.version});await saveState(settings,state);let maintenanceKept=wasMaintenance;try{await clearMaintenance(settings,wasMaintenance);}catch{maintenanceKept=true;}
    return {ok:true,version:meta.version,previous:state.previous,migrations:record.migrations,onlineSnapshot:online.path,frozenSnapshot:record.frozen.path,maintenanceKept,retained:Object.values(state.releases).filter(x=>!x.pruned).map(x=>x.version)};
  }catch(error){
    if(entered&&current){
      migrated=migrated||record?.databaseChangedForPrevious||hasDatabaseChanges(settings,record?.version,record);
      let recovered=false;
      try{await settings.ops.stopService();if(switched)await switchCurrent(settings,current.version);await settings.ops.startService(current.path);recovered=await settings.ops.healthCheck(current.path);}catch{}
      if(recovered&&!migrated)await clearMaintenance(settings,wasMaintenance);
      let actual=current.version;try{actual=(await currentVersion(settings)).version;}catch{}
      if(state){state.current=actual;state.previous=state.releases[actual]?.previous||null;state.pending=actual===current.version?null:{...record,phase:'recovery_required'};state.lastFailure={...record,phase:'failed',databaseChanged:migrated,oldServiceHealthy:recovered,error:error.message};state.events.push({at:new Date().toISOString(),action:'update_failed',version:record?.version});await saveState(settings,state);}
      error.releaseResult={rolledBackTo:actual===current.version?current.version:null,actualVersion:actual,oldServiceHealthy:recovered,maintenanceKept:migrated||!recovered||wasMaintenance,databaseAutomaticallyRestored:false,restoreCommand:record?.rollbackSnapshot?.restoreCommand||null};
    }
    throw error;
  }finally{
    if(staging)await rm(staging,{recursive:true,force:true});
    if(createdTarget&&targetPath){let active;try{active=await realpath(settings.current);}catch{}if(active!==targetPath)await rm(targetPath,{recursive:true,force:true});}
    await unlock();
  }
}
export async function rollbackRelease(options){
  const settings=await prepareSettings(options),unlock=await exclusiveLock(join(settings.stateRoot,'operation.lock'));
  let current,state,wasMaintenance=false,target,changed=false;
  try{
    current=await currentVersion(settings);state=await readState(settings,current);const pending=state.pending;
    const targetVersion=pending?.previous||state.previous;if(!targetVersion||state.releases[targetVersion]?.pruned)throw Error('No retained previous version');
    target={version:targetVersion,path:join(settings.releases,targetVersion)};await stat(target.path);
    const targetMeta=await metadata(target.path,target.version),now=ledgerVersion(settings.dbPath),source=pending||state.releases[current.version];
    changed=hasDatabaseChanges(settings,source?.version,source)||(now!==null&&now>targetMeta.maxMigration);
    wasMaintenance=pending?pending.wasMaintenance:await exists(settings.maintenanceFlag);
    await maintenance(settings);await settings.ops.stopService();await noWriter(settings);await switchCurrent(settings,target.version);await settings.ops.startService(target.path);
    if(!await settings.ops.healthCheck(target.path))throw Error('Previous version health check failed; maintenance remains');
    state.current=target.version;state.previous=state.releases[target.version]?.previous||null;state.pending=null;state.events.push({at:new Date().toISOString(),action:'rollback',version:target.version,databaseChanged:changed});await saveState(settings,state);
    let maintenanceKept=changed||wasMaintenance;if(!changed)try{await clearMaintenance(settings,wasMaintenance);}catch{maintenanceKept=true;}
    const recovery=changed?await compatibleSnapshot({...state,lastFailure:source},targetMeta.maxMigration):null;
    return {ok:true,version:target.version,previous:state.previous,databaseAutomaticallyRestored:false,databaseReviewRequired:changed,maintenanceKept,restoreCommand:recovery?.restoreCommand||null};
  }catch(error){if(target){try{await settings.ops.stopService();await switchCurrent(settings,current.version);await settings.ops.startService(current.path);}catch{}}throw error;}
  finally{await unlock();}
}
