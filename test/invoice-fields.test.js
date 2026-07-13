'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveInvoiceType, deriveExTaxAmount } = require('../lib/invoice-fields');

test('deriveInvoiceType: 增值税专用发票 → 专票', () => {
  assert.equal(deriveInvoiceType('增值税发票 增值税专用发票 价税合计', '发票'), '专票');
});

test('deriveInvoiceType: 增值税普通发票 → 普票', () => {
  assert.equal(deriveInvoiceType('增值税普通发票', '发票'), '普票');
});

test('deriveInvoiceType: 数电/电子普票 → 普票', () => {
  assert.equal(deriveInvoiceType('电子发票（普通发票）', '发票'), '普票');
  assert.equal(deriveInvoiceType('数电发票 价税合计', '发票'), '普票');
});

test('deriveInvoiceType: 非增值税发票类（火车票/行程单）', () => {
  assert.equal(deriveInvoiceType('', '火车票'), '非增值税发票');
  assert.equal(deriveInvoiceType('', '行程单'), '非增值税发票');
  assert.equal(deriveInvoiceType('', '付款通知书'), '非增值税发票');
});

test('deriveInvoiceType: 无法判定 → 未知', () => {
  assert.equal(deriveInvoiceType('某未知票据内容', '发票'), '未知');
});

test('deriveExTaxAmount: 专票有税额 = 价税合计 - 税额', () => {
  assert.equal(deriveExTaxAmount(113, 13, '专票'), 100);
});

test('deriveExTaxAmount: 普票无税额 = 价税合计本身', () => {
  assert.equal(deriveExTaxAmount(100, null, '普票'), 100);
});

test('deriveExTaxAmount: 非增值税发票无税额 = 金额本身', () => {
  assert.equal(deriveExTaxAmount(560, null, '非增值税发票'), 560);
});

test('deriveExTaxAmount: 专票缺税额 → null（不可靠）', () => {
  assert.equal(deriveExTaxAmount(113, null, '专票'), null);
});

test('deriveExTaxAmount: 未知类型缺税额 → null', () => {
  assert.equal(deriveExTaxAmount(113, null, '未知'), null);
});

test('deriveExTaxAmount: 浮点精度修正', () => {
  assert.equal(deriveExTaxAmount(116.55, 6.55, '专票'), 110);
  assert.equal(deriveExTaxAmount(100.01, 0.01, '专票'), 100);
});
