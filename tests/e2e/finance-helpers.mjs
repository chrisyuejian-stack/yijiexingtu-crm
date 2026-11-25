import { expect } from '@playwright/test';

export const alive = rows => rows.filter(x => x.deleted_at === null);
export const sum = rows => rows.reduce((n, x) => n + x.amount, 0);

export async function receipts(h, role = 'finance') {
  await h.go(role);
  const p = h.actors[role].page;
  if (!(await p.getByRole('button', { name: '财务', exact: true }).count()))
    await p.getByRole('button', { name: '更多', exact: true }).click();
  await h.nav(role, /^财务$/, 'finance-income');
  return p;
}

export async function payForm(h) {
  const p = await receipts(h);
  await p.getByRole('button', { name: '＋ 登记缴费', exact: true }).click();
  const drawer = p.getByRole('dialog', { name: '登记缴费', exact: true });
  await drawer.getByRole('combobox', { name: /^学员/ }).selectOption(h.manifest.studentIds[0]);
  await expect(drawer.getByLabel(`${h.manifest.course} 本次分配金额`, { exact: true })).toBeVisible();
  return { p, drawer, amount: drawer.getByLabel('本次收款金额（元）*', { exact: true }),
    allocation: drawer.getByLabel(`${h.manifest.course} 本次分配金额`, { exact: true }),
    save: drawer.getByRole('button', { name: '确认登记缴费', exact: true }) };
}

export async function balanceTab(h, role = 'finance') {
  const p = await receipts(h, role);
  await p.getByRole('button', { name: '预收余额', exact: true }).click();
  await p.getByRole('combobox', { name: /^学员/ }).selectOption(h.manifest.studentIds[0]);
  await expect(p.locator('.v-pay-balance-top')).toBeVisible();
  return p;
}

export async function exposed(locator, info, name) {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const actual = await locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { text: el.textContent, uncovered: hit === el || el.contains(hit), rect: r.toJSON() };
  });
  await info.attach(name, { body: JSON.stringify(actual, null, 2), contentType: 'application/json' });
  expect(actual.uncovered, name).toBeTruthy();
}

export async function editReceipt(h) {
  const p = await receipts(h);
  await p.getByRole('row').filter({ hasText: h.manifest.students[0] }).getByRole('button', { name: '编辑', exact: true }).click();
  return { p, drawer: p.getByRole('dialog', { name: '修改缴费记录', exact: true }) };
}
