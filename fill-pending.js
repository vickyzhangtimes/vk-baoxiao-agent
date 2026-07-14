#!/usr/bin/env node
/**
 * fill-pending.js — 待处理发票「填写口」+ 自动重导。
 *
 * 背景：链接型发票（10086/诺诺/移动等）需网页登录会话才能取 PDF，自动化跑必失败，
 * 进入「待处理」。这些需要你人工补齐金额/发票号/抬头，或手动下载 PDF 后告知路径。
 *
 * 两种用法：
 *   1) 生成可填写清单：  node fill-pending.js --init [dateTag]
 *      → 扫描当前待处理记录，写出 scan-results/pending-fill.csv（已知项预填，未知留空）
 *   2) 填写后应用并重导：node fill-pending.js [dateTag]
 *      → 读 pending-fill.csv，把填好的行写入 invoice-overrides-{dateTag}.json（持久化，重跑不丢），
 *        若填了 pdfPath 则把 PDF 复制到 archive/<购买方>/<销售方>/，
 *        然后重跑 台账Excel / 报销单Excel / 规范表 / 看板 / E盘导出。
 *
 * CSV 字段：emailUid,seller,subject,knownAmount,invoiceNo,invoiceDate,buyer,
 *            transportType,tripDate,fromStation,toStation,pdfPath,note
 *   - knownAmount/invoiceNo/invoiceDate 预填已知值，留空表示待你补
 *   - transportType/tripDate/fromStation/toStation：火车票自动预填，打车类留空待你补；
 *     带 tripUncertain 的行程记录也会进清单供你复核站名顺序
 *   - pdfPath 填你手动下载的 PDF 本地路径（可留空；留空则仅补金额，文件待你后续放）
 *   - buyer 购买方抬头（报销人视角的购买方），留空则用「待确认」
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isInvoiceRecord, serializeRouteLegs, parseRouteLegs } = require('./lib/record-utils');

const ROOT = __dirname;
const SCAN_DIR = path.join(ROOT, 'scan-results');
const ARCHIVE_DIR = path.join(ROOT, 'archive');

const args = process.argv.slice(2);
const INIT_MODE = args.includes('--init');
const dateTagArg = args.find(a => !a.startsWith('--'));

// ---------- 工具 ----------
function findLatest(dir, prefix) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.startsWith(prefix) && f.endsWith('.json')).sort().reverse();
  return files[0] ? path.join(dir, files[0]) : null;
}
function safe(v, fallback = '待确认') {
  let t = String(v == null ? '' : v).trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ');
  return (t || fallback).slice(0, 80);
}
function uniquePath(file) {
  if (!fs.existsSync(file)) return file;
  const ext = path.extname(file), base = file.slice(0, -ext.length);
  let i = 2;
  while (fs.existsSync(`${base}-${i}${ext}`)) i++;
  return `${base}-${i}${ext}`;
}
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 极简 CSV 解析（支持双引号转义、字段内逗号）
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else q = false;
      } else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length && !(r.length === 1 && r[0] === ''));
}
function toCsv(rows) {
  return rows.map(r => r.map(c => {
    const s = String(c == null ? '' : c);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n') + '\n';
}

function resolveDateTag() {
  if (dateTagArg) return dateTagArg;
  const f = findLatest(SCAN_DIR, 'invoice-final-');
  if (!f) { console.error('未找到 invoice-final，无法解析 dateTag'); process.exit(1); }
  return path.basename(f).replace(/^invoice-final-/, '').replace(/\.json$/, '');
}

// ---------- --init：生成可填写清单 ----------
function initCsv(dateTag) {
  const finalFile = findLatest(SCAN_DIR, 'invoice-final-');
  const data = JSON.parse(fs.readFileSync(finalFile, 'utf8'));
  // 待填写范围：需人工 / 无金额 / 行程字段待复核(tripUncertain)
  const records = (data.data || []).filter(r =>
    r.needsManualReview || (isInvoiceRecord(r) && !(Number(r.amount) > 0)) || r.tripUncertain);
  const header = ['emailUid', 'seller', 'subject', 'knownAmount', 'invoiceNo', 'invoiceDate', 'buyer',
    'transportType', 'tripDate', 'fromStation', 'toStation', 'routeLegs', 'pdfPath', 'note'];
  const rows = [header];
  for (const r of records) {
    rows.push([
      r.emailUid || '',
      r.seller || '',
      r.subject || '',
      (Number(r.amount) > 0 ? r.amount : ''),
      r.invoiceNo || '',
      r.invoiceDate || '',
      r.buyer || '',
      r.transportType || '',
      r.tripDate || '',
      r.fromStation || '',
      r.toStation || '',
      serializeRouteLegs(r),
      '', // pdfPath 留空待填
      r.manualReason || (r.tripUncertain ? '⚠️ 行程字段待复核' : ''),
    ]);
  }
  const out = path.join(SCAN_DIR, 'pending-fill.csv');
  fs.writeFileSync(out, '\uFEFF' + toCsv(rows), 'utf8'); // BOM 方便 Excel 中文
  console.log(`✅ 已生成待填写清单: ${out}`);
  console.log(`   共 ${records.length} 条（链接型需登录 + 行程字段待复核）。请在 Excel 中补 knownAmount/invoiceNo/invoiceDate/buyer/出发到达，保存后运行 node fill-pending.js`);
}

// ---------- 应用：读 CSV → 写 overrides → 重导 ----------
function applyCsv(dateTag) {
  const csvPath = path.join(SCAN_DIR, 'pending-fill.csv');
  if (!fs.existsSync(csvPath)) { console.error('未找到 pending-fill.csv，请先运行 node fill-pending.js --init 生成'); process.exit(1); }
  const text = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsv(text);
  const header = rows[0].map(h => h.trim());
  const col = (name) => header.indexOf(name);

  const items = [];
  let copied = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (n) => { const idx = col(n); return idx >= 0 ? (r[idx] || '').trim() : ''; };
    const emailUid = get('emailUid');
    if (!emailUid) continue;
    const o = { emailUid };
    const amt = num(get('knownAmount'));
    if (amt != null) o.amount = amt;
    if (get('invoiceNo')) o.invoiceNo = get('invoiceNo');
    if (get('invoiceDate')) o.invoiceDate = get('invoiceDate');
    if (get('buyer')) o.buyer = get('buyer');
    if (get('note')) o.note = get('note');
    // 行程字段（火车票已预填，可改；打车类在此补出发/到达/出行日期）
    if (get('transportType')) o.transportType = get('transportType');
    if (get('tripDate')) o.tripDate = get('tripDate');
    if (get('fromStation')) o.fromStation = get('fromStation');
    if (get('toStation')) o.toStation = get('toStation');
    if (get('routeLegs')) o.legs = parseRouteLegs(get('routeLegs'));
    // 手动 PDF
    const pdfPath = get('pdfPath');
    if (pdfPath && fs.existsSync(pdfPath)) {
      const buyer = safe(get('buyer') || '待确认购买方');
      const seller = safe(get('seller') || '待确认销售方');
      const targetDir = path.join(ARCHIVE_DIR, buyer, seller);
      fs.mkdirSync(targetDir, { recursive: true });
      const target = uniquePath(path.join(targetDir, path.basename(pdfPath)));
      fs.copyFileSync(pdfPath, target);
      o.archivePath = path.relative(ROOT, target);
      copied++;
      console.log(`📎 已复制手动 PDF: ${emailUid} → ${o.archivePath}`);
    }
    items.push(o);
  }

  if (!items.length) { console.log('ℹ️ 清单中没有可应用的填写行（emailUid 为空或全部空白）。'); return; }

  // 持久化 overrides
  const ovFile = path.join(SCAN_DIR, `invoice-overrides-${dateTag}.json`);
  fs.writeFileSync(ovFile, JSON.stringify({ generatedAt: new Date().toISOString(), dateTag, items }, null, 2), 'utf8');
  console.log(`✅ 已写入覆盖文件: ${ovFile}（${items.length} 条，重跑不丢）`);

  // 重跑下游：台账 / 报销单 / 规范表 / 看板 / E盘导出
  const childEnv = Object.assign({}, process.env);
  delete childEnv.CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR;
  delete childEnv.CODEBUDDY_TOOL_CALL_ID;
  const steps = [
    ['台账Excel', 'step5-generate-ledger.js', [dateTag]],
    ['报销单Excel', 'step6-generate-reimbursement.js', [dateTag]],
    ['规范中间表', 'build-invoice-table.js', [dateTag]],
    ['看板', 'generate-dashboard.js', [dateTag]],
    ['E盘导出', 'export-to-edrive.js', []],
  ];
  for (const [label, script, a] of steps) {
    console.log(`\n[${label}] node ${script} ${a.join(' ')}`);
    const res = spawnSync(process.execPath, [path.join(ROOT, script), ...a], { cwd: ROOT, stdio: 'inherit', env: childEnv });
    if (res.status !== 0) console.error(`⚠️ ${label} 退出码 ${res.status}`);
  }
  console.log(`\n✅ 填写应用完成：覆盖 ${items.length} 条，复制 PDF ${copied} 个。台账/报销单/看板/E盘包已刷新。`);
}

// ---------- main ----------
const dateTag = resolveDateTag();
if (INIT_MODE) initCsv(dateTag);
else applyCsv(dateTag);
