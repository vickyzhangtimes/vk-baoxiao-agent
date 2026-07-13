#!/usr/bin/env node
/**
 * lib/apply-overrides.js — 把「人工填写覆盖」合并进发票 records。
 *
 * 用途：用户对「待处理」发票（链接型需登录会话的，如 10086/诺诺/移动）手动补齐
 * 金额/发票号/抬头/PDF 后，写一份 invoice-overrides-{dateTag}.json。
 * step5(台账)/step6(报销单)/build-invoice-table 在读取 invoice-final 后调用本模块，
 * 按 emailUid 合并覆盖项，使填写成果在「全量重跑」后也不丢失。
 *
 * 字段：items: [{ emailUid, amount?, invoiceNo?, invoiceDate?, buyer?, category?, archivePath?, note? }]
 */
const fs = require('fs');
const path = require('path');

const SCAN_DIR = path.join(__dirname, '..', 'scan-results');

function findOverrides(dateTag) {
  if (!dateTag) return null;
  const f = path.join(SCAN_DIR, `invoice-overrides-${dateTag}.json`);
  if (!fs.existsSync(f)) return null;
  try {
    const o = JSON.parse(fs.readFileSync(f, 'utf8'));
    return (o && Array.isArray(o.items)) ? o : null;
  } catch (_) {
    return null;
  }
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 就地合并 overrides 到 records（按 emailUid）。
 * @param {Array} records invoice-final 的 data 数组（会被修改）
 * @param {string} dateTag 数据标签（用于定位 invoice-overrides-{dateTag}.json）
 * @returns {Array} 同一个 records 数组
 */
function applyOverrides(records, dateTag) {
  const ov = findOverrides(dateTag);
  if (!ov || !Array.isArray(records)) return records;
  const byUid = new Map(records.map(r => [String(r.emailUid), r]));
  let applied = 0;
  for (const o of ov.items) {
    const r = byUid.get(String(o.emailUid));
    if (!r) continue;
    const amt = num(o.amount);
    if (amt != null) r.amount = amt;
    if (o.invoiceNo) r.invoiceNo = String(o.invoiceNo).trim();
    if (o.invoiceDate) r.invoiceDate = String(o.invoiceDate).trim();
    if (o.buyer) r.buyer = String(o.buyer).trim();
    if (o.category) r.category = String(o.category).trim();
    if (o.archivePath) r.archivePath = String(o.archivePath).trim();
    r.needsManualReview = false;
    r.manualReason = null;
    r.overridden = true;
    applied++;
  }
  if (applied) console.log(`[overrides] 已合并 ${applied} 条人工填写覆盖`);
  return records;
}

module.exports = { applyOverrides, findOverrides };
