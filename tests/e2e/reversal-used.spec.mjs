import { test, expect } from '@playwright/test';
import { createHarness } from './helpers.mjs';
import { payForm,balanceTab,editReceipt,exposed,alive,sum } from './finance-helpers.mjs';

test('SCN-008 预收已使用时冲正被拒绝，保留原账并按可用余额退款',async({browser,request},info)=>{
  const h=await createHarness(browser,request,info,'reversal-used',['finance','student']);
  const m=h.manifest;
  try{
    await test.step('01 页面收500元预收，再兑换已有课时包200元',async()=>{
      const f=await payForm(h);await f.amount.fill('500');
      const [r]=await Promise.all([f.p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/api/credits/payments')&&r.request().method()==='POST'),f.save.click()]);
      expect(r.status()).toBe(200);await expect(f.drawer).toHaveCount(0);
      const p=await balanceTab(h);await p.getByRole('button',{name:'兑换课时包',exact:true}).click();
      const d=p.getByRole('dialog',{name:'用预收余额兑换课时包',exact:true});
      await d.getByLabel(`${m.course} 本次分配金额`,{exact:true}).fill('200');
      const [redeemed]=await Promise.all([p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/api/credits/balance/redeem')),d.getByRole('button',{name:'确认兑换',exact:true}).click()]);
      expect(redeemed.status()).toBe(200);await expect(d).toHaveCount(0);
      expect((await h.state()).financial.balancesCents).toEqual([30000,0]);
    });
    await test.step('02 冲正已用预收的缴费时明确拒绝，全部账务和原记录保持不变',async()=>{
      const before=(await h.state()).financial;
      const {p,drawer}=await editReceipt(h);await drawer.getByRole('button',{name:'冲正这笔缴费',exact:true}).click();
      const d=p.getByRole('dialog',{name:'请填写冲正原因',exact:true});
      await d.getByRole('textbox',{name:'请填写冲正原因',exact:true}).fill('尝试更正这笔已兑换部分的预收');
      const [r]=await Promise.all([
        p.waitForResponse(r=>/\/api\/credits\/payments\/[^/]+\/reverse$/.test(new URL(r.url()).pathname)),
        d.getByRole('button',{name:'确认冲正',exact:true}).click(),
      ]);
      await h.acceptRejection('finance',r,{statuses:[409],message:/预收余额不足.*不能冲正/,why:'原预收500元已兑换200元，剩余300元不足以撤回原存入500元'});
      await exposed(p.getByRole('alert').filter({hasText:'不能冲正'}),info,'已用预收冲正拒绝说明可见');
      expect((await h.state()).financial).toEqual(before);
      await expect(drawer).toBeVisible();await expect(drawer.getByRole('button',{name:'冲正这笔缴费',exact:true})).toBeEnabled();
      await h.shot('finance','已用预收冲正被拒绝');
      await drawer.getByRole('button',{name:'取消',exact:true}).click();await expect(drawer).toHaveCount(0);
    });
    await test.step('03 查看余额流水后，只退可用预收100元，不撤回已兑换金额',async()=>{
      const p=await balanceTab(h);await expect(p.locator('.v-pay-balance-top strong')).toHaveText('¥300');
      await p.locator('.v-pay-ledger summary').click();await expect(p.locator('.v-pay-ledger')).toContainText('兑换课时包');
      await h.shot('finance','核对已用预收流水');
      await p.getByRole('button',{name:'退款 / 调整',exact:true}).click();
      const d=p.getByRole('dialog',{name:'预收余额 · 退款或调整',exact:true});
      await d.getByLabel('金额（元）',{exact:true}).fill('100');await d.getByLabel('原因 *',{exact:true}).fill('退回尚未使用的部分预收');
      const [r]=await Promise.all([p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/api/credits/balance/adjust')),d.getByRole('button',{name:'确认',exact:true}).click()]);
      expect(r.status()).toBe(200);await expect(d).toHaveCount(0);await expect(p.locator('.v-pay-balance-top strong')).toHaveText('¥200');
    });
    await test.step('04 刷新后仍一笔原收款、一笔兑换、一笔退款，整数分去向一致',async()=>{
      await balanceTab(h);const s=await h.state(),f=s.financial;
      expect(alive(f.payments)).toHaveLength(1);expect(f.activeCashCents).toBe(50000);expect(f.balancesCents).toEqual([20000,0]);
      expect(alive(f.allocations)).toHaveLength(1);expect(sum(alive(f.allocations))).toBe(20000);
      const refunds=alive(f.ledger).filter(x=>x.type==='refund');expect(refunds).toHaveLength(1);expect(refunds[0].amount).toBe(-10000);
      expect(f.activeCashCents).toBe(sum(alive(f.allocations))+f.balancesCents[0]-sum(refunds));
      expect(s.balances).toEqual([10,8]);await h.shot('finance','冲正失败后退款恢复完成');await h.healthy();
    });
  }finally{await h.close();}
});
