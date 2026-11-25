import {ops as platformOps} from './fixtures-platform.mjs';
import {call} from './fixtures-plans.mjs';
export const httpExamples=[];
export async function ops(s,path,method='GET',body){const f=s.f||s;const r=await platformOps(f,path,method,body);httpExamples.push({request:{method,path:'/api/ops/'+path,body:body??null,actor:'platform_owner'},response:{status:r.status,body:r.body}});return r}
export async function upload(s,bytes,tags=[]){const form=new FormData();form.set('file',new Blob([bytes],{type:'image/png'}),'sample.png');form.set('tags',JSON.stringify(tags));const path='/'+s.t.slug+'/api/gallery';const r=await s.f.request('https://school.test'+path,{method:'POST',headers:{Origin:'https://school.test',Cookie:'channel_session='+s.token},body:form});const body=await r.json();httpExamples.push({request:{method:'POST',path,body:{multipart:true,file:'sample.png',file_bytes:bytes.length,tags}},response:{status:r.status,body}});return {status:r.status,body,text:JSON.stringify(body)}}
export async function storageLimit(s,limit){const old=await ops(s,'tenants/'+s.t.id+'/gallery-storage');return ops(s,'tenants/'+s.t.id+'/gallery-storage','PUT',{version:old.body.version,limit})}
export async function gallery(s){const r=await call(s,'gallery');httpExamples.push({request:{method:'GET',path:'/'+s.t.slug+'/api/gallery',body:null},response:{status:r.status,body:r.body}});return r}
