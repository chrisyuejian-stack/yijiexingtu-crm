import { test, expect } from '@playwright/test';
import { createHarness, pickDate } from './helpers.mjs';

test('SCN-013 日期可键盘输入与上/下月翻页、Esc 不关抽屉、中文校验提示与方案日期统一', async ({ browser, request }, info) => {
  const h = await createHarness(browser, request, info, 'attendance', ['supervisor']);
  const m = h.manifest;
  const p = await h.go('supervisor');

  try {
    await test.step('01 新建课程抽屉：日期可键盘输入，日历可上下月翻页，Esc 只关日历不关抽屉', async () => {
      await p.getByRole('button', { name: '＋ 排课', exact: true }).click();
      const drawer = p.getByRole('dialog').filter({ has: p.getByRole('heading', { name: '新建课程', exact: true }) });
      await expect(drawer).toBeVisible();

      const dateInput = drawer.getByRole('textbox', { name: '北京时间日期 输入', exact: true });
      await expect(dateInput).toBeVisible();
      await dateInput.fill('20261120');
      await dateInput.press('Enter');
      await expect(dateInput).toHaveValue('2026-11-20');

      await drawer.getByRole('button', { name: '北京时间日期', exact: true }).click();
      const calendar = drawer.getByRole('dialog', { name: '选择日期', exact: true });
      await expect(calendar).toBeVisible();
      await expect(calendar).toContainText('2026年11月');

      await calendar.getByRole('button', { name: '下个月', exact: true }).click();
      await expect(calendar).toBeVisible();
      await expect(calendar).toContainText('2026年12月');

      await calendar.getByRole('button', { name: '上个月', exact: true }).click();
      await expect(calendar).toBeVisible();
      await expect(calendar).toContainText('2026年11月');

      await p.keyboard.press('Escape');
      await expect(calendar).toBeHidden();
      await expect(drawer).toBeVisible();

      await pickDate(drawer, '北京时间日期', '2026-11-12');
      await expect(dateInput).toHaveValue('2026-11-12');

      await p.keyboard.press('Escape');
      const confirmDiscard = p.getByRole('dialog').filter({ has: p.getByText('放弃未保存的修改？', { exact: true }) });
      if (await confirmDiscard.isVisible().catch(() => false)) {
        await confirmDiscard.getByRole('button', { name: '放弃修改', exact: true }).click();
      }
      await expect(drawer).toBeHidden();
    });

    await test.step('02 课程方案：新建抽屉空提交显示中文校验且底框不被粘性页脚遮挡，编辑器方案日期用 UI.dateControl', async () => {
      await p.goto(`/${m.slug}/app#inst-subjects`);
      await expect(p.locator('.v-content')).toHaveAttribute('aria-busy', 'false');
      await Promise.all([
        p.waitForResponse(r => new URL(r.url()).pathname.endsWith('/api/settings/subjects') && r.request().method() === 'POST'),
        p.getByRole('button', { name: '导入模板', exact: true }).first().click(),
      ]);

      await p.goto(`/${m.slug}/app#yx-plans`);
      await expect(p.locator('.v-content')).toHaveAttribute('aria-busy', 'false');
      await p.getByRole('button', { name: '＋ 新建方案', exact: true }).click();

      const newDrawer = p.getByRole('dialog').filter({ has: p.getByRole('heading', { name: '新建课程方案', exact: true }) });
      await expect(newDrawer).toBeVisible();
      await newDrawer.getByRole('button', { name: '建好并打开', exact: true }).click();
      await expect(newDrawer.locator('.form-error', { hasText: '请填写学员姓名' })).toBeVisible();

      await newDrawer.getByRole('radio', { name: '已有学员', exact: true }).click();
      const [created] = await Promise.all([
        p.waitForResponse(r => new URL(r.url()).pathname.endsWith('/api/plans') && r.request().method() === 'POST'),
        newDrawer.getByRole('button', { name: '建好并打开', exact: true }).click(),
      ]);
      expect(created.status()).toBe(201);

      const editor = p.getByRole('dialog', { name: '课程方案', exact: true });
      await expect(editor).toBeVisible();
      await expect(editor.locator('.yxv-seg-top')).toBeVisible();
      const planDateInput = editor.getByRole('textbox', { name: '方案日期 输入', exact: true });
      await expect(planDateInput).toBeVisible();
      await planDateInput.fill('20261118');
      await planDateInput.press('Enter');
      await expect(planDateInput).toHaveValue('2026-11-18');
    });

    await h.healthy();
  } finally {
    await h.close();
  }
});
