#!/usr/bin/env node
/**
 * generate-template.js — 产出一张空白报销单模板（含全部合法占位符）
 *
 * 用法：
 *   node generate-template.js --output 我的模板.xlsx [--style minimal]
 *
 * 用户拿到后：改样式/增删列，保存为自己的模板，再用渲染服务填值。
 * 同时产出 <name>.meta.json（版本/rollup/tokens）。
 */
const fs = require('fs');
const path = require('path');
const { generateStarterTemplate } = require('./lib/starter-template');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--output');
const out = outIdx >= 0 ? args[outIdx + 1] : '报销模板.xlsx';
const styleIdx = args.indexOf('--style');
const style = styleIdx >= 0 ? args[styleIdx + 1] : 'minimal';

(async () => {
  const { buffer, meta } = await generateStarterTemplate({ style });
  fs.writeFileSync(out, buffer);
  const metaPath = out.replace(/\.xlsx$/i, '') + '.meta.json';
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  console.log('✅ 起步模板已生成: ' + path.resolve(out));
  console.log('   meta: ' + metaPath);
  console.log('   用法：在单元格写 {{token}}（如 {{发票号码}}），运行渲染服务填值。');
})().catch(e => { console.error(e); process.exit(1); });
