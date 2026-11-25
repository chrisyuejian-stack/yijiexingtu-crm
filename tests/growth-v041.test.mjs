import test from 'node:test';
import assert from 'node:assert/strict';
import {growthSchool,batch,ok,call} from './fixtures-growth.mjs';
import {model,ai} from './fixtures-ai.mjs';

test('V041 G1 批量报告全部超时返回ai_timeout，逐人原因timeout且不计次',()=>growthSchool(async s=>{
 const b=await batch(s,{student_ids:[s.students[0]]}),old=Date.now;let clock=old();Date.now=()=>clock;
 try{model(s,req=>{assert.equal(req.deadline_at-clock,45000);clock+=46000;return {suggestions:[]}});assert.equal(ok(await ai(s,'report/batch-draft',{batch_id:b.batch.id,student_ids:[s.students[0]]}),502).error,'ai_timeout');const rows=s.f.db.raw.prepare('SELECT result FROM ai_usage WHERE tenant_id=?').all(s.t.id);assert.equal(rows.length,1);assert.equal(rows[0].result,'timeout');assert.equal(ok(await call(s,'ai/usage')).fast.used,0)}finally{Date.now=old}
}));

test('V041 G1 批量报告HTTP402逐人记录原因，保持整批截止和零扣次',()=>growthSchool(async s=>{
 const b=await batch(s);model(s,()=>{const e=Error('provider content not logged');e.ai_failure_reason='provider_http_402';throw e});assert.equal(ok(await ai(s,'report/batch-draft',{batch_id:b.batch.id,student_ids:s.students}),502).error,'ai_unavailable');assert.equal(s.modelCalls.length,s.students.length);assert.equal(new Set(s.modelCalls.map(x=>x.deadline_at)).size,1);for(const x of s.f.db.raw.prepare('SELECT result FROM ai_usage WHERE tenant_id=?').all(s.t.id))assert.equal(x.result,'provider_http_402');assert.equal(ok(await call(s,'ai/usage')).fast.used,0);
}));

test('V041 G1 批量报告剩余不足30秒停止解析重试，protocol_invalid不计次',()=>growthSchool(async s=>{
 const b=await batch(s,{student_ids:[s.students[0]]}),old=Date.now;let clock=old();Date.now=()=>clock;
 try{model(s,()=>{clock+=16000;return {content:'invalid'}});ok(await ai(s,'report/batch-draft',{batch_id:b.batch.id,student_ids:[s.students[0]]}),502);assert.equal(s.modelCalls.length,1);assert.equal(s.f.db.raw.prepare('SELECT result FROM ai_usage WHERE tenant_id=?').get(s.t.id).result,'protocol_invalid');assert.equal(ok(await call(s,'ai/usage')).fast.used,0)}finally{Date.now=old}
}));
