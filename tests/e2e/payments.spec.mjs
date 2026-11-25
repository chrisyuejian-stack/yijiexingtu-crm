import { test, expect } from '@playwright/test';
import { createHarness } from './helpers.mjs';
import { alive, payForm, exposed, editReceipt, balanceTab } from './finance-helpers.mjs';

test('SCN-004 多包分配、超收转预收、响应丢失重试与缴费冲正', async ({ browser, request }, info) => {
  const h = await createHarness(browser, request, info, 'payments', ['finance', 'student', 'student2']);
  const m = h.manifest;
  let form, receiptPosts = [], committedResponseLost = false;
  try {
    await test.step('01 分配超过实收时给出可见原因，保持输入且不发保存请求', async () => {
      form = await payForm(h);
      form.p.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/api/credits/payments')) receiptPosts.push(r.postDataJSON()); });
      await form.amount.fill('100'); await form.allocation.fill('120');
      await form.save.click();
      await expect(form.save).toBeEnabled();
      const error = form.p.getByRole('alert').filter({ hasText: '分配合计超过收款金额' });
      await exposed(error, info, 'UI-003 分配校验原因应位于当前弹窗顶层');
      expect(receiptPosts).toHaveLength(0);
      expect((await h.state()).financial.payments).toHaveLength(0);
      await expect(form.amount).toHaveValue('100'); await expect(form.allocation).toHaveValue('120');
      await h.shot('finance', '分配超额未保存');
      await form.save.press('Tab');
      const dismiss = form.p.locator('.ui-toast--error').getByRole('button', { name: '关闭通知', exact: true });
      await expect(dismiss).toBeFocused();
      await dismiss.press('Enter');
    });
    await test.step('02 显示精确分配：实收1600.50，分包1300.25，预收300.25', async () => {
      await form.amount.fill('1600.50'); await form.allocation.fill('1200');
      await form.drawer.getByLabel('上线验收声乐课 本次分配金额', { exact: true }).fill('300.25');
      await form.drawer.getByLabel('备注', { exact: true }).fill('多包分配与响应丢失验收');
      await expect(form.drawer.locator('.v-pay-sum')).toContainText('¥1,600.50');
      await expect(form.drawer.locator('.v-pay-sum')).toContainText('¥1,300.25');
      await expect(form.drawer.locator('.v-pay-sum')).toContainText('¥300.25');
      await h.shot('finance', '多包分配保存前');
    });
    await test.step('03 服务端已保存但响应丢失，页面保留输入，财务数据只入一次', async () => {
      await form.p.route('**/api/credits/payments', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        await new Promise(r => setTimeout(r, 450));
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        committedResponseLost = true;
        await route.abort('failed');
      }, { times: 1 });
      await form.save.click();
      await expect(form.save).toBeDisabled();
      await expect(form.save).toBeEnabled();
      expect(committedResponseLost).toBeTruthy();
      const retryNotice = form.p.getByRole('alert').filter({ hasText: '网络连接中断' });
      await exposed(retryNotice, info, '响应丢失后的重试提示可见');
      await expect(retryNotice).toContainText('请在当前窗口重试');
      await expect(form.amount).toHaveValue('1600.50');
      const f = (await h.state()).financial;
      expect(alive(f.payments)).toHaveLength(1); expect(f.activeCashCents).toBe(160050);
      expect(f.balancesCents).toEqual([30025, 0]);
      expect(alive(f.allocations).map(x => x.amount).sort((a,b) => a-b)).toEqual([30025, 100000]);
      await h.shot('finance', '响应丢失后输入保留');
    });
    await test.step('04 用同一操作标识从页面重试，仍只有一笔收款、分配和预收', async () => {
      const [response] = await Promise.all([
        form.p.waitForResponse(r => new URL(r.url()).pathname.endsWith('/api/credits/payments') && r.request().method() === 'POST'),
        form.save.click(),
      ]);
      expect(response.status()).toBe(200); await expect(form.drawer).toHaveCount(0);
      await expect(form.p.getByRole('status').filter({ hasText: /已登记.*1,600.50/ })).toBeVisible();
      await expect(form.p.getByRole('alert').filter({ hasText: '网络连接中断' })).toHaveCount(0);
      expect(receiptPosts).toHaveLength(2); expect(receiptPosts[1].operation_id).toBe(receiptPosts[0].operation_id);
      const s = await h.state(), f = s.financial;
      expect(alive(f.payments)).toHaveLength(1); expect(alive(f.allocations)).toHaveLength(2);
      expect(alive(f.ledger)).toHaveLength(1); expect(f.balancesCents).toEqual([30025, 0]);
      await info.attach('响应丢失故障注入核对', { body: JSON.stringify({
        injection: '服务端处理成功后中断首次响应，不回滚业务数据',
        requestCount: receiptPosts.length,
        sameOperationId: receiptPosts[1].operation_id === receiptPosts[0].operation_id,
        activePayments: alive(f.payments).length,
        activeAllocations: alive(f.allocations).length,
        balanceCents: f.balancesCents[0],
      }, null, 2), contentType: 'application/json' });
      expect(f.packages.find(x=>x.id===m.packageIds[0]).paidCents).toBe(100000);
      expect(f.packages.find(x=>x.id===m.extraPackage).paidCents).toBe(30025);
      expect(s.balances).toEqual([10,8]); expect(s.accrued).toBe(0);
      await h.shot('finance', '重试后仅一笔收款');
    });
    await test.step('05 财务预收余额与学员缴费记录一致，其他学员看不到此缴费', async () => {
      const p = await balanceTab(h); await expect(p.locator('.v-pay-balance-top strong')).toHaveText('¥300.25');
      await h.shot('finance', '缴费后预收余额');
      for (const role of ['student','student2']) {
        const p = await h.go(role); await p.getByRole('button',{name:'课时缴费',exact:true}).click();
        if (role === 'student') await expect(p.getByText('¥1,600.50',{exact:true})).toBeVisible();
        else await expect(p.getByText('¥1,600.50',{exact:true})).toHaveCount(0);
      }
      await h.shot('student','本人缴费记录');
    });
    await test.step('06 冲正确认使用财务语义，取消不改变账务，填写原因后确认', async () => {
      const { p, drawer } = await editReceipt(h);
      await drawer.getByRole('button',{name:'冲正这笔缴费',exact:true}).click();
      const reason = p.getByRole('dialog').filter({has:p.getByRole('textbox',{name:'请填写冲正原因',exact:true})});
      await expect(reason.getByRole('button',{name:'确认冲正',exact:true})).toBeVisible();
      await expect(reason).not.toContainText('教师'); await expect(reason).not.toContainText('不计酬');
      await reason.getByRole('button',{name:'确认冲正',exact:true}).click();
      await expect(reason.locator('.ui-field-error')).toHaveText('请填写冲正原因');
      await h.shot('finance','冲正确认说明');
      await reason.getByRole('button',{name:'取消',exact:true}).click();
      expect((await h.state()).financial.activeCashCents).toBe(160050);
      await drawer.getByRole('button',{name:'冲正这笔缴费',exact:true}).click();
      const next = p.getByRole('dialog').filter({has:p.getByRole('textbox',{name:'请填写冲正原因',exact:true})});
      await next.getByRole('textbox',{name:'请填写冲正原因',exact:true}).fill('登记金额有误，冲正后重新核对');
      const [response] = await Promise.all([
        p.waitForResponse(r=>/\/api\/credits\/payments\/[^/]+\/reverse$/.test(new URL(r.url()).pathname)),
        next.getByRole('button',{name:'确认冲正',exact:true}).click(),
      ]);
      expect(response.status()).toBe(200); await expect(drawer).toHaveCount(0);
    });
    await test.step('07 冲正撤回原分配与预收，保留审计数据，刷新后不重复入账', async () => {
      const s = await h.state(), f = s.financial;
      expect(alive(f.payments)).toHaveLength(0); expect(f.payments).toHaveLength(1);
      expect(alive(f.allocations)).toHaveLength(0); expect(f.balancesCents).toEqual([0,0]);
      expect(f.activeCashCents).toBe(0); expect(f.packages.every(x=>x.paidCents===0)).toBeTruthy();
      expect(s.balances).toEqual([10,8]);
      const p = await balanceTab(h); await expect(p.locator('.v-pay-balance-top strong')).toHaveText('¥0');
      await h.shot('finance','冲正后余额归零');
      const student = await h.go('student'); await student.getByRole('button',{name:'课时缴费',exact:true}).click();
      await expect(student.getByText('¥1,600.50',{exact:true})).toHaveCount(0);
      await h.healthy();
    });
  } finally { await h.close(); }
});
