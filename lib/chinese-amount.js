'use strict';
/**
 * lib/chinese-amount.js — 精确中文大写金额转换（替代 step6 的「简版」）
 *
 * 规则：
 *  - 按 4 位分组映射 万/亿/兆 节，正确处理 百万/千万/壹亿零壹 等跨节零。
 *  - 小数到 角/分，四舍五入至分。
 *  - 纯函数，无依赖，可单测。
 */

function toChineseAmount(money) {
  if (money == null || money === '' || isNaN(money)) return '';
  const neg = money < 0;
  money = Math.abs(Number(money));

  let integer = Math.floor(money);
  let decimal = Math.round((money - integer) * 100);
  if (decimal === 100) { integer += 1; decimal = 0; }
  const jiao = Math.floor(decimal / 10);
  const fen = decimal % 10;

  if (integer === 0 && jiao === 0 && fen === 0) return '零元整';

  const cnNums = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const cnGroupUnits = ['', '万', '亿', '兆'];
  const intUnits = ['', '拾', '佰', '仟'];

  function fourToChinese(num) {
    if (num === 0) return '';
    let s = '';
    const ds = String(num).padStart(4, '0').split('').map(Number);
    let zeroFlag = false;
    for (let i = 0; i < 4; i++) {
      const d = ds[i];
      if (d === 0) { zeroFlag = true; }
      else {
        if (zeroFlag && s) s += '零';
        s += cnNums[d] + intUnits[3 - i];
        zeroFlag = false;
      }
    }
    return s;
  }

  let intStr = '';
  if (integer > 0) {
    const s = String(integer);
    const groups = [];
    let tmp = s;
    while (tmp.length > 0) { groups.unshift(tmp.slice(-4)); tmp = tmp.slice(0, -4); }
    for (let g = 0; g < groups.length; g++) {
      const gv = parseInt(groups[g], 10);
      const gStr = fourToChinese(gv);
      if (gStr) {
        // 跨组零：当前组高位有零（gv<1000）且前组非空 → 补零
        if (g > 0 && gv < 1000 && intStr && !intStr.endsWith('零')) intStr += '零';
        intStr += gStr + cnGroupUnits[groups.length - 1 - g];
      } else if (g < groups.length - 1 && intStr && !intStr.endsWith('零')) {
        // 全零中间组且后面还有非空组 → 补零
        intStr += '零';
      }
    }
    intStr = intStr.replace(/零+$/, '') + '元';
  }

  let decStr = '';
  if (jiao === 0 && fen === 0) {
    decStr = '整';
  } else {
    if (jiao > 0) decStr += cnNums[jiao] + '角';
    else if (integer > 0) decStr += '零';
    if (fen > 0) decStr += cnNums[fen] + '分';
  }

  let res = intStr + decStr;
  if (neg) res = '负' + res;
  return res;
}

module.exports = { toChineseAmount };
