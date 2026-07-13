'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TOKENS, TOKEN_DEFS, parseTokens, validateTokens } = require('../lib/token-dictionary');

test('白名单含核心 token', () => {
  for (const t of ['报销人', '发票号码', '价税合计', '合计小写', '合计大写', '审批人', '出纳']) {
    assert.ok(TOKENS.includes(t), '缺 token: ' + t);
  }
});

test('parseTokens 提取占位符（含空格）', () => {
  assert.deepEqual(parseTokens('{{报销人}} 和 {{ 发票号码 }}'), ['报销人', '发票号码']);
});

test('parseTokens 无 token 返回空', () => {
  assert.deepEqual(parseTokens('普通文本 123'), []);
});

test('validateTokens 区分合法/非法', () => {
  const r = validateTokens(['发票号码', '报销人', '未知字段X']);
  assert.deepEqual(r.valid.sort(), ['发票号码', '报销人']);
  assert.deepEqual(r.invalid, ['未知字段X']);
});

test('TOKEN_DEFS 作用域齐全', () => {
  const scopes = new Set(Object.values(TOKEN_DEFS).map(d => d.scope));
  for (const s of ['meta', 'row', 'aggregate', 'sign']) assert.ok(scopes.has(s), '缺作用域: ' + s);
});
