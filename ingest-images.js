#!/usr/bin/env node
/**
 * ingest-images.js — 图片 intake 入口（开源可用性的第三种入口，与 ingest-folder.js 并列）
 *
 * 用途：当用户手里有发票【图片/照片】（非 PDF、无 IMAP 邮箱）时，由调用方 AI（多模态）
 *       先用视觉把每张发票抽成结构化记录，写成一份 JSON；本脚本把这份 JSON 转成流水线
 *       的中间产物（emails / classified / downloads / pdf-text），使 step4..step11 原样跑。
 *
 * 关键前提（方案A）：本脚本【不做】OCR，只做「已抽取记录 → 中间产物」的转换。
 *       视觉识别由 agent 完成；agent 把抽取结果写到 extracted-invoices.json 后交给我们。
 *
 * 用法：
 *   node ingest-images.js <extracted.json 路径 | 含 extracted-invoices.json 的文件夹> [dateTag]
 *
 * 输入 JSON 形状（顶层数组，或 {invoices|data|records:[...]}）：
 *   [{
 *     "invoice_code": "044001800XXX",
 *     "invoice_number": "12345678",
 *     "invoice_date": "2026-06-15",
 *     "invoice_type": "增值税普通发票",      // 专票/普票/火车票机票行程单/...
 *     "category": "餐饮",                     // 可选（step4b 会重算）
 *     "amount": 368,                          // 不含税（可选）
 *     "tax_amount": 0,                        // 税额（可选）
 *     "total_amount": 368,                    // 价税合计（作为金额，必填）
 *     "seller_name": "某某餐厅",
 *     "buyer_name": "购买方名称",
 *     "items": "...",                         // 货物明细（可选）
 *     "image_path": "C:/.../发票.jpg",        // 原图路径（可选，归档用）
 *     "notes": "..."                          // 可选
 *   }]
 *
 * 限制（v1，与 folder 模式一致）：一个图片 = 一条记录；不支持「发票+行程单同图自动合并」。
 */
const fs = require('fs');
const path = require('path');
const { buildImageIntake } = require('./lib/ingest-images');

const arg = process.argv[2];
const dateTag = process.argv[3] || ('local-images-' + new Date().toISOString().slice(0, 10).replace(/-/g, ''));

if (!arg) {
  console.error('用法: node ingest-images.js <extracted.json 或 含 extracted-invoices.json 的文件夹> [dateTag]');
  process.exit(1);
}
// Git Bash 下 $PWD 形如 /c/Users/...，Windows 版 Node 会误解析；归一化为 c:/Users/...
let rawArg = arg;
if (process.platform === 'win32' && /^\/[a-zA-Z]\//.test(rawArg)) {
  rawArg = rawArg.replace(/^\/([a-zA-Z])\//, '$1:/');
}
const abs = path.resolve(rawArg);

let jsonPath;
if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
  const cand = path.join(abs, 'extracted-invoices.json');
  if (!fs.existsSync(cand)) {
    console.error('文件夹模式下需包含 extracted-invoices.json: ' + cand);
    process.exit(1);
  }
  jsonPath = cand;
} else {
  jsonPath = abs;
}
if (!fs.existsSync(jsonPath)) {
  console.error('文件不存在: ' + jsonPath);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (e) {
  console.error('JSON 解析失败: ' + e.message);
  process.exit(1);
}
const arr = Array.isArray(parsed) ? parsed : (parsed.invoices || parsed.data || parsed.records);
if (!Array.isArray(arr)) {
  console.error('JSON 顶层应为数组，或含 {invoices|data|records:[...]}');
  process.exit(1);
}

const threshold = Number(process.env.VISION_CONFIDENCE_THRESHOLD || 0.85);
const { emailsOut, classifiedOut, downloadOut, pdfTextOut, visionReviewOut, count } = buildImageIntake(arr, { dateTag, threshold });

const root = __dirname;
const scanDir = path.join(root, 'scan-results');
fs.mkdirSync(path.join(scanDir, 'emails'), { recursive: true });
fs.mkdirSync(path.join(scanDir, 'classified'), { recursive: true });
fs.mkdirSync(path.join(scanDir, 'downloads'), { recursive: true });
// 空 staging 目录：满足 run-all 产物校验（图片模式无 PDF 可复制）
fs.mkdirSync(path.join(scanDir, 'staging', dateTag, 'pdfs'), { recursive: true });

fs.writeFileSync(path.join(scanDir, 'emails', `emails-${dateTag}.json`), JSON.stringify(emailsOut, null, 2), 'utf8');
fs.writeFileSync(path.join(scanDir, 'classified', `classified-${dateTag}.json`), JSON.stringify(classifiedOut, null, 2), 'utf8');
fs.writeFileSync(path.join(scanDir, 'downloads', `download-results-${dateTag}.json`), JSON.stringify(downloadOut, null, 2), 'utf8');
fs.writeFileSync(path.join(scanDir, `pdf-text-${dateTag}.json`), JSON.stringify(pdfTextOut, null, 2), 'utf8');
fs.writeFileSync(path.join(scanDir, `vision-review-${dateTag}.json`), JSON.stringify(visionReviewOut, null, 2), 'utf8');

console.log(`✅ 图片 intake 合成记录已生成: ${count} 张发票, dateTag=${dateTag}`);
console.log(`   视觉复核: ${visionReviewOut.meta.manualReview}/${visionReviewOut.meta.total} 条需要人工确认`);
console.log('   下一步: 直接跑 step4..step11，或用 `npm run run -- --images "<路径>"` 一键串联');
