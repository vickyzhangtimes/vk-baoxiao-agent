'use strict';
/**
 * lib/invoice-fields.js — 发票字段推导（纯函数，可单测，无外部依赖）
 *
 * 作用：
 *  - deriveInvoiceType: 从 PDF 文本 + docType 推导 VAT 类型（专票/普票/非增值税发票/未知）
 *  - deriveExTaxAmount: 推导不含税金额（报销视角）
 *
 * 为什么独立成模块：step3/step4 是 CLI 脚本（require 即跑流水线），无法直接单测。
 * 把核心推导逻辑抽到纯模块，既能被 step3/step4 复用，也能被 node:test 直接验证。
 */

function round2(n) {
  if (n == null || isNaN(n)) return null;
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * 推导发票 VAT 类型。
 * @param {string} text    PDF 全文（用于匹配"专用/普通/电子/数电"关键词）
 * @param {string} docType 文档类型（发票/行程单/火车票/付款通知书…）
 * @returns {'专票'|'普票'|'非增值税发票'|'未知'}
 */
function deriveInvoiceType(text, docType) {
  const t = String(text || '');
  // 非增值税发票类票据（交通/通知书等），无可抵扣税额概念
  if (['行程单', '火车票', '飞机票', '付款通知书', '滞纳金', '报销单'].includes(docType)) {
    return '非增值税发票';
  }
  if (/专用|专票/.test(t)) return '专票';
  if (/普通|普票|电子发票|数电|全电|价税合计/.test(t)) return '普票';
  return '未知';
}

/**
 * 推导不含税金额（报销视角）。
 * 规则：
 *  - 有税额 → 价税合计 - 税额（专票/数电专票的可抵扣基数）
 *  - 普票/非增值税发票且无税额 → 价税合计本身（报销金额=价税合计）
 *  - 专票但缺税额 / 未知 → 无法可靠推导，返回 null
 * @param {number|string|null} amount     价税合计
 * @param {number|string|null} taxAmount   税额
 * @param {string} invoiceType  deriveInvoiceType 的结果
 * @returns {number|null}
 */
function deriveExTaxAmount(amount, taxAmount, invoiceType) {
  const a = (amount == null || isNaN(amount)) ? null : Number(amount);
  const t = (taxAmount == null || isNaN(taxAmount)) ? null : Number(taxAmount);
  if (a == null) return null;
  if (t != null) return round2(a - t);
  if (invoiceType === '普票' || invoiceType === '非增值税发票') return round2(a);
  return null;
}

module.exports = { deriveInvoiceType, deriveExTaxAmount, round2 };
