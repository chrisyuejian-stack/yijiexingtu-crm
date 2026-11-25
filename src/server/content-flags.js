import {inlinePlain} from './content-inline.js';
// Advisory only. Quotes are always exact substrings of the generated plain text.
import { blockText } from './content-document.js';
export const AD_TERMS = ['最好的','最强','最佳','最优','最专业','最权威','最顶级','最先进','第一','唯一','保过','包过','保录','100%','国家级','顶级'];
function rawSuggestionText(p) {
  if(p.blocks)return p.blocks.map(blockText).join('\n');
  if(p.sections)return p.sections.map(s=>[s.title,...s.points].join('\n')).join('\n');
  if(p.versions)return Object.values(p.versions).join('\n');
  return (p.items||[]).map(x=>x.quote||x.reason||'').join('\n');
}
export function suggestionText(p){const value=rawSuggestionText(p);return p.text_format==='inline_v1'?inlinePlain(value):value;}
export function unsafeContent(value) {
  return /(?:出售|贩卖|购买)(?:毒品|枪支|儿童色情)|(?:教你|教程|步骤).{0,8}(?:制造炸弹|制作毒品)|(?:煽动|鼓动).{0,8}(?:恐怖袭击|性侵儿童)/u.test(value);
}
export function contentFlags(value, facts = {},textFormat='plain') {
  if(textFormat==='inline_v1')value=inlinePlain(value);
  const out=[];const add=(kind,quote,text,source)=>{if(quote&&value.includes(quote)&&!out.some(f=>f.kind===kind&&f.quote===quote))out.push({kind,quote,text,...source?{source}:{}});};
  for(const term of AD_TERMS)if(value.includes(term))add('ad_law',term,'广告法常见风险用语，发布前请核查');
  for(const term of facts.terms||[])if(value.includes(term))add('banned',term,'平台或机构禁用词');
  for(const name of facts.students||[])if(name&&name.length>1)add('privacy',name,'出现本机构学员姓名，发布前请确认授权');
  for(const match of value.matchAll(/【待填[：:][^】\n]{1,200}】/gu))add('placeholder',match[0],'待填写');
  for(const match of value.matchAll(/[^。！？\n]{0,60}(?:\d+\s*(?:人|名).{0,15}(?:录取|考入|获奖)|(?:录取|考入|获奖).{0,15}\d+|\d{4}年|\d{1,2}月\d{1,2}[日号])[^。！？\n]{0,60}/gu))add('needs_confirm',match[0],'具体日期或成绩，发布前请确认');
  const profile=facts.profile||{};
  // Only compare a value when its field/course is explicitly identified; never infer a mismatch from absence.
  for(const course of facts.courses||[]){
    if(!course.name||course.price_cents==null)continue;
    const escaped=course.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const re=new RegExp(escaped+'[^。！？\\n]{0,24}?(\\d+(?:\\.\\d{1,2})?)\\s*元','gu');
    for(const m of value.matchAll(re))if(Math.round(Number(m[1])*100)!==course.price_cents)add('fact_mismatch',m[0],course.name+'价目表为 '+course.price_cents/100+' 元（请核对计价单位）','prices');
  }
  if(facts.selectedCourses?.length===1){const c=facts.selectedCourses[0],pricing=JSON.parse(c.doc_json||'{}').pricing;
    if(c.price_cents!=null&&pricing?.mode==='per_unit')for(const m of value.matchAll(/(?:每节|每课时|每次课)[：:\s]*(\d+(?:\.\d{1,2})?)\s*元/gu))if(Math.round(Number(m[1])*100)!==c.price_cents)add('fact_mismatch',m[0],'价目表为 '+c.price_cents/100+' 元/'+(pricing.unit_label||'课时'),'prices');
  }
  for(const [label,key] of [['机构地址','address'],['地址','address'],['联系电话','contact_phone'],['电话','contact_phone']]){
    if(!profile[key])continue;
    const re=new RegExp(label+'[是为：:\\s]+([^。！？\\n，,；;]{2,100})','gu');
    for(const m of value.matchAll(re)){const v=m[1].trim();if(v!==String(profile[key]).trim())add('fact_mismatch',m[0],label+'资料为 '+profile[key],'profile.'+key);}
  }
  for(const [label,names,source] of [['课程名称',facts.courses?.map(x=>x.name),'courses'],['老师姓名',facts.teachers,'teachers']]){
    if(!names?.length)continue;
    for(const m of value.matchAll(new RegExp(label+'[是为：:\\s]+([^。！？\\n，,；;]{1,40})','gu')))if(!names.includes(m[1].trim()))add('fact_mismatch',m[0],label+'与当前机构资料不一致',source);
  }
  return out.slice(0,200);
}
