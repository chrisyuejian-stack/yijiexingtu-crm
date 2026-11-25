// Actual local Request/Response capture. No cloud services or live credentials.
import {mkdir,writeFile} from 'node:fs/promises';
import {fixture} from '../../../tests/support.mjs';
import {setup} from '../../../tests/fixtures-credit.mjs';
import {content,call,ok} from '../../../tests/fixtures-ai.mjs';
import {examples} from '../../../tests/fixtures-plans.mjs';
import {ops,upload,publish,manifest,platformExamples} from '../../../tests/fixtures-platform.mjs';
import {growthSchool,batch,submitFeedback,confirmFeedback} from '../../../tests/fixtures-growth.mjs';
const f=await fixture();try{
 const s=await setup(f,1,'article39');s.f=f;
 await s.r.settingsGalleryCreate({id:'img_39header',r2_key:'local/header',mime:'image/png',width:100,height:100,tags:[],consent:false},s.user);
 let c=await content(s);ok(await call(s,'content/'+c.id));
 c=ok(await call(s,'content/'+c.id,'PUT',{version:c.version,article:{column:'招生 · 寒假集训',header_image_id:'img_39header',author:'星光琴行',publish_date:'2026-11-20',footer:{qr:true,address:true}}}));
 ok(await call(s,'content/'+c.id));ok(await call(s,'content/'+c.id,'PUT',{version:c.version,article:{header_image_id:'foreign_image'}}),422);
 ok(await call(s,'content/'+c.id,'PUT',{version:c.version,article:{publish_date:'2026-02-30'}}),422);
 ok(await call(s,'content/'+c.id,'PUT',{version:1,article:null}),409);
 const style=ok(await upload(f),201);ok(await publish(f,style));ok(await publish(f,style),409);
 const cfg=ok(await ops(f,'ai/settings'));ok(await ops(f,'ai/settings','PUT',{...cfg,fast_model:null,deep_model:null}),422);
 const bad=manifest(f,'invalid_font');bad.tokens.font.body='unknown-font';ok(await upload(f,bad),422);
}finally{f.restore()}
await growthSchool(async s=>{const b=await batch(s);ok(await call(s,'reports/'+b.reports[0].id));const sub=ok(await submitFeedback(s));ok(await confirmFeedback(s,sub.id));ok(await call(s,'reports/'+b.reports[0].id));ok(await call(s,'feedback/today','GET',undefined,s.teacherAccount.token))});
await mkdir('work/v039',{recursive:true});
const mode=process.env.TEST_BUNDLE==='1'?'bundle':'source';
await writeFile('work/v039/http-'+mode+'.json',JSON.stringify({mode,local_only:true,credentials_omitted:true,examples,platform_patch_mismatch_examples:platformExamples},null,2)+'\n');
console.log(JSON.stringify({result:'pass',mode,http_examples:examples.length,platform_examples:platformExamples.length,remote_calls:0}));
