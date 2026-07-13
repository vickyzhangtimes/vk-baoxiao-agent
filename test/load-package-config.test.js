'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPackageConfig } = require('../lib/load-package-config');

test('loadPackageConfig: 含模板化扩展字段', () => {
  const pkg = loadPackageConfig();
  for (const k of ['costCenter', 'budgetCategory', 'contractNo', 'approvers', 'reviewer']) {
    assert.ok(k in pkg, '缺少字段: ' + k);
  }
});

test('loadPackageConfig: approvers 为数组', () => {
  const pkg = loadPackageConfig();
  assert.ok(Array.isArray(pkg.approvers), 'approvers 应为数组');
});

test('loadPackageConfig: 缺省值为占位符（无真实配置时）', () => {
  const pkg = loadPackageConfig();
  assert.equal(pkg.costCenter, '{{成本中心}}');
  assert.equal(pkg.reviewer, '{{复核人}}');
});
