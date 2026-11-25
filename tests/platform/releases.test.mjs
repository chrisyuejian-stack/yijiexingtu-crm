import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,readFile,writeFile,rm,symlink,realpath,readdir,unlink,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {fileFixture,MemoryCos,http} from './helpers.mjs';
import {createReleasePackage,extractRelease,hashBytes} from '../../deploy/release-package.mjs';
import {encodeZip,decodeZip} from '../../deploy/zip.mjs';
import {updateRelease,rollbackRelease} from '../../deploy/release-manager.mjs';
import {restoreUpdateSnapshot} from '../../deploy/restore-update-db.mjs';
const count=(path,sql,...args)=>{const db=new DatabaseSync(path,{readOnly:true});try{return db.prepare(sql).get(...args);}finally{db.close();}};
const mutate=(path,sql,...args)=>{const db=new DatabaseSync(path,{enableForeignKeyConstraints:true});try{return db.prepare(sql).run(...args);}finally{db.close();}};
async function harness(fn,{legacy=false}={}){
 const f=await fileFixture(),source=join(f.directory,'source'),appRoot=join(f.directory,'app');await mkdir(source);await mkdir(join(appRoot,'releases'),{recursive:true});
 try{
  const filter=path=>!path.split('/').some(x=>['node_modules','packages','verification'].includes(x));
  for(const dir of ['platform','migrations','deploy','dist','backup-dist'])await cp(resolve(dir),join(source,dir),{recursive:true,filter});
  for(const file of ['server.mjs','package.json'])await cp(resolve(file),join(source,file));
  const bundle=async(version,extras=[])=>{
   for(const entry of await readdir(join(source,'migrations')))if(Number(entry.slice(0,4))>28)await unlink(join(source,'migrations',entry));
   for(const [name,sql] of extras)await writeFile(join(source,'migrations',name),sql);
   const output=join(f.directory,version+'.zip');await createReleasePackage(source,output,{version});return output;
  };
  const initial='0.5.0-base',base=join(appRoot,'releases',initial);await extractRelease(await bundle(initial),base);if(legacy)await unlink(join(base,'release.json'));await symlink(base,join(appRoot,'current'));
  const calls=[];let failVersion=null,beforeStop=null;
  const ops={async prepareDependencies(dir){calls.push(['dependencies',dir]);},async stopService(){calls.push(['stop']);if(beforeStop){const hook=beforeStop;beforeStop=null;await hook();}},async startService(dir){calls.push(['start',dir]);},async healthCheck(dir){calls.push(['health',dir]);return !dir.endsWith('/'+failVersion);}};
  const settings={appRoot,dataRoot:join(f.directory,'data'),dbPath:f.path,maintenanceFlag:join(f.directory,'etc/maintenance.flag'),ops};
  await fn({f,source,appRoot,base,initial,bundle,settings,calls,ops,failVersion:value=>failVersion=value,beforeStop:hook=>beforeStop=hook,current:()=>realpath(join(appRoot,'current')),state:async()=>JSON.parse(await readFile(join(settings.dataRoot,'deploy/state.json'),'utf8'))});
 }finally{await f.close();}
}
test('PLAT release format has only runtime payload, all hashes verified, no source/tests/dependency installation',()=>harness(async h=>{
 const archive=await h.bundle('0.5.1-package'),entries=decodeZip(await readFile(archive));assert.ok(entries.some(x=>x.name==='SHA256SUMS'));assert.ok(entries.some(x=>x.name==='deploy/npm/package-lock.json'));assert.ok(!entries.some(x=>/^(?:src|scripts|tests)\//.test(x.name)));assert.ok(!entries.some(x=>x.name.includes('/node_modules/')));
 const output=join(h.f.directory,'extract');const meta=await extractRelease(archive,output);assert.equal(meta.version,'0.5.1-package');assert.equal(meta.maxMigration,28);assert.equal(meta.artifacts['dist/_worker.js'],(await readFile('SHA256SUMS.txt','utf8')).match(/^([a-f0-9]{64})  dist\/_worker\.js$/m)?.[1]);
}));
test('PLAT release SHA/sidecar/path traversal tampering rejected before stopping or changing current',()=>harness(async h=>{
 const archive=await h.bundle('0.5.1-tamper'),entries=decodeZip(await readFile(archive));entries.find(x=>x.name==='server.mjs').data=Buffer.from('modified');await writeFile(archive,encodeZip(entries));await unlink(archive+'.sha256');await assert.rejects(updateRelease(archive,h.settings),/SHA256/);assert.equal(await h.current(),h.base);assert.equal(h.calls.length,0);
 const malicious=join(h.f.directory,'bad.zip');await writeFile(malicious,encodeZip([{name:'../escape',data:Buffer.from('x')}]));await assert.rejects(updateRelease(malicious,h.settings),/Unsafe/);assert.equal(await h.current(),h.base);
}));
test('PLAT first update recognizes ledgerless v0.5 and skips all 28 historical scripts without revoking sessions',()=>harness(async h=>{
 const before=count(h.f.path,'SELECT COUNT(*) n FROM sessions').n,result=await updateRelease(await h.bundle('0.5.1-first'),h.settings);assert.equal(result.migrations.bootstrapped,28);assert.deepEqual(result.migrations.applied,[]);assert.equal(count(h.f.path,'SELECT COUNT(*) n FROM schema_migrations').n,28);assert.equal(count(h.f.path,'SELECT COUNT(*) n FROM sessions').n,before);assert.equal(await h.current(),join(h.appRoot,'releases/0.5.1-first'));assert.equal(h.calls[0][0],'dependencies');await assert.rejects(stat(h.settings.maintenanceFlag),e=>e.code==='ENOENT');
},{legacy:true}));
test('PLAT online snapshot is taken before stop and frozen snapshot includes final in-flight writes',()=>harness(async h=>{
 const student=h.f.school.students[0];h.beforeStop(async()=>{
   const files=await readdir(join(h.settings.dataRoot,'release-snapshots'));assert.ok(files.some(x=>x.endsWith('-online.sqlite')));mutate(h.f.path,'UPDATE students SET notes=? WHERE id=?','in-flight completed',student);
 });
 const r=await updateRelease(await h.bundle('0.5.1-snapshots'),h.settings);assert.notEqual(count(r.onlineSnapshot,'SELECT notes FROM students WHERE id=?',student).notes,'in-flight completed');assert.equal(count(r.frozenSnapshot,'SELECT notes FROM students WHERE id=?',student).notes,'in-flight completed');assert.equal((await stat(r.frozenSnapshot)).mode&0o777,0o600);
}));
test('PLAT migration halfway failure rolls back EVERY pending migration and ledger, never switches version',()=>harness(async h=>{
 const archive=await h.bundle('0.5.1-sql-fail',[['0029_test_one.sql','CREATE TABLE update_one(id INTEGER); INSERT INTO update_one VALUES(1);\n'],['0030_test_two.sql','CREATE TABLE update_two(id INTEGER CHECK(id>0)); INSERT INTO update_two VALUES(-1);\n']]);
 await assert.rejects(updateRelease(archive,h.settings),/CHECK/);assert.equal(await h.current(),h.base);assert.equal(count(h.f.path,"SELECT COUNT(*) n FROM sqlite_master WHERE name IN('update_one','update_two','schema_migrations')").n,0);assert.equal((await h.state()).lastFailure.databaseChanged,false);await assert.rejects(stat(join(h.appRoot,'releases/0.5.1-sql-fail')),e=>e.code==='ENOENT');
}));
test('PLAT migrations execute once, ledger hashes immutable, changed historical migration rejected before downtime',()=>harness(async h=>{
 const extras=[['0029_once.sql','CREATE TABLE update_once(id INTEGER); INSERT INTO update_once VALUES(1);\n']];const first=await updateRelease(await h.bundle('0.5.1-once',extras),h.settings);assert.deepEqual(first.migrations.applied,[29]);const second=await updateRelease(await h.bundle('0.5.2-skip',extras),h.settings);assert.deepEqual(second.migrations.applied,[]);assert.equal(count(h.f.path,'SELECT COUNT(*) n FROM update_once').n,1);
 const before=h.calls.filter(x=>x[0]==='stop').length;await writeFile(join(h.source,'migrations/0001_foundation.sql'),await readFile(join(h.source,'migrations/0001_foundation.sql'),'utf8')+'\n-- changed\n');await assert.rejects(updateRelease(await h.bundle('0.5.3-mutated',extras),h.settings),/migration missing\/changed/);assert.equal(h.calls.filter(x=>x[0]==='stop').length,before);assert.equal((await h.state()).current,'0.5.2-skip');
}));
test('PLAT new health failure automatically switches back and restarts previous version, never restores DB',()=>harness(async h=>{
 const archive=await h.bundle('0.5.1-bad-health');h.failVersion('0.5.1-bad-health');await assert.rejects(updateRelease(archive,h.settings),error=>{assert.equal(error.releaseResult.rolledBackTo,h.initial);assert.equal(error.releaseResult.databaseAutomaticallyRestored,false);return /health/.test(error.message);});assert.equal(await h.current(),h.base);assert.ok(h.calls.some(x=>x[0]==='start'&&x[1]===h.base));assert.equal((await h.state()).current,h.initial);await assert.rejects(stat(h.settings.maintenanceFlag),e=>e.code==='ENOENT');
}));
test('PLAT health rollback after committed migrations preserves new rows and keeps maintenance with independent restore command',()=>harness(async h=>{
 const archive=await h.bundle('0.5.1-health-migration',[['0029_data.sql','CREATE TABLE new_data(id INTEGER); INSERT INTO new_data VALUES(7);\n']]);h.failVersion('0.5.1-health-migration');let failure;
 await assert.rejects(updateRelease(archive,h.settings),error=>{failure=error.releaseResult;return /health/.test(error.message);});assert.equal(await h.current(),h.base);assert.equal(failure.maintenanceKept,true);assert.match(failure.restoreCommand,/\.restore\.mjs.*--confirm-data-loss/);assert.equal(count(h.f.path,'SELECT id FROM new_data').id,7);assert.equal(count(h.f.path,'SELECT MAX(version) n FROM schema_migrations').n,29);assert.ok(await stat(h.settings.maintenanceFlag));
}));
test('PLAT rollback.sh core selects recorded predecessor; migration rollback only suggests snapshot and never overwrites new data',()=>harness(async h=>{
 await updateRelease(await h.bundle('0.5.1-migrated',[['0029_rows.sql','CREATE TABLE retained_data(id INTEGER); INSERT INTO retained_data VALUES(1);\n']]),h.settings);mutate(h.f.path,'INSERT INTO retained_data VALUES(2)');const result=await rollbackRelease(h.settings);assert.equal(result.version,h.initial);assert.equal(result.databaseReviewRequired,true);assert.equal(result.databaseAutomaticallyRestored,false);assert.equal(result.maintenanceKept,true);assert.equal(count(h.f.path,'SELECT COUNT(*) n FROM retained_data').n,2);assert.ok(result.restoreCommand);assert.equal(await h.current(),h.base);
}));
test('PLAT explicitly confirmed snapshot restore saves current DB first, restores atomically and remains in maintenance',()=>harness(async h=>{
 const result=await updateRelease(await h.bundle('0.5.1-restore',[['0029_extra.sql','CREATE TABLE after_update(id); INSERT INTO after_update VALUES(99);\n']]),h.settings);await assert.rejects(restoreUpdateSnapshot(result.frozenSnapshot),/confirm-data-loss/);assert.equal(count(h.f.path,'SELECT id FROM after_update').id,99);const restored=await restoreUpdateSnapshot(result.frozenSnapshot,{confirmed:true,stopService:async()=>{}});assert.equal(count(h.f.path,"SELECT COUNT(*) n FROM sqlite_master WHERE name='after_update'").n,0);assert.equal(count(restored.rescue,'SELECT id FROM after_update').id,99);assert.ok(await stat(h.settings.maintenanceFlag));
}));
test('PLAT retain five immutable versions, protect current and predecessor, duplicate version never deletes existing code',()=>harness(async h=>{
 for(let i=1;i<=6;i++)await updateRelease(await h.bundle('0.5.'+i+'-keep'),h.settings);const dirs=(await readdir(join(h.appRoot,'releases'))).filter(x=>!x.startsWith('.'));assert.equal(dirs.length,5);assert.ok(dirs.includes('0.5.6-keep')&&dirs.includes('0.5.5-keep'));const zip=join(h.f.directory,'0.5.5-keep.zip');await assert.rejects(updateRelease(zip,h.settings),/already exists/);assert.ok(await stat(join(h.appRoot,'releases/0.5.5-keep/server.mjs')));const r=await rollbackRelease(h.settings);assert.equal(r.version,'0.5.5-keep');assert.equal(r.previous,'0.5.4-keep');
}));
test('PLAT unknown untracked schema and transaction-owning migrations rejected without downtime',()=>harness(async h=>{
 mutate(h.f.path,'CREATE TABLE unknown_schema(id)');await assert.rejects(updateRelease(await h.bundle('0.5.1-unknown'),h.settings),/not the complete known/);assert.equal(h.calls.filter(x=>x[0]==='stop').length,0);mutate(h.f.path,'DROP TABLE unknown_schema');await assert.rejects(updateRelease(await h.bundle('0.5.2-own-tx',[['0029_tx.sql','BEGIN; CREATE TABLE bad_tx(id); COMMIT;\n']]),h.settings),/must not control/);assert.equal(await h.current(),h.base);
}));
test('PLAT actual packaged Node workers restart across current switch and keep existing authenticated sessions',()=>harness(async h=>{
 const sdk=new MemoryCos();let app;
 const start=async dir=>{
  const {startServer}=await import(pathToFileURL(join(dir,'server.mjs')).href);
  app=await startServer({config:{...h.f.config,distDir:join(dir,'dist'),backupPath:join(dir,'backup-dist/backup-worker.js')},port:0,sdkFactory:()=>sdk,log:()=>{},startScheduler:false});
 };
 try{
  await start(h.base);const path='/'+h.f.school.t.slug+'/api/me',headers={Cookie:'channel_session='+h.f.school.token};assert.equal((await http(app.server.address().port,path,{headers})).status,200);
  h.ops.stopService=async()=>{await app?.close();app=null;};h.ops.startService=start;h.ops.healthCheck=async()=>app&&(await http(app.server.address().port,'/login')).status===200;
  await updateRelease(await h.bundle('0.5.1-real-node'),h.settings);assert.equal((await http(app.server.address().port,path,{headers})).status,200);await rollbackRelease(h.settings);assert.equal((await http(app.server.address().port,path,{headers})).status,200);
 }finally{await app?.close();}
}));

test('PLAT retry after migration/health failure retains the original pre-migration recovery point',()=>harness(async h=>{
 const extras=[['0029_retry.sql','CREATE TABLE retry_data(id INTEGER); INSERT INTO retry_data VALUES(1);\n']];h.failVersion('0.5.1-failed');await assert.rejects(updateRelease(await h.bundle('0.5.1-failed',extras),h.settings),/health/);const original=(await h.state()).lastFailure.rollbackSnapshot;assert.equal(original.databaseVersion,28);
 h.failVersion(null);const retried=await updateRelease(await h.bundle('0.5.2-fixed',extras),h.settings);assert.deepEqual(retried.migrations.applied,[]);const rolled=await rollbackRelease(h.settings);assert.equal(rolled.databaseReviewRequired,true);assert.equal(rolled.restoreCommand,original.restoreCommand);assert.equal(count(h.f.path,'SELECT id FROM retry_data').id,1);
}));
