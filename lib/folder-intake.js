'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function safeName(name) { return String(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_'); }
function stagePdfs(files, sourceRoot, stagingDir) {
  fs.mkdirSync(stagingDir, { recursive: true });
  const seen = new Map();
  const staged = [];
  const duplicates = [];
  files.sort().forEach(src => {
    const hash = sha256(src);
    const rel = path.relative(sourceRoot, src);
    if (seen.has(hash)) { duplicates.push({ sourcePath: src, sourceRelativePath: rel, duplicateOf: seen.get(hash).stagedFilename, sha256: hash }); return; }
    const stagedFilename = `${hash.slice(0, 12)}_${safeName(path.basename(src))}`;
    fs.copyFileSync(src, path.join(stagingDir, stagedFilename));
    const item = { sourcePath: src, sourceRelativePath: rel, originalFilename: path.basename(src), stagedFilename, sha256: hash };
    seen.set(hash, item);
    staged.push(item);
  });
  return { staged, duplicates };
}
module.exports = { sha256, stagePdfs };
