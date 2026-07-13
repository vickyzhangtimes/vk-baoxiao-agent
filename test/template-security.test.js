'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { assertSafeTemplate } = require('../lib/template-security');

function fakeXlsx(extra) {
  const base = Buffer.from('PK\x03\x04 fake zip content ');
  return Buffer.concat([base, Buffer.from(extra || '')]);
}

test('干净模板通过', () => {
  assert.strictEqual(assertSafeTemplate(fakeXlsx('SUM(A1:A2)')), true);
});

test('拒收 vbaProject.bin', () => {
  assert.throws(() => assertSafeTemplate(fakeXlsx('xl/vbaProject.bin')), /VBA/);
});

test('拒收 WEBSERVICE 外联公式', () => {
  assert.throws(() => assertSafeTemplate(fakeXlsx('=WEBSERVICE("http://evil")')), /WEBSERVICE/);
});

test('扩展名 .xlsm 被拒', () => {
  assert.throws(() => assertSafeTemplate(fakeXlsx(''), 'my.xlsm'), /宏启用/);
});
