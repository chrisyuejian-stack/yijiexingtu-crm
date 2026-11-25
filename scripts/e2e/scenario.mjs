import assert from 'node:assert/strict';
import { fixture } from '../../tests/support.mjs';
import { schoolFixture } from '../../tests/fixtures-school.mjs';
import { b64, bytes, sha } from '../../src/server/core.js';

export const SCENARIO_NOW = '2026-11-12T20:00:00+08:00';
export const COURSE = '上线验收钢琴班课';
export const STUDENTS = ['测试学员小枫', '测试学员小琴'];

export async function createScenario(kind = 'attendance') {
  if (!['attendance', 'makeup', 'scheduling', 'payments', 'balance', 'concurrency', 'settlement', 'reversal-used', 'authentication'].includes(kind)) throw Error('Unknown scenario');
  const f = await fixture();
  try {
    const s = await schoolFixture(f, 'e2e');
    const call = async (path, method, data) => {
      const result = await s.call(path, method, data);
      assert.equal(result.status, path === 'accounts' ? 201 : 200,
        `${path}: unexpected HTTP ${result.status}`);
      return result.body;
    };
    const create = async (kind, data) => (await call(`data/${kind}`, 'POST', data)).id;
    const teacher = await create('teachers', { name: '测试主讲教师' });
    const room = await create('locations', { name: '验收琴房', capacity: 10 });
    const category = await create('course_categories', { name: '验收钢琴' });
    const course = await create('course_types', { name: COURSE, category_id: category, format: 'group', capacity: 10 });
    const students = [];
    const packages = [];
    for (const [i, name] of STUDENTS.entries()) {
      students.push(await create('students', { name, grade: '小学3年级' }));
      packages.push((await call('credits/packages', 'POST', {
        operation_id: crypto.randomUUID(), student_id: students[i], course_type_id: course,
        units_total: i ? 8 : 10, unit_price: 100, purchase_date: '2026-11-01',
      })).id);
    }
    let extraCourse = null, extraPackage = null;
    if (kind === 'payments') {
      const category2 = await create('course_categories', { name: '验收声乐' });
      extraCourse = await create('course_types', { name: '上线验收声乐课', category_id: category2, format: 'group', capacity: 10 });
      extraPackage = (await call('credits/packages', 'POST', { operation_id: crypto.randomUUID(),
        student_id: students[0], course_type_id: extraCourse, units_total: 5, unit_price: 80, purchase_date: '2026-11-01' })).id;
    }
    await call('finance/rates', 'POST', { operation_id: crypto.randomUUID(), teacher_id: teacher,
      course_type_id: course, rate_basis: 'lesson', rate: 120,
      effective_from: '2026-01-01', effective_to: '2026-12-31' });
    const lesson = await create('lessons', { start_at: '2026-11-12T19:00', teacher_id: teacher,
      course_type_id: course, location_id: room, duration: 45, units: 1,
      student_ids: kind === 'makeup' ? [students[0]] : students });
    for (const key of ['teacher_self_checkin', 'student_view_balance', 'student_view_payments'])
      await call('settings', 'PUT', { key, value: true });
    const tokens = { supervisor: s.token };
    const users = { supervisor: s.user.id };
    const loginAccounts = { supervisor: { phone: '13911112222', password: 'PhaseTwoSecure9' } };
    const roles = ['academic', 'finance', 'teacher', 'student', 'student2', ...(kind === 'concurrency' ? ['finance2'] : [])];
    for (const [i, role] of roles.entries()) {
      const actualRole = role === 'student2' ? 'student' : role === 'finance2' ? 'finance' : role;
      const u = await call('accounts', 'POST', {
        name: `验收-${role}`, phone: `1390000000${i + 1}`, roles: [actualRole],
        ...(role === 'teacher' ? { teacher_id: teacher } : {}),
        ...(actualRole === 'student' ? { student_id: students[role === 'student2' ? 1 : 0] } : {}),
      });
      f.db.raw.prepare('UPDATE users SET must_change=0 WHERE tenant_id=? AND id=?').run(s.t.id, u.id);
      const token = b64(bytes(32));
      await s.r.createSession(await sha(token), await s.r.user(u.id), { ip: 'local', ua: 'e2e' });
      tokens[role] = token;
      users[role] = u.id;
      loginAccounts[role] = { phone: `1390000000${i + 1}`, password: u.temporary_password };
    }
    if (kind === 'authentication') {
      f.env.TURNSTILE_MODE = 'off';
      f.db.raw.prepare('UPDATE users SET must_change=1 WHERE tenant_id=?').run(s.t.id);
    }
    // Fresh isolated fixture: zero rate-limit counters before user actions begin.
    f.db.raw.exec('DELETE FROM security_limits');
    f.env.TENANT_HOST = 'localhost';
    f.env.CONSOLE_HOST = '127.0.0.1';
    const manifest = { kind, now: SCENARIO_NOW, slug: s.t.slug, course: COURSE,
      students: STUDENTS, studentIds: students, teacher, room, courseId: course, lesson,
      packageIds: packages, extraCourse, extraPackage,
      initialBalances: [10, 8], expectedBalances: [9, 7], expectedPay: 120 };
    if (kind === 'authentication') manifest.loginAccounts = loginAccounts;
    async function renewSessions() {
      for (const [role, id] of Object.entries(users)) {
        const token = b64(bytes(32));
        await s.r.createSession(await sha(token), await s.r.user(id), { ip: 'local', ua: 'e2e-clock-refresh' });
        tokens[role] = token;
      }
    }
    async function state() {
      const all = (sql, ...args) => f.db.raw.prepare(sql).all(...args);
      let payroll = { items: [], locked: false };
      if (kind !== 'authentication') {
        const response = await f.request(`http://localhost/${s.t.slug}/api/finance/payroll?month=2026-11`, {
          headers: { Cookie: `channel_session=${tokens.finance}` },
        });
        assert.equal(response.status, 200, '财务结果读取失败');
        payroll = await response.json();
      }
      return {
        ...(kind === 'authentication' ? { authUsers: Object.entries(users).map(([role,id]) => ({ role,
          ...f.db.raw.prepare('SELECT must_change,active FROM users WHERE tenant_id=? AND id=?').get(s.t.id,id) })) } : {}),
        lesson: all('SELECT status FROM lessons WHERE tenant_id=? AND id=?', s.t.id, lesson)[0],
        lessons: all('SELECT id,start_at,duration,units,teacher_id,location_id,course_type_id,status FROM lessons WHERE tenant_id=? AND deleted_at IS NULL ORDER BY start_at,id', s.t.id),
        allParticipants: all('SELECT id,lesson_id,student_id,attendance,deducted,makeup_for FROM lesson_participants WHERE tenant_id=? AND deleted_at IS NULL ORDER BY lesson_id,student_id', s.t.id),
        makeupLinks: all('SELECT original_participant_id,target_participant_id,target_lesson_id FROM makeup_links WHERE tenant_id=? AND deleted_at IS NULL', s.t.id),
        participants: all('SELECT student_id,attendance,deducted FROM lesson_participants WHERE tenant_id=? AND lesson_id=? ORDER BY student_id', s.t.id, lesson),
        balances: packages.map(id => f.db.raw.prepare('SELECT ROUND(SUM(delta),2) AS balance FROM package_transactions WHERE tenant_id=? AND package_id=?').get(s.t.id, id).balance),
        transactions: all('SELECT package_id,delta FROM package_transactions WHERE tenant_id=? AND delta<0', s.t.id),
        submissions: all('SELECT status,reason,public_text FROM lesson_submissions WHERE tenant_id=? AND lesson_id=? ORDER BY created_at,id', s.t.id, lesson),
        published: all('SELECT student_id,text,homework FROM lesson_comments WHERE tenant_id=? AND lesson_id=? AND deleted_at IS NULL', s.t.id, lesson),
        accrued: payroll.items.find(x => x.teacher_id === teacher)?.accrued_amount ?? null,
        payrollLocked: payroll.locked,
        payrollConfirmation: payroll.items.find(x => x.teacher_id === teacher)?.confirmation_status,
        settlements: all('SELECT status,locked,version,reason,submitted_by,approved_by,total_amount FROM settlements WHERE tenant_id=? AND deleted_at IS NULL ORDER BY month', s.t.id),
        financial: {
          // Money fields below are raw integer cents, independent of UI formatting.
          payments: all('SELECT id,student_id,amount,paid_at,note,version,deleted_at FROM student_payments WHERE tenant_id=? ORDER BY id', s.t.id),
          allocations: all('SELECT id,student_id,package_id,payment_id,ledger_id,amount,deleted_at FROM student_payment_allocations WHERE tenant_id=? ORDER BY id', s.t.id),
          ledger: all('SELECT id,student_id,type,amount,payment_id,package_id,reason,deleted_at FROM student_balances_ledger WHERE tenant_id=? ORDER BY id', s.t.id),
          balancesCents: students.map(id => f.db.raw.prepare('SELECT COALESCE(SUM(amount),0) n FROM student_balances_ledger WHERE tenant_id=? AND student_id=? AND deleted_at IS NULL').get(s.t.id, id).n),
          packages: all(`SELECT p.id,p.student_id,p.course_type_id,p.units_total,p.amount,
            COALESCE((SELECT SUM(x.amount) FROM package_receipt_lines x WHERE x.tenant_id=p.tenant_id AND x.package_id=p.id),0) AS paidCents,
            COALESCE((SELECT SUM(t.delta) FROM package_transactions t WHERE t.tenant_id=p.tenant_id AND t.package_id=p.id AND t.deleted_at IS NULL),0) AS unitsBalance
            FROM packages p WHERE p.tenant_id=? AND p.deleted_at IS NULL ORDER BY p.id`, s.t.id),
          activeCashCents: f.db.raw.prepare('SELECT COALESCE(SUM(amount),0) n FROM student_payments WHERE tenant_id=? AND deleted_at IS NULL').get(s.t.id).n,
        },
        maxQueries: Math.max(0, ...f.db.queryReports.map(x => x.queries)),
      };
    }
    return { f, tokens, manifest, state, renewSessions };
  } catch (error) { f.restore(); throw error; }
}
