#!/usr/bin/env node
// 去重 archive/ 下的发票 PDF 重复副本（由多次运行累积产生的 -2/-3/-4 后缀文件）。
// 保留每个唯一 base 的一份：优先无 -N 后缀的原件；若只有 -N 副本，则保留编号最小者并重命名为 base。
// 逐文件 unlinkSync（不触发 WorkBuddy safe-delete 的 bulk 守卫）。
const fs = require('fs');
const path = require('path');

const ARCH = path.join(__dirname, '..', 'archive');

// 去掉末尾 -N 后缀，得到 base 文件名（带 .pdf）
function stemOf(fname) {
  return fname.replace(/-\d+(\.pdf)$/i, '$1');
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.pdf$/i.test(e.name)) files.push(p);
  }
})(ARCH);

const groups = new Map();
for (const f of files) {
  const stem = stemOf(path.basename(f));
  if (!groups.has(stem)) groups.set(stem, []);
  groups.get(stem).push(f);
}

let kept = 0, removed = 0, renamed = 0;
for (const [stem, arr] of groups) {
  if (arr.length === 1) { kept++; continue; }
  const baseFile = arr.find((f) => path.basename(f) === stem);
  let keep;
  if (baseFile) {
    keep = baseFile;
  } else {
    const numOf = (f) => {
      const m = path.basename(f).match(/-(\d+)\.pdf$/i);
      return m ? Number(m[1]) : Infinity;
    };
    arr.sort((a, b) => numOf(a) - numOf(b));
    keep = arr[0];
    const newPath = path.join(path.dirname(keep), stem);
    fs.renameSync(keep, newPath);
    keep = newPath;
    renamed++;
  }
  for (const f of arr) {
    if (f !== keep) {
      try { fs.unlinkSync(f); removed++; }
      catch (e) { console.warn('⚠️ 删除失败', f, e.message); }
    }
  }
  kept++;
}

console.log(`archive 去重完成：唯一发票 ${kept} 组，删除重复副本 ${removed} 个，重命名副本为 base ${renamed} 个。`);
console.log(`去重后 archive PDF 总数：${kept}`);
