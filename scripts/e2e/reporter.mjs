import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const reportDir = process.env.E2E_REPORT_DIR || 'work/e2e';
const clean = value => String(value).replace(/\x1b\[[0-9;]*m/g, '');

export default class ScenarioReporter {
  rows = [];
  errors = [];
  onError(error) { this.errors.push(clean(error.message || String(error))); }
  onTestEnd(test, result) {
    const steps = [];
    const walk = (items, depth = 0) => {
      for (const step of items) {
        if (step.category === 'test.step') steps.push({ title: step.title, status: step.error ? 'failed' : 'passed', duration: step.duration, depth });
        walk(step.steps || [], depth + (step.category === 'test.step' ? 1 : 0));
      }
    };
    walk(result.steps);
    const project = test.parent.project()?.name;
    const attachments = result.attachments.map((a, i) => {
      if (a.path) return { name: a.name, path: path.relative(path.resolve(reportDir), a.path) };
      if (a.body) {
        mkdirSync(`${reportDir}/data`, { recursive: true });
        const target = `data/${project}-${this.rows.length}-${i}.${a.contentType.includes('json') ? 'json' : 'txt'}`;
        writeFileSync(`${reportDir}/${target}`, a.body);
        return { name: a.name, path: target };
      }
      return null;
    }).filter(Boolean);
    this.rows.push({ scenario: test.title, project,
      status: result.status, duration: result.duration, errors: result.errors.map(e => clean(e.message)), steps, attachments });
  }
  onEnd(result) {
    mkdirSync(reportDir, { recursive: true });
    const report = { generatedAt: new Date().toISOString(), status: result.status,
      summary: { executions: this.rows.length, passed: this.rows.filter(x => x.status === 'passed').length,
        failed: this.rows.filter(x => !['passed', 'skipped'].includes(x.status)).length,
        passedSteps: this.rows.flatMap(x => x.steps).filter(x => x.status === 'passed').length,
        failedSteps: this.rows.flatMap(x => x.steps).filter(x => x.status === 'failed').length },
      mode: process.env.TEST_BUNDLE === '1' ? 'bundle-local-adapter' : 'source-local-adapter',
      scope: '业务场景验收；桌面及手机 Chromium；本地 SQLite/D1 适配；不含真实登录、微信实机和 Cloudflare 边缘',
      scenarios: [...new Set(this.rows.map(x => x.scenario))],
      errors: this.errors, results: this.rows };
    writeFileSync(`${reportDir}/report.json`, JSON.stringify(report, null, 2));
    const link = p => `<${p}>`;
    const lines = ['# 枫琴 CRM 业务场景验收报告', '', `运行结果：${report.status}`, `测试模式：${report.mode}`, '', `范围：${report.scope}`, '',
      '未执行或因上游失败中断的步骤不计为通过。人工判断的易用性问题另记于问题清单。', '', ...this.errors.map(e => `全局错误：${e}`)];
    for (const row of this.rows) {
      lines.push(`## ${row.project}：${row.scenario}`, '', `结果：${row.status}；耗时：${(row.duration / 1000).toFixed(1)} 秒`, '',
        '| 操作步骤 | 结果 |', '| --- | --- |', ...row.steps.map(s => `| ${s.title.replaceAll('|', '\\|')} | ${s.status} |`), '',
        ...row.attachments.map(a => `- [${a.name}](${link(a.path)})`), '', ...row.errors.map(e => `\n错误：\n\n\x60\x60\x60text\n${e}\n\x60\x60\x60`));
    }
    writeFileSync(`${reportDir}/report.md`, lines.join('\n') + '\n');
  }
}
