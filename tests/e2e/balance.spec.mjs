import { test, expect } from '@playwright/test';
import { createHarness } from './helpers.mjs';
import { alive, sum, payForm, balanceTab, exposed } from './finance-helpers.mjs';

test('SCN-005 预收存入、兑换已有及新包、超额退款拦截与分位对账', async ({ browser, request }, info) => {
  const h = await createHarness(browser, request, info, 'balance', ['finance','student','student2']);
  const m = h.manifest;
  try {
    await test.step('01 整笔500.50元进预收，未分配时不改变课时包已收和课时', async () => {
      const form = await payForm(h);
      await form.amount.fill('500.50'); await form.drawer.getByLabel('备注',{exact:true}).fill('预收兑换与退款验收');
      await expect(form.drawer.locator('.v-pay-sum')).toContainText('¥500.50');
      const [r] = await Promise.all([
        form.p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/api/credits/payments')&&r.request().method()==='POST'),
        form.save.click(),
      ]);
      expect(r.status()).toBe(200); await expect(form.drawer).toHaveCount(0);
      const s=await h.state(), f=s.financial;
      expect(f.activeCashCents).toBe(50050); expect(f.balancesCents).toEqual([50050,0]);
      expect(alive(f.allocations)).toHaveLength(0); expect(s.balances).toEqual([10,8]);
      const p=await balanceTab(h); await expect(p.locator('.v-pay-balance-top strong')).toHaveText('¥500.50');
      await h.shot('finance','整笔预收存入');
    });
    await test.step('02 超额兑换提示清楚、页面可改正，后端未产生流水', async () => {
      const p=h.actors.finance.page;
      await p.getByRole('button',{name:'兑换课时包',exact:true}).click();
      const d=p.getByRole('dialog',{name:'用预收余额兑换课时包',exact:true});
      await d.getByLabel(`${m.course} 本次分配金额`,{exact:true}).fill('600');
      await d.getByRole('button',{name:'确认兑换',exact:true}).click();
      await exposed(p.getByRole('alert').filter({hasText:'兑换合计超过预收余额'}),info,'超额兑换原因可见');
      expect((await h.state()).financial.balancesCents).toEqual([50050,0]);
      await h.shot('finance','超额兑换被拦截');
      await d.getByLabel(`${m.course} 本次分配金额`,{exact:true}).fill('100');
      await d.getByRole('button',{name:'＋ 新建课时包并分配',exact:true}).click();
      const fresh=d.locator('.v-pay-new');
      await fresh.getByRole('combobox',{name:/^适用课程/}).selectOption(m.courseId);
      await fresh.getByLabel('课时数',{exact:true}).fill('2');
      await fresh.getByLabel('课时包金额（元）',{exact:true}).fill('200');
      await expect(fresh.getByLabel('本次兑换（元）',{exact:true})).toHaveValue('200');
      await expect(d.locator('.v-pay-sum')).toContainText('兑换 ¥300，兑换后剩余 ¥200.50');
      await h.shot('finance','已有与新包兑换前');
    });
    await test.step('03 确认兑换300元，已有包已收100，新建2课时包已收200，仅扣一次余额', async () => {
      const p=h.actors.finance.page,d=p.getByRole('dialog',{name:'用预收余额兑换课时包',exact:true});
      const [r]=await Promise.all([
        p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/api/credits/balance/redeem')),
        d.getByRole('button',{name:'确认兑换',exact:true}).click(),
      ]);
      expect(r.status()).toBe(200);await expect(d).toHaveCount(0);
      await expect(p.getByRole('alert').filter({hasText:'兑换合计超过预收余额'})).toHaveCount(0);
      const s=await h.state(),f=s.financial;
      expect(f.balancesCents).toEqual([20050,0]);expect(f.activeCashCents).toBe(50050);
      expect(alive(f.payments)).toHaveLength(1);expect(alive(f.allocations)).toHaveLength(2);
      expect(alive(f.ledger).filter(x=>x.type==='redeem')).toHaveLength(2);
      expect(sum(alive(f.ledger).filter(x=>x.type==='redeem'))).toBe(-30000);
      expect(f.packages).toHaveLength(3);
      expect(f.packages.find(x=>x.id===m.packageIds[0]).paidCents).toBe(10000);
      const fresh=f.packages.find(x=>!m.packageIds.includes(x.id));
      expect(fresh).toMatchObject({student_id:m.studentIds[0],units_total:2,amount:20000,paidCents:20000,unitsBalance:2});
      await expect(p.locator('.v-pay-balance-top strong')).toHaveText('¥200.50');await h.shot('finance','兑换后预收余额');
    });
    await test.step('04 退款超过余额时不写入，原因在弹窗内可见且输入保留', async () => {
      const p=h.actors.finance.page;
      await p.getByRole('button',{name:'退款 / 调整',exact:true}).click();
      const d=p.getByRole('dialog',{name:'预收余额 · 退款或调整',exact:true});
      await d.getByLabel('金额（元）',{exact:true}).fill('201');
      await d.getByLabel('原因 *',{exact:true}).fill('退回多收部分');
      await d.getByRole('button',{name:'确认',exact:true}).click();
      await exposed(p.getByRole('alert').filter({hasText:'余额不能变成负数'}),info,'超额退款原因可见');
      await expect(d.getByLabel('金额（元）',{exact:true})).toHaveValue('201');
      expect((await h.state()).financial.balancesCents).toEqual([20050,0]);
      expect(alive((await h.state()).financial.ledger).filter(x=>x.type==='refund')).toHaveLength(0);
      await h.shot('finance','超额退款未保存');
    });
    await test.step('05 修正退款50.25元后余额为150.25，现金去向按整数分核对', async () => {
      const p=h.actors.finance.page,d=p.getByRole('dialog',{name:'预收余额 · 退款或调整',exact:true});
      await d.getByLabel('金额（元）',{exact:true}).fill('50.25');
      const [r]=await Promise.all([
        p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/api/credits/balance/adjust')),
        d.getByRole('button',{name:'确认',exact:true}).click(),
      ]);
      expect(r.status()).toBe(200);await expect(d).toHaveCount(0);
      await expect(p.locator('.v-pay-balance-top strong')).toHaveText('¥150.25');
      await expect(p.getByRole('alert').filter({hasText:'余额不能变成负数'})).toHaveCount(0);
      const f=(await h.state()).financial,alloc=alive(f.allocations),refunds=alive(f.ledger).filter(x=>x.type==='refund');
      expect(refunds).toHaveLength(1);expect(refunds[0].amount).toBe(-5025);
      expect(f.activeCashCents).toBe(sum(alloc)+f.balancesCents[0]-sum(refunds));
      expect(f.balancesCents).toEqual([15025,0]);await h.shot('finance','退款后分位余额');
    });
    await test.step('06 学员仅看到自己的新包和收款，刷新不重复兑换或退款', async () => {
      for(const role of ['student','student2']){
        const p=await h.go(role);await p.getByRole('button',{name:'课时缴费',exact:true}).click();
        if(role==='student'){
          await expect(p.getByText('¥500.50',{exact:true})).toBeVisible();
          expect((await p.locator('.v-m-pkg-num strong').allTextContents()).sort()).toEqual(['10','2']);
        }else{
          await expect(p.getByText('¥500.50',{exact:true})).toHaveCount(0);
          await expect(p.locator('.v-m-pkg-num strong')).toHaveText('8');
        }
      }
      await h.shot('student','兑换后本人课时包');
      const before=(await h.state()).financial;
      const p=await balanceTab(h);await expect(p.locator('.v-pay-balance-top strong')).toHaveText('¥150.25');
      const after=(await h.state()).financial;
      expect(after).toEqual(before);await h.healthy();
    });
  }finally{await h.close();}
});
