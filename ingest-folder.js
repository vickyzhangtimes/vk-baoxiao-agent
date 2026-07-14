#!/usr/bin/env node
/**
 * ingest-folder.js — 文件夹模式输入（开源可用性的关键入口）
 *
 * 用途：当用户没有 IMAP 发票邮箱、而是手里已有一堆发票 PDF（下载好的、或手机导出的）
 *       时，把整个文件夹收进流水线的工作区，并生成「合成」的 emails / classified /
 *       downloads 记录，使后续 step3..step11 无需任何改动即可直接跑。
 *
 * 为什么这样设计：
 *   - step3 只认 scan-results/staging/{dateTag}/pdfs 里的 PDF，与邮箱无关；
 *   - step4 遍历 emails[].emails，按附件文件名去 pdf-text 里匹配。只要合成一份
 *     「一封邮件 = 一个 PDF 附件」的记录，合并逻辑完全复用，零侵入。
 *
 * 用法：
 *   node ingest-folder.js <文件夹路径> [dateTag]
 *
 * 说明（v1 限制）：
 *   - 一个 PDF = 一条独立记录。邮箱模式里「发票.pdf + 行程单.pdf 同一封邮件自动合并」
 *     的增强在文件夹模式下不生效；若文件夹里同时有发票和行程单两个文件，它们会各自
 *     成一条记录（行程单那条无金额，会自动进 manual-tasks 待你补/确认）。
 *   - 不生成邮件超链接（无邮箱）。
 */
const fs = require('fs');
const path = require('path');
const { stagePdfs } = require('./lib/folder-intake');

const folder = process.argv[2];
const dateTag = process.argv[3] || ('local-' + new Date().toISOString().slice(0, 10).replace(/-/g, ''));

if (!folder) {
  console.error('用法: node ingest-folder.js <文件夹路径> [dateTag]');
  process.exit(1);
}
// Git Bash 下 $PWD 形如 /c/Users/...，Windows 版 Node 会误解析为 C:\c\...；
// 归一化为 c:/Users/... 以同时兼容 PowerShell / cmd / Git Bash。
let rawFolder = folder;
if (process.platform === 'win32' && /^\/[a-zA-Z]\//.test(rawFolder)) {
  rawFolder = rawFolder.replace(/^\/([a-zA-Z])\//, '$1:/');
}
const absFolder = path.resolve(rawFolder);
if (!fs.existsSync(absFolder) || !fs.statSync(absFolder).isDirectory()) {
  console.error('文件夹不存在: ' + absFolder);
  process.exit(1);
}

const root = __dirname;
const stagingDir = path.join(root, 'scan-results', 'staging', dateTag, 'pdfs');
fs.mkdirSync(stagingDir, { recursive: true });

// 递归收集 PDF（跳过隐藏文件 / macOS 资源叉）
function collect(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(p, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) out.push(p);
  }
}
const pdfs = [];
collect(absFolder, pdfs);
if (pdfs.length === 0) {
  console.error('文件夹里没有 PDF: ' + absFolder);
  process.exit(1);
}

// 内容哈希去重 + 哈希前缀命名，防止不同子目录的同名文件互相覆盖。
const intake = stagePdfs(pdfs, absFolder, stagingDir);
console.log(`已收件  个 PDF 到 （去重  个）`);

// 合成 emails / classified / downloads（一封邮件 = 一个 PDF 附件）
const emails = [];
const classifiedRecords = [];
const downloaded = [];
intake.staged.forEach((item, i) => {
  const uid = i + 1;
  const filename = item.stagedFilename;
  emails.push({
    uid,
    subject: filename,
    from: 'local-folder',
    date: null,
    status: 'downloaded',
    attachments: [{ filename, type: 'pdf' }],
    links: [],
    sourceRelativePath: item.sourceRelativePath,
    sourceSha256: item.sha256,
  });
  classifiedRecords.push({ uid, sourceType: 'attachment_pdf', expectedAction: 'download', platform: null });
  downloaded.push({ uid, filename, originalFilename: item.originalFilename, sourceRelativePath: item.sourceRelativePath, sourceSha256: item.sha256, path: path.join(stagingDir, filename), type: 'pdf', resolver: 'local-folder', status: 'downloaded' });
});

const emailsOut = { meta: { dateTag, startDate: null, endDate: null, total: emails.length, source: 'local-folder' }, emails };
const classifiedOut = { meta: { dateTag }, records: classifiedRecords };
const downloadOut = { meta: { dateTag, duplicates: intake.duplicates }, downloaded };

fs.mkdirSync(path.join(root, 'scan-results', 'emails'), { recursive: true });
fs.mkdirSync(path.join(root, 'scan-results', 'classified'), { recursive: true });
fs.mkdirSync(path.join(root, 'scan-results', 'downloads'), { recursive: true });
fs.writeFileSync(path.join(root, 'scan-results', 'emails', `emails-${dateTag}.json`), JSON.stringify(emailsOut, null, 2), 'utf8');
fs.writeFileSync(path.join(root, 'scan-results', 'classified', `classified-${dateTag}.json`), JSON.stringify(classifiedOut, null, 2), 'utf8');
fs.writeFileSync(path.join(root, 'scan-results', 'downloads', `download-results-${dateTag}.json`), JSON.stringify(downloadOut, null, 2), 'utf8');

console.log(`✅ 合成记录已生成: ${emails.length} 份 PDF 文档, dateTag=${dateTag}`);
console.log('   下一步: 直接跑 step3..step11，或用 `npm run run -- --folder "<路径>"` 一键串联');
