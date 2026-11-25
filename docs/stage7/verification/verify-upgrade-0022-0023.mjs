// Developer-only local SQLite/D1 simulation. No remote resources or credentials.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fixture} from '../../../tests/support.mjs';
import {mobileSetup,proposal,decide,MOBILE_NOW} from '../../../tests/fixtures-mobile.mjs';
import {call,ok,parent} from '../../../tests/fixtures-plans.mjs';
const clock=Date.now;Date.now=()=>MOBILE_NOW;const f=await fixture({migrateAi:false});
try{
 const s=await mobileSetup(f,1,'upgrade2223');s.f=f;const db=f.db.raw;
 db.prepare("UPDATE tenant_modules SET enabled=0 WHERE tenant_id=? AND id='growth_reports'").run(s.t.id);
 const pending=await proposal(s,{text:'升级前公共纯文字',comment:'升级前个人纯文字'});assert.equal(pending.status,200,pending.text);const reviewed=await decide(s,pending.body.id);assert.equal(reviewed.status,200,reviewed.text);
 // Raw synthetic frozen plan rows exercise preservation, not business calculation.
 const manifest=db.prepare("SELECT manifest_json FROM style_pack_versions WHERE pack_id='stp_folio' AND version='1.0.0'").get().manifest_json;
 const doc=JSON.stringify({title:'升级前价格快照',style:{pack_id:'stp_folio',pack_version:'1.0.0'},computed:{total:{amount:11400}},test_only:true});
 db.prepare('INSERT INTO plans(tenant_id,id,student_id,subject,title,status,doc_json,context_id,manifest_json,current_revision_id,sent_revision_id,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(s.t.id,'plan_upgrade',s.students[0],'music_interest','升级前方案','sent',doc,'ctx_upgrade',manifest,'rev_upgrade','rev_upgrade',MOBILE_NOW,s.user.id,MOBILE_NOW,s.user.id);
 db.prepare('INSERT INTO plan_contexts(tenant_id,id,plan_id,doc_json,created_at) VALUES(?,?,?,?,?)').run(s.t.id,'ctx_upgrade','plan_upgrade','{}',MOBILE_NOW);
 db.prepare('INSERT INTO plan_revisions(tenant_id,id,plan_id,seq,student_id,doc_json,context_id,manifest_json,image_ids_json,action,sent_at,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(s.t.id,'rev_upgrade','plan_upgrade',1,s.students[0],doc,'ctx_upgrade',manifest,'[]','send',MOBILE_NOW,MOBILE_NOW,s.user.id);
 db.prepare('INSERT INTO share_links(tenant_id,id,plan_id,revision_id,token_hash,expires_at,created_at,created_by) VALUES(?,?,?,?,?,?,?,?)').run(s.t.id,'share_upgrade','plan_upgrade','rev_upgrade','local-test-only-share-hash',MOBILE_NOW+86400000,MOBILE_NOW,s.user.id);
 const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name);
 const before=Object.fromEntries(names.map(t=>[t,{columns:db.prepare('PRAGMA table_info('+t+')').all().map(c=>c.name),rows:db.prepare('SELECT * FROM '+t).all().map(x=>JSON.stringify(x))}]));
 const steps=[];
 for(const file of ['0022_content_and_ai.sql','0023_feedback_and_growth_reports.sql']){
  db.exec(await readFile('migrations/'+file,'utf8'));let preserved=0;
  for(const [name,entry] of Object.entries(before)){
   const after=new Set(db.prepare('SELECT '+entry.columns.join(',')+' FROM '+name).all().map(x=>JSON.stringify(x)));for(const row of entry.rows){assert.ok(after.has(row),file+': '+name);preserved++;}
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');steps.push({file,old_tables_checked:names.length,old_rows_preserved:preserved,foreign_keys:0,integrity:'ok'});
 }
 assert.equal(db.prepare('SELECT personal_json FROM lesson_submissions WHERE id=?').get(pending.body.id).personal_json,'[]');assert.equal(db.prepare('SELECT COUNT(*) n FROM growth_feedback').get().n,0);
 db.prepare("UPDATE tenant_modules SET enabled=1 WHERE tenant_id=? AND id='growth_reports'").run(s.t.id);
 const pa=await parent(s);const response=await call(s,'parent/children/'+s.students[0]+'/feed','GET',undefined,pa.token);const feed=ok(response),feedback=feed.items.find(x=>x.type==='feedback');assert.ok(feedback);assert.ok(feedback.id.startsWith('legacy_'));assert.ok(feedback.message.learned.includes('升级前个人纯文字'));assert.ok(feedback.message.learned.includes('升级前公共纯文字'));
 await mkdir('work/stage7',{recursive:true});const mode=process.env.TEST_BUNDLE==='1'?'bundle':'source';await writeFile('work/stage7/legacy-feed-'+mode+'.json',JSON.stringify({local_only:true,request:{method:'GET',path:'/'+s.t.slug+'/api/parent/children/'+s.students[0]+'/feed',authenticated:true},response:{status:response.status,body:feed}},null,2)+'\n');
 console.log(JSON.stringify({result:'pass',mode,from_migration:'0021',to_migration:'0023',steps,synthetic_plan_and_revision_unchanged:true,old_confirmed_feedback_in_feed:true,new_feedback_rows:0,remote_calls:0},null,2));
}finally{f.restore();Date.now=clock;}
