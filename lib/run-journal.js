'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function makeRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function ensureParent(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function readRecord(file) {
  if (!file || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeRecord(file, record) {
  ensureParent(file);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return record;
}

function createRecord(file, data) {
  const record = {
    schemaVersion: 1,
    runId: data.runId,
    startedAt: data.startedAt || new Date().toISOString(),
    finishedAt: null,
    status: 'planned',
    mode: data.mode,
    dateTag: data.dateTag || null,
    input: data.input || null,
    requiredPermissions: data.requiredPermissions || [],
    approvedPermissions: data.approvedPermissions || [],
    events: [],
  };
  return writeRecord(file, record);
}

function appendEvent(file, event) {
  if (!file) return null;
  const record = readRecord(file);
  if (!record) return null;
  record.events.push({ at: new Date().toISOString(), ...event });
  if (event.status === 'running') record.status = 'running';
  return writeRecord(file, record);
}

function finishRecord(file, status, detail = {}) {
  const record = readRecord(file);
  if (!record) return null;
  record.status = status;
  record.finishedAt = new Date().toISOString();
  Object.assign(record, detail);
  return writeRecord(file, record);
}

module.exports = { makeRunId, readRecord, writeRecord, createRecord, appendEvent, finishRecord };
