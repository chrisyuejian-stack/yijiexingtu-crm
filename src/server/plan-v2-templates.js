import {v2Text} from './plan-v2-text.js';
import {body,json,fail,randomId,now} from './core.js';
import {can} from './permissions.js';
import {planText,planIso} from './plan-document.js';
import {planMoney} from './plan-math.js';
import {readProspect} from './plan-prospects.js';
import {convertV1,canonical} from './plan-v2-convert.js';
import {validateV2Shape} from './plan-v2-document.js';
import {v2Declarations,v2Sources,v2Images} from './plan-v2-fields.js';
import {computeV2} from './plan-v2-math.js';
import {shiftV2} from './plan-v2-dates.js';
import {versionConflict} from './plan-v2-operations.js';

export const planTemplatePath=p=>/^\/api\/(?:plan-templates(?:\/[^/]+(?:\/instantiate-preview)?)?|plans\/[^/]+\/template-preview)$/.test(p);
const record=x=>({id:x.id,origin:x.origin||'tenant',name:x.name,description:x.description,applicability:JSON.parse(x.applicability_json),doc_version:2,...x.doc_json?{doc:JSON.parse(x.doc_json)}:{},version:x.version,pack_key:x.pack_key??null,pack_version:x.pack_version??null,sample_key:x.sample_key??null,created_at:planIso(x.created_at),updated_at:planIso(x.updated_at),readonly:x.origin==='platform'});
const safeText=(v,max)=>v2Text(v??'','template',max,true);
export function applicability(value){
 if(!value||typeof value!=='object'||Array.isArray(value))fail(422,'请填写模版适用范围','validation_failed');
 const result={subject:safeText(value.subject,80),directions:[],grades:[],target_types:[],budget:{min:null,max:null,period:'unspecified'}};
 for(const key of ['directions','grades','target_types']){if(!Array.isArray(value[key])||value[key].length>20)fail(422,'适用范围格式不正确','validation_failed');result[key]=value[key].map(x=>safeText(x,100));}
 const b=value.budget;if(!b||!['total','year','month','unspecified'].includes(b.period))fail(422,'预算范围格式不正确','validation_failed');
 result.budget={min:b.min==null?null:planMoney(b.min)/100,max:b.max==null?null:planMoney(b.max)/100,period:b.period};if(result.budget.min!==null&&result.budget.max!==null&&result.budget.min>result.budget.max)fail(422,'预算区间下限不能大于上限','validation_failed');return result;
}
export function freshTemplateDoc(value){
 const doc=structuredClone(value),map={};let i=0;for(const x of v2Declarations(doc)){map[x.id]='tmp_tpl_'+(++i);x.row[x.field]=map[x.id];}
 const walk=v=>{if(Array.isArray(v))return v.map(walk);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,k==='due_dates'?Object.fromEntries(Object.entries(x).map(([a,b])=>[map[a]||a,b])):['stage_key','group_id'].includes(k)?map[x]||x:walk(x)]));return v;};
 doc.modules=walk(doc.modules);doc.student_id=null;doc.source_lead_id=null;doc.meta.consultant_id=null;delete doc.computed;delete doc.applied_suggestion_ids;delete doc.brief;
 for(const s of doc.modules.path.stages){s.stage_snapshot=null;s.legacy_range=null;}
 for(const l of doc.modules.courses.lines)delete l.snapshot;
 return doc;
}
export function sanitizeTemplate(input,names=[],keepTeacherPhotos=false){
 const doc=structuredClone(input),redactions=[];
 for(const k of ['student_id','source_lead_id','computed','applied_suggestion_ids','brief','id','version','status','reference','manifest','converted_from','stored_doc_version','warnings'])if(Object.hasOwn(doc,k)){delete doc[k];redactions.push({path:k,reason:'不保留个体来源和内部记录'});}
 doc.meta.consultant_id=null;for(const key of ['student_name','grade','direction','direction_en'])doc.modules.basic[key]='';doc.modules.basic.plan_date=null;
 if(doc.style.cover_image_id)redactions.push({path:'style.cover_image_id',reason:'默认移除可能包含学员身份的图片'});doc.style.cover_image_id=null;
 if(doc.modules.photos.pages.length)redactions.push({path:'modules.photos.pages',reason:'默认移除可能包含学员身份的照片'});doc.modules.photos.pages=[];doc.modules.about.image_ids=[];
 for(const g of doc.modules.teachers.groups)for(const t of g.members)if(!keepTeacherPhotos)t.photo_image_id=null;
 for(const l of doc.modules.courses.lines)delete l.snapshot;
 for(const s of doc.modules.path.stages){delete s.stage_snapshot;s.stage_snapshot=null;s.legacy_range=null;}
 const mask=(value,path='doc')=>{if(typeof value==='string'){let out=value;for(const name of names.filter(x=>typeof x==='string'&&x.length>1).sort((a,b)=>b.length-a.length))out=out.replaceAll(name,'同学');out=out.replace(/(?:\+?86[- ]?)?1[3-9]\d{9}/g,'[电话已移除]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[邮箱已移除]').replace(/(?:就读于|就读|学校是|目前在)[\p{Script=Han}A-Za-z0-9·（）()]{2,30}(?:小学|中学|高中|学校|学院|大学)/gu,'[就读学校已移除]');if(out!==value)redactions.push({path,reason:'个体信息已移除'});return out;}
 if(Array.isArray(value))return value.map((x,i)=>mask(x,path+'['+i+']'));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,x])=>[k,mask(x,path+'.'+k)]));return value;};
 return {doc:mask(doc),redactions};
}
function assertPrivacy(doc,names=[]){
 if(!doc||typeof doc!=='object'||Array.isArray(doc)||!doc.modules?.basic)fail(422,'请提供完整模版文档','validation_failed');
 const value=JSON.stringify(doc);if(names.some(x=>x&&x.length>1&&value.includes(x))||/(?:1[3-9]\d{9}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.test(value)||doc.modules.basic.student_name||doc.modules.basic.grade)fail(422,'请先移除学员身份和联系方式','template_privacy_review_required');
}
async function ownedTemplate(r,id){
 if(id.startsWith('sample:')){const a=id.split(':');if(a.length!==4)fail(404,'不存在','not_found');const row=await r.planSampleGet(a[1],a[2],a[3]);if(!row)fail(404,'不存在','not_found');const sample=JSON.parse(row.doc_json);return {id,origin:'platform',name:sample.name,description:sample.description,applicability:sample.applicability,doc_version:2,doc:sample.doc,version:sample.version,pack_key:row.pack_key,pack_version:row.pack_version,sample_key:row.sample_key,created_at:planIso(row.created_at),updated_at:planIso(row.created_at),readonly:true};}
 const row=await r.planTemplateGet(id);if(!row)fail(404,'不存在','not_found');return record(row);
}
export async function resolveTemplate(r,id,version){const t=await ownedTemplate(r,id);if(t.version!==version)versionConflict(t);return t;}
async function validateOwnership(r,doc,inherited=null){
 validateV2Shape(doc,true);const source=await r.planWorkspace(v2Sources(doc));
 for(const id of v2Sources(doc).courses)if(!source.courses.some(x=>x.id===id))fail(404,'不存在','not_found');
 for(const id of v2Sources(doc).stages)if(!source.stages.some(x=>x.id===id))fail(404,'不存在','not_found');
 for(const id of v2Sources(doc).teachers)if(!source.teachers.some(x=>x.requested_id===id)&&!inherited?.modules.teachers.groups.some(g=>g.members.some(t=>t.teacher_id===id)))fail(404,'不存在','not_found');
 for(const id of v2Images(doc))if(!source.images.some(x=>x.id===id))fail(422,'请选择本机构可用图库图片','invalid_image');
 return source;
}
export async function planTemplatesApi(req,env,resolved,user,policy,r){
 const path=resolved.relative;if(!planTemplatePath(path))return undefined;
 if(!policy.modules.plans)fail(404,'不存在','not_found');if(!can(user,policy,'plan_templates',req.method==='GET'?'read':'write'))fail(403,'没有此操作权限','forbidden');
 const preview=/^\/api\/plans\/([^/]+)\/template-preview$/.exec(path),m=/^\/api\/plan-templates(?:\/([^/]+)(\/instantiate-preview)?)?$/.exec(path);
 if(!preview&&!m)fail(404,'不存在','not_found');
 if(m&&!m[1]&&req.method==='GET'){
  const origin=new URL(req.url).searchParams.get('origin')||'all',url=new URL(req.url),offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||50);if(!['all','tenant','platform'].includes(origin)||!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)fail(422,'分页格式不正确','validation_failed');
  const rows=await r.planTemplateRows({origin,subject:url.searchParams.get('subject'),q:url.searchParams.get('q')||'',offset,limit});return json({items:rows.items.map(record),total:rows.total,next_offset:offset+limit<rows.total?offset+limit:null,warnings:[]});
 }
 const current=m?.[1]?await ownedTemplate(r,decodeURIComponent(m[1])):null;
 if(current&&req.method==='GET'&&!m[2])return json({template:current,warnings:[]});
 if(current?.readonly&&['PUT','DELETE'].includes(req.method))fail(403,'平台示例只读，请另存为机构模版','readonly_template');
 if(!['POST','PUT','DELETE'].includes(req.method))fail(404,'不存在','not_found');const d=await body(req);
 if(preview||!current&&req.method==='POST'){
  const source=preview?{plan_id:preview[1],version:d.version,revision_id:d.revision_id}:d.source;
  if(!source||!!source.plan_id===!!source.template_id)fail(422,'请选择一个来源','validation_failed');
  let document,names=[],sourceRow=null;
  if(source.plan_id){sourceRow=await r.planGet(source.plan_id);if(!sourceRow)fail(404,'不存在','not_found');if(sourceRow.version!==source.version)versionConflict({id:sourceRow.id,version:sourceRow.version});const revision=source.revision_id?await r.planRevision(sourceRow.id,source.revision_id):null;if(source.revision_id&&!revision)fail(404,'不存在','not_found');const raw=JSON.parse(revision?.doc_json||sourceRow.doc_json),ctx=JSON.parse((await r.planContext(revision?.context_id||sourceRow.context_id)).doc_json);document=raw.doc_version===2?raw:convertV1(raw,ctx,sourceRow);names.push(ctx.student?.name);const prospect=await readProspect(env,resolved.tenant.id,sourceRow);if(prospect)names.push(prospect.name,prospect.parent_name);}
  else document=(await resolveTemplate(r,source.template_id,source.version)).doc;
  const facts=await r.contentFlagFacts(JSON.stringify(document));names.push(...facts.students);
  const clean=sanitizeTemplate(document,names,d.keep_teacher_photos===true);
  if(preview)return json({...clean,checks:{blocking:[],warnings:[],passed:[]},warnings:[]});
  const doc=structuredClone(d.doc);assertPrivacy(doc);const pendingFacts=await r.contentFlagFacts(JSON.stringify(doc));assertPrivacy(doc,[...names,...pendingFacts.students]);await validateOwnership(r,doc,document);const app=applicability(d.applicability);if(app.subject!==doc.subject)fail(422,'模版学科与适用范围不一致','validation_failed');
  const next={id:randomId('tpl'),name:v2Text(d.name,'name',100,false),description:safeText(d.description,1000),applicability:app,doc,source};
  try{await r.planTemplateSave(null,next,user,sourceRow);}catch(e){if(/expected=actual/.test(String(e)))versionConflict(sourceRow?{id:sourceRow.id,version:(await r.planGet(sourceRow.id))?.version}:null);throw e;}return json({template:await ownedTemplate(r,next.id),warnings:[]},201);
 }
 if(!current)fail(404,'不存在','not_found');if(d.version!==current.version)versionConflict(current);
 if(m[2]&&req.method==='POST'){
  if(d.pricing!=='current')fail(422,'实例化使用当前价目表','validation_failed');
  let doc=freshTemplateDoc(current.doc);const style=await r.documentDefault('plan');if(!style)fail(422,'请先配置可用的方案风格','style_pack_invalid');doc.style={...doc.style,pack_id:style.id,pack_version:style.version,cover_image_id:null};doc=shiftV2(doc,d.shift_months??0).doc;const data=await r.planWorkspace(v2Sources(doc)),blocking=[];
  for(const line of doc.modules.courses.lines)if(line.pricing_source==='catalog'){
   const c=data.courses.find(x=>x.id===line.course_id&&!x.deleted_at),v=c?JSON.parse(c.doc_json):null;
   if(!c||!c.active||!v.pricing||c.price_cents===null||v.pricing.mode!==line.billing_mode){blocking.push({code:'course_unavailable',text:'模版内有停用或缺少报价的课程，请选择课程或明确改为自由课程',module:'courses',line_id:line.line_id});line.snapshot={pricing:{mode:line.billing_mode,amount_cents:null,units_per_package:line.units_per_package}};}
   else {line.billing_mode=v.pricing.mode;line.units_per_package=v.pricing.units_per_package??null;line.optional=!!v.optional;line.snapshot={name:v.name,form:v.form,minutes:v.minutes,optional:!!v.optional,pricing:{mode:v.pricing.mode,amount_cents:c.price_cents,units_per_package:v.pricing.units_per_package??null},course_version:c.version,price_list_rev:data.price_list_rev,taken_at:planIso(now())};}
  }
  for(const stage of doc.modules.path.stages)if(stage.stage_type_id&&!data.stages.some(x=>x.id===stage.stage_type_id&&!x.deleted_at&&x.active))blocking.push({code:'stage_type_unavailable',text:'阶段类型已不可用，可重选或改为自由阶段',module:'path'});
  for(const g of doc.modules.teachers.groups)for(const t of g.members)if(t.teacher_id&&!data.teachers.some(x=>x.requested_id===t.teacher_id))blocking.push({code:'teacher_unavailable',text:'模版里的老师绑定已失效，可重选老师或改为手填资料',module:'teachers'});
  for(const id of v2Images(doc))if(!data.images.some(x=>x.id===id))blocking.push({code:'invalid_image',text:'模版里有不可用图片，请从图库重新选择',module:'photos'});
  doc.computed=computeV2(doc);return json({doc,computed:doc.computed,price_list_rev:data.price_list_rev,checks:{blocking,warnings:[],passed:[]},warnings:[]});
 }
 const old=await r.planTemplateGet(current.id);
 if(req.method==='DELETE'){try{await r.planTemplateSave(old,null,user);}catch(e){if(/expected=actual/.test(String(e)))versionConflict(await ownedTemplate(r,current.id));throw e;}return json({ok:true,warnings:[]});}
 if(req.method==='PUT'){
  assertPrivacy(d.doc);const pendingFacts=await r.contentFlagFacts(JSON.stringify(d.doc));assertPrivacy(d.doc,pendingFacts.students);await validateOwnership(r,d.doc,current.doc);const app=applicability(d.applicability);if(app.subject!==d.doc.subject)fail(422,'模版学科不一致','validation_failed');
  try{await r.planTemplateSave(old,{name:v2Text(d.name,'name',100,false),description:safeText(d.description,1000),applicability:app,doc:d.doc},user);}catch(e){if(/expected=actual/.test(String(e)))versionConflict(await ownedTemplate(r,current.id));throw e;}return json({template:await ownedTemplate(r,current.id),warnings:[]});
 }
 fail(404,'不存在','not_found');
}
