'use strict';
/**
 * lib/template-store.js — 多模板隔离存储 + 版本选择（P3）
 *
 * 目录结构：
 *   templates/<user>/<name>/<version>/template.xlsx
 *                                    meta.json
 *
 * - 同用户多套模板互不干扰（按 <user>/<name> 隔离）
 * - 每套模板多版本（按 <version> 整数子目录）
 * - 默认取最新版本；可指定历史版本重跑旧批次
 *
 * 安全：保存时拒绝宏启用扩展名（.xlsm/.xlsb/.xltm）。
 */

const fs = require('fs');
const path = require('path');

const MACRO_EXT = ['.xlsm', '.xlsb', '.xltm'];

function templatesRoot() {
  return process.env.TEMPLATES_ROOT
    ? path.resolve(process.env.TEMPLATES_ROOT)
    : path.join(__dirname, '..', 'templates');
}

function templateBaseDir(user, name) {
  return path.join(templatesRoot(), String(user), String(name));
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function listTemplates(user) {
  const u = path.join(templatesRoot(), String(user));
  if (!fs.existsSync(u)) return [];
  return fs.readdirSync(u).filter(n =>
    fs.existsSync(path.join(u, n)) && listVersions(user, n).length > 0);
}

function listVersions(user, name) {
  const base = templateBaseDir(user, name);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base)
    .filter(n => /^\d+$/.test(n) && fs.existsSync(path.join(base, n, 'template.xlsx')))
    .map(v => ({ version: parseInt(v, 10), meta: readJsonSafe(path.join(base, v, 'meta.json')) }))
    .sort((a, b) => b.version - a.version);
}

function latestVersion(user, name) {
  const vs = listVersions(user, name);
  return vs.length ? vs[0].version : null;
}

function saveTemplate({ user, name, buffer, meta = {} }) {
  if (!Buffer.isBuffer(buffer)) throw new Error('saveTemplate: buffer 必为 Buffer');
  const ext = path.extname(String(name)).toLowerCase();
  if (MACRO_EXT.includes(ext)) {
    throw new Error(`拒收宏启用模板（${ext}），可能存在恶意宏`);
  }
  const prev = latestVersion(user, name) || 0;
  const version = (meta.version && Number.isInteger(meta.version)) ? meta.version : prev + 1;
  const vdir = path.join(templateBaseDir(user, name), String(version));
  fs.mkdirSync(vdir, { recursive: true });
  fs.writeFileSync(path.join(vdir, 'template.xlsx'), buffer);
  const fullMeta = {
    version,
    rollup: meta.rollup || 'flat',
    createdAt: meta.createdAt || new Date().toISOString(),
    tokensUsed: Array.isArray(meta.tokensUsed) ? meta.tokensUsed : [],
  };
  fs.writeFileSync(path.join(vdir, 'meta.json'), JSON.stringify(fullMeta, null, 2));
  return { version, dir: vdir, meta: fullMeta };
}

function resolveTemplate({ user, name, version }) {
  const base = templateBaseDir(user, name);
  if (!fs.existsSync(base)) throw new Error(`模板不存在: ${user}/${name}`);
  const v = (version != null) ? version : latestVersion(user, name);
  if (v == null) throw new Error(`模板无可用版本: ${user}/${name}`);
  const vdir = path.join(base, String(v));
  if (!fs.existsSync(vdir)) throw new Error(`模板版本不存在: ${user}/${name}@${v}`);
  const buffer = fs.readFileSync(path.join(vdir, 'template.xlsx'));
  const meta = readJsonSafe(path.join(vdir, 'meta.json')) || { version: v, rollup: 'flat' };
  return { buffer, meta, version: v };
}

module.exports = {
  MACRO_EXT,
  templatesRoot,
  templateBaseDir,
  listTemplates,
  listVersions,
  latestVersion,
  saveTemplate,
  resolveTemplate,
};
