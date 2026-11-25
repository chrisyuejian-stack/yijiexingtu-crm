// Component browser regressions. Uses the real UI sources and a disposable loopback server.
// Run after installing dev dependencies: node scripts/e2e/v05-ui-regressions.mjs
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
import { blankV2 } from '../../src/server/plan-v2-convert.js';
import { normalizeInline } from '../../src/server/content-inline.js';
const root = resolve('.');
const server = createServer(async (req, res) => {
  if (req.url === '/') { res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body></body></html>'); return; }
  const file = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + sep)) { res.writeHead(404).end(); return; }
  try {
    const bytes = await readFile(file);
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : 'image/svg+xml'); res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
let passed = 0;
const doc = blankV2({ subject: 'music_interest', title: '回归方案', date: '2026-11-25', style: {} });
Object.assign(doc, { id: 'pln_ui', version: 1, price_list_rev: 7 });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.evaluate(() => {
    window.el = (tag, text, attrs = {}) => {
      const n = document.createElement(tag); if (text != null) n.textContent = text;
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n;
    };
    window.button = (label, fn) => { const b = el('button', label, { type: 'button' }); b.addEventListener('click', fn); return b; };
    window.yxClone = structuredClone; window.notice = () => {}; window.base = '/';
  });
  for (const file of ['yx.js', 'yx-plans.js', 'yx-plan2.js', 'yx-content.js', 'yx-home.js']) await page.addScriptTag({ url: '/src/tenant/' + file });
  await page.evaluate(async d => {
    window.UI = { ...await import('/src/ui/components.js'), confirm: async () => true };
    window.model = d;
  }, doc);
  const check = async (name, fn) => { await fn(); console.log('PASS ' + name); passed++; };

  await check('二维码兼容渲染数据 URL 与编辑器图库 ID', async () => {
    for (const brand of [{ qr_url: '/api/share/test/media/qr' }, { qr_image_id: 'qr' }]) {
      await page.evaluate(b => {
        const d = structuredClone(model); d.brand = b;
        document.body.replaceChildren(yxPlanDocument2(d, {}, id => '/api/gallery/' + id + '/file'));
      }, brand);
      await expect(page.getByAltText('咨询二维码')).toHaveAttribute('src', brand.qr_url || '/api/gallery/qr/file');
    }
  });
  await check('更多菜单 Escape 关闭菜单并返回焦点，不关闭编辑器；输入态不退出', async () => {
    await page.evaluate(() => {
      window.closedCount = 0;
      const shell = el('div', null, { class: 'yxp-editor', tabindex: '0' });
      shell.addEventListener('keydown', e => { if (yxEditorEscape(e, shell)) closedCount++; });
      const menu = UI.actionMenu({ items: [{ label: '测试动作' }] });
      shell.append(menu.element, el('input', null, { 'aria-label': '输入态' })); document.body.replaceChildren(shell);
    });
    await page.getByRole('button', { name: '更多' }).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => closedCount), 0);
    await expect(page.getByRole('button', { name: '更多' })).toBeFocused();
    await page.getByLabel('输入态').focus(); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => closedCount), 0);
    await page.locator('.yxp-editor').focus(); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => closedCount), 1);
  });
  await check('模版课程转换须显式确认，取消不创建且禁止覆盖模版学科', async () => {
    const result = await page.evaluate(async () => {
      const doc = structuredClone(model);
      doc.modules.courses.lines = [{ line_id: 'line', course_id: 'crs_a', name: '未定价课程', pricing_source: 'catalog', qty: { units: 12 } }];
      const pv = { doc, checks: { blocking: [{ code: 'course_unavailable', line_id: 'line' }] } };
      UI.confirm = async () => false;
      const cancelled = await yxhTemplateDoc(pv, doc.subject);
      UI.confirm = async () => true;
      const converted = await yxhTemplateDoc(pv, doc.subject);
      let mismatch = false;
      try { await yxhTemplateDoc(pv, 'other_subject'); } catch { mismatch = true; }
      let otherBlock = false;
      try { await yxhTemplateDoc({ doc, checks: { blocking: [{ code: 'invalid_image', text: '图片不可用' }] } }, doc.subject); } catch { otherBlock = true; }
      const line = converted.modules.courses.lines[0];
      return [cancelled, pv.doc.modules.courses.lines[0].pricing_source, converted.subject, line.pricing_source, line.course_id, line.manual_unit_price, line.price_tbd, line.qty.units, mismatch, otherBlock];
    });
    assert.deepEqual(result, [null, 'catalog', 'music_interest', 'manual', null, null, true, 12, true, true]);
  });
  await check('可选自由课程仍弹出价格确认', async () => {
    assert.equal(await page.evaluate(async () => {
      let called = 0; UI.confirm = async () => { called++; return true; };
      const result = await yxp2Ack({ v2: true, doc: { modules: { courses: { lines: [{ name: '可选自由课程', pricing_source: 'manual', optional: true }] } } } });
      return called === 1 && result.acknowledgements.manual_pricing;
    }), true);
  });
  await check('手填教学周数可填写说明；删除阶段清理引用且有课程时拒绝', async () => {
    await page.evaluate(() => {
      window.st = { doc: structuredClone(model), types: [] };
      st.doc.modules.path.stages = [{ key: 'stage_a', name: '阶段甲', start_month: null, end_month: null, teaching_weeks: null, weeks_note: '', goals: [], nodes: [] }];
      st.doc.modules.courses.groups = [{ id: 'g', stage_key: 'stage_a' }];
      st.doc.modules.courses.stage_settings = [{ stage_key: 'stage_a', pending: true }];
      st.doc.modules.fees.due_dates = { stage_a: '2027-01-01' };
      st.doc.modules.fees.stage_extras = [{ stage_key: 'stage_a' }];
      st.doc.modules.fees.custom = [{ stage_key: 'stage_a' }];
      const draw = () => { document.body.replaceChildren(); yxp2Mod.path(document.body, st, yxp2Kit(false, () => {}), false, () => {}, draw); }; draw();
    });
    await page.getByLabel('教学周数（可空）', { exact: true }).fill('20');
    await page.getByLabel('教学周数说明（手填周数时必填）').fill('排除假期');
    assert.equal(await page.evaluate(() => st.doc.modules.path.stages[0].weeks_note), '排除假期');
    await page.evaluate(() => st.doc.modules.courses.lines.push({ stage_key: 'stage_a' }));
    await page.getByRole('button', { name: '删除', exact: true }).click();
    assert.equal(await page.evaluate(() => st.doc.modules.path.stages.length), 1);
    await page.evaluate(() => st.doc.modules.courses.lines = []);
    await page.getByRole('button', { name: '删除', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => [st.doc.modules.path.stages.length, st.doc.modules.courses.groups.length, st.doc.modules.courses.stage_settings.length, Object.keys(st.doc.modules.fees.due_dates).length, st.doc.modules.fees.stage_extras[0].stage_key, st.doc.modules.fees.custom[0].stage_key]), [0, 0, 0, 0, null, null]);
  });
  await check('自定义分期默认 100%，即时提示零比例和合计，附加费可不分阶段', async () => {
    await page.evaluate(() => {
      window.st = { doc: structuredClone(model) };
      const draw = () => { document.body.replaceChildren(); yxp2Fees(document.body, st, yxp2Kit(false, () => {}), false, () => {}, draw); }; draw();
    });
    await page.getByLabel('缴费方式').selectOption('custom');
    await expect(page.getByLabel('比例（%）')).toHaveValue('100');
    await page.getByLabel('比例（%）').fill('0');
    await expect(page.getByRole('status')).toContainText('大于 0%');
    assert.equal(await page.evaluate(() => { window.api = () => { throw Error('invalid installment reached API'); }; return yxp2Save(st, () => {}); }), false);
    await page.getByLabel('比例（%）').fill('50');
    await expect(page.getByRole('status')).toContainText('合计须为 100%');
    await page.getByRole('button', { name: '＋ 加一期' }).click();
    await page.getByLabel('比例（%）').nth(1).fill('50');
    await expect(page.getByRole('status')).toBeHidden();
    await page.getByRole('button', { name: '＋ 添加', exact: true }).first().click();
    await expect(page.getByRole('combobox', { name: '阶段', exact: true })).toHaveValue('');
  });
  await check('初始化即有价格修订；800ms 内快速保存带修订且取消待发试算', async () => {
    await page.clock.install();
    await page.evaluate(async () => {
      window.st = { doc: structuredClone(model), dirty: true };
      window.requests = [];
      window.api = async (path, method, body) => {
        requests.push({ path, method, body });
        if (method === 'PUT') return { ...structuredClone(model), version: 2 };
        if (path.endsWith('/brief')) return { brief: { text: '', version: 0 } };
        return {};
      };
      await yxp2Open(st);
      yxp2QuoteSoon(st, () => {});
      await yxp2Save(st, () => {});
    });
    await page.clock.fastForward(1000);
    assert.deepEqual(await page.evaluate(() => [requests.find(x => x.method === 'PUT').body.expected_price_list_rev, requests.filter(x => x.path.endsWith('/quote-preview')).length]), [7, 0]);
  });
  await check('在途旧试算延迟返回不得覆盖已保存文档或价格修订，元信息保留', async () => {
    await page.evaluate(() => {
      window.st = { doc: { ...structuredClone(model), reference: { enabled: true }, manifest: { name: '保留' } }, priceRev: 7, dirty: true };
      window.redraws = 0;
      window.api = async (path, method) => {
        if (path.endsWith('/quote-preview')) return new Promise(r => window.resolveQuote = r);
        return { ...structuredClone(model), version: 2, computed: { total: { amount: 100 } } };
      };
      yxp2QuoteSoon(st, () => redraws++);
    });
    await page.clock.fastForward(800);
    await page.evaluate(async () => {
      await yxp2Save(st, () => {});
      resolveQuote({ computed: { total: { amount: 999 } }, price_list_rev: 999 });
    });
    assert.deepEqual(await page.evaluate(() => [st.doc.version, st.doc.computed.total.amount, st.priceRev, st.doc.reference.enabled, st.doc.manifest.name, redraws]), [2, 100, 7, true, '保留', 0]);
  });
  await check('inline_v1 空白标记及嵌套降级与服务端一致', async () => {
    for (const input of ['**   **', '* \t *', '==  ==', '[[  ]]', '**有效**', '**嵌套 *失败***', String.raw`\*普通\*`]) {
      const parsed = await page.evaluate(x => yxInlinePlain(x), input);
      assert.equal(parsed, normalizeInline(input).plain, input);
    }
  });
  await check('列表与表格输入即时刷新正文预览且保留输入焦点', async () => {
    await page.evaluate(() => {
      window.brand = {};
      window.st = { doc: { type: 'moments', title: '测试内容', blocks: [{ type: 'list', ordered: false, items: ['原列表'] }, { type: 'table', rows: [['原表头'], ['原表格']] }] }, sel: 0, styles: [], scenes: [], flags: [], unsupported: [], hist: { past: [], future: [] } };
      window.drawContent = () => { document.body.replaceChildren(); yxcCanvas(document.body, st, false, () => {}, drawContent); };
      drawContent();
    });
    const list = page.getByLabel('分条列表，每行一条');
    await list.fill('**新列表**\n第二行');
    await expect(page.locator('.yxv-art li').first()).toHaveText('新列表');
    await expect(list).toBeFocused();
    await page.evaluate(() => { st.sel = 1; drawContent(); });
    const table = page.getByLabel('表格：每行一排，用 | 分隔');
    await table.fill('新表头 | 第二列\n新单元格 | **重点**');
    await expect(page.locator('.yxv-art th').first()).toHaveText('新表头');
    await expect(page.locator('.yxv-art td').last()).toHaveText('重点');
    await expect(table).toBeFocused();
  });
  await check('路由清理移除全屏编辑器并作废试算', async () => {
    await page.evaluate(() => {
      const shell = el('div', null, { class: 'yxp-editor' }); shell.yxDispose = () => { st.closed = true; yxp2CancelQuote(st); };
      document.body.replaceChildren(shell); yxDisposeEditors();
    });
    assert.equal(await page.locator('.yxp-editor').count(), 0);
    assert.equal(await page.evaluate(() => st.closed), true);
  });
  assert.deepEqual(pageErrors, []);
  console.log(`Browser regressions: ${passed}/${passed} passed (Chromium, 390px). Component checks; external services and full application journeys are not exercised.`);
} finally { await browser.close(); await new Promise(r => server.close(r)); }
