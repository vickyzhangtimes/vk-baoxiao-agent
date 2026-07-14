'use strict';

const path = require('path');

function assertSafeChild(parent, target, label = 'path') {
  const root = path.resolve(parent);
  const candidate = path.resolve(target);
  const rel = path.relative(root, candidate);
  if (!rel || rel === '.' || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) {
    const err = new Error(`${label} 越过允许目录或指向根目录: ${candidate}`);
    err.code = 'UNSAFE_PATH';
    throw err;
  }
  return candidate;
}

function safeSegment(value, label = 'segment') {
  const s = String(value || '').trim();
  if (!s || s === '.' || s === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(s)) {
    const err = new Error(`${label} 含非法路径字符`);
    err.code = 'UNSAFE_PATH_SEGMENT';
    throw err;
  }
  return s;
}

module.exports = { assertSafeChild, safeSegment };
