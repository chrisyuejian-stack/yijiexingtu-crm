import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fixture} from './support.mjs';
import {setup} from './fixtures-credit.mjs';

test('YX4 0001–0020迁移与已验收阶段3逐字节一致',async()=>{
 const baseline=JSON.parse(await readFile('docs/reference/stage4-start-baseline-sha256.json','utf8'));
 const list=baseline.files.filter(x=>/^migrations\/00(?:0[1-9]|1\d|20)_/.test(x.path));assert.equal(list.length,20);for(const entry of list){const hash=createHash('sha256').update(await readFile(entry.path)).digest('hex');assert.equal(hash,entry.sha256,entry.path)}
});
test('YX4 0021可从已有阶段3数据升级，所有旧表内容原样保留',async()=>{
 const f=await fixture({migratePlans:false});try{const s=await setup(f,2,'upgrade4');await s.call('settings/subjects','POST',{key:'music_interest'});const db=f.db.raw,tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name);const before=Object.fromEntries(tables.map(name=>[name,db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));db.exec(await readFile('migrations/0021_course_plans.sql','utf8'));for(const name of tables)assert.deepEqual(db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all(),before[name],name);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('SELECT COUNT(*) n FROM style_pack_versions').get().n,3)}finally{f.restore()}
});
test('YX4 分享单条地址只支持DELETE，历史修订风格不因工作稿换包而失去读取',async()=>{
 const {school,filled,call,ok}=await import('./fixtures-plans.mjs');await school(async s=>{const p=await filled(s);ok(await call(s,'plans/'+p.id+'/share-links/not-owned','GET'),404);ok(await call(s,'plans/'+p.id+'/share-links/not-owned','POST',{}),404);const saved=ok(await call(s,'plans/'+p.id,'PUT',{...p,style:{...p.style,pack_id:'stp_stage',pack_version:'1.0.0'}}));assert.equal(saved.style.pack_id,'stp_stage');s.f.db.raw.prepare("UPDATE style_packs SET scope_all=0,active=0 WHERE id='stp_folio'").run();assert.equal(ok(await call(s,'styles/stp_folio/versions/1.0.0')).id,'stp_folio');});
});
test('YX4 风格ID、修订ID与骨架选项拒绝错误类型，避免数据库绑定异常',async()=>{
 const {school,filled,call,ok}=await import('./fixtures-plans.mjs');await school(async s=>{const p=await filled(s);for(const style of [{pack_id:{}},{pack_version:[]}])ok(await call(s,'plans/'+p.id,'PUT',{version:p.version,style}),422);for(const action of ['duplicate','export','sign'])ok(await call(s,'plans/'+p.id+'/'+action,'POST',{revision_id:[]}),422);for(const options of [null,[],{insert_holiday_camp:'true'}])ok(await call(s,'plans/'+p.id+'/skeleton','POST',{start_month:'2026-12',target:{node_key:'grade_exam',month:'2027-07'},options}),422);assert.equal(ok(await call(s,'plans/'+p.id)).version,p.version)});
});
