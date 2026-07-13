'use strict';

/**
 * 致命 / 可恢复 错误细分（对应代码审查 问题 E）。
 *
 * 设计原则：
 * - 单封发票的错误已在 step2 主循环内 try/catch 捕获并记入 failed[]，不会逃逸到全局 handler。
 * - 因此「逃逸到 unhandledRejection / uncaughtException 的未处理错误」按定义属于非预期 ——
 *   默认视为「全局不可恢复 = 致命」，应终止流水线（exit 1），避免「看似成功」的盲区。
 * - 仅以下「良性 teardown 噪声」允许继续：IMAP 库在连接被主动关闭（imap.end()）后的异步清理报错。
 *   这是为防止库自身噪声触发假失败而保留的保守清单，任何业务/配置/磁盘/认证错误都不在此列。
 */

// 良性噪声：IMAP 库在 imap.end() 之后的异步清理报错，非业务错误，可安全忽略。
const BENIGN_PATTERNS = [
  /^Connection closed\.?$/i,
  /Unexpected socket close/i,
  /Stream (?:is )?closed/i,
];

function errMessage(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return err.message || err.stack || String(err);
}

/**
 * 判断一个逃逸到全局 handler 的未处理错误是否致命。
 * @param {*} reason 抛出的 Error 对象或 rejection reason（可能为字符串/对象）
 * @returns {boolean} true=致命（应 exit 1），false=良性 teardown 噪声（可继续）
 */
function isFatalError(reason) {
  const msg = errMessage(reason);
  for (const pattern of BENIGN_PATTERNS) {
    if (pattern.test(msg)) return false;
  }
  return true;
}

module.exports = { isFatalError, BENIGN_PATTERNS };
