'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { generateStarterTemplate } = require('../lib/starter-template');
const store = require('../lib/template-store');
const { buildContract } = require('../lib/build-contract');
const { groupRows } = require('../lib/rollup');
const { renderTemplate } = require('../lib/render-template');

const invoiceFinal = {
  meta: { dateTag: 'TEST', startDate: '2026-01-01', endDate: '2026-01-02' },
  data: [
    { amount: 100, taxAmount: 0, invoiceType: '普票', invoiceNo: 'A1', category: '餐饮', invoiceDate: '2026-01-01', seller: 'x', needsManualReview: false },
    { amount: 50, taxAmount: 0, invoiceType: '普票', invoiceNo: 'A2', category: '餐饮', invoiceDate: '2026-01-02', seller: 'y', needsManualReview: false },
    { amount: 200, taxAmount: 20, invoiceType: '专票', invoiceNo: 'B1', category: '交通', invoiceDate: '2026-01-01', seller: 'z', needsManualReview: false },
  ],
};
const pkg = { claimer: '示例报销人', department: '示例部门', costCenter: 'CC1', approver: '主管', reviewer: '复核', cashier: '出纳', payeeBank: '6222...' };

function findTotalCell(wb) {
  for (const ws of wb.worksheets) {
    let hit = null;
    ws.eachRow({ includeEmpty: true }, row => row.eachCell({ includeEmpty: true }, cell => {
      if (typeof cell.value === 'string' && cell.value.includes('合计小写')) hit = cell.value;
    }));
    if (hit) return hit;
  }
  return null;
}

test('端到端：store→rollup(flat)→render 正确生成报销单', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-e2e-'));
  process.env.TEMPLATES_ROOT = root;
  try {
    const { buffer: tpl } = await generateStarterTemplate({});
    store.saveTemplate({ user: 'u', name: 'std', buffer: tpl, meta: { rollup: 'flat' } });
    const contract = buildContract(invoiceFinal, pkg);
    const { buffer, meta } = store.resolveTemplate({ user: 'u', name: 'std' });
    const rows = groupRows(contract.rows, meta.rollup);
    assert.strictEqual(rows.length, 3);
    const out = await renderTemplate(Object.assign({}, contract, { rows }), buffer);

    assert.ok(Buffer.isBuffer(out) && out.length > 0);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out);
    const totalCell = findTotalCell(wb);
    assert.ok(totalCell && totalCell.includes('350'), '合计小写应包含 350，实际: ' + totalCell);
  } finally { delete process.env.TEMPLATES_ROOT; fs.rmSync(root, { recursive: true, force: true }); }
});

test('端到端：rollup=byCategory 行数=类别数且对账通过', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-e2e2-'));
  process.env.TEMPLATES_ROOT = root;
  try {
    const { buffer: tpl } = await generateStarterTemplate({});
    store.saveTemplate({ user: 'u', name: 'cat', buffer: tpl, meta: { rollup: 'byCategory' } });
    const contract = buildContract(invoiceFinal, pkg);
    const { buffer, meta } = store.resolveTemplate({ user: 'u', name: 'cat' });
    const rows = groupRows(contract.rows, meta.rollup);
    assert.strictEqual(rows.length, 2);
    const out = await renderTemplate(Object.assign({}, contract, { rows }), buffer);
    assert.ok(out.length > 0);
  } finally { delete process.env.TEMPLATES_ROOT; fs.rmSync(root, { recursive: true, force: true }); }
});
