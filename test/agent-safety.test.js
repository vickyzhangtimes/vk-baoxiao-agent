'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { requiredScopes, checkApprovals } = require('../lib/permission-gate');
const { assertSafeChild, safeSegment } = require('../lib/path-guard');
const { assertAllowedRemoteUrl, isPrivateIp } = require('../lib/url-policy');

test('邮箱模式必须取得邮箱、网络、清理和写出授权', () => {
  const required = requiredScopes('email');
  assert.deepEqual(checkApprovals(required, required).missing, []);
  assert.ok(checkApprovals(required, ['mail.read']).missing.includes('network.download'));
});

test('路径守卫拒绝根目录、越界和非法片段', () => {
  const root = path.resolve('C:/safe-root');
  assert.equal(assertSafeChild(root, path.join(root, 'batch')), path.join(root, 'batch'));
  assert.throws(() => assertSafeChild(root, root), /根目录/);
  assert.throws(() => assertSafeChild(root, path.resolve(root, '..', 'escape')), /越过/);
  assert.throws(() => safeSegment('../escape'), /非法/);
});

test('URL 策略默认只允许公网 HTTPS', () => {
  assert.equal(assertAllowedRemoteUrl('https://example.com/invoice.pdf').protocol, 'https:');
  assert.throws(() => assertAllowedRemoteUrl('http://example.com/invoice.pdf'), /HTTPS/);
  assert.throws(() => assertAllowedRemoteUrl('https://127.0.0.1/a'), /私网/);
  assert.equal(isPrivateIp('192.168.1.2'), true);
});
