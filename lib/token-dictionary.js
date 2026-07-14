'use strict';
/**
 * lib/token-dictionary.js — 模板 token 白名单（我们维护的「映射服务」核心）
 *
 * 占位符 xlsx 下，映射是自描述的：用户在单元格写 {{发票号码}}，落点即映射。
 * 本模块是白名单 + 作用域定义 + 解析/校验。渲染器（render-template.js）消费它。
 *
 * scope:
 *   meta      — 单据头（整单共用，来自 contract.meta）
 *   row       — 行级（按每张发票展开，来自 contract.rows[i]）
 *   aggregate  — 聚合（渲染期计算：合计/大写/附件数）
 *   sign      — 签署栏（来自 contract.meta，付款日期留白）
 */

const TOKEN_DEFS = {
  // —— 单据头 ——
  '报销人': { scope: 'meta', field: 'claimer' },
  '部门': { scope: 'meta', field: 'department' },
  '报销日期': { scope: 'meta', field: '_reimbDate' },
  '成本中心': { scope: 'meta', field: 'costCenter' },
  '预算科目': { scope: 'meta', field: 'budgetCategory' },
  '合同号': { scope: 'meta', field: 'contractNo' },
  '购买方名称': { scope: 'meta', field: 'buyerName' },
  '购买方税号': { scope: 'meta', field: 'buyerTax' },
  // —— 行级 ——
  '发票号码': { scope: 'row', field: 'invoiceNo' },
  '发票代码': { scope: 'row', field: '_invoiceCode' },
  '开票日期': { scope: 'row', field: 'date' },
  '发票类型': { scope: 'row', field: 'invoiceType' },
  '销售方名称': { scope: 'row', field: 'seller' },
  '销售方税号': { scope: 'row', field: '_sellerTax' },
  '费用类别': { scope: 'row', field: 'cat' },
  '不含税金额': { scope: 'row', field: 'exTaxAmount' },
  '税额': { scope: 'row', field: 'taxAmount' },
  '价税合计': { scope: 'row', field: 'amount' },
  '交通方式': { scope: 'row', field: 'transportType' },
  '航班号': { scope: 'row', field: 'flightNo' },
  '出行日期': { scope: 'row', field: 'tripDate' },
  '出发地': { scope: 'row', field: 'fromStation' },
  '到达地': { scope: 'row', field: 'toStation' },
  '备注': { scope: 'row', field: 'notes' },
  '行小计': { scope: 'row', field: '_lineTotal' },
  // —— 聚合 ——
  '合计小写': { scope: 'aggregate', field: '_total' },
  '合计大写': { scope: 'aggregate', field: '_totalCN' },
  '附件张数': { scope: 'aggregate', field: '_attachmentCount' },
  // —— 签署 ——
  '审批人': { scope: 'sign', field: 'approver' },
  '复核人': { scope: 'sign', field: 'reviewer' },
  '出纳': { scope: 'sign', field: 'cashier' },
  '收款账号': { scope: 'sign', field: 'payeeBank' },
  '付款日期': { scope: 'sign', field: '_payDate' },
};

const TOKENS = Object.keys(TOKEN_DEFS);

function parseTokens(text) {
  const out = [];
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  let m;
  while ((m = re.exec(String(text == null ? '' : text))) !== null) out.push(m[1].trim());
  return out;
}

function validateTokens(names) {
  const valid = [], invalid = [];
  for (const n of names) (TOKENS.includes(n) ? valid : invalid).push(n);
  return { valid, invalid };
}

module.exports = { TOKEN_DEFS, TOKENS, parseTokens, validateTokens };
