import {fail,HttpError,randomId,now,phone} from './core.js';
import {encrypt,decrypt} from './crypto.js';
import {planText} from './plan-document.js';
import {prepareStudent} from './scheduling.js';
export function normalizeProspect(value){
 if(!value||typeof value!=='object'||Array.isArray(value))fail(422,'意向信息必须为对象','validation_failed');
 const out={};for(const [key,max] of [['name',40],['grade',100],['parent_name',100],['parent_phone',20],['direction',100],['notes',2000]])out[key]=planText(value[key]??'', 'prospect.'+key,max,key!=='name');
 if(out.parent_phone)phone(out.parent_phone);return out;
}
export async function storedProspect(env,tenant,id,value){return {data_enc:await encrypt(env,JSON.stringify(value),tenant+':plan-prospect:'+id),phone_last4:value.parent_phone.slice(-4)};}
export async function readProspect(env,tenant,row){return row?.prospect_enc?JSON.parse(await decrypt(env,row.prospect_enc,tenant+':plan-prospect:'+row.id)):null;}
export async function prospectLead(env,tenant,p,actor){return {id:randomId('rec'),name:p.name,grade:p.grade,direction:p.direction,note:p.notes,source:'方案',stage:'contacted',phone_enc:null,parent_phone_enc:p.parent_phone?await encrypt(env,p.parent_phone,tenant+':phone'):null,phone_last4:p.parent_phone.slice(-4),next_followup:null,trial_at:null,student_id:null,deleted_at:null};}
export async function conversionData(env,tenant,r,row,d){
 if(row.student_id)fail(409,'方案已转为正式学员','already_converted');
 if(!Number.isInteger(d.version)||d.version!==row.version)fail(409,'方案版本已变化','version_conflict');
 if(d.confirm_new!==undefined&&typeof d.confirm_new!=='boolean')fail(422,'confirm_new必须为布尔值','validation_failed');
 if(d.overrides!==undefined&&(!d.overrides||typeof d.overrides!=='object'||Array.isArray(d.overrides)))fail(422,'overrides必须为对象','validation_failed');
 const revision=await r.dataVersion(),lead=row.source_lead_id?await r.businessGet('leads',row.source_lead_id):null,prospect=await readProspect(env,tenant,row);
 if(row.source_lead_id&&!lead)fail(404,'线索不存在','not_found');
 const fallback={...prospect,...lead?{name:lead.name,grade:lead.grade,direction:lead.direction,notes:lead.note,parent_phone:await decrypt(env,lead.parent_phone_enc,tenant+':phone')||await decrypt(env,lead.phone_enc,tenant+':phone')}:{}},values={...fallback};
 for(const key of ['name','grade','parent_name','parent_phone'])if(d.overrides?.[key]!==undefined)values[key]=d.overrides[key];
 const p=normalizeProspect(values),link=d.link_student_id??null;
 if(link!==null)planText(link,'link_student_id',100);
 let student;
 if(link){student=await r.businessGet('students',link);if(!student||student.deleted_at)fail(404,'学员不存在','not_found');}
 else if(lead?.student_id){const e=new HttpError(409,'线索已有正式学员，请选择关联已有学员','possible_duplicate');const s=await r.businessGet('students',lead.student_id);e.details={duplicates:s?[{id:s.id,name:s.name,grade:s.grade,phone_last4:(p.parent_phone||'').slice(-4)}]:[]};throw e;}
 if(!student){
  const duplicates=[];
  if(p.parent_phone){for(const s of await r.planDuplicateCandidates(p.name)){
    const n=await decrypt(env,s.parent_phone_enc,tenant+':phone')||await decrypt(env,s.phone_enc,tenant+':phone');
    if(n&&n.slice(-4)===p.parent_phone.slice(-4))duplicates.push({id:s.id,name:s.name,grade:s.grade,phone_last4:n.slice(-4)});
  }}
  if(duplicates.length&&!d.confirm_new){const e=new HttpError(409,'可能已有同一学员，请确认关联或新建','possible_duplicate');e.details={duplicates};throw e;}
  student=await prepareStudent(env,tenant,r,{...p,status:'active',parent_consent_media:false,source_lead_id:lead?.id??null});
 }
 if(lead?.student_id&&lead.student_id!==student.id)fail(409,'线索已关联其他学员','possible_duplicate');
 return {student,lead,revision,link:!!link};
}
