'use strict';

const path = require('path');
const { inferRecordRole, normalizeLegs } = require('./record-utils');

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null;
}

function norm(value) { return String(value || '').toLowerCase().replace(/\s+/g, ''); }
function sourceDir(record) {
  const p = record.sourceRelativePath || record.sourcePath || record.pdfFilepath || '';
  return p ? norm(path.dirname(p)) : '';
}
function stem(record) {
  const p = record.sourceRelativePath || record.pdfFilename || record.filename || record.subject || '';
  return norm(path.basename(p, path.extname(p)).replace(/行程单|发票|itinerary/gi, ''));
}

function scoreCandidate(support, invoice) {
  let score = 0;
  const reasons = [];
  const sellerA = norm(support.seller || support.provider);
  const sellerB = norm(invoice.seller || invoice.provider);
  if (sellerA && sellerB && (sellerA.includes(sellerB) || sellerB.includes(sellerA))) { score += 4; reasons.push('seller'); }
  const dateA = norm(support.tripDate || support.invoiceDate || support.date);
  const dateB = norm(invoice.tripDate || invoice.invoiceDate || invoice.date);
  if (dateA && dateB && dateA === dateB) { score += 3; reasons.push('date'); }
  const dirA = sourceDir(support), dirB = sourceDir(invoice);
  if (dirA && dirB && dirA === dirB) { score += 3; reasons.push('source-directory'); }
  const stemA = stem(support), stemB = stem(invoice);
  if (stemA && stemB && (stemA.includes(stemB) || stemB.includes(stemA))) { score += 2; reasons.push('filename-stem'); }
  return { score, reasons };
}

function linkSupportingDocuments(records = []) {
  const invoices = records.filter(r => inferRecordRole(r) === 'invoice' && money(r.amount));
  const links = [];
  for (const support of records.filter(r => inferRecordRole(r) === 'supporting_document')) {
    support.recordRole = 'supporting_document';
    const amountKey = money(support.amountCandidate || support.amount);
    const candidates = amountKey ? invoices.filter(r => money(r.amount) === amountKey) : [];
    const ranked = candidates.map(invoice => ({ invoice, ...scoreCandidate(support, invoice) }))
      .sort((a, b) => b.score - a.score);
    const unique = ranked.length === 1 || (ranked[0] && ranked[0].score > (ranked[1] ? ranked[1].score : -1));
    if (!ranked.length) {
      support.associationStatus = 'unmatched';
      support.needsManualReview = true;
      support.manualReason = 'TRAVEL_LINK_NOT_FOUND';
      links.push({ support, status: 'unmatched', candidates: [] });
      continue;
    }
    if (!unique) {
      support.associationStatus = 'ambiguous';
      support.needsManualReview = true;
      support.manualReason = 'TRAVEL_LINK_AMBIGUOUS';
      links.push({ support, status: 'ambiguous', candidates: ranked.map(x => x.invoice.emailUid) });
      continue;
    }
    const best = ranked[0];
    const target = best.invoice;
    const legs = normalizeLegs(support);
    if (legs.length) {
      target.legs = legs;
      target.fromStation = legs[0].from || target.fromStation;
      target.toStation = legs[0].to || target.toStation;
    }
    target.tripDate = support.tripDate || target.tripDate;
    target.transportType = support.transportType || target.transportType;
    target.travelAssociation = { supportingUid: support.emailUid, method: ['amount', ...best.reasons], confidence: best.score >= 6 ? 'high' : 'medium' };
    support.parentInvoiceUid = target.emailUid;
    support.associationStatus = 'linked';
    support.needsManualReview = false;
    support.manualReason = null;
    links.push({ support, target, status: 'linked' });
  }
  return links;
}

module.exports = { linkSupportingDocuments, scoreCandidate };
