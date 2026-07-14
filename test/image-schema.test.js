'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateImageRecord } = require('../lib/image-schema');

const complete = {
  invoice_number: 'A1',
  invoice_date: '2026-07-14',
  invoice_type: '增值税普通发票',
  total_amount: 100,
  tax_amount: 0,
  seller_name: '销售方',
  buyer_name: '购买方',
  confidence: {
    invoice_number: 0.99,
    invoice_date: 0.99,
    invoice_type: 0.95,
    total_amount: 0.99,
    tax_amount: 0.90,
    seller_name: 0.96,
    buyer_name: 0.96,
  },
};

test('完整且高置信度的视觉结果直接通过', () => {
  const result = validateImageRecord(complete);
  assert.equal(result.valid, true);
  assert.equal(result.needsManualReview, false);
});

test('缺置信度或低置信度进入人工复核', () => {
  const missing = validateImageRecord({ ...complete, confidence: {} });
  assert.equal(missing.needsManualReview, true);
  assert.ok(missing.issues.some(i => i.code === 'CONFIDENCE_MISSING'));
  const low = validateImageRecord({ ...complete, confidence: { ...complete.confidence, total_amount: 0.5 } });
  assert.ok(low.issues.some(i => i.field === 'total_amount' && i.code === 'LOW_CONFIDENCE'));
});
