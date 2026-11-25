import { test, expect } from '@playwright/test';
import { createHarness, pickDate, choose } from './helpers.mjs';

test('SCN-003 排课冲突保留输入、调整时间保存与角色课表一致', async ({ browser, request }, info) => {
  const h = await createHarness(browser, request, info, 'scheduling', ['academic', 'teacher', 'student']);
  const { manifest: m, actors } = h;
  try {
    await test.step('01 教务新建课程，选择与已有课程冲突的时段和学员', async () => {
      const p = await h.go('academic');
      await p.getByRole('button', { name: '＋ 排课', exact: true }).click();
      const drawer = p.getByRole('dialog').filter({ has: p.getByRole('heading', { name: '新建课程', exact: true }) });
      await pickDate(drawer, '北京时间日期', '2026-11-12');
      await drawer.getByLabel('北京时间时间', { exact: true }).fill('19:00');
      await drawer.getByLabel('北京时间时间', { exact: true }).press('Tab');
      await choose(drawer, '教师', '测试主讲教师');
      await choose(drawer, '课程', m.course);
      await choose(drawer, '教室（线下课必填）', '验收琴房');
      await choose(drawer, '时长（分钟）', '45');
      await drawer.getByRole('button', { name: m.students[0], exact: true }).click();
      await drawer.getByLabel('备注', { exact: true }).fill('冲突调整验收，保存后保留此备注');
      await h.shot('academic', '冲突课程填写');
    });
    await test.step('02 冲突拒绝保存、不产生课程或账务，表单及学员选择保留', async () => {
      const p = actors.academic.page;
      const drawer = p.getByRole('dialog').filter({ has: p.getByRole('heading', { name: '新建课程', exact: true }) });
      const [r] = await Promise.all([
        p.waitForResponse(r => new URL(r.url()).pathname.endsWith('/api/data/lessons') && r.request().method() === 'POST'),
        drawer.getByRole('button', { name: '保存并检查冲突', exact: true }).click(),
      ]);
      expect(r.status()).toBe(200);
      const result = await r.json(); expect(result.committed).toBe(false);
      expect(result.conflicts.length).toBeGreaterThan(0);
      const alert = drawer.getByRole('alert').filter({ hasText: /^未保存：/ });
      await expect(alert).toBeVisible();
      await expect(alert).toContainText('教师');
      await expect(alert).toContainText('教室');
      await expect(alert).toContainText('学员');
      await alert.scrollIntoViewIfNeeded();
      await info.attach('冲突说明布局', { body: JSON.stringify(await alert.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return { rect: rect.toJSON(), hit: hit?.outerHTML.slice(0, 800), text: el.textContent };
      }), null, 2), contentType: 'application/json' });
      expect(await alert.evaluate(el => {
        const box = el.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return hit === el || el.contains(hit);
      }), '冲突说明必须在当前抽屉内且未被遮挡').toBeTruthy();
      await expect(drawer.getByLabel('备注', { exact: true })).toHaveValue('冲突调整验收，保存后保留此备注');
      await expect(drawer.getByRole('button', { name: `移除 ${m.students[0]}`, exact: true })).toBeVisible();
      const s = await h.state(); expect(s.lessons).toHaveLength(1);
      expect(s.balances).toEqual([10, 8]); expect(s.transactions).toHaveLength(0); expect(s.accrued).toBe(0);
      await h.shot('academic', '冲突未保存且内容保留');
    });
    await test.step('03 修改为空闲时间保存，不使用强制覆盖，只新增一节课程', async () => {
      const p = actors.academic.page;
      const drawer = p.getByRole('dialog').filter({ has: p.getByRole('heading', { name: '新建课程', exact: true }) });
      // Date-picker choices also invalidate the previous conflict/force state.
      await pickDate(drawer, '北京时间日期', '2026-11-12');
      await expect(drawer.locator('.v-conflict-error')).toBeHidden();
      await expect(drawer.locator('.v-force-row')).toBeHidden();
      await drawer.getByLabel('北京时间时间', { exact: true }).fill('20:15');
      await drawer.getByLabel('北京时间时间', { exact: true }).press('Tab');
      await expect(drawer.locator('.v-conflict-error')).toBeHidden();
      await expect(drawer.locator('.v-force-row')).toBeHidden();
      const [r] = await Promise.all([
        p.waitForResponse(r => new URL(r.url()).pathname.endsWith('/api/data/lessons') && r.request().method() === 'POST'),
        drawer.getByRole('button', { name: '保存并检查冲突', exact: true }).click(),
      ]);
      expect(r.status()).toBe(200); expect((await r.json()).committed).toBe(true);
      expect(r.request().postDataJSON().force).toBe(false);
      await expect(drawer).toHaveCount(0);
      const s = await h.state(); expect(s.lessons).toHaveLength(2);
      const added = s.lessons.find(x => x.id !== m.lesson);
      expect(added).toMatchObject({ duration: 45, units: 1, status: 'planned', teacher_id: m.teacher, location_id: m.room });
      expect(added.start_at).toContain('2026-11-12T20:15');
      const roster = s.allParticipants.filter(x => x.lesson_id === added.id);
      expect(roster).toHaveLength(1); expect(roster[0].student_id).toBe(m.studentIds[0]);
      expect(s.balances).toEqual([10, 8]); expect(s.accrued).toBe(0); expect(s.transactions).toHaveLength(0);
      await h.shot('academic', '调整后保存成功');
    });
    await test.step('04 教师与学员均能在课表查看新时间，详情正确且刷新不重复新增', async () => {
      for (const role of ['teacher', 'student']) {
        const p = await h.go(role);
        const card = p.getByRole('button').filter({ hasText: m.course }).filter({ hasText: '20:15' });
        await expect(card).toBeVisible(); await card.click();
        await expect(p.getByRole('heading', { name: '课程详情', exact: true })).toBeVisible();
        await expect(p.getByText(/20:15–21:00/).first()).toBeVisible();
        await h.shot(role, '调整后的课程详情');
      }
      await h.go('academic');
      const s = await h.state(); expect(s.lessons).toHaveLength(2); expect(s.balances).toEqual([10, 8]);
    });
    await test.step('05 无脚本错误、失败API及整页溢出，查询预算合格', async () => { await h.healthy(); });
  } finally { await h.close(); }
});
