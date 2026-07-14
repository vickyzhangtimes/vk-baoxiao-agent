#!/usr/bin/env node
'use strict';
// 报销数据看板生成器：读 enriched invoice-final JSON，输出自包含 HTML（纯 SVG，无 CDN 依赖）
const fs = require('fs');
const path = require('path');
const { isInvoiceRecord, formatRoute } = require('./lib/record-utils');

const dateTag = process.argv[2];
if (!dateTag) { console.error('用法: node generate-dashboard.js <dateTag>'); process.exit(1); }

const root = __dirname;
const scanDir = path.join(root, 'scan-results');
// 规范中间表优先；不存在时回退 invoice-final
const tablePath = path.join(scanDir, `invoice-table-${dateTag}.json`);
const jsonPath = fs.existsSync(tablePath)
  ? tablePath
  : path.join(scanDir, `invoice-final-${dateTag}.json`);
if (!fs.existsSync(jsonPath)) { console.error('找不到:', jsonPath); process.exit(1); }

const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const records = Array.isArray(raw.data) ? raw.data : [];
const invoiceRecords = records.filter(isInvoiceRecord);
const supportingCount = records.length - invoiceRecords.length;
const meta = raw.meta || {};

const PALETTE = ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#9c755f','#bab0ac'];

// ---------- 聚合 ----------
const catMap = {}, projMap = {}, monthMap = {};
const pending = [];
let total = 0, validCount = 0;

for (const r of invoiceRecords) {
  const amt = Number(r.amount) || 0;
  const hasArchive = !!(r.archivePath);
  const isPending = r.needsManualReview || !(amt > 0);
  if (isPending) {
    r._pendingReason = r.needsManualReview
      ? (hasArchive ? '待补齐金额/抬头' : '未下载(需人工取PDF)')
      : '待识别(文件已下载,金额未解析)';
    pending.push(r);
    continue;
  }
  total += amt; validCount++;
  const cat = r.category || '未分类';
  catMap[cat] = (catMap[cat] || 0) + amt;
  const pNo = r.projectNo || '未分类', cNo = r.clientNo || '未分类';
  if (!projMap[pNo]) projMap[pNo] = { label: `${cNo} / ${pNo}`, amount: 0 };
  projMap[pNo].amount += amt;
  const m = r.month || (r.invoiceDate ? String(r.invoiceDate).slice(0, 7) : '未知');
  monthMap[m] = (monthMap[m] || 0) + amt;
}

const catData = Object.entries(catMap).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value);
const projData = Object.entries(projMap).map(([k, v]) => ({ label: v.label, value: v.amount })).sort((a, b) => b.value - a.value);
const months = Object.keys(monthMap).filter(m => m && m !== '未知').sort();
const monthData = months.map(m => ({ label: m.slice(2), value: monthMap[m] }));

// ---------- 工具 ----------
function fmt(n) { return '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 }); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function svgPie(data, size = 240) {
  const sum = data.reduce((s, d) => s + d.value, 0);
  if (sum <= 0) return '<div class="empty">无数据</div>';
  const cx = size / 2, cy = size / 2, r = size / 2 - 6;
  let a0 = -Math.PI / 2, parts = '';
  data.forEach((d, i) => {
    const frac = d.value / sum, a1 = a0 + frac * 2 * Math.PI;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const large = frac > 0.5 ? 1 : 0, color = PALETTE[i % PALETTE.length];
    parts += `<path d="M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
    a0 = a1;
  });
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${parts}</svg>`;
}

function svgBars(data, w = 440, h = 220) {
  if (!data.length) return '<div class="empty">无数据</div>';
  const max = Math.max(...data.map(d => d.value), 1);
  const padL = 8, padB = 28, padT = 18, padR = 8;
  const plotW = w - padL - padR, plotH = h - padT - padB, n = data.length, slot = plotW / n, bw = Math.min(slot * 0.6, 56);
  let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><line x1="${padL}" y1="${padT + plotH}" x2="${w - padR}" y2="${padT + plotH}" stroke="#e2e8f0"/>`;
  data.forEach((d, i) => {
    const bh = (d.value / max) * plotH, x = padL + slot * i + (slot - bw) / 2, y = padT + plotH - bh, color = PALETTE[i % PALETTE.length];
    s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${color}"/>`;
    s += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="#334155">${fmt(d.value)}</text>`;
    const lbl = d.label.length > 9 ? d.label.slice(0, 9) + '…' : d.label;
    s += `<text x="${(x + bw / 2).toFixed(1)}" y="${padT + plotH + 14}" text-anchor="middle" font-size="9" fill="#64748b">${esc(lbl)}</text>`;
  });
  return s + '</svg>';
}

function legend(data) {
  return '<div class="legend">' + data.map((d, i) => `<span class="lg"><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(d.label)} · ${fmt(d.value)}</span>`).join('') + '</div>';
}

const range = meta.dateRange ? `${meta.dateRange.start} ~ ${meta.dateRange.end}` : dateTag;
const genAt = meta.generatedAt ? new Date(meta.generatedAt).toLocaleString('zh-CN') : '';

const detailRows = invoiceRecords.map(r => {
  const amt = Number(r.amount) || 0;
  const isPending = r.needsManualReview || !(amt > 0);
  const status = isPending
    ? `<span class="badge warn">${esc(r._pendingReason || '待处理')}</span>`
    : (r.attributionStatus === 'auto' ? '<span class="badge ok">自动</span>' : '<span class="badge">手动</span>');
  return `<tr>
    <td>${esc(r.invoiceNo)}</td>
    <td>${esc(r.seller)}</td>
    <td>${esc(r.category || '')}</td>
    <td>${esc((r.clientNo || '未分类') + ' / ' + (r.projectNo || '未分类'))}</td>
    <td class="num">${isPending ? '—' : fmt(amt)}</td>
    <td>${status}</td>
    <td>${esc([r.transportType, r.flightNo].filter(Boolean).join(' / ') || '—')}</td>
    <td>${esc(r.tripDate || '—')}</td>
    <td>${esc(formatRoute(r, ' | ') || '—')}</td>
  </tr>`;
}).join('');

const pendingRows = pending.length
  ? pending.map(r => `<tr><td>${esc(r.invoiceNo || '—')}</td><td>${esc(r.seller)}</td><td>${esc(r.subject)}</td><td>${esc(r._pendingReason || '金额待补 / 需人工核对')}</td></tr>`).join('')
  : '<tr><td colspan="4" class="empty">无待处理项 🎉</td></tr>';

// ---------- 拼 HTML ----------
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>报销数据看板 ${range}</title>
<style>
  :root{ --bg:#f8fafc; --card:#fff; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; }
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,"PingFang SC","Microsoft YaHei",Segoe UI,sans-serif;background:var(--bg);color:var(--ink);padding:24px;}
  .wrap{max-width:980px;margin:0 auto;}
  header{margin-bottom:18px;}
  h1{font-size:20px;margin:0 0 4px;}
  .sub{color:var(--muted);font-size:13px;}
  .cards{display:flex;gap:14px;margin:18px 0;flex-wrap:wrap;}
  .card{flex:1;min-width:180px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;}
  .card .k{font-size:12px;color:var(--muted);}
  .card .v{font-size:26px;font-weight:700;margin-top:6px;}
  .card .v.small{font-size:20px;}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
  @media(max-width:760px){.grid{grid-template-columns:1fr;}}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;}
  .panel h2{font-size:15px;margin:0 0 12px;}
  .legend{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:10px;font-size:12px;color:var(--muted);}
  .lg{display:inline-flex;align-items:center;gap:6px;}
  .lg i{width:11px;height:11px;border-radius:3px;display:inline-block;}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px;}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);}
  th{color:var(--muted);font-weight:600;font-size:12px;}
  td.num,th.num{text-align:right;}
  .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;background:#f1f5f9;color:#475569;}
  .badge.ok{background:#dcfce7;color:#166534;}
  .badge.warn{background:#fef3c7;color:#92400e;}
  .empty{color:var(--muted);text-align:center;padding:18px;}
  .full{grid-column:1/-1;}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>报销数据看板</h1>
    <div class="sub">区间 ${range} · 生成于 ${genAt}</div>
  </header>

  <div class="cards">
    <div class="card"><div class="k">有效发票</div><div class="v">${validCount} 张</div></div>
    <div class="card"><div class="k">报销总额</div><div class="v">${fmt(total)}</div></div>
    <div class="card"><div class="k">待处理</div><div class="v ${pending.length ? '' : 'small'}">${pending.length} 张</div></div>
  </div>

  <div class="grid">
    <div class="panel">
      <h2>费用类别分布</h2>
      ${svgPie(catData)}
      ${legend(catData)}
    </div>
    <div class="panel">
      <h2>按客户 · 项目汇总</h2>
      ${svgBars(projData)}
    </div>
    <div class="panel full">
      <h2>月份趋势</h2>
      ${svgBars(monthData, 920, 220)}
    </div>
    <div class="panel full">
      <h2>待处理清单</h2>
      <table><thead><tr><th>发票号</th><th>销售方</th><th>邮件主题</th><th>说明</th></tr></thead><tbody>${pendingRows}</tbody></table>
    </div>
    <div class="panel full">
      <h2>发票明细</h2>
      <table><thead><tr><th>发票号</th><th>销售方</th><th>费用类别</th><th>客户 / 项目</th><th class="num">金额</th><th>状态</th><th>交通方式 / 航班号</th><th>出行日期</th><th>行程(出发 → 到达)</th></tr></thead><tbody>${detailRows}</tbody></table>
    </div>
  </div>
</div>
</body>
</html>`;

const outPath = path.join(scanDir, `报销看板-${dateTag}.html`);
fs.writeFileSync(outPath, html, 'utf8');
console.log('✅ 看板已生成:', outPath);
console.log(`   有效发票 ${validCount} 张 · 总额 ${fmt(total)} · 待处理 ${pending.length} 张`);
console.log(`   费用类别 ${catData.length} 类 · 项目 ${projData.length} 个 · 月份 ${monthData.length} 个`);
