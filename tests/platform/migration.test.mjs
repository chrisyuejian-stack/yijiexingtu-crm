import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileFixture,MemoryCos} from './helpers.mjs';
import {splitSql,sqlValue,quoteIdentifier} from '../../platform/sql.mjs';
import {verifyDatabase,rowCounts,countSql} from '../../platform/verify.mjs';
import {exportToD1} from '../../deploy/export-to-d1.mjs';
import {importD1} from '../../deploy/import-d1.mjs';
import {CosR2} from '../../platform/r2-cos.mjs';
import {fileSnapshot} from '../../deploy/snapshot.mjs';
import {restoreFileSnapshot} from '../../deploy/restore-file-snapshot.mjs';
import {checkBackup} from '../../deploy/check-backup.mjs';
test('PLAT dump lexer handles quoted semicolons/comments/CASE trigger and rejects unfinished SQL',()=>{
 const sql=`-- comment ;\nCREATE TABLE t(id,text);INSERT INTO t VALUES(1,'a;''b');CREATE TRIGGER tr BEFORE INSERT ON t BEGIN SELECT CASE WHEN new.id<0 THEN RAISE(ABORT,'bad;') ELSE 1 END; END;`;
 assert.equal(splitSql(sql).length,3);assert.throws(()=>splitSql("INSERT INTO t VALUES('bad);"),/Incomplete/);assert.equal(sqlValue("a'\0b"),"CAST(X'61270062' AS TEXT)");
});
test('PLAT full D1 export/import preserves every table row, encrypted fields and triggers; skips _cf_',async()=>{
 const f=await fileFixture();try{
  const dump=join(f.directory,'d1.sql'),next=join(f.directory,'new.sqlite');const old=new DatabaseSync(f.path,{readOnly:true});let counts,contents;try{counts=rowCounts(old);contents=Object.fromEntries(Object.keys(counts).map(name=>[name,old.prepare('SELECT * FROM '+quoteIdentifier(name)).all().map(x=>JSON.stringify(x)).sort()]));}finally{old.close();}
  await exportToD1(f.path,dump);const data=await readFile(dump,'utf8');await writeFile(dump,'BEGIN TRANSACTION;\nCREATE TABLE _cf_KV(k TEXT);INSERT INTO _cf_KV VALUES(\'internal\');\n'+data+'COMMIT;\n');const result=await importD1(dump,next);assert.equal(result.integrity,'ok');const db=new DatabaseSync(next,{readOnly:true});try{assert.deepEqual(rowCounts(db),counts);for(const name of Object.keys(counts))assert.deepEqual(db.prepare('SELECT * FROM '+quoteIdentifier(name)).all().map(x=>JSON.stringify(x)).sort(),contents[name],name);assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='view'").get().n,4);assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='_cf_KV'").get().n,0);assert.ok(db.prepare("SELECT sql FROM sqlite_master WHERE name='tenant_revoke'").get().sql.includes('slug'));assert.ok(db.prepare(countSql(Object.keys(counts))).all().length>100);}finally{db.close();}
  const verified=await verifyDatabase(next,f.config.vars.FIELD_KEY,{expectedCounts:counts});assert.equal(verified.ok,true);assert.ok(verified.decryption.passed>=2);assert.equal(verified.decryption.failed,0);const wrong=await verifyDatabase(next,Buffer.alloc(32).toString('base64'),{expectedCounts:counts});assert.equal(wrong.ok,false);assert.ok(wrong.decryption.failed>0);await assert.rejects(importD1(dump,next),/already exists/);assert.equal((await stat(next)).mode&0o777,0o600);
 }finally{await f.close();}
});
test('PLAT invalid import rolls back and never publishes partial output, foreign-key violation rejected',async()=>{
 const f=await fileFixture();try{
  const path=join(f.directory,'bad.sql'),out=join(f.directory,'bad.sqlite');await writeFile(path,'CREATE TABLE tenants(id PRIMARY KEY);CREATE TABLE child(id REFERENCES tenants(id));INSERT INTO child VALUES(99);');await assert.rejects(importD1(path,out),/foreign keys/);await assert.rejects(stat(out),e=>e.code==='ENOENT');await writeFile(path,"CREATE TABLE tenants(id);ATTACH DATABASE '/tmp/not-allowed' AS x;");await assert.rejects(importD1(path,out),/Unsupported/);
 }finally{await f.close();}
});
test('PLAT post-write rollback SQL replaces rows without firing business triggers and restores exact trigger DDL',async()=>{
 const f=await fileFixture();try{
  const dump=join(f.directory,'rollback.sql');await exportToD1(f.path,dump,{replaceExisting:true});const db=new DatabaseSync(f.path,{enableForeignKeyConstraints:true});try{const before=rowCounts(db),triggers=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();db.exec('BEGIN IMMEDIATE');db.exec(await readFile(dump,'utf8'));db.exec('COMMIT');assert.deepEqual(rowCounts(db),before);assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all(),triggers);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}
 }finally{await f.close();}
});
test('PLAT WAL-safe file snapshot compress/encrypt/upload then restore; wrong key rejects and old snapshots retained 14 days',async()=>{
 const f=await fileFixture();try{
  const sdk=new MemoryCos(),bucket=new CosR2(sdk,{bucket:'backup-123',region:'ap-shanghai'});await bucket.put('files/old','old');sdk.objects.get('backup-123/files/old').at=new Date(Date.now()-15*86400000);
  const result=await fileSnapshot(f.config,bucket);assert.equal(result.encrypted,true);assert.equal(await bucket.head('files/old'),null);const obj=await bucket.get(result.key),path=join(f.directory,'snap.enc');await writeFile(path,new Uint8Array(await obj.arrayBuffer()));assert.ok((await readFile(path)).subarray(0,6).equals(Buffer.from('YXTFS1')));
  await restoreFileSnapshot(path,join(f.directory,'restored.sqlite'),f.config.vars.BACKUP_KEY);const a=new DatabaseSync(f.path,{readOnly:true}),b=new DatabaseSync(join(f.directory,'restored.sqlite'),{readOnly:true});try{assert.deepEqual(rowCounts(a),rowCounts(b));}finally{a.close();b.close();}
  await assert.rejects(restoreFileSnapshot(path,join(f.directory,'wrong.sqlite'),Buffer.alloc(32).toString('base64')));await assert.rejects(stat(join(f.directory,'wrong.sqlite')),e=>e.code==='ENOENT');
 }finally{await f.close();}
});
test('PLAT backup monitoring uses actual completed status and 26-hour boundary',async()=>{
 const f=await fileFixture();try{assert.equal(checkBackup(f.path).ok,false);const db=new DatabaseSync(f.path);try{db.prepare("INSERT INTO backup_runs VALUES('monitor',?,'completed','ok')").run(Date.now());}finally{db.close();}assert.equal(checkBackup(f.path).ok,true);assert.equal(checkBackup(f.path,Date.now()+27*3600000).ok,false);}finally{await f.close();}
});
