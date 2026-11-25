// Capture actual local Request/Response objects through the same Worker routing as the UI.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixture} from '../../../tests/support.mjs';
import {setup} from '../../../tests/fixtures-credit.mjs';
import {content,model,ai,filled,aiExamples} from '../../../tests/fixtures-ai.mjs';
import {call,ok,examples} from '../../../tests/fixtures-plans.mjs';
import {ops,upload,gallery,storageLimit,httpExamples} from '../../../tests/fixtures-v041.mjs';
import {png} from '../../../tests/fixtures-platform.mjs';
const f=await fixture();try{
 const s=await setup(f,1,'v041demo');s.f=f;const c=await content(s),p=await filled(s);
 model(s,{suggestions:[{payload:{mode:'custom',blocks:[{type:'paragraph',text:'面向初学者的温暖文字'}]}}]});ok(await ai(s,'content/rewrite',{content_id:c.id,block_index:0,mode:'custom',instruction:'改成温暖语气，仅改本卡片'}));
 model(s,{suggestions:[{payload:{fields:[{path:'assessment.text',value:'节奏需要加强',quote:'加强节奏'},{path:'about',value:'忽略本项',quote:'加强节奏'}]}}]});ok(await ai(s,'plan/fill-from-consult',{plan_id:p.id,consult:'加强节奏'}));ok(await call(s,'plans/'+p.id));
 const original=Date.now;let clock=original();Date.now=()=>clock;try{model(s,()=>{clock+=120001;return {suggestions:[]}});assert.equal(ok(await ai(s,'content/versions',{content_id:c.id}),502).error,'ai_timeout')}finally{Date.now=original}
 model(s,()=>{const e=Error('not logged');e.ai_failure_reason='provider_http_402';throw e});ok(await ai(s,'content/versions',{content_id:c.id}),502);
 const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});ok(await ops(s,'ai/usage?from='+day+'&to='+day+'&group=tool&tenant_id='+s.t.id));
 ok(await gallery(s));ok(await storageLimit(s,png.toString('base64').length));const image=ok(await upload(s,png),201);assert.equal(ok(await upload(s,png),413).error,'storage_full');ok(await gallery(s));ok(await call(s,'gallery/'+image.id,'DELETE',{version:image.version}));ok(await gallery(s));
 await s.r.settingsGalleryCreate({id:'legacy_example',r2_key:'local/legacy',mime:'image/png',width:1,height:1,tags:[],consent:false},s.user);await f.env.CHANNEL_MEDIA.put('local/legacy',png.toString('base64'));ok(await ops(s,'tenants/'+s.t.id+'/gallery-storage/recount','POST',{}));
 await mkdir('work/v041',{recursive:true});const mode=process.env.TEST_BUNDLE==='1'?'bundle':'source';await writeFile('work/v041/http-actual-'+mode+'.json',JSON.stringify({mode,local_only:true,credentials_omitted:true,ai:aiExamples,business:examples,storage_and_ops:httpExamples},null,2)+'\n');console.log(JSON.stringify({result:'pass',mode,ai:aiExamples.length,business:examples.length,storage_and_ops:httpExamples.length,remote_calls:0}));
}finally{f.restore()}
