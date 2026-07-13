#!/usr/bin/env node
'use strict';
/**
 * render-reimbursement.js — 模板驱动的报销单渲染入口（P3）
 *
 * 与 step6 的硬编码生成互补：本脚本用「用户模板 + canonical 数据契约」生成报销单。
 * - 模板来自 lib/template-store（templates/<user>/<name>/<version>/）
 * - 支持按版本选择（旧批次可指定旧模板重跑）
 * - 支持 rollup（flat/byCategory/byDay，meta.rollup 声明）
 * - 渲染前做 P4 安全校验（拒收宏 / 外联）
 *
 * 用法：
 *   node render-reimbursement.js --user <id> --name <模板名> \
 *        [--version <n>] [--dateTag <tag>] [--input <invoice-final.json>] [--output <file.xlsx>]
 */

const fs = require('fs');
const path = require('path');
const { loadPackageConfig } = require('./lib/load-package-config');
const { buildContract } = require('./lib/build-contract');
const { groupRows } = require('./lib/rollup');
const { resolveTemplate } = require('./lib/template-store');
const { renderTemplate } = require('./lib/render-template');

function findLatestFile(dir, prefix, dateTag) {
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .filter(f => !dateTag || f.includes(dateTag))
    .sort().reverse()[0] || null;
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user') o.user = argv[++i];
    else if (a === '--name') o.name = argv[++i];
    else if (a === '--version') o.version = parseInt(argv[++i], 10);
    else if (a === '--dateTag') o.dateTag = argv[++i];
    else if (a === '--input') o.input = argv[++i];
    else if (a === '--output') o.output = argv[++i];
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.user || !o.name) {
    console.error('用法: node render-reimbursement.js --user <id> --name <模板名> [--version <n>] [--dateTag <tag>] [--input <invoice-final.json>] [--output <file.xlsx>]');
    process.exit(2);
  }

  // 定位 invoice-final 数据
  let invoiceFinalPath = o.input;
  if (!invoiceFinalPath) {
    const dataDir = path.join(__dirname, 'data');
    const found = findLatestFile(dataDir, 'invoice-final-', o.dateTag);
    if (!found) { console.error('找不到 invoice-final-*.json（用 --input 指定）'); process.exit(3); }
    invoiceFinalPath = path.join(dataDir, found);
  }
  const invoiceFinal = JSON.parse(fs.readFileSync(invoiceFinalPath, 'utf8'));

  // 报销包元数据：缺失则降级为空对象（不阻断渲染）
  let pkg = {};
  try { pkg = loadPackageConfig(); } catch (e) { pkg = {}; }

  const contract = buildContract(invoiceFinal, pkg);
  const { buffer, meta, version } = resolveTemplate({ user: o.user, name: o.name, version: o.version });
  const rows = groupRows(contract.rows, meta.rollup);
  const contractForRender = Object.assign({}, contract, { rows });
  const out = await renderTemplate(contractForRender, buffer);

  const output = o.output || path.join(__dirname, `报销单-${contract.meta.dateTag || 'out'}.xlsx`);
  fs.writeFileSync(output, out);
  console.log(`已生成报销单: ${output}（模板 ${o.user}/${o.name}@${version}, rollup=${meta.rollup}, ${rows.length} 行）`);
}

if (require.main === module) {
  main().catch(e => { console.error('渲染失败:', e.message); process.exit(1); });
}

module.exports = { main, parseArgs, findLatestFile };
