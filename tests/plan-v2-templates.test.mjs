import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {school,call,ok,course,accountToken,seed} from './fixtures-plans.mjs';
import {createV2,manualDoc,writeDoc} from './fixtures-v2.mjs';
import {ops} from './fixtures-platform.mjs';
import {validateSamplePlans} from '../src/server/plan-v2-samples.js';
import {setup} from './fixtures-credit.mjs';
import {backupTables} from '../src/server/backup-model.js';
const app={subject:'music_interest',directions:['钢琴'],grades:['初二'],budget:{min:10000,max:40000,period:'year'},target_types:['performance']};
async function template(s,p){const preview=ok(await call(s,'plans/'+p.id+'/template-preview','POST',{version:p.version}));return ok(await call(s,'plan-templates','POST',{name:'机构学习结构',description:'先基础再提升',applicability:app,source:{plan_id:p.id,version:p.version},doc:preview.doc}),201).template;}

test('V05TPL 任意本机构方案可存模板，预览零写入，身份原文/个体图片不进入模板',()=>school(async s=>{
 const d=manualDoc(s);d.title='学员0的学习方案';d.modules.basic.student_name='学员0';d.modules.basic.grade='初二';d.modules.assessment.text='学员0就读于隐私中学，电话13912345678，需巩固节奏。';const p=await createV2(s,d);ok(await call(s,'plans/'+p.id+'/brief','PUT',{version:0,text:'绝不可复制的员工原文'}));const preview=ok(await call(s,'plans/'+p.id+'/template-preview','POST',{version:p.version}));assert.equal(s.f.db.raw.prepare('SELECT COUNT(*) n FROM plan_templates').get().n,0);const raw=JSON.stringify(preview.doc);for(const word of ['学员0','隐私中学','13912345678','绝不可复制的员工原文'])assert.ok(!raw.includes(word));assert.equal(preview.doc.student_id,undefined);assert.equal(preview.doc.computed,undefined);assert.equal(preview.doc.modules.basic.plan_date,null);
 const t=await template(s,p);assert.equal(t.origin,'tenant');assert.equal(t.readonly,false);assert.equal(t.tenant_id,undefined);assert.equal(ok(await call(s,'plan-templates')).items[0].doc,undefined);assert.equal(ok(await call(s,'ai/usage')).fast.used,0);
}));
test('V05TPL 模板CRUD乐观锁与分页，删除不影响已创建方案，教师/财务无模板权限',()=>school(async s=>{
 const p=await createV2(s),t=await template(s,p);const edited=ok(await call(s,'plan-templates/'+t.id,'PUT',{version:t.version,name:'更新名称',description:t.description,applicability:app,doc:t.doc})).template;assert.equal(edited.version,2);const conflict=await call(s,'plan-templates/'+t.id,'PUT',{version:1,name:'覆盖',description:'',applicability:app,doc:t.doc});assert.equal(conflict.status,409);assert.equal(conflict.body.details.latest.version,2);assert.equal(ok(await call(s,'plan-templates?q=更新&origin=tenant&limit=1')).total,1);
 const f=await accountToken(s,['finance']);ok(await call(s,'plan-templates/'+t.id,'GET',undefined,f.token),403);ok(await call(s,'plan-templates/'+t.id,'DELETE',{version:2}));ok(await call(s,'plan-templates/'+t.id),404);assert.equal(ok(await call(s,'plans/'+p.id)).id,p.id);
}));
test('V05TPL 从模板开始清空身份并重分配所有元素ID，库课用现价，不复制员工原文/历史',()=>school(async s=>{
 const c=await course(s,'模板库价',100),d=manualDoc(s);d.modules.courses.lines[0]={line_id:'tmp_catalog',stage_key:'tmp_stage',group_id:null,pricing_source:'catalog',course_id:c.id,qty:{units:2}};const p=ok(await call(s,'plans','POST',{doc:d,expected_price_list_rev:(await s.r.planWorkspace()).price_list_rev}),201),t=await template(s,p);await course(s,'模板库价',300);
 const preview=ok(await call(s,'plan-templates/'+t.id+'/instantiate-preview','POST',{version:t.version,shift_months:1,pricing:'current'}));assert.equal(preview.doc.student_id,null);assert.equal(preview.doc.modules.basic.student_name,'');assert.ok(preview.doc.modules.path.stages[0].key.startsWith('tmp_'));assert.equal(preview.doc.modules.path.stages[0].start_month,'2027-02');assert.equal(preview.computed.total.amount,600);
 const next=writeDoc(preview.doc);next.student_id=s.students[1];next.modules.basic.student_name='另一个学员';const created=ok(await call(s,'plans','POST',{doc:next,template:{id:t.id,version:t.version,shift_months:1,pricing:'current'},expected_price_list_rev:preview.price_list_rev}),201);assert.notEqual(created.id,p.id);assert.notEqual(created.modules.path.stages[0].key,p.modules.path.stages[0].key);assert.notEqual(created.modules.courses.lines[0].line_id,p.modules.courses.lines[0].line_id);assert.equal(created.computed.total.amount,600);assert.equal(ok(await call(s,'plans/'+created.id+'/brief')).brief.text,'');assert.equal(ok(await call(s,'plans/'+p.id)).computed.total.amount,200);
}));
test('V05TPL 缺失/停用/无定价库课预览保留待处理，不静默转为自由课，保存仍校验',()=>school(async s=>{
 const c=await course(s,'将停用模板课',200),d=manualDoc(s);d.modules.courses.lines[0]={line_id:'tmp_catalog',stage_key:'tmp_stage',group_id:null,pricing_source:'catalog',course_id:c.id,qty:{units:2}};const p=ok(await call(s,'plans','POST',{doc:d,expected_price_list_rev:(await s.r.planWorkspace()).price_list_rev}),201),t=await template(s,p);const old=ok(await call(s,'settings/courses/'+c.id));ok(await call(s,'settings/courses/'+c.id,'PUT',{...old,version:old.version,active:false}));const preview=ok(await call(s,'plan-templates/'+t.id+'/instantiate-preview','POST',{version:1,shift_months:0,pricing:'current'}));assert.equal(preview.doc.modules.courses.lines[0].pricing_source,'catalog');assert.equal(preview.doc.modules.courses.lines[0].course_id,c.id);assert.equal(preview.computed.total.amount,null);assert.equal(preview.checks.blocking[0].code,'course_unavailable');const next=writeDoc(preview.doc);next.student_id=s.students[1];ok(await call(s,'plans','POST',{doc:next,expected_price_list_rev:preview.price_list_rev}),422);
}));
test('V05TPL 直接保存模板仍校验脱敏/本机构引用，不信任预览或客户端机构ID',()=>school(async s=>{
 const p=await createV2(s),t=await template(s,p);const bad=structuredClone(t.doc);bad.modules.assessment.text='联系13912345678';const r=await call(s,'plan-templates/'+t.id,'PUT',{version:1,name:t.name,description:'',applicability:app,doc:bad});assert.equal(r.status,422);assert.equal(r.body.error,'template_privacy_review_required');
 const foreign=await setup(s.f,2,'v2foreign');foreign.f=s.f;ok(await call(foreign,'plan-templates/'+t.id),404);ok(await call(foreign,'plans/'+p.id+'/template-preview','POST',{version:p.version}),404);
 const withImage=structuredClone(t.doc);withImage.style.cover_image_id='img_foreign';const image=await call(s,'plan-templates/'+t.id,'PUT',{version:1,name:t.name,description:'',applicability:app,doc:withImage});assert.equal(image.status,422);assert.equal(image.body.error,'invalid_image');
}));
test('V05TPL 平台可移植格式只收稳定key/本包引用，禁止机构ID/价格/个人信息，旧包无样例兼容',async()=>{
 const sample=JSON.parse(await readFile('docs/v05/examples/platform-sample.json','utf8')),content={courses:[{key:'piano_individual'}],stages:[]};assert.equal(validateSamplePlans([sample],content).length,1);assert.deepEqual(validateSamplePlans(undefined,content),[]);
 for(const change of [x=>x.doc.student_id='stu_wrong',x=>x.doc.modules.courses.lines[0].manual_unit_price=200,x=>x.doc.modules.courses.lines[0].course_key='unknown',x=>x.doc.modules.assessment.text='13912345678']){const x=structuredClone(sample);change(x);assert.throws(()=>validateSamplePlans([x],content),e=>e.status===422);}
});
test('V05TPL 平台发布样例随包事务映射本机构ID、只读、旧样例可读、再次导入不覆盖课程',()=>school(async s=>{
 const all=ok(await ops(s.f,'subject-packs')),old=all.items.find(x=>x.key==='music_interest').versions.find(x=>x.pack_version==='0.1'),sample=JSON.parse(await readFile('docs/v05/examples/platform-sample.json','utf8'));
 sample.doc.modules.courses.lines[0].course_key=old.content.courses[0].key;sample.doc.modules.fees.stage_extras=[];sample.doc.modules.fees.other_fees=[];
 const draft=ok(await ops(s.f,'subject-packs','POST',{key:old.key,name:old.name,pack_version:'0.5.0',content:{...old.content,sample_plans:[sample]}}),201);ok(await ops(s.f,'subject-packs/'+draft.key+'/versions/'+draft.pack_version+'/publish','POST',{version:draft.version}));
 ok(await call(s,'settings/subjects','POST',{key:'music_interest'}));const list=ok(await call(s,'plan-templates?origin=platform'));assert.equal(list.total,1);const t=ok(await call(s,'plan-templates/'+encodeURIComponent(list.items[0].id))).template;assert.equal(t.readonly,true);const mapped=t.doc.modules.courses.lines[0].course_id;assert.ok(mapped.startsWith('crs_'));assert.equal(t.doc.modules.courses.lines[0].snapshot,undefined);assert.equal(t.doc.modules.courses.lines[0].manual_unit_price,null);
 const reject=await call(s,'plan-templates/'+encodeURIComponent(t.id),'PUT',{version:t.version});assert.equal(reject.status,403);assert.equal(reject.body.error,'readonly_template');const before=await s.r.settingsGet('courses',mapped);ok(await call(s,'settings/subjects','POST',{key:'music_interest'}));assert.equal((await s.r.settingsGet('courses',mapped)).doc_json,before.doc_json);assert.equal(ok(await call(s,'plan-templates?origin=platform')).total,1);
}));
test('V05TPL 新表进入全量备份元数据，升级只新增表，旧plans结构未改变',()=>school(async s=>{
 const db=s.f.db.raw;assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);const columns=db.prepare('PRAGMA table_info(plans)').all().map(x=>x.name);assert.equal(columns.includes('doc_version'),false);assert.equal(columns.includes('reference_flag'),false);
 for(const name of ['plan_templates','plan_sample_templates','plan_reference_flags','plan_briefs','plan_v2_conversions','plan_v2_elements']){assert.ok(backupTables[name]);assert.deepEqual(db.prepare('PRAGMA table_info('+name+')').all().map(x=>x.name),backupTables[name].columns);}
}));
