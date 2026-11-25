import {Readable} from 'node:stream';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {RoleCredentials} from './cos-auth.mjs';
import {stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';

const missing=e=>Number(e?.statusCode)===404 || e?.code==='NoSuchKey';
const metadata=(key,v)=>({key,size:Number(v.ContentLength??v.headers?.['content-length']??v.Size??0),etag:String(v.ETag??v.headers?.etag??'').replace(/^"|"$/g,''),uploaded:new Date(v.LastModified??v.headers?.['last-modified']??Date.now())});
export class CosR2 {
  constructor(client,{bucket,region,credentials=null,sleepImpl=sleep}) {this.client=client;this.bucket=bucket;this.region=region;this.credentials=credentials;this.sleep=sleepImpl;}
  async call(method,params,{allowMissing=false}={}) {
    for(let attempt=0;;attempt++) {
      let request;
      try {
        if(this.credentials) await this.credentials.get();
        request=typeof params==='function'?params():params;
        return await new Promise((resolve,reject)=>this.client[method]({Bucket:this.bucket,Region:this.region,...request},(error,value)=>error?reject(error):resolve(value||{})));
      } catch(error) {
        if(allowMissing&&missing(error))return null;
        const status=Number(error?.statusCode),retry=(!status || status>=500)&&attempt<2;
        if(!retry)throw error;
        await this.sleep(100*2**attempt);
      } finally {if(typeof params==='function')request?.Body?.destroy?.();}
    }
  }
  async put(key,value,options={}) {
    let data;
    if(typeof value==='string')data=Buffer.from(value);
    else if(value instanceof ArrayBuffer)data=Buffer.from(value);
    else if(ArrayBuffer.isView(value))data=Buffer.from(value.buffer,value.byteOffset,value.byteLength);
    else if(value instanceof ReadableStream)data=Buffer.from(await new Response(value).arrayBuffer());
    else throw new TypeError('Unsupported R2 put body');
    const v=await this.call('putObject',{Key:key,Body:data,ContentLength:data.length,ContentType:options.httpMetadata?.contentType || 'text/plain; charset=utf-8'});
    return {...metadata(key,v),size:data.length};
  }
  async head(key) {const v=await this.call('headObject',{Key:key},{allowMissing:true});return v?metadata(key,v):null;}
  async putFile(key,path,options={}) {
    const size=(await stat(path)).size;
    const v=await this.call('putObject',()=>({Key:key,Body:createReadStream(path),ContentLength:size,ContentType:options.httpMetadata?.contentType||'application/octet-stream'}));
    return {...metadata(key,v),size};
  }
  async get(key) {
    const v=await this.call('getObject',{Key:key},{allowMissing:true});if(!v)return null;
    const body=Buffer.isBuffer(v.Body)?v.Body:Buffer.from(v.Body??'');
    return {...metadata(key,v),size:body.length,text:async()=>body.toString('utf8'),arrayBuffer:async()=>Uint8Array.from(body).buffer,json:async()=>JSON.parse(body.toString('utf8')),get body(){return Readable.toWeb(Readable.from([body]));}};
  }
  async delete(input) {
    if(!Array.isArray(input)){await this.call('deleteObject',{Key:input},{allowMissing:true});return;}
    for(let i=0;i<input.length;i+=1000) {
      const v=await this.call('deleteMultipleObject',{Objects:input.slice(i,i+1000).map(Key=>({Key}))},{allowMissing:true});
      if(v?.Error?.length){const error=Error('COS multi-delete partially failed');error.code='COS_PARTIAL_DELETE';error.statusCode=403;throw error;}
    }
  }
  async list({prefix='',cursor,limit=1000}={}) {
    if(!Number.isInteger(limit)||limit<1)throw new TypeError('Invalid R2 list limit');
    const v=await this.call('getBucket',{Prefix:prefix,Marker:cursor||'',MaxKeys:Math.min(limit,1000)});
    const objects=(v.Contents||[]).map(x=>metadata(x.Key,x)),truncated=v.IsTruncated===true||v.IsTruncated==='true';
    const next=truncated?(v.NextMarker || objects.at(-1)?.key):undefined;
    if(truncated&&!next)throw Error('COS pagination marker missing');
    return {objects,truncated,cursor:next};
  }
}
export function loadCosSdk() {
  // The lockfile and isolated production dependency live under the permitted deploy/ tree.
  try{return createRequire(import.meta.url)('cos-nodejs-sdk-v5');}
  catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;return createRequire(new URL('../deploy/npm/package.json',import.meta.url))('cos-nodejs-sdk-v5');}
}
export async function createBuckets(config,{sdkFactory,fetchImpl,sleepImpl}={}) {
  const credentials=config.cos.auth==='role'?new RoleCredentials(config.cos.role,{fetchImpl}):null;
  if(credentials)await credentials.get();
  const opts={RetryTimes:0,Timeout:15000,Protocol:'https:'};
  if(credentials)opts.getAuthorization=(_options,callback)=>{
    // call() has already refreshed. Use a synchronous SDK callback without exposing secrets.
    callback(credentials.value);
  };
  else Object.assign(opts,{SecretId:config.cos.secretId,SecretKey:config.cos.secretKey});
  const sdk=sdkFactory?sdkFactory(opts):new (loadCosSdk())(opts);
  return {media:new CosR2(sdk,{bucket:config.cos.media,region:config.cos.region,credentials,sleepImpl}),backups:new CosR2(sdk,{bucket:config.cos.backups,region:config.cos.region,credentials,sleepImpl})};
}
