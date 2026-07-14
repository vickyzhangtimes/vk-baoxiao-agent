#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseScopes, assertApproved, SCOPES } = require('./lib/permission-gate');

const root = __dirname;
const args = process.argv.slice(2);
const inputFile = args.find(a => !a.startsWith('--'));
const promoteRules = args.includes('--promote-rules');
const approveIdx = args.indexOf('--approve');
const approved = parseScopes(approveIdx >= 0 ? args[approveIdx + 1] : process.env.REIMBURSE_APPROVALS);

if (!inputFile || !fs.existsSync(inputFile)) {
  console.error('用法: node apply-feedback.js <feedback.json> [--promote-rules --approve rules.write]');
  process.exit(2);
}

const payload = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const items = Array.isArray(payload) ? payload : payload.items;
if (!Array.isArray(items)) throw new Error('feedback.json 必须是数组或包含 items 数组');
const dateTag = payload.dateTag || 'manual';
const memoryDir = path.join(root, 'agent-memory');
fs.mkdirSync(memoryDir, { recursive: true });
const feedbackLog = path.join(memoryDir, 'feedback.jsonl');
const candidateLog = path.join(memoryDir, 'rule-candidates.jsonl');

const batchItems = [];
const exactOverrides = {};
const candidates = [];
for (const item of items) {
  const corrections = item.corrections || item.override || {};
  if (item.emailUid) batchItems.push({ emailUid: item.emailUid, ...corrections });
  if (item.invoiceNo) exactOverrides[String(item.invoiceNo)] = corrections;
  if (item.learn && Array.isArray(item.learn.keywords) && item.learn.category) {
    candidates.push({ category: item.learn.category, keywords: item.learn.keywords.map(String), sourceInvoiceNo: item.invoiceNo || null });
  }
  fs.appendFileSync(feedbackLog, JSON.stringify({ at: new Date().toISOString(), dateTag, ...item }) + '\n', 'utf8');
}

if (batchItems.length) {
  const out = path.join(root, 'scan-results', `invoice-overrides-${dateTag}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), dateTag, items: batchItems }, null, 2), 'utf8');
  console.log(`批次覆盖已写入: ${out}`);
}
if (Object.keys(exactOverrides).length) {
  const out = path.join(memoryDir, 'invoice-overrides.json');
  const current = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
  fs.writeFileSync(out, JSON.stringify({ ...current, ...exactOverrides }, null, 2), 'utf8');
  console.log(`长期精确覆盖已写入: ${out}`);
}
for (const candidate of candidates) fs.appendFileSync(candidateLog, JSON.stringify({ at: new Date().toISOString(), ...candidate }) + '\n', 'utf8');
if (candidates.length) console.log(`规则候选已记录: ${candidateLog}`);

if (promoteRules && candidates.length) {
  assertApproved([SCOPES.RULES_WRITE], approved);
  const categoriesFile = path.join(root, 'config', 'expense-categories.json');
  const categories = JSON.parse(fs.readFileSync(categoriesFile, 'utf8'));
  for (const candidate of candidates) {
    const rule = categories.rules.find(r => r.category === candidate.category);
    if (!rule) throw new Error(`不存在费用类别: ${candidate.category}`);
    rule.keywords = [...new Set([...rule.keywords, ...candidate.keywords])];
  }
  fs.writeFileSync(categoriesFile, JSON.stringify(categories, null, 2) + '\n', 'utf8');
  console.log(`经授权，已提升 ${candidates.length} 条规则候选到 expense-categories.json`);
}
