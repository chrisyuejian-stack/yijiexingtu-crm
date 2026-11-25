// Baseline browser census. Only disposable local data; no application source changes.
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
const root=process.env.P4_BASELINE;
if(!root)throw Error('P4_BASELINE must point to the unmodified fifth-round source');
const out=process.env.P4_OUTPUT||'docs/p4',port=4390,base=`http://localhost:${port}`,key=randomBytes(32).toString('hex'),headers={'x-e2e-key':key};
await mkdir(out,{recursive:true});
const server=spawn(process.execPath,['scripts/e2e/server.mjs'],{cwd:root,env:{...process.env,E2E_PORT:String(port),E2E_CONTROL_KEY:key},stdio:['ignore','ignore','pipe']});
let stderr='';server.stderr.on('data',x=>stderr+=x);
const control=async(path,method='GET')=>{const res=await fetch(base+'/__e2e/'+path,{method,headers});if(!res.ok)throw Error(`control ${path}: ${res.status}`);return res.json()};
const rows=[],inventory=[],errors=[];let browser;
try{
 for(let i=0;i<100;i++){try{await control('health');break}catch{if(server.exitCode!==null)throw Error(stderr);await new Promise(r=>setTimeout(r,100))}}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium'});
 for(const role of ['supervisor','academic','finance','teacher','student']){
  const manifest=await control('reset?kind=scheduling','POST');let ticks=0;
  const context=await browser.newContext({baseURL:base,viewport:{width:1440,height:900},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
  await context.request.post('/__e2e/session?role='+role,{headers});
  const p=await context.newPage();p.setDefaultTimeout(8000);await p.clock.install({time:new Date(manifest.now)});
  let last=performance.now();const active=new Set(),requests=[],pending=[];
  p.on('pageerror',e=>errors.push({role,error:e.message}));
  p.on('request',r=>{active.add(r);last=performance.now()});
  for(const name of ['requestfinished','requestfailed'])p.on(name,r=>{active.delete(r);last=performance.now()});
  p.on('response',r=>{if(!r.url().includes('/api/'))return;pending.push((async()=>{await r.finished();const h=await r.allHeaders();requests.push({path:new URL(r.url()).pathname.replace('/'+manifest.slug+'/api/','')+new URL(r.url()).search,method:r.request().method(),status:r.status(),d1:Number(/db;dur=[\d.]+;desc="(\d+)"/.exec(h['server-timing']||'')?.[1]||0),timing:h['server-timing']})})())});
  const settle=async()=>{await expect.poll(()=>active.size===0&&performance.now()-last>180,{timeout:20000,intervals:[35]}).toBe(true);await Promise.all(pending)};
  const shell=()=>p.locator('.v-content,.personal-content').first();
  const ready=async()=>{await expect(shell()).toHaveAttribute('aria-busy','false');await settle()};
  const capture=async(name,phase,action)=>{
   const i=requests.length,start=performance.now();let failure;
   try{await action();await settle()}catch(e){failure=e.message.slice(0,350);errors.push({role,name,phase,error:failure})}
   const calls=requests.slice(i),row={role,name,phase,api:calls.length,d1:calls.reduce((n,x)=>n+x.d1,0),elapsed_ms:Math.round(performance.now()-start),calls,...(failure?{failure}:{})};rows.push(row);console.log(role,name,phase,row.api,row.d1,failure?'FAILED':'');
   if(++ticks%8===0){await control('clock?at='+encodeURIComponent(new Date(Date.parse(manifest.now)+Math.floor(ticks/8)*61000).toISOString()),'POST')}
   await writeFile(out+'/请求预算原始记录.json',JSON.stringify({inventory,rows,errors},null,2));
  };
  await capture('启动及默认页','first',async()=>{await p.goto(`/${manifest.slug}/app/`);await ready()});
  const personal=await p.locator('.personal-nav').count();
  if(personal){
   const items=await p.locator('.personal-nav button').evaluateAll(bs=>bs.map(b=>({key:b.dataset.key,label:b.textContent})));
   inventory.push({role,groups:items});
   for(const item of items){
    const open=async()=>{await p.locator(`.personal-nav button[data-key="${item.key}"]`).click();await expect(shell()).toHaveAttribute('data-personal-tab',item.key);await ready()};
    await capture(item.label,'first',open);await p.locator(`.personal-nav button[data-key="${items.find(x=>x.key!==item.key).key}"]`).click();await ready();await capture(item.label,'return',open);
   }
  }else{
   const groups=await p.locator('nav[aria-label="员工导航"] button[data-group]').evaluateAll(bs=>bs.map(b=>({key:b.dataset.group,label:b.textContent})));
   const routes=[];
   for(const group of groups){
    console.log("inventory",role,group.key);
    await p.locator(`nav[aria-label="员工导航"] button[data-group="${group.key}"]`).click();await ready();
    const tabs=await p.locator('.v-head-tabs button[data-tab-key]').evaluateAll(bs=>bs.map(b=>({key:b.dataset.tabKey,label:b.textContent})));
    if(!tabs.length){const route=await shell().getAttribute('data-route');tabs.push({key:route,label:group.label})}
    for(const tab of tabs)if(!routes.some(x=>x.key===tab.key))routes.push({...tab,group:group.label});
   }
   routes.push({key:'settings-messages',label:'系统消息',group:'顶栏'});inventory.push({role,groups,routes});
   // Discard the inventory context caches before recording page visits.
   await p.reload();await ready();
   const nav=async(key)=>{await p.evaluate(key=>{location.hash=key},key);await expect(shell()).toHaveAttribute('data-route',key);await ready()};
   for(const item of routes){
    await nav(item.key==='today'?'schedule-week':'today');
    await capture(item.group+'/'+item.label,'first',()=>nav(item.key));
    await nav(item.key==='today'?'schedule-week':'today');await capture(item.group+'/'+item.label,'return',()=>nav(item.key));
    // All visible secondary settings categories; they do not have independent hashes.
    for(const navName of ['机构设置分类','设置分类']){
     const navNode=p.getByRole('navigation',{name:navName,exact:true});if(!await navNode.count())continue;
     const labels=await navNode.getByRole('button').allTextContents();
     for(const label of labels){
      const open=async()=>{await navNode.getByRole('button',{name:label,exact:true}).click();await settle()};
      await capture(item.label+'/'+label,'first',open);
      const other=labels.find(x=>x!==label);if(other){await navNode.getByRole('button',{name:other,exact:true}).click();await settle()}
      await capture(item.label+'/'+label,'return',open);
     }
    }
   }
   await nav('today');
   // Each available global create entry is a major modal; open and close twice.
   const trigger=p.locator('.v-create').getByRole('button',{name:'新建',exact:true});
   if(await trigger.count()){
    await trigger.click();const labels=await p.locator('.v-create .ui-more-menu button').allTextContents();await p.keyboard.press('Escape');
    for(const label of labels)for(const phase of ['first','return']){
     await capture('新建弹窗/'+label,phase,async()=>{
      await trigger.click();await p.locator('.v-create .ui-more-menu').getByRole('button',{name:label,exact:true}).click();await expect(p.getByRole('dialog').first()).toBeVisible();await settle();
     });
     const close=p.getByRole('dialog').first().locator('.ui-sheet-header').getByRole('button',{name:'关闭',exact:true});
     if(await close.count())await close.click();else await p.keyboard.press('Escape');
     const discard=p.getByRole('dialog',{name:'放弃未保存的修改？',exact:true});if(await discard.count())await discard.getByRole('button',{name:'放弃修改',exact:true}).click();await settle();
    }
   }
  }
  await context.close();
 }
 await writeFile(out+'/请求预算原始记录.json',JSON.stringify({inventory,rows,errors},null,2));
}finally{await browser?.close();server.kill('SIGTERM')}
