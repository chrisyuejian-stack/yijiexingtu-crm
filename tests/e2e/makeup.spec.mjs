import { test, expect } from '@playwright/test';
import { createHarness, pickDate } from './helpers.mjs';

test('SCN-002 请假确认、安排补课、补课点名与账务闭环', async ({ browser, request }, info) => {
  const h = await createHarness(browser, request, info, 'makeup', ['teacher', 'academic', 'student', 'finance']);
  const { manifest: m, actors } = h;
  try {
    await test.step('01 教师将原课登记为请假并提交，尚不产生账务变化', async () => {
      const p = await h.go('teacher');
      await p.getByRole('button').filter({ hasText: m.course }).first().click();
      await p.locator('.c3-checkin-row').getByRole('button', { name: '请假', exact: true }).click();
      await p.getByLabel('全班课堂内容与公共点评', { exact: true }).fill('学员请假，本次不扣课，待安排补课');
      await p.getByRole('button', { name: '提交出勤与点评', exact: true }).click();
      await expect(p.getByText('待教务确认', { exact: true }).first()).toBeVisible();
      const s = await h.state();
      expect(s.balances).toEqual([10, 8]); expect(s.accrued).toBe(0);
      expect(s.transactions).toHaveLength(0); expect(s.makeupLinks).toHaveLength(0);
      await h.shot('teacher', '请假待确认');
    });
    await test.step('02 教务确认请假，原课不扣课不计酬，学员看到请假', async () => {
      const p = await h.openReview(); await h.confirm(p);
      const s = await h.state();
      expect(s.participants).toHaveLength(1);
      expect(s.participants[0]).toMatchObject({ attendance: 'student_leave', deducted: 0 });
      expect(s.balances).toEqual([10, 8]); expect(s.accrued).toBe(0); expect(s.transactions).toHaveLength(0);
      await h.shot('academic', '请假确认');
      const student = await h.go('student');
      await student.getByRole('button', { name: '上课记录', exact: true }).click();
      await expect(student.getByText('请假', { exact: true }).first()).toBeVisible();
      await h.shot('student', '请假记录');
    });
    await test.step('03 从待办安排明日补课，保存前检查无冲突', async () => {
      const p = await h.go('academic');
      await h.nav('academic', /^待办/, 'todo-unchecked');
      await p.getByRole('button', { name: /^请假待补课/ }).click();
      await expect(p.getByRole('button', { name: '安排补课', exact: true })).toBeVisible();
      await p.getByRole('button', { name: '安排补课', exact: true }).click();
      const drawer = p.getByRole('dialog').filter({ has: p.getByRole('heading', { name: /安排补课/ }) });
      await pickDate(drawer, '日期', '2026-11-13');
      await drawer.getByLabel('开始时间', { exact: true }).fill('18:00');
      await drawer.getByLabel('开始时间', { exact: true }).press('Tab');
      await expect(drawer.getByText('没有冲突', { exact: true })).toBeVisible();
      await expect(drawer.locator('.v-mkp-sum')).toContainText('18:00–18:45');
      await h.shot('academic', '补课保存前');
      const [r] = await Promise.all([
        p.waitForResponse(r => new URL(r.url()).pathname.endsWith('/api/credits/makeups') && r.request().method() === 'POST'),
        drawer.getByRole('button', { name: '保存补课', exact: true }).click(),
      ]);
      expect(r.status()).toBe(200); expect((await r.json()).committed).toBe(true);
      await expect(drawer).toHaveCount(0);
    });
    await test.step('04 补课关联唯一、原待办移除，学员课表可见且暂不扣课', async () => {
      const s = await h.state();
      expect(s.lessons).toHaveLength(2); expect(s.makeupLinks).toHaveLength(1);
      const link = s.makeupLinks[0];
      const original = s.allParticipants.find(x => x.lesson_id === m.lesson);
      const target = s.allParticipants.find(x => x.id === link.target_participant_id);
      expect(link.original_participant_id).toBe(original.id);
      expect(target).toMatchObject({ student_id: m.studentIds[0], makeup_for: original.id, attendance: 'planned', deducted: 0 });
      expect(s.lessons.find(x => x.id === link.target_lesson_id).start_at).toContain('2026-11-13T18:00');
      expect(s.balances).toEqual([10, 8]); expect(s.accrued).toBe(0); expect(s.transactions).toHaveLength(0);
      const p = actors.academic.page;
      await p.reload();
      await expect(p.locator('.v-content')).toHaveAttribute('aria-busy', 'false');
      await expect(p.getByRole('button', { name: '安排补课', exact: true })).toHaveCount(0);
      await h.shot('academic', '补课已安排');
      const student = await h.go('student');
      await expect(student.getByRole('button').filter({ hasText: m.course }).filter({ hasText: '18:00' })).toBeVisible();
      await h.shot('student', '明日补课课表');
    });
    await test.step('05 推进到补课结束后，教师提交到课，待确认仍不扣课', async () => {
      await h.advance('2026-11-13T20:00:00+08:00');
      const p = await h.go('teacher');
      await p.getByRole('button').filter({ hasText: m.course }).first().click();
      await p.getByRole('button', { name: '全部出勤', exact: true }).click();
      await p.getByLabel('全班课堂内容与公共点评', { exact: true }).fill('补课已完成：节奏与指法训练');
      await p.getByRole('button', { name: '提交出勤与点评', exact: true }).click();
      await expect(p.getByText('待教务确认', { exact: true }).first()).toBeVisible();
      const s = await h.state(); expect(s.balances).toEqual([10, 8]); expect(s.accrued).toBe(0);
      await h.shot('teacher', '补课待确认');
    });
    await test.step('06 教务确认补课，仅补课扣1课时计120元，原请假保持不变', async () => {
      const p = await h.openReview(); await h.confirm(p);
      const s = await h.state();
      expect(s.balances).toEqual([9, 8]); expect(s.accrued).toBe(120);
      expect(s.transactions).toHaveLength(1); expect(s.transactions[0].delta).toBe(-1);
      expect(s.participants[0]).toMatchObject({ attendance: 'student_leave', deducted: 0 });
      expect(s.allParticipants.find(x => x.id === s.makeupLinks[0].target_participant_id)).toMatchObject({ attendance: 'attended', deducted: 1 });
      await h.shot('academic', '补课确认生效');
      const student = await h.go('student');
      await student.getByRole('button', { name: '课时缴费', exact: true }).click();
      await expect(student.locator('.v-m-pkg-num strong')).toHaveText('9');
      await h.shot('student', '补课后余额');
      const finance = await h.go('finance');
      await expect(finance.getByText('¥120', { exact: true }).first()).toBeVisible();
      await h.shot('finance', '补课后课酬');
    });
    await test.step('07 刷新后关联与账务稳定，浏览器及查询预算检查', async () => {
      const before = await h.state();
      await h.go('academic'); await h.go('student');
      const after = await h.state();
      expect(after.balances).toEqual(before.balances); expect(after.transactions).toEqual(before.transactions);
      expect(after.makeupLinks).toEqual(before.makeupLinks); await h.healthy();
    });
  } finally { await h.close(); }
});
