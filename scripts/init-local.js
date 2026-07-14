#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function copyIfMissing(source, target, actions) {
  if (fs.existsSync(target)) {
    actions.push({ status: 'kept', target });
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  actions.push({ status: 'created', target });
}

function initialize(root = path.join(__dirname, '..')) {
  const actions = [];
  copyIfMissing(
    path.join(root, 'config', 'package-config.example.js'),
    path.join(root, 'config', 'package-config.js'),
    actions,
  );

  for (const relative of ['input-invoices', 'scan-results', 'agent-memory']) {
    const target = path.join(root, relative);
    if (fs.existsSync(target)) actions.push({ status: 'kept', target });
    else {
      fs.mkdirSync(target, { recursive: true });
      actions.push({ status: 'created', target });
    }
  }
  return actions;
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  console.log('初始化本地报销工作区（不会覆盖已有配置）\n');
  for (const item of initialize(root)) {
    console.log(`${item.status === 'created' ? 'CREATE' : 'KEEP  '} ${path.relative(root, item.target)}`);
  }
  console.log('\n下一步：');
  console.log('1. 编辑 config/package-config.js，填写报销人、公司抬头和审批信息。');
  console.log('2. 把 PDF 放入 input-invoices/，或准备其他绝对路径。');
  console.log('3. 运行 npm run doctor -- --mode folder。');
  console.log('4. 先执行 npm run agent -- --folder input-invoices --plan。');
}

module.exports = { initialize };
