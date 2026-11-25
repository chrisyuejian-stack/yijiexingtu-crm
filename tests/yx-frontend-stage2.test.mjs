// 阶段 2 前端接入（Claude）：根地址页面路由、me 的机构代号、前端源码安全约束。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture } from './support.mjs';
import { schoolFixture } from './fixtures-school.mjs';
import { tenantAssets } from '../scripts/frontend-bundle.mjs';

const PASSWORD = 'PhaseTwoSecure9';
const get = (f, url, cookie) => f.request(url, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });

test('YXF 根地址：/ 转到 /login；/login 与 /app 给前端外壳（基础路径 /），未知路径仍 404', async () => {
  const f = await fixture();
  try {
    const home = await get(f, 'https://school.test/');
    assert.equal(home.status, 302);
    assert.equal(home.headers.get('location'), '/login');
    for (const path of ['/login', '/app', '/app/', '/app/students']) {
      const page = await get(f, 'https://school.test' + path);
      assert.equal(page.status, 200, path);
      const html = await page.text();
      assert.match(html, /<meta name="tenant-base" content="\/"/, path);
      assert.ok(!html.includes('__BASE__'));
    }
    for (const path of ['/app/unknown-page', '/login/extra', '/console', '/console.html'])
      assert.equal((await get(f, 'https://school.test' + path)).status, 404, path);
  } finally {
    f.restore();
  }
});

test('YXF 根会话的 me 带机构代号，供前端取品牌；机构路径的 me 同样带', async () => {
  const f = await fixture();
  try {
    const s = await schoolFixture(f, 'yxf-me');
    const login = await f.request('https://school.test/api/auth/login', {
      method: 'POST',
      headers: { Origin: 'https://school.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '13911112222', password: PASSWORD, turnstile: 'fixture-valid' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const me = await (await get(f, 'https://school.test/api/me', cookie)).json();
    assert.equal(me.tenant_slug, s.t.slug);
    assert.equal(me.api_base, '/api');
    const brand = await (await get(f, 'https://school.test/api/public/tenant-brand?slug=' + s.t.slug)).json();
    assert.equal(brand.name, s.t.name);
    const path = await (await get(f, 'https://school.test/' + s.t.slug + '/api/me', 'channel_session=' + s.token)).json();
    assert.equal(path.tenant_slug, s.t.slug);
  } finally {
    f.restore();
  }
});

test('YXF 新增前端文件无 HTML 注入汇、内联事件或动态执行，并已进入机构端打包', async () => {
  for (const file of ['src/tenant/yx.js', 'src/tenant/yx-settings.js', 'src/tenant/yx-plans.js', 'src/tenant/yx-home.js', 'src/tenant/yx-ai.js', 'src/tenant/yx-content.js', 'src/tenant/yx-growth.js', 'src/tenant/yx-reports.js']) {
    const source = await readFile(file, 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\s*\(/.test(source), file);
    assert.ok(!/style\s*=\s*["']/.test(source), file + ' 不写内联 style 属性（CSP 不允许）');
  }
  const assets = await tenantAssets();
  assert.ok(assets.js.includes('function yxLoginPage('));
  assert.ok(assets.js.includes('async function yxSettingsSection('));
  assert.ok(assets.js.includes('async function yxPlanEditor('));
  assert.ok(assets.js.includes('async function yxContentEditor('));
  assert.ok(assets.js.includes('async function yxAi('));
  assert.ok(assets.js.includes('async function yxFeedbackEditor('));
  assert.ok(assets.js.includes('async function yxReportEditor('));
  // 分享页 /s/{token} 复用机构端脚本：启动时先进入 yxSharePage，不请求 me、不进登录页。
  const appSource = await readFile('src/tenant/app.js', 'utf8');
  assert.match(appSource, /if \(\/\^\\\/s\\\/\[\^\/\]\+\$\/\.test\(location\.pathname\) && typeof yxSharePage === "function"\) return yxSharePage\(\);\n    const isLogin/);
  assert.ok(assets.css.includes('.yx-login'));
  const consoleSource = await readFile('src/console/app.js', 'utf8');
  assert.ok(consoleSource.includes('async function yxOpsPanel('));
});
