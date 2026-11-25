import {subjectPacks} from './subject-packs.js';
import {fail,randomId,now} from './core.js';
import {planValidation,planDate,planMoney,quantityKeys} from './plan-math.js';
import {v2Shape,v2PortableShape} from './plan-v2-schema.js';
import {blankV2} from './plan-v2-convert.js';
import {v2Declarations} from './plan-v2-fields.js';
import {computeV2} from './plan-v2-math.js';

const bad=(path,message='格式不正确')=>planValidation(message,path);
const clone=v=>structuredClone(v);
function schemaValid(v,s,path,defs=v2Shape,loose=false){
    if(s.$ref)return schemaValid(v,defs[s.$ref.split('/').at(-1)],path,defs,loose);
    if(s.anyOf){if(!s.anyOf.some(x=>accept(v,x,defs,loose)))bad(path);return;}
    if(s.oneOf){if(s.oneOf.filter(x=>accept(v,x,defs,loose)).length!==1)bad(path);return;}
    if(s.const!==undefined&&v!==s.const)bad(path);if(s.enum&&!s.enum.includes(v))bad(path);
    if(s.type==='null'&&v!==null)bad(path);if(s.type==='boolean'&&typeof v!=='boolean')bad(path);
    if(s.type==='object'){
        if(!v||typeof v!=='object'||Array.isArray(v))bad(path);
        for(const k of loose?[]:s.required||[])if(!Object.hasOwn(v,k))bad(path+'.'+k,'缺少必填结构');
        for(const [k,x] of Object.entries(v)){
            if(loose&&['computed','snapshot','stage_snapshot','legacy_range','applied_suggestion_ids'].includes(k))continue;
            if(s.properties?.[k])schemaValid(x,s.properties[k],path+'.'+k,defs,loose);
            else if(s.additionalProperties===false)bad(path+'.'+k,'不支持的字段');
            else if(s.additionalProperties&&typeof s.additionalProperties==='object')schemaValid(x,s.additionalProperties,path+'.'+k,defs,loose);
        }
    }
    if(s.type==='array'){
        if(!Array.isArray(v)||v.length>(s.maxItems??Infinity)||v.length<(s.minItems??0))bad(path);
        if(s.uniqueItems&&new Set(v.map(x=>JSON.stringify(x))).size!==v.length)bad(path,'不能重复');
        v.forEach((x,i)=>schemaValid(x,s.items||{},path+'['+i+']',defs,loose));
    }
    if(s.type==='string'){
        if(typeof v!=='string'||[...v].length>(s.maxLength??Infinity)||v.length<(s.minLength??0)||s.pattern&&!new RegExp(s.pattern).test(v)||/<\/?[a-z!][^>]*>/i.test(v))bad(path,'请使用符合长度限制的文字，不要包含HTML');
        if(s.format==='date')planDate(v,path);
    }
    if(['number','integer'].includes(s.type)){
        if(typeof v!=='number'||!Number.isFinite(v)||s.type==='integer'&&!Number.isInteger(v)||v<(s.minimum??-Infinity)||v>(s.maximum??Infinity)||s.exclusiveMinimum!==undefined&&v<=s.exclusiveMinimum||s.multipleOf&&Math.abs(v/s.multipleOf-Math.round(v/s.multipleOf))>1e-6)bad(path);
    }
    for(const q of s.allOf||[]){if(loose&&q.if?.properties&&Object.keys(q.if.properties).some(k=>!Object.hasOwn(v,k)))continue;if(!q.if||accept(v,q.if,defs,loose))schemaValid(v,q.then||q,path,defs,loose);}
    // Conditional object schemas omit type and only constrain properties.
    if(!s.type&&s.properties)for(const [k,x] of Object.entries(s.properties))if(Object.hasOwn(v||{},k))schemaValid(v[k],x,path+'.'+k,defs,loose);
}
function accept(v,s,defs=v2Shape,loose=false){try{schemaValid(v,s,'doc',defs,loose);return true;}catch{return false;}}
function defaults(input,model){
    if(Array.isArray(model))return input??[];
    if(model&&typeof model==='object')return Object.fromEntries([...new Set([...Object.keys(model),...Object.keys(input||{})])].map(k=>[k,Object.hasOwn(input||{},k)?defaults(input[k],model[k]):clone(model[k])]));
    return input===undefined?clone(model):input;
}
const stageModel={key:null,name:'',stage_type_id:null,start_month:null,end_month:null,teaching_weeks:null,weeks_note:'',goals:[],nodes:[],node_tags:[],stage_snapshot:null,legacy_range:null};
const lineModel={line_id:null,stage_key:null,group_id:null,pricing_source:'manual',course_id:null,origin_course_id:null,name:'',name_en:'',frequency_text:'',minutes:null,billing_mode:'per_unit',qty:{units:null},teaching_units:null,manual_unit_price:null,units_per_package:null,optional:false,note:'',includes:[],ai_filled:false,price_tbd:false};
export function validateV2Input(input){
    if(!input||typeof input!=='object'||input.doc_version!==2)bad('doc_version');
    if(!Object.hasOwn(subjectPacks,input.subject))bad('subject','学科未开放');
    if(!input.modules||Object.keys(blankV2().modules).some(k=>!input.modules[k]))bad('modules','须包含全部11个版块');
    schemaValid(input,v2Shape.document,'doc',v2Shape,true);
    return input;
}
export function prepareV2(input,old,sources,elements=[],registry=[],style,preview=false) {
    validateV2Input(input);
    const doc=defaults(clone(input),blankV2({subject:input.subject,title:input.title,style}));doc.style=style;
    delete doc.computed;delete doc.applied_suggestion_ids;
    for(const s of doc.modules.path.stages){Object.assign(s,defaults(s,stageModel));s.nodes=s.nodes.map(n=>defaults(n,{id:null,date:null,name:'',note:''}));}
    for(const l of doc.modules.courses.lines){Object.assign(l,defaults(l,lineModel));delete l.snapshot;}
    for(const g of doc.modules.teachers.groups)g.members=g.members.map(t=>defaults(t,{id:null,teacher_id:null,name:'',title:'',introduction:'',photo_image_id:null,proposed:false}));
    for(const t of doc.modules.timeline.items)Object.assign(t,defaults(t,{id:null,date:null,name:'',type:'other',note:'',source_key:null}));
    doc.style=defaults(doc.style,blankStyle);
    // Source snapshots and calculated fields are never accepted as authority.
    const oldDecl=old?v2Declarations(old):[],allowed=new Map([...oldDecl,...registry.map(x=>({id:x.id,kind:x.kind})),...elements.map(x=>({id:x.id,kind:x.kind}))].map(x=>[x.id,x.kind]));
    const map={},used=new Set(),decl=v2Declarations(doc),newElements=[];
    for(const x of decl){
        if(typeof x.id!=='string'||!x.id||x.id.length>120)bad(x.field,'元素ID必填');if(used.has(x.id))bad(x.field,'元素ID不能重复');used.add(x.id);
        if(x.id.startsWith('tmp_')){map[x.id]=preview?x.id:randomId(({stage:'stk',line:'ln',group:'grp',teacher_group:'tgrp',teacher:'tm',goal_group:'gg',goal:'goal',photo:'pg',fee:'fee',installment:'ins',score:'sc',node:'nd'})[x.kind]);x.row[x.field]=map[x.id];}
        else if(allowed.get(x.id)!==x.kind)fail(404,'不存在','not_found');
        if(!['stage','line'].includes(x.kind))newElements.push({id:x.row[x.field],kind:x.kind});
    }
    const rewrite=v=>{if(Array.isArray(v))return v.map(rewrite);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k==='due_dates'?k:k,k==='due_dates'?Object.fromEntries(Object.entries(x).map(([a,b])=>[map[a]||a,b])):['stage_key','group_id'].includes(k)?map[x]||x:rewrite(x)]));return v;};
    doc.modules=rewrite(doc.modules);
    const refs=[],writes=[],stages=new Set(doc.modules.path.stages.map(s=>s.key)),groups=new Map(doc.modules.courses.groups.map(g=>[g.id,g.stage_key]));
    const stageRef=(id,field)=>{if(id!==null&&!stages.has(id))bad(field,'阶段引用必须在本方案内');};
    for(const g of doc.modules.courses.groups)stageRef(g.stage_key,'group.stage_key');
    const stamp=new Date(now()+8*36e5).toISOString().replace('Z','+08:00');let newLines=0;
    for(const s of doc.modules.path.stages){
        const before=old?.modules.path.stages.find(x=>x.key===s.key);
        s.legacy_range=before&&before.start_month===s.start_month&&before.end_month===s.end_month?clone(before.legacy_range||null):null;
        if(s.start_month&&s.end_month&&s.end_month<s.start_month)bad('path.stages','阶段结束月份不能早于开始月份');
        if(s.teaching_weeks!==null&&!s.weeks_note.trim())bad('weeks_note','手填教学周须说明原因');
        if(s.stage_type_id!==null){const same=before?.stage_type_id===s.stage_type_id&&before.stage_snapshot,source=sources.stages.find(x=>x.id===s.stage_type_id&&!x.deleted_at);
            if(!same&&(!source||!source.active))fail(source?422:404,'阶段类型不存在或已停用',source?'out_of_scope':'not_found');
            s.stage_snapshot=same?clone(before.stage_snapshot):{...JSON.parse(source.doc_json),type_version:source.version,taken_at:stamp};
            if(!same)refs.push({kind:'stages',id:source.id,version:source.version});
        }else s.stage_snapshot=null;
        writes.push({id:s.key,kind:'stage',target_id:s.stage_type_id,snapshot_json:s.stage_snapshot?JSON.stringify(s.stage_snapshot):null});
    }
    for(const l of doc.modules.courses.lines){
        stageRef(l.stage_key,'line.stage_key');if(l.group_id!==null&&(!groups.has(l.group_id)||groups.get(l.group_id)!==l.stage_key))bad('line.group_id','课程组必须属于相同阶段');
        const before=old?.modules.courses.lines.find(x=>x.line_id===l.line_id),registered=elements.find(x=>x.id===l.line_id&&x.kind==='line');
        if(before&&(before.pricing_source!==l.pricing_source||before.course_id!==l.course_id)||registered&&registered.target_id!==l.course_id)bad('course_id','更换课程来源须删除后新增');
        if(l.pricing_source==='catalog'){
            if(l.price_tbd)bad('price_tbd','价目表课程不能标为价格另议');
            let snap=before?.snapshot||(registered?.snapshot_json?JSON.parse(registered.snapshot_json):null);
            if(!snap){const source=sources.courses.find(x=>x.id===l.course_id&&!x.deleted_at);if(!source)fail(404,'不存在','not_found');const c=JSON.parse(source.doc_json);if(!source.active||!c.pricing||source.price_cents===null)bad('course_id','新课程须启用且已定价');
                snap={name:c.name,form:c.form,minutes:c.minutes??null,duration_text:c.duration_text??null,optional:!!c.optional,pricing:{mode:c.pricing.mode,amount_cents:source.price_cents,units_per_package:c.pricing.units_per_package??null},course_version:source.version,price_list_rev:sources.price_list_rev,taken_at:stamp};
                refs.push({kind:'courses',id:source.id,version:source.version});newLines++;
            }
            l.snapshot=clone(snap);l.billing_mode=snap.pricing.mode;l.manual_unit_price=null;l.units_per_package=snap.pricing.units_per_package??null;l.optional=!!snap.optional;
            const rawLine=input.modules.courses.lines.find(x=>(map[x.line_id]||x.line_id)===l.line_id)||{};
            if(!Object.hasOwn(rawLine,'name'))l.name=snap.name;if(!Object.hasOwn(rawLine,'minutes'))l.minutes=snap.minutes??null;
        }else{
            if(l.course_id!==null)bad('course_id');if(l.origin_course_id&&before?.origin_course_id!==l.origin_course_id&&!sources.courses.some(x=>x.id===l.origin_course_id))fail(404,'不存在','not_found');
            l.snapshot={source:'manual',pricing:{mode:l.billing_mode,amount_cents:planMoney(l.manual_unit_price),units_per_package:l.billing_mode==='package'?l.units_per_package:null},taken_at:before?.manual_unit_price===l.manual_unit_price&&before?.billing_mode===l.billing_mode?before.snapshot?.taken_at||stamp:stamp};
            if(l.billing_mode==='package'&&l.units_per_package===null)bad('units_per_package','包价须填写每包课时');
        }
        const key=quantityKeys[l.billing_mode];if(!key||Object.keys(l.qty).length!==1||!Object.hasOwn(l.qty,key))bad('qty','数量须匹配计价方式');
        if(l.billing_mode==='per_unit')l.teaching_units=l.qty.units;else if(l.billing_mode==='package')l.teaching_units=l.qty.packages===null?null:Math.round(l.qty.packages*l.units_per_package*100)/100;
        writes.push({id:l.line_id,kind:'line',target_id:l.course_id,snapshot_json:JSON.stringify(l.snapshot)});
    }
    for(const x of doc.modules.courses.stage_settings)stageRef(x.stage_key,'stage_settings');
    if(new Set(doc.modules.courses.stage_settings.map(x=>x.stage_key)).size!==doc.modules.courses.stage_settings.length)bad('stage_settings','阶段设置不能重复');
    for(const f of doc.modules.fees.stage_extras)stageRef(f.stage_key,'stage_extras');
    for(const f of [...doc.modules.fees.custom,...doc.modules.fees.fixed])stageRef(f.stage_key,'installments.stage_key');
    for(const k of Object.keys(doc.modules.fees.due_dates))stageRef(k,'due_dates');
    const fee=doc.modules.fees;if(fee.installments!=='custom'&&fee.custom.length||fee.installments==='custom'&&(!fee.custom.length||fee.custom.reduce((n,x)=>n+x.ratio_bps,0)!==10000)||fee.installments!=='fixed'&&fee.fixed.length)bad('fees.installments','分期模式或比例不正确');
    for(const g of doc.modules.teachers.groups)for(const t of g.members)if(t.teacher_id&&!sources.teachers.some(x=>x.requested_id===t.teacher_id)&&!old?.modules.teachers.groups.some(a=>a.members.some(b=>b.id===t.id&&b.teacher_id===t.teacher_id)))fail(404,'不存在','not_found');
    if(doc.modules.teachers.groups.reduce((n,x)=>n+x.members.length,0)>60)bad('teachers','老师最多60位');
    for(const score of doc.modules.assessment.scores)if(score.value!==null&&score.value>score.max)bad('scores','分数不能超过满分');
    const budget=doc.meta.budget;if(budget.period==='total'&&budget.amount!==null){if(doc.meta.budget_cap!==null&&planMoney(doc.meta.budget_cap)!==planMoney(budget.amount))bad('budget','总额预算存在冲突');doc.meta.budget_cap=budget.amount;}
    schemaValid(doc,v2Shape.document,'doc');doc.applied_suggestion_ids=[...(old?.applied_suggestion_ids||[])];doc.computed=computeV2(doc);
    return {doc,id_map:map,elements:writes,v2_elements:newElements,refs,newLines};
}
const blankStyle={pack_id:'',pack_version:'',cover_image_id:null,text_mode:'auto',text_mode_resolved:null,focal_point:{x:.5,y:.5},show_unit_price:false,show_latin_eyebrow:true,show_consultant:true};

export function validateV2Shape(value,template=false){if(!Object.hasOwn(subjectPacks,value?.subject))bad('subject','学科未开放');schemaValid(value,template?v2Shape.templateDocument:v2Shape.document,'doc');return value;}

export function validatePortableShape(value){schemaValid(value,v2PortableShape.platformSample,'sample',v2PortableShape);return value;}
