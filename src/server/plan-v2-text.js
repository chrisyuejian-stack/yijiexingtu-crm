import {HttpError} from './core.js';
export function v2Text(value,field,max=200,empty=true){
 if(typeof value!=='string'||[...value].length>max||!empty&&!value.trim()||/<\/?[a-z!][^>]*>/i.test(value)){const e=new HttpError(422,'请使用符合长度限制的文字，不要包含HTML','validation_failed');e.details={fields:[{field,message:'文字为空、超长或包含HTML'}]};throw e;}return value.trim();
}
