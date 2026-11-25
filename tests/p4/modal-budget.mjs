// Baseline browser census. Only disposable local data; no application source changes.
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
const root=process.env.P4_BASELINE;
if(!root)throw Error('P4_BASELINE must point to the unmodified fifth-round source');
const out=process.env.P4_OUTPUT||'docs/p4',port=4391,base=`http://localhost:${port}`,key=randomBytes(32).toString('hex'),headers={'x-e2e-key':key};
await mkdir(out,{recursive:true});
const server=spawn(process.execPath,[process.env.P4_SERVER||'scripts/e2e/server.mjs'],{cwd:root,env:{...process.env,E2E_PORT:String(port),E2E_CONTROL_KEY:key},stdio:['ignore','ignore','pipe']});
let stderr='';server.stderr.on('data',x=>stderr+=x);
const control=async(path,method='GET')=>{const res=await fetch(base+'/__e2e/'+path,{method,headers});if(!res.ok)throw Error(`control ${path}: ${res.status}`);return res.json()};
const rows=[],inventory=[],errors=[];let browser;
try{
 for(let i=0;i<100;i++){try{await control('health');break}catch{if(server.exitCode!==null)throw Error(stderr);await new Promise(r=>setTimeout(r,100))}}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium'});
 for(const role of (process.env.P4_ROLES||'supervisor,academic,finance,teacher,student').split(',')){
  const manifest=await control('reset?kind='+(process.env.P4_KIND||'scheduling'),'POST');let ticks=0;
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
   await writeFile(out+'/弹窗及内页原始记录.json',JSON.stringify({inventory,rows,errors},null,2));
  };
  await capture('启动及默认页','first',async()=>{await p.goto(`/${manifest.slug}/app/`);await ready()});

  const close=async()=>{
    for(let i=0;i<4&&await p.getByRole('dialog').count();i++){
      const d=p.getByRole('dialog').last(), handle=await d.elementHandle();
      const b=d.locator('.ui-sheet-header').getByRole('button',{name:'关闭',exact:true});
      if(await b.count())await b.click();else {const cancel=d.getByRole('button',{name:/^取消$/});if(await cancel.count())await cancel.click();else await p.keyboard.press('Escape')}
      const discard=p.getByRole('dialog',{name:'放弃未保存的修改？',exact:true});
      if(await discard.count())await discard.getByRole('button',{name:'放弃修改',exact:true}).click();
      await expect.poll(()=>handle.evaluate(x=>!x.isConnected),{timeout:10000}).toBe(true);
    }
    await settle();
  };
  const modal=async(name,action)=>{
   for(const phase of ['first','return']){
    await capture(name,phase,async()=>{await action();await expect(p.getByRole('dialog').first()).toBeVisible();await settle()});await close();
   }
  };
  if(['teacher','student'].includes(role)){
    for(const phase of ['first','return']) {
      await capture('个人端课程详情',phase,async()=>{await p.getByRole('button').filter({hasText:manifest.course}).first().click();await expect(p.getByRole('heading',{name:'课程详情',exact:true})).toBeVisible()});
      await p.getByRole('button',{name:'返回',exact:true}).click();await ready();
    }
    await p.locator('.personal-nav button[data-key="my"]').click();await ready();
    for(const name of ['登录设备','修改密码']){
     const b=p.locator('.v-m-menu-item').filter({hasText:name});if(await b.count())await modal('个人端/'+name,()=>b.click());
    }
  }else{
   const nav=async(key)=>{await p.evaluate(key=>{location.hash=key},key);await expect(shell()).toHaveAttribute('data-route',key);await ready()};
   const routes=process.env.P4_ROUTES ? process.env.P4_ROUTES.split(',') : role==='finance'?['finance-income','finance-packages','finance-pay','finance-costs','finance-reports','finance-rates','settings-logs']:['admin-courses','settings-institution','todo-unchecked','todo-followup','todo-renewal','schedule-fixed','schedule-classes','students','settings-teachers','teachers-rates','enrol-leads','settings-accounts',...(role==='supervisor'?['finance-income','finance-packages','finance-pay','finance-costs','finance-reports']:[])];
   for(const route of routes){
    // Permissions are discovered from the baseline shell; absent pages are not fabricated.
    await p.evaluate(key=>{location.hash=key},route);await ready();if(await shell().getAttribute('data-route')!==route){inventory.push({role,route,unavailable:true});continue}
    const tabs=p.locator('.v-head-tabs button:not([data-tab-key]),.v-inner-tabs button,.v-ptabs button,[aria-label="收款分页"] button,[role="tablist"]:not([aria-label="选择日期"]) [role="tab"]');
    const labels=(await tabs.allTextContents()).map(x=>x.trim());inventory.push({role,route,tabs:labels});
    for(const label of labels){
      const open=async()=>{await tabs.nth(labels.indexOf(label)).click();await settle()};
      await capture(route+'/'+label,'first',open);
      const other=labels.find(x=>x!==label);if(other) {await tabs.nth(labels.indexOf(other)).click();await settle()}
      await capture(route+'/'+label,'return',open);
      if(route==='admin-courses'){
        const add=p.getByRole('button',{name:/^＋ 新增/}).first();if(await add.count())await modal(route+'/'+label+'/新增',()=>add.click());
      }
    }
    const names={
      'todo-renewal':['修改规则'],
      'todo-makeup':['安排补课'],
      'schedule-fixed':['＋ 固定排课','生成未来课程'],
      'schedule-classes':['＋ 新建班级'],
      'students':['编辑档案','＋ 课时包','生成课表图'],
      'settings-teachers':['＋ 新建教师'],
      'teachers-rates':['＋ 新增课酬标准'],
      'finance-rates':['＋ 新增课酬标准'],
      'todo-followup':['＋ 新增跟进'],
      'enrol-leads':['＋ 登记线索'],
      'settings-accounts':['＋ 新建员工账号'],
      'finance-costs':['＋ 新增成本'],
    }[route]||[];
    for(const name of names){const b=p.getByRole('button',{name,exact:true}).first();if(await b.count())await modal(route+'/'+name,()=>b.click());else inventory.push({role,route,modal:name,unavailable:true})}
    if(route==='todo-unchecked' && process.env.P4_KIND==='attendance') {
      const button=p.getByRole('button').filter({hasText:'老师已提交、等确认'}).first();if(await button.count())await button.click();await settle();
      for(const phase of ['first','return']) {
       await capture('待确认销课详情',phase,async()=>{await p.getByRole('row').filter({hasText:manifest.course}).getByRole('cell').nth(1).click();await expect(p.getByRole('button',{name:'确认并生效',exact:true})).toBeVisible();await settle()});
       await nav('today');await nav('todo-unchecked');await p.getByRole('button').filter({hasText:'老师已提交、等确认'}).first().click();await settle();
      }
    }
    if(route==='finance-income'){
      // Payments selector loads more data after selecting a student; include that work.
      const b=p.getByRole('button',{name:'＋ 登记缴费',exact:true});if(await b.count())await modal('登记缴费并选择学员',async()=>{await b.click();await p.getByRole('dialog').getByRole('combobox',{name:/^学员/}).selectOption(manifest.studentIds[0]);await expect(p.getByRole('dialog').getByLabel(manifest.course+' 本次分配金额',{exact:true})).toBeVisible()});
      const balance=p.getByRole('button',{name:'预收余额',exact:true});if(await balance.count()){
        await balance.click();await settle();await p.getByRole('combobox',{name:/^学员/}).selectOption(manifest.studentIds[0]);await settle();
        for(const name of ['兑换课时包','退款 / 调整']){const b=p.getByRole('button',{name,exact:true});if(await b.count())await modal('预收/'+name,()=>b.click())}
      }
    }
   }
  }
  await context.close();
 }
 await writeFile(out+'/弹窗及内页原始记录.json',JSON.stringify({inventory,rows,errors},null,2));
}finally{await browser?.close();server.kill('SIGTERM')}
