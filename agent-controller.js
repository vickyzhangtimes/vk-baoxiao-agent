#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { requiredScopes, parseScopes, checkApprovals } = require('./lib/permission-gate');
const { makeRunId, createRecord, appendEvent, finishRecord } = require('./lib/run-journal');

const root = __dirname;
const rawArgs = process.argv.slice(2);
let planOnly = false;
let runId = null;
let approved = parseScopes(process.env.REIMBURSE_APPROVALS);
const pipelineArgs = [];

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (arg === '--plan') planOnly = true;
  else if (arg === '--run-id') runId = rawArgs[++i];
  else if (arg === '--approve') approved = [...new Set([...approved, ...parseScopes(rawArgs[++i])])];
  else pipelineArgs.push(arg);
}

function valueAfter(flag) {
  const idx = pipelineArgs.indexOf(flag);
  return idx >= 0 ? pipelineArgs[idx + 1] : null;
}

const folderPath = valueAfter('--folder');
const imagePath = valueAfter('--images');
if (folderPath && imagePath) {
  console.error('一次运行只能选择一种输入模式：--folder 或 --images。');
  process.exit(2);
}

const mode = folderPath ? 'folder' : imagePath ? 'images' : 'email';
const required = requiredScopes(mode);
const approval = checkApprovals(required, approved);
const explicitTag = valueAfter('--date-tag');
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const emailDates = pipelineArgs.filter(a => !a.startsWith('--') && a !== folderPath && a !== imagePath);
const dateTag = explicitTag || (mode === 'email'
  ? (String(emailDates[0] || '2026-01-01').replace(/-/g, '') + '-' + String(emailDates[1] || new Date().toISOString().slice(0, 10)).replace(/-/g, ''))
  : mode === 'folder' ? 'local-' + today : 'local-images-' + today);
runId = runId || makeRunId();
const recordFile = path.join(root, 'scan-results', 'runs', `${runId}.json`);
const input = mode === 'folder' ? { folder: path.resolve(folderPath) }
  : mode === 'images' ? { extractedJsonOrFolder: path.resolve(imagePath) }
    : { dateRange: pipelineArgs.filter(a => !a.startsWith('--')).slice(0, 2) };

createRecord(recordFile, {
  runId,
  mode,
  dateTag,
  input,
  requiredPermissions: required,
  approvedPermissions: approval.approved,
});

const plan = {
  runId,
  mode,
  dateTag,
  input,
  requiredPermissions: required,
  approvedPermissions: approval.approved,
  missingPermissions: approval.missing,
  runRecord: path.relative(root, recordFile),
};

console.log(JSON.stringify(plan, null, 2));
if (planOnly) {
  finishRecord(recordFile, approval.ok ? 'planned' : 'permission-required');
  process.exit(0);
}

if (!approval.ok) {
  finishRecord(recordFile, 'permission-required', { missingPermissions: approval.missing });
  console.error('\n未运行流水线。请审阅计划后显式授权：');
  console.error(`npm run agent -- ${pipelineArgs.join(' ')} --approve ${required.join(',')}`);
  process.exit(3);
}

if (mode === 'folder' && (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory())) {
  finishRecord(recordFile, 'invalid-input', { error: 'folder-not-found' });
  console.error(`输入文件夹不存在: ${folderPath}`);
  process.exit(2);
}
if (mode === 'images') {
  const abs = path.resolve(imagePath);
  const jsonPath = fs.existsSync(abs) && fs.statSync(abs).isDirectory()
    ? path.join(abs, 'extracted-invoices.json') : abs;
  if (!fs.existsSync(jsonPath)) {
    finishRecord(recordFile, 'vision-input-required', { expectedJson: jsonPath });
    console.error('图片模式需要多模态 Agent 先按 references/image-intake-schema.md 生成 extracted-invoices.json。');
    console.error(`预期位置: ${jsonPath}`);
    process.exit(4);
  }
}

appendEvent(recordFile, { type: 'controller', status: 'running', message: '权限已确认，启动确定性流水线' });
const child = spawnSync(process.execPath, [path.join(root, 'run-all.js'), ...pipelineArgs], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    REIMBURSE_AGENT_CONTROLLER: '1',
    REIMBURSE_APPROVED_SCOPES: approval.approved.join(','),
    REIMBURSE_RUN_ID: runId,
    REIMBURSE_RUN_RECORD: recordFile,
  },
});

if (child.error) {
  finishRecord(recordFile, 'failed', { error: child.error.message });
  console.error(child.error.message);
  process.exit(1);
}
const status = child.status === 0 ? 'completed' : 'failed';
finishRecord(recordFile, status, { exitCode: child.status });
console.log(`运行记录: ${recordFile}`);
process.exit(child.status == null ? 1 : child.status);
