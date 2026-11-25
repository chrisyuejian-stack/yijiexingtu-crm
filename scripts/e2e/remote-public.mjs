// Explicitly selected URL, public GETs only. No login submission, reset endpoint, or business writes.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if(!process.env.CRM_TEST_LOGIN_URL) throw Error('请显式设置 CRM_TEST_LOGIN_URL 为已授权的独立测试机构登录页');
const target=new URL(process.env.CRM_TEST_LOGIN_URL);
if(target.protocol!=='https:'||!/^\/[a-z0-9-]{3,40}\/login$/.test(target.pathname)||target.username||target.password||target.search||target.hash)
  throw Error('需要不带凭据、查询或片段的 HTTPS 机构登录页：/机构路径/login');
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=path.resolve(root,process.env.REMOTE_REPORT_DIR||'work/remote-public');
await mkdir(out,{recursive:true});
const proxyValue=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;
const proxy=proxyValue?new URL(proxyValue):null;
const executablePath=process.env.CHROME_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
const browser=await chromium.launch({...(executablePath?{executablePath}:{}),
  ...(proxy?{proxy:{server:proxy.protocol+'//'+proxy.host,
    ...(proxy.username?{username:decodeURIComponent(proxy.username),password:decodeURIComponent(proxy.password)}:{})}}:{})});
const report={target:target.href,checkedAt:new Date().toISOString(),scope:'未登录的只读浏览器检查；不提交登录或业务写请求',views:[]};
try {
  for(const [name,viewport] of Object.entries({desktop:{width:1440,height:900},mobile:{width:390,height:844}})){
    const context=await browser.newContext({viewport,locale:'zh-CN',timezoneId:'Asia/Shanghai',serviceWorkers:'block',...(name==='mobile'?{isMobile:true,hasTouch:true}:{})});
    await context.route('**/*',route=>['GET','HEAD'].includes(route.request().method())?route.continue():route.abort('blockedbyclient'));
    try {
      const p=await context.newPage(),errors=[],failures=[],methods=[],resources=[];
      p.on('pageerror',e=>errors.push(e.message));
      p.on('request',r=>methods.push({method:r.method(),url:r.url()}));
      p.on('response',r=>{if(r.status()>=400)failures.push({status:r.status(),url:r.url()});});
      const response=await p.goto(target.href,{waitUntil:'domcontentloaded',timeout:30000});
      expect(response.status()).toBe(200);
      await expect(p.getByRole('button',{name:'登录',exact:true})).toBeVisible({timeout:20000});
      await expect(p.getByLabel('手机号',{exact:true})).toBeVisible();
      await expect(p.getByLabel('密码',{exact:true})).toBeVisible();
      const turnstile=await p.locator('meta[name="turnstile-mode"]').getAttribute('content');
      const externalScripts=await p.locator('script[src]').evaluateAll(nodes=>nodes.map(x=>x.src).filter(x=>new URL(x).origin!==location.origin));
      const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      await p.screenshot({path:path.join(out,name+'-login.png'),fullPage:true});
      const assets=await p.locator('script[src],link[rel="stylesheet"]').evaluateAll(nodes=>nodes.map(x=>x.src||x.href));
      for(const url of assets.filter(x=>new URL(x).origin===target.origin)){
        const r=await context.request.get(url),body=await r.body();
        const relative=new URL(url).pathname.replace(/^\//,'');
        const local=await readFile(path.join(root,'dist',relative)).catch(()=>null);
        resources.push({url,status:r.status(),sha256:createHash('sha256').update(body).digest('hex'),matchesLocalBuild:local?body.equals(local):null});
      }
      expect(errors).toEqual([]);expect(failures).toEqual([]);expect(overflow).toBe(false);
      expect(methods.filter(x=>!['GET','HEAD'].includes(x.method))).toEqual([]);
      if(turnstile==='off')expect(externalScripts).toEqual([]);
      report.views.push({name,status:response.status(),turnstile,externalScripts,overflow,errors,failures,resources,writeRequests:[]});
    }finally{await context.close();}
  }
  report.status='passed';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{await browser.close();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({status:report.status,report:path.join(out,'report.json'),error:report.error},null,2));
