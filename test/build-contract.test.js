'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContract } = require('../lib/build-contract');

const sampleFinal = {
  meta: { dateTag: '20250101-20250630', startDate: '2025-01-01', endDate: '2025-06-30' },
  data: [
    { amount: '113', taxAmount: '13', invoiceType: '专票', invoiceDate: '2025-01-02', category: '餐饮招待', seller: '餐厅A', invoiceNo: 'INV1', needsManualReview: false },
    { amount: '100', taxAmount: null, invoiceType: '普票', invoiceDate: '2025-02-02', category: '办公采购', seller: '商场B', invoiceNo: 'INV2', needsManualReview: false },
    { amount: '50', invoiceType: '未知', invoiceNo: 'INV3', needsManualReview: true }, // 待处理 → 应排除
  ],
};

const pkg = {
  claimer: '张三', department: '咨询部', approver: '李四', approvers: ['李四', '王五'],
  reviewer: '赵六', cashier: '钱七',
  costCenter: 'CC01', budgetCategory: '差旅', contractNo: 'HT001',
};

test('buildContract: totals 聚合正确', () => {
  const c = buildContract(sampleFinal, pkg);
  assert.equal(c.totals.count, 2);
  assert.equal(c.totals.total, 213);
  assert.equal(c.totals.taxTotal, 13);
  assert.equal(c.totals.exTaxTotal, 200); // 100(专票) + 100(普票)
});

test('buildContract: 每行 exTaxAmount 推导正确', () => {
  const c = buildContract(sampleFinal, pkg);
  assert.equal(c.rows[0].exTaxAmount, 100); // 113-13
  assert.equal(c.rows[1].exTaxAmount, 100); // 普票=金额
});

test('buildContract: meta 含报销包字段（含多级审批）', () => {
  const c = buildContract(sampleFinal, pkg);
  assert.equal(c.meta.claimer, '张三');
  assert.equal(c.meta.department, '咨询部');
  assert.deepEqual(c.meta.approvers, ['李四', '王五']);
  assert.equal(c.meta.reviewer, '赵六');
  assert.equal(c.meta.costCenter, 'CC01');
  assert.equal(c.meta.budgetCategory, '差旅');
  assert.equal(c.meta.contractNo, 'HT001');
});

test('buildContract: 待处理发票被排除', () => {
  const c = buildContract(sampleFinal, pkg);
  assert.equal(c.rows.length, 2);
  assert.ok(!c.rows.find(r => r.invoiceNo === 'INV3'));
});

test('buildContract: 无 pkg 时不崩（缺省空串）', () => {
  const c = buildContract(sampleFinal, null);
  assert.equal(c.meta.claimer, undefined);
  assert.equal(c.rows[0].costCenter, '');
});
