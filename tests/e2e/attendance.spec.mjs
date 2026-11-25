import { test, expect } from '@playwright/test';

const controlHeaders = () => ({ 'x-e2e-key': process.env.E2E_CONTROL_KEY });
const FIRST = '初稿：节奏练习，待教务核对';
const FINAL = '修订稿：完成钢琴节奏训练';
const OWN = '小枫个人点评：节奏稳定';
const PEER = '小琴个人点评：注意指法';
const REASON = '请补充两名学员的个人点评后重新提交';

test('SCN-001 点名退回、修改重提、确认与学员可见性', async ({ browser, request }, testInfo) => {
  const reset = await request.post('/__e2e/reset', { headers: controlHeaders() });
  expect(reset.ok()).toBeTruthy();
  const manifest = await reset.json();
  const state = async () => {
    const response = await request.get('/__e2e/state', { headers: controlHeaders() });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const actors = {};
  const errors = [];
  const failedRequests = [];
  let confirmedCardText = '';
  let shotSequence = 0;
  const shot = async (role, title) => {
    const target = testInfo.outputPath(`${String(++shotSequence).padStart(2, '0')}-${role}-${title}.png`);
    await actors[role].page.screenshot({ path: target, fullPage: true });
    await testInfo.attach(`${role} · ${title}`, { path: target, contentType: 'image/png' });
  };
  const reload = async role => {
    const p = actors[role].page;
    await p.goto(`/${manifest.slug}/app/`);
    await expect(p.locator('.personal-content,.v-content').first()).toHaveAttribute('aria-busy', 'false');
  };
  const teacherLesson = async () => {
    const p = actors.teacher.page;
    await reload('teacher');
    await p.getByRole('button').filter({ hasText: manifest.course }).first().click();
    await expect(p.getByRole('heading', { name: '课程详情', exact: true })).toBeVisible();
    return p;
  };
  const queue = async () => {
    const p = actors.academic.page;
    await reload('academic');
    await p.getByRole('button', { name: /待办/ }).first().click();
    await expect(p.locator('.v-content')).toHaveAttribute('data-route', 'todo-unchecked');
    await expect(p.locator('.v-content')).toHaveAttribute('aria-busy', 'false');
    await p.getByRole('button', { name: /老师已提交|教师提交/ }).first().click();
    await expect(p.getByText('提交状态', { exact: true })).toBeVisible();
    await expect(p.getByRole('row').filter({ hasText: manifest.course })).toBeVisible();
    return p;
  };
  const checkUnconfirmed = async () => {
    const s = await state();
    expect(s.balances).toEqual([10, 8]);
    expect(s.transactions).toHaveLength(0);
    expect(s.accrued).toBe(0);
    expect(s.published).toHaveLength(0);
    expect(s.lesson.status).toBe('planned');
    expect(s.participants.every(p => p.attendance === 'planned' && p.deducted === 0)).toBeTruthy();
    expect(s.maxQueries).toBeLessThanOrEqual(40);
  };
  try {
    for (const role of ['teacher', 'academic', 'student', 'student2', 'finance']) {
      const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL,
        viewport: testInfo.project.use.viewport, isMobile: testInfo.project.use.isMobile,
        hasTouch: testInfo.project.use.hasTouch, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
        recordVideo: { dir: testInfo.outputPath('videos'), size: { width: 800, height: 600 } } });
      // Bootstrap fake local sessions before tracing; normal app requests enforce permissions.
      const session = await context.request.post(`/__e2e/session?role=${role}`, { headers: controlHeaders() });
      expect(session.ok()).toBeTruthy();
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const page = await context.newPage();
      await page.clock.install({ time: new Date(manifest.now) });
      page.on('pageerror', error => errors.push({ role, message: error.message }));
      page.on('response', response => {
        if (response.url().includes('/api/') && response.status() >= 400)
          failedRequests.push({ role, path: new URL(response.url()).pathname, status: response.status() });
      });
      actors[role] = { context, page };
    }
    await test.step('01 初始余额、课酬和本地测试控制隔离', async () => {
      expect((await request.get('/__e2e/state')).status()).toBe(403);
      await checkUnconfirmed();
    });
    await test.step('02 教师从课表找到课程，填写初稿并提交点名', async () => {
      const p = await teacherLesson();
      await p.getByRole('button', { name: '全部出勤', exact: true }).click();
      await p.getByLabel('全班课堂内容与公共点评', { exact: true }).fill(FIRST);
      await p.getByLabel('全班作业', { exact: true }).fill('每天练习十五分钟');
      await shot('teacher', '提交前');
      await p.getByRole('button', { name: '提交出勤与点评', exact: true }).click();
      await expect(p.getByText('待教务确认', { exact: true }).first()).toBeVisible();
      await shot('teacher', '待教务确认');
    });
    await test.step('03 待确认不扣课、不计酬，学员看不到未确认点评', async () => {
      await checkUnconfirmed();
      expect((await state()).submissions.some(x => x.status === 'pending')).toBeTruthy();
      await reload('student');
      await actors.student.page.getByRole('button', { name: '上课记录', exact: true }).click();
      await expect(actors.student.page.getByText(FIRST, { exact: true })).toHaveCount(0);
      await shot('student', '初稿尚未公开');
    });
    await test.step('04 教务从待办进入，填写原因并退回', async () => {
      const p = await queue();
      await p.getByRole('row').filter({ hasText: manifest.course }).click();
      await p.getByRole('button', { name: '退回', exact: true }).click();
      await p.getByRole('textbox', { name: '请填写退回原因', exact: true }).fill(REASON);
      await p.getByRole('button', { name: '确认退回', exact: true }).click();
      await expect(p.getByText(REASON, { exact: true })).toBeVisible();
      await shot('academic', '已退回');
      await checkUnconfirmed();
    });
    await test.step('05 教师重新进入查看退回原因，保留初稿并修改重提', async () => {
      const p = await teacherLesson();
      await expect(p.getByText(REASON, { exact: true })).toBeVisible();
      await expect(p.getByLabel('全班课堂内容与公共点评', { exact: true })).toHaveValue(FIRST);
      await p.getByLabel('全班课堂内容与公共点评', { exact: true }).fill(FINAL);
      const rows = p.locator('.c3-checkin-row');
      for (const [name, comment] of [[manifest.students[0], OWN], [manifest.students[1], PEER]]) {
        const row = rows.filter({ hasText: name });
        await row.getByRole('button', { name: '逐人点评（选填）', exact: true }).click();
        await row.getByLabel(`${name} · 逐人点评`, { exact: true }).fill(comment);
      }
      await shot('teacher', '修订后重提');
      await p.getByRole('button', { name: '提交出勤与点评', exact: true }).click();
      await expect(p.getByText('待教务确认', { exact: true }).first()).toBeVisible();
      await checkUnconfirmed();
    });
    await test.step('06 教务核对修订内容并确认，课时与课酬恰好生效一次', async () => {
      const p = await queue();
      await p.getByRole('row').filter({ hasText: manifest.course }).click();
      await expect(p.getByText(FINAL, { exact: true })).toBeVisible();
      await p.getByRole('button', { name: '确认并生效', exact: true }).click();
      const [response] = await Promise.all([
        p.waitForResponse(r => /\/api\/submissions\/[^/]+\/confirm$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST'),
        p.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click(),
      ]);
      expect(response.status()).toBe(200);
      await expect(p.getByText('已确认 · 出勤与点评', { exact: true })).toBeVisible();
      confirmedCardText = await p.locator('.ui-card').filter({ has: p.getByText('已确认 · 出勤与点评', { exact: true }) }).innerText();
      await expect(p.getByRole('button', { name: '确认并生效', exact: true })).toHaveCount(0);
      const s = await state();
      expect(s.balances).toEqual([9, 7]);
      expect(s.transactions).toHaveLength(2);
      expect(s.transactions.every(x => x.delta === -1)).toBeTruthy();
      expect(s.accrued).toBe(120);
      expect(s.lesson.status).toBe('completed');
      expect(s.participants.every(x => x.attendance === 'attended' && x.deducted === 1)).toBeTruthy();
      expect(s.submissions.filter(x => x.status === 'confirmed')).toHaveLength(1);
      expect(s.published).toHaveLength(3);
      await shot('academic', '确认生效');
    });
    await test.step('07 两位学员仅看到公共及本人点评，课时页面余额正确', async () => {
      for (const [role, own, other, balance] of [['student', OWN, PEER, '9'], ['student2', PEER, OWN, '7']]) {
        await reload(role);
        const p = actors[role].page;
        await p.getByRole('button', { name: '上课记录', exact: true }).click();
        await expect(p.getByText(FINAL, { exact: true })).toBeVisible();
        await expect(p.getByText(own, { exact: true })).toBeVisible();
        await expect(p.getByText(other, { exact: true })).toHaveCount(0);
        await expect(p.getByText(FIRST, { exact: true })).toHaveCount(0);
        await shot(role, '确认后点评');
        await p.getByRole('button', { name: '课时缴费', exact: true }).click();
        await expect(p.locator('.v-m-pkg-num strong')).toHaveText(balance);
        await shot(role, '确认后余额');
      }
    });
    await test.step('08 教师课酬显示120元，刷新及新会话结果保持一致', async () => {
      await reload('teacher');
      const p = actors.teacher.page;
      await p.getByRole('button', { name: '课酬', exact: true }).click();
      await expect(p.locator('.v-m-hero .v-m-big')).toHaveText('¥120');
      await shot('teacher', '确认后课酬');
      await reload('finance');
      await expect(actors.finance.page.getByText('¥120', { exact: true }).first()).toBeVisible();
      await shot('finance', '确认后待付课酬');
      const before = await state();
      await reload('academic');
      await reload('student');
      // A fresh browser context proves the result does not depend on the old page cache.
      const freshContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL,
        viewport: testInfo.project.use.viewport, isMobile: testInfo.project.use.isMobile,
        hasTouch: testInfo.project.use.hasTouch, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
        recordVideo: { dir: testInfo.outputPath('videos'), size: { width: 800, height: 600 } } });
      expect((await freshContext.request.post('/__e2e/session?role=student', { headers: controlHeaders() })).ok()).toBeTruthy();
      await freshContext.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const freshPage = await freshContext.newPage();
      await freshPage.clock.install({ time: new Date(manifest.now) });
      freshPage.on('pageerror', e => errors.push({ role: 'studentFresh', message: e.message }));
      actors.studentFresh = { context: freshContext, page: freshPage };
      await reload('studentFresh');
      await freshPage.getByRole('button', { name: '上课记录', exact: true }).click();
      await expect(freshPage.getByText(FINAL, { exact: true })).toBeVisible();
      await expect(freshPage.getByText(OWN, { exact: true })).toBeVisible();
      await expect(freshPage.getByText(PEER, { exact: true })).toHaveCount(0);
      await shot('studentFresh', '新浏览器会话结果');
      const after = await state();
      expect(after.balances).toEqual(before.balances);
      expect(after.transactions).toEqual(before.transactions);
      expect(after.accrued).toBe(120);
      expect(after.maxQueries).toBeLessThanOrEqual(40);
      await testInfo.attach('业务结果核对', { body: JSON.stringify(after, null, 2), contentType: 'application/json' });
    });
    await test.step('09 浏览器无脚本错误、失败API或整页横向溢出', async () => {
      expect(errors).toEqual([]);
      expect(failedRequests).toEqual([]);
      for (const { page } of Object.values(actors)) {
        if (page.url() === 'about:blank') continue;
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      }
    });
    await test.step('10 已确认记录的说明应与已扣课、已计酬的状态一致', async () => {
      await testInfo.attach('已确认卡片实际文案', { body: confirmedCardText, contentType: 'text/plain' });
      expect.soft(confirmedCardText, 'UI-001：已确认卡片仍提示待确认不扣课、不计酬').not.toContain('待确认不扣课、不计酬');
    });
  } finally {
    await testInfo.attach('浏览器异常', { body: JSON.stringify({ errors, failedRequests }, null, 2), contentType: 'application/json' });
    for (const [role, { context, page }] of Object.entries(actors)) {
      if (testInfo.status !== testInfo.expectedStatus) await shot(role, '失败现场').catch(() => {});
      const trace = testInfo.outputPath(`${role}-trace.zip`);
      await context.tracing.stop({ path: trace });
      await testInfo.attach(`${role} 操作轨迹`, { path: trace, contentType: 'application/zip' });
      const video = page.video();
      await context.close();
      if (video) await testInfo.attach(`${role} 录像`, { path: await video.path(), contentType: 'video/webm' });
    }
  }
});
