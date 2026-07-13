'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateStarterTemplate } = require('../lib/starter-template');
const store = require('../lib/template-store');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-store-'));
}

test('saveTemplate 隔离不同 user/name，互不可见', async () => {
  const root = tmpRoot();
  process.env.TEMPLATES_ROOT = root;
  try {
    const { buffer: buf } = await generateStarterTemplate({});
    store.saveTemplate({ user: 'alice', name: 'std', buffer: buf, meta: { rollup: 'flat' } });
    store.saveTemplate({ user: 'bob', name: 'std', buffer: buf, meta: { rollup: 'byCategory' } });
    assert.deepStrictEqual(store.listTemplates('alice'), ['std']);
    assert.deepStrictEqual(store.listTemplates('bob'), ['std']);
    const a = store.resolveTemplate({ user: 'alice', name: 'std' });
    const b = store.resolveTemplate({ user: 'bob', name: 'std' });
    assert.notStrictEqual(a.buffer, b.buffer);
    assert.strictEqual(a.meta.rollup, 'flat');
    assert.strictEqual(b.meta.rollup, 'byCategory');
  } finally { delete process.env.TEMPLATES_ROOT; fs.rmSync(root, { recursive: true, force: true }); }
});

test('版本递增：默认取最新，可指定历史版本重跑', async () => {
  const root = tmpRoot();
  process.env.TEMPLATES_ROOT = root;
  try {
    const v1 = store.saveTemplate({ user: 'u', name: 't', buffer: (await generateStarterTemplate({})).buffer }).version;
    assert.strictEqual(v1, 1);
    const v2 = store.saveTemplate({ user: 'u', name: 't', buffer: (await generateStarterTemplate({})).buffer }).version;
    assert.strictEqual(v2, 2);
    assert.strictEqual(store.resolveTemplate({ user: 'u', name: 't' }).version, 2);
    assert.strictEqual(store.resolveTemplate({ user: 'u', name: 't', version: 1 }).version, 1);
    assert.strictEqual(store.latestVersion('u', 't'), 2);
  } finally { delete process.env.TEMPLATES_ROOT; fs.rmSync(root, { recursive: true, force: true }); }
});

test('saveTemplate 拒收宏扩展名', async () => {
  const root = tmpRoot();
  process.env.TEMPLATES_ROOT = root;
  try {
    const { buffer: buf } = await generateStarterTemplate({});
    assert.throws(() => store.saveTemplate({ user: 'u', name: 'evil.xlsm', buffer: buf }), /宏启用/);
  } finally { delete process.env.TEMPLATES_ROOT; fs.rmSync(root, { recursive: true, force: true }); }
});

test('resolveTemplate 对不存在的模板抛错', () => {
  const root = tmpRoot();
  process.env.TEMPLATES_ROOT = root;
  try {
    assert.throws(() => store.resolveTemplate({ user: 'ghost', name: 'nope' }), /模板不存在/);
  } finally { delete process.env.TEMPLATES_ROOT; fs.rmSync(root, { recursive: true, force: true }); }
});
