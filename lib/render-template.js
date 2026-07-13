'use strict';
/**
 * lib/render-template.js — 占位符 xlsx 渲染服务（P1 核心）
 *
 * 设计铁律：
 *  1. 只填值，绝不求值用户模板里的公式（保留用户 SUM 等）。
 *  2. 行级 token 按 contract.rows 展开（模板行 → N 行数据）。
 *  3. 渲染后强制对账：行 价税合计 求和 == 合计小写，否则抛错。
 *  4. 白名单外 token 直接拒绝（防 {{eval(...)}} 类注入）。
 *
 * 依赖：exceljs（已在 OSS 副本本地安装，gitignored）
 */

const ExcelJS = require('exceljs');
const { TOKEN_DEFS, parseTokens } = require('./token-dictionary');
const { toChineseAmount } = require('./chinese-amount');
const { assertSafeTemplate } = require('./template-security');

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function cellText(cell) {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object' && v.formula) return ''; // 公式单元格：不处理，保留
  if (typeof v === 'object' && v.text) return String(v.text);
  if (typeof v === 'object' && v.richText) return v.richText.map(t => t.text).join('');
  return String(v);
}

function applyToken(cell, originalText, name, val) {
  const onlyToken = originalText.trim() === '{{' + name + '}}' || originalText.trim() === '{{ ' + name + ' }}';
  if (onlyToken) { cell.value = val; return; }
  const re = new RegExp('\\{\\{\\s*' + escapeRegExp(name) + '\\s*\\}\\}', 'g');
  cell.value = originalText.replace(re, String(val));
}

function resolveRowToken(name, row) {
  if (name === '行小计') return row.amount;
  if (name === '发票代码' || name === '销售方税号') return ''; // 数电票常无
  const def = TOKEN_DEFS[name];
  const v = row[def.field];
  return v == null ? '' : v;
}

function resolveInlineToken(name, contract) {
  const meta = contract.meta || {};
  switch (name) {
    case '合计小写': return contract.totals.total;
    case '合计大写': return toChineseAmount(contract.totals.total);
    case '附件张数': return contract.totals.count;
    case '报销日期': return new Date().toLocaleDateString('zh-CN');
    case '付款日期': return ''; // 留白给人填
    default: {
      const def = TOKEN_DEFS[name];
      const v = meta[def.field];
      return v == null ? '' : v;
    }
  }
}

/**
 * 渲染模板。
 * @param {object} contract  buildContract() 的产物（冻结数据契约）
 * @param {Buffer|ArrayBuffer} templateBuffer  含 {{token}} 的 xlsx 缓冲
 * @returns {Promise<Buffer>} 填好值的 xlsx 缓冲
 */
async function renderTemplate(contract, templateBuffer) {
  assertSafeTemplate(templateBuffer); // P4：渲染前拒收宏/外联
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuffer);

  const lineTotals = [];      // 收集所有 价税合计 填入值，用于对账
  const invalidTokens = [];   // 白名单外 token
  const templateCells = [];   // 行级模板单元格 {ws, rn, col, originalText, name}
  const inlineCells = [];      // meta/aggregate/sign 单元格 {ws, rn, col, originalText, name}

  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: true }, (row, rn) => {
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const originalText = cellText(cell);
        const tokens = parseTokens(originalText);
        if (!tokens.length) return;
        // 单格仅取首个 token（MVP）
        const name = tokens[0];
        const def = TOKEN_DEFS[name];
        if (!def) { invalidTokens.push(name); return; }
        if (def.scope === 'row') templateCells.push({ ws, rn, col, originalText, name });
        else inlineCells.push({ ws, rn, col, originalText, name });
      });
    });
  }

  if (invalidTokens.length) {
    throw new Error('模板含未知 token（已拒绝，防注入）: ' + [...new Set(invalidTokens)].join(', '));
  }

  // —— 展开行级模板（自底向上，避免删除行影响索引）——
  const byRow = {};
  for (const c of templateCells) {
    const k = c.ws.id + ':' + c.rn;
    (byRow[k] = byRow[k] || []).push(c);
  }
  const rowKeys = Object.keys(byRow).sort((a, b) => {
    const ra = parseInt(a.split(':')[1], 10), rb = parseInt(b.split(':')[1], 10);
    return rb - ra; // 降序
  });

  for (const k of rowKeys) {
    const cells = byRow[k];
    const rn = cells[0].rn;
    const ws = cells[0].ws;
    const templateRow = ws.getRow(rn);
    let inserted = 0;
    for (const row of contract.rows) {
      const newRn = rn + inserted + 1;
      ws.insertRow(newRn, []);
      const newRow = ws.getRow(newRn);
      for (const c of cells) {
        const srcCell = templateRow.getCell(c.col);
        const dstCell = newRow.getCell(c.col);
        if (srcCell.style) dstCell.style = JSON.parse(JSON.stringify(srcCell.style));
        const val = resolveRowToken(c.name, row);
        applyToken(dstCell, c.originalText, c.name, val);
        if (c.name === '价税合计') lineTotals.push(Number(val) || 0);
      }
      inserted++;
    }
    ws.spliceRows(rn, 1); // 删除原模板行
  }

  // —— 解析 meta/aggregate/sign ——
  for (const c of inlineCells) {
    const val = resolveInlineToken(c.name, contract);
    applyToken(c.ws.getCell(c.rn, c.col), c.originalText, c.name, val);
  }

  // —— 强制对账 ——
  const sumLines = lineTotals.reduce((s, v) => s + v, 0);
  const grand = contract.totals.total;
  if (Math.abs(sumLines - grand) > 0.01) {
    throw new Error(`对账失败：行 价税合计 求和 ${sumLines.toFixed(2)} 与 合计 ${grand.toFixed(2)} 不符`);
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { renderTemplate };
