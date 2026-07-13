#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const scanDir = path.join(root, 'scan-results');
const emailsDir = path.join(scanDir, 'emails');
const classifiedDir = path.join(scanDir, 'classified');
const downloadsDir = path.join(scanDir, 'downloads');

const args = process.argv.slice(2);
const strictMode = args.includes('--strict');
const jsonMode = args.includes('--json');
const dateTagArg = args.find((a) => !a.startsWith('--')) || '';

function exists(p) { return fs.existsSync(p); }

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { __readError: e.message };
  }
}

function csvRows(filePath) {
  if (!exists(filePath)) return null;
  const txt = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!txt) return 0;
  const lines = txt.split(/\r?\n/);
  return Math.max(0, lines.length - 1);
}

function pickLatestTag() {
  if (!exists(scanDir)) return null;
  const files = fs.readdirSync(scanDir)
    .filter((f) => /^invoice-final-.+\.json$/.test(f))
    .sort();
  if (!files.length) return null;
  return files[files.length - 1]
    .replace(/^invoice-final-/, '')
    .replace(/\.json$/, '');
}

function addCheck(bucket, label, ok, detail) {
  bucket.push({ label, ok, detail });
}

const dateTag = dateTagArg || pickLatestTag();
if (!dateTag) {
  console.error('FAIL No dateTag found - scan-results/invoice-final-*.json is missing');
  process.exit(1);
}

const paths = {
  emails: path.join(emailsDir, `emails-${dateTag}.json`),
  classified: path.join(classifiedDir, `classified-${dateTag}.json`),
  download: path.join(downloadsDir, `download-results-${dateTag}.json`),
  pdfText: path.join(scanDir, `pdf-text-${dateTag}.json`),
  invoiceFinal: path.join(scanDir, `invoice-final-${dateTag}.json`),
  invoiceTable: path.join(scanDir, `invoice-table-${dateTag}.json`),
  manualTasks: path.join(scanDir, `manual-tasks-${dateTag}.csv`),
  attributionTasks: path.join(scanDir, `attribution-tasks-${dateTag}.csv`),
  ledgerXlsx: path.join(scanDir, `发票台账-${dateTag}.xlsx`),
  reimbXlsx: path.join(scanDir, `报销单-${dateTag}.xlsx`),
  dashboard: path.join(scanDir, `报销看板-${dateTag}.html`),
  archiveIndex: path.join(root, 'archive', 'index.html'),
};

const files = [];
addCheck(files, 'emails', exists(paths.emails), path.relative(root, paths.emails));
addCheck(files, 'classified', exists(paths.classified), path.relative(root, paths.classified));
addCheck(files, 'download report', exists(paths.download), path.relative(root, paths.download));
addCheck(files, 'pdf text', exists(paths.pdfText), path.relative(root, paths.pdfText));
addCheck(files, 'invoice final', exists(paths.invoiceFinal), path.relative(root, paths.invoiceFinal));
addCheck(files, 'invoice table', exists(paths.invoiceTable), path.relative(root, paths.invoiceTable));
addCheck(files, 'manual tasks csv', exists(paths.manualTasks), path.relative(root, paths.manualTasks));
addCheck(files, 'attribution tasks csv', exists(paths.attributionTasks), path.relative(root, paths.attributionTasks));
addCheck(files, 'ledger xlsx', exists(paths.ledgerXlsx), path.relative(root, paths.ledgerXlsx));
addCheck(files, 'reimbursement xlsx', exists(paths.reimbXlsx), path.relative(root, paths.reimbXlsx));
addCheck(files, 'dashboard html', exists(paths.dashboard), path.relative(root, paths.dashboard));
addCheck(files, 'archive index', exists(paths.archiveIndex), path.relative(root, paths.archiveIndex));

const emails = exists(paths.emails) ? readJsonSafe(paths.emails) : null;
const classified = exists(paths.classified) ? readJsonSafe(paths.classified) : null;
const download = exists(paths.download) ? readJsonSafe(paths.download) : null;
const pdfText = exists(paths.pdfText) ? readJsonSafe(paths.pdfText) : null;
const invoiceFinal = exists(paths.invoiceFinal) ? readJsonSafe(paths.invoiceFinal) : null;
const invoiceTable = exists(paths.invoiceTable) ? readJsonSafe(paths.invoiceTable) : null;

const metrics = {
  dateTag,
  emailTotalSearched: emails?.meta?.totalSearched ?? null,
  emailInvoiceCandidates: emails?.meta?.totalInvoice ?? null,
  classifiedTotal: classified?.stats?.total ?? null,
  downloaded: Array.isArray(download?.downloaded) ? download.downloaded.length : null,
  downloadSkipped: Array.isArray(download?.skipped) ? download.skipped.length : null,
  downloadFailed: Array.isArray(download?.failed) ? download.failed.length : null,
  pdfExtracted: Array.isArray(pdfText?.results) ? pdfText.results.length : null,
  finalTotal: invoiceFinal?.meta?.totalRecords ?? null,
  finalComplete: invoiceFinal?.meta?.complete ?? null,
  finalNeedsManual: invoiceFinal?.meta?.needsManual ?? null,
  finalHasPdf: invoiceFinal?.meta?.hasPdf ?? null,
  tableTotal: invoiceTable?.meta?.total ?? null,
  tableWithArchive: invoiceTable?.meta?.withArchive ?? null,
  manualTasksRows: csvRows(paths.manualTasks),
  attributionTasksRows: csvRows(paths.attributionTasks),
};

const warnings = [];
const failures = [];

if (invoiceFinal?.__readError) failures.push(`invoice-final parse failed: ${invoiceFinal.__readError}`);
if (invoiceTable?.__readError) failures.push(`invoice-table parse failed: ${invoiceTable.__readError}`);
if (download?.__readError) failures.push(`download report parse failed: ${download.__readError}`);

if (metrics.finalTotal != null && metrics.tableTotal != null && metrics.finalTotal !== metrics.tableTotal) {
  warnings.push(`record count mismatch: invoice-final=${metrics.finalTotal}, invoice-table=${metrics.tableTotal}`);
}
if (metrics.finalNeedsManual != null && metrics.manualTasksRows != null && metrics.finalNeedsManual !== metrics.manualTasksRows) {
  warnings.push(`manual count mismatch: invoice-final.needsManual=${metrics.finalNeedsManual}, manual-tasks.csv=${metrics.manualTasksRows}`);
}
if ((metrics.downloadFailed || 0) > 0) {
  warnings.push(`download failed count > 0: ${metrics.downloadFailed} (check manual tasks and source links)`);
}
if ((metrics.attributionTasksRows || 0) > 0) {
  warnings.push(`attribution tasks pending: ${metrics.attributionTasksRows} (step4b mapping/override needed)`);
}
if ((metrics.manualTasksRows || 0) > 0) {
  warnings.push(`manual tasks pending: ${metrics.manualTasksRows} (run fill-pending.js workflow)`);
}
if ((metrics.classifiedTotal || 0) > 0 && (metrics.finalTotal || 0) === 0) {
  warnings.push('classified has records but final output is empty');
}

for (const c of files) {
  if (!c.ok) failures.push(`missing output: ${c.label} (${c.detail})`);
}

if (jsonMode) {
  const out = {
    status: failures.length ? 'FAIL' : (warnings.length ? 'WARN' : 'PASS'),
    strictMode,
    dateTag,
    files,
    metrics,
    warnings,
    failures,
  };
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(`Health check for dateTag: ${dateTag}`);
  console.log('');
  for (const c of files) {
    console.log(`${c.ok ? 'OK  ' : 'MISS'} ${c.label} - ${c.detail}`);
  }
  console.log('');
  console.log('Metrics:');
  console.log(`  email searched/candidates: ${metrics.emailTotalSearched ?? '-'} / ${metrics.emailInvoiceCandidates ?? '-'}`);
  console.log(`  classified/downloaded/failed: ${metrics.classifiedTotal ?? '-'} / ${metrics.downloaded ?? '-'} / ${metrics.downloadFailed ?? '-'}`);
  console.log(`  pdf extracted: ${metrics.pdfExtracted ?? '-'}`);
  console.log(`  final total/complete/manual: ${metrics.finalTotal ?? '-'} / ${metrics.finalComplete ?? '-'} / ${metrics.finalNeedsManual ?? '-'}`);
  console.log(`  table total/withArchive: ${metrics.tableTotal ?? '-'} / ${metrics.tableWithArchive ?? '-'}`);
  console.log(`  task rows manual/attribution: ${metrics.manualTasksRows ?? '-'} / ${metrics.attributionTasksRows ?? '-'}`);
  console.log('');

  if (warnings.length) {
    console.log('Warnings:');
    for (const w of warnings) console.log(`  WARN ${w}`);
    console.log('');
  }
  if (failures.length) {
    console.log('Failures:');
    for (const f of failures) console.log(`  FAIL ${f}`);
    console.log('');
  }

  const status = failures.length ? 'FAIL' : (warnings.length ? 'WARN' : 'PASS');
  console.log(`Result: ${status}`);
}

if (failures.length) process.exit(1);
if (strictMode && warnings.length) process.exit(1);
process.exit(0);
