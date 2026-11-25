// Built application workflow with disposable SQLite/R2 fixtures, real loopback HTTP and Chromium.
// npm run build && TEST_BUNDLE=1 node scripts/e2e/v05-plan-workflow.mjs
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
process.env.TEST_BUNDLE = '1';
const { school, call, ok } = await import('../../tests/fixtures-plans.mjs');
const { ops } = await import('../../tests/fixtures-platform.mjs');
const { writeDoc } = await import('../../tests/fixtures-v2.mjs');
await school(async s => {
  const old = ok(await ops(s.f, 'subject-packs')).items.find(x => x.key === 'music_interest').versions.find(x => x.pack_version === '0.1');
  const sample = JSON.parse(await readFile('docs/v05/examples/platform-sample.json', 'utf8'));
  sample.doc.modules.courses.lines[0].course_key = old.content.courses[0].key;
  sample.doc.modules.fees.stage_extras = []; sample.doc.modules.fees.other_fees = [];
  const pack = ok(await ops(s.f, 'subject-packs', 'POST', { key: old.key, name: old.name, pack_version: '0.5.0', content: { ...old.content, sample_plans: [sample] } }), 201);
  ok(await ops(s.f, 'subject-packs/' + pack.key + '/versions/' + pack.pack_version + '/publish', 'POST', { version: pack.version }));
  ok(await call(s, 'settings/subjects', 'POST', { key: 'music_interest' }));
  const template = ok(await call(s, 'plan-templates?origin=platform')).items[0];
  if (process.env.V05_PRINT_DIR) {
    const form = new FormData();
    form.set('file', new Blob([await readFile('tests/assets/promo-qr-a.png')], {type:'image/png'}), 'consultation-qr.png');
    form.set('tags', '[]');
    const uploaded = await s.f.request('https://school.test/' + s.t.slug + '/api/gallery', {method:'POST',headers:{Origin:'https://school.test',Cookie:'channel_session=' + s.token},body:form});
    assert.equal(uploaded.status, 201);
    const image = await uploaded.json(), brand = ok(await call(s, 'settings/brand'));
    ok(await call(s, 'settings/brand', 'PATCH', {version:brand.version,qr_image_id:image.id}));
  }
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const response = await s.f.request('https://school.test' + req.url, {
        method: req.method, headers: { ...req.headers, host: 'school.test', ...(req.headers.origin ? { origin: 'https://school.test' } : {}) },
        ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
      });
      const headers = Object.fromEntries(response.headers);
      if (response.headers.getSetCookie().length) headers['set-cookie'] = response.headers.getSetCookie();
      res.writeHead(response.status, headers); res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) { console.error(e); res.writeHead(500).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([{ name: 'channel_session', value: s.token, domain: '127.0.0.1', path: '/' }]);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const origin = 'http://127.0.0.1:' + server.address().port;
    await page.goto(origin + '/' + s.t.slug + '/app#yx-plans');
    await page.getByRole('button', { name: '＋ 新建方案', exact: true }).click();
    await page.getByRole('radio', { name: '已有学员', exact: true }).click();
    await page.getByRole('combobox', { name: '从模版开始（可选）', exact: true }).selectOption(template.id);
    await page.getByRole('button', { name: '建好并打开', exact: true }).click();
    const confirmation = page.getByRole('dialog').filter({ has: page.getByText('确认将不可用课程改为自由课程？', { exact: true }) });
    await expect(confirmation).toBeVisible();
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/plans') && r.request().method() === 'POST'),
      confirmation.getByRole('button', { name: '确认', exact: true }).click(),
    ]);
    assert.equal(response.status(), 201, await response.text());
    const p = await response.json();
    assert.equal(p.subject, 'music_interest'); assert.equal(p.modules.courses.lines[0].pricing_source, 'manual');
    const editor = page.getByRole('dialog', { name: '课程方案', exact: true });
    await expect(editor.getByRole('button', { name: '保存', exact: true })).toBeVisible();
    const title = editor.getByRole('textbox', { name: '方案标题', exact: true });
    await title.fill('浏览器真实方案回归');
    const [saved] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/plans/' + p.id) && r.request().method() === 'PUT'),
      editor.getByRole('button', { name: '保存', exact: true }).click(),
    ]); assert.equal(saved.status(), 200, await saved.text());
    await editor.getByRole('button', { name: '更多', exact: true }).click();
    await expect(page.getByRole('button', { name: '标为优秀方案（供 AI 参考）', exact: true })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(editor).toBeVisible();
    if (process.env.V05_PRINT_DIR) {
      // The portable sample intentionally contains an unpriced manual workshop.
      // Confirm prices through the regular API before the separate print smoke test.
      const current = ok(await call(s, 'plans/' + p.id)), priced = writeDoc(current);
      for (const line of priced.modules.courses.lines) if (line.pricing_source === 'manual') {
        line.manual_unit_price = 200;
        line.price_tbd = false;
      }
      ok(await call(s, 'plans/' + p.id, 'PUT', {version:current.version,doc:priced}));
      const checks = ok(await call(s, 'plans/' + p.id + '/check'));
      assert.deepEqual(checks.blocking, []);
      await page.reload();
      await page.getByRole('button').filter({hasText:'浏览器真实方案回归'}).click();
      await expect(editor.getByRole('button',{name:'导出 PDF',exact:true})).toBeVisible();
      await editor.getByRole('button', {name:'导出 PDF',exact:true}).click();
      const ack = page.getByRole('dialog').filter({has:page.getByText('确认非价目表课程的价格',{exact:true})});
      await ack.getByRole('button', {name:'确认',exact:true}).click();
      const preview = page.locator('.yxp-print-root');
      await expect(preview).toBeVisible();
      await expect(preview.getByAltText('咨询二维码')).toHaveCount(1);
      await expect(preview.getByAltText('咨询二维码')).toHaveJSProperty('naturalWidth', 198);
      const out = resolve(process.env.V05_PRINT_DIR);
      await mkdir(out,{recursive:true});
      await page.getByRole('button',{name:'打印 / 存为 PDF',exact:true}).click();
      await page.pdf({path:out+'/plan-print.pdf',format:'A4',printBackground:true,preferCSSPageSize:true});
      await page.screenshot({path:out+'/print-preview-390.png',fullPage:true});
      console.log('PASS Real export preview → Chromium A4 PDF: QR img=1, loaded 198px fixture, '+out+'/plan-print.pdf');
      await page.getByRole('button',{name:'‹ 关闭预览',exact:true}).click();
    }
    await page.evaluate(() => { location.hash = 'today'; });
    await expect(editor).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log('PASS Built v2 workflow: platform sample → explicit manual conversion → create 201 → save 200 → reference menu retained → Escape keeps editor → hash cleanup (390px).');
    console.log('No live cloud services or production data. SQLite/R2/auth are disposable local fixtures.');
  } finally { await browser?.close(); await new Promise(r => server.close(r)); }
});
