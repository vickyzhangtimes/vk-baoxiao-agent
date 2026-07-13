'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { buildTemplateRenderStep, templateOutPath } = require('../lib/pipeline-template-step');

const ctx = {
  root: '/repo',
  scanDir: path.join('/repo', 'scan-results'),
  dateTag: '20260101-20260131',
  invoiceFinalFile: path.join('/repo', 'scan-results', 'invoice-final-20260101-20260131.json'),
};

test('未设置 REIMBURSEMENT_TEMPLATE → 返回 null（不接入，零行为变化）', () => {
  delete process.env.REIMBURSEMENT_TEMPLATE;
  assert.strictEqual(buildTemplateRenderStep(ctx), null);
});

test('格式非法（无斜杠 / 空 name）→ 返回 null', () => {
  process.env.REIMBURSEMENT_TEMPLATE = 'demo';
  assert.strictEqual(buildTemplateRenderStep(ctx), null);
  process.env.REIMBURSEMENT_TEMPLATE = 'demo/';
  assert.strictEqual(buildTemplateRenderStep(ctx), null);
});

test('设置 user/name → 构造正确的步骤对象', () => {
  process.env.REIMBURSEMENT_TEMPLATE = 'demo/std';
  const step = buildTemplateRenderStep(ctx);
  assert.ok(step, '应返回步骤对象');
  assert.strictEqual(step.key, 'template-render');
  assert.strictEqual(step.script, 'render-reimbursement.js');
  assert.strictEqual(step.label.includes('template reimbursement form'), true);

  // 输出文件名：报销单-<user>-<name>-<dateTag>.xlsx
  const expectedOut = path.join(ctx.scanDir, '报销单-demo-std-20260101-20260131.xlsx');
  assert.strictEqual(step.outputs[0], expectedOut);
  assert.strictEqual(templateOutPath(ctx, 'demo', 'std'), expectedOut);

  // args 含 --user/--name/--dateTag/--input/--output
  const a = step.args;
  assert.deepStrictEqual(a.slice(0, 6), ['--user', 'demo', '--name', 'std', '--dateTag', '20260101-20260131']);
  assert.ok(a.includes('--input') && a.includes(ctx.invoiceFinalFile), '应带 --input 数据契约路径');
  assert.ok(a.includes('--output') && a.includes(expectedOut), '应带 --output 产物路径');
  assert.ok(!a.includes('--version'), '未指定版本时不带 --version');

  // inputs 含全部渲染代码 + 模板目录（比 basename，避开 Windows 反斜杠）
  for (const f of ['render-reimbursement.js', 'template-store.js', 'render-template.js',
    'rollup.js', 'build-contract.js', 'token-dictionary.js', 'chinese-amount.js', 'template-security.js']) {
    assert.ok(step.inputs.some(i => path.basename(i) === f), `inputs 应含 ${f}`);
  }
  assert.ok(step.inputs.includes(ctx.invoiceFinalFile), 'inputs 应含 invoice-final');
  assert.ok(step.inputs.includes(path.join(ctx.root, 'templates', 'demo', 'std')), 'inputs 应含模板目录');
});

test('带版本 user/name:2 → args 含 --version 2', () => {
  process.env.REIMBURSEMENT_TEMPLATE = 'demo/std:2';
  const step = buildTemplateRenderStep(ctx);
  assert.ok(step, '应返回步骤对象');
  const i = step.args.indexOf('--version');
  assert.ok(i !== -1 && step.args[i + 1] === '2', '应带 --version 2');
  assert.strictEqual(step.outputs[0], path.join(ctx.scanDir, '报销单-demo-std-20260101-20260131.xlsx'));
});
