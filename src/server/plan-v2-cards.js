import {fail} from './core.js';
import {planValidation} from './plan-math.js';
import {canonical} from './plan-v2-convert.js';

export const cardFields={
 'basic.module':['student_name','grade','direction','direction_en','cover_eyebrow','cover_subtitle','title','plan_date'],
 'assessment.module':['text','tags','scores'],'strategy.module':['text'],
 'path.stage':['name','start_month','end_month','goals','node_tags','teaching_weeks','weeks_note','stage_type_id'],
 'path.stage_node':['name','date','note'],'timeline.timeline_item':['name','date','type','note','source_key'],
 'courses.course_group':['name','stage_key'],'courses.course_line':['name','name_en','frequency_text','minutes','qty','teaching_units','note','includes','stage_key','group_id'],
 'teachers.teacher_group':['role'],'teachers.teacher':['name','title','introduction','proposed'],
 'fees.module':['note','due_dates','custom','fixed'],'goals.goal_group':['title'],'goals.goal':['name','name_en','tier','note'],
 'photos.photo_page':['title','layout'],'about.module':['text']
};
function location(doc,card){
 const m=doc.modules,c=card,find=(xs,idKey='id')=>({xs,index:xs.findIndex(x=>x[idKey]===c.entity_id),idKey});
 if(c.entity_type==='module')return {entity:m[c.module],module:true};
 if(c.entity_type==='budget')return {entity:{budget:doc.meta.budget,budget_cap:doc.meta.budget_cap},budget:true};
 if(c.entity_type==='stage')return find(m.path.stages,'key');
 if(c.entity_type==='stage_node')return find(m.path.stages.find(x=>x.key===c.parent_id)?.nodes||[]);
 if(c.entity_type==='timeline_item')return find(m.timeline.items);
 if(c.entity_type==='course_group')return find(m.courses.groups);
 if(c.entity_type==='course_line')return find(m.courses.lines,'line_id');
 if(c.entity_type==='teacher_group')return find(m.teachers.groups);
 if(c.entity_type==='teacher')return find(m.teachers.groups.find(x=>x.id===c.parent_id)?.members||[]);
 if(c.entity_type==='goal_group')return find(m.goals.groups);
 if(c.entity_type==='goal')return find(m.goals.groups.find(x=>x.id===c.parent_id)?.items||[]);
 if(c.entity_type==='photo_page')return find(m.photos.pages);
 throw Error('unsupported card');
}
export function cardBefore(doc,c){const at=location(doc,c),entity=at.entity??at.xs?.[at.index]??null;return structuredClone(c.op==='add'?null:c.field===null?entity:c.module==='basic'&&c.entity_type==='module'&&c.field==='title'?doc.title:entity?.[c.field]??null);}
export function applyCard(doc,c){
 if(!['add','update','remove'].includes(c.op))throw Error('invalid card op');
 const at=location(doc,c),allowed=cardFields[c.module+'.'+c.entity_type];
 if(at.budget){if(c.module!=='fees'||c.op!=='update'||c.field!==null)throw Error('invalid budget card');doc.meta.budget=structuredClone(c.after.budget);doc.meta.budget_cap=c.after.budget_cap;return;}
 if(!allowed||at.module&&c.op!=='update'||c.entity_type==='photo_page'&&c.op!=='update')throw Error('invalid card scope');
 if(c.op==='add'){
  if(at.index!==-1||!c.entity_id?.startsWith('tmp_')||c.field!==null||c.after?.[at.idKey]!==c.entity_id)throw Error('invalid added card');at.xs.push(structuredClone(c.after));return;
 }
 if(!at.module&&at.index<0)throw Error('missing card target');
 if(c.op==='remove'){if(c.field!==null)throw Error('invalid remove');at.xs.splice(at.index,1);return;}
 if(!allowed.includes(c.field))throw Error('field not allowed');
 if(c.module==='basic'&&c.field==='title')doc.title=structuredClone(c.after);else (at.module?at.entity:at.xs[at.index])[c.field]=structuredClone(c.after);
}
export function verifyAdoptedCards(suggestions,groups,doc,base,idMap={}){
 if(!Array.isArray(groups)||groups.length>30)planValidation('采用记录格式不正确','applied_cards');
 const reverse=Object.fromEntries(Object.entries(idMap).map(([a,b])=>[b,a]));
 const remap=v=>{if(Array.isArray(v))return v.map(remap);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[reverse[k]||k,remap(x)]));return typeof v==='string'?reverse[v]||v:v;};
 const submitted=remap(doc),seen=new Set(),variants=new Map();
 for(const group of groups){
  const suggestion=suggestions.find(x=>x.id===group.suggestion_id),g=suggestion?.payload?.cards;
  if(!suggestion)fail(404,'不存在','not_found');
  if(suggestion.kind!=='plan.v2.cardset'||!Array.isArray(g)||suggestion.target.base_version!==base.version||suggestion.target.plan_id!==base.id)planValidation('建议与当前方案版本不一致','applied_cards');
  if(seen.has(suggestion.id)||!Array.isArray(group.card_ids)||group.card_ids.length>60||new Set(group.card_ids).size!==group.card_ids.length)planValidation('采用卡片不能重复','applied_cards');seen.add(suggestion.id);
  if(suggestion.payload.variant){const request=suggestion._request_id||suggestion.id;if(variants.has(request)&&variants.get(request)!==suggestion.id)planValidation('不能同时采用互斥配课方案','applied_cards');variants.set(request,suggestion.id);}
  const edited=group.edited_card_ids||[];if(!Array.isArray(edited)||edited.some(x=>!group.card_ids.includes(x)))planValidation('修改后采用记录不正确','applied_cards');
  const checkDoc=structuredClone(submitted);
  for(const id of group.card_ids){
   const card=g.find(x=>x.card_id===id);if(!card)planValidation('建议卡不存在','applied_cards');
   if(!edited.includes(id)&&card.depends_on.some(x=>!group.card_ids.includes(x)))planValidation('请同时采用依赖卡片或手工调整引用','applied_cards');
   if(!edited.includes(id)){
    let after;try{after=cardBefore(checkDoc,{...card,op:'update'});}catch{planValidation('采用目标不存在','applied_cards');}
    if(card.op==='remove'){if(after!==null)planValidation('删除建议与保存内容不一致','applied_cards');}
    else if(!matches(after,card.after))planValidation('建议已改动，请标记修改后采用','applied_cards');
   }
  }
 }
}

function matches(actual,expected){if(Array.isArray(expected))return Array.isArray(actual)&&actual.length===expected.length&&expected.every((x,i)=>matches(actual[i],x));if(expected&&typeof expected==='object')return actual&&typeof actual==='object'&&Object.entries(expected).every(([k,v])=>matches(actual[k],v));return actual===expected;}
