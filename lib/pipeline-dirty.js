'use strict';
function mtime(fs, file) { try { return fs.statSync(file).mtimeMs; } catch (_) { return 0; } }
function isStepDirty(fs, step) {
  if (!step.outputs.length || step.outputs.some(file => mtime(fs, file) === 0)) return true;
  const oldestOutput = Math.min(...step.outputs.map(file => mtime(fs, file)));
  return step.inputs.some(file => mtime(fs, file) > oldestOutput);
}
module.exports = { isStepDirty };
