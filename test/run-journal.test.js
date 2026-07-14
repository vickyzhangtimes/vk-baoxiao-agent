'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRecord, appendEvent, finishRecord, readRecord } = require('../lib/run-journal');

test('运行记录保存计划、步骤和最终状态', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-journal-'));
  const file = path.join(dir, 'run.json');
  try {
    createRecord(file, { runId: 'R1', mode: 'folder', requiredPermissions: ['filesystem.read-input'] });
    appendEvent(file, { type: 'step', key: 'ingest', status: 'running' });
    finishRecord(file, 'completed', { exitCode: 0 });
    const record = readRecord(file);
    assert.equal(record.status, 'completed');
    assert.equal(record.events.length, 1);
    assert.equal(record.exitCode, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
