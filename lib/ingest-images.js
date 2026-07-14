'use strict';
/**
 * lib/ingest-images.js — 图片 intake 的「数据转换」纯函数层（与 ingest-folder.js 同思路）
 *
 * 方案A（零新增依赖）：视觉识别由调用方 AI（多模态）完成，本模块只把「已抽取的发票记录」
 * 转成与 ingest-folder.js 同构的中间产物（emails / classified / downloads / pdf-text），
 * 使 step4-merge-data.js 及下游 12 步无需任何改动即可直接跑。
 *
 * 输入：AI 从发票图片抽取的 records 数组（字段沿用 invoice-reimbursement 的抽取 schema）
 * 输出：4 个 JSON 对象（由 CLI 写入 scan-results）
 *
 * 设计要点：
 *  - pdf-text 结果直接携带视觉抽取字段（amount=价税合计 / taxAmount / invoiceType / 日期 / 购销方），
 *    step4 按 filename 前导 `(\d+)_` 匹配 uid 后原样读取，无需改动。
 *  - 发票类型映射显式处理（通用机打/出租车/火车票 等 deriveInvoiceType 会误判为「未知」的情况）。
 */
const { validateImageRecord } = require('./image-schema');

// invoice-reimbursement 的发票类型 → 本流水线 canonical 类型（专票/普票/非增值税发票/未知）
// 显式映射，不依赖 deriveInvoiceType（后者对 机打/出租/火车票 会落「未知」）。
function mapInvoiceType(rawType) {
  const t = String(rawType || '');
  if (!t) return '未知';
  if (/专用|专票/.test(t)) return '专票';
  if (/火车|机票|行程单|飞机票/.test(t)) return '非增值税发票';
  if (/普通|普票|电子发票|数电|全电|机打|出租|定额|发票/.test(t)) return '普票';
  return '未知';
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/,/g, '').replace(/[¥￥]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function safeName(s) {
  return String(s == null ? '' : s).replace(/[^\w一-龥-]/g, '_').slice(0, 40);
}

/**
 * @param {Array} records  AI 抽取的记录（每张发票一条）
 * @param {object} opts { dateTag }
 * @returns {{emailsOut, classifiedOut, downloadOut, pdfTextOut, count}}
 */
function buildImageIntake(records, opts) {
  const dateTag = (opts && opts.dateTag) ? opts.dateTag : 'local-images';
  const threshold = (opts && opts.threshold != null) ? Number(opts.threshold) : undefined;
  if (!Array.isArray(records)) throw new Error('records 必须是数组');

  const emails = [];
  const classifiedRecords = [];
  const downloaded = [];
  const pdfResults = [];
  const visionReview = [];

  records.forEach((rec, i) => {
    const checked = validateImageRecord(rec, { threshold });
    const normalized = checked.record;
    const uid = i + 1;
    const invoiceNo = normalized.invoice_number || '';
    // step4 用 filename 前导 (\d+)_ 匹配 uid；占位扩展名不影响匹配
    const fileName = `${uid}_${safeName(invoiceNo) || 'img'}.json`;
    const imagePath = normalized.image_path || null;

    emails.push({
      uid,
      subject: rec.subject || `${normalized.seller_name || '发票'} 发票${invoiceNo}`,
      from: 'image-intake',
      date: normalized.invoice_date || null,
      status: 'downloaded',
      attachments: [{ filename: fileName, type: 'image' }],
      links: [],
      bodyInfo: null,
    });

    classifiedRecords.push({ uid, sourceType: 'image_invoice', expectedAction: 'use', platform: null });

    downloaded.push({
      uid, filename: fileName, path: imagePath,
      type: 'image', resolver: 'image-intake', status: 'downloaded',
    });

    const amount = num(normalized.total_amount);
    const taxAmount = num(normalized.tax_amount);
    pdfResults.push({
      filename: fileName,
      filepath: imagePath,
      docType: '发票',
      date: normalized.invoice_date || null,
      invoiceNo: invoiceNo || null,
      taxAmount: taxAmount,
      invoiceType: mapInvoiceType(normalized.invoice_type),
      amount: amount,
      buyer: normalized.buyer_name || null,
      seller: normalized.seller_name || null,
      items: normalized.items || null,
      fullText: normalized.notes || (typeof normalized.items === 'string' ? normalized.items : ''),
      travel: normalized.trip || null,
      visionReview: {
        needsManualReview: checked.needsManualReview,
        threshold: checked.threshold,
        issues: checked.issues,
        confidence: normalized.confidence,
      },
      error: null,
    });
    visionReview.push({ uid, filename: fileName, imagePath, needsManualReview: checked.needsManualReview, issues: checked.issues, confidence: normalized.confidence });
  });

  const emailsOut = { meta: { dateTag, startDate: null, endDate: null, total: emails.length, source: 'image-intake' }, emails };
  const classifiedOut = { meta: { dateTag }, records: classifiedRecords };
  const downloadOut = { meta: { dateTag }, downloaded };
  const pdfTextOut = { meta: { dateTag, source: 'image-intake' }, results: pdfResults };
  return {
    emailsOut, classifiedOut, downloadOut, pdfTextOut, count: emails.length,
    visionReviewOut: {
      meta: { dateTag, threshold: threshold == null ? 0.85 : threshold, total: visionReview.length, manualReview: visionReview.filter(r => r.needsManualReview).length },
      records: visionReview,
    },
  };
}

module.exports = { buildImageIntake, mapInvoiceType };
