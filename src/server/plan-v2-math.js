import {planValidation,planMoney,quantityHundredths,centsProduct,allocateCents,quantityKeys,calendarWeeks,coveredMonths} from './plan-math.js';

const money = v => v == null ? null : planMoney(v);
const yuan = v => v === null ? null : v / 100;
const MAX = 10000000000;
const add = (a,b) => {const n=a+b;if(!Number.isSafeInteger(n)||n>MAX)planValidation('方案金额超出支持范围','courses');return n;};
const knownSum = rows => rows.reduce((n,x)=>add(n,x.known),0);
const weights = (total, rows) => {
    const sum=rows.reduce((n,x)=>n+x,0);if(!sum)return rows.map(()=>0);
    const q=rows.map((x,i)=>{const v=BigInt(total)*BigInt(x);return {i,n:Number(v/BigInt(sum)),r:v%BigInt(sum)};});
    const result=q.map(x=>x.n),rest=total-result.reduce((a,b)=>a+b,0);
    for(const row of [...q].sort((a,b)=>a.r===b.r?a.i-b.i:a.r>b.r?-1:1).slice(0,rest))result[row.i]++;
    return result;
};

export function computeV2(doc) {
    const m=doc.modules, lines=[],pending=new Map(m.courses.stage_settings.map(x=>[x.stage_key,x.pending])), stages=m.path.stages.map(s=>{
        const range=s.legacy_range || (s.start_month&&s.end_month?{start:s.start_month+'-01',end:new Date(Date.UTC(Number(s.end_month.slice(0,4)),Number(s.end_month.slice(5,7)),0)).toISOString().slice(0,10)}:null);
        return {key:s.key,months:s.start_month&&s.end_month?coveredMonths(s.start_month+'-01',s.end_month+'-01'):null,calendar_weeks:range?calendarWeeks(range.start,range.end):null,teaching_weeks:s.teaching_weeks??null,weeks_display:s.teaching_weeks??(range?calendarWeeks(range.start,range.end):null),known:0,draft:0,unknown:!!pending.get(s.key),units:0,units_unknown:false,pending:!!pending.get(s.key)};
    }), byStage=new Map(stages.map(s=>[s.key,s])), unassigned={known:0,unknown:false,units:0,units_unknown:false},optional=[];
    let hasTbd=false,unknownUnmarked=false;const bundles=[];
    for(const l of m.courses.lines) {
        const pricing=l.snapshot?.pricing,mode=l.billing_mode,key=quantityKeys[mode],qty=l.qty[key],price=l.pricing_source==='manual'?money(l.manual_unit_price):pricing?.amount_cents??null;
        const tbd=l.pricing_source==='manual'&&l.price_tbd===true&&price===null;
        const amount=price===null||qty===null?null:centsProduct(price,qty),units=qty===null?null:mode==='per_unit'?qty:mode==='package'?Math.round(qty*(pricing?.units_per_package??l.units_per_package)*100)/100:l.teaching_units??null;
        const opt=l.optional===true;
        lines.push({line_id:l.line_id,amount:yuan(amount),units,optional:opt,pricing_source:l.pricing_source,price_tbd:tbd});
        if(tbd)hasTbd=true;
        const owner=byStage.get(l.stage_key)||unassigned;if(price===null&&l.pricing_source==='manual'&&!tbd&&!owner.pending)unknownUnmarked=true;
        if(opt){optional.push({line_id:l.line_id,course_id:l.course_id,label:l.name,amount:yuan(amount),price_text:tbd?'另议':price===null?null:'¥'+yuan(price).toFixed(2),price_tbd:tbd});continue;}
        if(!["per_unit","package"].includes(mode)&&qty!==null)bundles.push(l.name+" "+qty+" "+({per_term:"期",per_semester:"学期",per_month:"月"}[mode]));
        const bucket=byStage.get(l.stage_key)||unassigned;
        if(tbd)hasTbd=true;
        if(amount===null&&!tbd&&!bucket.pending)unknownUnmarked=true;
        if(bucket.pending){if(amount!==null)bucket.draft=add(bucket.draft,amount);}else if(amount===null)bucket.unknown=true;else bucket.known=add(bucket.known,amount);
        if(units===null||bucket.pending)bucket.units_unknown=true;else bucket.units+=Math.round(units*100);
    }
    for(const x of m.fees.stage_extras){const b=byStage.get(x.stage_key)||unassigned,v=money(x.amount);if(b.pending){if(v!==null)b.draft=add(b.draft,v);}else if(v===null){b.unknown=true;unknownUnmarked=true;}else b.known=add(b.known,v);}
    const other=m.fees.other_fees.map(x=>({known:money(x.amount)??0,unknown:x.amount===null}));
    if(other.some(x=>x.unknown))unknownUnmarked=true;
    const buckets=[...stages,unassigned,...other],known=knownSum(buckets),unknown=buckets.some(x=>x.unknown),discount=m.fees.discount;
    let discountCents=0,discountInvalid=false;
    if(!unknown){discountCents=discount.type==='fixed'?money(discount.amount):discount.type==='percent'?Number((BigInt(known)*BigInt(discount.rate_bps)+5000n)/10000n):0;discountInvalid=discountCents>known;}
    const complete=!unknown&&!discountInvalid,total=complete?known-discountCents:null;
    let installments=[],installmentStatus=complete?'balanced':'pending_quote';
    if(complete){
        if(m.fees.installments==='custom'){
            const values=allocateCents(total,m.fees.custom.map(x=>x.ratio_bps));
            installments=m.fees.custom.map((x,i)=>({stage_key:x.stage_key,label:x.label,due:x.due,amount:yuan(values[i])}));
        }else if(m.fees.installments==='fixed'){
            installments=m.fees.fixed.map(x=>({stage_key:x.stage_key,label:x.label,due:x.due,amount:x.amount}));
            if(installments.some(x=>x.amount===null)||installments.reduce((n,x)=>n+(money(x.amount)??0),0)!==total)installmentStatus='unbalanced';
        }else{
            const rows=stages.map((s,i)=>({stage_key:s.key,label:'第'+(i+1)+'期 · '+m.path.stages[i].name,due:m.fees.due_dates[s.key]??null,value:s.known}));
            if(unassigned.known)rows.push({stage_key:null,label:'未分阶段课程及费用',due:null,value:unassigned.known});
            if(other.length)rows.push({stage_key:null,label:'其他费用',due:null,value:knownSum(other)});
            const shares=weights(discountCents,rows.map(x=>x.value));
            installments=rows.map((x,i)=>({stage_key:x.stage_key,label:x.label,due:x.due,amount:yuan(x.value-shares[i])}));
        }
    }
    const unitsKnown=[...stages,unassigned].reduce((n,s)=>n+s.units,0)/100,unitsUnknown=[...stages,unassigned].some(s=>s.units_unknown),cap=money(doc.meta.budget_cap),budget=doc.meta.budget;
    let comparable=null,reason=null;
    if(budget.amount===null)reason='budget_unspecified';
    else if(!complete)reason='pending_quote';
    else if(budget.period==='total')comparable=total;
    else {const first=[...m.path.stages].filter(s=>s.start_month).sort((a,b)=>a.start_month.localeCompare(b.start_month))[0],last=[...m.path.stages].filter(s=>s.end_month).sort((a,b)=>b.end_month.localeCompare(a.end_month))[0];if(first&&last&&first.start_month&&last.end_month&&(budget.period==='month'&&first.start_month===last.end_month||budget.period==='year'&&first.start_month.slice(5)==='01'&&last.end_month===first.start_month.slice(0,4)+'-12'))comparable=total;else reason='period_not_comparable';}
    const first=[...m.path.stages].filter(s=>s.start_month).sort((a,b)=>a.start_month.localeCompare(b.start_month))[0],last=[...m.path.stages].filter(s=>s.end_month).sort((a,b)=>b.end_month.localeCompare(a.end_month))[0],span=first?.start_month&&last?.end_month?coveredMonths(first.start_month+'-01',last.end_month+'-01'):null;
    const result={currency:'CNY',stages:stages.map(s=>({key:s.key,months:s.months,calendar_weeks:s.calendar_weeks,teaching_weeks:s.teaching_weeks,weeks_display:s.weeks_display,units:s.units_unknown?null:s.units/100,known_units:s.units/100,amount:s.unknown?null:yuan(s.known),known_amount:yuan(s.known),draft_amount:s.pending?yuan(s.draft):null,pending:s.pending})),lines,unassigned:{amount:unassigned.unknown?null:yuan(unassigned.known),known_amount:yuan(unassigned.known),units:unassigned.units_unknown?null:unassigned.units/100,known_units:unassigned.units/100},subtotal:{amount:unknown?null:yuan(known),known_amount:yuan(known)},discount:{amount:unknown||discountInvalid?null:yuan(discountCents),known_amount:unknown||discountInvalid?0:yuan(discountCents)},total:{amount:yuan(total),known_amount:yuan(complete?total:known),units:unitsUnknown?null:unitsKnown,known_units:unitsKnown,bundles,complete,has_tbd:hasTbd},installments,installment_status:installmentStatus,optional_fees:optional,budget:{cap:yuan(cap),remaining:cap===null||total===null?null:yuan(cap-total),over:total===null?null:cap!==null&&total>cap},budget_comparison:{period:budget.period,cap:budget.amount,comparable_amount:yuan(comparable),over:comparable===null?null:comparable>money(budget.amount),reason},cover_numbers:[{label:'规划周期',value:span===null?'':String(span),unit:'个月',sub:span===null?'':first.start_month.replace('-','.')+' – '+last.end_month.replace('-','.')}]};
    Object.defineProperty(result,'issues',{value:{unpriced:unknownUnmarked,discount_invalid:discountInvalid},enumerable:false});return result;
}
