'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { groupRows } = require('../lib/rollup');

const rows = [
  { seq: 1, cat: '餐饮', date: '2026-01-01', invoiceNo: 'A1', invoiceType: '普票', amount: 100, taxAmount: 0, exTaxAmount: 100, seller: 'x' },
  { seq: 2, cat: '餐饮', date: '2026-01-02', invoiceNo: 'A2', invoiceType: '普票', amount: 50, taxAmount: 0, exTaxAmount: 50, seller: 'y' },
  { seq: 3, cat: '交通', date: '2026-01-01', invoiceNo: 'B1', invoiceType: '专票', amount: 200, taxAmount: 20, exTaxAmount: 180, seller: 'z' },
];

test('flat 保持原样（默认）', () => {
  assert.strictEqual(groupRows(rows, 'flat').length, 3);
  assert.strictEqual(groupRows(rows).length, 3);
});

test('byCategory 按类别聚合，金额守恒', () => {
  const g = groupRows(rows, 'byCategory');
  assert.strictEqual(g.length, 2);
  const 餐饮 = g.find(r => r.cat === '餐饮');
  assert.strictEqual(餐饮.amount, 150);
  assert.strictEqual(餐饮.count, 2);
  assert.strictEqual(餐饮.invoiceNo, '（2张）');
  const total = g.reduce((s, r) => s + r.amount, 0);
  assert.strictEqual(total, 350);
});

test('byDay 按日聚合', () => {
  const g = groupRows(rows, 'byDay');
  assert.strictEqual(g.length, 2);
  const d1 = g.find(r => r.date === '2026-01-01');
  assert.strictEqual(d1.amount, 300);
  assert.strictEqual(d1.count, 2);
});

test('未知模式回退 flat', () => {
  assert.strictEqual(groupRows(rows, 'bogus').length, 3);
});
