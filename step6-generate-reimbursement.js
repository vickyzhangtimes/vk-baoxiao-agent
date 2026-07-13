#!/usr/bin/env node
/**
 * step6-generate-reimbursement.js — 环节⑨ 报销单生成 v2.0（可打印版）
 *
 * 读取 step4b enriched 的 invoice-final-*.json，
 * 生成可直接打印/上传OA的报销单 Excel。
 *
 * v2.0 变更：
 *   - 去掉无意义的客户类型/客户编号/项目号三列（全空）
 *   - 数据按费用类别分组，每个类别末尾有小计行
 *   - 增加规范签字栏（报销人/审批人/出纳/日期）
 *   - A4 打印优化：列宽适配、字体大小合适、可冻结表头
 *
 * Sheet 结构：
 *   1. 报销单      —— 可打印主表（按类别分组+小计+签字栏）
 *   2. 按类别汇总  —— 费用类别 张数+金额（成本核算视角）
 *   3. 按月份汇总  —— 月度支出趋势（成本核算视角）
 *   4. 待处理/异常 —— 需人工确认的发票
 *
 * 用法：
 *   node step6-generate-reimbursement.js [dateTag]
 */

const fs = require('fs');
const path = require('path');
const { loadPackageConfig } = require('./lib/load-package-config');

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

try { require.resolve('exceljs'); } catch (e) {
  console.log('安装 exceljs...');
  require('child_process').execSync('npm install exceljs', { cwd: __dirname, stdio: 'inherit' });
}
const ExcelJS = require('exceljs');

function amt(r) {
  const v = parseFloat(r.amount);
  return isNaN(v) ? 0 : v;
}

// 大写金额转换（简版，支持到万位）
function toChineseAmount(n) {
  const digits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const units = ['', '拾', '佰', '仟'];
  const bigUnits = ['', '万', '亿'];
  if (n === 0) return '零元整';
  const yi = Math.floor(n / 100000000); n %= 100000000;
  const wan = Math.floor(n / 10000); n %= 10000;
  const rest = Math.floor(n); n %= 1;
  const jiao = Math.floor(n * 10); n = Math.round(n * 100) % 10;
  function seg(val) {
    if (val === 0) return '';
    let s = '';
    let hasNonZero = false;
    const d = String(val).padStart(4, '0').split('').map(Number);
    for (let i = 0; i < 4; i++) {
      if (d[i] === 0) { if (hasNonZero) s += '零'; }
      else { s += digits[d[i]] + units[4 - 1 - i]; hasNonZero = true; }
    }
    return s.replace(/零+$/, '');
  }
  let result = seg(yi);
  if (yi > 0 && (wan > 0 || rest > 0)) result += '万';
  const wSeg = seg(wan);
  if (wan > 0) result += wSeg;
  if ((yi > 0 || wan > 0) && rest > 0 && rest < 1000) result += '零';
  result += seg(rest);
  result += '元';
  if (jiao === 0 && n === 0) result += '整';
  else { if (jiao > 0) result += digits[jiao] + '角'; if (n > 0) result += digits[n] + '分'; }
  return result.replace(/^零+/, '') || '零元整';
}

async function generateReimbursement() {
  const scanDir = path.join(__dirname, 'scan-results');
  const jsonFile = findLatestFile(scanDir, 'invoice-final-');
  if (!jsonFile) { console.error('未找到最终清单文件，请先运行 step4b'); process.exit(1); }

  const data = JSON.parse(fs.readFileSync(path.join(scanDir, jsonFile), 'utf8'));
  const { applyOverrides } = require('./lib/apply-overrides');
  applyOverrides(data.data, (data.meta && data.meta.dateTag) || dateTag);
  const records = data.data || [];
  const meta = data.meta || {};
  const PKG = loadPackageConfig();

  const detailRows = records.filter(r => r.amount && !r.needsManualReview);
  const pendingRows = records.filter(r => r.needsManualReview);

  // 按费用类别分组（固定顺序：餐饮招待优先等）
  const CAT_ORDER = ['餐饮招待', '差旅交通', '住宿', '通讯费', '员工福利', '办公采购', '软件订阅', '市场推广', '个人消费', '其他'];
  detailRows.sort((a, b) => {
    const ia = Math.max(0, CAT_ORDER.indexOf(a.category || '其他'));
    const ib = Math.max(0, CAT_ORDER.indexOf(b.category || '其他'));
    if (ia !== ib) return ia - ib;
    return (a.invoiceDate || '').localeCompare(b.invoiceDate || '', 'zh');
  });

  // 按类别分桶
  const catGroups = {};
  for (const r of detailRows) {
    const c = r.category || '其他';
    catGroups[c] = catGroups[c] || [];
    catGroups[c].push(r);
  }

  const total = detailRows.reduce((s, r) => s + amt(r), 0);

  const outputFile = path.join(scanDir, `报销单-${meta.dateTag || dateTag || 'latest'}.xlsx`);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QClaw 发票自动化 v2.2';
  wb.created = new Date();

  // ===== Sheet 1: 报销单（可打印） =====
  const ws = wb.addWorksheet('报销单');
  ws.pageSetup = { orientation: 'portrait', paperSize: 9, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6 }, fitToPage: false };
  ws.properties.defaultColWidth = 12;

  // 列定义（精简到10列，去掉全空的客户类型/客户编号/项目号）
  const COLS = [
    { key: 'seq', width: 5, header: '序号' },
    { key: 'date', width: 12, header: '开票日期' },
    { key: 'cat', width: 11, header: '费用类别' },
    { key: 'seller', width: 24, header: '销售方' },
    { key: 'no', width: 20, header: '发票号码' },
    { key: 'amt', width: 12, header: '金额(元)', numFmt: '#,##0.00' },
    { key: 'note', width: 22, header: '备注' },
    { key: 'transport', width: 10, header: '交通方式' },
    { key: 'tripDate', width: 12, header: '出行日期' },
    { key: 'route', width: 22, header: '行程(出发→到达)' },
  ];
  COLS.forEach((c, i) => { const col = ws.getColumn(i + 1); col.width = c.width; if (c.numFmt) col.numFmt = c.numFmt; });

  // --- 表头区域 ---
  ws.mergeCells('A1:J1');
  const titleCell = ws.getCell('A1');
  titleCell.value = '费 用 报 销 单';
  titleCell.font = { bold: true, size: 18, name: 'SimHei', color: { argb: 'FF1F3864' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 36;

  // 第2行：申请人 / 部门
  ws.mergeCells('A2:C2'); ws.getCell('A2').value = '申请人'; ws.getCell('A2').font = { bold: true }; ws.getCell('A2').alignment = { vertical: 'middle' };
  ws.mergeCells('D2:E2'); ws.getCell('D2').value = PKG.claimer; ws.getCell('D2').alignment = { vertical: 'middle' };
  ws.mergeCells('F2:G2'); ws.getCell('F2').value = '部门'; ws.getCell('F2').font = { bold: true }; ws.getCell('F2').alignment = { vertical: 'middle' };
  ws.mergeCells('H2:J2'); ws.getCell('H2').value = PKG.department; ws.getCell('H2').alignment = { vertical: 'middle' };

  // 第3行：报销区间 / 制单日期
  ws.mergeCells('A3:C3'); ws.getCell('A3').value = '报销区间'; ws.getCell('A3').font = { bold: true }; ws.getCell('A3').alignment = { vertical: 'middle' };
  ws.mergeCells('D3:E3'); ws.getCell('D3').value = `${meta.startDate || ''} ~ ${meta.endDate || ''}`; ws.getCell('D3').alignment = { vertical: 'middle' };
  ws.mergeCells('F3:G3'); ws.getCell('F3').value = '制单日期'; ws.getCell('F3').font = { bold: true }; ws.getCell('F3').alignment = { vertical: 'middle' };
  ws.mergeCells('H3:J3'); ws.getCell('H3').value = new Date().toLocaleDateString('zh-CN'); ws.getCell('H3').alignment = { vertical: 'middle' };

  // 第4行：张数 / 合计金额
  ws.mergeCells('A4:C4'); ws.getCell('A4').value = '发票张数'; ws.getCell('A4').font = { bold: true }; ws.getCell('A4').alignment = { vertical: 'middle' };
  ws.mergeCells('D4:E4'); ws.getCell('D4').value = detailRows.length; ws.getCell('D4').alignment = { vertical: 'middle' };
  ws.mergeCells('F4:G4'); ws.getCell('F4').value = '合计金额(元)'; ws.getCell('F4').font = { bold: true }; ws.getCell('F4').alignment = { vertical: 'middle' };
  ws.mergeCells('H4:J4'); const totalCell = ws.getCell('H4');
  totalCell.value = total; totalCell.numFmt = '¥#,##0.00'; totalCell.font = { bold: true, size: 13, color: { argb: 'FFC00000' } };
  totalCell.alignment = { vertical: 'middle' };

  // 第5行：大写金额
  ws.mergeCells('A5:J5'); ws.getCell('A5').value = `大写：${toChineseAmount(total)}`;
  ws.getCell('A5').font = { italic: true, color: { argb: 'FF666666' } };
  ws.getCell('A5').alignment = { horizontal: 'center' };

  // 美化信息区
  [2, 3, 4].forEach(r => {
    ws.getRow(r).height = 22;
    ['A', 'F'].forEach(c => { const cell = ws.getCell(c + r); cell.alignment = Object.assign({}, cell.alignment, { horizontal: 'right' }); });
  });

  // --- 数据表头（第7行） ---
  const headRow = 7;
  const hRow = ws.getRow(headRow);
  COLS.forEach((c, i) => { hRow.getCell(i + 1).value = c.header; });
  hRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  hRow.alignment = { horizontal: 'center', vertical: 'center' };
  hRow.height = 24;
  // 全表边框样式
  const thinBorder = { style: 'thin', color: { argb: 'FFCCCCCC' } };

  // --- 数据行（按类别分组） ---
  let rowIdx = headRow + 1;
  const sortedCats = Object.keys(catGroups).sort((a, b) => {
    const ia = Math.max(0, CAT_ORDER.indexOf(a));
    const ib = Math.max(0, CAT_ORDER.indexOf(b));
    return ia - ib;
  });

  for (const cat of sortedCats) {
    const rowsInCat = catGroups[cat];
    // 类别标题行
    const catLabelRow = ws.getRow(rowIdx);
    ws.mergeCells(`A${rowIdx}:J${rowIdx}`);
    catLabelRow.getCell(1).value = `【${cat}】${rowsInCat.length} 张`;
    catLabelRow.font = { bold: true, size: 10, color: { argb: 'FF1F3864' } };
    catLabelRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    catLabelRow.height = 20;
    rowIdx++;

    // 该类别的数据行
    for (const r of rowsInCat) {
      const row = ws.getRow(rowIdx);
      row.getCell(1).value = rowIdx - headRow; // 全局序号
      row.getCell(2).value = r.invoiceDate || '';
      row.getCell(3).value = r.category || '其他';
      row.getCell(4).value = r.seller || '';
      row.getCell(5).value = r.invoiceNo || '';
      row.getCell(6).value = amt(r);
      row.getCell(7).value = r.notes || '';
      row.getCell(8).value = r.transportType || '';
      row.getCell(9).value = r.tripDate || '';
      const tripStr = (r.fromStation || r.toStation) ? `${r.fromStation || ''} → ${r.toStation || ''}` : '';
      row.getCell(10).value = tripStr;

      // 行边框 + 交替底色
      for (let c = 1; c <= 10; c++) {
        row.getCell(c).border = thinBorder;
      }
      if ((rowIdx - headRow) % 2 === 0) {
        row.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } };
        });
      }
      if (amt(r) > 5000) row.getCell(6).font = { bold: true, color: { argb: 'FFC00000' } };
      rowIdx++;
    }

    // 类别小计行
    const subRow = ws.getRow(rowIdx);
    ws.mergeCells(`A${rowIdx}:E${rowIdx}`);
    subRow.getCell(1).value = `${cat} 小计`;
    subRow.getCell(1).font = { bold: true, size: 10 };
    subRow.getCell(1).alignment = { horizontal: 'right' };
    const catTotal = rowsInCat.reduce((s, r) => s + amt(r), 0);
    subRow.getCell(6).value = catTotal;
    subRow.getCell(6).numFmt = '#,##0.00';
    subRow.getCell(6).font = { bold: true };
    for (let c = 1; c <= 10; c++) {
      subRow.getCell(c).border = thinBorder;
      subRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4FA' } };
    }
    rowIdx++;
  }

  // --- 总计行 ---
  const grandRow = ws.getRow(rowIdx);
  ws.mergeCells(`A${rowIdx}:E${rowIdx}`);
  grandRow.getCell(1).value = '总 计';
  grandRow.getCell(1).font = { bold: true, size: 12 };
  grandRow.getCell(1).alignment = { horizontal: 'right' };
  grandRow.getCell(6).value = total;
  grandRow.getCell(6).numFmt = '¥#,##0.00';
  grandRow.getCell(6).font = { bold: true, size: 12, color: { argb: 'FFC00000' } };
  for (let c = 1; c <= 10; c++) {
    grandRow.getCell(c).border = thinBorder;
    grandRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE6CC' } };
  }
  rowIdx++;

  // --- 空行 ---
  rowIdx++;

  // --- 签字栏 ---
  const sigRow = rowIdx;
  ws.mergeCells(`A${sigRow}:E${sigRow}`);
  ws.getCell(`A${sigRow}`).value = '报销人签字：________________    日期：____年____月____日';
  ws.getCell(`A${sigRow}`).font = { size: 11 };
  ws.getCell(`A${sigRow}`).alignment = { vertical: 'bottom' };
  rowIdx++;
  ws.mergeCells(`A${rowIdx}:E${rowIdx}`);
  ws.getCell(`A${rowIdx}`).value = '部门审核：________________    日期：____年____月____日';
  ws.getCell(`A${rowIdx}`).font = { size: 11 };
  rowIdx++;
  ws.mergeCells(`A${rowIdx}:E${rowIdx}`);
  ws.getCell(`A${rowIdx}`).value = `审批人（${PKG.approver}）：________________    日期：____年____月____日`;
  ws.getCell(`A${rowIdx}`).font = { size: 11 };
  rowIdx++;
  ws.mergeCells(`A${rowIdx}:E${rowIdx}`);
  ws.getCell(`A${rowIdx}`).value = `出纳（${PKG.cashier}）：________________    付款日期：____年____月____日`;
  ws.getCell(`A${rowIdx}`).font = { size: 11 };

  [sigRow, sigRow + 1, sigRow + 2, sigRow + 3].forEach(r => {
    ws.getRow(r).height = 26;
  });

  // 冻结表头
  ws.views = [{ state: 'frozen', ySplit: headRow }];

  // ===== Sheet 2: 按类别汇总（成本核算视角） =====
  const ws2 = wb.addWorksheet('按类别汇总');
  ws2.columns = [
    { header: '费用类别', width: 14 }, { header: '张数', width: 8 },
    { header: '金额合计(元)', width: 16, numFmt: '#,##0.00' }, { header: '占比', width: 10 },
  ];
  const h2 = ws2.getRow(1);
  h2.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  h2.alignment = { horizontal: 'center' };
  const catAgg = {};
  for (const r of detailRows) {
    const c = r.category || '其他';
    catAgg[c] = catAgg[c] || { count: 0, total: 0 };
    catAgg[c].count++; catAgg[c].total += amt(r);
  }
  for (const c of Object.keys(catAgg).sort((a, b) => catAgg[b].total - catAgg[a].total)) {
    const entry = catAgg[c];
    const pct = total > 0 ? (entry.total / total * 100).toFixed(1) : '0.0';
    ws2.addRow([c, entry.count, entry.total, parseFloat(pct) + '%']);
  }
  // 汇总合计行
  ws2.addRow(['合 计', detailRows.length, total, '100%']);
  const last2 = ws2.rowCount;
  ws2.getRow(last2).font = { bold: true };
  ws2.getRow(last2).eachCell({ includeEmpty: true }, cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE6CC' } };
    cell.border = thinBorder;
  });

  // ===== Sheet 3: 按月份汇总（成本核算趋势） =====
  const ws3 = wb.addWorksheet('按月份汇总');
  const months = [...new Set(detailRows.map(r => {
    const d = r.invoiceDate || '';
    return d.slice(0, 7); // YYYY-MM
  }))].sort();
  const mHeaders = ['费用类别', ...months, '合计'];
  ws3.addRow(mHeaders);
  const h3 = ws3.getRow(1);
  h3.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  h3.alignment = { horizontal: 'center' };
  ws3.getColumn(1).width = 14;
  for (let i = 2; i <= mHeaders.length; i++) { ws3.getColumn(i).width = 13; ws3.getColumn(i).numFmt = '#,##0.00'; }

  // 月度透视数据
  const monthPivot = {};
  for (const r of detailRows) {
    const c = r.category || '其他';
    const m = (r.invoiceDate || '').slice(0, 7) || '未知';
    monthPivot[c] = monthPivot[c] || {};
    monthPivot[c][m] = (monthPivot[c][m] || 0) + amt(r);
  }
  for (const c of sortedCats) {
    const row = ws3.addRow([c]);
    let rowTotal = 0;
    months.forEach((m, i) => {
      const v = (monthPivot[c] && monthPivot[c][m]) || 0;
      row.getCell(i + 2).value = v || null;
      rowTotal += v;
    });
    row.getCell(mHeaders.length).value = rowTotal;
    row.getCell(mHeaders.length).font = { bold: true };
  }

  // ===== Sheet 4: 待处理/异常 =====
  const ws4 = wb.addWorksheet('待处理异常');
  if (pendingRows.length === 0) {
    ws4.addRow(['✅ 无待处理发票，全部可计入报销单']);
  } else {
    ws4.addRow(['#', '销售方', '已知金额', '当前类别', '来源邮件', '待处理原因', '操作建议']);
    const h4 = ws4.getRow(1);
    h4.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE74C3C' } };
    h4.alignment = { horizontal: 'center' };
    ws4.getColumn(1).width = 4; ws4.getColumn(2).width = 24; ws4.getColumn(3).width = 10;
    ws4.getColumn(4).width = 11; ws4.getColumn(5).width = 28; ws4.getColumn(6).width = 16; ws4.getColumn(7).width = 22;
    pendingRows.forEach((r, i) => {
      const row = ws4.addRow([
        i + 1, r.seller || '-', r.amount || '', r.category || '-',
        r.emailHyperlink || '-', r.manualReason || '需确认',
        (r.notes || '').includes('cmcc') ? '建议重分类为「通讯费」' : '补录金额或抬头',
      ]);
      if (r.emailHyperlink) {
        const lc = row.getCell(5);
        lc.value = { text: '▶ 查看邮件', hyperlink: r.emailHyperlink };
        lc.font = { color: { argb: 'FF0563C1' }, underline: true };
      }
    });
  }

  await wb.xlsx.writeFile(outputFile);
  console.log('');
  console.log('✅ 报销单已生成(可打印版): ' + outputFile);
  console.log('计入报销单: ' + detailRows.length + ' 张, 合计 ¥' + total.toFixed(2));
  console.log('大写: ' + toChineseAmount(total));
  console.log('费用类别数: ' + sortedCats.length);
  console.log('待处理/异常: ' + pendingRows.length + ' 张（见「待处理异常」Sheet）');
  console.log('Sheet: 报销单(可打印) / 按类别汇总 / 按月份汇总 / 待处理异常');
}

generateReimbursement().catch(e => { console.error(e); process.exit(1); });
