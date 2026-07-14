'use strict';

const SCHEMA_VERSION = '1.0';
const DEFAULT_THRESHOLD = 0.85;
const REQUIRED_FIELDS = ['total_amount', 'seller_name', 'buyer_name', 'invoice_date'];
const FIELD_ALIASES = {
  invoice_number: ['invoice_number', 'invoiceNo'],
  invoice_date: ['invoice_date', 'invoiceDate'],
  invoice_type: ['invoice_type', 'invoiceType'],
  total_amount: ['total_amount', 'totalAmount', 'amount'],
  tax_amount: ['tax_amount', 'taxAmount'],
  seller_name: ['seller_name', 'seller'],
  buyer_name: ['buyer_name', 'buyer'],
  image_path: ['image_path', 'imagePath'],
};

function firstValue(record, aliases) {
  for (const key of aliases) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== '') return record[key];
  }
  return null;
}

function normalizeConfidence(record, field) {
  const bag = record.confidence && typeof record.confidence === 'object' ? record.confidence : {};
  const value = bag[field] ?? record[`${field}_confidence`] ?? record.overall_confidence ?? null;
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
}

function normalizeImageRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('图片识别记录必须是对象');
  const out = { schema_version: SCHEMA_VERSION };
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) out[field] = firstValue(record, aliases);
  out.items = record.items ?? null;
  out.notes = record.notes ?? record.remark ?? null;
  out.trip = record.trip ?? record.travel ?? null;
  out.confidence = {};
  for (const field of Object.keys(FIELD_ALIASES)) out.confidence[field] = normalizeConfidence(record, field);
  return out;
}

function validateImageRecord(record, options = {}) {
  const threshold = Number(options.threshold ?? DEFAULT_THRESHOLD);
  const normalized = normalizeImageRecord(record);
  const issues = [];
  for (const field of REQUIRED_FIELDS) {
    if (normalized[field] === null || normalized[field] === '') issues.push({ field, code: 'MISSING_REQUIRED' });
    const conf = normalized.confidence[field];
    if (conf === null) issues.push({ field, code: 'CONFIDENCE_MISSING' });
    else if (conf < threshold) issues.push({ field, code: 'LOW_CONFIDENCE', confidence: conf, threshold });
  }
  if (!normalized.invoice_number) issues.push({ field: 'invoice_number', code: 'MISSING_INVOICE_NUMBER' });
  return {
    valid: issues.length === 0,
    needsManualReview: issues.length > 0,
    issues,
    threshold,
    record: normalized,
  };
}

function validateImageRecords(records, options = {}) {
  if (!Array.isArray(records)) throw new Error('图片识别结果必须是数组');
  const results = records.map((record, index) => ({ index, ...validateImageRecord(record, options) }));
  return {
    schemaVersion: SCHEMA_VERSION,
    threshold: Number(options.threshold ?? DEFAULT_THRESHOLD),
    total: results.length,
    manualReview: results.filter(r => r.needsManualReview).length,
    results,
  };
}

module.exports = { SCHEMA_VERSION, DEFAULT_THRESHOLD, REQUIRED_FIELDS, normalizeImageRecord, validateImageRecord, validateImageRecords };
