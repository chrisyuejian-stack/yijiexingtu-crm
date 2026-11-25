import { test, expect } from '@playwright/test';
import { createHarness } from './helpers.mjs';
import { payForm, balanceTab, exposed, alive, sum } from './finance-helpers.mjs';

test('SCN-006 两位财务同时兑换同一预收，单笔生效及失败后恢复', async ({ browser, request }, info) => {
  const h = await createHarness(browser, request, info, 'concurrency', ['finance', 'finance2', 'student']);
  const m = h.manifest, forms = {};
  let loser;
  try {
    await test.step('01 通过页面存入300元，两位独立财务均打开同一余额', async () => {
      const form = await payForm(h); await form.amount.fill('300');
      const [r] = await Promise.all([
        form.p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/api/credits/payments')&&r.request().method()==='POST'),
        form.save.click(),
      ]);
      expect(r.status()).toBe(200); await expect(form.drawer).toHaveCount(0);
      for (const role of ['finance', 'finance2']) {
        const p = await balanceTab(h, role);
        await expect(p.locator('.v-pay-balance-top strong')).toHaveText('¥300');
        await p.getByRole('button',{name:'兑换课时包',exact:true}).click();
        const d = p.getByRole('dialog',{name:'用预收余额兑换课时包',exact:true});
        await d.getByRole('button',{name:'＋ 新建课时包并分配',exact:true}).click();
        const fresh = d.locator('.v-pay-new');
        await fresh.getByRole('combobox',{name:/^适用课程/}).selectOption(m.courseId);
        await fresh.getByLabel('课时数',{exact:true}).fill('2');
        await fresh.getByLabel('课时包金额（元）',{exact:true}).fill('200');
        await expect(d.locator('.v-pay-sum')).toContainText('兑换 ¥200，兑换后剩余 ¥100');
        forms[role] = { p, d, save: d.getByRole('button',{name:'确认兑换',exact:true}) };
        await h.shot(role,'并发兑换前');
      }
    });
    await test.step('02 两个页面请求在屏障后同时放行，必须一成一败', async () => {
      let arrived = 0, release;
      const gate = new Promise(resolve=>{ release=resolve; });
      for (const { p } of Object.values(forms)) await p.route('**/api/credits/balance/redeem', async route=>{
        arrived++; if (arrived===2) release(); await gate; await route.continue();
      },{times:1});
      const waits = Object.entries(forms).map(async ([role,{p,save}])=>{
        const [response] = await Promise.all([
          p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/api/credits/balance/redeem')),
          save.click(),
        ]);
        return { role, response };
      });
      const results = await Promise.all(waits);
      expect(arrived).toBe(2);
      expect(results.filter(x=>x.response.status()===200)).toHaveLength(1);
      loser = results.find(x=>x.response.status()!==200).role;
      const rejected = results.find(x=>x.role===loser);
      await h.acceptRejection(loser,rejected.response,{statuses:[400,409],message:/可用金额|余额|数据.*变|版本|刷新/,
        why:'两个财务同时兑换200元，300元余额只允许其中一笔生效'});
      await info.attach('并发响应',{body:JSON.stringify(results.map(x=>({role:x.role,status:x.response.status()})),null,2),contentType:'application/json'});
    });
    await test.step('03 只新增一个2课时包，余额100元；失败方看到原因且保留输入', async () => {
      const s = await h.state(),f=s.financial;
      expect(f.balancesCents).toEqual([10000,0]); expect(f.packages).toHaveLength(3);
      expect(alive(f.allocations)).toHaveLength(1);
      expect(sum(alive(f.ledger).filter(x=>x.type==='redeem'))).toBe(-20000);
      expect(f.packages.filter(x=>!m.packageIds.includes(x.id))[0]).toMatchObject({units_total:2,paidCents:20000,unitsBalance:2});
      const {p,d} = forms[loser];
      await exposed(p.getByRole('alert'),info,'并发失败原因未被遮挡');
      await expect(p.getByRole('alert')).toContainText('当前可用 ¥100');
      await expect(d.locator(':scope > .ui-sheet .ui-muted').first()).toContainText('预收余额 ¥100');
      await expect(d.locator('.v-pay-new').getByLabel('本次兑换（元）',{exact:true})).toHaveValue('200');
      await h.shot(loser,'并发失败保留输入');
    });
    await test.step('04 失败方在原窗口按新余额修改为兑换已有包50元，正常继续', async () => {
      const {p,d:next}=forms[loser];
      await next.locator('.v-pay-new').getByRole('button',{name:'移除',exact:true}).click();
      await next.locator('.v-pay-pk').filter({hasText:`${m.course} · 10`}).getByLabel(`${m.course} 本次分配金额`,{exact:true}).fill('50');
      const [r]=await Promise.all([
        p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/api/credits/balance/redeem')),
        next.getByRole('button',{name:'确认兑换',exact:true}).click(),
      ]);
      expect(r.status()).toBe(200); await expect(next).toHaveCount(0);
      await expect(p.locator('.v-pay-balance-top strong')).toHaveText('¥50');
      await h.shot(loser,'并发失败后恢复');
    });
    await test.step('05 两位财务刷新结果一致，资金去向和课时不重复', async () => {
      for(const role of ['finance','finance2']){
        const p=await balanceTab(h,role);await expect(p.locator('.v-pay-balance-top strong')).toHaveText('¥50');
      }
      const f=(await h.state()).financial;
      expect(f.packages).toHaveLength(3); expect(alive(f.allocations)).toHaveLength(2);
      expect(f.activeCashCents).toBe(30000);expect(f.balancesCents).toEqual([5000,0]);
      expect(sum(alive(f.allocations))+f.balancesCents[0]).toBe(30000);
      await h.healthy();
    });
  } finally { await h.close(); }
});
