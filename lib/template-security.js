'use strict';
/**
 * lib/template-security.js — 模板安全校验（P4）
 *
 * 渲染器使用 exceljs：只读/写单元格值，绝不求值公式，因此外部公式引用
 * （如 [book.xlsx]Sheet!A1）在渲染期不会被执行。
 *
 * 仍需主动拦截的高风险项：
 *  1. 宏启用工作簿（.xlsm/.xlsb/.xltm）—— 可携带恶意 VBA。
 *  2. 内嵌 VBA 工程（zip 内含 xl/vbaProject.bin）。
 *  3. 含 WEBSERVICE() 的公式 —— 渲染期可触发外联网络请求 / 数据外泄。
 */

const path = require('path');

const MACRO_EXT = ['.xlsm', '.xlsb', '.xltm'];

function hasVbaProject(buffer) {
  // xlsx 是 zip；vbaProject.bin 一定出现在 zip 中央目录的字符串里
  return Buffer.isBuffer(buffer) && buffer.indexOf(Buffer.from('vbaProject.bin')) !== -1;
}

function hasExternalServiceFormula(buffer) {
  // WEBSERVICE() 是经典的渲染期外联 / 外泄向量
  return Buffer.isBuffer(buffer) && buffer.indexOf(Buffer.from('WEBSERVICE(')) !== -1;
}

/**
 * 校验模板是否安全。
 * @param {Buffer} buffer 模板 xlsx 二进制
 * @param {string} [filename] 可选，用于扩展名拦截
 * @returns {true} 安全
 * @throws 含风险时抛错
 */
function assertSafeTemplate(buffer, filename) {
  if (filename) {
    const ext = path.extname(filename).toLowerCase();
    if (MACRO_EXT.includes(ext)) {
      throw new Error(`拒收宏启用工作簿（${ext}），可能存在恶意宏`);
    }
  }
  if (hasVbaProject(buffer)) {
    throw new Error('拒收含 VBA 宏的模板（检测到 vbaProject.bin）');
  }
  if (hasExternalServiceFormula(buffer)) {
    throw new Error('拒收含 WEBSERVICE() 外联公式的模板（可能触发网络请求 / 数据外泄）');
  }
  return true;
}

module.exports = { MACRO_EXT, hasVbaProject, hasExternalServiceFormula, assertSafeTemplate };
