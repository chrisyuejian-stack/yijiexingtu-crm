import {planIso} from './plan-document.js';
import {computeV2} from './plan-v2-math.js';
import {v2Images} from './plan-v2-fields.js';

export function editorV2(row,prices=true){
    const d=JSON.parse(row.doc_json);if(!prices)for(const l of d.modules.courses.lines){delete l.manual_unit_price;if(l.snapshot?.pricing)delete l.snapshot.pricing.amount_cents;}
    return {...d,id:row.id,version:row.version,status:row.status,current_revision_id:row.current_revision_id,sent_revision_id:row.sent_revision_id,signed_revision_id:row.signed_revision_id,updated_at:planIso(row.updated_at),updated_by:row.updated_by,stored_doc_version:2,converted_from:null,warnings:[]};
}
function visibleText(value){return value.replace(/\*\*/g,'').replace(/^\s*-\s+/gm,'');}
export function checkV2(doc,ctx,manifest,sources,terms){
    const computed=computeV2(doc),blocking=[],warnings=[],passed=[],item=(code,text,module)=>({code,text,module,action:'review'});
    if(computed.budget.over)blocking.push(item('over_budget','课程总费用超过预算上限','fees'));
    if(computed.issues.unpriced)blocking.push(item('unpriced','有未填写价格且未标为价格另议的课程或费用','fees'));
    if(computed.issues.discount_invalid)blocking.push(item('discount_invalid','优惠不能超过方案费用','fees'));
    if(computed.installment_status==='unbalanced')blocking.push(item('installment_unbalanced','分期合计与方案总额不一致','fees'));
    if(doc.modules.courses.lines.some(x=>x.pricing_source==='manual'))warnings.push(item('manual_pricing','有非价目表课程，请确认单价及另议标记','courses'));
    for(const id of v2Images(doc,true)){const image=sources.images?.find(x=>x.id===id);if(!image){blocking.push(item('invalid_image','有图片已经不可用，请重新选择','photos'));continue;}let tags=[];try{tags=JSON.parse(image.tags_json||'[]');}catch{}if(tags.some(t=>/学员|学生|录取通知/.test(t))&&!image.consent)blocking.push(item('media_consent_required','学员图片须取得展示同意后才能对外发送','photos'));}
    const ordered=doc.modules.path.stages.filter(s=>s.start_month&&s.end_month).slice().sort((a,b)=>a.start_month.localeCompare(b.start_month));for(let i=1;i<ordered.length;i++)if(ordered[i].start_month<=ordered[i-1].end_month)warnings.push(item('stage_overlap','部分阶段日期重叠，请确认安排','path'));
    const texts=[doc.title];
    const collect=(value,key='')=>{if(typeof value==='string'&&['text','name','name_en','title','label','note','introduction','frequency_text','pending_note','direction','cover_eyebrow','cover_subtitle','tier','role','goals','tags'].includes(key))texts.push(value);else if(Array.isArray(value))value.forEach(x=>collect(x,key));else if(value&&typeof value==='object')for(const [k,x] of Object.entries(value))if(!['snapshot','stage_snapshot'].includes(k))collect(x,k);};
    for(const part of Object.values(doc.modules))if(part.visible)collect(part);
    if(doc.modules.about.visible&&doc.modules.about.text===null)texts.push(ctx.profile?.introduction||'',...(ctx.profile?.features||[]));
    const text=visibleText(texts.join('\n')),hits=terms.filter(t=>text.includes(t));
    if(hits.length)blocking.push(item('ad_law_terms','含有禁用词：'+[...new Set(hits)].join('、'),'assessment'));else passed.push(item('compliance_terms','未发现词库中的禁用词','assessment'));
    for(const l of doc.modules.courses.lines)if(l.pricing_source==='catalog'){
        const c=sources.courses.find(x=>x.id===l.course_id),data=c?JSON.parse(c.doc_json):null;
        if(!c||c.deleted_at||!c.active)warnings.push(item('course_inactive','课程已停用，保留原报价：'+l.name,'courses'));
        else if(c.price_cents!==l.snapshot.pricing.amount_cents||data.pricing?.mode!==l.billing_mode)warnings.push(item('price_outdated','价目表与原报价不同，可选择重新报价','courses'));
    }
    if(doc.modules.basic.visible&&doc.modules.basic.cover_visible&&doc.style.cover_image_id&&doc.style.text_mode_resolved!=='panel')warnings.push(item('cover_contrast','请预览封面照片上的文字对比度','basic'));
    return {blocking,warnings,passed};
}
export function renderV2(row,revision,context,mediaBase){
    const source=JSON.parse(revision.doc_json),out={doc_version:2,id:row.id,revision_id:revision.id,title:source.title,subject:source.subject,style:structuredClone(source.style),module_order:[...source.module_order],modules:{},computed:structuredClone(source.computed)};
    const media=id=>mediaBase+'/'+encodeURIComponent(id)+(mediaBase.endsWith('/gallery')?'/file':'');
    for(const [key,part] of Object.entries(source.modules))out.modules[key]=part.visible?structuredClone(part):{visible:false};
    const m=out.modules,privateStages=new Set(source.modules.courses.stage_settings.filter(x=>x.pending).map(x=>x.stage_key)),privateLines=new Set(source.modules.courses.lines.filter(x=>privateStages.has(x.stage_key)).map(x=>x.line_id));
    if(m.path.visible)for(const s of m.path.stages)delete s.stage_snapshot;
    if(m.courses.visible){m.courses.lines=m.courses.lines.filter(x=>!privateLines.has(x.line_id));m.courses.groups=m.courses.groups.filter(x=>!privateStages.has(x.stage_key));
        for(const l of m.courses.lines){if(l.snapshot)for(const key of ['course_version','price_list_rev','taken_at'])delete l.snapshot[key];if(!out.style.show_unit_price){delete l.manual_unit_price;if(l.snapshot?.pricing)delete l.snapshot.pricing.amount_cents;}}
    }
    out.computed.lines=out.computed.lines.filter(x=>m.courses.visible&&!privateLines.has(x.line_id));
    for(const s of out.computed.stages)delete s.draft_amount;
    if(!m.courses.visible){out.computed.optional_fees=[];out.computed.total.bundles=[];}
    if(!out.style.show_unit_price)for(const f of out.computed.optional_fees){delete f.price_text;delete f.amount;}
    if(m.basic.visible&&m.basic.cover_visible&&out.style.cover_image_id)out.style.cover_image_url=media(out.style.cover_image_id);
    if(m.photos.visible)for(const p of m.photos.pages){p.images=p.image_ids.map(id=>({id,url:media(id)}));delete p.image_ids;}
    if(m.about.visible){m.about.images=m.about.image_ids.map(id=>({id,url:media(id)}));delete m.about.image_ids;out.profile=structuredClone(context.profile);}
    if(m.teachers.visible)for(const g of m.teachers.groups)for(const t of g.members){t.photo_url=t.photo_image_id?media(t.photo_image_id):null;delete t.teacher_id;delete t.photo_image_id;}
    if(m.fees.visible&&!out.computed.total.complete){m.fees.custom=[];m.fees.fixed=[];m.fees.due_dates={};}
    const student=context.student||{},name=student.parent_consent_media?source.modules.basic.student_name:student.nickname||'同学';
    out.student={nickname:student.nickname||'',display_name:name};if(m.basic.visible)m.basic.student_name=name;
    out.brand={name:context.brand.name,logo:context.brand.logo,primary_color:context.brand.primary_color};
    if(out.style.show_consultant){if(context.brand.qr_image_id)out.brand.qr_url=media(context.brand.qr_image_id);if(context.consultant)out.consultant={name:context.consultant.name};}
    if(!student.parent_consent_media){const names=[student.name,source.modules.basic.student_name].filter(Boolean).sort((a,b)=>b.length-a.length);const redact=v=>{if(typeof v==='string'){for(const n of names)if(n!==name)v=n.length>1?v.replaceAll(n,name):v===n?name:v;return v;}if(Array.isArray(v))return v.map(redact);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,redact(x)]));return v;};return {render_data:redact(out),manifest:JSON.parse(revision.manifest_json),...(mediaBase.endsWith('/gallery')?{asset_base:mediaBase.slice(0,-8)+'/styles/'+encodeURIComponent(source.style.pack_id)+'/versions/'+encodeURIComponent(source.style.pack_version)+'/assets/'}:{}),warnings:[]};}
    return {render_data:out,manifest:JSON.parse(revision.manifest_json),...(mediaBase.endsWith('/gallery')?{asset_base:mediaBase.slice(0,-8)+'/styles/'+encodeURIComponent(source.style.pack_id)+'/versions/'+encodeURIComponent(source.style.pack_version)+'/assets/'}:{}),warnings:[]};
}
