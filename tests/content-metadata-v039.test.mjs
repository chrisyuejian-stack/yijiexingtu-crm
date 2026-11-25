import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fixture} from './support.mjs';
import {setup} from './fixtures-credit.mjs';
import {school,call,ok,content,model,ai,accountToken} from './fixtures-ai.mjs';
import {growthSchool,batch,submitFeedback,confirmFeedback,readyDoc} from './fixtures-growth.mjs';
import {proposal,decide} from './fixtures-mobile.mjs';
import {parent} from './fixtures-plans.mjs';
const metadata={column:'招生 · 寒假集训',header_image_id:null,author:'星光琴行',publish_date:'2026-11-20',footer:{qr:true,address:true}};
async function image(s,id='img_article') {await s.r.settingsGalleryCreate({id,r2_key:'local/'+id,mime:'image/png',width:100,height:100,tags:[],consent:false},s.user);return id}
const put=(s,c,data)=>call(s,'content/'+c.id,'PUT',{version:c.version,...data});
const report=async(s,r,token=s.token)=>ok(await call(s,"reports/"+r.id,"GET",undefined,token));

test('YX39 0025仅加默认列，0024旧行原列原值保留，无回填即可读写',async()=>{
 const f=await fixture({migrateArticle:false});try{
 const s=await setup(f,1,'old39');s.f=f;const db=f.db.raw,doc={type:'article',subject:'music_interest',scene:null,title:'旧文章',style:{pack_id:'stp_article',pack_version:'1.0.0'},brief:'',sources:{profile:false,prices:false,course_ids:[],gallery_tags:[]},blocks:[{type:'paragraph',text:'旧正文'}],applied_suggestion_ids:[]},manifest=db.prepare("SELECT manifest_json FROM style_pack_versions WHERE pack_id='stp_article'").get().manifest_json;
 db.prepare('INSERT INTO content_items(tenant_id,id,type,subject,title,doc_json,manifest_json,author_id,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(s.t.id,'legacy_article','article','music_interest','旧文章',JSON.stringify(doc),manifest,s.user.id,1,1,s.user.id);
 assert.equal(ok(await call(s,'content/legacy_article')).article,null);
 const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name),before=names.map(n=>({n,cols:db.prepare('PRAGMA table_info('+n+')').all().map(x=>x.name),rows:db.prepare('SELECT * FROM '+n).all().map(x=>JSON.stringify(x))}));
 db.exec(await readFile('migrations/0025_article_metadata.sql','utf8'));
 for(const x of before)assert.deepEqual(db.prepare('SELECT '+x.cols.join(',')+' FROM '+x.n).all().map(x=>JSON.stringify(x)),x.rows,x.n);
 assert.equal(db.prepare('SELECT article_json FROM content_items').get().article_json,'null');
 const old=ok(await call(s,'content/legacy_article'));const saved=ok(await put(s,old,{title:'旧文章继续编辑'}));assert.equal(saved.article,null);assert.equal(saved.blocks[0].text,'旧正文');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{f.restore()}
});

test('YX39 文章元数据整体替换、省略保留、null清除，旧字段与409最新对象保留',()=>school(async s=>{
 let c=await content(s);assert.equal(c.article,null);
 c=ok(await put(s,c,{article:metadata}));assert.deepEqual(c.article,metadata);assert.equal(c.tenant_id,undefined);
 const v=c.version;c=ok(await put(s,c,{title:'保留元数据'}));assert.deepEqual(c.article,metadata);
 const conflict=ok(await call(s,'content/'+c.id,'PUT',{version:v,article:null}),409);assert.deepEqual(conflict.details.latest.article,metadata);
 c=ok(await put(s,c,{article:{author:'另一作者'}}));assert.deepEqual(c.article,{author:'另一作者'});
 c=ok(await put(s,c,{article:null}));assert.equal(c.article,null);
}));

test('YX39 状态更新保留article，修订JSON锁定元数据与头图引用',()=>school(async s=>{
 const id=await image(s);let c=await content(s,{article:{...metadata,header_image_id:id}});
 const raw=await s.r.contentGet(c.id);assert.equal(JSON.parse(raw.doc_json).article,undefined);
 c=ok(await call(s,'content/'+c.id+'/status','POST',{version:c.version,status:'copied'}));assert.equal(c.article.header_image_id,id);
 const rows=s.f.db.raw.prepare('SELECT doc_json FROM content_revisions WHERE tenant_id=? AND content_id=? ORDER BY seq').all(s.t.id,c.id);assert.equal(rows.length,2);for(const r of rows)assert.equal(JSON.parse(r.doc_json).article.header_image_id,id);
 assert.equal(s.f.db.raw.prepare("SELECT COUNT(*) n FROM setting_asset_refs WHERE tenant_id=? AND image_id=? AND entity='content_revision'").get(s.t.id,id).n,2);
 assert.throws(()=>s.f.db.raw.prepare("UPDATE content_revisions SET doc_json='{}' WHERE tenant_id=?").run(s.t.id),/content_revision_immutable/);
}));

test('YX39 文章文字长度、真实日期和布尔开关校验失败不写入',()=>school(async s=>{
 let c=await content(s);
 for(const article of [{column:'字'.repeat(21)},{author:'字'.repeat(21)},{publish_date:'2026-2-01'},{publish_date:'2026-02-30'},{publish_date:1},{footer:{qr:'true'}},{footer:{address:1}},{footer:[]},[],{header_image_id:12}]){ok(await put(s,c,{article}),422);assert.equal(ok(await call(s,'content/'+c.id)).version,c.version)}
 c=ok(await put(s,c,{article:{column:'字'.repeat(20),author:'字'.repeat(20),publish_date:'2028-02-29',footer:{qr:false,address:false}}}));assert.equal(c.article.publish_date,'2028-02-29');
 c=ok(await put(s,c,{article:{publish_date:''}}));assert.deepEqual(c.article,{publish_date:null});
}));

test('YX39 头图本机构归属校验，缺失/跨机构/已删均422 invalid_image且原子不写',()=>school(async s=>{
 const other=await setup(s.f,1,'foreign39');other.f=s.f;const foreign=await image(other,'img_foreign39'),own=await image(s,'img_deleted39');s.f.db.raw.prepare('UPDATE gallery_images SET deleted_at=1 WHERE tenant_id=? AND id=?').run(s.t.id,own);
 const c=await content(s);const before=s.f.db.raw.prepare('SELECT COUNT(*) n FROM content_revisions').get().n;
 for(const id of ['img_missing',foreign,own]){const e=ok(await put(s,c,{article:{header_image_id:id},tenant_id:other.t.id}),422);assert.equal(e.error,'invalid_image');assert.equal(ok(await call(s,'content/'+c.id)).version,c.version)}
 assert.equal(s.f.db.raw.prepare('SELECT COUNT(*) n FROM content_revisions').get().n,before);
}));

test('YX39 新选隐藏头图被拒，原头图隐藏后可继续保存，未知article属性不落库',()=>school(async s=>{
 const id=await image(s),c=await content(s,{article:{header_image_id:id,footer:{qr:true,address:false,html:'<script>bad</script>'},tenant_id:'foreign'}});
 assert.equal(c.article.tenant_id,undefined);assert.equal(c.article.footer.html,undefined);
 s.f.db.raw.prepare('UPDATE gallery_images SET hidden=1 WHERE tenant_id=? AND id=?').run(s.t.id,id);
 const saved=ok(await put(s,c,{brief:'继续保存'}));assert.equal(saved.article.header_image_id,id);
 const other=await content(s);assert.equal(ok(await put(s,other,{article:{header_image_id:id}}),422).error,'invalid_image');
}));

test('YX39 头图检查后被删除时事务回滚并返回invalid_image',()=>school(async s=>{
 const id=await image(s);const c=await content(s);const batch=s.f.db.batch.bind(s.f.db);let injected=false;
 s.f.db.batch=async ops=>{if(!injected&&ops.some(x=>x.query.startsWith('UPDATE content_items SET'))){injected=true;s.f.db.raw.prepare('UPDATE gallery_images SET deleted_at=1 WHERE tenant_id=? AND id=?').run(s.t.id,id)}return batch(ops)};
 try{assert.equal(ok(await put(s,c,{article:{header_image_id:id}}),422).error,'invalid_image')}finally{s.f.db.batch=batch}
 assert.equal(ok(await call(s,'content/'+c.id)).version,c.version);assert.equal(ok(await call(s,'content/'+c.id)).article,null);
}));

test('YX39 跨机构内容访问仍404，finance不能写article',()=>school(async s=>{
 const c=await content(s,{article:metadata});const other=await setup(s.f,1,'other-39');other.f=s.f;
 ok(await other.call('content/'+c.id),404);ok(await other.call('content/'+c.id,'PUT',{version:c.version,article:metadata}),404);
 const fin=await accountToken(s,['finance']);ok(await call(s,'content/'+c.id,'PUT',{version:c.version,article:null},fin.token),403);assert.deepEqual(ok(await call(s,'content/'+c.id)).article,metadata);
}));

test('YX39 AI起草/改写不发送或修改article，模型伪造的article被剔除',()=>school(async s=>{
 const c=await content(s,{article:metadata});const before=await s.r.contentGet(c.id);
 model(s,{suggestions:[{payload:{versions:{short:'建议短文',medium:'建议正文',long:'建议长文'},article:{author:'模型篡改'}}}]});
 const v=ok(await ai(s,'content/versions',{content_id:c.id}));assert.ok(v.suggestions.length);assert.equal(v.suggestions[0].payload.article,undefined);
 model(s,{suggestions:[{payload:{blocks:[{type:'paragraph',text:'润色建议'}],article:{footer:{qr:false}}}}]});
 const rewritten=ok(await ai(s,'content/rewrite',{content_id:c.id,block_index:0,mode:'polish'}));assert.ok(rewritten.suggestions.length);assert.equal(rewritten.suggestions[0].payload.article,undefined);
 assert.ok(s.modelCalls.every(x=>!JSON.stringify(x).includes('招生 · 寒假集训')));
 assert.deepEqual(await s.r.contentGet(c.id),before);assert.deepEqual(ok(await call(s,'content/'+c.id)).article,metadata);
}));

test('YX39 人工采用正文建议时未带article仍保留；AI不改品牌或机构地址',()=>school(async s=>{
 const c=await content(s,{article:metadata});model(s,{suggestions:[{payload:{blocks:[{type:'paragraph',text:'人工采用建议'}],article:null}}]});
 const advice=ok(await ai(s,'content/rewrite',{content_id:c.id,block_index:0,mode:'polish'}));const pick=advice.suggestions[0];
 const before=s.f.db.raw.prepare('SELECT * FROM tenant_brand WHERE tenant_id=?').all(s.t.id),profileBefore=s.f.db.raw.prepare('SELECT * FROM tenant_profile WHERE tenant_id=?').all(s.t.id);
 const saved=ok(await put(s,c,{blocks:pick.payload.blocks,applied_suggestion_ids:[pick.id]}));assert.deepEqual(saved.article,metadata);assert.equal(saved.blocks[0].text,'人工采用建议');assert.deepEqual(s.f.db.raw.prepare('SELECT * FROM tenant_brand WHERE tenant_id=?').all(s.t.id),before);assert.deepEqual(s.f.db.raw.prepare('SELECT * FROM tenant_profile WHERE tenant_id=?').all(s.t.id),profileBefore);
}));

test('YX39 新article列与修订article进入完整备份，不遗漏头图元数据',()=>school(async s=>{
 const c=await content(s,{article:metadata});const {backupTables}=await import('../src/server/backup-model.js');assert.ok(backupTables.content_items.columns.includes('article_json'));
 const {startBackup}=await import('../src/server/backup.js');await startBackup(s.f.env,Date.now());
 const rows=s.f.db.raw.prepare("SELECT table_name,row_json FROM backup_snapshot_rows WHERE tenant_id=? AND table_name IN('content_items','content_revisions')").all(s.t.id);assert.ok(rows.length>=2);
 assert.deepEqual(JSON.parse(JSON.parse(rows.find(x=>x.table_name==='content_items').row_json).article_json),metadata);assert.deepEqual(JSON.parse(JSON.parse(rows.find(x=>x.table_name==='content_revisions').row_json).doc_json).article,metadata);
}));

test('YX39 报告feedback_count只计已确认，待审和退回不计，重新提交不重复',()=>growthSchool(async s=>{
 const b=await batch(s),r=b.reports[0];assert.equal((await report(s,r)).feedback_count,0);
 const pending=ok(await submitFeedback(s));assert.equal((await report(s,r)).feedback_count,0);
 ok(await confirmFeedback(s,pending.id,'return'));assert.equal((await report(s,r)).feedback_count,0);
 const next=ok(await submitFeedback(s));ok(await confirmFeedback(s,next.id));assert.equal((await report(s,r)).feedback_count,1);
 for(const r of b.reports)assert.equal((await report(s,r)).feedback_count,1);
}));

test('YX39 旧纯文字公共及个人点评同一课计一条，后续点评修订仍计一条',()=>growthSchool(async s=>{
 const initial=await proposal(s);ok(initial);ok(await decide(s,initial.body.id));const b=await batch(s);assert.equal((await report(s,b.reports[0])).feedback_count,1);
 const revised=await proposal(s,{kind:'comments',text:'更新公共点评',comment:'更新个人点评'});ok(revised);assert.equal((await report(s,b.reports[0])).feedback_count,1);ok(await decide(s,revised.body.id));assert.equal((await report(s,b.reports[0])).feedback_count,1);
}));

test('YX39 feedback_count按报告首尾日期和学员过滤，客户端伪造值无效',()=>growthSchool(async s=>{
 const submitted=ok(await submitFeedback(s));ok(await confirmFeedback(s,submitted.id));
 const inclusive=await batch(s,{from:'2026-11-10',to:'2026-11-10'}),outside=await batch(s,{from:'2026-11-11',to:'2026-11-12'});assert.equal((await report(s,inclusive.reports[0])).feedback_count,1);assert.equal((await report(s,outside.reports[0])).feedback_count,0);
 const r=await readyDoc(s,inclusive.reports[0]);ok(await call(s,'reports/'+r.id,'PUT',{version:r.version,feedback_count:999}));assert.equal((await report(s,r)).feedback_count,1);
 const foreign=await setup(s.f,1,'report-foreign39');foreign.f=s.f;ok(await foreign.call('reports/'+r.id),404);
}));

test('YX39 今天课程student_names最多6个，正确字符串与本机构在册名单',()=>growthSchool(async s=>{
 const rows=s.f.db.raw.prepare('SELECT p.id,p.student_id FROM lesson_participants p WHERE p.tenant_id=? AND p.lesson_id=? ORDER BY p.created_at,p.id').all(s.t.id,s.lid);
 for(const [i,p] of rows.entries())s.f.db.raw.prepare('UPDATE students SET name=? WHERE tenant_id=? AND id=?').run('学员'+(i+1),s.t.id,p.student_id);
 const today=ok(await call(s,'feedback/today','GET',undefined,s.teacherAccount.token));const l=today.items.find(x=>x.lesson_id===s.lid);assert.deepEqual(l.student_names,['学员1','学员2','学员3','学员4','学员5','学员6']);assert.equal(l.student_names.every(x=>typeof x==='string'),true);assert.equal(l.student_names_json,undefined);
},8));

test('YX39 今天课程剔除已删参与者，零学员返回空数组，保留老师访问权限',()=>growthSchool(async s=>{
 s.f.db.raw.prepare('UPDATE lesson_participants SET deleted_at=1 WHERE tenant_id=? AND lesson_id=?').run(s.t.id,s.lid);
 const v=ok(await call(s,'feedback/today','GET',undefined,s.teacherAccount.token));assert.deepEqual(v.items.find(x=>x.lesson_id===s.lid).student_names,[]);
 ok(await call(s,'feedback/today'),403);ok(await call(s,'feedback/today','GET',undefined,s.student.token),403);
}));
