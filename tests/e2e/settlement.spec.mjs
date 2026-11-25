import { test, expect } from '@playwright/test';
import { createHarness } from './helpers.mjs';
import { receipts, exposed } from './finance-helpers.mjs';

test('SCN-007 月结拦截、财务提交、主管锁月、旧页面拒绝与解锁重审', async ({ browser, request }, info) => {
  const h = await createHarness(browser, request, info, 'settlement', ['finance','supervisor','academic','teacher']);
  const m=h.manifest;
  const monthly=async role=>{
    const p=await receipts(h,role);
    await p.getByRole('button',{name:'月度结算',exact:true}).click();
    await expect(p.locator('.v-content')).toHaveAttribute('data-route','finance-pay');
    await expect(p.locator('.v-content')).toHaveAttribute('aria-busy','false');
    return p;
  };
  const action=async(p,label,kind)=>{
    await p.getByRole('button',{name:label,exact:true}).click();
    const [r]=await Promise.all([
      p.waitForResponse(r=>new URL(r.url()).pathname.endsWith(`/api/finance/settlements/${kind}`)),
      p.getByRole('dialog').getByRole('button',{name:'确认',exact:true}).click(),
    ]);
    return r;
  };
  const academicLesson=async()=>{
    const p=await h.go('academic');
    await p.getByRole('button').filter({hasText:m.course}).first().click();
    await expect(p.getByRole('button',{name:'撤销销课',exact:true})).toBeVisible();
    return p;
  };
  const teacherPay=async locked=>{
    const p=await h.go('teacher'); await p.getByRole('button',{name:'课酬',exact:true}).click();
    await expect(p.locator('.v-m-hero .v-m-big')).toHaveText('¥120');
    await expect(p.locator('.v-m-hero .v-m-badge')).toHaveText(locked?'已确认':'未确认');
  };
  try {
    await test.step('01 未销课时提交被拒绝，纯财务获得可执行的处理指引',async()=>{
      const p=await monthly('finance'),r=await action(p,'提交审批','submit');
      await h.acceptRejection('finance',r,{statuses:[409],message:/待销课/,why:'存在已开始未销课课程，不能提交月结'});
      const blocked=p.locator('.v-fin-block');
      await expect(blocked).toContainText(m.course);
      await expect(blocked).toContainText(m.students[0]);
      await expect(blocked).toContainText(m.students[1]);
      await expect(blocked.getByRole('button',{name:'去销课',exact:true})).toHaveCount(0);
      await expect(blocked).toContainText('教务或主管');
      expect((await h.state()).settlements).toHaveLength(0);
      await h.shot('finance','未销课阻止月结');
    });
    await test.step('02 教师提交点名、教务确认，财务核对120元后提交审批',async()=>{
      const teacher=await h.go('teacher');
      await teacher.getByRole('button').filter({hasText:m.course}).first().click();
      await teacher.getByRole('button',{name:'全部出勤',exact:true}).click();
      await teacher.getByRole('button',{name:'提交出勤与点评',exact:true}).click();
      await expect(teacher.getByText('待教务确认',{exact:true}).first()).toBeVisible();
      const academic=await h.openReview();await h.confirm(academic);
      expect((await h.state()).balances).toEqual([9,7]);
      await academicLesson(); // Keep a pre-lock page open for the stale-action check.
      const p=await monthly('finance'),r=await action(p,'提交审批','submit');expect(r.status()).toBe(200);
      await expect(p.locator('.v-fin-banner')).toContainText('等待主管批准');
      await expect(p.getByRole('button',{name:'批准并锁定',exact:true})).toHaveCount(0);
      const s=await h.state();expect(s.settlements[0]).toMatchObject({status:'pending',locked:0,version:1});
      await h.shot('finance','财务提交待审批');
    });
    await test.step('03 主管批准后锁月，教师显示已确认，纯财务不能解锁',async()=>{
      const p=await monthly('supervisor'),r=await action(p,'批准并锁定','approve');expect(r.status()).toBe(200);
      await expect(p.locator('.v-fin-banner')).toContainText('已锁定');
      const s=await h.state();expect(s.settlements[0]).toMatchObject({status:'locked',locked:1,version:2,total_amount:12000});
      expect(s.settlements[0].submitted_by).not.toBe(s.settlements[0].approved_by);
      expect(s.payrollLocked).toBeTruthy();await teacherPay(true);await h.shot('teacher','锁月后课酬已确认');
      const finance=await monthly('finance');await expect(finance.getByRole('button',{name:'解锁',exact:true})).toHaveCount(0);
    });
    await test.step('04 旧页面撤销被后端拒绝，刷新后明确锁定且禁用修改',async()=>{
      const p=h.actors.academic.page;
      await p.getByRole('button',{name:'撤销销课',exact:true}).click();
      const [r]=await Promise.all([
        p.waitForResponse(r=>new URL(r.url()).pathname.endsWith(`/api/credits/lessons/${m.lesson}/undo`)),
        p.getByRole('dialog',{name:'撤销销课？',exact:true}).getByRole('button',{name:'确认',exact:true}).click(),
      ]);
      await h.acceptRejection('academic',r,{statuses:[409],message:/锁定|已修改|变化|版本|刷新|变更/,why:'锁月前打开的旧页面不能撤销已锁定月份的销课'});
      await exposed(p.getByRole('alert'),info,'旧页面锁月拒绝原因可见');
      const before=await h.state();expect(before.balances).toEqual([9,7]);expect(before.transactions).toHaveLength(2);
      const fresh=await academicLesson();
      await expect(fresh.getByRole('button',{name:'撤销销课',exact:true})).toBeDisabled();
      await expect(fresh.getByText('本月已锁定，请先由主管解锁。',{exact:true})).toBeVisible();
      await h.shot('academic','锁月后修改禁用');
    });
    await test.step('05 解锁必须填写原因，解锁后课酬回到未确认而账务不回滚',async()=>{
      const p=await monthly('supervisor');await p.getByRole('button',{name:'解锁',exact:true}).click();
      const d=p.getByRole('dialog',{name:'2026-11 月度结算',exact:true});
      const reason=d.getByRole('textbox',{name:/^解锁原因/});
      await d.getByRole('button',{name:'主管解锁',exact:true}).click();
      expect(await reason.evaluate(el=>el.validity.valueMissing)).toBeTruthy();
      expect((await h.state()).settlements[0].locked).toBe(1);
      await reason.fill('更正出勤前重新核对月结');
      const [r]=await Promise.all([
        p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/api/finance/settlements/unlock')),
        d.getByRole('button',{name:'主管解锁',exact:true}).click(),
      ]);expect(r.status()).toBe(200);await expect(d).toHaveCount(0);
      const s=await h.state();expect(s.settlements[0]).toMatchObject({status:'draft',locked:0,version:3,reason:'更正出勤前重新核对月结'});
      expect(s.balances).toEqual([9,7]);expect(s.accrued).toBe(120);expect(s.transactions).toHaveLength(2);
      await teacherPay(false);await h.shot('teacher','解锁后课酬未确认');
    });
    await test.step('06 再锁月仍需财务提交和主管批准，刷新后快照与账务稳定',async()=>{
      const supervisor=await monthly('supervisor');
      await expect(supervisor.getByRole('button',{name:'批准并锁定',exact:true})).toHaveCount(0);
      const finance=await monthly('finance');expect((await action(finance,'提交审批','submit')).status()).toBe(200);
      const p=await monthly('supervisor');expect((await action(p,'批准并锁定','approve')).status()).toBe(200);
      const s=await h.state();expect(s.settlements[0]).toMatchObject({status:'locked',locked:1,version:5,total_amount:12000});
      expect(s.balances).toEqual([9,7]);expect(s.transactions).toHaveLength(2);await teacherPay(true);
      await h.shot('supervisor','重新批准并锁定');await h.healthy();
    });
  }finally{await h.close();}
});
