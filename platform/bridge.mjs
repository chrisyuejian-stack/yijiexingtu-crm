import {createServer} from 'node:http';
import {isIP} from 'node:net';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {logger} from './log.mjs';

const reply=(res,status,error)=>{if(!res.headersSent){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error}));}};
export function requestHandler(worker,bindings,vars,{maxBodyBytes=33554432,log=logger}={}) {
  const hosts=new Set([vars.TENANT_HOST,vars.CONSOLE_HOST]);
  return async(incoming,outgoing)=>{
    const requestId=crypto.randomUUID();let path='/';
    try {
      const host=incoming.headers.host;
      if(!hosts.has(host)){reply(outgoing,404,'not_found');return;}
      if(!incoming.url?.startsWith('/')||incoming.url.startsWith('//')||/[\r\n\\]/.test(incoming.url)){reply(outgoing,400,'bad_request');return;}
      const url=new URL('https://'+host+incoming.url);path=url.pathname;
      const headers=new Headers();
      for(const [key,value] of Object.entries(incoming.headers)){
        if(key.startsWith('cf-')||['connection','transfer-encoding','upgrade','proxy-authorization'].includes(key))continue;
        if(Array.isArray(value))for(const v of value)headers.append(key,v);else if(value!==undefined)headers.set(key,value);
      }
      // Node is loopback-only. Nginx MUST overwrite X-Real-IP, not append a chain.
      const ip=incoming.headers['x-real-ip'];
      if(typeof ip!=='string'||!isIP(ip)){reply(outgoing,400,'invalid_proxy_ip');return;}
      headers.set('cf-connecting-ip',ip);
      const advertised=incoming.headers['content-length'];
      if(advertised!==undefined&&(!/^\d+$/.test(advertised)||Number(advertised)>maxBodyBytes)){reply(outgoing,413,'payload_too_large');incoming.resume();return;}
      const parts=[];let size=0;
      for await(const part of incoming.iterator({destroyOnReturn:false})){size+=part.length;if(size>maxBodyBytes){reply(outgoing,413,'payload_too_large');incoming.resume();return;}parts.push(part);}
      const controller=new AbortController();outgoing.once('close',()=>{if(!outgoing.writableEnded)controller.abort();});
      const hasBody=!['GET','HEAD'].includes(incoming.method);
      const request=new Request(url,{method:incoming.method,headers,...hasBody?{body:Buffer.concat(parts)}:{},signal:controller.signal});
      // Fresh outer env for every request; shared bindings keep their identities.
      const response=await worker.fetch(request,{...bindings,...vars});
      outgoing.statusCode=response.status;
      const hop=new Set(['connection','transfer-encoding','keep-alive','upgrade','proxy-authenticate','proxy-authorization']);
      for(const [key,value] of response.headers)if(key!=='set-cookie'&&!hop.has(key))outgoing.setHeader(key,value);
      const cookies=response.headers.getSetCookie();if(cookies.length)outgoing.setHeader('set-cookie',cookies);
      outgoing.setHeader('x-request-id',requestId);
      if(incoming.method==='HEAD'||!response.body){outgoing.end();return;}
      await pipeline(Readable.fromWeb(response.body),outgoing);
    } catch(error) {
      // No body, Cookie, SDK request object, signed query, or Authorization in logs.
      log({level:'error',event:'http_unhandled',requestId,path,error:error?.name||'Error',stack:String(error?.stack||'').replace(/https?:\/\/\S+/g,'[url]').split('\n').slice(1,9).join('\n')});
      if(!outgoing.headersSent)reply(outgoing,500,'internal_error');else outgoing.destroy();
    }
  };
}
export function createBridge(worker,bindings,vars,options) {
  const server=createServer(requestHandler(worker,bindings,vars,options));
  server.requestTimeout=200000;server.headersTimeout=30000;server.keepAliveTimeout=5000;
  return server;
}
