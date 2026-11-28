import { test, expect } from '@playwright/test';
import { createHarness } from './helpers.mjs';

test('SCN-012 手机端布局适配：方案预览/AI 切页、分页高亮滚动、底栏安全区、去重入口与 AI 额度条', async ({ browser, request }, info) => {
  const h = await createHarness(browser, request, info, 'attendance', ['supervisor']);
  const m = h.manifest;
  const p = await h.go('supervisor');
  const mobile = info.project.name === 'mobile';

  try {
    await test.step('01 导入默认学科模板以便检查成长维度与课程方案编辑器', async () => {
      await p.goto(`/${m.slug}/app#inst-subjects`);
      await expect(p.locator('.v-content')).toHaveAttribute('aria-busy', 'false');
      await Promise.all([
        p.waitForResponse(r => new URL(r.url()).pathname.endsWith('/api/settings/subjects') && r.request().method() === 'POST'),
        p.getByRole('button', { name: '导入模板', exact: true }).first().click(),
      ]);
    });

    await test.step('02 G-05 课程方案编辑器：手机端顶部可切 预览 / AI 助手，桌面端保留三栏并排', async () => {
      await p.goto(`/${m.slug}/app#yx-plans`);
      await expect(p.locator('.v-content')).toHaveAttribute('aria-busy', 'false');
      await p.getByRole('button', { name: '＋ 新建方案', exact: true }).click();
      await p.getByRole('radio', { name: '已有学员', exact: true }).click();
      const [created] = await Promise.all([
        p.waitForResponse(r => new URL(r.url()).pathname.endsWith('/api/plans') && r.request().method() === 'POST'),
        p.getByRole('button', { name: '建好并打开', exact: true }).click(),
      ]);
      expect(created.status()).toBe(201);

      const editor = p.getByRole('dialog', { name: '课程方案', exact: true });
      await expect(editor).toBeVisible();
      await expect(editor.locator('.yxv-seg-top')).toBeVisible();
      const previewTab = editor.getByRole('tab', { name: '预览', exact: true });
      const aiTab = editor.getByRole('tab', { name: 'AI 助手', exact: true });

      if (mobile) {
        await expect(previewTab).toBeVisible();
        await expect(aiTab).toBeVisible();
        await expect(editor.locator('.yxv-mid')).toBeHidden();
        await expect(editor.locator('.yxv-ai')).toBeHidden();

        await previewTab.click();
        await expect(editor.locator('.yxv-mid')).toBeVisible();
        await expect(editor.locator('.yxv-ai')).toBeHidden();

        await aiTab.click();
        await expect(editor.locator('.yxv-ai')).toBeVisible();
        await expect(editor.locator('.yxv-mid')).toBeHidden();

        await editor.getByRole('tab', { name: '内容', exact: true }).click();
        await expect(editor.locator('.yxv-mid')).toBeHidden();
        await expect(editor.locator('.yxv-ai')).toBeHidden();
        await editor.getByRole('button', { name: '‹ 返回', exact: true }).click();
      } else {
        await expect(previewTab).toBeHidden();
        await expect(aiTab).toBeHidden();
        await expect(editor.locator('.yxv-left')).toBeVisible();
        await expect(editor.locator('.yxv-mid')).toBeVisible();
        await expect(editor.locator('.yxv-ai')).toBeVisible();
        await editor.locator('.yxv-crumb').first().click();
      }
      await expect(editor).toBeHidden();
    });

    await test.step('03 G-11 顶栏分页切换到成长报告时当前项滚入视野，今天页筛选条不裁切', async () => {
      await p.goto(`/${m.slug}/app#yx-reports`);
      await expect(p.locator('.v-content')).toHaveAttribute('data-route', 'yx-reports');
      await expect(p.locator('.v-content')).toHaveAttribute('aria-busy', 'false');

      const tabsBox = await p.locator('.v-head-tabs').boundingBox();
      const activeTabBox = await p.locator('.v-head-tabs > .ui-button[aria-current="page"]').boundingBox();
      expect(tabsBox).toBeTruthy();
      expect(activeTabBox).toBeTruthy();
      expect(activeTabBox.x).toBeGreaterThanOrEqual(tabsBox.x - 1);
      expect(activeTabBox.x + activeTabBox.width).toBeLessThanOrEqual(tabsBox.x + tabsBox.width + 1);

      await p.goto(`/${m.slug}/app#today`);
      await expect(p.locator('.v-content')).toHaveAttribute('data-route', 'today');
      await expect(p.locator('.v-content')).toHaveAttribute('aria-busy', 'false');
      if (mobile) {
        const vw = info.project.use.viewport.width;
        const boxes = await p.locator('.v-td-types .v-filter-chip').evaluateAll(els =>
          els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, right: r.right }; }),
        );
        for (const b of boxes) {
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.right).toBeLessThanOrEqual(vw + 1);
        }
      }
    });

    await test.step('04 G-12 底部新增班型按钮不被底栏遮挡，周课表手机端不重复出现 + 入口', async () => {
      await p.goto(`/${m.slug}/app#inst-dims`);
      await expect(p.locator('.v-content')).toHaveAttribute('data-route', 'inst-dims');
      await expect(p.locator('.v-content')).toHaveAttribute('aria-busy', 'false');

      const addClassBtn = p.getByRole('button', { name: '＋ 新增班型', exact: true });
      await expect(addClassBtn).toBeVisible();
      await addClassBtn.scrollIntoViewIfNeeded();
      if (mobile) {
        const btnBox = await addClassBtn.boundingBox();
        const tabbarBox = await p.locator('.v-tabbar').boundingBox();
        expect(btnBox).toBeTruthy();
        expect(tabbarBox).toBeTruthy();
        expect(btnBox.y + btnBox.height).toBeLessThanOrEqual(tabbarBox.y + 1);
      }

      await p.goto(`/${m.slug}/app#schedule-week`);
      await expect(p.locator('.v-content')).toHaveAttribute('data-route', 'schedule-week');
      await expect(p.locator('.v-content')).toHaveAttribute('aria-busy', 'false');
      if (mobile) {
        await expect(p.locator('.v-fab')).toBeVisible();
        await expect(p.locator('.v-head .v-create')).toBeHidden();
      } else {
        await expect(p.locator('.v-head .v-create')).toBeVisible();
      }
    });

    await test.step('05 G-14 招生内容使用中文眉题，今日 AI 额度条在手机端不竖排单字折行', async () => {
      await p.goto(`/${m.slug}/app#yx-content`);
      await expect(p.locator('.v-content')).toHaveAttribute('data-route', 'yx-content');
      await expect(p.locator('.v-content')).toHaveAttribute('aria-busy', 'false');

      await expect(p.getByText('Enrolment Studio')).toHaveCount(0);
      await expect(p.getByText('招生内容工坊', { exact: true })).toBeVisible();
      const usage = p.locator('.yxv-usage');
      await expect(usage).toBeVisible();
      const labelBox = await usage.locator('.yxv-usage-label').boundingBox();
      expect(labelBox).toBeTruthy();
      expect(labelBox.height).toBeLessThanOrEqual(32);
    });

    await h.healthy();
  } finally {
    await h.close();
  }
});
