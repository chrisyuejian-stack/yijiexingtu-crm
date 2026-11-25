import {HttpError} from './core.js';
const markers=[['**','bold'],['==','highlight'],['[[','brand'],[']]','brand_close'],['*','italic']],escapable=new Set(['\\','*','=','[',']']);
const escape=v=>v.replace(/[\\*=\[\]]/g,'\\$&');
function flatten(line){let out='';for(let i=0;i<line.length;){if(line[i]==='\\'&&escapable.has(line[i+1])){out+=line[i+1];i+=2;continue;}const mark=markers.find(([x])=>line.startsWith(x,i));if(mark){i+=mark[0].length;continue;}out+=line[i++];}return out;}
function paragraph(line){
 let mode='text',buffer='',tokens=[],valid=true,open='';const emit=()=>{if(buffer)tokens.push({type:mode,text:buffer});buffer='';};
 for(let i=0;i<line.length;){
  if(line[i]==='\\'&&escapable.has(line[i+1])){buffer+=line[i+1];i+=2;continue;}
  const mark=markers.find(([x])=>line.startsWith(x,i));if(!mark){buffer+=line[i++];continue;}
  const [token,type]=mark;
  if(mode==='text'){if(type==='brand_close'){valid=false;break;}emit();mode=type;open=token;i+=token.length;}
  else {const close=mode==='brand'?']]':open;if(token!==close||!buffer.trim()){valid=false;break;}emit();mode='text';open='';i+=token.length;}
 }
 if(mode!=='text')valid=false;
 if(!valid){const plain=flatten(line);return {text:escape(plain),plain,tokens:[{type:'text',text:plain}],normalized:true};}
 emit();const pair={bold:['**','**'],italic:['*','*'],highlight:['==','=='],brand:['[[',']]']};
 return {text:tokens.map(t=>t.type==='text'?escape(t.text):pair[t.type][0]+escape(t.text)+pair[t.type][1]).join(''),plain:tokens.map(t=>t.text).join(''),tokens,normalized:false};
}
export function normalizeInline(value){
 if(typeof value!=='string')throw new HttpError(422,'正文格式不正确','validation_failed');
 const rows=value.replace(/\r\n/g,'\n').split('\n').map(paragraph);return {text:rows.map(x=>x.text).join('\n'),plain:rows.map(x=>x.plain).join('\n'),tokens:rows.map(x=>x.tokens),normalized:rows.some(x=>x.normalized)};
}
export const inlinePlain=v=>normalizeInline(v).plain;
export function inlineText(value,field,max=20000,empty=true,warnings=[]){
 if(typeof value!=='string'||new TextEncoder().encode(value).byteLength>max*8+64||/<\/?[a-z!][^>]*>/i.test(value))throw new HttpError(422,'请使用符合长度限制的文字，不要包含HTML','validation_failed');
 const out=normalizeInline(value.trim());if([...out.plain].length>max||!empty&&!out.plain.trim())throw new HttpError(422,field+'超过可见字数限制或为空','validation_failed');
 if(out.normalized&&!warnings.includes('部分文字格式已整理为普通文字'))warnings.push('部分文字格式已整理为普通文字');return out.text.trim();
}
