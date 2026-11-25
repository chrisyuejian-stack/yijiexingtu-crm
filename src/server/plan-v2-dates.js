import {planDate,planValidation} from './plan-math.js';
export function shiftDate(value,months){
    if(value===null)return null;planDate(value);const [y,m,d]=value.split('-').map(Number),n=y*12+m-1+months,ny=Math.floor(n/12),nm=n%12+1;
    if(ny<2000||ny>2100)planValidation('平移后的日期超出支持范围','months');
    return String(ny).padStart(4,'0')+'-'+String(nm).padStart(2,'0')+'-'+String(Math.min(d,new Date(Date.UTC(ny,nm,0)).getUTCDate())).padStart(2,'0');
}
export function shiftV2(doc,months){
    if(!Number.isInteger(months)||months<-120||months>120)planValidation('月份平移须为-120至120的整数','months');
    const out=structuredClone(doc),changes=[],move=(owner,key,path,month=false)=>{if(owner[key]==null)return;const before=owner[key],after=shiftDate(month?before+'-01':before,months);owner[key]=month?after.slice(0,7):after;if(before!==owner[key])changes.push({path,before,after:owner[key]});};
    move(out.modules.basic,'plan_date','modules.basic.plan_date');move(out.meta,'start_month','meta.start_month',true);move(out.meta.target,'month','meta.target.month',true);
    for(const s of out.modules.path.stages){for(const key of ['start_month','end_month'])move(s,key,'modules.path.stages[key='+s.key+'].'+key,true);if(s.legacy_range){move(s.legacy_range,'start','path.legacy_range.start');move(s.legacy_range,'end','path.legacy_range.end');}for(const n of s.nodes)move(n,'date','path.nodes[id='+n.id+'].date');}
    for(const n of out.modules.timeline.items)move(n,'date','timeline.items[id='+n.id+'].date');
    for(const f of [...out.modules.fees.custom,...out.modules.fees.fixed])move(f,'due','fees.installments.due');
    for(const key of Object.keys(out.modules.fees.due_dates))move(out.modules.fees.due_dates,key,'fees.due_dates.'+key);
    return {doc:out,changes};
}
