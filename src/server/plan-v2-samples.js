import {fail} from './core.js';
import {v2Declarations} from './plan-v2-fields.js';
import {blankV2} from './plan-v2-convert.js';
import {validatePortableShape,validateV2Shape} from './plan-v2-document.js';
const invalid=()=>fail(422,'平台方案示例格式、隐私或稳定引用不正确','validation_failed');
export function validateSamplePlans(values,content){
 if(values===undefined)return [];if(!Array.isArray(values)||values.length>2)invalid();const seen=new Set(),course=new Set(content.courses.map(x=>x.key)),stage=new Set(content.stages.map(x=>x.key));
 for(const sample of values){validatePortableShape(sample);if(seen.has(sample.key)||sample.doc.subject!==sample.applicability.subject)invalid();seen.add(sample.key);
  const raw=JSON.stringify(sample);if(/1[3-9]\d{9}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(raw))invalid();
  for(const s of sample.doc.modules.path.stages)if(s.stage_type_key!==null&&!stage.has(s.stage_type_key))invalid();
  for(const l of sample.doc.modules.courses.lines)if(l.pricing_source==='catalog'&&!course.has(l.course_key)||l.price_tbd)invalid();
  portableToDoc(sample.doc,{courses:new Map([...course].map(x=>[x,'crs_'+x])),stage_types:new Map([...stage].map(x=>[x,'stg_'+x]))},null);
 }
 return structuredClone(values);
}
export function portableToDoc(portable,maps,style){
 const doc=structuredClone(portable),defaults=blankV2({subject:doc.subject}),key=v=>{if(v.key!==undefined){v.id='tmp_sample_'+v.key;delete v.key;}return v;};
 doc.style=style||{pack_id:'stp_folio',pack_version:'1.0.0',cover_image_id:null,text_mode:'auto',text_mode_resolved:null,focal_point:{x:.5,y:.5},show_unit_price:false,show_latin_eyebrow:true,show_consultant:true};
 doc.meta={...defaults.meta,...doc.meta};
 const m=doc.modules,stageKeys=new Map(m.path.stages.map(s=>[s.key,'tmp_sample_'+s.key])),groups=new Map(m.courses.groups.map(g=>[g.key,'tmp_sample_'+g.key]));
 for(const s of m.path.stages){s.key=stageKeys.get(s.key);s.stage_type_id=s.stage_type_key===null?null:maps.stage_types.get(s.stage_type_key);if(s.stage_type_key!==null&&!s.stage_type_id)invalid();delete s.stage_type_key;s.stage_snapshot=null;s.legacy_range=null;s.nodes=s.nodes.map(key);}
 for(const t of m.timeline.items)key(t);
 for(const t of m.assessment.scores)key(t);
 for(const s of m.courses.stage_settings){if(!stageKeys.has(s.stage_key))invalid();s.stage_key=stageKeys.get(s.stage_key);}
 for(const g of m.courses.groups){g.id=groups.get(g.key);delete g.key;g.stage_key=g.stage_key===null?null:stageKeys.get(g.stage_key);if(g.stage_key===undefined)invalid();}
 for(const l of m.courses.lines){l.line_id='tmp_sample_'+l.key;delete l.key;l.stage_key=l.stage_key===null?null:stageKeys.get(l.stage_key);l.group_id=l.group_key===null?null:groups.get(l.group_key);delete l.group_key;if(l.stage_key===undefined||l.group_id===undefined)invalid();l.course_id=l.pricing_source==='catalog'?maps.courses.get(l.course_key):null;if(l.pricing_source==='catalog'&&!l.course_id)invalid();delete l.course_key;l.origin_course_id=null;l.manual_unit_price=null;l.price_tbd=false;}
 for(const g of m.teachers.groups){key(g);for(const t of g.members){key(t);t.teacher_id=null;t.photo_image_id=null;}}
 for(const g of m.goals.groups){key(g);g.items.forEach(key);}
 const f=m.fees;for(const fee of f.stage_extras){key(fee);fee.stage_key=fee.stage_key===null?null:stageKeys.get(fee.stage_key);if(fee.stage_key===undefined)invalid();fee.amount=null;}
 for(const fee of f.other_fees){key(fee);fee.amount=null;}
 f.due_dates=Object.fromEntries(Object.entries(f.due_dates).map(([k,v])=>{if(!stageKeys.has(k))invalid();return [stageKeys.get(k),v];}));f.discount={type:'none',amount:null,rate_bps:null,note:''};f.fixed=[];
 const declarations=v2Declarations(doc);if(new Set(declarations.map(x=>x.id)).size!==declarations.length)invalid();
 const stages=new Set(m.path.stages.map(x=>x.key)),groupStages=new Map(m.courses.groups.map(x=>[x.id,x.stage_key]));
 for(const l of m.courses.lines)if(l.stage_key!==null&&!stages.has(l.stage_key)||l.group_id!==null&&(!groupStages.has(l.group_id)||groupStages.get(l.group_id)!==l.stage_key))invalid();
 if(new Set(m.courses.stage_settings.map(x=>x.stage_key)).size!==m.courses.stage_settings.length)invalid();
 validateV2Shape(doc,true);return doc;
}
