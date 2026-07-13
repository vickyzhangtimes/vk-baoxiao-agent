'use strict';
const fs = require('fs');
const path = require('path');

// 默认占位值：任何地方都没配置时使用，保留 {{}} 提示用户补齐。
const DEFAULTS = {
  claimer: '{{报销人}}',
  department: '{{部门}}',
  buyerName: '{{购买方抬头}}',
  buyerTax: '{{购买方税号}}',
  approver: '{{审批人}}',
  cashier: '{{出纳}}',
  payerBank: '{{付款方账户/开户行}}',
  payeeBank: '{{收款人账户/开户行}}',
  costCenter: '{{成本中心}}',
  budgetCategory: '{{预算科目}}',
  contractNo: '{{合同号}}',
  approvers: ['{{审批人}}'],
  reviewer: '{{复核人}}',
};

// 兼容历史 .env / 环境变量用法（环境变量优先级最高）。
const ENV_MAP = {
  claimer: 'CLAIMER',
  department: 'DEPARTMENT',
  buyerName: 'BUYER_NAME',
  buyerTax: 'BUYER_TAX',
  approver: 'APPROVER',
  cashier: 'CASHIER',
  payerBank: 'PAYER_BANK',
  payeeBank: 'PAYEE_BANK',
  costCenter: 'COST_CENTER',
  budgetCategory: 'BUDGET_CATEGORY',
  contractNo: 'CONTRACT_NO',
  reviewer: 'REVIEWER',
};

function loadPackageConfig() {
  let fileCfg = {};
  const cfgPath = path.join(__dirname, '..', 'config', 'package-config.js');
  if (fs.existsSync(cfgPath)) {
    try { fileCfg = require(cfgPath) || {}; }
    catch (e) { console.warn('[load-package-config] 读取配置失败，退回默认占位:', e.message); }
  }
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    const envVal = process.env[ENV_MAP[key]];
    out[key] = (envVal && String(envVal).trim()) ? envVal : (fileCfg[key] != null ? fileCfg[key] : DEFAULTS[key]);
  }
  return out;
}

module.exports = { loadPackageConfig };
