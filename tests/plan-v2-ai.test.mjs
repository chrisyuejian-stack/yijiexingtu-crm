import test from 'node:test';
import assert from 'node:assert/strict';
import {school,call,ok,course} from './fixtures-plans.mjs';
import {model,ai} from './fixtures-ai.mjs';
import {createV2,manualDoc,writeDoc} from './fixtures-v2.mjs';
import {budgetCandidate} from '../src/server/plan-v2-ai.js';
import {aiTimeoutMs} from '../src/server/ai-policy.js';
import {structuralReferences} from '../src/server/plan-v2-references.js';
const textCard=(quote='节奏需加强')=>({card_id:'card_text',module:'assessment',entity_type:'module',op:'update',entity_id:null,parent_id:null,field:'text',before:'模型伪造原值',after:'已有演奏基础，应加强节奏稳定。',evidence:{kind:'quote',source:'brief',quote},depends_on:[]});
async function setupBrief(s){const p=await createV2(s);const brief=ok(await call(s,'plans/'+p.id+'/brief','PUT',{version:0,text:'孩子手型不稳，节奏需加强。希望后半年提高表现。'})).brief;return {p,data:{plan_id:p.id,doc_version:2,plan_version:p.version,brief_version:brief.version,scope:'auto',tier:'fast'}};}
function courseCards(id){return [
 {card_id:'card_stage',module:'path',entity_type:'stage',op:'add',entity_id:'tmp_next',parent_id:null,field:null,after:{key:'tmp_next',name:'表现提升',stage_type_id:null,start_month:'2027-07',end_month:'2027-12',goals:['学习新曲'],nodes:[]},evidence:{kind:'inference'},depends_on:[]},
 {card_id:'card_group',module:'courses',entity_type:'course_group',op:'add',entity_id:'tmp_group',parent_id:'tmp_next',field:null,after:{id:'tmp_group',stage_key:'tmp_next',name:'核心课程'},evidence:{kind:'inference'},depends_on:['card_stage']},
 {card_id:'card_course',module:'courses',entity_type:'course_line',op:'add',entity_id:'tmp_new_course',parent_id:'tmp_group',field:null,after:{line_id:'tmp_new_course',stage_key:'tmp_next',group_id:'tmp_group',pricing_source:'catalog',course_id:id,name:'钢琴新课',frequency_text:'每周1次，每次1课时',billing_mode:'per_unit',qty:{units:4},manual_unit_price:1,snapshot:{pricing:{amount_cents:1}},computed:{amount:1}},evidence:{kind:'inference'},depends_on:['card_stage','card_group']}
];}

test('V05AI brief一次模型/一次计次返回文字+阶段+课程，原值服务器读取，价格快照服务器建立且业务零写入',()=>school(async s=>{
 const c=await course(s,'V2配课',300),{p,data}=await setupBrief(s),before=(await s.r.planGet(p.id)).doc_json;model(s,{suggestions:[{payload:{intent:'mixed',cards:[textCard(),...courseCards(c.id)]}}]});const response=ok(await ai(s,'plan/brief',data));assert.equal(s.modelCalls.length,1);assert.equal(response.usage.used_today,1);assert.equal(response.suggestions[0].kind,'plan.v2.cardset');const pay=response.suggestions[0].payload;assert.equal(pay.cards.length,4);assert.equal(pay.cards[0].before,'');assert.equal(pay.cards[0].default_selected,true);assert.equal(pay.cards[1].default_selected,false);assert.equal(pay.cards[3].after.snapshot,undefined);assert.equal(pay.cards[3].after.manual_unit_price,null);assert.equal(pay.computed.total.amount,1600);assert.equal(pay.completion.path,'complete');assert.equal(pay.completion.courses,'complete');assert.equal((await s.r.planGet(p.id)).doc_json,before);assert.equal(ok(await call(s,'ai/usage')).fast.used,1);
}));
test('V05AI 指定版块不能越界，伪造原话改推断/不默认选，润色不能改数量',()=>school(async s=>{
 const {p,data}=await setupBrief(s);model(s,{suggestions:[{payload:{cards:[textCard('原文里没有这个句子'),...courseCards('bad')]}}]});const r=ok(await ai(s,'plan/brief',{...data,scope:'assessment'}));assert.equal(r.suggestions[0].payload.cards.length,1);assert.equal(r.suggestions[0].payload.cards[0].evidence.verified,false);assert.equal(r.suggestions[0].payload.cards[0].default_selected,false);
 model(s,{suggestions:[{payload:{cards:[{card_id:'qty',module:'courses',entity_type:'course_line',op:'update',entity_id:p.modules.courses.lines[0].line_id,parent_id:null,field:'qty',after:{units:99},evidence:{kind:'inference'},depends_on:[]}]}}]});assert.deepEqual(ok(await ai(s,'plan/polish',{...data})).suggestions,[]);
}));
test('V05AI 新自由课程不采用模型单价或另议标记，保留旧手工价，合规变体补为推荐',()=>school(async s=>{
 const {p,data}=await setupBrief(s),stage=p.modules.path.stages[0].key;model(s,{suggestions:[{payload:{variant:'bad',cards:[{...textCard(),field:'__proto__'}]}},{payload:{variant:'good',cards:[{card_id:'manual',module:'courses',entity_type:'course_line',op:'add',entity_id:'tmp_free',parent_id:null,field:null,after:{line_id:'tmp_free',stage_key:stage,group_id:null,pricing_source:'manual',course_id:null,name:'表现练习',qty:{units:4},manual_unit_price:1,price_tbd:true},evidence:{kind:'inference'},depends_on:[]}]}}]});
 const r=ok(await ai(s,'plan/brief',data));assert.equal(r.suggestions.length,1);const pay=r.suggestions[0].payload;assert.equal(pay.variant,'good');assert.equal(pay.recommended,true);assert.equal(pay.cards[0].after.manual_unit_price,null);assert.equal(pay.cards[0].after.price_tbd,false);assert.equal(pay.computed.total.amount,null);assert.equal(pay.computed.total.known_amount,400);assert.equal(pay.computed.total.has_tbd,false);
}));
test('V05AI 部分采用独立重算，依赖缺失拒绝，修改后采用显式记录，采用失败不写业务',()=>school(async s=>{
 const c=await course(s,'建议配课',100),{p,data}=await setupBrief(s);model(s,{suggestions:[{payload:{cards:[textCard(),...courseCards(c.id)]}}]});const suggestion=ok(await ai(s,'plan/brief',data)).suggestions[0],d=writeDoc(p);d.modules.assessment.text=suggestion.payload.cards[0].after;
 const preview=ok(await call(s,'plans/'+p.id+'/quote-preview','POST',{version:p.version,doc:d}));assert.equal(preview.computed.total.amount,400);
 ok(await call(s,'plans/'+p.id,'PUT',{version:p.version,doc:d,applied_cards:[{suggestion_id:suggestion.id,card_ids:['card_course'],edited_card_ids:[]}]}),422);assert.equal((await s.r.planGet(p.id)).version,p.version);
 let saved=ok(await call(s,'plans/'+p.id,'PUT',{version:p.version,doc:d,applied_suggestion_ids:[suggestion.id],applied_cards:[{suggestion_id:suggestion.id,card_ids:['card_text'],edited_card_ids:[]}]}));assert.equal(saved.computed.total.amount,400);assert.deepEqual(saved.applied_suggestion_ids,[suggestion.id]);
 const current=writeDoc(saved);current.modules.assessment.text='顾问另行调整的测评';ok(await call(s,'plans/'+p.id,'PUT',{version:saved.version,doc:current,applied_cards:[{suggestion_id:suggestion.id,card_ids:['card_course'],edited_card_ids:[]}]}),422);assert.equal((await s.r.planGet(p.id)).version,saved.version);
 const fresh=ok(await ai(s,'plan/brief',{...data,plan_version:saved.version})).suggestions[0];const edited=ok(await call(s,'plans/'+p.id,'PUT',{version:saved.version,doc:current,applied_cards:[{suggestion_id:fresh.id,card_ids:['card_text'],edited_card_ids:['card_text']}]}));assert.equal(edited.modules.assessment.text,'顾问另行调整的测评');
}));
test('V05AI 10分钟后凭据重放保留原usage/warnings顺序，修改原文后同键也不重新生成',()=>school(async s=>{
 const {p,data}=await setupBrief(s);model(s,{suggestions:[{payload:{cards:[textCard()]}}]});const key=crypto.randomUUID(),r=ok(await ai(s,'plan/brief',data,key));ok(await call(s,'plans/'+p.id+'/brief','PUT',{version:1,text:'原文已补充'}));const actual=Date.now;try{const now=actual();Date.now=()=>now+11*60000;const replay=ok(await ai(s,'plan/brief',data,key));assert.deepEqual(replay,r);assert.equal(s.modelCalls.length,1);assert.equal(replay.internal_reference_audit,undefined);}finally{Date.now=actual;}
}));
test('V05AI v2长动作120/150共享截止，超时/解析失败不计次，成功空建议计1次',()=>school(async s=>{
 const {data}=await setupBrief(s);for(const route of ['plan/brief','plan/stage-courses','plan/adjust','plan/polish'])for(const tier of ['fast','deep']){model(s,req=>{assert.ok(Math.abs(req.deadline_at-Date.now()-(tier==='fast'?120000:150000))<1000);assert.equal(req.max_tokens,8192);return {suggestions:[]};});ok(await ai(s,route,{...data,tier}));}
 assert.equal(aiTimeoutMs('plan','stage-courses','fast'),45000);const before=ok(await call(s,'ai/usage')).fast.used,actual=Date.now;let clock=actual();try{Date.now=()=>clock;model(s,()=>{clock+=121000;return {suggestions:[]};});const failed=await ai(s,'plan/brief',data);assert.equal(failed.status,502);assert.equal(failed.body.error,'ai_timeout');assert.equal(ok(await call(s,'ai/usage')).fast.used,before);}finally{Date.now=actual;}
}));
test('V05AI 原文版本冲突/未保存/空输入在调模型前拒绝，不扣次',()=>school(async s=>{
 const {p,data}=await setupBrief(s);model(s);ok(await ai(s,'plan/brief',{...data,brief_version:0}),409);ok(await ai(s,'plan/brief',{...data,plan_version:99}),409);ok(await call(s,'plans/'+p.id+'/brief','PUT',{version:1,text:''}));ok(await ai(s,'plan/brief',{...data,brief_version:2}),422);assert.equal(s.modelCalls.length,0);assert.equal(ok(await call(s,'ai/usage')).fast.used,0);
}));
test('V05AI 预算数值只从确定原话解析，年预算不误作全方案上限，区间/币种/歧义不猜',()=>{
 assert.equal(budgetCandidate('孩子初二，预算一年3万左右').budget.amount,30000);assert.equal(budgetCandidate('一年预算约三万').budget.period,'year');assert.equal(budgetCandidate('总预算不超过2万元').budget_cap,20000);assert.equal(budgetCandidate('预算两到三万'),null);assert.equal(budgetCandidate('预算两万五'),null);assert.equal(budgetCandidate('预算一万美元'),null);assert.equal(budgetCandidate('每月能上四次课'),null);
});
test('V05AI 检索只选固定参考修订，摘要无姓名学校电话和原测评全文，界面无检索元数据',()=>school(async s=>{
 let p=await createV2(s),doc=writeDoc(p);doc.modules.basic.direction='钢琴';doc.modules.assessment.text='学员0就读于隐私中学，电话13912345678。节奏练习需巩固。';p=ok(await call(s,'plans/'+p.id,'PUT',{version:p.version,doc}));ok(await call(s,'plans/'+p.id+'/reference','PUT',{version:p.version,reference_version:0,enabled:true}));
 const target=await createV2(s),refs=await structuralReferences(s.r,{...target,id:target.id});assert.equal(refs.structural_references.length,1);const raw=JSON.stringify(refs.structural_references);for(const secret of ['学员0','隐私中学','13912345678',doc.modules.assessment.text])assert.ok(!raw.includes(secret));assert.ok([...raw].length<1300);
 const b=ok(await call(s,'plans/'+target.id+'/brief','PUT',{version:0,text:'需要巩固节奏'}));model(s,{suggestions:[{payload:{cards:[textCard('需要巩固节奏')]}}]});const result=ok(await ai(s,'plan/brief',{plan_id:target.id,doc_version:2,plan_version:target.version,brief_version:b.brief.version,scope:'auto'}));assert.equal(result.structural_references,undefined);assert.equal(JSON.stringify(result).includes('参考了'),false);assert.equal(result.suggestions[0].payload.cards[0].evidence.verified,true);assert.ok(JSON.stringify(s.modelCalls[0].messages).includes('structural_references'));
}));
