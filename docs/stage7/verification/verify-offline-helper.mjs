// Offline JavaScript/DOM simulation, not a browser or visual acceptance test.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
class Element {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.handlers={};this.value='';this.textContent='';this.disabled=false;}
 addEventListener(type,fn){(this.handlers[type]??=[]).push(fn)}
 append(...x){this.children.push(...x)}
 replaceChildren(...x){this.children=[...x]}
 get options(){return this.children}
 click(){for(const f of this.handlers.click??[])f()}
 focus(){}select(){}
}
const ids=Object.fromEntries(['detail','current','start','step','sql','done','copy','summary','notice','history','save','values','generate','status'].map(x=>[x,new Element()]));ids.current.value='23';
const document={getElementById:id=>ids[id],createElement:tag=>new Element(tag)};
const c=createContext({document,window:{},confirm:()=>true,Blob,URL,crypto,btoa,atob,setTimeout,navigator:{clipboard:{writeText:async()=>{}}}});
const folder='deployment/final/离线升级助手/';
const html=await readFile(folder+'打开升级助手.html','utf8');
assert.ok(html.includes("connect-src 'none'"));assert.ok(!/https?:\/\//.test(html));
runInContext(await readFile(folder+'steps.js','utf8'),c);runInContext(await readFile(folder+'helper.js','utf8'),c);
assert.equal(ids.step.options.length,114);assert.ok(ids.sql.value.includes('CREATE TABLE subject_packs'));
ids.done.click();assert.equal(ids.step.value,'1');assert.ok(ids.history.value.includes('第1步'));
for(const [v,n] of [['21',149],['22',131],['24',0],['0',674]]){ids.current.value=v;ids.start.click();assert.equal(ids.step.options.length,n)}
await ids.copy.handlers.click[0]();assert.ok(ids.notice.textContent.includes('已复制'));
const kh=await readFile('deployment/final/离线密钥生成器/打开密钥生成器.html','utf8');assert.ok(kh.includes("connect-src 'none'"));
runInContext(await readFile('deployment/final/离线密钥生成器/key.js','utf8'),c);ids.generate.click();
const keys=ids.values.children.map(x=>x.children[0].value);assert.equal(keys.length,6);assert.equal(new Set(keys).size,6);assert.ok(keys.every(k=>atob(k).length===32));
console.log(JSON.stringify({result:'pass',environment:'node_vm_dom_simulation',upgrade_choices:{'0021':149,'0022':131,'0023':114,'0024':0,'empty':674},step_progress_and_manual_log:true,clipboard_action:true,new_environment_keys:{count:6,unique:true,decoded_bytes:32,values_not_logged:true},html_network_policy:'connect-src none',browser_file_mode:'not_verified_container_browser_url_policy',product_ui_visual_validation:false,remote_calls:0},null,2));
