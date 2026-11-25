import {HttpError} from './core.js';
// Server-only bounded deadlines and safe failure labels. Never persist model text.
export function aiTimeoutMs(tool, action, tier,docVersion=1) {
  const long = tool==='plan'&&(docVersion===2||action==='brief') || tool === 'content' && ['section','versions','rewrite'].includes(action) || tool === 'plan' && ['fill-from-consult','adjust'].includes(action);
  return long ? (tier === 'fast' ? 120000 : 150000) : (tier === 'fast' ? 45000 : 90000);
}
export function aiMaxTokens(tool, action, tier,docVersion=1) {
  if(tool==='plan'&&docVersion===2)return 8192;
  return tool === 'content' && action === 'section' ? 4096 : tool === 'content' && action === 'versions' ? 6144 : tier === 'fast' ? 4096 : 8192;
}
export function aiFault(reason) { const e = new Error('AI request failed'); e.ai_failure_reason = reason; return e; }
export function aiFailureReason(e) {
  if (['AI_DEADLINE','deadline'].includes(e?.message) || ['AbortError','TimeoutError'].includes(e?.name)) return 'timeout';
  if (e?.message === 'AI_PROTOCOL_INVALID') return 'protocol_invalid';
  if (e?.message === 'AI_RESPONSE_SIZE') return 'response_too_large';
  const code=e?.ai_failure_reason;
  if (['timeout','protocol_invalid','response_too_large','other'].includes(code) || /^provider_http_[1-5]\d\d$/.test(code||'')) return code;
  if (!(e instanceof HttpError) && Number.isInteger(e?.status) && e.status>=100 && e.status<=599) return 'provider_http_'+e.status;
  return 'other';
}
export function planTextProtocol(ctx) {
  if(ctx.tool!=='plan'||ctx.action==='stage-courses'||ctx.action==='adjust'&&ctx.input.page==='courses')return '';
  let paths=['title','modules.cover.eyebrow','modules.cover.subtitle','modules.assessment.text','modules.assessment.source_note','modules.assessment.strengths','modules.assessment.gaps','modules.assessment.goals','modules.fees.note',
    ...ctx.doc.modules.path.stages.flatMap(x=>['name','goals'].map(k=>'modules.path.stages[key='+x.key+'].'+k)),
    ...ctx.doc.modules.courses.lines.flatMap(x=>['frequency_text','note','includes'].map(k=>'modules.courses.lines[line_id='+x.line_id+'].'+k))];
  if(ctx.action==='fill-from-consult')paths.push('meta.start_month','meta.budget_cap','meta.target.node_key','meta.target.month','meta.target.text');
  if(ctx.action==='adjust')paths=paths.filter(p=>p.startsWith('modules.'+ctx.input.page+'.')||ctx.input.page==='cover'&&p==='title');
  return '\n本动作文字允许写入的位置为：'+JSON.stringify(paths)+'。必须使用完整modules.前缀和给定稳定ID。机构介绍about不生成。数组字段strengths/gaps/goals用字符串数组。完整格式示例：'+JSON.stringify({suggestions:[{payload:{fields:[...(paths.length?[{path:paths[0],value:/\.(strengths|gaps|goals)$/.test(paths[0])?['根据咨询整理的要点']:'根据咨询整理的文字',quote:'必须替换为实际咨询原句'}]:[])]},basis:[],warnings:[]}]})+'。示例quote仅示意，实际必须逐字引用本次原文；不要输出金额。';
}
