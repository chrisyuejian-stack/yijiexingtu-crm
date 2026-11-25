import {fail,now} from './core.js';
import {computePlan,computedResponse} from './plan-math.js';
import {planIso} from './plan-document.js';
import {computeV2} from './plan-v2-math.js';

export const v2Modules=['basic','assessment','strategy','path','timeline','courses','teachers','fees','goals','photos','about'];
export const v2Titles={assessment:'学员测评',strategy:'学习 / 申请策略',path:'学习路径',timeline:'关键节点时间线',courses:'课程计划',teachers:'师资',fees:'费用与缴费',goals:'目标院校 / 目标'};
export const canonical = v => JSON.stringify(sortValue(v));
function sortValue(v){if(Array.isArray(v))return v.map(sortValue);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sortValue(v[k])]));return v;}
export function blankV2({subject='music_interest',title='',student_id=null,source_lead_id=null,style={},date=null}={}) {
    return {doc_version:2,student_id,source_lead_id,subject,title,style,meta:{start_month:date?.slice(0,7)||planIso(now()).slice(0,7),budget_cap:null,target:{node_key:null,month:null,text:''},consultant_id:null,budget:{amount:null,period:'unspecified',note:''}},module_order:[...v2Modules],modules:{
        basic:{visible:true,student_name:'',grade:'',plan_date:date,direction:'',direction_en:'',english_enabled:false,cover_visible:true,cover_eyebrow:'',cover_subtitle:''},
        assessment:{visible:true,title:v2Titles.assessment,text:'',scores:[],tags:[]},strategy:{visible:true,title:v2Titles.strategy,text:''},path:{visible:true,title:v2Titles.path,stages:[]},timeline:{visible:true,title:v2Titles.timeline,items:[]},courses:{visible:true,title:v2Titles.courses,stage_settings:[],groups:[],lines:[]},teachers:{visible:true,title:v2Titles.teachers,groups:[]},fees:{visible:true,title:v2Titles.fees,installments:'per_stage',custom:[],due_dates:{},note:'',stage_extras:[],other_fees:[],discount:{type:'none',amount:null,rate_bps:null,note:''},fixed:[]},goals:{visible:true,title:v2Titles.goals,groups:[]},photos:{visible:true,pages:[]},about:{visible:false,image_ids:[],text:null}}};
}
export function convertV1(input,context={},row={}) {
    if(input.doc_version===2)return structuredClone(input);
    try {
        const old=structuredClone(input),prior=computePlan(old);
        if(old.computed&&canonical(old.computed)!==canonical(prior))throw Error('legacy_computed_mismatch');
        const m=old.modules,doc=blankV2({subject:old.subject,title:old.title,student_id:old.student_id,source_lead_id:old.source_lead_id,style:old.style,date:row.created_at?planIso(row.created_at).slice(0,10):null});
        doc.style={...doc.style,text_mode_resolved:doc.style.text_mode_resolved??null};
        doc.meta={...structuredClone(old.meta),budget_cap:old.meta.budget_cap_cents===null?null:old.meta.budget_cap_cents/100,budget:{amount:null,period:'unspecified',note:''}};delete doc.meta.budget_cap_cents;
        Object.assign(doc.modules.basic,{student_name:context.student?.name||'',grade:context.student?.grade||'',direction:context.student?.direction||'',cover_visible:m.cover.visible,cover_eyebrow:m.cover.eyebrow,cover_subtitle:m.cover.subtitle});
        const sections=[];if(m.assessment.text)sections.push(m.assessment.text);
        for(const [key,label] of [['strengths','优势'],['gaps','待提升'],['goals','目标']])if(m.assessment[key].length)sections.push(label+'\n'+m.assessment[key].map(x=>'- '+x).join('\n'));
        if(m.assessment.source_note)sections.push('补充说明\n'+m.assessment.source_note);
        Object.assign(doc.modules.assessment,{visible:m.assessment.visible,text:sections.join('\n\n')});
        doc.modules.path={visible:m.path.visible,title:v2Titles.path,stages:m.path.stages.map(s=>{const x={...s,start_month:s.start.slice(0,7),end_month:s.end.slice(0,7),legacy_range:{start:s.start,end:s.end},nodes:[]};delete x.start;delete x.end;return x;})};
        doc.modules.courses={visible:m.courses.visible,title:v2Titles.courses,stage_settings:[],groups:[],lines:m.courses.lines.map(l=>{const snap=l.snapshot,p=snap.pricing;return {...l,group_id:'grp_'+l.stage_key,pricing_source:'catalog',origin_course_id:null,name:snap.name,name_en:'',minutes:snap.minutes??null,billing_mode:p.mode,manual_unit_price:null,units_per_package:p.units_per_package??null,teaching_units:p.mode==='per_unit'?l.qty.units:p.mode==='package'?l.qty.packages*p.units_per_package:null,price_tbd:false,optional:!!snap.optional};})};
        for(const s of m.path.stages)if(m.courses.lines.some(x=>x.stage_key===s.key))doc.modules.courses.groups.push({id:'grp_'+s.key,stage_key:s.key,name:'课程安排'});
        doc.modules.teachers={visible:m.teachers.visible,title:v2Titles.teachers,groups:m.teachers.teacher_ids.length?[{id:'tgrp_'+(row.id||'legacy'),role:'授课导师',members:m.teachers.teacher_ids.map(id=>{const t=context.teachers?.find(x=>x.requested_id===id)||{};return {id:'tm_'+id,teacher_id:id,name:t.name||'',title:'',introduction:t.introduction||'',photo_image_id:null,proposed:false};})}]:[]};
        doc.modules.fees={...structuredClone(m.fees),title:v2Titles.fees,stage_extras:[],other_fees:[],discount:{type:'none',amount:null,rate_bps:null,note:''},fixed:[]};
        doc.modules.about={...structuredClone(m.about),text:null};
        for(const k of ['strategy','timeline','goals','photos'])doc.modules[k].visible=false;
        doc.applied_suggestion_ids=[...(old.applied_suggestion_ids||[])];doc.computed=computeV2(doc);
        const current=doc.computed,expected=computedResponse(prior);
        if(current.total.amount!==expected.total.amount||current.total.known_units!==expected.total.units||canonical(current.total.bundles)!==canonical(expected.total.bundles)||canonical(current.installments)!==canonical(expected.installments)||current.stages.some((s,i)=>['amount','months','calendar_weeks','teaching_weeks','weeks_display'].some(k=>s[k]!==expected.stages[i][k])||s.known_units!==expected.stages[i].units))throw Error('conversion_money_or_dates_mismatch');
        return doc;
    } catch(e){if(e.code==='legacy_conversion_failed')throw e;fail(422,'原方案需要检查，请联系管理员','legacy_conversion_failed');}
}
// Exact inverse is limited to the initial projection and its immutable archive.
export function reverseInitialV2(projected,original,context,row) {
    if(canonical(projected)!==canonical(convertV1(original,context,row)))fail(422,'已修改的新版方案不能覆盖旧修订','legacy_conversion_failed');
    return structuredClone(original);
}
