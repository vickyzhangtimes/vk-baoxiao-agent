#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const jsonFiles = [
  'config/expense-categories.json',
  'config/project-mapping.json',
  'config/invoice-overrides.json',
];

let failed = 0;
for (const relative of jsonFiles) {
  const file = path.join(root, relative);
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
    console.log(`OK   ${relative}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${relative}: ${error.message}`);
  }
}

const optionalJson = 'config/mailboxes.json';
if (fs.existsSync(path.join(root, optionalJson))) {
  try {
    JSON.parse(fs.readFileSync(path.join(root, optionalJson), 'utf8'));
    console.log(`OK   ${optionalJson}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${optionalJson}: ${error.message}`);
  }
}

for (const relative of ['config/package-config.example.js', 'config/package-config.js']) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;
  try {
    delete require.cache[require.resolve(file)];
    const cfg = require(file);
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('must export an object');
    console.log(`OK   ${relative}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${relative}: ${error.message}`);
  }
}

if (failed) process.exit(1);
console.log('\n配置文件语法检查通过。');
