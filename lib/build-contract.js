'use strict';
/**
 * lib/build-contract.js — 冻结的「报销单 canonical 数据契约」
 *
 * 这是模板化渲染器（P1）唯一依赖的输入边界。
 * 把 invoice-final.json（每行发票）+ package-config（报销包层面元数据）
 * 合并成一个稳定的结构：{ meta, rows, totals }。
 *
 * 设计原则：
 *  - 纯函数，无 Excel/PDF 依赖，可直接单测。
 *  - rows 已过滤待处理发票，并补齐模板 token 需要的全部字段。
 *  - totals 预先算好，渲染器不必再聚合。
 */

const { deriveExTaxAmount } = require('./invoice-fields');
const { isInvoiceRecord, formatRoute } = require('./record-utils');

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}
function round2(n) {
  if (n == null || isNaN(n)) return 0;
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function buildContract(invoiceFinal, pkg) {
  const data = (invoiceFinal && invoiceFinal.data) || [];
  const meta = (invoiceFinal && invoiceFinal.meta) || {};
  const p = pkg || {};

  const rows = data
    .filter(r => isInvoiceRecord(r) && r.amount && !r.needsManualReview)
    .map((r, i) => ({
      seq: i + 1,
      date: r.invoiceDate || '',
      cat: r.category || '其他',
      seller: r.seller || '',
      invoiceNo: r.invoiceNo || '',
      invoiceType: r.invoiceType || '未知',
      amount: num(r.amount),
      taxAmount: num(r.taxAmount),
      exTaxAmount: deriveExTaxAmount(num(r.amount), num(r.taxAmount), r.invoiceType || '未知'),
      buyer: r.buyer || '',
      notes: r.notes || '',
      transportType: r.transportType || '',
      flightNo: r.flightNo || '',
      tripDate: r.tripDate || '',
      fromStation: r.fromStation || '',
      toStation: r.toStation || '',
      legs: r.legs || [],
      route: formatRoute(r),
      // 报销包层面字段（整单共用）
      costCenter: p.costCenter || '',
      budgetCategory: p.budgetCategory || '',
      contractNo: p.contractNo || '',
    }));

  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  const taxTotal = round2(rows.reduce((s, r) => s + r.taxAmount, 0));
  const exTaxTotal = round2(rows.reduce((s, r) => s + (r.exTaxAmount || 0), 0));

  return {
    meta: {
      claimer: p.claimer,
      department: p.department,
      buyerName: p.buyerName,
      buyerTax: p.buyerTax,
      approver: p.approver,
      approvers: p.approvers,
      reviewer: p.reviewer,
      cashier: p.cashier,
      payerBank: p.payerBank,
      payeeBank: p.payeeBank,
      costCenter: p.costCenter,
      budgetCategory: p.budgetCategory,
      contractNo: p.contractNo,
      startDate: meta.startDate || '',
      endDate: meta.endDate || '',
      dateTag: meta.dateTag || '',
    },
    rows,
    totals: { count: rows.length, total, taxTotal, exTaxTotal },
  };
}

module.exports = { buildContract };
