#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadDotEnv } = require('../lib/env');

loadDotEnv();

const root = path.join(__dirname, '..');
const rawMode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'folder';
const mode = String(rawMode || '').toLowerCase();
if (!['folder', 'email', 'images'].includes(mode)) {
  console.error('Usage: npm run doctor -- --mode folder|email|images');
  process.exit(2);
}
const checks = [];

function add(name, ok, detail, required = true) {
  checks.push({ name, ok, detail, required });
}

add('Node.js >= 18', Number(process.versions.node.split('.')[0]) >= 18, process.version);
add('package.json exists', fs.existsSync(path.join(root, 'package.json')), 'package.json');
add('local package config', fs.existsSync(path.join(root, 'config', 'package-config.js')), 'run npm run init, then edit config/package-config.js', false);

if (mode === 'email') {
  add('.env exists', fs.existsSync(path.join(root, '.env')), 'run npm run setup');
  add('IMAP_USER configured', Boolean(process.env.IMAP_USER), 'required for live mailbox runs');
  add('IMAP_PASSWORD configured', Boolean(process.env.IMAP_PASSWORD), 'required for live mailbox runs');
  add('TLS certificate verification', String(process.env.IMAP_REJECT_UNAUTHORIZED || 'true') !== 'false', 'must remain true for real mailboxes');
}

for (const dep of ['imap', 'mailparser', 'pdf2json', 'exceljs', 'iconv-lite']) {
  try {
    require.resolve(dep, { paths: [root] });
    add(`dependency ${dep}`, true, dep);
  } catch {
    add(`dependency ${dep}`, false, 'run npm install');
  }
}

let failed = 0;
for (const c of checks) {
  if (!c.ok && c.required) failed++;
  const label = c.ok ? 'OK  ' : c.required ? 'FAIL' : 'NOTE';
  console.log(`${label} ${c.name} - ${c.detail}`);
}

if (failed) {
  console.error(`\nDoctor found ${failed} blocking issue(s) for ${mode} mode.`);
  process.exit(1);
}

if (mode === 'images') {
  console.log('\nDoctor passed for images mode. The host vision agent must still create extracted-invoices.json.');
} else {
  console.log(`\nDoctor passed for ${mode} mode.`);
}
