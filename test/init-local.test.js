'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initialize } = require('../scripts/init-local');

test('本地初始化创建必要目录且不覆盖已有配置', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reimburse-init-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'package-config.example.js'), "module.exports={claimer:'example'};\n");

  initialize(root);
  const localConfig = path.join(root, 'config', 'package-config.js');
  assert.equal(fs.existsSync(localConfig), true);
  assert.equal(fs.existsSync(path.join(root, 'input-invoices')), true);
  fs.writeFileSync(localConfig, "module.exports={claimer:'mine'};\n");

  initialize(root);
  assert.match(fs.readFileSync(localConfig, 'utf8'), /mine/);
  fs.rmSync(root, { recursive: true, force: true });
});
