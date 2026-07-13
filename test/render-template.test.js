'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { buildContract } = require('../lib/build-contract');
const { renderTemplate } = require('../lib/render-template');
const { generateStarterTemplate } = require('../lib/starter-template');

async function makeTemplateBuffer() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('报销单');
  ws.getCell('A1').value = '报销人：{{报销人}}';
  ws.getCell('A2').value = '{{合计小写}}';   // 金额类 token 独占单元格 → 数值
  ws.getCell('A3').value = '{{合计大写}}';
  ws.getCell('A5').value = '发票号码'; ws.getCell('B5').value = '销售方名称'; ws.getCell('C5').value = '价税合计';
  ws.getCell('A6').value = '{{发票号码}}'; ws.getCell('B6').value = '{{销售方名称}}'; ws.getCell('C6').value = '{{价税合计}}';
  return wb.xlsx.writeBuffer();
}

test('renderTemplate: 展开行 + 聚合 + 嵌入文本 + 对账', async () => {
  const final = { meta: {}, data: [
    { amount: '113', taxAmount: '13', invoiceType: '专票', invoiceNo: 'INV1', seller: '餐厅', invoiceDate: '2025-01-02', category: '餐饮', needsManualReview: false },
    { amount: '100', taxAmount: null, invoiceType: '普票', invoiceNo: 'INV2', seller: '商场', invoiceDate: '2025-02-02', category: '办公', needsManualReview: false },
  ] };
  const pkg = { claimer: '张三', approver: '李四', reviewer: '赵六', cashier: '钱七' };
  const contract = buildContract(final, pkg);

  const outBuf = await renderTemplate(contract, await makeTemplateBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(outBuf);
  const ws = wb.getWorksheet('报销单');

  // 嵌入文本 token
  assert.ok(String(ws.getCell('A1').value).includes('张三'));
  // 聚合
  assert.equal(ws.getCell('A2').value, 213);
  assert.equal(ws.getCell('A3').value, '贰佰壹拾叁元整');
  // 行展开（原模板行 A6 被替换为两条数据）
  const a6 = ws.getCell('A6').value, a7 = ws.getCell('A7').value;
  assert.ok([a6, a7].includes('INV1'));
  assert.ok([a6, a7].includes('INV2'));
  const c6 = ws.getCell('C6').value, c7 = ws.getCell('C7').value;
  assert.ok([c6, c7].includes(113));
  assert.ok([c6, c7].includes(100));
});

test('renderTemplate: 公式单元格被保留（不求值）', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('s');
  ws.getCell('A1').value = { formula: 'SUM(B1:B2)' }; // 用户自己的公式
  ws.getCell('B1').value = 10; ws.getCell('B2').value = 20;
  ws.getCell('A2').value = '{{报销人}}';
  const buf = await wb.xlsx.writeBuffer();
  const contract = buildContract({ meta: {}, data: [] }, { claimer: '张三' });
  const outBuf = await renderTemplate(contract, buf);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(outBuf);
  const ws2 = wb2.getWorksheet('s');
  assert.ok(ws2.getCell('A1').value && ws2.getCell('A1').value.formula, '公式应被保留');
  assert.equal(ws2.getCell('A2').value, '张三');
});

test('renderTemplate: 未知 token 拒绝（防注入）', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('s');
  ws.getCell('A1').value = '{{不存在的字段}}';
  const buf = await wb.xlsx.writeBuffer();
  const contract = buildContract({ meta: {}, data: [] }, {});
  await assert.rejects(renderTemplate(contract, buf), /未知|token/i);
});

test('renderTemplate: 对账失败抛错', async () => {
  // 构造 totals.total 与 rows 不一致的契约（模拟数据损坏）
  const contract = buildContract({ meta: {}, data: [
    { amount: '100', invoiceNo: 'X', invoiceType: '普票', needsManualReview: false },
  ] }, {});
  contract.totals.total = 999; // 篡改
  const buf = await makeTemplateBuffer();
  await assert.rejects(renderTemplate(contract, buf), /对账/);
});

test('端到端：起步模板 → 渲染服务（闭环）', async () => {
  const { buffer } = await generateStarterTemplate();
  const final = { meta: {}, data: [
    { amount: '113', taxAmount: '13', invoiceType: '专票', invoiceNo: 'INV1', seller: '餐厅', invoiceDate: '2025-01-02', category: '餐饮', needsManualReview: false },
    { amount: '100', taxAmount: null, invoiceType: '普票', invoiceNo: 'INV2', seller: '商场', invoiceDate: '2025-02-02', category: '办公', needsManualReview: false },
  ] };
  const contract = buildContract(final, { claimer: '张三', approver: '李四', reviewer: '赵六', cashier: '钱七' });
  const outBuf = await renderTemplate(contract, buffer);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(outBuf);
  const ws = wb.getWorksheet('报销单');
  const a6 = ws.getCell('A6').value, a7 = ws.getCell('A7').value;
  assert.ok([a6, a7].includes('INV1'));
  assert.ok([a6, a7].includes('INV2'));
  assert.ok(String(ws.getCell('A9').value).includes('贰佰壹拾叁元整')); // 合计大写（嵌标签→字符串）
});
