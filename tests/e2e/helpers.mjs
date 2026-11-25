import { expect } from '@playwright/test';

export const controller = () => ({ 'x-e2e-key': process.env.E2E_CONTROL_KEY });

export async function createHarness(browser, request, info, kind, roles, { bootstrapSession = true } = {}) {
  const reset = await request.post(`/__e2e/reset?kind=${kind}`, { headers: controller() });
  expect(reset.ok()).toBeTruthy();
  const manifest = await reset.json();
  const actors = {}, errors = [], failedRequests = [], expectedRejections = [];
  let sequence = 0;
  const state = async () => {
    const response = await request.get('/__e2e/state', { headers: controller() });
    expect(response.ok()).toBeTruthy(); return response.json();
  };
  const shot = async (role, title) => {
    const path = info.outputPath(`${String(++sequence).padStart(2, '0')}-${role}-${title}.png`);
    await actors[role].page.screenshot({ path, fullPage: true });
    await info.attach(`${role} · ${title}`, { path, contentType: 'image/png' });
  };
  const close = async () => {
    await info.attach('浏览器异常', { body: JSON.stringify({ errors, failedRequests, expectedRejections }, null, 2), contentType: 'application/json' });
    for (const [role, { page, context }] of Object.entries(actors)) {
      if (info.status !== info.expectedStatus) await shot(role, '失败现场').catch(() => {});
      const path = info.outputPath(`${role}-trace.zip`);
      await context.tracing.stop({ path });
      await info.attach(`${role} 操作轨迹`, { path, contentType: 'application/zip' });
      const video = page.video();
      await context.close();
      if (video) await info.attach(`${role} 录像`, { path: await video.path(), contentType: 'video/webm' });
    }
  };
  try {
    for (const role of roles) {
      const context = await browser.newContext({ baseURL: info.project.use.baseURL,
        viewport: info.project.use.viewport, isMobile: info.project.use.isMobile,
        hasTouch: info.project.use.hasTouch, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
        recordVideo: { dir: info.outputPath('videos'), size: { width: 800, height: 600 } } });
      if (bootstrapSession) {
        const session = await context.request.post(`/__e2e/session?role=${role}`, { headers: controller() });
        expect(session.ok()).toBeTruthy();
      }
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const page = await context.newPage();
      await page.clock.install({ time: new Date(manifest.now) });
      page.on('pageerror', e => errors.push({ role, message: e.message }));
      page.on('response', r => {
        if (r.url().includes('/api/') && r.status() >= 400)
          failedRequests.push({ role, path: new URL(r.url()).pathname, status: r.status() });
      });
      actors[role] = { context, page };
    }
  } catch (error) { await close(); throw error; }
  const go = async role => {
    const p = actors[role].page;
    await p.goto(`/${manifest.slug}/app/`);
    await expect(p.locator('.personal-content,.v-content').first()).toHaveAttribute('aria-busy', 'false');
    return p;
  };
  const nav = async (role, name, route) => {
    const p = actors[role].page;
    await p.getByRole('button', { name }).first().click();
    await expect(p.locator('.v-content')).toHaveAttribute('data-route', route);
    await expect(p.locator('.v-content')).toHaveAttribute('aria-busy', 'false');
    return p;
  };
  const queue = async () => {
    const p = await go('academic');
    await nav('academic', /^待办/, 'todo-unchecked');
    await p.getByRole('button', { name: /老师已提交|教师提交/ }).first().click();
    await expect(p.getByText('提交状态', { exact: true })).toBeVisible();
    return p;
  };
  const openReview = async () => {
    const p = await queue();
    await p.getByRole('row').filter({ hasText: manifest.course }).getByRole('cell').nth(1).click();
    await expect(p.getByRole('button', { name: '确认并生效', exact: true })).toBeVisible();
    return p;
  };
  const confirm = async p => {
    await p.getByRole('button', { name: '确认并生效', exact: true }).click();
    const [r] = await Promise.all([
      p.waitForResponse(r => /\/api\/submissions\/[^/]+\/confirm$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST'),
      p.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click(),
    ]);
    expect(r.status()).toBe(200);
    await expect(p.getByText('已确认 · 出勤与点评', { exact: true })).toBeVisible();
  };
  const advance = async at => {
    const response = await request.post(`/__e2e/clock?at=${encodeURIComponent(at)}`, { headers: controller() });
    expect(response.ok()).toBeTruthy();
    manifest.now = (await response.json()).now;
    for (const [role, { context, page }] of Object.entries(actors)) {
      const session = await context.request.post(`/__e2e/session?role=${role}`, { headers: controller() });
      expect(session.ok()).toBeTruthy();
      await page.clock.setSystemTime(new Date(manifest.now));
    }
  };
  const healthy = async () => {
    expect(errors).toEqual([]); expect(failedRequests).toEqual([]);
    for (const { page } of Object.values(actors)) {
      if (page.url() === 'about:blank') continue;
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    }
    const s = await state(); expect(s.maxQueries).toBeLessThanOrEqual(40);
    await info.attach('业务结果核对', { body: JSON.stringify(s, null, 2), contentType: 'application/json' });
  };
  const acceptRejection = async (role, response, { statuses, message, why }) => {
    expect(statuses).toContain(response.status());
    const body = await response.json();
    expect(body.error).toMatch(message);
    const path = new URL(response.url()).pathname;
    const index = failedRequests.findIndex(r => r.role === role && r.path === path && r.status === response.status());
    expect(index, '必须先记录这次实际失败响应，再核对为预期业务拒绝').toBeGreaterThanOrEqual(0);
    expectedRejections.push({ ...failedRequests[index], error: body.error, why });
    failedRequests.splice(index, 1);
    return body;
  };
  return { manifest, actors, state, shot, close, go, nav, queue, openReview, confirm, advance, healthy, acceptRejection };
}

export async function pickDate(scope, label, date) {
  await scope.getByRole('button', { name: label, exact: true }).click();
  await scope.getByRole('gridcell', { name: date, exact: true }).click();
}

export async function choose(scope, label, option) {
  // Required-field markers are included in the browser's accessible name.
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await scope.getByRole('button', { name: new RegExp(`^${escaped}\\s*\\*?$`) }).click();
  await scope.getByRole('option', { name: option, exact: true }).click();
}
