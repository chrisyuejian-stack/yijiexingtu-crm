import { test, expect } from '@playwright/test';
import { createHarness } from './helpers.mjs';

test('SCN-011 方案发送与签约不白屏、Toast 不拦截顶栏且常规确认非红按钮', async ({ browser, request }, info) => {
  const h = await createHarness(browser, request, info, 'attendance', ['supervisor']);
  const m = h.manifest;
  const p = await h.go('supervisor');

  try {
    await test.step('01 启用学科并新建空白课程方案', async () => {
      await p.goto(`/${m.slug}/app#inst-subjects`);
      await expect(p.locator('.v-content')).toHaveAttribute('aria-busy', 'false');
      await Promise.all([
        p.waitForResponse(r => new URL(r.url()).pathname.endsWith('/api/settings/subjects') && r.request().method() === 'POST'),
        p.getByRole('button', { name: '导入模板', exact: true }).first().click(),
      ]);

      await p.goto(`/${m.slug}/app#yx-plans`);
      await expect(p.locator('.v-content')).toHaveAttribute('aria-busy', 'false');
      await p.getByRole('button', { name: '＋ 新建方案', exact: true }).click();
      await p.getByRole('radio', { name: '已有学员', exact: true }).click();
      const [created] = await Promise.all([
        p.waitForResponse(r => new URL(r.url()).pathname.endsWith('/api/plans') && r.request().method() === 'POST'),
        p.getByRole('button', { name: '建好并打开', exact: true }).click(),
      ]);
      expect(created.status()).toBe(201);
    });

    const editor = p.getByRole('dialog', { name: '课程方案', exact: true });
    await expect(editor).toBeVisible();

    await test.step('02 发送给家长：非危险确认非红色，发送后重载完整方案不白屏', async () => {
      await editor.getByRole('button', { name: '发送给家长', exact: true }).click();
      const confirmSend = p.getByRole('dialog').filter({ has: p.getByText('发送给家长？', { exact: true }) });
      await expect(confirmSend).toBeVisible();

      const confirmBtn = confirmSend.getByRole('button', { name: '确认', exact: true });
      await expect(confirmBtn).toHaveClass(/ui-button--primary/);
      await expect(confirmBtn).not.toHaveClass(/ui-button--danger/);

      const [sent] = await Promise.all([
        p.waitForResponse(r => /\/api\/plans\/[^/]+\/send$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST'),
        confirmBtn.click(),
      ]);
      expect(sent.status()).toBe(200);

      await expect(editor).toBeVisible();
      await expect(editor.getByRole('textbox', { name: '方案标题', exact: true })).toBeVisible();
      await expect(editor.getByRole('button', { name: '重新发送给家长', exact: true })).toBeVisible();
    });

    await test.step('03 Toast 显示期间不拦截编辑器顶栏点击，签约确认同样非红色', async () => {
      await expect(p.locator('.ui-toast--success', { hasText: '已发送' })).toBeVisible();
      await editor.getByRole('button', { name: '更多', exact: true }).click();
      const signItem = p.getByRole('button', { name: '签约', exact: true });
      await expect(signItem).toBeVisible();
      await signItem.click();

      const confirmSign = p.getByRole('dialog').filter({ has: p.getByText('标记为已签约？', { exact: true }) });
      await expect(confirmSign).toBeVisible();
      const signBtn = confirmSign.getByRole('button', { name: '确认', exact: true });
      await expect(signBtn).toHaveClass(/ui-button--primary/);
      await expect(signBtn).not.toHaveClass(/ui-button--danger/);

      const [signed] = await Promise.all([
        p.waitForResponse(r => /\/api\/plans\/[^/]+\/sign$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST'),
        signBtn.click(),
      ]);
      expect(signed.status()).toBe(200);

      await expect(editor.getByText(/方案已签约，不能再修改/)).toBeVisible();
    });

    await h.healthy();
  } finally {
    await h.close();
  }
});
