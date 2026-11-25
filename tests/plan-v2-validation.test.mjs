import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {school,call,ok,course,filled} from './fixtures-plans.mjs';
import {manualDoc,writeDoc,createV2} from './fixtures-v2.mjs';
import {ai,model} from './fixtures-ai.mjs';
import {applyCard} from '../src/server/plan-v2-cards.js';
import {budgetCandidate} from '../src/server/plan-v2-ai.js';
import {validateSamplePlans} from '../src/server/plan-v2-samples.js';

test('V05VAL 畸形集合/布尔/数量/缺失doc均返回422，不报500且业务不写',()=>school(async s=>{
 for(const mutate of [d=>d.modules.path.stages=[null],d=>d.modules.courses.lines[0].qty=null,d=>d.modules.basic.english_enabled='true',d=>d.modules.courses.lines[0].price_tbd='true',d=>d.modules.assessment.scores=[{id:'tmp_score',label:'节奏',value:'72',max:100}],d=>d.modules.path.stages='bad']){const d=manualDoc(s);mutate(d);ok(await call(s,'plans','POST',{doc:d}),422);}
 assert.equal(s.f.db.raw.prepare('SELECT COUNT(*) n FROM plans').get().n,0);
 const p=await createV2(s);for(const applied_cards of ['bad',[null]])ok(await call(s,'plans/'+p.id,'PUT',{version:p.version,doc:writeDoc(p),applied_cards}),422);ok(await call(s,'plans/'+p.id+'/quote-preview','POST',{version:p.version}),422);
 ok(await call(s,'plan-templates','POST',{name:'缺少文档',source:{plan_id:p.id,version:p.version}}),422);
}));
test('V05VAL 旧v1方案可直接生成模板，兼容省略text_mode_resolved的旧style',()=>school(async s=>{
 const p=await filled(s);assert.notEqual(p.doc_version,2);const preview=ok(await call(s,'plans/'+p.id+'/template-preview','POST',{version:p.version}));assert.equal(preview.doc.doc_version,2);assert.equal(preview.doc.style.text_mode_resolved,null);
 const t=ok(await call(s,'plan-templates','POST',{name:'旧方案结构',description:'',source:{plan_id:p.id,version:p.version},applicability:{subject:'music_interest',directions:[],grades:[],budget:{min:null,max:null,period:'unspecified'},target_types:[]},doc:preview.doc}),201);assert.equal(t.template.doc.doc_version,2);
}));
test('V05VAL AI测评分数只沿用原值或逐字引用明示分数，不推断打分',()=>school(async s=>{
 const p=await createV2(s),b=ok(await call(s,'plans/'+p.id+'/brief','PUT',{version:0,text:'节奏测评72/100，目前需巩固基础。'}));
 const card={card_id:'score',module:'assessment',entity_type:'module',op:'update',entity_id:null,parent_id:null,field:'scores',after:[{id:'tmp_score',label:'节奏',value:72,max:100}],depends_on:[],evidence:{kind:'inference'}};
 const data={plan_id:p.id,doc_version:2,plan_version:p.version,brief_version:b.brief.version};model(s,{suggestions:[{payload:{cards:[card]}}]});assert.deepEqual(ok(await ai(s,'plan/brief',data)).suggestions,[]);
 card.evidence={kind:'quote',source:'brief',quote:'节奏测评72/100'};model(s,{suggestions:[{payload:{cards:[card]}}]});assert.equal(ok(await ai(s,'plan/brief',data)).suggestions[0].payload.cards[0].after[0].value,72);
 card.after[0].value=90;model(s,{suggestions:[{payload:{cards:[card]}}]});assert.deepEqual(ok(await ai(s,'plan/brief',data)).suggestions,[]);
}));
test('V05VAL AI整组采用临时阶段与课程，服务端id_map重写依赖并保留旧价新报价',()=>school(async s=>{
 const c=await course(s,'组合建议课',300),p=await createV2(s),b=ok(await call(s,'plans/'+p.id+'/brief','PUT',{version:0,text:'需要增加表现阶段，每周上课。'}));
 const cards=[{card_id:'stage',module:'path',entity_type:'stage',op:'add',entity_id:'tmp_new_stage',parent_id:null,field:null,after:{key:'tmp_new_stage',name:'表现提升',stage_type_id:null,start_month:'2027-07',end_month:'2027-12',goals:[],nodes:[]},depends_on:[],evidence:{kind:'inference'}},{card_id:'line',module:'courses',entity_type:'course_line',op:'add',entity_id:'tmp_new_line',parent_id:null,field:null,after:{line_id:'tmp_new_line',stage_key:'tmp_new_stage',group_id:null,pricing_source:'catalog',course_id:c.id,name:'组合建议课',frequency_text:'每周一次',qty:{units:2},quoted_unit_price:0},depends_on:['stage'],evidence:{kind:'inference'}}];
 model(s,req=>{const prompt=JSON.stringify(req.messages);assert.ok(prompt.includes('quoted_unit_price'));return {suggestions:[{payload:{cards}}]};});const suggestion=ok(await ai(s,'plan/brief',{plan_id:p.id,doc_version:2,plan_version:p.version,brief_version:b.brief.version})).suggestions[0];assert.equal(suggestion.payload.cards.length,2);assert.equal(suggestion.payload.cards[1].after.quoted_unit_price,undefined);
 const doc=writeDoc(p);for(const card of suggestion.payload.cards)applyCard(doc,card);const q=ok(await call(s,'plans/'+p.id+'/quote-preview','POST',{version:p.version,doc}));const saved=ok(await call(s,'plans/'+p.id,'PUT',{version:p.version,doc,expected_price_list_rev:q.price_list_rev,applied_cards:[{suggestion_id:suggestion.id,card_ids:['stage','line'],edited_card_ids:[]}]}));assert.equal(saved.computed.total.amount,1000);assert.equal(saved.modules.courses.lines[1].stage_key,saved.id_map.tmp_new_stage);assert.deepEqual(saved.applied_suggestion_ids,[suggestion.id]);
}));
test('V05VAL 平台样例重复元素key或不匹配分组关联不能发布',async()=>{
 const original=JSON.parse(await readFile('docs/v05/examples/platform-sample.json','utf8')),content={courses:[{key:'piano_individual'}],stages:[]};
 const duplicate=structuredClone(original);duplicate.doc.modules.courses.lines[0].key=duplicate.doc.modules.path.stages[0].key;assert.throws(()=>validateSamplePlans([duplicate],content),e=>e.status===422);
 const badGroup=structuredClone(original);badGroup.doc.modules.courses.lines[0].group_key='missing';assert.throws(()=>validateSamplePlans([badGroup],content),e=>e.status===422);
});
test('V05VAL 提到预算的课程频率不被猜成金额，明确数字金额仍可提取',()=>{
 for(const value of ['预算按每周2次课程安排','预算看孩子每周上2次能否接受','预算先不定，每周3次','预算一年能上40课时'])assert.equal(budgetCandidate(value),null,value);
 assert.equal(budgetCandidate('预算约3万元').budget.amount,30000);assert.equal(budgetCandidate('总预算不超过2万元').budget_cap,20000);
});
