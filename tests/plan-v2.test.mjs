import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {school,call,ok,filled,course,accountToken,parent,golden} from './fixtures-plans.mjs';
import {blankV2,convertV1,reverseInitialV2,canonical} from '../src/server/plan-v2-convert.js';
import {computeV2} from '../src/server/plan-v2-math.js';
import {shiftV2,shiftDate} from '../src/server/plan-v2-dates.js';
import {backupTables} from '../src/server/backup-model.js';
import {writeDoc,manualDoc,createV2} from './fixtures-v2.mjs';
const save=async(s,p,doc=writeDoc(p),extra={})=>ok(await call(s,'plans/'+p.id,'PUT',{version:p.version,doc,...extra}));
const send=async(s,p)=>ok(await call(s,'plans/'+p.id+'/send','POST',{version:p.version,acknowledgements:{manual_pricing:true}}));

test('V05 v2独立自由阶段/课程/老师保存，服务器生成全篇稳定ID，未知金额不是零',()=>school(async s=>{
 const d=manualDoc(s,null,true);d.modules.teachers.groups=[{id:'tmp_tg',role:'拟任导师',members:[{id:'tmp_teacher',teacher_id:null,name:'自填老师',title:'课程指导',introduction:'根据学习进度调整练习。',photo_image_id:null,proposed:true}]}];
 const before=s.f.db.raw.prepare('SELECT COUNT(*) n FROM teachers WHERE tenant_id=?').get(s.t.id).n,p=await createV2(s,d);
 assert.equal(p.doc_version,2);assert.equal(p.computed.total.amount,null);assert.equal(p.computed.total.known_amount,0);assert.equal(p.computed.total.has_tbd,true);assert.equal(p.modules.courses.lines[0].price_tbd,true);assert.equal(p.modules.teachers.groups[0].members[0].name,'自填老师');assert.equal(s.f.db.raw.prepare('SELECT COUNT(*) n FROM teachers WHERE tenant_id=?').get(s.t.id).n,before);assert.ok(p.id_map.tmp_stage.startsWith('stk_'));assert.ok(p.id_map.tmp_teacher.startsWith('tm_'));assert.equal(p.modules.courses.lines[0].stage_key,p.id_map.tmp_stage);
}));
test('V05 手填价格确定计价、伪造computed/快照被忽略，半分向上',()=>school(async s=>{
 const d=manualDoc(s,300.01);d.modules.courses.lines[0].qty.units=1.5;d.computed={total:{amount:0,complete:true,has_tbd:false}};d.modules.courses.lines[0].snapshot={pricing:{amount_cents:1}};const p=await createV2(s,d);assert.equal(p.computed.total.amount,450.02);assert.equal(p.modules.courses.lines[0].snapshot.pricing.amount_cents,30001);
}));
test('V05 普通未报价只能草稿；主动另议可发送导出；无论当前工作稿如何，未定价旧发送版不能签约',()=>school(async s=>{
 let p=await createV2(s,manualDoc(s,null));assert.equal(p.computed.total.has_tbd,false);ok(await call(s,'plans/'+p.id+'/send','POST',{acknowledgements:{manual_pricing:true}}),422);ok(await call(s,'plans/'+p.id+'/export','POST',{acknowledgements:{manual_pricing:true}}),422);
 let d=writeDoc(p);d.modules.courses.lines[0].price_tbd=true;p=await save(s,p,d);p=await send(s,p);const old=p.sent_revision_id;
 const out=ok(await call(s,'plans/'+p.id+'/export','POST',{acknowledgements:{manual_pricing:true}}));assert.equal(out.render_data.computed.total.has_tbd,true);assert.equal(out.render_data.computed.total.amount,null);
 ok(await call(s,'plans/'+p.id+'/sign','POST',{version:p.version}),422);
 d=writeDoc(p);d.modules.courses.lines[0].manual_unit_price=200;p=await save(s,p,d);assert.equal(p.computed.total.amount,400);assert.equal(p.computed.total.has_tbd,false);ok(await call(s,'plans/'+p.id+'/sign','POST',{version:p.version,revision_id:old}),422);p=await send(s,p);p=ok(await call(s,'plans/'+p.id+'/sign','POST',{version:p.version}));assert.equal(p.status,'signed');
}));
test('V05 已知部分+另议不伪造总价/优惠/分期，optional另议不影响应付',()=>school(async s=>{
 const d=manualDoc(s,100);d.modules.courses.lines.push({...structuredClone(d.modules.courses.lines[0]),line_id:'tmp_tbd',manual_unit_price:null,price_tbd:true});let p=await createV2(s,d);assert.deepEqual([p.computed.total.amount,p.computed.total.known_amount,p.computed.total.has_tbd,p.computed.total.complete],[null,200,true,false]);assert.deepEqual(p.computed.installments,[]);
 const x=writeDoc(p);x.modules.courses.lines[1].optional=true;p=await save(s,p,x);assert.equal(p.computed.total.amount,200);assert.equal(p.computed.total.has_tbd,true);assert.equal(p.computed.optional_fees[0].price_text,'另议');const sent=await send(s,p);ok(await call(s,'plans/'+p.id+'/sign','POST',{version:sent.version}),422);
}));
test('V05 pending阶段不泄漏草案课与试算，隐藏不影响已知课程计价',()=>school(async s=>{
 const d=manualDoc(s,100);d.modules.courses.stage_settings=[{stage_key:'tmp_stage',pending:true,pending_note:'下一阶段课程另定'}];let p=await createV2(s,d);assert.equal(p.computed.total.amount,null);assert.equal(p.computed.total.known_amount,0);assert.equal(p.computed.stages[0].draft_amount,200);p=await send(s,p);const render=ok(await call(s,'plans/'+p.id+'/export','POST',{acknowledgements:{manual_pricing:true}})).render_data;assert.equal(render.modules.courses.lines.length,0);assert.equal(render.computed.lines.length,0);assert.equal(render.computed.stages[0].draft_amount,undefined);
 const x=writeDoc(p);x.modules.courses.stage_settings=[];x.modules.courses.visible=false;p=await save(s,p,x);assert.equal(p.computed.total.amount,200);
}));
test('V05 阶段附加/其他费/固定优惠/比例优惠及三种分期按分计算',()=>school(async s=>{
 const d=manualDoc(s,300.01);d.modules.courses.lines[0].qty.units=1;d.modules.fees.stage_extras=[{id:'tmp_extra',stage_key:'tmp_stage',label:'材料',amount:100,note:''}];d.modules.fees.other_fees=[{id:'tmp_other',label:'支持',amount:50,note:''}];d.modules.fees.discount={type:'fixed',amount:150,rate_bps:null,note:''};d.modules.fees.installments='custom';d.modules.fees.custom=[{stage_key:null,label:'首期',due:null,ratio_bps:5000},{stage_key:null,label:'余款',due:null,ratio_bps:5000}];let p=await createV2(s,d);assert.equal(p.computed.total.amount,300.01);assert.deepEqual(p.computed.installments.map(x=>x.amount),[150.01,150]);
 let x=writeDoc(p);x.modules.fees.discount={type:'percent',amount:null,rate_bps:1000,note:''};p=await save(s,p,x);assert.equal(p.computed.total.amount,405.01);x=writeDoc(p);x.modules.fees.installments='fixed';x.modules.fees.custom=[];x.modules.fees.fixed=[{id:'tmp_payment',stage_key:null,label:'付款',due:null,amount:405}];p=await save(s,p,x);assert.equal(p.computed.installment_status,'unbalanced');ok(await call(s,'plans/'+p.id+'/send','POST',{acknowledgements:{manual_pricing:true}}),422);
}));
test('V05 价格另议仅manual，单价默认空不自动选择另议，业务和稳定引用校验不可绕过',()=>school(async s=>{
 const c=await course(s),d=manualDoc(s);d.modules.courses.lines[0]={line_id:'tmp_line',stage_key:'tmp_stage',group_id:null,pricing_source:'catalog',course_id:c.id,qty:{units:1},price_tbd:true};ok(await call(s,'plans','POST',{doc:d,expected_price_list_rev:(await s.r.planWorkspace()).price_list_rev}),422);
 const bad=manualDoc(s);bad.modules.courses.lines[0].stage_key='stk_other';ok(await call(s,'plans','POST',{doc:bad}),422);const missing=manualDoc(s);delete missing.modules.timeline;ok(await call(s,'plans','POST',{doc:missing}),422);
}));
test('V05 库价新行必须确认rev；旧快照不随改价漂移；manual不能reprice',()=>school(async s=>{
 const c=await course(s,'钢琴V2',300.01),d=manualDoc(s);d.modules.courses.lines[0]={line_id:'tmp_line',stage_key:'tmp_stage',group_id:null,pricing_source:'catalog',course_id:c.id,qty:{units:1},manual_unit_price:1,snapshot:{pricing:{amount_cents:1}}};const rev=(await s.r.planWorkspace()).price_list_rev;
 ok(await call(s,'plans','POST',{doc:d}),422);const changed=await call(s,'plans','POST',{doc:d,expected_price_list_rev:rev-1});assert.equal(changed.status,409);assert.equal(changed.body.error,'price_changed');assert.equal(changed.body.details.computed.total.amount,300.01);
 let p=ok(await call(s,'plans','POST',{doc:d,expected_price_list_rev:rev}),201);await course(s,'钢琴V2',500);p=await save(s,p);assert.equal(p.computed.total.amount,300.01);const m=await createV2(s);ok(await call(s,'plans/'+m.id+'/reprice?line_ids='+m.modules.courses.lines[0].line_id),422);
}));
test('V05 v1读取转换零写入、ID稳定、旧发送修订和分享按v1，首次保存才记转换',()=>school(async s=>{
 let p=await filled(s,{amount:300.01,qty:1});const first=await s.r.planGet(p.id),before=canonical(first);const a=ok(await call(s,'plans/'+p.id)),b=ok(await call(s,'plans/'+p.id));assert.equal(a.doc_version,2);assert.equal(a.stored_doc_version,1);assert.equal(a.converted_from,1);assert.equal(canonical(await s.r.planGet(p.id)),before);assert.equal(a.modules.courses.groups[0].id,b.modules.courses.groups[0].id);assert.equal(s.f.db.raw.prepare('SELECT COUNT(*) n FROM plan_v2_conversions').get().n,0);
 p=await save(s,a);assert.equal(p.doc_version,2);assert.equal(s.f.db.raw.prepare('SELECT COUNT(*) n FROM plan_v2_conversions WHERE tenant_id=? AND plan_id=?').get(s.t.id,p.id).n,1);const old=await s.r.planRevision(p.id,first.current_revision_id);assert.equal(old.doc_json,first.doc_json);ok(await call(s,'plans/'+p.id,'PUT',{version:p.version,title:'旧请求'}),409);
}));
test('V05 v1五种计价/optional转换可逆且未知教学课时不会改变报价',async()=>{
 const rows=JSON.parse(await readFile('docs/v05/examples/legacy-billing-vectors.json','utf8')),source=JSON.parse(await readFile('docs/v05/examples/legacy-source-v1.json','utf8'));
 for(const row of rows){const d=structuredClone(source);d.modules.courses.lines[0].snapshot=row.snapshot;d.modules.courses.lines[0].qty=row.qty;delete d.computed;const v2=convertV1(d,{},{});assert.equal(v2.computed.total.amount,row.expected.total.amount);assert.deepEqual(v2.computed.installments,row.expected.installments);assert.equal(canonical(reverseInitialV2(v2,d,{},{})),canonical(d));v2.title+='修改';assert.throws(()=>reverseInitialV2(v2,d,{},{}),e=>e.code==='legacy_conversion_failed');}
});
test('V05 日级旧日期保留；平移预览不落库，确认保存不二次平移；月末夹日',()=>school(async s=>{
 let p=await filled(s),d={...p,modules:structuredClone(p.modules)};d.modules.path.stages[0].start='2027-01-17';d.modules.path.stages[0].end='2027-03-16';p=ok(await call(s,'plans/'+p.id,'PUT',d));const before=(await s.r.planGet(p.id)).doc_json,preview=ok(await call(s,'plans/'+p.id+'/shift-dates/preview','POST',{version:p.version,months:1}));assert.deepEqual(preview.doc.modules.path.stages[0].legacy_range,{start:'2027-02-17',end:'2027-04-16'});assert.equal((await s.r.planGet(p.id)).doc_json,before);p=await save(s,p,writeDoc(preview.doc),preview.save_options);assert.equal(p.modules.path.stages[0].start_month,'2027-02');assert.deepEqual(p.modules.path.stages[0].legacy_range,{start:'2027-02-17',end:'2027-04-16'});assert.equal(shiftDate('2028-01-31',1),'2028-02-29');assert.equal(shiftDate('2027-03-31',-1),'2027-02-28');
}));
test('V05 员工原文单独加密保存/清空/乐观锁，不进业务修订；财务/家长不可读',()=>school(async s=>{
 const p=await createV2(s),raw='内部咨询原文，电话13912345678';const before=await s.r.planGet(p.id),saved=ok(await call(s,'plans/'+p.id+'/brief','PUT',{version:0,text:raw}));assert.equal(saved.brief.version,1);const encrypted=s.f.db.raw.prepare('SELECT text_enc FROM plan_briefs WHERE tenant_id=? AND plan_id=?').get(s.t.id,p.id).text_enc;assert.ok(!encrypted.includes(raw));assert.equal((await s.r.planGet(p.id)).doc_json,before.doc_json);assert.equal((await s.r.planGet(p.id)).version,before.version);assert.equal(ok(await call(s,'plans/'+p.id)).brief.text,raw);ok(await call(s,'plans/'+p.id+'/brief','PUT',{version:0,text:'覆盖'}),409);ok(await call(s,'plans/'+p.id+'/brief','PUT',{version:1,text:'字'.repeat(8001)}),422);
 const finance=await accountToken(s,['finance']),pa=await parent(s);ok(await call(s,'plans/'+p.id+'/brief','GET',undefined,finance.token),403);ok(await call(s,'plans/'+p.id+'/brief','GET',undefined,pa.token),403);assert.equal(ok(await call(s,'plans/'+p.id,'GET',undefined,finance.token)).brief,undefined);assert.equal(ok(await call(s,'plans/'+p.id+'/brief','PUT',{version:1,text:''})).brief.text,'');assert.equal(backupTables.plan_briefs.columns.includes('text_enc'),true);
}));
test('V05 参考标记固定修订、独立锁与版本，旧记录不改，财务无模板能力',()=>school(async s=>{
 const p=await createV2(s),before=await s.r.planGet(p.id);let ref=ok(await call(s,'plans/'+p.id+'/reference','PUT',{version:p.version,reference_version:0,enabled:true})).reference;assert.equal(ref.revision_id,p.current_revision_id);assert.equal((await s.r.planGet(p.id)).version,before.version);assert.equal((await s.r.planGet(p.id)).doc_json,before.doc_json);ok(await call(s,'plans/'+p.id+'/reference','PUT',{version:p.version,reference_version:0,enabled:false}),409);assert.equal(ok(await call(s,'plans/'+p.id)).reference.enabled,true);const f=await accountToken(s,['finance']);ok(await call(s,'plan-templates','GET',undefined,f.token),403);assert.equal(ok(await call(s,'me','GET',undefined,f.token)).capabilities.plan_templates.read,false);
}));
test('V05 私有原文/机构ID不能混入doc；模块排序和未知字段严格拒绝；金额超限拒绝',()=>school(async s=>{
 const d=manualDoc(s);d.brief={text:'私密'};ok(await call(s,'plans','POST',{doc:d}),422);delete d.brief;d.tenant_id='other';ok(await call(s,'plans','POST',{doc:d}),422);delete d.tenant_id;d.module_order[0]='fees';ok(await call(s,'plans','POST',{doc:d}),422);d.module_order=blankV2().module_order;d.modules.courses.lines[0].manual_unit_price=100000001;ok(await call(s,'plans','POST',{doc:d}),422);
}));
