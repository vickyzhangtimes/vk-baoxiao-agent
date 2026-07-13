'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { generateStarterTemplate, lintTemplate } = require('../lib/starter-template');

test('generateStarterTemplate + lint 通过', async () => {
  const { buffer, meta } = await generateStarterTemplate();
  assert.equal(meta.version, 1);
  const r = await lintTemplate(buffer);
  assert.equal(r.valid, true, 'lint 应通过: ' + r.errors.join('; '));
  assert.ok(r.found.includes('发票号码'));
  assert.ok(r.found.includes('价税合计'));
  assert.ok(r.found.includes('合计小写'));
});

test('lint 拒绝缺必需 token', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('s');
  ws.getCell('A1').value = '{{发票号码}}'; // 缺 价税合计 + 合计小写
  const buf = await wb.xlsx.writeBuffer();
  const r = await lintTemplate(buf);
  assert.equal(r.valid, false);
  assert.ok(r.missing.length >= 1);
});

test('lint 拒绝未知 token', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('s');
  ws.getCell('A1').value = '{{发票号码}}';
  ws.getCell('A2').value = '{{价税合计}}';
  ws.getCell('A3').value = '{{合计小写}}';
  ws.getCell('A4').value = '{{乱写的字段}}';
  const buf = await wb.xlsx.writeBuffer();
  const r = await lintTemplate(buf);
  assert.equal(r.valid, false);
  assert.ok(r.invalid.includes('乱写的字段'));
});
