#!/usr/bin/env node
/**
 * build-invoice-table.js — 规范中间表 v1.0
 *
 * 读取已 enrich 的 invoice-final + archive/manifest.json + pdf-text，
 * 产出 scan-results/invoice-table-{dateTag}.json，作为下游（看板/报销包/
 * 出纳导出）统一读取的「规范中间表」。
 *
 * 相对 invoice-final 新增/修正：
 *   - invoiceId      稳定哈希主键（同发票内容→同 id，用于去重）
 *   - archivePath    指向 archive/ 稳定位置（修复 invoice-final 的 pdfFilepath:null）
 *   - flatPath       指向 本轮全部PDF 扁平副本
 *   - amount         统一为数字
 *   - amountRaw      { pdf, filename, recorded } 三种来源原始值（修复金额口径混乱）
 *   - provenance     抽取方法 / 来源 / 时间
 *   - 保留 invoice-final 全部原字段（step5/step6 等上游步骤继续读 invoice-final，零改动）
 *
 * 用法：node build-invoice-table.js [dateTag]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { scanArchive, resolveArchive } = require('./lib/archive-resolver');

const ROOT = __dirname;
const SCAN_DIR = path.join(ROOT, 'scan-results');
const ARCHIVE_DIR = path.join(ROOT, 'archive');

const args = process.argv.slice(2);
const dateTag = args[0] || '';

function findLatest(dir, prefix) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .filter(f => !dateTag || f.includes(dateTag))
    .sort().reverse();
  return files[0] || null;
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function filenameAmount(fn) {
  if (!fn) return null;
  const m = fn.match(/(?:^|[^\d])(\d{1,6}\.\d{2})\.pdf$/i) || fn.match(/(\d{1,6}\.\d{2})/);
  return m ? Number(m[1]) : null;
}

// 同发票内容 → 同 id；无发票号时退化为「销售方+金额+日期+邮件uid」保证稳定不碰撞
function buildId(r) {
  const core = [
    r.invoiceNo || '',
    r.seller || '',
    r.amount != null ? String(r.amount) : '',
    r.invoiceDate || '',
  ].join('|');
  const tie = r.invoiceNo ? '' : `|${r.emailUid || ''}`;
  return crypto.createHash('sha1').update(core + tie).digest('hex').slice(0, 16);
}

function main() {
  const finalFile = findLatest(SCAN_DIR, 'invoice-final-');
  if (!finalFile) { console.error('❌ 未找到 invoice-final-*.json，请先跑 step4-merge'); process.exit(1); }
  const finalData = JSON.parse(fs.readFileSync(path.join(SCAN_DIR, finalFile), 'utf8'));
  const { applyOverrides } = require('./lib/apply-overrides');
  applyOverrides(finalData.data, finalData.meta?.dateTag || dateTag ||
    path.basename(finalFile).replace(/invoice-final-/, '').replace(/\.json$/, ''));
  const tag = finalData.meta?.dateTag || dateTag ||
    path.basename(finalFile).replace(/invoice-final-/, '').replace(/\.json$/, '');

  // pdf-text：用于 amountRaw（pdf 抽取值 / 文件名值）
  const pdfFile = findLatest(SCAN_DIR, 'pdf-text-');
  const pdfData = pdfFile ? JSON.parse(fs.readFileSync(path.join(SCAN_DIR, pdfFile), 'utf8')) : { results: [] };
  const pdfByFile = {};
  const pdfByUid = {};
  for (const r of pdfData.results || []) {
    if (r.filename) pdfByFile[r.filename] = r;
    const um = r.filename && (r.filename.match(/^uid(\d+)_/) || r.filename.match(/^(\d+)_/));
    if (um) pdfByUid[um[1]] = r;
  }

  // 扫描 archive/ 实际文件构建索引；明确排除扁平目录，避免重复候选。
  const ALL_PDF_DIR = path.join(ARCHIVE_DIR, '本轮全部PDF');
  const archiveIdx = scanArchive(ARCHIVE_DIR, '本轮全部PDF');
  const flatIdx = scanArchive(ALL_PDF_DIR);

  const records = (finalData.data || []).map(r => {
    const pdf = (r.pdfFilename && pdfByFile[r.pdfFilename]) ||
      (r.emailUid && pdfByUid[String(r.emailUid)]) || null;
    const archFile = resolveArchive(r, archiveIdx);
    const flatFile = resolveArchive(r, flatIdx);
    return {
      ...r,
      invoiceId: buildId(r),
      amount: num(r.amount),
      amountRaw: {
        pdf: pdf ? num(pdf.amount) : null,
        filename: pdf ? filenameAmount(pdf.filename) : null,
        recorded: num(r.amount),
      },
      provenance: {
        amountSource: r.amountSource || null,
        buyerSource: r.buyerSource || null,
        extractionMethod: pdf ? (pdf._extracted || null) : null,
        extractedAt: pdf ? (pdf.extractedAt || null) : null,
      },
      archivePath: archFile ? path.relative(ROOT, archFile) : (r.archivePath || null),
      flatPath: flatFile ? path.relative(ROOT, flatFile) : null,
      canonicalAt: new Date().toISOString(),
    };
  });

  const uniqueIds = new Set(records.map(r => r.invoiceId));
  const out = {
    meta: {
      schemaVersion: 1.1,
      dateTag: tag,
      sourceFinal: path.relative(ROOT, path.join(SCAN_DIR, finalFile)),
      generatedAt: new Date().toISOString(),
      total: records.length,
      uniqueByInvoiceId: uniqueIds.size,
      withArchive: records.filter(r => r.archivePath).length,
    },
    data: records,
  };

  const outFile = path.join(SCAN_DIR, `invoice-table-${tag}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');
  console.log(`✅ 规范中间表已生成: ${outFile}`);
  console.log(`   记录 ${records.length} 条 | 唯一发票Id ${out.meta.uniqueByInvoiceId} | 已解析归档路径 ${out.meta.withArchive}`);
}

main();
