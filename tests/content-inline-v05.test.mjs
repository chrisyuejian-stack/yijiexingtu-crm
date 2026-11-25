import test from 'node:test';
import assert from 'node:assert/strict';
import {school,call,ok} from './fixtures-plans.mjs';
import {content,model,ai} from './fixtures-ai.mjs';
import {normalizeInline,inlinePlain,inlineText} from '../src/server/content-inline.js';
import {contentFlags} from '../src/server/content-flags.js';

test('V05IN 四种同段格式/转义可见文字，最长标记优先，序列化幂等',()=>{
 const raw='**加粗** *斜体* ==高亮== [[强调]] \\*字面\\* \\\\';const x=normalizeInline(raw);assert.equal(x.plain,'加粗 斜体 高亮 强调 *字面* \\');assert.equal(x.normalized,false);assert.equal(normalizeInline(x.text).text,x.text);assert.deepEqual(x.tokens[0].filter(t=>t.type!=='text').map(t=>t.type),['bold','italic','highlight','brand']);
});
test('V05IN 不成对/空/嵌套/交叉/跨段规整纯文字不报错，转义文字不误删',()=>{
 for(const [raw,expected] of [['请看 **重点','请看 重点'],['**重点 *斜体* **','重点 斜体'],['==未完','未完'],['[[品牌','品牌'],['**跨\n段**','跨\n段'],['==**交叉==**','交叉'],['** **',' ']])assert.equal(inlineText(raw,'text',100).trim(),expected.trim());
 assert.equal(inlinePlain('\\*字面\\*'),'\u002a字面\u002a');
});
test('V05IN 可见Unicode码点计数不含标记，长度/HTML仍拒绝',()=>{
 assert.equal(inlinePlain(inlineText('**😀😀**','text',2)),'😀😀');assert.throws(()=>inlineText('**😀😀😀**','text',2),e=>e.status===422);assert.throws(()=>inlineText('<script>alert(1)</script>','text',100),e=>e.status===422);assert.throws(()=>inlineText('*'.repeat(1000),'text',1),e=>e.status===422);
});
test('V05IN 旧plain记录保留原字符，不读时迁移；inline保存返回规范串和提醒',()=>school(async s=>{
 let c=await content(s,{blocks:[{type:'paragraph',text:'原始 ** 星号'}]});const before=s.f.db.raw.prepare('SELECT doc_json FROM content_items WHERE tenant_id=? AND id=?').get(s.t.id,c.id).doc_json;
 assert.equal(ok(await call(s,'content/'+c.id)).text_format,'plain');assert.equal(ok(await call(s,'content/'+c.id)).blocks[0].text,'原始 ** 星号');assert.equal(s.f.db.raw.prepare('SELECT doc_json FROM content_items WHERE tenant_id=? AND id=?').get(s.t.id,c.id).doc_json,before);
 c=ok(await call(s,'content/'+c.id,'PUT',{version:c.version,text_format:'inline_v1',blocks:[{type:'paragraph',text:'请看 **重点'}]}));assert.equal(c.blocks[0].text,'请看 重点');assert.equal(c.text_format,'inline_v1');assert.ok(c.warnings.length);
 c=ok(await call(s,'content/'+c.id,'PUT',{version:c.version,blocks:[{type:'paragraph',text:'欢迎 **体验**'}]}));assert.equal(c.text_format,'inline_v1');assert.equal(c.blocks[0].text,'欢迎 **体验**');
}));
test('V05IN seven blocks可用格式但标题/元信息纯文字，文章人工信息保存及AI均不改',()=>school(async s=>{
 let c=await content(s,{text_format:'inline_v1',article:{column:'机构资讯',author:'人工作者',publish_date:'2026-11-17',footer:{qr:true,address:false}},blocks:[{type:'heading',level:2,text:'**课堂**'},{type:'paragraph',text:'*说明*'},{type:'list',ordered:false,items:['==重点==']},{type:'table',rows:[['列'],['[[内容]]']]},{type:'quote',text:'**引用**'},{type:'divider'}]});assert.equal(c.blocks[2].items[0],'==重点==');const article=c.article;
 model(s,{suggestions:[{payload:{blocks:[{type:'paragraph',text:'欢迎==体验=='}],article:{author:'模型伪造'}}}]});const r=ok(await ai(s,'content/rewrite',{content_id:c.id,block_index:1,mode:'polish'}));assert.equal(r.suggestions[0].payload.text_format,'inline_v1');assert.equal(r.suggestions[0].payload.blocks[0].text,'欢迎==体验==');assert.equal(r.suggestions[0].payload.article,undefined);assert.deepEqual(ok(await call(s,'content/'+c.id)).article,article);
}));
test('V05IN 标记切碎禁词也会匹配，quote纯文字，事实检查返回可见码点偏移',()=>school(async s=>{
 assert.ok(contentFlags('最**专业**',{terms:['最专业']},'inline_v1').some(x=>x.quote==='最专业'));
 const c=await content(s,{text_format:'inline_v1',blocks:[{type:'paragraph',text:'😀这是最**专业**的课程。'}]});model(s,{suggestions:[{payload:{blocks:[{type:'paragraph',text:'最**专业**的课程'}]}}]});const out=ok(await ai(s,'content/rewrite',{content_id:c.id,block_index:0,mode:'polish'}));assert.ok(out.suggestions[0].flags.some(x=>x.kind==='ad_law'&&x.quote==='最专业'));
 model(s,{suggestions:[{payload:{items:[{block_index:0,quote:'最**专业**',source:'none',result:'unknown'}]}}]});const check=ok(await ai(s,'content/fact-check',{content_id:c.id}));const hit=check.suggestions[0].payload.items[0];assert.equal(hit.quote,'最专业');assert.deepEqual(hit.plain_span,{start:3,end:6});
}));
test('V05IN section/versions保留格式，不成对格式只规整、不丢弃有效建议',()=>school(async s=>{
 const c=await content(s,{text_format:'inline_v1'});model(s,{suggestions:[{payload:{section_key:'intro',blocks:[{type:'list',ordered:false,items:['**保留加粗**','*保留斜体*','==未完成']} ]}}]});const out=ok(await ai(s,'content/section',{content_id:c.id,section_key:'intro'}));assert.deepEqual(out.suggestions[0].payload.blocks[0].items,['**保留加粗**','*保留斜体*','未完成']);
 model(s,{suggestions:[{payload:{versions:{short:'**短文**',medium:'==中篇==',long:'[[长文]]'}}}]});const versions=ok(await ai(s,'content/versions',{content_id:c.id}));assert.equal(versions.suggestions[0].payload.versions.short,'**短文**');assert.equal(versions.suggestions[0].payload.text_format,'inline_v1');
}));
