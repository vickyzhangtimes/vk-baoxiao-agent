'use strict';
/**
 * lib/rollup.js — 行级数据按模式聚合（P3）
 *
 * flat       : 每张发票一行（默认，渲染器原行为）
 * byCategory : 按费用类别聚合，一类一行
 * byDay      : 按开票日期聚合，一日一行
 *
 * 聚合后的行仍携带渲染器需要的字段名（amount/taxAmount/exTaxAmount/cat/date/...），
 * 因此复用 render-template.js 无需改造；发票级字段（发票号码等）退化为「（N张）」/ 留空。
 * 聚合后所有行 amount 之和 == 原合计，强制对账仍然成立。
 */

function round2(n) {
  if (n == null || isNaN(n)) return 0;
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyFn(r) || '其他';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  let i = 0;
  for (const [k, grp] of groups) {
    i++;
    const base = grp[0];
    out.push({
      seq: i,
      cat: base.cat || '',
      date: base.date || '',
      groupLabel: k,
      seller: '',
      invoiceNo: `（${grp.length}张）`,
      invoiceType: base.invoiceType || '未知',
      amount: round2(grp.reduce((s, r) => s + (r.amount || 0), 0)),
      taxAmount: round2(grp.reduce((s, r) => s + (r.taxAmount || 0), 0)),
      exTaxAmount: round2(grp.reduce((s, r) => s + (r.exTaxAmount || 0), 0)),
      buyer: base.buyer || '',
      notes: '',
      count: grp.length,
    });
  }
  return out;
}

function groupRows(rows, mode) {
  mode = mode || 'flat';
  if (mode === 'flat' || !Array.isArray(rows) || !rows.length) return rows;
  if (mode === 'byCategory') {
    const out = groupBy(rows, r => r.cat);
    for (const r of out) r.cat = r.groupLabel;
    return out;
  }
  if (mode === 'byDay') {
    const out = groupBy(rows, r => r.date);
    for (const r of out) r.date = r.groupLabel;
    return out;
  }
  // 未知模式：回退 flat，避免静默错误
  return rows;
}

module.exports = { groupRows, round2 };
