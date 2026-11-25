import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './support.mjs';
import {setup} from './fixtures-credit.mjs';
import {school,call,ok,filled,parent,course} from './fixtures-plans.mjs';
import {createV2,manualDoc,writeDoc} from './fixtures-v2.mjs';
import {model,ai} from './fixtures-ai.mjs';
import {repo} from '../src/server/repo.js';
import {backupManifest,open,backupPage} from '../src/server/backup.js';
import {manifest,upload,publish,ops} from './fixtures-platform.mjs';
const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw1kAAAAASUVORK5CYII=';
async function image(s,id,tags=[],consent=false){await s.r.settingsGalleryCreate({id,r2_key:'local/'+s.t.id+'/'+id,mime:'image/png',width:1600,height:1800,tags,consent},s.user);await s.f.env.CHANNEL_MEDIA.put('local/'+s.t.id+'/'+id,pixel);}
const app={subject:'music_interest',directions:[],grades:[],budget:{min:null,max:null,period:'unspecified'},target_types:[]};

test('V05INT v2家长/分享媒体按已发送版本授权，隐藏页与未引用图404，姓名/员工原文/单价不外泄',()=>school(async s=>{
 s.f.db.raw.prepare('UPDATE students SET parent_consent_media=0,nickname=? WHERE tenant_id=? AND id=?').run('展示同学',s.t.id,s.students[0]);
 for(const id of ['img_v2page','img_v2teacher','img_v2unused'])await image(s,id,['校区环境']);
 const d=manualDoc(s,null,true);d.title='学员0的方案';d.modules.basic.student_name='学员0';d.modules.photos={visible:true,pages:[{id:'tmp_photo',title:'环境',layout:'grid_2x3',image_ids:['img_v2page']}]};d.modules.teachers.groups=[{id:'tmp_faculty',role:'指导',members:[{id:'tmp_mentor',teacher_id:null,name:'人工导师',title:'',introduction:'根据实际情况安排。',photo_image_id:'img_v2teacher',proposed:true}]}];let p=await createV2(s,d);const pa=await parent(s);ok(await call(s,'plans/'+p.id+'/brief','PUT',{version:0,text:'员工内部原文禁止对外'}));p=ok(await call(s,'plans/'+p.id+'/send','POST',{version:p.version,acknowledgements:{manual_pricing:true}}));const link=ok(await call(s,'plans/'+p.id+'/share-links','POST',{}),201),token=link.url.split('/').at(-1),publicPath='/api/share/'+token;
 for(const response of [ok(await call(s,'parent/plans/'+p.id,'GET',undefined,pa.token)),ok(await call(s,publicPath,'GET',undefined,null))]){
  const raw=JSON.stringify(response);assert.equal(response.render_data.doc_version,2);assert.ok(!raw.includes('员工内部原文禁止对外'));assert.ok(!raw.includes('学员0'));assert.equal(response.render_data.student_id,undefined);assert.equal(response.render_data.modules.courses.lines[0].manual_unit_price,undefined);assert.equal(response.render_data.computed.total.has_tbd,true);assert.equal(response.render_data.computed.total.amount,null);assert.ok(response.render_data.modules.photos.pages[0].images[0].url);
 }
 for(const id of ['img_v2page','img_v2teacher']){assert.equal((await call(s,'parent/media/'+id,'GET',undefined,pa.token)).status,200);assert.equal((await call(s,publicPath+'/media/'+id,'GET',undefined,null)).status,200);}ok(await call(s,publicPath+'/media/img_v2unused','GET',undefined,null),404);
 const changed=writeDoc(p);changed.modules.photos.visible=false;p=ok(await call(s,'plans/'+p.id,'PUT',{version:p.version,doc:changed}));assert.equal((await call(s,publicPath+'/media/img_v2page','GET',undefined,null)).status,200);p=ok(await call(s,'plans/'+p.id+'/send','POST',{version:p.version,acknowledgements:{manual_pricing:true}}));ok(await call(s,'parent/media/img_v2page','GET',undefined,pa.token),404);assert.equal((await call(s,publicPath+'/media/img_v2page','GET',undefined,null)).status,200);
}));
test('V05INT v2重复/恢复保持旧历史，所有结构元素重新分配，原文不随复制',()=>school(async s=>{
 let p=await createV2(s);ok(await call(s,'plans/'+p.id+'/brief','PUT',{version:0,text:'原方案员工原文'}));const original=p.current_revision_id,copy=ok(await call(s,'plans/'+p.id+'/duplicate','POST',{title:'复制方案'}),201);assert.notEqual(copy.modules.path.stages[0].key,p.modules.path.stages[0].key);assert.notEqual(copy.modules.courses.lines[0].line_id,p.modules.courses.lines[0].line_id);assert.equal(ok(await call(s,'plans/'+copy.id+'/brief')).brief.text,'');
 let doc=writeDoc(p);doc.modules.assessment.text='修改后测评';p=ok(await call(s,'plans/'+p.id,'PUT',{version:p.version,doc}));p=ok(await call(s,'plans/'+p.id+'/revisions/'+original+'/restore','POST',{version:p.version}));assert.equal(p.doc_version,2);assert.equal(p.modules.assessment.text,'');assert.ok((await s.r.planRevision(p.id,original)).doc_json.includes('"doc_version":2'));assert.equal(ok(await call(s,'plans/'+p.id+'/brief')).brief.text,'原方案员工原文');
}));
test('V05INT 跨机构主资源/模板/稳定ID404，图库引用统一invalid_image，不能伪造快照或来源',()=>school(async s=>{
 const p=await createV2(s),other=await setup(s.f,2,'v2isolation');other.f=s.f;
 ok(await call(other,'plans/'+p.id),404);ok(await call(other,'plans/'+p.id+'/brief'),404);ok(await call(other,'plans/'+p.id+'/reference','PUT',{version:p.version,reference_version:0,enabled:true}),404);
 const foreign=manualDoc(other);foreign.modules.path.stages[0].key=p.modules.path.stages[0].key;foreign.modules.courses.lines[0].stage_key=p.modules.path.stages[0].key;ok(await call(other,'plans','POST',{doc:foreign}),404);
 const doc=manualDoc(s);doc.modules.photos={visible:true,pages:[{id:'tmp_img',title:'',layout:'grid_2x3',image_ids:['img_other']}]};const r=await call(s,'plans','POST',{doc});assert.equal(r.status,422);assert.equal(r.body.error,'invalid_image');assert.equal(s.f.db.raw.prepare('SELECT COUNT(*) n FROM plans WHERE tenant_id=?').get(s.t.id).n,1);
}));
test('V05INT 原文并发一成功一冲突，不改方案version；参考筛选只向有编辑权员工开放',()=>school(async s=>{
 const p=await createV2(s),rows=await Promise.all([call(s,'plans/'+p.id+'/brief','PUT',{version:0,text:'甲原文'}),call(s,'plans/'+p.id+'/brief','PUT',{version:0,text:'乙原文'})]);assert.deepEqual(rows.map(x=>x.status).sort(),[200,409]);assert.equal((await s.r.planGet(p.id)).version,p.version);assert.equal(rows.find(x=>x.status===409).body.details.latest.version,1);
 await createV2(s);ok(await call(s,'plans/'+p.id+'/reference','PUT',{version:p.version,reference_version:0,enabled:true}));const list=ok(await call(s,'plans?reference=true'));assert.equal(list.total,1);assert.equal(list.items[0].id,p.id);assert.equal(list.items[0].reference_enabled,true);assert.equal(ok(await call(s,'plans?reference=false')).total,1);
}));
test('V05INT 同幂等键并发只调用一次模型，不额外扣次', {timeout:10000},()=>school(async s=>{
 const p=await createV2(s),b=ok(await call(s,'plans/'+p.id+'/brief','PUT',{version:0,text:'巩固节奏'})),data={plan_id:p.id,doc_version:2,plan_version:p.version,brief_version:b.brief.version,scope:'auto'},key=crypto.randomUUID();let started,release;const ready=new Promise(r=>started=r),hold=new Promise(r=>release=r);model(s,async()=>{started();await hold;return {suggestions:[]};});const first=ai(s,'plan/brief',data,key);try{await ready;const second=await ai(s,'plan/brief',data,key);assert.equal(second.status,409);assert.equal(second.body.error,'in_progress');}finally{release();}ok(await first);assert.equal(s.modelCalls.length,1);assert.equal(ok(await call(s,'ai/usage')).fast.used,1);
}));
test('V05INT 完整加密备份实含六张新表，原文仍为字段密文；原CRM业务恢复范围不被扩大',()=>school(async s=>{
 let legacy=await filled(s),p=ok(await call(s,'plans/'+legacy.id));p=ok(await call(s,'plans/'+p.id,'PUT',{version:p.version,doc:writeDoc(p)}));ok(await call(s,'plans/'+p.id+'/brief','PUT',{version:0,text:'备份中的私有原文'}));ok(await call(s,'plans/'+p.id+'/reference','PUT',{version:p.version,reference_version:0,enabled:true}));const preview=ok(await call(s,'plans/'+p.id+'/template-preview','POST',{version:p.version}));ok(await call(s,'plan-templates','POST',{name:'备份模板',description:'',applicability:app,source:{plan_id:p.id,version:p.version},doc:preview.doc}),201);
 s.f.db.raw.prepare('INSERT INTO plan_sample_templates(tenant_id,pack_key,pack_version,sample_key,doc_json,created_at) VALUES(?,?,?,?,?,?)').run(s.t.id,'music_interest','0.5','backup_sample',JSON.stringify({key:'backup_sample',doc:preview.doc}),Date.now());
 const worker=process.env.TEST_BUNDLE==='1'?(await import('../backup-dist/backup-worker.js')).default:(await import('../src/server/backup.js')).default;
 await worker.scheduled({cron:'0 19 * * *',scheduledTime:Date.now()},s.f.env,{});const platform=repo(s.f.env,null),id=s.f.db.raw.prepare('SELECT id FROM backup_snapshots ORDER BY at DESC LIMIT 1').get().id;for(let i=0;i<30&&await platform.activeBackup();i++)await worker.scheduled({cron:'1 1 * * *',scheduledTime:Date.now()},s.f.env,{});assert.equal(await platform.activeBackup(),null);const data=await backupManifest(s.f.env,id);
 for(const name of ['plan_templates','plan_sample_templates','plan_reference_flags','plan_briefs','plan_v2_conversions','plan_v2_elements']){assert.ok(data.tables[name]>=1,name);const file=data.files.find(x=>x.table===name),raw=await s.f.env.CHANNEL_BACKUPS.get(file.key),page=await open(s.f.env,JSON.parse(await raw.text()),file.key);assert.ok(page.rows.length);if(name==='plan_briefs'){assert.ok(page.rows[0].text_enc.startsWith('v1.'));assert.equal(JSON.stringify(page.rows).includes('备份中的私有原文'),false);}}
 await assert.rejects(()=>backupPage(s.f.env,id,'plan_briefs',0,s.t.id),e=>e.status===404);assert.ok(![...s.f.env.CHANNEL_BACKUPS.objects.values()].join('').includes('备份中的私有原文'));
}));
test('V05INT 0028应用前后的所有旧表数据/DDL逐值一致，只增加表和索引约束',async()=>{
 const f=await fixture({migrateStorage:false});try{f.db.raw.exec(await readFile('migrations/0027_gallery_storage.sql','utf8'));const s=await setup(f,1,'v2migration');s.f=f;await filled(s);const db=f.db.raw,tables=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all(),before=Object.fromEntries(tables.map(x=>[x.name,db.prepare('SELECT * FROM '+x.name+' ORDER BY rowid').all()]));db.exec(await readFile('migrations/0028_plan_v2.sql','utf8'));for(const table of tables){assert.deepEqual(db.prepare('SELECT * FROM '+table.name+' ORDER BY rowid').all(),before[table.name],table.name);assert.equal(db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(table.name).sql,table.sql);}assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{f.restore();}
});
test('V05INT 新风格组件仅新增可选枚举；旧发布版本不被补写或改动',()=>school(async s=>{
 const before=s.f.db.raw.prepare("SELECT manifest_json FROM style_pack_versions WHERE pack_id='stp_folio' AND version='1.0.0'").get().manifest_json,m=manifest(s.f,'v05_components');Object.assign(m.components,{'plan.timeline':'rail','plan.goals':'cards','plan.photos':'grid_3x3'});const u=ok(await upload(s.f,m),201);ok(await publish(s.f,u));assert.equal(s.f.db.raw.prepare("SELECT manifest_json FROM style_pack_versions WHERE pack_id='stp_folio' AND version='1.0.0'").get().manifest_json,before);assert.equal(ok(await call(s,'styles/v05_components/versions/1.0.0')).manifest.components['plan.timeline'],'rail');
 m.id='v05_invalid';m.components['plan.timeline']='arbitrary-css';ok(await upload(s.f,m),422);
}));
