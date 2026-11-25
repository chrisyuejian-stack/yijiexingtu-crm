// Verify copyable deployment SQL against a local synthetic database only.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fixture} from '../tests/support.mjs';
const f=await fixture({migrateStorage:false});
try {
 const db=f.db.raw;db.exec(await readFile('migrations/0027_gallery_storage.sql','utf8'));
 const original=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
 const runReadOnly=async name=>{const source=await readFile('deployment/upgrade-0027-0028/'+name,'utf8');const results=[];for(const query of source.split(';').map(x=>x.trim()).filter(Boolean)){assert.match(query.replace(/^--[^\n]*\n/,''),/^(?:SELECT|PRAGMA)/);results.push(db.prepare(query).all());}return results;};
 const before=await runReadOnly('01_升级前只读检查.sql');assert.deepEqual(before[2],[]);
 for(let i=1;i<=10;i++)db.exec(await readFile(`deployment/upgrade-0027-0028/single-statements/${String(i).padStart(2,'0')}.sql`,'utf8'));
 for(const table of original)assert.equal(db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(table.name).sql,table.sql);
 const after=await runReadOnly('02_升级后只读检查.sql');assert.equal(after[0].filter(x=>x.type==='table').length,6);assert.equal(after[0].filter(x=>x.type==='index').length,2);assert.equal(after[0].filter(x=>x.type==='trigger').length,2);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(await readFile('migrations/0028_plan_v2.sql','utf8'),await readFile('deployment/upgrade-0027-0028/0028_plan_v2.sql','utf8'));
 await mkdir('docs/v05/verification',{recursive:true});await writeFile('docs/v05/verification/部署SQL核对.json',JSON.stringify({environment:'local simulated SQLite/D1',command:'node scripts/v05-deployment-check.mjs',statements_applied:10,original_tables_ddl_unchanged:original.length,new_tables:6,new_indexes:2,new_triggers:2,foreign_key_check:[],before,after},null,2)+'\n');
 console.log('PASS: 10 copyable SQL statements; 6 new tables; 2 indexes; 2 triggers; old DDL unchanged; all read-only checks executable.');
}finally{f.restore();}
