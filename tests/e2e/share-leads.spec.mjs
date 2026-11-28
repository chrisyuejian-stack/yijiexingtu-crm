import { test, expect } from '@playwright/test';
import { createHarness } from './helpers.mjs';

test('SCN-014 线索看板阶段按钮移动与方案/分享页无图无logo封面展示（G-15）', async ({ browser, request }, info) => {
  const h = await createHarness(browser, request, info, 'attendance', ['supervisor']);
  const m = h.manifest;
  const p = await h.go('supervisor');

  try {
    await test.step('01 线索看板：相邻阶段切换按钮无需拖拽即可在桌面与手机端流转', async () => {
      await p.goto(`/${m.slug}/app#enrol-leads`);
      await expect(p.locator('.v-content')).toHaveAttribute('aria-busy', 'false');

      await p.getByRole('button', { name: '＋ 登记线索', exact: true }).click();
      const drawer = p.getByRole('dialog');
      await drawer.getByRole('textbox', { name: /姓名/ }).fill('测试阶段线索');
      await drawer.getByRole('textbox', { name: /^家长手机/ }).fill('13800008899');
      const [created] = await Promise.all([
        p.waitForResponse(r => new URL(r.url()).pathname.endsWith('/api/tools/leads') && r.request().method() === 'POST'),
        drawer.getByRole('button', { name: '保存线索', exact: true }).click(),
      ]);
      expect(created.status()).toBe(200);

      const newCol = p.locator('.v-stage-new');
      const card = newCol.locator('.v-lead-card', { hasText: '测试阶段线索' });
      await expect(card).toBeVisible();
      const toContacted = card.getByRole('button', { name: '移至跟进中', exact: true });
      await expect(toContacted).toBeVisible();

      const [moved] = await Promise.all([
        p.waitForResponse(r => /\/api\/tools\/leads\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === 'PATCH'),
        toContacted.click(),
      ]);
      expect(moved.status()).toBe(200);
      await expect(p.getByRole('dialog')).toHaveCount(0);

      const contactedCard = p.locator('.v-stage-contacted .v-lead-card', { hasText: '测试阶段线索' });
      await expect(contactedCard).toBeVisible();
      await expect(contactedCard.getByRole('button', { name: '移至新咨询', exact: true })).toBeVisible();
      await expect(contactedCard.getByRole('button', { name: '移至已试听', exact: true })).toBeVisible();

      await p.setViewportSize({ width: 390, height: 844 });
      const backNew = contactedCard.getByRole('button', { name: '移至新咨询', exact: true });
      await backNew.scrollIntoViewIfNeeded();
      const [movedBack] = await Promise.all([
        p.waitForResponse(r => /\/api\/tools\/leads\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === 'PATCH'),
        backNew.click(),
      ]);
      expect(movedBack.status()).toBe(200);
      await expect(p.locator('.v-stage-new .v-lead-card', { hasText: '测试阶段线索' })).toBeVisible();
    });

    await p.setViewportSize({ width: 1440, height: 900 });

    let sharePath = '';
    await test.step('02 方案编辑器与预览：无 Logo 用首字徽章、无阶段隐藏 0 个月', async () => {
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

      const editor = p.getByRole('dialog', { name: '课程方案', exact: true });
      await expect(editor).toBeVisible();
      const cover = editor.locator('.yxd-cover');
      await expect(cover).toHaveClass(/is-nophoto/);
      await expect(cover.locator('.yxd-logo.is-monogram .yxd-logo-mark')).toBeVisible();
      const borderStyle = await cover.locator('.yxd-logo').evaluate(el => getComputedStyle(el).borderTopStyle);
      expect(borderStyle).toBe('none');
      await expect(cover).not.toContainText('0 个月');

      await editor.getByRole('button', { name: '发送给家长', exact: true }).click();
      const confirmSend = p.getByRole('dialog').filter({ has: p.getByText('发送给家长？', { exact: true }) });
      const [sentRes] = await Promise.all([
        p.waitForResponse(r => /\/api\/plans\/[^/]+\/send$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST'),
        confirmSend.getByRole('button', { name: '确认', exact: true }).click(),
      ]);
      expect(sentRes.status()).toBe(200);

      await editor.getByRole('button', { name: '更多', exact: true }).click();
      await p.getByRole('button', { name: '分享链接', exact: true }).click();
      const shareDialog = p.getByRole('dialog', { name: '分享链接', exact: true });
      await expect(shareDialog).toBeVisible();
      const [linkRes] = await Promise.all([
        p.waitForResponse(r => /\/api\/plans\/[^/]+\/share-links$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST'),
        shareDialog.getByRole('button', { name: '生成新链接', exact: true }).click(),
      ]);
      expect(linkRes.status()).toBe(201);
      const linkBody = await linkRes.json();
      sharePath = new URL(linkBody.url).pathname;
    });

    await test.step('03 分享页（手机端 390×844）：无虚线框、隐藏 0 个月且无图封面紧凑', async () => {
      const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      try {
        const gp = await guestCtx.newPage();
        await gp.goto(sharePath);
        const cover = gp.locator('.yxd-cover');
        await expect(cover).toBeVisible();
        await expect(cover).toHaveClass(/is-nophoto/);
        await expect(cover.locator('.yxd-logo.is-monogram .yxd-logo-mark')).toBeVisible();
        await expect(cover).not.toContainText('0 个月');
        const box = await cover.boundingBox();
        expect(box.height).toBeLessThan(650);
      } finally {
        await guestCtx.close();
      }
    });

    await h.healthy();
  } finally {
    await h.close();
  }
});
