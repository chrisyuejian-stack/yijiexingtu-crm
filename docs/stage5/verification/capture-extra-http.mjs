// Capture local HTTP responses; no remote resources or external model calls.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {school,content,call,ok} from '../../../tests/fixtures-ai.mjs';
import {examples} from '../../../tests/fixtures-plans.mjs';
await school(async s=>{
 const c=await content(s);
 s.f.db.raw.prepare("UPDATE tenant_modules SET enabled=0 WHERE tenant_id=? AND id='plans'").run(s.t.id);
 const current=ok(await call(s,'styles?doc_type=article')); assert.ok(current.items.some(x=>x.id===c.style.pack_id));
 s.f.db.raw.prepare("UPDATE style_packs SET active=0,scope_all=0 WHERE id='stp_article'").run();
 ok(await call(s,'styles/stp_article/versions/1.0.0'));
 const shell=await call(s,'/s/invalid-token','GET',undefined,null);ok(shell);assert.match(shell.headers.get('content-type'),/text\/html/);
 const share=await call(s,'/api/share/invalid-token','GET',undefined,null);ok(share,404);
 const result={local_only:true,mode:process.env.TEST_BUNDLE==='1'?'bundle':'source',examples:examples.filter(x=>/\/api\/styles|^\/s\/|^\/api\/share\//.test(x.request.path))};
 result.examples.find(x=>x.request.path.startsWith('/s/')).response.headers=Object.fromEntries(['content-type','x-robots-tag','referrer-policy','content-security-policy'].map(k=>[k,shell.headers.get(k)]));
 await writeFile('work/stage5/extra-http-'+result.mode+'.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({result:'pass',captured:result.examples.length,local_only:true,plans_disabled_article_style_available:true}));
});
