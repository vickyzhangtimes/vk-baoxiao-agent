#!/usr/bin/env node
/**
 * step4b-enrich-classify.js — 环节⑥.5 归类 enrichment v1.0
 *
 * 读取 invoice-final-{dateTag}.json，为每条记录补四个归类字段：
 *   category   费用类别（差旅交通/住宿/餐饮招待/办公采购/软件订阅/市场推广/其他）
 *   clientType 客户类型
 *   clientNo   客户编号
 *   projectNo  项目号
 *
 * 规则来源：
 *   config/expense-categories.json  —— 费用类别关键词推断
 *   config/project-mapping.json     —— 客户类型/编号/项目号 映射
 * 手动覆盖（优先于一切自动规则）：
 *   config/invoice-overrides.json    —— 按发票号覆盖
 *
 * 未匹配到项目映射的记录：clientNo 标「未分类」，并写入
 *   scan-results/attribution-tasks-{dateTag}.csv 供人工补归类。
 *
 * 就地写回 invoice-final-{dateTag}.json（每次重跑都会重新推导 + 套用 overrides）。
 *
 * 用法：
 *   node step4b-enrich-classify.js [dateTag]
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dateTag = args[0] || '';

const CATEGORIES = require('./config/expense-categories.json');
const PROJECT_MAP = require('./config/project-mapping.json');

function loadOverrides() {
  const file = path.join(__dirname, 'config', 'invoice-overrides.json');
  if (!fs.existsSync(file)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete data._说明;
    return data;
  } catch (e) {
    console.warn('⚠ 读取 invoice-overrides.json 失败，跳过手动覆盖: ' + e.message);
    return {};
  }
}
const OVERRIDES = loadOverrides();

// ===== 工具 =====
function findLatestFile(dir, prefix) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .filter(f => !dateTag || f.includes(dateTag))
    .sort().reverse();
  return files[0] || null;
}

function haystackOf(r) {
  return [
    r.seller || '',
    r.subject || '',
    (r.pdfText || '').slice(0, 500),
    r.buyer || '',
    r.notes || '',
  ].join(' ').toLowerCase();
}

function classifyCategory(r) {
  const hay = haystackOf(r);
  for (const rule of (CATEGORIES.rules || [])) {
    const kws = (rule.keywords || []).map(k => String(k).toLowerCase());
    if (kws.some(k => k && hay.includes(k))) return rule.category;
  }
  return CATEGORIES.default || '其他';
}

function classifyProject(r) {
  const hay = haystackOf(r);
  for (const rule of (PROJECT_MAP.rules || [])) {
    const matches = (rule.match || []).map(k => String(k).toLowerCase());
    if (matches.some(k => k && hay.includes(k))) {
      return {
        clientType: rule.clientType || PROJECT_MAP.defaultClientType || '',
        clientNo: rule.clientNo || '',
        projectNo: rule.projectNo || '',
        matched: true,
      };
    }
  }
  const fb = PROJECT_MAP.fallback || { clientType: '未分类', clientNo: '未分类', projectNo: '未分类' };
  return { ...fb, matched: false };
}

function parseMonth(invoiceDate) {
  if (!invoiceDate) return '';
  const m = String(invoiceDate).match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  const m2 = String(invoiceDate).match(/(\d{4})[-/](\d{1,2})/);
  if (m2) return `${m2[1]}-${m2[2].padStart(2, '0')}`;
  return '';
}

// ===== 同步归类结果回 invoice-table =====
// invoice-final 是 step4b 的「enriched」产出，下游 step5/step6 读它；
// 但 generate-dashboard / export-to-edrive 读的是 canonical 的 invoice-table。
// 若不回写，invoice-table 的 category 会永远是旧值，导致看板/导出分包错误。
// 这里把 6 个归类字段按 emailUid(优先)/invoiceNo 映射回 invoice-table，保证全链路一致。
function syncEnrichmentToTable(records, scanDir, finalFile) {
  if (!finalFile) return;
  const tableTag = finalFile.replace(/^invoice-final-/, '').replace(/\.json$/, '');
  const tableFile = path.join(scanDir, `invoice-table-${tableTag}.json`);
  if (!fs.existsSync(tableFile)) return;
  const ENRICH_FIELDS = ['category', 'clientType', 'clientNo', 'projectNo', 'attributionStatus', 'month',
    // 差旅结构化字段：step4 已从行程单抽出，必须同步回 canonical invoice-table，
    // 否则 dashboard / export 读 invoice-table 时看不到起点终点（防回归）
    'transportType', 'tripDate', 'fromStation', 'toStation', 'tripUncertain'];
  try {
    const tData = JSON.parse(fs.readFileSync(tableFile, 'utf8'));
    const tRecords = Array.isArray(tData) ? tData : (tData.data || []);
    const byUid = new Map(), byInv = new Map();
    for (const tr of tRecords) {
      if (tr.emailUid) byUid.set(String(tr.emailUid), tr);
      const ti = String(tr.invoiceNo || '').trim();
      if (ti && ti !== '-') byInv.set(ti, tr);
    }
    let synced = 0;
    for (const r of records) {
      let target = r.emailUid ? byUid.get(String(r.emailUid)) : null;
      if (!target) {
        const ri = String(r.invoiceNo || '').trim();
        if (ri && ri !== '-') target = byInv.get(ri) || null;
      }
      if (!target) continue;
      for (const f of ENRICH_FIELDS) target[f] = r[f];
      synced++;
    }
    fs.writeFileSync(tableFile, JSON.stringify(tData, null, 2), 'utf8');
    console.log('已同步归类字段回 invoice-table: ' + synced + ' 条');
  } catch (e) {
    console.warn('⚠ 同步归类回 invoice-table 失败（不影响 invoice-final）: ' + e.message);
  }
}

// ===== 主流程 =====
function enrich() {
  const scanDir = path.join(__dirname, 'scan-results');
  const finalFile = findLatestFile(scanDir, 'invoice-final-');
  if (!finalFile) {
    console.error('未找到 invoice-final 文件，请先运行 step4-merge-data.js');
    process.exit(1);
  }
  const filePath = path.join(scanDir, finalFile);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const records = data.data || [];

  // ===== 去重 pass =====
  // 重复判定（核心原则：宁多勿漏，避免误删真实账单）：
  //  - 有发票号(invoiceNo)：按发票号去重（同号=同张发票）。
  //  - 无发票号（H5 账单链接型，如中国移动）：按 emailUid 去重。
  //    关键坑：此类账单的门户链接是共享的（所有人都一样），金额也常跨月巧合相同，
  //    链接和金额都【不是】唯一标识。唯一可靠来源是 emailUid —— 每封邮件对应一张独立账单，
  //    只有「同一封邮件被重复处理（同 emailUid）」才视为重复。
  //    早期版本用「链接+金额」做签名，导致 6 张不同月话费被误合并成 3 张、丢了 3 张真实账单，已修正。
  // 这样两封邮件带同一张发票、或同号/同邮件被扫两次，每次重跑都会自动消重，且不会误伤不同账单。
  const before = records.length;
  const seen = new Set();
  const keep = [];
  for (const r of records) {
    const inv = String(r.invoiceNo || '').trim();
    let sig;
    if (inv && inv !== '-') sig = 'inv:' + inv;
    else {
      // 链接型 H5 发票（无发票号）：门户链接共享、金额可能跨月巧合相同，均非唯一标识。
      // 权威来源是 emailUid —— 每封邮件 = 一张独立账单，仅同 emailUid 视为重复。
      const uid = String(r.emailUid || '').trim();
      if (uid) {
        sig = 'uid:' + uid;
      } else {
        // 极端兜底：连 emailUid 都没有时，仅当 链接+金额+销售方+日期 全部一致才去重
        const link = String(r.notes || '').match(/https?:\/\/[^\s"']+/);
        const amt = Number(r.amount) || 0;
        sig = 'fallback:' + (link ? link[0] : '') + '|' + amt + '|' + String(r.seller || '').trim() + '|' + String(r.invoiceDate || '').trim();
      }
    }
    if (seen.has(sig)) continue;
    seen.add(sig);
    keep.push(r);
  }
  if (keep.length < before) {
    console.log(`去重：移除 ${before - keep.length} 条重复记录（按 发票号/邮件UID 判定）`);
    records.length = 0;
    keep.forEach((r) => records.push(r));
  }

  console.log('读取待归类记录: ' + records.length + ' 条 (' + finalFile + ')');

  let autoCount = 0, overrideCount = 0, manualCount = 0;
  const attributionTasks = [];

  for (const r of records) {
    // 费用类别
    let category = classifyCategory(r);
    // 项目归属
    const proj = classifyProject(r);
    let clientType = proj.clientType;
    let clientNo = proj.clientNo;
    let projectNo = proj.projectNo;
    let status = proj.matched ? 'auto' : 'manual';

    // 手动覆盖（按发票号）
    const ov = r.invoiceNo ? OVERRIDES[r.invoiceNo] : null;
    if (ov) {
      if (ov.category) category = ov.category;
      if (ov.clientType) clientType = ov.clientType;
      if (ov.clientNo) clientNo = ov.clientNo;
      if (ov.projectNo) projectNo = ov.projectNo;
      status = 'override';
    }

    r.category = category;
    r.clientType = clientType;
    r.clientNo = clientNo;
    r.projectNo = projectNo;
    r.attributionStatus = status; // auto | override | manual
    r.month = parseMonth(r.invoiceDate);

    if (status === 'override') overrideCount++;
    else if (status === 'auto') autoCount++;
    else manualCount++;

    if (status === 'manual') {
      attributionTasks.push({
        uid: r.emailUid || r.index,
        invoiceNo: r.invoiceNo || '',
        seller: r.seller || '',
        subject: r.subject || '',
        category: r.category,
        clientNo: r.clientNo,
        projectNo: r.projectNo,
        suggestedAction: '在 config/project-mapping.json 增加关键字规则，或在 config/invoice-overrides.json 按发票号指定',
      });
    }
  }

  // 写回
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  // 同步归类字段回 invoice-table，保证 dashboard / export 读 canonical 表时类别一致
  syncEnrichmentToTable(records, scanDir, finalFile);

  // 待归类清单
  const taskFile = path.join(scanDir, `attribution-tasks-${data.meta?.dateTag || dateTag || 'latest'}.csv`);
  const tHeaders = ['uid', 'invoiceNo', 'seller', 'subject', 'category', 'clientNo', 'projectNo', 'suggestedAction'];
  const tLines = [tHeaders.join(',')];
  for (const t of attributionTasks) {
    const row = tHeaders.map(h => {
      let v = (t[h] || '').toString().replace(/"/g, '""');
      return '"' + v + '"';
    });
    tLines.push(row.join(','));
  }
  fs.writeFileSync(taskFile, '\ufeff' + tLines.join('\n'), 'utf8');

  // 统计
  const byCategory = {};
  const byClient = {};
  for (const r of records) {
    byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    const key = `${r.clientNo}|${r.projectNo}`;
    byClient[key] = byClient[key] || { clientNo: r.clientNo, projectNo: r.projectNo, count: 0, total: 0 };
    byClient[key].count++;
    if (r.amount) byClient[key].total += parseFloat(r.amount);
  }

  console.log('');
  console.log('━━━ 归类完成 ━━━');
  console.log('自动归类: ' + autoCount + ' | 手动覆盖: ' + overrideCount + ' | 待归类(未分类): ' + manualCount);
  console.log('');
  console.log('━━━ 按费用类别 ━━━');
  for (const [c, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + c + ': ' + n);
  }
  console.log('');
  console.log('━━━ 按客户/项目 ━━━');
  for (const k of Object.keys(byClient).sort()) {
    const c = byClient[k];
    console.log(`  ${c.clientNo} / ${c.projectNo}: ${c.count}张, ¥${c.total.toFixed(2)}`);
  }
  console.log('');
  console.log('✅ 已写回: ' + finalFile);
  if (attributionTasks.length > 0) {
    console.log(`⚠ 有 ${attributionTasks.length} 条未归类，已写入待归类清单: ` + path.basename(taskFile));
  } else {
    console.log('✅ 全部记录已归类，无需人工补录');
  }
}

enrich();
