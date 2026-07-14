'use strict';

const SCOPES = Object.freeze({
  MAIL_READ: 'mail.read',
  NETWORK_DOWNLOAD: 'network.download',
  FILESYSTEM_READ_INPUT: 'filesystem.read-input',
  VISION_PROCESS_IMAGES: 'vision.process-images',
  FILESYSTEM_CLEAN: 'filesystem.clean',
  FILESYSTEM_WRITE_OUTPUT: 'filesystem.write-output',
  RULES_WRITE: 'rules.write',
});

const MODE_SCOPES = Object.freeze({
  email: [SCOPES.MAIL_READ, SCOPES.NETWORK_DOWNLOAD, SCOPES.FILESYSTEM_CLEAN, SCOPES.FILESYSTEM_WRITE_OUTPUT],
  folder: [SCOPES.FILESYSTEM_READ_INPUT, SCOPES.FILESYSTEM_CLEAN, SCOPES.FILESYSTEM_WRITE_OUTPUT],
  images: [SCOPES.FILESYSTEM_READ_INPUT, SCOPES.VISION_PROCESS_IMAGES, SCOPES.FILESYSTEM_CLEAN, SCOPES.FILESYSTEM_WRITE_OUTPUT],
});

function parseScopes(value) {
  if (Array.isArray(value)) return [...new Set(value.map(String).map(s => s.trim()).filter(Boolean))];
  return [...new Set(String(value || '').split(',').map(s => s.trim()).filter(Boolean))];
}

function requiredScopes(mode) {
  if (!MODE_SCOPES[mode]) throw new Error(`未知运行模式: ${mode}`);
  return [...MODE_SCOPES[mode]];
}

function checkApprovals(required, approved) {
  const granted = new Set(parseScopes(approved));
  const missing = parseScopes(required).filter(scope => !granted.has(scope));
  return { ok: missing.length === 0, missing, approved: [...granted] };
}

function assertApproved(required, approved) {
  const result = checkApprovals(required, approved);
  if (!result.ok) {
    const err = new Error(`缺少明确授权: ${result.missing.join(', ')}`);
    err.code = 'PERMISSION_REQUIRED';
    err.missing = result.missing;
    throw err;
  }
  return result;
}

module.exports = { SCOPES, MODE_SCOPES, parseScopes, requiredScopes, checkApprovals, assertApproved };
