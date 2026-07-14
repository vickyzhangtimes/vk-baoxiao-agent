#!/usr/bin/env node
/**
 * export-to-edrive.js —— 把一次报销的「一条龙」文件导出到 E 盘报销目录。
 *
 * 设计目标（双角色视角）：
 *   - 报销人视角：能交、能贴票、能跟进（报销单 / 清单 / 待补齐项 / 发票原件）
 *   - 出纳视角：能核算、能合规、能对账（费用类别汇总 / 付款凭证 / 记账凭证摘要）
 *
 * 目录结构（一次报销 = 一个批次日期文件夹）：
 *   E:\报销\<BATCH_DATE>_<PERIOD_LABEL>\
 *     ├── 00_说明.txt
 *     ├── 01_发票原件\<购买方>\<去重后的唯一PDF>
 *     ├── 02_报销人视角\  报销单.html / 报销单.md / 报销清单.md / 待补齐项.md
 *     ├── 03_出纳视角\    费用类别汇总.xlsx / 付款凭证模板.html / 记账凭证摘要.txt
 *     ├── 04_总览看板.html
 *     └── 05_原始数据\    invoice-final.json / download-results.json
 *
 * 可通过环境变量配置（不写死，方便以后复用）：
 *   REIMBURSE_ROOT  报销根目录。默认 ~/报销（用户主目录下「报销」文件夹），可用 REIMBURSE_ROOT 环境变量覆盖为任意路径。
 *   BATCH_DATE      批次日期，默认今天
 *   PERIOD_LABEL    期间说明，默认「报销批次」
 *
 * 身份/账户占位字段（报销人/部门/购买方/审批人/出纳/收付款账户）统一由
 * config/package-config.js 驱动（见 lib/load-package-config.js）；环境变量优先级最高。
 * 复制 config/package-config.example.js 为 package-config.js 填入真实值（真实文件已被 .gitignore 忽略）。
 */

const fs = require('fs');
const path = require('path');
const { isInvoiceRecord, formatRoute } = require('./lib/record-utils');
const os = require('os');
const { safeCleanDir } = require('./lib/safe-clean');
const { loadPackageConfig } = require('./lib/load-package-config');
const { assertSafeChild, safeSegment } = require('./lib/path-guard');

const SKILL = __dirname;
const REIMBURSE_ROOT = process.env.REIMBURSE_ROOT || path.join(os.homedir(), '报销');
const BATCH_DATE = safeSegment(process.env.BATCH_DATE || new Date().toISOString().slice(0, 10), 'BATCH_DATE');
const PERIOD_LABEL = safeSegment(process.env.PERIOD_LABEL || '报销批次', 'PERIOD_LABEL');

// 占位字段：配置 > 环境变量 > package-config.js > 占位默认值（见 lib/load-package-config.js）
const F = loadPackageConfig();

const dateTag = (() => {
  // 显式参数优先（文件夹模式 dateTag 如 local-20260712 不匹配旧正则，必须由调用方传入）
  const argTag = process.argv[2];
  if (argTag) {
    const p1 = path.join(SKILL, 'scan-results', `invoice-table-${argTag}.json`);
    const p2 = path.join(SKILL, 'scan-results', `invoice-final-${argTag}.json`);
    if (fs.existsSync(p1) || fs.existsSync(p2)) return argTag;
  }
  // 兜底：找最新的规范中间表 / invoice-final 文件，取日期标签（优先 invoice-table）
  // 只认 \d{8}-\d{8} 日期格式，排除 local-test / local-xxx 等测试标签，避免误选
  const dir = path.join(SKILL, 'scan-results');
  const tableCand = fs.readdirSync(dir).filter((f) => /^invoice-table-\d{8}-\d{8}\.json$/.test(f)).sort();
  const finalCand = fs.readdirSync(dir).filter((f) => /^invoice-final-\d{8}-\d{8}\.json$/.test(f)).sort();
  const chosen = tableCand.length ? tableCand : finalCand;
  if (!chosen.length) {
    console.error('未找到 invoice-table / invoice-final-*.json');
    process.exit(1);
  }
  return chosen[chosen.length - 1]
    .replace(/^invoice-table-/, '')
    .replace(/^invoice-final-/, '')
    .replace(/\.json$/, '');
})();

// 规范中间表优先；不存在时回退 invoice-final（字段兼容）
const tablePath = path.join(SKILL, 'scan-results', `invoice-table-${dateTag}.json`);
const finalPath = fs.existsSync(tablePath)
  ? tablePath
  : path.join(SKILL, 'scan-results', `invoice-final-${dateTag}.json`);
const SOURCE_NAME = path.basename(finalPath);
const finalData = JSON.parse(fs.readFileSync(finalPath, 'utf8'));
const records = Array.isArray(finalData.data) ? finalData.data : [];
const invoiceRecords = records.filter(isInvoiceRecord);
const supportingRecords = records.filter(r => !isInvoiceRecord(r));

// ---------- 1. 建目录树 ----------
const outRoot = assertSafeChild(REIMBURSE_ROOT, path.join(REIMBURSE_ROOT, `${BATCH_DATE}_${PERIOD_LABEL}`), '报销包目录');
// 幂等：先清空旧报销包（安全走回收站），再重建，保证每次都是一份干净交付物
safeCleanDir(outRoot, { allowedRoot: REIMBURSE_ROOT });
const dirs = {
  root: outRoot,
  originals: path.join(outRoot, '01_发票原件'),
  claimer: path.join(outRoot, '02_报销人视角'),
  cashier: path.join(outRoot, '03_出纳视角'),
  raw: path.join(outRoot, '05_原始数据'),
};
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

// ---------- 2. 复制本批次 PDF 到 01_发票原件\<费用类别>\ ----------
// 严格按本批次记录（records）的 archivePath 复制，避免把 archive/ 里其它批次的 PDF 混进来。
// 仅含本批次已成功归档（archivePath 存在）的发票；未下载/链接型进「待补齐项」。
const CATEGORY_ORDER = ['餐饮招待', '差旅交通', '住宿', '通讯费', '员工福利', '其他', '未分类', '待分类'];
const catBuckets = {};
for (const r of invoiceRecords) {
  if (!r.archivePath || !fs.existsSync(r.archivePath)) continue;
  const cat = r.category || '待分类';
  catBuckets[cat] = catBuckets[cat] || [];
  catBuckets[cat].push({ file: r.archivePath, name: path.basename(r.archivePath), rec: r });
}
const sortedCats = Object.keys(catBuckets).sort((a, b) => {
  const ia = Math.max(0, CATEGORY_ORDER.indexOf(a));
  const ib = Math.max(0, CATEGORY_ORDER.indexOf(b));
  return ia - ib;
});
let pdfIdx = 0;
for (const cat of sortedCats) {
  const sub = path.join(dirs.originals, cat);
  fs.mkdirSync(sub, { recursive: true });
  for (const u of catBuckets[cat]) {
    const noTail = u.rec.invoiceNo ? String(u.rec.invoiceNo).slice(-4) : (u.rec.emailUid != null ? 'u' + u.rec.emailUid : '0000');
    const amt = u.rec.amount ? Number(u.rec.amount).toFixed(2) : '0.00';
    const seller = String(u.rec.seller || '').replace(/（.*?）有限公司?/g, '').slice(0, 12) || '未知';
    const newName = `${String(pdfIdx + 1).padStart(2, '0')}_${amt}_${seller}_${noTail}.pdf`;
    try {
      fs.copyFileSync(u.file, path.join(sub, newName));
    } catch (e) { console.warn('[copy] 跳过缺失PDF:', u.name, e.message); }
    pdfIdx++;
  }
}

// ---------- 3. 统计 ----------
const fmt = (n) => (Number(n) || 0).toFixed(2);
let validCount = 0, validTotal = 0, pendingCount = 0;
const byCategory = {};
for (const r of invoiceRecords) {
  if (r.needsManualReview) { pendingCount++; continue; }
  const amt = Number(r.amount) || 0;
  if (amt === 0) { pendingCount++; continue; }
  validCount++; validTotal += amt;
  const c = r.category || '未分类';
  byCategory[c] = (byCategory[c] || 0) + amt;
}
const downloadedCount = pdfIdx;

// ---------- 4. 报销人视角 ----------
const claimMd = [
  `# 报销单 · ${BATCH_DATE}（${PERIOD_LABEL}）`,
  '',
  `- 报销人：${F.claimer}`,
  `- 购买方：${F.buyerName}（税号：${F.buyerTax}）`,
  `- 报销总额：¥${fmt(validTotal)}（已识别 ${validCount} 张，待处理 ${pendingCount} 张）`,
  `- 已下载发票原件：${downloadedCount} 张（见 01_发票原件\\）`,
  '',
  '## 报销明细',
  '',
  '| # | 销售方 | 金额(¥) | 类别 | 发票号 | 发票日期 | 交通方式 | 出行日期 | 行程(出发 → 到达) | 状态 |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...invoiceRecords.map((r, i) => {
    const amt = Number(r.amount) || 0;
    const st = r.needsManualReview || amt === 0 ? '⚠️待处理' : '✅已识别';
    const trip = formatRoute(r, ' | ') || '-';
    return `| ${i + 1} | ${r.seller || '-'} | ${fmt(amt)} | ${r.category || '未分类'} | ${r.invoiceNo || '-'} | ${r.invoiceDate || '-'} | ${[r.transportType, r.flightNo].filter(Boolean).join(' / ') || '-'} | ${r.tripDate || '-'} | ${trip} | ${st} |`;
  }),
  '',
  '## 签字',
  '',
  `- 报销人签字：__________    日期：__________`,
  `- 审批人签字：${F.approver}    日期：__________`,
  '',
].join('\n');
fs.writeFileSync(path.join(dirs.claimer, '报销单.md'), claimMd);

const todoMd = [
  `# 待补齐项 · ${BATCH_DATE}`,
  '',
  `以下 ${pendingCount} 张发票金额/抬头尚未识别，需人工跟进：`,
  '',
  '| # | 销售方 | 已知信息 | 来源邮件 | 跟进动作 |',
  '|---|---|---|---|---|',
  ...invoiceRecords.filter((r) => r.needsManualReview || (Number(r.amount) || 0) === 0)
    .map((r, i) => `| ${i + 1} | ${r.seller || '-'} | 金额${r.amount || '未知'} / ${r.invoiceDate || ''} | [邮件](${r.emailHyperlink || '#'}) | ${r.manualReason || '补金额/抬头'} |`),
  '',
].join('\n');
fs.writeFileSync(path.join(dirs.claimer, '待补齐项.md'), todoMd);

const summaryMd = [
  `# 报销清单 · 一页纸 · ${BATCH_DATE}（${PERIOD_LABEL}）`,
  '',
  `- 共 ${invoiceRecords.length} 张发票：已识别 ${validCount} 张（¥${fmt(validTotal)}）、待处理 ${pendingCount} 张`,
  `- 已落地 PDF 原件 ${downloadedCount} 张（含待确认 ${catBuckets['待确认'] ? catBuckets['待确认'].length : 0} 张）`,
  `- 类别分布：${Object.entries(byCategory).map(([k, v]) => `${k} ¥${fmt(v)}`).join(' / ') || '（暂无）'}`,
  `- 进度：${validCount}/${invoiceRecords.length} 已可报，剩 ${pendingCount} 张待补齐`,
  '',
  '> 详细报销单见 02_报销人视角/报销单.md；做账汇总见 03_出纳视角/费用类别汇总.xlsx',
  '',
].join('\n');
fs.writeFileSync(path.join(dirs.claimer, '报销清单.md'), summaryMd);

// 报销单 HTML（自包含，可打印）
const claimHtml = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>报销单 ${BATCH_DATE}</title>
<style>body{font-family:-apple-system,"Microsoft YaHei",sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#222}
h1{font-size:20px;border-bottom:2px solid #2b6cb0;padding-bottom:8px}
.meta{color:#555;font-size:14px;line-height:1.9}
table{border-collapse:collapse;width:100%;font-size:13px;margin:12px 0}
th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
th{background:#f0f4f8}
.sign{margin-top:24px;font-size:14px;line-height:2.2}
.ok{color:#2f855a}.warn{color:#c05621}
@media print{
  @page{size:A4;margin:14mm}
  body{max-width:none;margin:0;padding:0;color:#000;background:#fff}
  h1{border-bottom:2px solid #000}
  table{border-collapse:collapse;width:100%;font-size:12px}
  th,td{border:1px solid #000 !important;padding:5px 7px}
  th{background:#e8eef5 !important;color:#000}
  tr{page-break-inside:avoid}
  .sign{page-break-inside:avoid;margin-top:18px}
  a{color:#000;text-decoration:none}
}</style></head><body>
<h1>报销单 · ${BATCH_DATE}（${PERIOD_LABEL}）</h1>
<div class="meta">
报销人：${F.claimer}<br>购买方：${F.buyerName}（税号：${F.buyerTax}）<br>
报销总额：<b>¥${fmt(validTotal)}</b> ｜ 已识别 ${validCount} 张，待处理 ${pendingCount} 张 ｜ 已下载原件 ${downloadedCount} 张
</div>
<table><thead><tr><th>#</th><th>销售方</th><th>金额(¥)</th><th>类别</th><th>发票号</th><th>日期</th><th>交通方式</th><th>出行日期</th><th>行程(出发 → 到达)</th><th>状态</th></tr></thead><tbody>
${invoiceRecords.map((r, i) => { const amt = Number(r.amount) || 0; const st = (r.needsManualReview || amt === 0); const trip = formatRoute(r, ' | ') || '-'; return `<tr><td>${i + 1}</td><td>${r.seller || '-'}</td><td>${fmt(amt)}</td><td>${r.category || '未分类'}</td><td>${r.invoiceNo || '-'}</td><td>${r.invoiceDate || '-'}</td><td>${[r.transportType, r.flightNo].filter(Boolean).join(' / ') || '-'}</td><td>${r.tripDate || '-'}</td><td>${trip}</td><td class="${st ? 'warn' : 'ok'}">${st ? '待处理' : '已识别'}</td></tr>`; }).join('')}
</tbody></table>
<div class="sign">报销人签字：__________ 日期：__________<br>审批人签字：${F.approver} 日期：__________</div>
</body></html>`;
fs.writeFileSync(path.join(dirs.claimer, '报销单.html'), claimHtml);

// 报销单 Excel（复制 step6 生成的 v2 可打印报销单：含大写金额 / 签字栏 / 类别小计）
const claimXlsxSrc = path.join(SKILL, 'scan-results', `报销单-${dateTag}.xlsx`);
if (fs.existsSync(claimXlsxSrc)) {
  fs.copyFileSync(claimXlsxSrc, path.join(dirs.claimer, '报销单.xlsx'));
  console.log(`  ✓ 报销人视角 Excel: 报销单.xlsx (${path.basename(claimXlsxSrc)})`);
} else {
  console.warn(`  ⚠ 未找到 step6 产物 报销单-${dateTag}.xlsx，请先运行 step6-generate-reimbursement.js`);
}

// 模板报销单（若 run-all 配置了 REIMBURSEMENT_TEMPLATE=user/name[:version]）
// 与 step6 的 报销单.xlsx 并列，额外复制一份 报销单-模板.xlsx 进批次
const tplCfg = process.env.REIMBURSEMENT_TEMPLATE;
if (tplCfg && tplCfg.includes('/')) {
  const [tu, tr] = tplCfg.split('/');
  const [tn] = (tr || '').split(':');
  const tplSrc = path.join(SKILL, 'scan-results', `报销单-${tu}-${tn}-${dateTag}.xlsx`);
  if (fs.existsSync(tplSrc)) {
    fs.copyFileSync(tplSrc, path.join(dirs.claimer, '报销单-模板.xlsx'));
    console.log(`  ✓ 模板报销单 Excel: 报销单-模板.xlsx (${path.basename(tplSrc)})`);
  }
}

// ---------- 5. 出纳视角 ----------
const catRows = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
const voucherHtml = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>付款凭证 ${BATCH_DATE}</title>
<style>body{font-family:-apple-system,"Microsoft YaHei",sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#222}
h1{font-size:20px}h2{font-size:15px;color:#2b6cb0;margin-top:20px}
table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0}
th,td{border:1px solid #999;padding:6px 8px}
.box{border:1px dashed #999;padding:12px;margin:8px 0;font-size:13px;line-height:1.9}
.ph{color:#c05621}</style></head><body>
<h1>付款凭证 · ${BATCH_DATE}（${PERIOD_LABEL}）</h1>
<div class="box">付款方（单位）：${F.buyerName} ｜ 账户：${F.payerBank}<br>
收款人：${F.claimer} ｜ 账户：${F.payeeBank}<br>
报销金额（合计）：<b>¥${fmt(validTotal)}</b> ｜ 笔数：${validCount}</div>
<h2>审批与付款</h2>
<table><tr><th>报销人</th><td>${F.claimer}</td><th>审批人</th><td>${F.approver}</td></tr>
<tr><th>出纳</th><td>${F.cashier}</td><th>付款日期</th><td class="ph">{{YYYY-MM-DD}}</td></tr>
<tr><th>付款方式</th><td class="ph">{{银行转账/现金}}</td><th>银行回单</th><td class="ph">{{粘贴回单}}</td></tr></table>
<h2>费用类别汇总（做账用）</h2>
<table><thead><tr><th>费用类别</th><th>金额(¥)</th><th>笔数</th></tr></thead><tbody>
${catRows.map(([c, v]) => `<tr><td>${c}</td><td>${fmt(v)}</td><td>${invoiceRecords.filter((r) => (r.category || '未分类') === c && !r.needsManualReview && (Number(r.amount) || 0) > 0).length}</td></tr>`).join('')}
<tr><th>合计</th><th>¥${fmt(validTotal)}</th><th>${validCount}</th></tr>
</tbody></table>
<p style="color:#777;font-size:12px">注：待处理 ${pendingCount} 张未计入合计，补齐后另行入账。</p>
</body></html>`;
fs.writeFileSync(path.join(dirs.cashier, '付款凭证模板.html'), voucherHtml);

const certTxt = [
  `记账凭证摘要 · ${BATCH_DATE}（${PERIOD_LABEL}）`,
  `========================================`,
  `报销人：${F.claimer}`,
  `购买方：${F.buyerName}`,
  `报销总额：¥${fmt(validTotal)}（${validCount} 张，不含待处理 ${pendingCount} 张）`,
  ``,
  `建议分录（仅供参考，以实际为准）：`,
  `  借：管理费用—业务招待费   ¥${fmt(byCategory['餐饮招待'] || 0)}`,
  `      管理费用—差旅费       ¥${fmt(byCategory['差旅交通'] || 0)}`,
  `      管理费用—办公费       ¥${fmt(byCategory['办公'] || 0)}`,
  `      其他应收款—待处理     ¥0.00（${pendingCount} 张补齐后入账）`,
  `  贷：银行存款—${F.buyerName}`,
  ``,
  `类别小计：` + (catRows.length ? catRows.map(([c, v]) => `${c} ¥${fmt(v)}`).join(' / ') : '（暂无已识别金额）'),
  ``,
].join('\n');
fs.writeFileSync(path.join(dirs.cashier, '记账凭证摘要.txt'), certTxt);

// 发票合规检查清单（每张发票的合规状态一目了然）
const complianceRows = invoiceRecords.map((r, i) => {
  const amt = Number(r.amount) || 0;
  const hasSeller = !!r.seller;
  const hasNo = !!r.invoiceNo;
  const hasDate = !!r.invoiceDate;
  const hasAmt = amt > 0;
  const isPending = r.needsManualReview || amt === 0;
  const issues = [];
  if (!hasSeller) issues.push('缺销售方');
  if (!hasNo) issues.push('缺发票号');
  if (!hasDate) issues.push('缺开票日期');
  if (!hasAmt && !isPending) issues.push('金额为0');
  if ((r.category || '') === '其他' && amt > 1000) issues.push('大额「其他」建议重分类');
  const okCount = [hasSeller, hasNo, hasDate, hasAmt].filter(Boolean).length;
  return { idx: i + 1, r, hasSeller, hasNo, hasDate, hasAmt, isPending, issues, okCount };
});
const complianceHtml = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>发票合规检查 ${BATCH_DATE}</title>
<style>body{font-family:-apple-system,"Microsoft YaHei",sans-serif;max-width:960px;margin:20px auto;padding:0 16px;color:#222}
h1{font-size:18px;border-bottom:2px solid #1F3864;padding-bottom:6px}
.summary{display:flex;gap:12px;margin:14px 0}.scard{flex:1;border:1px solid #ddd;border-radius:8px;padding:10px;text-align:center}
.scard .n{font-size:22px;font-weight:700}.scard .n.ok{color:#2f855a}.scard .n.warn{color:#c05621}.scard .n.bad{color:#e53e3e}
.scard .l{font-size:12px;color:#666}
table{border-collapse:collapse;width:100%;font-size:12px;margin:10px 0}
th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}
th{background:#f0f4f8;font-weight:600;position:sticky;top:0}
.pass{color:#2f855a;font-weight:600}.fail{color:#e53e3e;font-weight:600}.warn{color:#c05621}
tr:hover{background:#f8f9fa}</style></head><body>
<h1>发票合规检查清单 · ${BATCH_DATE}</h1>
<div class="summary">
<div class="scard"><div class="n ok">${complianceRows.filter(r=>r.okCount===4).length}</div><div class="l">完全合规</div></div>
<div class="scard"><div class="n warn">${complianceRows.filter(r=>r.okCount>=2&&r.okCount<4).length}</div><div class="l">部分缺失</div></div>
<div class="scard"><div class="n bad">${complianceRows.filter(r=>r.isPending).length}</div><div class="l">待处理</div></div>
<div class="scard"><div class="n">${invoiceRecords.length}</div><div class="l">发票总数</div></div>
</div>
<table><thead><tr><th>#</th><th>销售方</th><th>金额(¥)</th><th>抬头✓</th><th>发票号✓</th><th>日期✓</th><th>金额✓</th><th>类别</th><th>问题/提示</th></tr></thead><tbody>
${complianceRows.map(c => `<tr>
<td>${c.idx}</td>
<td>${c.r.seller || '<span class=warn>-</span>'}</td>
<td>${fmt(Number(c.r.amount)||0)}</td>
<td class="${c.hasSeller?'pass':'fail'}">${c.hasSeller?'✓':'✗'}</td>
<td class="${c.hasNo?'pass':'fail'}">${c.hasNo?'✓':'✗'}</td>
<td class="${c.hasDate?'pass':'fail'}">${c.hasDate?'✓':'✗'}</td>
<td class="${c.hasAmt?'pass':(c.isPending?'warn':'fail')}">${c.hasAmt?'✓':(c.isPending?'待确认':'✗')}</td>
<td>${c.r.category||'-'}</td>
<td class="${c.issues.length?'warn':''}">${c.issues.length?c.issues.join('; '):(c.isPending?'需人工处理':'—')}</td>
</tr>`).join('')}
</tbody></table>
<p style="color:#999;font-size:11px;margin-top:12px">自动生成 · ${new Date().toLocaleString('zh-CN')} · 检查项：销售方完整、发票号存在、开票日期存在、金额大于0</p>
</body></html>`;
fs.writeFileSync(path.join(dirs.cashier, '发票合规检查清单.html'), complianceHtml);

// 附件完整性核对（明细数 vs PDF原件数 勾稽）
const pdfFileCount = pdfIdx;
const validRecCount = validCount;
const pendingPdfCount = catBuckets['待确认'] ? catBuckets['待确认'].length : 0;
const attachmentMd = [
  `# 附件完整性核对 · ${BATCH_DATE}`,
  '',
  '| 核对项目 | 数量 | 说明 |',
  '|---|---|---|',
  `| 报销单明细（已识别） | ${validRecCount} 张 | 金额合计 ¥${fmt(validTotal)} |`,
  `| 待处理明细 | ${pendingCount} 张 | 不计入报销单，补齐后入账 |`,
  `| 已下载PDF原件 | ${pdfFileCount} 张 | 落地于 01_发票原件\\ |`,
  `| 待确认抬头PDF | ${pendingPdfCount} 张 | 在 01_发票原件\\待分类\\ 中 |`,
  '',
  '## 勾稽检查',
  '',
  `- 发票明细数 (${invoiceRecords.length}) = 已识别(${validRecCount}) + 待处理(${pendingCount}): ${(invoiceRecords.length === validRecCount + pendingCount)?'✅ 一致':'⚠️ 不一致'}`,
  `- PDF原件数(${pdfFileCount}) >= 发票数(${invoiceRecords.length}): ${pdfFileCount >= invoiceRecords.length?'✅ 充足':'⚠️ PDF不足'}`,
  '',
  '## 出纳操作清单',
  '',
  '1. 逐张核对报销单明细与 01_发票原件\\ 对应关系',
  '2. 检查每张发票抬头是否为购买方全称',
  '3. 大额发票(>5000元)重点复核业务真实性',
  '4. 「其他」类别占比过高时要求报销人补充说明',
  '5. 确认无误后付款，保留此包归档',
  '',
].join('\n');
fs.writeFileSync(path.join(dirs.cashier, '附件完整性核对.md'), attachmentMd);

// 费用类别汇总 xlsx（用 exceljs，若不可用则退化为 csv）
async function writeCategoryXlsx() {
  const rows = catRows.map(([c, v]) => ({
    category: c,
    amount: Number(v.toFixed(2)),
    count: records.filter((r) => (r.category || '未分类') === c && !r.needsManualReview && (Number(r.amount) || 0) > 0).length,
  }));
  rows.push({ category: '合计', amount: Number(validTotal.toFixed(2)), count: validCount });
  try {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('费用类别汇总');
    ws.columns = [
      { header: '费用类别', key: 'category', width: 20 },
      { header: '金额(¥)', key: 'amount', width: 14 },
      { header: '笔数', key: 'count', width: 10 },
    ];
    ws.addRows(rows);
    ws.getRow(1).font = { bold: true };
    await wb.xlsx.writeFile(path.join(dirs.cashier, '费用类别汇总.xlsx'));
  } catch (e) {
    const csv = ['费用类别,金额(¥),笔数', ...rows.map((r) => `${r.category},${r.amount},${r.count}`)].join('\n');
    fs.writeFileSync(path.join(dirs.cashier, '费用类别汇总.csv'), csv);
    console.warn('[xlsx] exceljs 不可用，已退化为 csv:', e.message);
  }
}

// ---------- 6. 总览看板（迷你自包含 HTML）----------
const dashHtml = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>报销总览 ${BATCH_DATE}</title>
<style>body{font-family:-apple-system,"Microsoft YaHei",sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#222}
h1{font-size:20px}.cards{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
.card{flex:1;min-width:150px;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center}
.card .n{font-size:26px;font-weight:700;color:#2b6cb0}.card .l{color:#666;font-size:13px}
.bar{height:22px;border-radius:4px;background:#2b6cb0;color:#fff;font-size:12px;line-height:22px;padding-left:6px;margin:4px 0}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:12px}
th,td{border:1px solid #ccc;padding:6px 8px}</style></head><body>
<h1>报销总览 · ${BATCH_DATE}（${PERIOD_LABEL}）</h1>
<div class="cards">
<div class="card"><div class="n">${invoiceRecords.length}</div><div class="l">发票总数</div></div>
<div class="card"><div class="n">${validCount}</div><div class="l">已识别</div></div>
<div class="card"><div class="n">${pendingCount}</div><div class="l">待处理</div></div>
<div class="card"><div class="n">${downloadedCount}</div><div class="l">已下载PDF</div></div>
<div class="card"><div class="n">¥${fmt(validTotal)}</div><div class="l">可报总额</div></div>
</div>
<h2 style="font-size:15px;color:#2b6cb0">费用类别分布</h2>
${catRows.length ? catRows.map(([c, v]) => `<div class="bar" style="width:${Math.max(12, (v / validTotal) * 100)}%">${c} ¥${fmt(v)}</div>`).join('') : '<p>暂无已识别金额</p>'}
<h2 style="font-size:15px;color:#2b6cb0">发票明细</h2>
<table><thead><tr><th>#</th><th>销售方</th><th>金额</th><th>类别</th><th>状态</th></tr></thead><tbody>
${invoiceRecords.map((r, i) => { const amt = Number(r.amount) || 0; const st = r.needsManualReview || amt === 0; return `<tr><td>${i + 1}</td><td>${r.seller || '-'}</td><td>${fmt(amt)}</td><td>${r.category || '未分类'}</td><td>${st ? '待处理' : '已识别'}</td></tr>`; }).join('')}
</tbody></table>
<p style="color:#777;font-size:12px">数据来源：${SOURCE_NAME}（真实流水线条目，规范中间表优先）。待处理项见 02_报销人视角/待补齐项.md</p>
</body></html>`;
fs.writeFileSync(path.join(outRoot, '04_总览看板.html'), dashHtml);

// ---------- 7. 说明 + 原始数据备份 ----------
// 扫 01_发票原件，以文件名金额为权威口径（PDF 已落地，最可信）
let originalsTotal = 0, originalsCount = 0;
(function walk(x) {
  for (const e of fs.readdirSync(x, { withFileTypes: true })) {
    const p = path.join(x, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.pdf$/i.test(e.name)) {
      originalsCount++;
      const m = e.name.match(/^([\d.]+)_/);
      if (m) originalsTotal += Number(m[1]);
    }
  }
})(dirs.originals);

const noteTxt = [
  `报销包说明 · ${BATCH_DATE}（${PERIOD_LABEL}）`,
  `生成工具：VK BaoXiao Agent`,
  `生成时间：${new Date().toLocaleString('zh-CN')}`,
  `数据标签：${SOURCE_NAME}`,
  ``,
  `目录内容：`,
  `  00_说明.txt        本文件`,
  `  01_发票原件/       去重后的唯一发票 PDF（按购买方分子目录，待确认单独放）`,
  `  02_报销人视角/     报销单(html/md)、报销清单、待补齐项`,
  `  03_出纳视角/       费用类别汇总(xlsx)、付款凭证模板(html)、记账凭证摘要(txt)`,
  `  04_总览看板.html   整体可视化`,
  `  05_原始数据/       流水线原始 JSON 备份`,
  ``,
  `统计：发票 ${invoiceRecords.length} 张，配套凭证 ${supportingRecords.length} 份（已识别 ${validCount} 张 ¥${fmt(validTotal)}，待处理 ${pendingCount} 张）；已下载 PDF 原件 ${downloadedCount} 张（文件名金额合计 ¥${fmt(originalsTotal)}）。`,
  ``,
  `重要提示：`,
  `  - 待处理 ${pendingCount} 张金额/抬头未识别，不计入可报总额，需补齐后入账。`,
  `  - 购买方/报销人/出纳等字段来自 config/package-config.js（未填则保留 {{}} 占位），请在 config/package-config.js 补齐；环境变量可临时覆盖。`,
  `  - 本包为流水线自动导出；archive/ 为过程存档，下次运行会重建。`,
].join('\n');
fs.writeFileSync(path.join(outRoot, '00_说明.txt'), noteTxt);

// 原始数据备份
fs.copyFileSync(finalPath, path.join(dirs.raw, SOURCE_NAME));
const dlPath = path.join(SKILL, 'scan-results', 'downloads', `download-results-${dateTag}.json`);
if (fs.existsSync(dlPath)) fs.copyFileSync(dlPath, path.join(dirs.raw, `download-results-${dateTag}.json`));

// ---------- 收尾 ----------
(async () => {
  await writeCategoryXlsx();
  console.log(`✅ 报销包已导出到：${outRoot}`);
  console.log(`   发票总数 ${invoiceRecords.length} | 已识别 ${validCount} (¥${fmt(validTotal)}) | 待处理 ${pendingCount} | 已下载PDF ${downloadedCount}`);
  console.log(`   类别分桶：${Object.keys(catBuckets).join(', ')}`);
})();
