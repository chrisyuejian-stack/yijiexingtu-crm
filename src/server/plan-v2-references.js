import {v2Hash} from './plan-v2-operations.js';
const words=['基础','巩固','提高','提升','冲刺','启蒙','入门','节奏','手型','识谱','视唱','练耳','钢琴','声乐','吉他','音乐','舞蹈','芭蕾','爵士','绘画','素描','色彩','速写','创作','作品','表达','展示','申请','演出','考级','艺考'];
const safeLabel=(value,fallback)=>{const found=words.filter(x=>String(value||'').includes(x));return found.length?[...new Set(found)].join(' / '):fallback;};
function styleSummary(value){if(!value)return '';const lines=value.split(/\n+/).filter(Boolean),paragraphs=value.split(/\n\s*\n/).filter(Boolean).length;return '采用'+(paragraphs>1?'分段说明':'连续段落')+'，'+(/^\s*[-•]/m.test(value)?'配合条目要点；':'')+safeLabel(value,'先说明现状，再给出练习方向')+'。';}
export async function structuralReferences(r,doc){
 const rows=await r.planReferenceCandidates({subject:doc.subject,direction:doc.modules.basic.direction,grade:doc.modules.basic.grade,budget:doc.meta.budget,target_types:[...new Set(doc.modules.timeline.items.map(x=>x.type))],exclude_plan_id:doc.id||null}),out=[],audit=[];
 for(const row of rows){
  const stages=JSON.parse(row.stages||'[]'),start=stages.filter(x=>x.start).map(x=>x.start).sort()[0]||null,month=n=>n?Number(n.slice(0,4))*12+Number(n.slice(5,7))-1:null,offset=x=>start&&x!==null?x-month(start):null;
  const summary={module_order:(JSON.parse(row.module_order||'null')||['assessment','strategy','path','courses','fees']).filter(x=>['basic','assessment','strategy','path','timeline','courses','teachers','fees','goals','photos','about'].includes(x)),stages:stages.map((s,i)=>({name:safeLabel(s.name,'学习阶段 '+(i+1)),start_offset_month:offset(month(s.start)),months:s.start&&s.end?month(s.end)-month(s.start)+1:null})),courses:JSON.parse(row.courses||'[]').map(c=>({name:safeLabel(c.name,'专业练习'),stage:stages.findIndex(s=>s.key===c.stage_key)+1,qty:Object.fromEntries(Object.entries(c.qty||{}).filter(([k,v])=>['units','terms','semesters','months','packages'].includes(k)&&typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=1000000)),frequency:safeLabel(c.frequency,'按学习节奏安排')})),timeline:JSON.parse(row.nodes||'[]').map(n=>({type:['grade_exam','competition','art_exam','application_deadline','performance','other'].includes(n.type)?n.type:'other',month_offset:offset(month(n.date?.slice(0,7)))})),amount_band:row.amount==null?null:{min:Math.floor(row.amount/5000)*5000,max:(Math.floor(row.amount/5000)+1)*5000},assessment_style:styleSummary(row.assessment_text).slice(0,160),strategy_style:styleSummary(row.strategy_text).slice(0,240)};
  // Keep only bounded, deterministic structural material. Never quote original free text.
  while([...JSON.stringify(summary)].length>1200&&(summary.timeline.length||summary.courses.length||summary.stages.length)){if(summary.timeline.length)summary.timeline.pop();else if(summary.courses.length)summary.courses.pop();else summary.stages.pop();}
  out.push(summary);audit.push(await v2Hash(row.origin+':'+row.id+':'+(row.revision_id||'')));
 }
 return {structural_references:out,audit};
}
