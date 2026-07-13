'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toChineseAmount } = require('../lib/chinese-amount');

test('零', () => { assert.equal(toChineseAmount(0), '零元整'); });
test('整数百位', () => { assert.equal(toChineseAmount(100), '壹佰元整'); });
test('113', () => { assert.equal(toChineseAmount(113), '壹佰壹拾叁元整'); });
test('壹万零壹（跨节零）', () => { assert.equal(toChineseAmount(10001), '壹万零壹元整'); });
test('壹万壹仟', () => { assert.equal(toChineseAmount(11000), '壹万壹仟元整'); });
test('壹亿', () => { assert.equal(toChineseAmount(100000000), '壹亿元整'); });
test('壹亿零壹（跨节零）', () => { assert.equal(toChineseAmount(100000001), '壹亿零壹元整'); });
test('壹佰万', () => { assert.equal(toChineseAmount(1000000), '壹佰万元整'); });
test('小数 角分', () => { assert.equal(toChineseAmount(116.55), '壹佰壹拾陆元伍角伍分'); });
test('小数 元零分', () => { assert.equal(toChineseAmount(100.01), '壹佰元零壹分'); });
test('小数 伍角', () => { assert.equal(toChineseAmount(0.5), '伍角'); });
test('小数 伍分', () => { assert.equal(toChineseAmount(0.05), '伍分'); });
test('大数 123456789.99', () => {
  assert.equal(toChineseAmount(123456789.99), '壹亿贰仟叁佰肆拾伍万陆仟柒佰捌拾玖元玖角玖分');
});
test('负数', () => { assert.equal(toChineseAmount(-213), '负贰佰壹拾叁元整'); });
test('非数字返回空串', () => { assert.equal(toChineseAmount('abc'), ''); });
