import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteD1} from '../../platform/d1-sqlite.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const withDb=async fn=>{const dir=await mkdtemp(join(tmpdir(),'yxt-d1-')),db=new SqliteD1(join(dir,'db.sqlite'));try{await fn(db);}finally{db.close();await rm(dir,{recursive:true,force:true});}};
test('PLAT D1 WAL/NORMAL/5000ms and foreign keys enforced',()=>withDb(async db=>{
 assert.equal(db.database.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.equal(db.database.prepare('PRAGMA journal_mode').get().journal_mode,'wal');assert.equal(db.database.prepare('PRAGMA synchronous').get().synchronous,1);assert.equal(db.database.prepare('PRAGMA busy_timeout').get().timeout,5000);
 await db.exec('CREATE TABLE p(id INTEGER PRIMARY KEY);CREATE TABLE c(id INTEGER REFERENCES p(id));');await assert.rejects(db.prepare('INSERT INTO c VALUES(?)').bind(99).run(),/FOREIGN KEY/);
}));
test('PLAT D1 run/batch meta.changes and last_row_id, missing updates remain zero',()=>withDb(async db=>{
 await db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY,v TEXT);');let x=await db.prepare('INSERT INTO t(v) VALUES(?)').bind('a').run();assert.equal(x.meta.changes,1);assert.equal(x.meta.last_row_id,1);
 const results=await db.batch([db.prepare('SELECT * FROM t'),db.prepare('UPDATE t SET v=? WHERE id=?').bind('b',1),db.prepare('UPDATE t SET v=? WHERE id=?').bind('c',99),db.prepare('PRAGMA defer_foreign_keys=ON')]);assert.deepEqual(results.map(x=>x.meta.changes),[0,1,0,0]);assert.equal(results[0].results[0].v,'a');assert.equal((await db.prepare('SELECT * FROM t').all()).meta.changes,0);
}));
test('PLAT D1 boolean/blob conversion, undefined rejection, first column and raw rows',()=>withDb(async db=>{
 await db.exec('CREATE TABLE t(id INTEGER,v BLOB);');await db.prepare('INSERT INTO t VALUES(?,?)').bind(true,new Uint8Array([1,2]).buffer).run();await db.prepare('INSERT INTO t VALUES(?,?)').bind(false,new Uint8Array([3])).run();assert.throws(()=>db.prepare('SELECT ?').bind(undefined),/undefined/);
 assert.equal(await db.prepare('SELECT id FROM t ORDER BY id DESC').first('id'),1);assert.equal(await db.prepare('SELECT * FROM t WHERE id=9').first(),null);assert.deepEqual((await db.prepare('SELECT id FROM t ORDER BY id').raw()),[[0],[1]]);assert.deepEqual((await db.prepare('SELECT id FROM t ORDER BY id').raw({columnNames:true})),[['id'],[0],[1]]);assert.deepEqual([...(await db.prepare('SELECT v FROM t WHERE id=1').first()).v],[1,2]);
}));
test('PLAT D1 failed batch rolls back every table and preserves original error',()=>withDb(async db=>{
 await db.exec('CREATE TABLE a(id INTEGER PRIMARY KEY);CREATE TABLE b(id INTEGER CHECK(id>0));');await assert.rejects(db.batch([db.prepare('INSERT INTO a VALUES(1)'),db.prepare('INSERT INTO b VALUES(2)'),db.prepare('INSERT INTO b VALUES(-1)')]),/CHECK/);assert.equal(await db.prepare('SELECT COUNT(*) n FROM a').first('n'),0);assert.equal(await db.prepare('SELECT COUNT(*) n FROM b').first('n'),0);
}));
test('PLAT D1 deferred foreign keys support child-before-parent and roll back commit failure',()=>withDb(async db=>{
 await db.exec('CREATE TABLE p(id INTEGER PRIMARY KEY);CREATE TABLE c(id INTEGER REFERENCES p(id));');await db.batch([db.prepare('PRAGMA defer_foreign_keys=ON'),db.prepare('INSERT INTO c VALUES(1)'),db.prepare('INSERT INTO p VALUES(1)')]);
 await assert.rejects(db.batch([db.prepare('PRAGMA defer_foreign_keys=ON'),db.prepare('INSERT INTO c VALUES(2)')]),/FOREIGN KEY/);assert.equal(await db.prepare('SELECT COUNT(*) n FROM c').first('n'),1);assert.equal(db.database.prepare('PRAGMA defer_foreign_keys').get().defer_foreign_keys,0);
}));
test('PLAT D1 same-process interleaved writes use actual affected counts',()=>withDb(async db=>{
 await db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY,v INTEGER);INSERT INTO t VALUES(1,1);');const values=await Promise.all([db.prepare('UPDATE t SET v=2 WHERE id=1 AND v=1').run(),db.prepare('UPDATE t SET v=3 WHERE id=1 AND v=1').run()]);assert.deepEqual(values.map(x=>x.meta.changes),[1,0]);
}));
