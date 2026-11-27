import { test, expect } from '@playwright/test';
import { createHarness } from './helpers.mjs';
import { exposed } from './finance-helpers.mjs';

test('SCN-009 五类账号真实登录、首次改密、错误恢复和退出会话失效', async ({ browser, request }, info) => {
  const roles = ['teacher','academic','supervisor','finance','student'];
  const h = await createHarness(browser, request, info, 'authentication', [...roles,'teacherPeer'], { bootstrapSession: false });
  const m = h.manifest, nextPassword = 'ScenarioFresh8Q';
  const teacher = h.actors.teacher.page;
  const submitLogin = async (role, password = m.loginAccounts[role === 'teacherPeer' ? 'teacher' : role].password) => {
    const p = h.actors[role].page;
    await p.goto(`/${m.slug}/login`);
    await p.getByLabel('手机号',{exact:true}).fill(m.loginAccounts[role === 'teacherPeer' ? 'teacher' : role].phone);
    await p.getByLabel('密码',{exact:true}).fill(password);
    const [r] = await Promise.all([
      p.waitForResponse(r=>/\/api\/(?:auth\/)?login$/.test(new URL(r.url()).pathname)&&r.request().method()==='POST'),
      p.getByRole('button',{name:'登录',exact:true}).click(),
    ]);
    return r;
  };
  const fillChange = async (role, fresh, confirm = fresh, old = m.loginAccounts[role].password) => {
    const p = h.actors[role].page;
    await p.getByLabel('原密码',{exact:true}).fill(old);
    await p.getByLabel('新密码',{exact:true}).fill(fresh);
    await p.getByLabel('再次输入新密码',{exact:true}).fill(confirm);
  };
  const submitChange = async role => {
    const p = h.actors[role].page;
    const [r] = await Promise.all([
      p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/api/password')),
      p.getByRole('button',{name:'保存并重新登录',exact:true}).click(),
    ]);
    return r;
  };
  const readMe = async role => {
    const p = h.actors[role].page;
    const [r] = await Promise.all([
      p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/api/me')),
      p.evaluate(async path => { const r=await fetch(path); await r.text(); }, `/${m.slug}/api/me`),
    ]);
    return r;
  };
  try {
    await test.step('01 无预建浏览器会话；错误登录原因可见，关闭挑战时不加载外部验证', async()=>{
      expect(await h.actors.teacher.context.cookies()).toEqual([]);
      const r = await submitLogin('teacher','WrongLogin8Z');
      await h.acceptRejection('teacher',r,{statuses:[401],message:/手机号或密码不正确/,why:'专用虚构账号主动输入一次错误密码'});
      await exposed(teacher.locator('.yx-login-error,.form-error').filter({hasText:'手机号或密码不正确'}),info,'错误登录原因可见');
      await expect(teacher.getByLabel('手机号',{exact:true})).toHaveValue(m.loginAccounts.teacher.phone);
      await expect(teacher.locator('script[src*="challenges.cloudflare.com"],.challenge,.yx-challenge')).toHaveCount(0);
      await h.shot('teacher','错误登录保留手机号');
    });
    await test.step('02 教师首次登录必须改密；不一致和弱密码被拒绝，输入仍可修正', async()=>{
      expect((await submitLogin('teacher')).status()).toBe(200);
      await expect(teacher.getByRole('heading',{name:'请先修改初始密码',exact:true})).toBeVisible();
      await expect(teacher.getByRole('button',{name:'课表',exact:true})).toBeHidden();
      await fillChange('teacher',nextPassword,'Different8Q');
      let writes=0; const count=r=>{if(new URL(r.url()).pathname.endsWith('/api/password')&&r.method()==='POST')writes++;};
      teacher.on('request',count);
      await teacher.getByRole('button',{name:'保存并重新登录',exact:true}).click();
      await exposed(teacher.locator('.form-error').filter({hasText:'两次输入'}),info,'密码确认不一致原因可见');
      expect(writes).toBe(0);teacher.off('request',count);
      await fillChange('teacher','password123');
      const r=await submitChange('teacher');
      await h.acceptRejection('teacher',r,{statuses:[400],message:/密码须为/,why:'主动选择常见弱密码，校验拒绝且不变更账号'});
      await exposed(teacher.locator('.form-error').filter({hasText:'密码须为'}),info,'弱密码原因可见');
      expect((await h.state()).authUsers.find(x=>x.role==='teacher').must_change).toBe(1);
      await h.shot('teacher','首次改密拒绝弱密码');
    });
    await test.step('03 正确改密后要求重新登录，原会话及旧密码失效', async()=>{
      // A second independently logged-in browser retains its real cookie while another browser changes the password.
      expect((await submitLogin('teacherPeer')).status()).toBe(200);
      await expect(h.actors.teacherPeer.page.getByRole('heading',{name:'请先修改初始密码',exact:true})).toBeVisible();
      await fillChange('teacher',nextPassword);
      expect((await submitChange('teacher')).status()).toBe(200);
      await expect(teacher).toHaveURL(new RegExp(`/${m.slug}/login$`));
      const invalid=await readMe('teacher');
      await h.acceptRejection('teacher',invalid,{statuses:[401],message:/重新登录/,why:'改密使当前原会话失效'});
      const peer=await readMe('teacherPeer');
      await h.acceptRejection('teacherPeer',peer,{statuses:[401],message:/重新登录/,why:'另一独立登录窗口仍携带原真实Cookie，改密后也必须失效'});
      const old=await submitLogin('teacher');
      await h.acceptRejection('teacher',old,{statuses:[401],message:/手机号或密码不正确/,why:'改密后旧临时密码不能再次登录'});
      expect((await submitLogin('teacher',nextPassword)).status()).toBe(200);
      await expect(teacher.locator('.personal-content')).toHaveAttribute('aria-busy','false');
      await expect(teacher.getByRole('heading',{name:'请先修改初始密码',exact:true})).toHaveCount(0);
      await expect(teacher.getByRole('button').filter({hasText:m.course}).first()).toBeVisible();
      await h.shot('teacher','新密码登录教师课表');
    });
    await test.step('04 教务首次改密期间不能被业务导航带离，且不发无权限业务请求', async()=>{
      expect((await submitLogin('academic')).status()).toBe(200);
      const p=h.actors.academic.page;
      await expect(p.getByRole('heading',{name:'请先修改初始密码',exact:true})).toBeVisible();
      const schedule=p.getByRole('button',{name:'课表',exact:true});
      if(await schedule.isVisible()) {
        await schedule.click();
        await expect(p.locator('.v-content')).toHaveAttribute('aria-busy','false');
        await h.shot('academic','首次改密点击课表后');
        await expect(p.getByRole('heading',{name:'请先修改初始密码',exact:true})).toBeVisible();
      }
      await expect(schedule).toBeHidden();
      // An external old bookmark/hash must also keep the user on the required password form.
      await p.evaluate(()=>{location.hash='schedule';});
      await expect(p.getByRole('heading',{name:'请先修改初始密码',exact:true})).toBeVisible();
      await expect(p.getByLabel('新密码',{exact:true})).toBeVisible();
      await h.shot('academic','首次改密不被导航打断');
    });
    await test.step('05 主管教务财务学员完成真实改密重登，进入各自可用页面', async()=>{
      for(const role of ['academic','supervisor','finance','student']){
        const p=h.actors[role].page;
        if(role!=='academic') expect((await submitLogin(role)).status()).toBe(200);
        await expect(p.getByRole('heading',{name:'请先修改初始密码',exact:true})).toBeVisible();
        if(role==='student') {
          await p.getByRole('button',{name:'退出登录',exact:true}).click();
          await expect(p).toHaveURL(new RegExp(`/${m.slug}/login$`));
          expect((await submitLogin(role)).status()).toBe(200);
          await expect(p.getByRole('heading',{name:'请先修改初始密码',exact:true})).toBeVisible();
        }
        await fillChange(role,nextPassword);
        expect((await submitChange(role)).status()).toBe(200);
        await expect(p).toHaveURL(new RegExp(`/${m.slug}/login$`));
        expect((await submitLogin(role,nextPassword)).status()).toBe(200);
        await expect(p.locator('.personal-content,.v-content').first()).toHaveAttribute('aria-busy','false');
        await expect(p.getByRole('heading',{name:'请先修改初始密码',exact:true})).toHaveCount(0);
        if(role==='student') await expect(p.getByRole('button',{name:'课时缴费',exact:true})).toBeVisible();
        else await expect(p.locator('.v-content')).toHaveAttribute('data-route','today');
        await h.shot(role,'首次改密后进入业务页');
      }
      const users=(await h.state()).authUsers;
      for(const role of roles) expect(users.find(x=>x.role===role)).toMatchObject({must_change:0,active:1});
    });
    await test.step('06 教师从我的退出，返回旧地址和旧会话均不能继续访问', async()=>{
      // Keep a copy of the actual login cookie in memory only, so clearing the current browser's cookie cannot hide a revocation bug.
      await h.actors.teacherPeer.context.clearCookies();
      await h.actors.teacherPeer.context.addCookies(await h.actors.teacher.context.cookies());
      await teacher.getByRole('button',{name:'我的',exact:true}).click();
      await teacher.getByRole('button',{name:/^退出登录/}).click();
      await expect(teacher).toHaveURL(new RegExp(`/${m.slug}/login$`));
      const invalid=await readMe('teacher');
      await h.acceptRejection('teacher',invalid,{statuses:[401],message:/重新登录/,why:'退出后当前会话必须失效'});
      const replay=await readMe('teacherPeer');
      await h.acceptRejection('teacherPeer',replay,{statuses:[401],message:/重新登录/,why:'退出后重放先前真实会话Cookie也不能读取账号'});
      // The document route may redirect before JavaScript runs; do not require a redundant /api/me request.
      await teacher.goto(`/${m.slug}/app/`);
      await expect(teacher).toHaveURL(new RegExp(`/${m.slug}/login$`));
      await expect(teacher.getByRole('button',{name:'登录',exact:true})).toBeVisible();
      await h.shot('teacher','退出后旧地址返回登录');
    });
    await test.step('07 登录改密不改变课程课时和资金，浏览器无非预期错误', async()=>{
      const s=await h.state();expect(s.balances).toEqual([10,8]);expect(s.transactions).toHaveLength(0);
      expect(s.financial.activeCashCents).toBe(0);expect(s.financial.balancesCents).toEqual([0,0]);
      await h.healthy();
    });
  } finally { await h.close(); }
});
