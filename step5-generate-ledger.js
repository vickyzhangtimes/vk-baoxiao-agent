#!/usr/bin/env node
/**
 * step5-generate-ledger.js — 环节⑧ 台账生成 v2.1
 *
 * 功能：
 * - 读取 invoice-final-*.json（含 step4b 补的归类字段）
 * - 生成 Excel 台账，含 5 个 Sheet：
 *     Sheet1 台账明细（含 费用类别/客户类型/客户编号/项目号 + 邮件超链接）
 *     Sheet2 购买方汇总
 *     Sheet3 项目归类汇总（按 客户/项目 × 类别 × 月份）
 *     Sheet4 统计概览
 *     Sheet5 人工任务
 *
 * 用法：
 *   node step5-generate-ledger.js [dateTag]
 */

const fs = require('fs');
const path = require('path');
const { isInvoiceRecord, formatRoute } = require('./lib/record-utils');

const args = process.argv.slice(2);
const dateTag = args[0] || '';

function findLatestFile(dir, prefix) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .filter(f => !dateTag || f.includes(dateTag))
    .sort().reverse();
  return files[0] || null;
}

// ===== ExcelJS 安装检查 =====
try { require.resolve('exceljs'); } catch (e) {
  console.log('安装 exceljs...');
  require('child_process').execSync('npm install exceljs', { cwd: __dirname, stdio: 'inherit' });
}
const ExcelJS = require('exceljs');

async function generateLedger() {
  const scanDir = path.join(__dirname, 'scan-results');
  const jsonFile = findLatestFile(scanDir, 'invoice-final-');
  if (!jsonFile) { console.error('未找到最终清单文件'); process.exit(1); }

  const data = JSON.parse(fs.readFileSync(path.join(scanDir, jsonFile), 'utf8'));
  const { applyOverrides } = require('./lib/apply-overrides');
  applyOverrides(data.data, (data.meta && data.meta.dateTag) || dateTag);
  const records = data.data;
  const invoiceRecords = records.filter(isInvoiceRecord);
  const meta = data.meta;

  console.log('读取数据: ' + records.length + ' 条 (' + jsonFile + ')');

  const dateTagOut = meta.dateTag;
  const outputFile = path.join(scanDir, `发票台账-${dateTagOut}.xlsx`);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'QClaw 发票自动化 v2.1';
  workbook.created = new Date();

  // ===== Sheet 1: 台账明细 =====
  const s1 = workbook.addWorksheet('台账明细');
  s1.properties.defaultColWidth = 14;

  const cols = [
    ['A', 5, '序号'],
    ['B', 28, '购买方'],
    ['C', 28, '销售方'],
    ['D', 12, '费用类别'],
    ['E', 11, '客户类型'],
    ['F', 12, '客户编号'],
    ['G', 14, '项目号'],
    ['H', 12, '金额(元)'],
    ['I', 10, '金额来源'],
    ['J', 22, '发票号码'],
    ['K', 12, '开票日期'],
    ['L', 10, '文档类型'],
    ['M', 8, '有PDF'],
    ['N', 10, '状态'],
    ['O', 38, '邮件主题'],
    ['P', 10, '查看邮件'],
    ['Q', 36, '备注'],
    ['R', 10, '交通方式'],
    ['S', 12, '出行日期'],
    ['T', 24, '出发'],
    ['U', 24, '到达'],
  ];
  cols.forEach(([col, width, header]) => {
    s1.getColumn(col).width = width;
    s1.getColumn(col).numFmt = col === 'H' ? '#,##0.00' : '@';
  });

  const hRow = s1.addRow(cols.map(([, , h]) => h));
  hRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  hRow.alignment = { horizontal: 'center' };

  for (const r of invoiceRecords) {
    const row = s1.addRow([
      r.index,
      r.buyer || '',
      r.seller || '',
      r.category || '',
      r.clientType || '',
      r.clientNo || '',
      r.projectNo || '',
      r.amount ? parseFloat(r.amount) : null,
      r.amountSource || '',
      r.invoiceNo || '',
      r.invoiceDate || '',
      r.docType || '',
      r.hasPdf ? '✓' : '✗',
      r.status || '',
      r.subject || '',
      '',  // 超链接在下面设置
      r.notes || (r.manualReason ? '⚠️ ' + r.manualReason : ''),
      [r.transportType, r.flightNo].filter(Boolean).join(' / '),
      r.tripDate || '',
      r.fromStation || '',
      r.toStation || '',
    ]);

    if (r.emailHyperlink) {
      const linkCell = row.getCell('P');
      linkCell.value = { text: '查看邮件', hyperlink: r.emailHyperlink };
      linkCell.font = { color: { argb: 'FF0563C1' }, underline: true };
    }

    if (r.needsManualReview) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    }
    if (!r.hasPdf) {
      row.getCell('M').font = { color: { argb: 'FF999999' } };
    }
    if (r.status === 'error') {
      row.getCell('N').font = { color: { argb: 'FFFF0000' } };
    }
    if (r.amount && parseFloat(r.amount) > 5000) {
      row.getCell('H').font = { bold: true, color: { argb: 'FF1F3864' } };
    }
    if (r.clientNo === '未分类') {
      row.getCell('F').font = { color: { argb: 'FFE67E22' } };
    }
  }
  s1.getRow(1).freeze = true;
  s1.autoFilter = { from: 'A1', to: 'Q1' };

  // ===== Sheet 2: 购买方汇总 =====
  const s2 = workbook.addWorksheet('购买方汇总');
  s2.addRow(['购买方', '发票数量', '有金额数量', '总金额(元)', '备注']);
  const h2 = s2.getRow(1);
  h2.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  h2.alignment = { horizontal: 'center' };
  s2.getColumn(1).width = 30; s2.getColumn(2).width = 10;
  s2.getColumn(3).width = 10; s2.getColumn(4).width = 14; s2.getColumn(5).width = 20;
  s2.getColumn(4).numFmt = '#,##0.00';

  const byBuyer = {};
  for (const r of invoiceRecords) {
    if (r.buyer) {
      byBuyer[r.buyer] = byBuyer[r.buyer] || { count: 0, withAmt: 0, total: 0, sellers: {} };
      byBuyer[r.buyer].count++;
      if (r.amount) { byBuyer[r.buyer].withAmt++; byBuyer[r.buyer].total += parseFloat(r.amount); }
      if (r.seller) {
        byBuyer[r.buyer].sellers[r.seller] = byBuyer[r.buyer].sellers[r.seller] || { count: 0, total: 0 };
        byBuyer[r.buyer].sellers[r.seller].count++;
        if (r.amount) byBuyer[r.buyer].sellers[r.seller].total += parseFloat(r.amount);
      }
    }
  }

  for (const [buyer, stats] of Object.entries(byBuyer).sort((a, b) => b[1].total - a[1].total)) {
    const rRow = s2.addRow([buyer, stats.count, stats.withAmt, stats.total, '']);
    rRow.font = { bold: true };
    for (const [seller, ss] of Object.entries(stats.sellers).sort((a, b) => b[1].total - a[1].total)) {
      s2.addRow(['', '', '', '', seller + ' ' + ss.count + '张 ¥' + ss.total.toFixed(2)]);
    }
  }

  // ===== Sheet 3: 项目归类汇总 =====
  const s3 = workbook.addWorksheet('项目归类汇总');
  // 3a. 项目合计
  s3.addRow(['【项目合计】']);
  const sp = s3.addRow(['客户类型', '客户编号', '项目号', '发票张数', '金额合计(元)']);
  sp.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sp.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  sp.alignment = { horizontal: 'center' };
  s3.getColumn(1).width = 12; s3.getColumn(2).width = 14;
  s3.getColumn(3).width = 16; s3.getColumn(4).width = 10; s3.getColumn(5).width = 16;
  s3.getColumn(5).numFmt = '#,##0.00';

  const projAgg = {};
  for (const r of invoiceRecords) {
    const key = `${r.clientNo || '未分类'}|${r.projectNo || '未分类'}`;
    projAgg[key] = projAgg[key] || { clientType: r.clientType || '', clientNo: r.clientNo || '未分类', projectNo: r.projectNo || '未分类', count: 0, total: 0 };
    projAgg[key].count++;
    if (r.amount) projAgg[key].total += parseFloat(r.amount);
  }
  for (const k of Object.keys(projAgg).sort()) {
    const p = projAgg[k];
    s3.addRow([p.clientType, p.clientNo, p.projectNo, p.count, p.total]);
  }

  // 3b. 项目 × 类别 × 月份 明细
  s3.addRow([]);
  s3.addRow(['【项目 × 类别 × 月份 明细】']);
  const dp = s3.addRow(['客户编号', '项目号', '费用类别', '月份', '张数', '金额合计(元)']);
  dp.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  dp.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  dp.alignment = { horizontal: 'center' };

  const detailAgg = {};
  for (const r of invoiceRecords) {
    const key = `${r.clientNo || '未分类'}|${r.projectNo || '未分类'}|${r.category || '其他'}|${r.month || '未知月份'}`;
    detailAgg[key] = detailAgg[key] || { clientNo: r.clientNo || '未分类', projectNo: r.projectNo || '未分类', category: r.category || '其他', month: r.month || '未知月份', count: 0, total: 0 };
    detailAgg[key].count++;
    if (r.amount) detailAgg[key].total += parseFloat(r.amount);
  }
  for (const k of Object.keys(detailAgg).sort()) {
    const d = detailAgg[k];
    s3.addRow([d.clientNo, d.projectNo, d.category, d.month, d.count, d.total]);
  }

  // ===== Sheet 4: 统计概览 =====
  const s4 = workbook.addWorksheet('统计概览');
  s4.addRow(['指标', '值']); s4.addRow(['生成时间', new Date().toLocaleString('zh-CN')]);
  s4.addRow(['扫描范围', (meta.startDate || '') + ' ~ ' + (meta.endDate || '')]);
  s4.addRow(['总记录', meta.totalRecords]);
  s4.addRow(['有PDF', meta.hasPdf]);
  s4.addRow(['无PDF（链接发票）', meta.noPdf]);
  s4.addRow(['购买方提取', meta.withBuyer]);
  s4.addRow(['销售方提取', meta.withSeller]);
  s4.addRow(['金额提取', meta.withAmount]);
  s4.addRow(['完整三要素', meta.complete]);
  s4.addRow(['需人工确认', meta.needsManual]);
  // 归类统计
  const autoN = invoiceRecords.filter(r => r.attributionStatus === 'auto').length;
  const ovN = invoiceRecords.filter(r => r.attributionStatus === 'override').length;
  const manN = invoiceRecords.filter(r => r.attributionStatus === 'manual').length;
  s4.addRow(['归类-自动', autoN]);
  s4.addRow(['归类-手动覆盖', ovN]);
  s4.addRow(['归类-待归类', manN]);
  s4.addRow(['', '']);
  s4.addRow(['=== 金额汇总 ===', '']);
  s4.getColumn(2).numFmt = '#,##0.00';

  const personal = invoiceRecords.filter(r => r.buyer === '个人报销');
  const personalTotal = personal.reduce((s, r) => s + (r.amount ? parseFloat(r.amount) : 0), 0);
  if (personal.length) s4.addRow(['个人报销', personalTotal]);

  const buyerTotals = Object.entries(byBuyer)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5);
  for (const [buyer, stats] of buyerTotals) {
    s4.addRow([buyer, stats.total]);
  }

  const allTotal = invoiceRecords.reduce((s, r) => s + (r.amount ? parseFloat(r.amount) : 0), 0);
  s4.addRow(['合计（含未识别购买方）', allTotal]);

  s4.getColumn(1).width = 22; s4.getColumn(2).width = 16;
  s4.getRow(1).font = { bold: true };

  // ===== Sheet 5: 人工任务 =====
  const s5 = workbook.addWorksheet('人工任务');
  const manualRecords = records.filter(r => r.needsManualReview);
  if (manualRecords.length > 0) {
    const mCols = [
      ['A', 8, 'UID'],
      ['B', 10, '查看邮件'],
      ['C', 12, '邮件日期'],
      ['D', 12, '待处理类型'],
      ['E', 14, '当前金额'],
      ['F', 12, '当前类别'],
      ['G', 12, '当前项目号'],
      ['H', 28, '当前购买方'],
      ['I', 28, '当前销售方'],
      ['J', 40, '邮件主题'],
      ['K', 36, '备注/链接'],
    ];
    mCols.forEach(([col, width, header]) => {
      s5.getColumn(col).width = width;
    });

    const h5 = s5.addRow(mCols.map(([, , h]) => h));
    h5.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h5.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE74C3C' } };
    h5.alignment = { horizontal: 'center' };

    const reasonLabel = {
      'NO_ATTACH_NO_LINK': '无附件无链接',
      'ATTACH_NOT_PDF': '附件非PDF',
      'LINK_NEED_SCAN': '链接需扫码',
      'PDF_PARSE_FAIL': 'PDF解析失败',
      'NO_AMOUNT': '缺金额',
      'NO_BUYER': '缺购买方',
    };

    for (const r of manualRecords) {
      const row = s5.addRow([
        r.emailUid,
        '', // 超链接
        r.emailDate || '',
        reasonLabel[r.manualReason] || r.manualReason || '需确认',
        r.amount || '',
        r.category || '',
        r.projectNo || '',
        r.buyer || '',
        r.seller || '',
        r.subject || '',
        r.notes || '',
      ]);

      if (r.emailHyperlink) {
        const linkCell = row.getCell(2);
        linkCell.value = { text: '▶ 查看邮件', hyperlink: r.emailHyperlink };
        linkCell.font = { color: { argb: 'FF0563C1' }, underline: true };
      }

      const colors = {
        'NO_ATTACH_NO_LINK': 'FFFFCDD2',
        'LINK_NEED_SCAN': 'FFFFE0B2',
        'NO_AMOUNT': 'FFFFF9C4',
        'PDF_PARSE_FAIL': 'FFFFAB91',
      };
      const bg = colors[r.manualReason] || 'FFFFF3E0';
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    }
    s5.getRow(1).freeze = true;
  } else {
    s5.addRow(['✅ 暂无需人工处理的任务']);
  }

  // ===== 保存 =====
  await workbook.xlsx.writeFile(outputFile);
  console.log('');
  console.log('✅ Excel台账已生成: ' + outputFile);
  console.log('');
  console.log('━━━ 台账内容 ━━━');
  console.log('Sheet1 台账明细: ' + invoiceRecords.length + ' 条（含归类字段+邮件超链接）');
  console.log('Sheet2 购买方汇总');
  console.log('Sheet3 项目归类汇总');
  console.log('Sheet4 统计概览');
  console.log('Sheet5 人工任务: ' + manualRecords.length + ' 条');
  console.log('');
  console.log('━━━ 关键金额 ━━━');
  for (const [buyer, stats] of buyerTotals) {
    console.log(buyer + ': ' + stats.count + '张, ¥' + stats.total.toFixed(2));
  }
  if (personal.length) console.log('个人报销: ' + personal.length + '张, ¥' + personalTotal.toFixed(2));
  console.log('合计: ¥' + allTotal.toFixed(2));
}

generateLedger().catch(e => { console.error(e); process.exit(1); });
