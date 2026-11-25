import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { school, call, ok, course } from './fixtures-plans.mjs';
import { createV2, manualDoc, writeDoc } from './fixtures-v2.mjs';
import { ops } from './fixtures-platform.mjs';

test('V05REG 保存、发送、改价保持编辑器元信息且读取即提供价格修订', () => school(async s => {
  const c = await course(s, '回归课程', 200), doc = manualDoc(s);
  doc.modules.courses.lines[0] = { line_id: 'tmp_catalog', stage_key: 'tmp_stage', group_id: null, pricing_source: 'catalog', course_id: c.id, qty: { units: 2 } };
  let p = ok(await call(s, 'plans', 'POST', { doc, expected_price_list_rev: (await s.r.planWorkspace()).price_list_rev }), 201);
  ok(await call(s, 'plans/' + p.id + '/reference', 'PUT', { version: p.version, reference_version: 0, enabled: true }));
  ok(await call(s, 'plans/' + p.id + '/brief', 'PUT', { version: 0, text: '回归咨询原文' }));
  const verify = r => {
    assert.equal(r.reference.enabled, true);
    assert.equal(r.reference.version, 1);
    assert.equal(r.brief.text, '回归咨询原文');
    assert.ok(r.manifest.doc_types.includes('plan'));
    assert.ok(Number.isInteger(r.price_list_rev) && r.price_list_rev > 0);
  };
  p = ok(await call(s, 'plans/' + p.id)); verify(p);
  const next = writeDoc(p); next.title = '快速保存回归';
  p = ok(await call(s, 'plans/' + p.id, 'PUT', { version: p.version, doc: next, expected_price_list_rev: p.price_list_rev })); verify(p);
  p = ok(await call(s, 'plans/' + p.id + '/send', 'POST', { version: p.version })); verify(p);
  await course(s, '回归课程', 300);
  p = ok(await call(s, 'plans/' + p.id + '/reprice', 'POST', { version: p.version, line_ids: [p.modules.courses.lines[0].line_id] })); verify(p);
  assert.equal(p.computed.total.amount, 600);
}));

test('V05REG 平台示例未定价课程保持严格校验，明确改为自由另议课程后可以建方案', () => school(async s => {
  const packs = ok(await ops(s.f, 'subject-packs'));
  const old = packs.items.find(x => x.key === 'music_interest').versions.find(x => x.pack_version === '0.1');
  const sample = JSON.parse(await readFile('docs/v05/examples/platform-sample.json', 'utf8'));
  sample.doc.modules.courses.lines[0].course_key = old.content.courses[0].key;
  sample.doc.modules.fees.stage_extras = []; sample.doc.modules.fees.other_fees = [];
  const pack = ok(await ops(s.f, 'subject-packs', 'POST', { key: old.key, name: old.name, pack_version: '0.5.0', content: { ...old.content, sample_plans: [sample] } }), 201);
  ok(await ops(s.f, 'subject-packs/' + pack.key + '/versions/' + pack.pack_version + '/publish', 'POST', { version: pack.version }));
  ok(await call(s, 'settings/subjects', 'POST', { key: 'music_interest' }));
  const t = ok(await call(s, 'plan-templates?origin=platform')).items[0];
  const original = ok(await call(s, 'plan-templates/' + encodeURIComponent(t.id))).template;
  const copy = ok(await call(s, 'plan-templates', 'POST', { name: '另存机构示例', description: original.description, applicability: original.applicability, doc: original.doc, source: { template_id: t.id, version: t.version } }), 201).template;
  assert.equal(copy.origin, 'tenant'); assert.equal(copy.readonly, false);
  const renamed = ok(await call(s, 'plan-templates/' + copy.id, 'PUT', { name: '改名后的机构示例', description: copy.description, applicability: copy.applicability, doc: copy.doc, version: copy.version })).template;
  assert.equal(renamed.name, '改名后的机构示例');
  const pv = ok(await call(s, 'plan-templates/' + encodeURIComponent(t.id) + '/instantiate-preview', 'POST', { version: t.version, shift_months: 0, pricing: 'current' }));
  assert.ok(pv.checks.blocking.some(x => x.code === 'course_unavailable'));
  const doc = writeDoc(pv.doc); doc.student_id = s.students[0];
  const request = { template: { id: t.id, version: t.version, pricing: 'current' }, doc, expected_price_list_rev: pv.price_list_rev };
  ok(await call(s, 'plans', 'POST', request), 422);
  for (const item of pv.checks.blocking) {
    const l = doc.modules.courses.lines.find(x => x.line_id === item.line_id);
    Object.assign(l, { pricing_source: 'manual', origin_course_id: l.course_id, course_id: null, manual_unit_price: null, price_tbd: true });
    delete l.snapshot;
  }
  const p = ok(await call(s, 'plans', 'POST', request), 201);
  assert.equal(p.subject, sample.doc.subject);
  assert.equal(p.modules.courses.lines[0].pricing_source, 'manual');
  assert.equal(p.computed.total.has_tbd, true);
}));

test('V05REG 可选自由课程在发送和导出时同样需要价格确认', () => school(async s => {
  const doc = manualDoc(s); doc.modules.courses.lines[0].optional = true;
  const p = await createV2(s, doc);
  for (const action of ['export', 'send']) {
    const no = await call(s, 'plans/' + p.id + '/' + action, 'POST', { version: p.version });
    assert.equal(no.status, 422); assert.equal(no.body.error, 'check_failed');
    ok(await call(s, 'plans/' + p.id + '/' + action, 'POST', { version: p.version, acknowledgements: { manual_pricing: true } }));
  }
}));
