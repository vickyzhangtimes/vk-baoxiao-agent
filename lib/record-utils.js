'use strict';

function combinedText(record = {}) {
  return [record.subject, record.pdfFilename, record.filename, record.docType, record.fullText]
    .filter(Boolean).join(' ');
}

function inferRecordRole(record = {}) {
  if (record.recordRole === 'invoice' || record.recordRole === 'supporting_document') return record.recordRole;
  const text = combinedText(record);
  const itinerary = /行程单|\bITINERARY\b|AMAP/i.test(text);
  const invoiceMarkers = /发票号码|价税合计|电子发票|数电发票|航空运输电子客票行程单/.test(text);
  return itinerary && !invoiceMarkers ? 'supporting_document' : 'invoice';
}

function isInvoiceRecord(record = {}) {
  return inferRecordRole(record) === 'invoice';
}

function normalizeLegs(record = {}) {
  const legs = Array.isArray(record.legs) ? record.legs : [];
  const clean = legs.map(leg => ({
    from: String((leg && leg.from) || '').trim(),
    to: String((leg && leg.to) || '').trim(),
  })).filter(leg => leg.from || leg.to);
  if (clean.length) return clean;
  const from = String(record.fromStation || '').trim();
  const to = String(record.toStation || '').trim();
  return from || to ? [{ from, to }] : [];
}

function formatRoute(record = {}, separator = '\n') {
  return normalizeLegs(record).map(leg => `${leg.from || ''} → ${leg.to || ''}`).join(separator);
}

function serializeRouteLegs(record = {}) {
  return formatRoute(record, ' | ');
}

function parseRouteLegs(value) {
  return String(value || '').split('|').map(part => part.trim()).filter(Boolean).map(part => {
    const pieces = part.split(/\s*(?:→|->|—>)\s*/);
    return { from: (pieces[0] || '').trim(), to: (pieces.slice(1).join('→') || '').trim() };
  }).filter(leg => leg.from || leg.to);
}

module.exports = { inferRecordRole, isInvoiceRecord, normalizeLegs, formatRoute, serializeRouteLegs, parseRouteLegs };
