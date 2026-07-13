'use strict';
/**
 * 集成测试（Prove-It）：直接驱动 step4-merge-data.js CLI，复现两个真 bug：
 *   bug1: 普票税额为 0 时被 `|| null` 吞掉 → taxAmount 应为 0，而非 null
 *   bug2: exTaxAmount 在 PDF 金额定稿前就算 → 应为 200，而非 null
 * 修复前：taxAmount=null / exTaxAmount=null（测试失败）
 * 修复后：taxAmount=0 / exTaxAmount=200（测试通过）
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const STEP4 = path.join(ROOT, 'step4-merge-data.js');
const SCAN = path.join(ROOT, 'scan-results');
const TAG = 'regtest-' + Date.now() + '-' + Math.floor(Math.random() * 1e4);

function writeInput() {
  fs.mkdirSync(path.join(SCAN, 'emails'), { recursive: true });
  const emailFile = path.join(SCAN, 'emails', `emails-${TAG}.json`);
  const pdfFile = path.join(SCAN, `pdf-text-${TAG}.json`);

  const emails = {
    meta: { dateTag: TAG, startDate: '2026-01-01', endDate: '2026-01-02' },
    emails: [
      {
        uid: 1,
        subject: '测试普票',
        from: 'noreply@example.com',
        date: '2026-01-01',
        status: 'done',
        attachments: [{ type: 'pdf', filename: 'uid1_inv.pdf' }],
        bodyInfo: null,
        links: [],
      },
    ],
  };
  const pdf = {
    results: [
      {
        filename: 'uid1_inv.pdf',
        amount: 200,
        taxAmount: 0,        // 普票，税额为 0 —— 必须保留，不能被 || null 吞掉
        invoiceType: '普票',
        buyer: '某某科技有限公司',
        seller: '某服务有限公司',
        invoiceNo: 'X001',
        date: '2026-01-01',
        docType: '发票',
        fullText: '价税合计200',
      },
    ],
  };
  fs.writeFileSync(emailFile, JSON.stringify(emails));
  fs.writeFileSync(pdfFile, JSON.stringify(pdf));
  return { emailFile, pdfFile };
}

function cleanup(inputs) {
  const files = [
    inputs && inputs.emailFile,
    inputs && inputs.pdfFile,
    path.join(SCAN, `invoice-final-${TAG}.json`),
    path.join(SCAN, `invoice-final-${TAG}.csv`),
    path.join(SCAN, `manual-tasks-${TAG}.csv`),
  ].filter(Boolean);
  for (const f of files) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) { /* ignore */ }
  }
}

test('step4 普票税额0保留 + exTax在金额定稿后计算', () => {
  const inputs = writeInput();
  try {
    execFileSync(process.execPath, [STEP4, TAG], { cwd: ROOT, stdio: 'pipe' });
    const out = JSON.parse(fs.readFileSync(path.join(SCAN, `invoice-final-${TAG}.json`), 'utf8'));
    const rec = out.data[0];

    assert.strictEqual(rec.amount, 200, '金额应从 PDF 取 200');
    assert.strictEqual(rec.taxAmount, 0, '普票税额0必须保留，不能被 || null 吞成 null');
    assert.strictEqual(rec.exTaxAmount, 200, '不含税金额应在金额定稿后算：200-0=200');
    assert.strictEqual(rec.needsManualReview, false, '金额+买方齐全不应进人工');
    assert.ok(rec.buyer, '买方应从 PDF 提取');
  } finally {
    cleanup(inputs);
  }
});
