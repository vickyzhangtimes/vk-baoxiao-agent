#!/usr/bin/env node
/**
 * run-all.js — 报销流水线编排器 v2（智能闭环）
 *
 * 三种运行模式：
 *   npm run run                      智能模式（默认）：基于文件 mtime 脏检查 + 链式传导，
 *                                     只重算「上游比自己新」的节点，自动延伸到 export/dashboard。
 *                                     改了识别规则 / 分类配置 / 手动 override → 自动全链路重算。
 *   npm run run -- --full            强制全量重跑（从头到尾，兼容旧行为）
 *   npm run run -- --from step4      从指定步骤续跑到底（不重扫邮箱/下载）
 *   npm run run -- --force-extract   重跑提取时清 pdf-text 缓存，让改了的识别规则生效
 *   npm run run -- --folder "<路径>"  文件夹模式：直接读本地 PDF，跳过邮箱三步
 *   npm run run -- --images "<路径>"  图片模式：读 AI 抽取的 JSON（extracted-invoices.json），跳过邮箱三步+抽取
 *
 * 智能闭环原理：每个步骤声明 inputs/outputs（+代码依赖），run-all 比对上游 mtime 是否比
 * 本步输出新；一旦某步脏，其后全部脏（严格链式依赖），自动重算到 export/dashboard。
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { isStepDirty } = require('./lib/pipeline-dirty');
const fs = require('fs');
const os = require('os');
const { loadDotEnv } = require('./lib/env');
const { buildTemplateRenderStep } = require('./lib/pipeline-template-step');
const { appendEvent } = require('./lib/run-journal');
const { safeSegment } = require('./lib/path-guard');

if (process.env.REIMBURSE_AGENT_CONTROLLER !== '1') {
  console.error('run-all.js 是内部确定性流水线，请通过 `npm run agent -- ...` 启动并完成权限确认。');
  console.error('仅限开发调试时可显式设置 REIMBURSE_AGENT_CONTROLLER=1。');
  process.exit(3);
}

loadDotEnv();

// ---- flag 解析 ----
const args = process.argv.slice(2);
let folderMode = false, folderPath = null, dateTagOverride = null;
let imageMode = false, imagePath = null;
let fromStep = null, forceExtract = false, fullMode = false;
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--folder') { folderMode = true; folderPath = args[++i]; }
  else if (args[i] === '--images') { imageMode = true; imagePath = args[++i]; }
  else if (args[i] === '--date-tag') { dateTagOverride = args[++i]; }
  else if (args[i] === '--from') { fromStep = args[++i]; }
  else if (args[i] === '--force-extract') { forceExtract = true; }
  else if (args[i] === '--full') { fullMode = true; }
  else positional.push(args[i]);
}

// Guardrail: --date-tag only works in --folder / --images mode.
// Fail fast to avoid users assuming dateTag has taken effect in normal email mode.
if (dateTagOverride && !(folderMode || imageMode)) {
  console.error('参数错误: --date-tag 仅在 --folder / --images 模式下生效。');
  console.error('请使用: npm run run -- --folder "<路径>" --date-tag <tag>');
  process.exit(2);
}

const startDate = positional[0] || '2026-01-01';
const endDate = positional[1] || new Date().toISOString().split('T')[0];
let dateTag = startDate.replace(/-/g, '') + '-' + endDate.replace(/-/g, '');
if (folderMode) {
  if (!folderPath) { console.error('文件夹模式需要路径: npm run run -- --folder "<路径>"'); process.exit(1); }
  dateTag = dateTagOverride || ('local-' + new Date().toISOString().slice(0, 10).replace(/-/g, ''));
}
if (imageMode) {
  if (!imagePath) { console.error('图片模式需要路径: npm run run -- --images "<路径>"'); process.exit(1); }
  dateTag = dateTagOverride || ('local-images-' + new Date().toISOString().slice(0, 10).replace(/-/g, ''));
}
const root = __dirname;
const scanDir = path.join(root, 'scan-results');

// export 输出目录（与 export-to-edrive.js 同公式，用于脏检查）
const REIMBURSE_ROOT = process.env.REIMBURSE_ROOT || path.join(os.homedir(), '报销');
const BATCH_DATE = safeSegment(process.env.BATCH_DATE || new Date().toISOString().slice(0, 10), 'BATCH_DATE');
const PERIOD_LABEL = safeSegment(process.env.PERIOD_LABEL || '报销批次', 'PERIOD_LABEL');
const batchDir = path.join(REIMBURSE_ROOT, `${BATCH_DATE}_${PERIOD_LABEL}`);

// ---- 路径快捷 ----
const emailsFile = path.join(scanDir, 'emails', `emails-${dateTag}.json`);
const classifiedFile = path.join(scanDir, 'classified', `classified-${dateTag}.json`);
const stagingPdfs = path.join(scanDir, 'staging', dateTag, 'pdfs');
const downloadFile = path.join(scanDir, 'downloads', `download-results-${dateTag}.json`);
const pdfTextFile = path.join(scanDir, `pdf-text-${dateTag}.json`);
const invoiceFinalFile = path.join(scanDir, `invoice-final-${dateTag}.json`);
const invoiceTableFile = path.join(scanDir, `invoice-table-${dateTag}.json`);
const manualCsv = path.join(scanDir, `manual-tasks-${dateTag}.csv`);
const attrCsv = path.join(scanDir, `attribution-tasks-${dateTag}.csv`);
const ledgerXlsx = path.join(scanDir, `发票台账-${dateTag}.xlsx`);
const reimbXlsx = path.join(scanDir, `报销单-${dateTag}.xlsx`);
const dashboardHtml = path.join(scanDir, `报销看板-${dateTag}.html`);
const archiveDir = path.join(root, 'archive');

// 代码依赖：改了这些文件 → 相关步骤需重算（解决「改识别规则不生效」）
const CODE = {
  extract: [path.join(root, 'step3-extract-pdf.js'), path.join(root, 'lib/extract-travel.js'), path.join(root, 'config/BUYER_MAP.js')],
  enrich: [path.join(root, 'step4b-enrich-classify.js'), path.join(root, 'config/expense-categories.json'), path.join(root, 'config/project-mapping.json'), path.join(root, 'config/invoice-overrides.json')],
  ledger: [path.join(root, 'step5-generate-ledger.js')],
  reimbursement: [path.join(root, 'step6-generate-reimbursement.js')],
  buildTable: [path.join(root, 'build-invoice-table.js'), path.join(root, 'lib/apply-overrides.js')],
  export: [path.join(root, 'export-to-edrive.js'), path.join(root, 'lib/load-package-config.js')],
  dashboard: [path.join(root, 'generate-dashboard.js')],
};

// ---- 步骤定义（inputs/outputs 用于脏检查）----
function stepExtract() {
  return {
    key: 'extract', label: 'Step 4/12 extract PDF text', script: 'step3-extract-pdf.js',
    args: [dateTag],
    inputs: [stagingPdfs, downloadFile, path.join(root, 'step3-extract-pdf.js'), ...CODE.extract],
    outputs: [pdfTextFile],
  };
}
function commonTail() {
  const head = [
    { key: 'merge', label: 'Step 5/12 merge by UID', script: 'step4-merge-data.js', args: [dateTag],
      inputs: [emailsFile, classifiedFile, downloadFile, pdfTextFile, path.join(root, 'step4-merge-data.js')], outputs: [invoiceFinalFile, manualCsv, attrCsv] },
    { key: 'enrich', label: 'Step 6/12 enrich & classify', script: 'step4b-enrich-classify.js', args: [dateTag],
      inputs: [invoiceFinalFile, ...CODE.enrich], outputs: [invoiceFinalFile, invoiceTableFile] },
    { key: 'ledger', label: 'Step 7/12 Excel ledger', script: 'step5-generate-ledger.js', args: [dateTag],
      inputs: [invoiceFinalFile, ...CODE.ledger], outputs: [ledgerXlsx] },
    { key: 'reimbursement', label: 'Step 8/12 reimbursement form', script: 'step6-generate-reimbursement.js', args: [dateTag],
      inputs: [invoiceFinalFile, ...CODE.reimbursement], outputs: [reimbXlsx] },
  ];
  // 模板报销单：配置 REIMBURSEMENT_TEMPLATE=user/name[:version] 才接入（并列于 step6，不替换）
  const tpl = buildTemplateRenderStep({ root, scanDir, dateTag, invoiceFinalFile });
  const tail = [
    { key: 'archive', label: 'Step 9/12 archive PDFs', script: 'archive-invoices.js', args: [dateTag],
      inputs: [invoiceFinalFile, downloadFile, archiveDir, path.join(root, 'archive-invoices.js')], outputs: [path.join(archiveDir, 'index.html')] },
    { key: 'build-table', label: 'Step 10/12 canonical table', script: 'build-invoice-table.js', args: [dateTag],
      inputs: [invoiceFinalFile, pdfTextFile, archiveDir, ...CODE.buildTable], outputs: [invoiceTableFile] },
    { key: 'export', label: 'Step 11/12 export package', script: 'export-to-edrive.js', args: [dateTag],
      inputs: [invoiceTableFile, invoiceFinalFile, ledgerXlsx, reimbXlsx, ...CODE.export], outputs: [batchDir] },
    { key: 'dashboard', label: 'Step 12/12 dashboard', script: 'generate-dashboard.js', args: [dateTag],
      inputs: [invoiceTableFile, ...CODE.dashboard], outputs: [dashboardHtml] },
  ];
  return tpl ? [...head, tpl, ...tail] : [...head, ...tail];
}
function buildSteps() {
  if (folderMode) {
    return [
      { key: 'ingest', label: 'Ingest local folder', script: 'ingest-folder.js', args: [folderPath, dateTag],
        inputs: [folderPath, path.join(root, 'ingest-folder.js')], outputs: [emailsFile, classifiedFile, downloadFile, stagingPdfs] },
      stepExtract(),
      ...commonTail(),
    ];
  }
  if (imageMode) {
    // 图片模式：视觉识别由 agent 完成，ingest-images 一次性合成 4 个中间产物，
    // 跳过邮箱三步 + step3 抽取（无 PDF 可抽，否则会清空我们产出的 pdf-text）。
    const imgArg = (fs.existsSync(imagePath) && fs.statSync(imagePath).isDirectory())
      ? path.join(imagePath, 'extracted-invoices.json') : imagePath;
    return [
      { key: 'ingest-images', label: 'Ingest images (AI-extracted)', script: 'ingest-images.js', args: [imgArg, dateTag],
        inputs: [imgArg, path.join(root, 'ingest-images.js'), path.join(root, 'lib', 'ingest-images.js')],
        outputs: [emailsFile, classifiedFile, downloadFile, pdfTextFile] },
      ...commonTail(),
    ];
  }
  return [
    { key: 'scan', label: 'Step 1/12 scan emails', script: 'step1-email-scan.js', args: [startDate, endDate],
      inputs: [path.join(root, 'step1-email-scan.js')], outputs: [emailsFile] },
    { key: 'classify', label: 'Step 2/12 classify', script: 'step2-classify-invoices.js', args: [emailsFile, dateTag],
      inputs: [emailsFile, path.join(root, 'step2-classify-invoices.js')], outputs: [classifiedFile] },
    { key: 'download', label: 'Step 3/12 download', script: 'step2-download-pdf.js', args: [classifiedFile, dateTag],
      inputs: [classifiedFile, path.join(root, 'step2-download-pdf.js')], outputs: [stagingPdfs, downloadFile] },
    stepExtract(),
    ...commonTail(),
  ];
}

// ---- 脏检查 ----
function mtime(p) { try { return fs.statSync(p).mtimeMs; } catch (e) { return 0; } }
function isDirty(s) {
  return isStepDirty(fs, s);
}

// ---- 步骤执行 ----
function runStep(label, script, scriptArgs, key) {
  console.log(`\n[${label}] node ${script} ${scriptArgs.join(' ')}`);
  appendEvent(process.env.REIMBURSE_RUN_RECORD, { type: 'step', key, label, status: 'running' });
  const childEnv = Object.assign({}, process.env);
  // 流水线批量清理可再生工作目录时，移除 safe-delete shim 的环境变量（仍安全移入回收站，不崩溃）
  delete childEnv.CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR;
  delete childEnv.CODEBUDDY_TOOL_CALL_ID;
  const result = spawnSync(process.execPath, [path.join(root, script), ...scriptArgs], {
    cwd: root, stdio: 'inherit', env: childEnv,
    // D3: 按步 key 可配超时；download 步（邮箱批量下载）默认放宽到 60 分钟，避免大邮箱被全局 15 分钟超时被 kill（表现为「跑一半死」）
    timeout: Number(process.env['STEP_TIMEOUT_MS_' + (key ? key.toUpperCase() : 'X')] || process.env.PIPELINE_STEP_TIMEOUT_MS || (key === 'download' ? 3600000 : 900000)),
  });
  if (result.error) {
    appendEvent(process.env.REIMBURSE_RUN_RECORD, { type: 'step', key, label, status: 'failed', error: result.error.message });
    console.error(`${label} failed: ${result.error.message}`); return false;
  }
  if (result.status !== 0) {
    appendEvent(process.env.REIMBURSE_RUN_RECORD, { type: 'step', key, label, status: 'failed', exitCode: result.status });
    console.error(`${label} exited with code ${result.status}`); return false;
  }
  appendEvent(process.env.REIMBURSE_RUN_RECORD, { type: 'step', key, label, status: 'completed' });
  return true;
}

// ---- 主流程 ----
console.log('Email invoice pipeline (smart mode)');
console.log(`Date range: ${startDate} ~ ${endDate}`);
console.log(`Date tag: ${dateTag}${folderMode ? ' (folder mode)' : ''}${imageMode ? ' (image mode)' : ''}${fullMode ? ' (--full)' : ''}${forceExtract ? ' (--force-extract)' : ''}${fromStep ? ' (--from ' + fromStep + ')' : ''}`);

const steps = buildSteps();

// 模板报销单产物：挂到 export 的依赖（改模板/代码 → 重渲后需重导出），并加入产物校验
const tplStep = steps.find(s => s.key === 'template-render');
if (tplStep) {
  const exportStep = steps.find(s => s.key === 'export');
  if (exportStep) exportStep.inputs.push(tplStep.outputs[0]);
}

// 1) 智能脏检查 + 链式传导
let chain = false;
for (const s of steps) {
  s._dirty = fullMode ? true : (chain || isDirty(s));
  if (forceExtract && s.key === 'extract') s._dirty = true; // --force-extract 强制重抽
  // pdf-text 是缓存产物：extract 一旦脏（代码改了 / PDF 新增），必须清缓存重抽，
  // 否则 step3 内部的「同名缓存命中跳过」会跳过重抽，改识别规则不生效（断链①治本）
  if (s.key === 'extract' && s._dirty && !s.args.includes('--force')) s.args.push('--force');
  if (s._dirty) chain = true;
}
// 2) --from 截断：从指定步起强制跑
let reached = !fromStep;
for (const s of steps) {
  if (fromStep && s.key === fromStep) reached = true;
  s._run = reached && (fromStep ? true : s._dirty);
}

if (!fullMode && !fromStep) {
  const dirtyCount = steps.filter(s => s._dirty).length;
  console.log(`Smart mode: ${dirtyCount}/${steps.length} steps need recompute (others skip)`);
}

let completed = 0;
for (const s of steps) {
  if (!s._run) { console.log(`\n[skip] ${s.label} — up-to-date`); continue; }
  if (!runStep(s.label, s.script, s.args, s.key)) {
    console.error(`\n❌ 步骤失败，流水线中止: ${s.label}`);
    console.error('   修复后重新运行即可从脏点续跑（智能脏检查会自动重算受影响的下游步骤）。');
    process.exit(1);
  }
  completed++;
}

// ---- 产物校验 ----
const expected = [
  ['Email scan', emailsFile], ['Classification', classifiedFile],
  ['Staging PDFs', stagingPdfs], ['Download report', downloadFile],
  ['PDF extraction', pdfTextFile], ['Merged invoices', invoiceFinalFile],
  ['Manual tasks', manualCsv], ['Attribution tasks', attrCsv],
  ['Excel ledger', ledgerXlsx], ['Reimbursement form', reimbXlsx],
  ['Archive index', path.join(archiveDir, 'index.html')],
  ['Canonical invoice table', invoiceTableFile], ['Dashboard', dashboardHtml],
  ...(tplStep ? [['Template reimbursement form', tplStep.outputs[0]]] : []),
];
console.log('\nPipeline completed. Output check:');
let missing = 0;
for (const [label, file] of expected) {
  const ok = fs.existsSync(file);
  console.log(`${ok ? 'OK  ' : 'MISS'} ${label}: ${path.relative(root, file)}`);
  if (!ok) missing++;
}
if (missing > 0) {
  console.error(`\n❌ 有 ${missing} 个产物缺失，流水线视为失败（exit 1）。`);
  process.exit(1);
}
console.log(`\n✅ Pipeline completed successfully (${completed}/${steps.length} steps ran).`);
process.exit(0);
