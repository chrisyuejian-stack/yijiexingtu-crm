import {v2Text} from './plan-v2-text.js';
import {fail,randomId,now} from './core.js';
import {planText} from './plan-document.js';
import {convertV1,v2Modules} from './plan-v2-convert.js';
import {readBrief,versionConflict} from './plan-v2-operations.js';
import {readProspect} from './plan-prospects.js';
import {structuralReferences} from './plan-v2-references.js';
import {cardFields,cardBefore,applyCard} from './plan-v2-cards.js';
import {prepareV2} from './plan-v2-document.js';
import {checkV2} from './plan-v2-view.js';

const plain=v=>String(v??'').replace(/\*\*|==|\[\[|\]\]/g,'');
const stripMoney=value=>{if(Array.isArray(value))return value.map(stripMoney);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['snapshot','stage_snapshot','legacy_range','computed','amount','amount_cents','manual_unit_price','unit_price','quoted_unit_price','pricing','price_cents','price_tbd','budget_cap','discount','ratio_bps'].includes(k)).map(([k,x])=>[k,stripMoney(x)]));return value;};
const moneyWords=value=>typeof value==='string'&&/(?:[¥￥$€£]\s*[0-9零〇一二两三四五六七八九十百千万]|(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]+)\s*(?:万?元|千元|万美元|美元|英镑|欧元|块钱|人民币)|(?:预算|费用|总价|单价|优惠|收费|价格)\s*(?:(?:约|为|是|不超过|上限|控制在|人民币|[:：])\s*)*[0-9零〇一二两三四五六七八九十百千万]+)/u.test(value.normalize('NFKC'))||Array.isArray(value)&&value.some(moneyWords)||value&&typeof value==='object'&&Object.values(value).some(moneyWords);
const labels={basic:'基本信息',assessment:'学员测评',strategy:'学习策略',path:'阶段安排',timeline:'关键节点',courses:'课程安排',teachers:'师资说明',fees:'费用说明',goals:'学习目标',photos:'照片页说明',about:'机构介绍'};
function currentSafe(value,names){
 if(Array.isArray(value))return value.map(x=>currentSafe(x,names));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/(?:phone|parent_name|secret|token|contact|source_lead|student_id|student_name|consultant_id|photo_image|cover_image)/i.test(k)&&!['computed','style','applied_suggestion_ids','snapshot','stage_snapshot'].includes(k)).map(([k,x])=>[k,currentSafe(x,names)]));
 if(typeof value==='string'){let out=value;for(const name of names.filter(x=>x&&x.length>1))out=out.replaceAll(name,'同学');return out.replace(/(?:\+?86[- ]?)?1[3-9]\d{9}/g,'[电话已隐去]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[邮箱已隐去]').replace(/(?:就读于|就读|学校是|目前在)[\p{Script=Han}A-Za-z0-9·（）()]{2,30}(?:小学|中学|高中|学校|学院|大学)/gu,'[就读学校已隐去]');}
 return value;
}
export async function planV2AiContext(r,action,input,user,env,tenant){
 const id=v2Text(input.plan_id,'plan_id',100,false),row=await r.planGet(id);if(!row)fail(404,'不存在','not_found');
 if(row.signed_revision_id||['signed','archived'].includes(row.status))fail(409,'请复制成新方案后生成修改建议','invalid_state');
 const context=JSON.parse((await r.planContext(row.context_id)).doc_json),raw=JSON.parse(row.doc_json),doc=raw.doc_version===2?raw:convertV1(raw,context,row);
 if(input.doc_version!==2||!Number.isInteger(input.plan_version))fail(422,'请提供doc_version=2和方案版本','validation_failed');
 if(input.plan_version!==row.version)versionConflict({id:row.id,version:row.version});
 const scope=input.scope??'auto';if(scope!=='auto'&&!v2Modules.includes(scope))fail(422,'请选择有效版块','validation_failed');
 const instruction=v2Text(input.instruction??'','instruction',action==='brief'?1000:10000,true),brief=action==='brief'||input.brief_version!==undefined?await readBrief(r,env,tenant,row.id):null;
 if(brief&&input.brief_version!==brief.version)versionConflict(brief);
 const original=action==='brief'?brief.text:action==='fill-from-consult'?v2Text(input.consult??'','consult',20000,true):brief?.text||'';
 if(action==='brief'&&!original.trim()&&!instruction.trim())fail(422,'请先描述学员情况或修改要求','validation_failed');
 const catalog=await r.aiCatalog(row.student_id,row.source_lead_id),workspace=await r.planWorkspace({courses:catalog.courses.map(x=>x.id),stages:catalog.stages.map(x=>x.id),teachers:doc.modules.teachers.groups.flatMap(x=>x.members.map(t=>t.teacher_id)).filter(Boolean)}),elements=await r.planElements(row.id),registry=await r.planV2Elements(row.id),prospect=await readProspect(env,tenant,row),names=[context.student?.name,doc.modules.basic.student_name,prospect?.name,prospect?.parent_name];
 const started=now(),references=await structuralReferences(r,{...doc,id:row.id});
 const promptPlan=currentSafe(doc,names);promptPlan.modules.photos={visible:false,pages:[]};
 for(const line of promptPlan.modules.courses.lines){const original=doc.modules.courses.lines.find(x=>x.line_id===line.line_id);line.quoted_unit_price=original?.snapshot?.pricing?.amount_cents==null?null:original.snapshot.pricing.amount_cents/100;}
 return {v2:true,tool:'plan',action,input,row,doc,context,catalog,workspace,elements,registry,scope,original,instruction,rawSources:{brief:original,instruction,plan:JSON.stringify(doc.modules)},target:{plan_id:id,doc_version:2,base_version:row.version,...brief?{brief_version:brief.version}:{},scope},refs:{},warnings:[],reference_audit:{hashes:references.audit,summary_version:1,count:references.audit.length,duration_ms:now()-started},public:{plan:promptPlan,brief:currentSafe(original,names),instruction:currentSafe(instruction,names),scope,action,courses:catalog.courses.filter(x=>x.active).map(x=>({id:x.id,...JSON.parse(x.doc_json),price_cents:x.price_cents})),stage_types:catalog.stages.filter(x=>x.active).map(x=>({id:x.id,...JSON.parse(x.doc_json)})),structural_references:references.structural_references}};
}
export function planV2Protocol(ctx){
 return '仅返回JSON对象 {"suggestions":[{"payload":{"intent":"fill|adjust|mixed","variant":"A","cards":[]}}]}。每组最多60卡，最多3组互斥配课方案。仅给建议，不写业务。'+
 '卡格式为{card_id,module,entity_type,op,entity_id,parent_id,field,after,evidence:{kind,quote,source},depends_on:[]}。module和entity_type及字段白名单：'+JSON.stringify(cardFields)+
 '。已有阶段/课程按原稳定key/line_id定位，不用数组下标；新元素只用tmp_ ID。新增阶段后，其课程组和课程卡必须depends_on对应新增卡。op=add/update/remove；add/remove的field为null，after为完整实体/null，add的after内id/key/line_id须等于entity_id。'+
 '不得输出任何价格、金额、快照、computed、优惠、分期比例或price_tbd；自由课程manual_unit_price留空，不擅自同意价格另议。报价由服务器计算。预算只引用原话，不给金额编辑。'+
 '原话quote必须逐字引用本次brief或instruction；推断kind=inference。before由服务器提供。真实老师姓名、头衔、资历仅可来自原话或已有师资，不凭空编造。文字不用HTML，测评/策略仅可**加粗**和行首-列表。'+
 '默认自动判断填写或修改；本次scope='+ctx.scope+'，指定版块时不得跨版块。'+(ctx.action==='brief'?'必须同时尽力整理文字、提出学习阶段和每阶段课程/数量/频率；已有内容给修改卡，不自动覆盖。':'')+(ctx.action==='polish'?'本动作只润色文字，不修改日期、数量、ID或身份。':'')+
 'structural_references只是去身份的内部结构参考，不在输出、quote或warnings中提及参考来源/数量。';
}
const chineseNum=value=>{const digit={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9},unit={十:10,百:100,千:1000,万:10000};let total=0,section=0,n=0;for(const c of value){if(c in digit)n=digit[c];else if(c==='万'){total+=(section+n||1)*10000;section=0;n=0;}else if(c in unit){section+=(n||1)*unit[c];n=0;}else return null;}return total+section+n;};
export function budgetCandidate(value){
 const sentence=value.split(/[。；;\n]/).find(x=>x.includes('预算'));if(!sentence||/(到|至|[-~–]|美元|美金|欧元|英镑)/.test(sentence))return null;
 const tail=sentence.slice(sentence.indexOf('预算')+2).replace(/^\s*(?:每年|一年|年度|每月|一个月|月度)\s*/,''),match=/^\s*(?:(?:每年|一年|年度|每月|一个月|月度|约|大约|大概|最多|不超过|上限|是|为|控制在|总共|人民币|[:：￥¥])\s*)*((?:\d+(?:\.\d{1,2})?|[零〇一二两三四五六七八九十百千万]+))\s*(万|千)?/.exec(tail);if(!match)return null;
 if(/[万][一二两三四五六七八九]$/.test(match[1]))return null;
 let amount=/^\d/.test(match[1])?Number(match[1]):chineseNum(match[1]);amount*=match[2]==='万'?10000:match[2]==='千'?1000:1;
 if(!Number.isFinite(amount)||amount<0||amount>100000000||Math.abs(amount*100-Math.round(amount*100))>1e-6)return null;
 const rest=tail.slice(match[0].length);if(/\d+[\d.,]*\s*(?:万|千|元)/.test(rest))return null;
 const period=/每年|一年|年度/.test(sentence)?'year':/每月|一个月|月度/.test(sentence)?'month':/总预算|全程|总共/.test(sentence)?'total':'unspecified';
 return {quote:sentence.trim(),budget:{amount,period,note:({total:'总预算',year:'年度预算',month:'月度预算',unspecified:'预算'})[period]+(/约|左右/.test(sentence)?'约':'')+amount+'元'},budget_cap:period==='total'?amount:null};
}
const numberQuoted=(text,value)=>new RegExp('(?<![0-9.])'+String(value).replaceAll('.', '\\.')+'(?![0-9.])').test(text);
function safeFeeUpdate(before,after){
 if(Array.isArray(before)){if(!Array.isArray(after)||after.length!==before.length)throw Error('fees');return before.map((x,i)=>({...x,...typeof after[i]?.label==='string'?{label:after[i].label}:{},...Object.hasOwn(after[i]||{},'due')?{due:after[i].due}:{}}));}
 if(!after||typeof after!=='object'||Object.keys(after).some(k=>!Object.hasOwn(before,k)))throw Error('fees');return {...before,...after};
}
export async function filterPlanV2(parsed,ctx){
 const warnings=[],suggestions=[];let sourceVariants=0;
 for(const raw of parsed.suggestions.slice(0,3)){
  sourceVariants++;const p=raw.payload;if(!Array.isArray(p.cards)||p.cards.length>60)continue;
  let candidate=structuredClone(ctx.doc);const cards=[],ids=new Set(),changes=new Set();
  for(const requested of p.cards){try{
   if(!requested||typeof requested.card_id!=='string'||requested.card_id.length>120||ids.has(requested.card_id)||ctx.scope!=='auto'&&requested.module!==ctx.scope||!cardFields[requested.module+'.'+requested.entity_type])continue;
   if(ctx.action==='polish'&&(!['update'].includes(requested.op)||!['text','name','name_en','title','note','introduction','goals','frequency_text','role'].includes(requested.field)))continue;
   const depends=Array.isArray(requested.depends_on)?requested.depends_on:[];if(depends.some(x=>!ids.has(x)))continue;
   const change=[requested.module,requested.entity_type,requested.entity_id,requested.field].join(':');if(changes.has(change))continue;
   const card={card_id:requested.card_id,module:requested.module,entity_type:requested.entity_type,op:requested.op,entity_id:requested.entity_id??null,parent_id:requested.parent_id??null,field:requested.field??null,after:stripMoney(requested.after),depends_on:depends,label:labels[requested.module]+'建议'};
   if(card.op==='add'&&card.entity_type==='course_line'){card.after.manual_unit_price=null;card.after.price_tbd=false;}
   card.before=cardBefore(ctx.doc,card);
   if(card.module==='fees'&&['custom','fixed','due_dates'].includes(card.field))card.after=safeFeeUpdate(card.before,requested.after);
   if(moneyWords(card.after))continue;
   const evidence=requested.evidence||{},source=['brief','instruction','plan'].includes(evidence.source)?evidence.source:'brief',quote=typeof evidence.quote==='string'?plain(evidence.quote):null,sourceText=plain(ctx.rawSources[source]),verified=evidence.kind!=='inference'&&quote!==null&&quote.length>0&&sourceText.includes(quote);
   card.evidence={kind:verified?'quote':'inference',quote:verified?quote:null,verified,source};card.default_selected=verified&&card.op==='update'&&['basic','assessment','strategy','goals','timeline'].includes(card.module);
   if(card.module==='assessment'&&card.field==='scores'){
    const existing=ctx.doc.modules.assessment.scores;
    if(card.after.some(score=>score.value!==null&&!existing.some(old=>old.id===score.id&&old.label===score.label&&old.value===score.value&&old.max===score.max)&&(!verified||!quote.includes(score.label)||!numberQuoted(quote,score.value)||!numberQuoted(quote,score.max))))continue;
   }
   if(card.entity_type==='teacher'){
    const available=JSON.stringify(ctx.doc.modules.teachers.groups)+'\n'+ctx.original+'\n'+ctx.instruction+'\n'+JSON.stringify(ctx.context.teachers||[]);
    const after=card.op==='add'?card.after:{[card.field]:card.after};
    if(['name','title'].some(k=>after[k]&&typeof after[k]==='string'&&!available.includes(after[k])))continue;
    const claims=String(after.introduction||'').match(/\d+\s*(?:年|届|次|项|位|名)|博士|硕士|教授|副教授|国家级|金奖|银奖|冠军|一等奖|二等奖/g)||[];
    if(claims.some(value=>!available.includes(value)))continue;
   }
   if(card.entity_type==='teacher'&&!verified&&card.op==='update'&&['name','title'].includes(card.field)&&JSON.stringify(card.after)!==JSON.stringify(card.before)&&!ctx.context.teachers?.some(x=>x.name===card.after))continue;
   if(card.entity_type==='teacher'&&!verified&&['add'].includes(card.op)){card.after.name='';card.after.title='';card.after.introduction='';card.after.proposed=true;}
   const next=structuredClone(candidate);applyCard(next,card);prepareV2(next,ctx.doc,ctx.workspace,ctx.elements,ctx.registry,ctx.doc.style,true);candidate=next;cards.push(card);ids.add(card.card_id);changes.add(change);
  }catch{continue;}}
  const keptModelCards=cards.length;if(keptModelCards<p.cards.length)warnings.push('部分修改仍需手工处理，已保留本次可用建议。');
  if((ctx.scope==='auto'||ctx.scope==='fees')&&ctx.action!=='polish'){
   const parsedBudget=budgetCandidate(ctx.original+'\n'+ctx.instruction);
   if(parsedBudget&&JSON.stringify(parsedBudget.budget)!==JSON.stringify(ctx.doc.meta.budget)){
    const card={card_id:'server_budget_'+sourceVariants,module:'fees',entity_type:'budget',op:'update',entity_id:null,parent_id:null,field:null,before:{budget:ctx.doc.meta.budget,budget_cap:ctx.doc.meta.budget_cap},after:{budget:parsedBudget.budget,budget_cap:parsedBudget.budget.period==='total'?parsedBudget.budget_cap:ctx.doc.meta.budget_cap},evidence:{kind:'quote',quote:parsedBudget.quote,verified:true,source:ctx.original.includes(parsedBudget.quote)?'brief':'instruction'},depends_on:[],default_selected:false,label:'请确认预算及周期'};
    if(cards.length<60){applyCard(candidate,card);cards.push(card);}
   }
  }
  if(!cards.length)continue;
  try{
   const normalized=prepareV2(candidate,ctx.doc,ctx.workspace,ctx.elements,ctx.registry,ctx.doc.style,true),check=checkV2(normalized.doc,ctx.context,JSON.parse(ctx.row.manifest_json),ctx.workspace,ctx.terms||[]);
   if(check.blocking.some(x=>['ad_law_terms','over_budget'].includes(x.code))){warnings.push('部分建议未通过内容或预算检查，已保留其他可用建议。');continue;}
   const modules=new Set(cards.map(c=>c.module)),completion={text:['basic','assessment','strategy','goals','timeline'].some(x=>modules.has(x))?'complete':'not_requested',path:modules.has('path')?'complete':p.cards.some(c=>c?.module==='path')||ctx.scope==='auto'&&ctx.action==='brief'?'partial':'not_requested',courses:modules.has('courses')?(cards.some(c=>c.entity_type==='course_line'&&c.op==='add'&&(!c.after.frequency_text||Object.values(c.after.qty||{}).some(v=>v===null)))?'partial':'complete'):p.cards.some(c=>c?.module==='courses')||ctx.scope==='auto'&&ctx.action==='brief'?'partial':'not_requested'};
   if(completion.path==='partial'||completion.courses==='partial')warnings.push('阶段或课程建议尚未完整生成，可补充情况后再试。');
   if(normalized.doc.computed.issues.unpriced)warnings.push('有自由课程需要填写单价，或由顾问明确选择价格另议。');
   suggestions.push({id:randomId('sg'),kind:'plan.v2.cardset',target:ctx.target,payload:{intent:['fill','adjust','mixed'].includes(p.intent)?p.intent:ctx.action==='adjust'?'adjust':'fill',variant:String(p.variant||sourceVariants).slice(0,20),recommended:suggestions.length===0,cards,completion,computed:normalized.doc.computed,price_list_rev:ctx.workspace.price_list_rev},basis:[],warnings:[]});
  }catch{warnings.push('部分建议暂不可用，请补充情况后重试或手工调整。');}
 }
 if(!suggestions.length)warnings.push('本次没有可用建议，可补充情况后重试。');
 return {suggestions,warnings:[...new Set(warnings)]};
}
