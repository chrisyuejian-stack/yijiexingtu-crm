import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {backup} from 'node:sqlite';
import {request as httpRequest} from 'node:http';
import {fixture} from '../support.mjs';
import {setup} from '../fixtures-credit.mjs';
import {loadConfig} from '../../platform/config.mjs';

export class MemoryCos {
  constructor(){this.objects=new Map();this.calls=[];this.faults=[];}
  key(p){return p.Bucket+'/'+p.Key;}
  async run(method,p){
    this.calls.push({method,...p});
    const fault=this.faults.findIndex(x=>x.method===method);if(fault>=0)throw this.faults.splice(fault,1)[0].error;
    const key=this.key(p),old=this.objects.get(key);
    if(method==='putObject'){
      let body=p.Body;if(body?.[Symbol.asyncIterator]&&!Buffer.isBuffer(body)){const parts=[];for await(const part of body)parts.push(Buffer.from(part));body=Buffer.concat(parts);}
      this.objects.set(key,{body:Buffer.from(body),at:new Date(),etag:'test-etag'});return {ETag:'"test-etag"'};
    }
    if(method==='getObject'||method==='headObject'){
      if(!old)throw Object.assign(Error('missing'),{statusCode:404,code:'NoSuchKey'});
      return {Body:Buffer.from(old.body),ContentLength:old.body.length,ETag:old.etag,LastModified:old.at.toISOString()};
    }
    if(method==='deleteObject'){this.objects.delete(key);return {};}
    if(method==='deleteMultipleObject'){for(const o of p.Objects)this.objects.delete(p.Bucket+'/'+o.Key);return {};}
    if(method==='getBucket'){
      const prefix=p.Bucket+'/'+(p.Prefix||''),keys=[...this.objects.keys()].filter(x=>x.startsWith(prefix)&&x.slice(p.Bucket.length+1)>(p.Marker||'')).sort();
      const page=keys.slice(0,p.MaxKeys),truncated=page.length<keys.length;
      return {Contents:page.map(k=>({Key:k.slice(p.Bucket.length+1),Size:String(this.objects.get(k).body.length),ETag:'test-etag',LastModified:this.objects.get(k).at.toISOString()})),IsTruncated:truncated?'true':'false',NextMarker:truncated?page.at(-1).slice(p.Bucket.length+1):''};
    }
    throw Error('Unknown SDK operation '+method);
  }
}
for(const method of ['putObject','getObject','headObject','deleteObject','deleteMultipleObject','getBucket'])MemoryCos.prototype[method]=function(p,cb){void this.run(method,p).then(v=>cb(null,v),cb);};
export async function fileFixture() {
  const directory=await mkdtemp(join(tmpdir(),'yxt-platform-test-')),f=await fixture();
  const school=await setup(f,1,'native');school.f=f;
  const path=join(directory,'crm.sqlite');await backup(f.db.raw,path);
  const variables={...f.env,TURNSTILE_MODE:'off',ACCESS_MODE:'off',REFERRALS_MODE:'off',DEEPSEEK_API_KEY:'local-no-network',DB_PATH:path,DIST_DIR:resolve('dist'),BACKUP_WORKER_PATH:resolve('backup-dist/backup-worker.js'),COS_REGION:'ap-shanghai',COS_BUCKET_MEDIA:'test-media-123',COS_BUCKET_BACKUPS:'test-backup-123',COS_AUTH:'keys',COS_SECRET_ID:'local',COS_SECRET_KEY:'local'};
  const config=loadConfig(variables);
  return {directory,path,f,school,variables,config,async close(){f.restore();await rm(directory,{recursive:true,force:true});}};
}
export function http(port,path,{method='GET',host='school.test',headers={},body,chunks}={}) {
  return new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:'127.0.0.1',port,path,method,headers:{Host:host,'X-Real-IP':'198.51.100.17',...headers}},res=>{
      const data=[];res.on('data',c=>data.push(c));res.on('end',()=>{const text=Buffer.concat(data).toString();let json;try{json=JSON.parse(text);}catch{}resolve({status:res.statusCode,headers:res.headers,text,json});});
    });req.on('error',reject);
    if(chunks){for(const c of chunks)req.write(c);req.end();}else req.end(body);
  });
}
