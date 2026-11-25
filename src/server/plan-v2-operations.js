import {body,json,fail,HttpError,now} from './core.js';
import {encrypt,decrypt} from './crypto.js';
import {can} from './permissions.js';
import {planIso} from './plan-document.js';
import {convertV1,canonical} from './plan-v2-convert.js';
import {editorV2,checkV2} from './plan-v2-view.js';
import {prepareV2} from './plan-v2-document.js';
import {computeV2} from './plan-v2-math.js';
import {shiftV2} from './plan-v2-dates.js';

export const v2ExtraPath=p=>/^\/api\/(?:plans\/[^/]+\/(?:brief|reference|quote-preview|shift-dates\/preview|template-preview)|plan-templates(?:\/[^/]+(?:\/instantiate-preview)?)?)$/.test(p);
export async function v2Hash(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function versionConflict(latest){const e=new HttpError(409,'内容已被修改，请对比后重试','version_conflict');e.details={latest};throw e;}
export async function readBrief(r,env,tenant,id){const b=await r.planBrief(id);return b?{version:b.version,text:JSON.parse(await decrypt(env,b.text_enc,tenant+':plan-brief:'+id)).text,updated_at:planIso(b.updated_at)}:{version:0,text:'',updated_at:null};}
export async function readReference(r,id){const x=await r.planReference(id);return x?{enabled:!!x.enabled,version:x.version,revision_id:x.revision_id,updated_at:planIso(x.updated_at)}:{enabled:false,version:0,revision_id:null,updated_at:null};}
export async function v2EditorResponse(r,row,env,tenant,user,policy){
 const stored=JSON.parse(row.doc_json),ctx=JSON.parse((await r.planContext(row.context_id)).doc_json),doc=stored.doc_version===2?stored:convertV1(stored,ctx,row),out=editorV2({...row,doc_json:JSON.stringify(doc)},can(user,policy,'prices','read'));
 out.stored_doc_version=stored.doc_version===2?2:1;out.converted_from=stored.doc_version===2?null:1;out.manifest=JSON.parse(row.manifest_json);Object.assign(out,await r.planParty(row.id));
 if(can(user,policy,'plans','write')){out.brief=await readBrief(r,env,tenant,row.id);out.reference=await readReference(r,row.id);}return out;
}
export async function v2Extras(req,env,resolved,user,policy,r,ops){
 const path=resolved.relative,match=/^\/api\/plans\/([^/]+)\/(brief|reference|quote-preview|shift-dates\/preview)$/.exec(path);if(!match)return undefined;
 if(!policy.modules.plans)fail(404,'不存在','not_found');if(!can(user,policy,'plans','write'))fail(403,'没有此操作权限','forbidden');
 const row=await r.planGet(match[1]);if(!row)fail(404,'不存在','not_found');const action=match[2],tenant=resolved.tenant.id;
 if(action==='brief'&&req.method==='GET')return json({brief:await readBrief(r,env,tenant,row.id),warnings:[]});
 if(!['POST','PUT'].includes(req.method)||action==='brief'&&req.method!=='PUT'||action==='reference'&&req.method!=='PUT'||!['brief','reference'].includes(action)&&req.method!=='POST')fail(404,'不存在','not_found');
 const d=await body(req);
 if(action==='brief'){
  if(row.signed_revision_id||['signed','archived'].includes(row.status))fail(409,'当前方案已锁定，请复制后修改','invalid_state');
  if(!Number.isInteger(d.version)||d.version<0||typeof d.text!=='string'||[...d.text].length>8000)fail(422,'原文最多8000字，请检查版本','validation_failed');
  const current=await readBrief(r,env,tenant,row.id);if(current.version!==d.version)versionConflict(current);
  try{await r.planSaveBrief(row,d.version,await encrypt(env,JSON.stringify({text:d.text.replace(/\r\n/g,'\n')}),tenant+':plan-brief:'+row.id),user);}catch(e){if(/expected=actual/.test(String(e)))versionConflict(await readBrief(r,env,tenant,row.id));throw e;}
  return json({brief:await readBrief(r,env,tenant,row.id),warnings:[]});
 }
 if(d.version!==row.version)versionConflict(await v2EditorResponse(r,row,env,tenant,user,policy));
 if(action==='reference'){
  if(typeof d.enabled!=='boolean'||!Number.isInteger(d.reference_version)||d.reference_version<0)fail(422,'参考标记格式不正确','validation_failed');
  const current=await readReference(r,row.id);if(current.version!==d.reference_version)versionConflict(current);
  const revisionId=d.enabled?d.revision_id||row.current_revision_id:current.revision_id;if(revisionId&&!await r.planRevision(row.id,revisionId))fail(404,'不存在','not_found');
  try{await r.planSaveReference(row,d.reference_version,d.enabled,revisionId,user);}catch(e){if(/expected=actual/.test(String(e)))versionConflict(await readReference(r,row.id));throw e;}
  return json({reference:await readReference(r,row.id),warnings:[]});
 }
 const stored=JSON.parse(row.doc_json),ctx=JSON.parse((await r.planContext(row.context_id)).doc_json),old=stored.doc_version===2?stored:convertV1(stored,ctx,row);
 if(action==='shift-dates/preview'){const shifted=shiftV2(old,d.months);shifted.doc.computed=computeV2(shifted.doc);return json({...shifted,computed:shifted.doc.computed,save_options:{date_shift:{months:d.months,base_version:row.version}},warnings:['文字中提到的日期不会自动修改，请检查。']});}
 if(row.signed_revision_id||['signed','archived'].includes(row.status))fail(409,'当前方案已锁定','invalid_state');
 if(!d.doc||typeof d.doc!=='object'||Array.isArray(d.doc)||d.doc.doc_version!==2)fail(422,'请提供完整doc v2文档','validation_failed');
 const selected=await ops.chooseStyle(r,d.doc?.style,old,row),sources=await ops.sourcesFor(r,d.doc,old,ctx),prepared=prepareV2(d.doc,old,sources,await r.planElements(row.id),await r.planV2Elements(row.id),selected.style,true);
 const context=ops.contextFor(prepared.doc,ctx,sources,prepared.refs,user);ops.validateImages(prepared.doc,context,sources,old,ctx,prepared.refs);
 return json({doc:prepared.doc,computed:prepared.doc.computed,price_list_rev:sources.price_list_rev,checks:checkV2(prepared.doc,context,selected.manifest,sources,(await r.planTerms()).map(x=>x.term)),warnings:[]});
}
