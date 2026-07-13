const test = require('node:test');
const assert = require('node:assert');
const { isFatalError } = require('../lib/error-classify');

test('良性噪声: "Connection closed." 不致命', () => {
  assert.strictEqual(isFatalError(new Error('Connection closed.')), false);
});

test('良性噪声: "Unexpected socket close" 不致命', () => {
  assert.strictEqual(isFatalError(new Error('Unexpected socket close')), false);
});

test('良性噪声: "Stream is closed" 不致命', () => {
  assert.strictEqual(isFatalError(new Error('Stream is closed')), false);
});

test('良性噪声作为字符串 reason 不致命', () => {
  assert.strictEqual(isFatalError('Connection closed.'), false);
});

test('致命: 文件不存在 ENOENT 致命', () => {
  assert.strictEqual(isFatalError(new Error('ENOENT: no such file or directory')), true);
});

test('致命: 缺失环境变量 致命', () => {
  assert.strictEqual(isFatalError(new Error('Missing required environment variable')), true);
});

test('致命: IMAP 连接/认证失败 致命', () => {
  assert.strictEqual(isFatalError(new Error('Invalid credentials')), true);
});

test('致命: 未知业务错误 默认致命', () => {
  assert.strictEqual(isFatalError(new Error('boom')), true);
});

test('致命: 字符串 reason 默认致命', () => {
  assert.strictEqual(isFatalError('unexpected rejection'), true);
});

test('致命: 裸对象 reason 默认致命', () => {
  assert.strictEqual(isFatalError({ code: 'EIO' }), true);
});
