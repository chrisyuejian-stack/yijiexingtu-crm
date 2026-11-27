import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, riskyFiles } from '../scripts/automerge-policy.mjs';
const ok = { draft: false, ci: 'success', labels: ['task'], files: ['src/tenant/app.js'] };
test('普通前端改动且 CI 绿：合并', () => assert.equal(decide(ok).merge, true));
test('文档与测试：合并', () => assert.equal(decide({ ...ok, files: ['docs/a.md', 'tests/x.test.mjs'] }).merge, true));
test('默认不合并：空输入与未知状态', () => {
  assert.equal(decide(null).merge, false);
  assert.equal(decide({}).merge, false);
  assert.equal(decide({ ...ok, draft: undefined }).merge, false);
  assert.equal(decide({ ...ok, ci: undefined }).merge, false);
  assert.equal(decide({ ...ok, files: null }).merge, false);
  assert.equal(decide({ ...ok, files: [] }).merge, false);
  assert.equal(decide({ ...ok, labels: null }).merge, false);
});
test('草稿、CI 失败不合并', () => {
  assert.equal(decide({ ...ok, draft: true }).merge, false);
  assert.equal(decide({ ...ok, ci: 'failure' }).merge, false);
});
test('拦截标签', () => {
  for (const l of ['blocked', 'needs-claude', 'hold', 'risk:high'])
    assert.equal(decide({ ...ok, labels: ['task', l] }).merge, false, l);
});
test('高风险路径一律不合并', () => {
  for (const f of ['migrations/0029_x.sql', '.github/workflows/ci.yml', 'deploy/update.sh', 'platform/bridge.mjs',
    'package.json', 'server.mjs', 'scripts/build.mjs', 'scripts/automerge-policy.mjs', 'src/server/auth.js', 'src/server/session-store.js'])
    assert.equal(decide({ ...ok, files: ['docs/a.md', f] }).merge, false, f);
});
test('前端与普通后端文件不算高风险', () => {
  assert.deepEqual(riskyFiles(['src/tenant/app.js', 'src/console/app.js', 'src/server/plan-v2-samples.js']), []);
});
