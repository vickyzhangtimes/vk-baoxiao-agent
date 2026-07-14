'use strict';
const fs = require('fs');
const path = require('path');

function scanArchive(base, excludeDirName) {
  const idx = [];
  if (!fs.existsSync(base)) return idx;
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name === excludeDirName) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.pdf$/i.test(entry.name)) {
        const amountMatch = entry.name.match(/(?:^|_)(\d{1,6}\.\d{2})(?:_|\.)/);
        const suffixMatch = entry.name.match(/_([A-Za-z0-9]{6})(?:_|\.pdf)/i);
        idx.push({ file, amount: amountMatch ? Number(amountMatch[1]) : null, suffix: suffixMatch ? suffixMatch[1] : null });
      }
    }
  })(base);
  return idx;
}

function resolveArchive(record, idx) {
  const invNo = String(record.invoiceNo || '');
  if (invNo.length >= 6) {
    const hits = idx.filter(x => x.suffix === invNo.slice(-6));
    if (hits.length === 1) return hits[0].file;
  }
  const uid = record.emailUid;
  if (uid != null) {
    const hits = idx.filter(x => new RegExp(`(?:^|[_-])(?:uid|u)${uid}(?:[_-]|\\.)`, 'i').test(path.basename(x.file)));
    if (hits.length === 1) return hits[0].file;
  }
  const amount = Number(record.amount);
  const seller = String(record.seller || '').replace(/\s+/g, '');
  if (amount > 0 && seller) {
    const hits = idx.filter(x => x.amount === amount && path.basename(x.file).replace(/\s+/g, '').includes(seller.slice(0, 8)));
    if (hits.length === 1) return hits[0].file;
  }
  return null;
}
module.exports = { scanArchive, resolveArchive };
