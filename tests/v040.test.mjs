import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {school,call,ok,draft,seed,course,filled,model,content,ai,accountToken} from './fixtures-ai.mjs';
import {contentFlags} from '../src/server/content-flags.js';
import {encrypt,decrypt} from '../src/server/crypto.js';
import {startBackup} from '../src/server/backup.js';
const newProspect=async(s,p={},create_lead=false)=>ok(await call(s,'plans','POST',{title:'意向方案',subject:'music_interest',prospect:{name:'王小明',grade:'初二',parent_name:'王家长',parent_phone:'13800001234',...p},create_lead}),201);
const convert=(s,p,extra={})=>call(s,'plans/'+p.id+'/convert-student','POST',{version:p.version,...extra});
test('v040 A 创意无出处仍保留，语气、素材原文和温度进入模型，flags持久化及过期重放',()=>school(async s=>{
 const c=await content(s);model(s,{suggestions:[{payload:{versions:{short:'音乐像星光',medium:'自由想象',long:'【待填：开课日期】 最棒的钢琴课'}},basis:[{type:'rule',ref:'不存在',quote:'虚构'}]}]});
 const key=crypto.randomUUID(),input={content_id:c.id,tone:'playful',references:'  网页文字 https://example.test/\n原样保留  '};const r=ok(await ai(s,'content/versions',input,key));
 assert.equal(r.suggestions.length,1);assert.deepEqual(r.suggestions[0].basis,[]);assert.ok(r.suggestions[0].flags.some(f=>f.kind==='placeholder'));
 const req=s.modelCalls[0],u=JSON.parse(req.messages[1].content);assert.equal(req.temperature,1.1);assert.equal(u.tone,'playful');assert.equal(u.user_references,input.references);assert.match(req.messages[0].content,/可以自由创作/);
 await s.r.aiCleanup(Date.now()+600001);assert.deepEqual(ok(await ai(s,'content/versions',input,key)),r);
 ok(await ai(s,'content/versions',{content_id:c.id,tone:'bad'}),422);ok(await ai(s,'content/versions',{content_id:c.id,references:'a'.repeat(8001)}),422);
}));
test('v040 A 六类flags仅提醒，quote均在正文；确定价格、名称、电话地址比对',()=>{
 const text='最顶级 唯一 第一 保过 包过 100% 国家级 机构禁用 王小明 钢琴课每节 180 元，机构地址：错误路，电话：13800009999。课程名称：不存在课。老师姓名：不存在老师。去年12人考入九大音乐学院。【待填：日期】';
 const flags=contentFlags(text,{terms:['机构禁用'],students:['王小明'],courses:[{name:'钢琴课',price_cents:20000}],teachers:['陈老师'],profile:{address:'正确路1号',contact_phone:'13800001234'}});
 for(const kind of ['ad_law','banned','fact_mismatch','needs_confirm','privacy','placeholder'])assert.ok(flags.some(f=>f.kind===kind),kind);
 assert.ok(flags.every(f=>text.includes(f.quote)));assert.ok(flags.filter(f=>f.kind==='fact_mismatch').length>=4);
 assert.equal(contentFlags('共同寻找自己喜欢的声音',{courses:[{name:'钢琴课',price_cents:20000}]}).length,0);
});
test('v040 A content格式容错仍生效，真实姓名提示且模型不接收学生名单；plan咨询严格核验',()=>school(async s=>{
 const c=await content(s);const name=s.f.db.raw.prepare('SELECT name FROM students WHERE tenant_id=? LIMIT 1').get(s.t.id).name;
 model(s,{suggestions:[{payload:{content:[{type:'h2',content:'标题'},{type:'ul',items:['保过 '+name,'【待填：老师姓名】']}]}}]});
 const r=ok(await ai(s,'content/section',{content_id:c.id,section_key:'intro'}));assert.equal(r.suggestions[0].payload.blocks[0].level,2);assert.ok(r.suggestions[0].flags.some(x=>x.kind==='privacy'));assert.ok(!s.modelCalls[0].messages[1].content.includes(name));
 const p=await draft(s);model(s,{suggestions:[{payload:{fields:[{path:'title',value:'无出处',quote:'伪造原话'}]}}]});const strict=ok(await ai(s,'plan/fill-from-consult',{plan_id:p.id,consult:'想学钢琴'}));assert.equal(strict.suggestions.length,0);assert.equal(s.modelCalls[0].temperature,undefined);
}));
test('v040 A fact-check结果仅ok/mismatch/needs_confirm，文案仍可保存',()=>school(async s=>{
 const c=await content(s);model(s,{suggestions:[{payload:{items:[{block_index:0,quote:'机构地址是上海测试路8号',source:'missing'}]}}]});
 const r=ok(await ai(s,'content/fact-check',{content_id:c.id}));assert.ok(['ok','mismatch','needs_confirm'].includes(r.suggestions[0].payload.items[0].result));
 ok(await call(s,'content/'+c.id,'PUT',{version:c.version,blocks:[{type:'paragraph',text:'顶级 包过 【待填：日期】'}]}));
}));
test('v040 B 三种来源、互斥与筛选；意向加密且不在文档/列表/审计中出现手机号',()=>school(async s=>{
 const p=await newProspect(s);const leadP=await newProspect(s,{name:'赵同学'},true);await draft(s);
 const rows=ok(await call(s,'plans')).items;assert.ok(rows.some(x=>x.party==='student'));assert.ok(rows.some(x=>x.party==='lead'));assert.ok(rows.some(x=>x.party==='prospect'));
 assert.equal(ok(await call(s,'plans?party=prospect')).items.length,1);ok(await call(s,'plans?party=invalid'),422);
 const db=s.f.db.raw,row=db.prepare('SELECT * FROM plan_prospects WHERE tenant_id=? AND id=?').get(s.t.id,p.id);assert.ok(row.data_enc);assert.equal(row.phone_last4,'1234');
 for(const table of ['plans','plan_contexts','plan_revisions','audit_log'])assert.ok(!JSON.stringify(db.prepare('SELECT * FROM '+table+' WHERE tenant_id=?').all(s.t.id)).includes('13800001234'),table);
 assert.ok(!JSON.stringify(rows).includes('13800001234'));assert.equal(p.student_id,null);assert.equal(p.source_lead_id,null);
 const lead=await s.r.businessGet('leads',leadP.source_lead_id);assert.equal(lead.stage,'contacted');assert.equal(lead.source,'方案');assert.equal(lead.phone_last4,'1234');assert.equal(await decrypt(s.f.env,lead.parent_phone_enc,s.t.id+':phone'),'13800001234');
 const existing=ok(await call(s,'plans','POST',{lead_id:lead.id,title:'已有线索',subject:'music_interest'}),201);assert.equal(existing.source_lead_id,lead.id);
 for(const extra of [{},{student_id:s.students[0],prospect:{name:'冲突'}},{student_id:s.students[0],lead_id:lead.id},{prospect:{name:'x'.repeat(41)}}])ok(await call(s,'plans','POST',{title:'无效',subject:'music_interest',...extra}),422);
}));
test('v040 B 意向可继续保存、复制、AI；转换只建档、保留意向和分享、版本/重复转换受控',()=>school(async s=>{
 let p=await newProspect(s);p=ok(await call(s,'plans/'+p.id,'PUT',{version:p.version,title:'已保存'}));
 const copy=ok(await call(s,'plans/'+p.id+'/duplicate','POST',{}),201);assert.equal(copy.source_lead_id,null);assert.ok(await s.r.planGet(copy.id));
 model(s,{suggestions:[{payload:{fields:[{path:'title',value:'来自粘贴',quote:'咨询原话'}]}}]});assert.equal(ok(await ai(s,'plan/fill-from-consult',{plan_id:p.id,consult:'咨询原话'})).suggestions.length,1);
 const before={};for(const t of ['packages','student_payments','package_transactions','schedule_enrollments'])before[t]=s.f.db.raw.prepare('SELECT COUNT(*) n FROM '+t+' WHERE tenant_id=?').get(s.t.id).n;
 ok(await convert(s,p,{version:p.version+1}),409);const v=ok(await convert(s,p,{overrides:{name:'转正后姓名'}}));assert.ok(v.student_id);assert.equal(v.version,p.version+1);
 const st=await s.r.businessGet('students',v.student_id);assert.equal(st.name,'转正后姓名');assert.equal(st.status,'active');assert.equal(st.parent_consent_media,0);assert.equal(await decrypt(s.f.env,st.parent_phone_enc,s.t.id+':phone'),'13800001234');
 for(const [t,n] of Object.entries(before))assert.equal(s.f.db.raw.prepare('SELECT COUNT(*) n FROM '+t+' WHERE tenant_id=?').get(s.t.id).n,n);
 assert.ok(s.f.db.raw.prepare('SELECT id FROM plan_prospects WHERE tenant_id=? AND id=?').get(s.t.id,p.id));assert.equal(ok(await convert(s,v),409).error,'already_converted');
 ok(await call(s,'plans/'+p.id,'PUT',{version:v.version,student_id:null}),422);
}));
test('v040 B 重复提示、确认新建与关联已有学员；线索转正来源、审计及跟进最近20条',()=>school(async s=>{
 const p=await newProspect(s);const student=ok(await convert(s,p)).student_id;
 const p2=await newProspect(s);const conflict=ok(await convert(s,p2),409);assert.equal(conflict.error,'possible_duplicate');assert.deepEqual(conflict.duplicates,conflict.details.duplicates);assert.equal(conflict.details.duplicates[0].id,student);assert.equal(conflict.details.duplicates[0].phone_last4,'1234');
 const linked=ok(await convert(s,p2,{link_student_id:student}));assert.equal(linked.student_id,student);
 const p3=await newProspect(s);assert.notEqual(ok(await convert(s,p3,{confirm_new:true})).student_id,student);
 const leadP=await newProspect(s,{name:'线索甲'},true);const leadId=leadP.source_lead_id;
 for(let i=0;i<23;i++)s.f.db.raw.prepare('INSERT INTO audit_log(tenant_id,id,at,actor_id,actor_label,module,action,entity_id,summary,after_json) VALUES(?,?,?,?,?,?,?,?,?,?)').run(s.t.id,'follow'+i,Date.now()+i,s.user.id,'测试','leads','update',leadId,'跟进',JSON.stringify([{id:leadId,note:'咨询记录-'+i}]));
 model(s);ok(await ai(s,'plan/fill-from-consult',{plan_id:leadP.id,consult:'本次咨询'}));const ctx=JSON.parse(s.modelCalls[0].messages[1].content);assert.ok(ctx.consult.includes('咨询记录-22'));assert.ok(!ctx.consult.includes('咨询记录-0'));assert.ok(ctx.consult.includes('本次咨询'));
 const v=ok(await convert(s,leadP));assert.equal((await s.r.businessGet('leads',leadId)).stage,'enrolled');assert.equal((await s.r.businessGet('students',v.student_id)).source_lead_id,leadId);
 assert.ok(s.f.db.raw.prepare("SELECT id FROM audit_log WHERE tenant_id=? AND entity_id=? AND action='convert_student'").get(s.t.id,leadP.id));
}));
test('v040 B 建档/线索/方案/审计任何一步失败全回滚；并发同方案只成功一次',()=>school(async s=>{
 const p=await newProspect(s,{name:'回滚甲'},true),db=s.f.db.raw;
 const counts=()=>Object.fromEntries(['students','leads','plans','plan_revisions','plan_contexts','audit_log','tenant_data_versions'].map(t=>[t,JSON.stringify(db.prepare('SELECT * FROM '+t+' WHERE tenant_id=?').all(s.t.id))]));
 const before=counts();db.exec("CREATE TEMP TRIGGER reject_conversion BEFORE INSERT ON audit_log WHEN NEW.action='convert_student' BEGIN SELECT RAISE(ABORT,'test rollback'); END;");ok(await convert(s,p),500);assert.deepEqual(counts(),before);db.exec('DROP TRIGGER reject_conversion');
 const results=await Promise.all([convert(s,p),convert(s,p)]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);assert.equal(db.prepare("SELECT COUNT(*) n FROM students WHERE tenant_id=? AND name='回滚甲'").get(s.t.id).n,1);
}));
test('v040 B 0026只新增表、历史数据不变；意向数据纳入完整加密备份',()=>school(async s=>{
 const db=s.f.db.raw,sql=await readFile('migrations/0026_plan_prospects.sql','utf8');assert.ok(!/\b(?:DROP|UPDATE|DELETE|REPLACE|ALTER)\b/i.test(sql.replace(/--[^\n]*/g,'')));
 const p=await newProspect(s);await startBackup(s.f.env,Date.now());assert.ok(db.prepare("SELECT row_json FROM backup_snapshot_rows WHERE tenant_id=? AND table_name='plan_prospects'").get(s.t.id));assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
}));

test('v040 0026在旧库执行后所有旧表、旧记录和约束逐项不变',async()=>{
 const {fixture}=await import('./support.mjs'),{setup}=await import('./fixtures-credit.mjs');const f=await fixture({migrateProspects:false});
 try{await setup(f,2,'v040migration');const db=f.db.raw,tables=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all(),before=new Map(tables.map(t=>[t.name,JSON.stringify(db.prepare('SELECT * FROM '+t.name).all())]));
 db.exec(await readFile('migrations/0026_plan_prospects.sql','utf8'));
 for(const t of tables){assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(t.name).sql,t.sql);assert.equal(JSON.stringify(db.prepare('SELECT * FROM '+t.name).all()),before.get(t.name),t.name);}
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{f.restore();}
});
test('v040 B 跨机构、未登录、无新建学员权限转换均不泄露不写入',()=>school(async s=>{
 const p=await newProspect(s);ok(await call(s,'plans/'+p.id+'/convert-student','POST',{version:p.version},''),401);
 const noCreate=await accountToken(s,['consultant']);ok(await call(s,'plans/'+p.id+'/convert-student','POST',{version:p.version},noCreate.token),403);
 const {setup}=await import('./fixtures-credit.mjs');const other=await setup(s.f,1,'other040');other.f=s.f;ok(await call(other,'plans/'+p.id+'/convert-student','POST',{version:1}),404);
 ok(await convert(s,p,{link_student_id:other.students[0]}),404);assert.equal((await s.r.planGet(p.id)).version,1);
}));

test('v040 B 转正保留已发送分享链接；恢复转正前修订不会解除学员关联',()=>school(async s=>{
 const sample=await filled(s);let p=await newProspect(s,{name:'分享甲'});
 const modules=structuredClone(sample.modules);modules.path.stages[0].key='tmp_stage';modules.courses.lines[0].line_id='tmp_line';modules.courses.lines[0].stage_key='tmp_stage';
 p=ok(await call(s,'plans/'+p.id,'PUT',{version:p.version,modules}));
 p=ok(await call(s,'plans/'+p.id+'/send','POST',{version:p.version}));
 const link=ok(await call(s,'plans/'+p.id+'/share-links','POST',{}),201),url='/api/share/'+link.url.split('/').at(-1),before=ok(await call(s,url));
 const student=ok(await convert(s,p)),after=ok(await call(s,url));assert.deepEqual(after,before);
 const restored=ok(await call(s,'plans/'+p.id+'/revisions/'+p.current_revision_id+'/restore','POST',{version:student.version}));assert.equal(restored.student_id,student.student_id);
 assert.equal(ok(await convert(s,restored),409).error,'already_converted');
}));
test('v040 A 格式错误、超长和明确不安全内容丢弃，不因合规/无出处而丢弃',()=>school(async s=>{
 const c=await content(s);model(s,{suggestions:[{payload:{versions:{short:'教你制造炸弹教程',medium:'教你制造炸弹教程',long:'教你制造炸弹教程'}}},{payload:{versions:{short:'a'.repeat(20001),medium:'中',long:'长'}}},{payload:{versions:{short:'创意故事，包过',medium:'常识比喻',long:'自由创作'}}}]});
 const r=ok(await ai(s,'content/versions',{content_id:c.id}));assert.equal(r.suggestions.length,1);assert.ok(r.suggestions[0].flags.some(f=>f.kind==='ad_law'));assert.equal(r.suggestions[0].payload.versions.short,'创意故事，包过');
}));
