'use strict';
/**
 * lib/starter-template.js — 起步模板生成器 + 模板 lint（P2）
 *
 * generateStarterTemplate: 产出一张含全部合法 token 的空白报销单模板
 *   （1 行样板 + 合计/签署区），供用户下载、改样式、填自己的布局。
 * lintTemplate: 校验模板——token 全在白名单、必需 token 齐全。
 */

const ExcelJS = require('exceljs');
const { TOKENS, parseTokens } = require('./token-dictionary');

// 渲染必需的 token（缺失则无法展开行或对账）
const REQUIRED_TOKENS = ['发票号码', '价税合计', '合计小写'];

const ROW_TOKENS = ['发票号码', '开票日期', '发票类型', '销售方名称', '费用类别', '不含税金额', '税额', '价税合计', '备注'];

function cellText(cell) {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object' && v.formula) return '';
  if (typeof v === 'object' && v.text) return String(v.text);
  if (typeof v === 'object' && v.richText) return v.richText.map(t => t.text).join('');
  return String(v);
}

async function buildStarterWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = '报销模板生成器';
  const ws = wb.addWorksheet('报销单');

  ws.getCell('A1').value = '费 用 报 销 单';
  ws.getCell('A2').value = '报销人：{{报销人}}';
  ws.getCell('B2').value = '部门：{{部门}}';
  ws.getCell('C2').value = '成本中心：{{成本中心}}';
  ws.getCell('A3').value = '报销日期：{{报销日期}}';
  ws.getCell('B3').value = '预算科目：{{预算科目}}';
  ws.getCell('C3').value = '合同号：{{合同号}}';

  // 表头（第5行）
  ROW_TOKENS.forEach((h, i) => { ws.getCell(5, i + 1).value = h; });
  // 行样板（第6行，含 token）——渲染器据此展开
  ROW_TOKENS.forEach((t, i) => { ws.getCell(6, i + 1).value = '{{' + t + '}}'; });

  // 聚合
  ws.getCell('A8').value = '合计小写：{{合计小写}}';
  ws.getCell('A9').value = '合计大写：{{合计大写}}';
  ws.getCell('A10').value = '附件张数：{{附件张数}}';

  // 签署
  ws.getCell('A12').value = '审批人：{{审批人}}';
  ws.getCell('A13').value = '复核人：{{复核人}}';
  ws.getCell('A14').value = '出纳：{{出纳}}';
  ws.getCell('A15').value = '收款账号：{{收款账号}}';
  ws.getCell('A16').value = '付款日期：{{付款日期}}';

  return wb;
}

async function generateStarterTemplate(opts = {}) {
  const wb = await buildStarterWorkbook();
  const buffer = await wb.xlsx.writeBuffer();
  const meta = {
    version: 1,
    rollup: opts.rollup || 'byCategory',
    createdAt: new Date().toISOString(),
    style: opts.style || 'minimal',
    tokensUsed: TOKENS,
  };
  return { buffer, meta };
}

async function lintTemplate(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const found = [];
  const invalid = [];
  wb.eachSheet(ws => {
    ws.eachRow({ includeEmpty: true }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        for (const t of parseTokens(cellText(cell))) {
          if (!found.includes(t)) found.push(t);
          if (!TOKENS.includes(t) && !invalid.includes(t)) invalid.push(t);
        }
      });
    });
  });
  const missing = REQUIRED_TOKENS.filter(t => !found.includes(t));
  const errors = [];
  if (invalid.length) errors.push('未知 token: ' + invalid.join(', '));
  if (missing.length) errors.push('缺少必需 token: ' + missing.join(', '));
  return { valid: invalid.length === 0 && missing.length === 0, errors, found, invalid, missing };
}

module.exports = { generateStarterTemplate, lintTemplate, REQUIRED_TOKENS, ROW_TOKENS };
