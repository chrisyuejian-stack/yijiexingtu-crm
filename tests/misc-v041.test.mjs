import test from 'node:test';
import assert from 'node:assert/strict';
import {school,call,ok,filled} from './fixtures-plans.mjs';
import {content,model,ai} from './fixtures-ai.mjs';
import {contentFlags} from '../src/server/content-flags.js';

test('V041 G5 最近/最后/最终不因单字最提醒，广告法词组仍提醒',()=>{const safe=contentFlags('最近课程已开始，最后一节、最终结果、最初计划和最少一课时。');assert.ok(!safe.some(x=>x.kind==='ad_law'));for(const word of ['最好的','最强','最佳','最优','最专业','最权威','最顶级','最先进'])assert.ok(contentFlags(word).some(x=>x.kind==='ad_law'&&x.quote===word));assert.ok(contentFlags('最近',{terms:['最近']}).some(x=>x.kind==='banned'));});

test('V041 G5 方案详情返回student/lead/prospect的party和party_name，无联系人泄露',()=>school(async s=>{
 const student=await filled(s),p=ok(await call(s,'plans','POST',{title:'意向',subject:'music_interest',prospect:{name:'测试意向',parent_phone:'13800001234'}}),201),lead=ok(await call(s,'plans','POST',{title:'线索',subject:'music_interest',prospect:{name:'测试线索'},create_lead:true}),201);
 for(const [item,type,name] of [[student,'student',null],[p,'prospect','测试意向'],[lead,'lead','测试线索']]){const d=ok(await call(s,'plans/'+item.id));assert.equal(d.party,type);assert.equal(typeof d.party_name,'string');if(name)assert.equal(d.party_name,name);assert.ok(!JSON.stringify(d).includes('13800001234'));const list=ok(await call(s,'plans')).items.find(x=>x.id===item.id);assert.equal(d.party_name,list.party_name)}
}));

test('V041 G5 content建议最近不产生ad_law，best词组仍留提醒且不阻止人保存',()=>school(async s=>{
 const c=await content(s);model(s,{suggestions:[{payload:{versions:{short:'最近开班。',medium:'最后一节课程。',long:'本机构是最专业的课堂。'}}}]});const r=ok(await ai(s,'content/versions',{content_id:c.id}));assert.ok(r.suggestions.some(x=>x.flags?.some(f=>f.kind==='ad_law')));assert.ok(!r.suggestions.some(x=>x.flags?.some(f=>f.kind==='ad_law'&&f.quote==='最')));
 const saved=ok(await call(s,'content/'+c.id,'PUT',{version:c.version,blocks:[{type:'paragraph',text:'最近开班。'}]}));assert.equal(saved.blocks[0].text,'最近开班。');
}));
