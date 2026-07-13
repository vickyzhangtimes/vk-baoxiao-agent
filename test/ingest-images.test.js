'use strict';
const test = require('node:test');
const assert = require('assert');
const { buildImageIntake, mapInvoiceType } = require('../lib/ingest-images');

// step4-merge 用此正则从 pdf-text filename 前导数字匹配 uid
const UID_RE = /^(\d+)_/;

const sample = [
  { invoice_number: 'A1', invoice_date: '2026-01-01', invoice_type: '增值税普通发票',
    total_amount: 100, tax_amount: 0, seller_name: '餐厅', buyer_name: '公司', image_path: 'C:/x/1.jpg' },
  { invoice_number: 'B1', invoice_date: '2026-01-01', invoice_type: '增值税专用发票',
    total_amount: 200, tax_amount: 20, seller_name: '酒店', buyer_name: '公司' },
];

test('buildImageIntake: 产出 4 个同构中间产物，数量正确', () => {
  const out = buildImageIntake(sample, { dateTag: 'T1' });
  assert.strictEqual(out.count, 2);
  assert.strictEqual(out.emailsOut.emails.length, 2);
  assert.strictEqual(out.classifiedOut.records.length, 2);
  assert.strictEqual(out.downloadOut.downloaded.length, 2);
  assert.strictEqual(out.pdfTextOut.results.length, 2);
  assert.strictEqual(out.emailsOut.meta.dateTag, 'T1');
});

test('uid + filename 前导数字匹配 step4 的 (\d+)_ 正则', () => {
  const out = buildImageIntake(sample, { dateTag: 'T2' });
  out.emailsOut.emails.forEach((e, i) => {
    assert.strictEqual(e.uid, i + 1);
    const m = out.pdfTextOut.results[i].filename.match(UID_RE);
    assert.ok(m, `pdf-text filename 应含前导数字: ${out.pdfTextOut.results[i].filename}`);
    assert.strictEqual(Number(m[1]), e.uid);
  });
});

test('金额映射：amount=价税合计，taxAmount 透传', () => {
  const out = buildImageIntake(sample, { dateTag: 'T3' });
  assert.strictEqual(out.pdfTextOut.results[0].amount, 100);
  assert.strictEqual(out.pdfTextOut.results[0].taxAmount, 0);
  assert.strictEqual(out.pdfTextOut.results[1].amount, 200);
  assert.strictEqual(out.pdfTextOut.results[1].taxAmount, 20);
});

test('购销方 + 来源字段透传', () => {
  const out = buildImageIntake(sample, { dateTag: 'T4' });
  assert.strictEqual(out.pdfTextOut.results[0].seller, '餐厅');
  assert.strictEqual(out.pdfTextOut.results[0].buyer, '公司');
  assert.strictEqual(out.pdfTextOut.results[0].filepath, 'C:/x/1.jpg');
  assert.strictEqual(out.downloadOut.downloaded[0].path, 'C:/x/1.jpg');
});

test('mapInvoiceType: 专票 / 普票 / 非增值税发票 / 未知', () => {
  assert.strictEqual(mapInvoiceType('增值税专用发票'), '专票');
  assert.strictEqual(mapInvoiceType('增值税电子专用发票'), '专票');
  assert.strictEqual(mapInvoiceType('增值税普通发票'), '普票');
  assert.strictEqual(mapInvoiceType('通用机打发票'), '普票');     // deriveInvoiceType 会误判，这里必须正确
  assert.strictEqual(mapInvoiceType('出租车发票'), '普票');
  assert.strictEqual(mapInvoiceType('定额发票'), '普票');
  assert.strictEqual(mapInvoiceType('火车票/机票行程单'), '非增值税发票');
  assert.strictEqual(mapInvoiceType(''), '未知');
  assert.strictEqual(mapInvoiceType('其他票据'), '未知');
});

test('非增值税发票类型进入 pdf-text 后，step4 能推导 exTaxAmount', () => {
  // 火车票：价税合计=100，无税额 → exTaxAmount 应为 100（报销金额=价税合计）
  const rec = [{ invoice_number: 'T', invoice_type: '火车票/机票行程单', total_amount: 100, tax_amount: null }];
  const out = buildImageIntake(rec, { dateTag: 'T5' });
  const r = out.pdfTextOut.results[0];
  assert.strictEqual(r.invoiceType, '非增值税发票');
  assert.strictEqual(r.amount, 100);
});

test('records 非数组应抛错', () => {
  assert.throws(() => buildImageIntake({ foo: 1 }, { dateTag: 'T6' }), /数组/);
});

test('空数组：产出空产物但不抛错', () => {
  const out = buildImageIntake([], { dateTag: 'T7' });
  assert.strictEqual(out.count, 0);
  assert.strictEqual(out.pdfTextOut.results.length, 0);
});
