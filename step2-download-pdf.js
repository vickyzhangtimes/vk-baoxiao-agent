#!/usr/bin/env node
/**
 * step2-download-pdf.js — 环节② PDF/OFD下载
 * 
 * 输入：step1 的邮件 JSON 文件
 * 输出：下载的 PDF 文件到 scan-results/downloads/
 * 
 * 支持的下载方式：
 * 1. PDF附件（直接从邮件下载 binary）
 * 2. 链接提取：从 bodyText 中提取 PDF/OFD 下载 URL
 * 3. 去重：同一发票号只下载一次
 */

const Imap = require('imap');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawnSync } = require('child_process');
const { URL } = require('url');
const { getImapConfig, getMailbox } = require('./lib/env');
const { safeCleanDir } = require('./lib/safe-clean');
const { assertAllowedRemoteUrl, safeLookup, collectResponse } = require('./lib/url-policy');

// E (工序达 review): 致命 / 可恢复错误细分
// 单封发票错误已在主循环内 try/catch 捕获并记入 failed[]，不会逃逸到此；
// 因此逃逸到全局 handler 的未处理错误默认视为「全局不可恢复 = 致命」，应退出(1)。
// 仅 IMAP 库在连接主动关闭后的异步清理噪声（Connection closed 等）允许继续，避免假失败。
const { isFatalError } = require('./lib/error-classify');
process.on('unhandledRejection', (reason) => {
  if (isFatalError(reason)) {
    console.error('❌ [FATAL] 未捕获的 Promise rejection（致命，流水线终止）:', reason && (reason.stack || reason.message || reason));
    process.exit(1);
  }
  console.error('⚠️ 未捕获的 Promise rejection（良性噪声，已记录不中断）:', reason && (reason.stack || reason.message || reason));
});
process.on('uncaughtException', (err) => {
  if (isFatalError(err)) {
    console.error('❌ [FATAL] 未捕获异常（致命，流水线终止）:', err && (err.stack || err.message));
    process.exit(1);
  }
  console.error('⚠️ 未捕获异常（良性噪声，已记录不中断）:', err && err.message);
});

const args = process.argv.slice(2);

// 配置
const INPUT_FILE = args[0] || (() => {
  const classifiedDir = path.join(__dirname, 'scan-results', 'classified');
  if (fs.existsSync(classifiedDir)) {
    const classified = fs.readdirSync(classifiedDir).filter(f => f.startsWith('classified-') && f.endsWith('.json')).sort();
    if (classified.length > 0) return path.join(classifiedDir, classified[classified.length - 1]);
  }
  const emailsDir = path.join(__dirname, 'scan-results', 'emails');
  const files = fs.readdirSync(emailsDir).filter(f => f.startsWith('emails-') && f.endsWith('.json')).sort();
  if (files.length === 0) throw new Error('未找到扫描结果文件');
  return path.join(emailsDir, files[files.length - 1]);
})();
const dateTag = args[1] || (INPUT_FILE.match(/(?:emails|classified)-(.+)\.json$/)?.[1] || new Date().toISOString().slice(0, 10));
const DOWNLOADS_DIR = path.join(__dirname, 'scan-results', 'downloads');
const STAGING_DIR = path.join(__dirname, 'scan-results', 'staging', dateTag);
const PDF_DIR = path.join(STAGING_DIR, 'pdfs');
const OFD_DIR = path.join(STAGING_DIR, 'ofds');
const IMAGE_DIR = path.join(STAGING_DIR, 'images');
const FAILED_DIR = path.join(STAGING_DIR, 'failed');

const IMAP_CONFIG = getImapConfig();
const MAILBOX = getMailbox();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function uniquePath(file) {
  if (!fs.existsSync(file)) return file;
  const ext = path.extname(file);
  const base = file.slice(0, -ext.length);
  let index = 2;
  while (fs.existsSync(`${base}-${index}${ext}`)) index++;
  return `${base}-${index}${ext}`;
}

/**
 * 净化文件名：去掉路径分隔符只留 basename，替换 Windows 非法字符。
 * 防止附件名含嵌套路径（如 webNew/upload/附件/.../电子发票.pdf）导致 ENOENT。
 */
function sanitizeFilename(name) {
  if (!name) return 'file';
  return name
    .split(/[\\/]/).pop()           // 去路径，只留最后一段
    .replace(/[:*?"<>|]/g, '_')     // 替换 Windows 非法字符
    .replace(/^\.+$/, '_')          // 防止纯点文件名
    .trim() || 'file';
}

/**
 * 从邮件UID下载附件
 */
function fetchAttachment(imap, uid, filename) {
  return new Promise((resolve, reject) => {
    const fetcher = imap.fetch(uid, { bodies: '', struct: true });
    let foundAttachment = null;
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(foundAttachment); } };
    let pending = 0;

    fetcher.on('message', msg => {
      pending++;
      msg.on('attributes', attrs => { msg.uid = attrs.uid; });
      msg.on('body', stream => {
        const bufs = [];
        stream.on('data', c => bufs.push(c));
        stream.on('end', async () => {
          const fullBody = Buffer.concat(bufs);
          try {
            const parsed = await simpleParser(fullBody);
            const att = (parsed.attachments || []).find(a =>
              a.filename === filename || (filename && a.filename.includes(filename.split('/').pop()))
            );
            if (att) foundAttachment = { filename: att.filename, content: att.content };
          } catch(e) { /* parse failed */ }
          pending--;
          if (pending <= 0) finish();
        });
      });
      msg.on('error', () => { pending--; if (pending <= 0) finish(); });
    });
    fetcher.once('error', () => finish());
    // 删除原 fetcher.once('end', () => setTimeout(() => finish(), 2000))：与异步 simpleParser 竞争，会抢先 resolve(null)
    setTimeout(() => finish(), 15000); // 仅保留硬超时兜底
  });
}

/**
 * 保活 / 重连：IMAP 连接在链接型邮件处理期间会因长时间空闲被服务端掐断。
 * 每次取附件前先检查连接状态，已断开则重建连接，避免静默返回 null（表现为 'empty' 失败）。
 */
function isImapAlive(im) {
  return im && (im.state === 'authenticated' || im.state === 'selected');
}
async function ensureImapAlive(im) {
  if (isImapAlive(im)) return im;
  console.warn('[imap] 连接已断开，正在重连...');
  try { im.end(); } catch (_) {}
  const fresh = await new Promise((resolve, reject) => {
    const i = new Imap(IMAP_CONFIG);
    let connected = false;
    i.once('ready', () => { connected = true; resolve(i); });
    i.once('error', (e) => { if (!connected) reject(e); else console.warn('[imap] 重连 teardown 警告（已忽略）:', e && e.message); });
    i.connect();
  });
  await new Promise((res, rej) => fresh.openBox(MAILBOX, true, (err) => err ? rej(err) : res()));
  console.warn('[imap] 重连成功');
  return fresh;
}

/**
 * 从 URL 下载文件
 */
function downloadFile(fileUrl, destPath, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('重定向次数超过 5 次'));
    const parsedUrl = assertAllowedRemoteUrl(fileUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      family: 4,
      lookup: safeLookup,
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 20000,
    };
    const req = protocol.request(options, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadFile(new URL(res.headers.location, fileUrl).href, destPath, depth + 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`)); return;
      }
      collectResponse(res).then(data => {
        fs.writeFileSync(destPath, data);
        resolve(data.length);
      }).catch(reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function fetchUrl(fileUrl, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('重定向次数超过 5 次'));
    const parsedUrl = assertAllowedRemoteUrl(fileUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      family: 4,
      lookup: safeLookup,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8',
        'Referer': parsedUrl.origin + '/',
      },
      timeout: 20000,
    };
    const req = protocol.request(options, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchUrl(new URL(res.headers.location, fileUrl).href, depth + 1).then(resolve).catch(reject);
        return;
      }
      collectResponse(res).then(body => resolve({
        url: fileUrl,
        statusCode: res.statusCode,
        headers: res.headers,
        body,
      })).catch(reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function postForm(url, data, referer) {
  return new Promise((resolve, reject) => {
    const parsedUrl = assertAllowedRemoteUrl(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    const body = new URLSearchParams(data).toString();
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      lookup: safeLookup,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Content-Length': Buffer.byteLength(body),
        'Origin': parsedUrl.origin,
        'Referer': referer || parsedUrl.origin + '/',
      },
      timeout: 20000,
    };
    const req = protocol.request(options, res => {
      collectResponse(res).then(responseBody => resolve({
        url,
        statusCode: res.statusCode,
        headers: res.headers,
        body: responseBody,
      })).catch(reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function isPdfResponse(response) {
  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  return contentType.includes('application/pdf') || response.body.slice(0, 4).toString('latin1') === '%PDF';
}

function fetchUrlWithCurl(fileUrl, ext) {
  if (process.env.ENABLE_CURL_FALLBACK !== '1') return null;
  assertAllowedRemoteUrl(fileUrl);
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const maxTime = Number(process.env.CURL_MAX_TIME || 60);
  let result;
  try {
    result = spawnSync(curl, [
      '-L',
      '--max-time', String(maxTime),
      '-A', 'Mozilla/5.0',
      '-H', ext === '.pdf' ? 'Accept: application/pdf,*/*' : 'Accept: */*',
      fileUrl,
    ], { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024, timeout: (maxTime + 10) * 1000 });
  } catch (e) {
    // spawn 级别的异常（如命令不存在/信号中断）兜底为失败，绝不抛出
    console.warn(`[curl] 调用异常 ${fileUrl}: ${e.message}`);
    return null;
  }
  // spawnSync 超时 / 进程错误（ETIMEDOUT 等）落在 result.error，同样兜底
  if (result.error) {
    console.warn(`[curl] 失败 ${fileUrl}: ${result.error.message}`);
    return null;
  }
  if (result.status !== 0 || !result.stdout || result.stdout.length === 0) {
    const err = result.stderr ? result.stderr.toString('utf8').trim() : `curl exited ${result.status}`;
    console.warn(`[curl] 下载失败 ${fileUrl}: ${err || '空响应'}`);
    return null;
  }
  return { url: fileUrl, statusCode: 200, headers: {}, body: result.stdout, resolver: 'curl-direct-download' };
}

async function resolveNuonuoInvoice(finalUrl) {
  const parsedUrl = new URL(finalUrl);
  if (!parsedUrl.hostname.includes('nnfp.jss.com.cn') || !parsedUrl.pathname.includes('/scan-invoice/printQrcode')) {
    return null;
  }
  const paramList = parsedUrl.searchParams.get('paramList');
  if (!paramList) return null;
  const response = await postForm('https://nnfp.jss.com.cn/scan2/getIvcDetailShow.do', {
    paramList,
    code: parsedUrl.searchParams.get('code') || '',
    aliView: parsedUrl.searchParams.get('aliView') || '',
    invoiceDetailMiddleUri: finalUrl,
    shortLinkSource: parsedUrl.searchParams.get('shortLinkSource') || '',
  }, finalUrl);
  if (response.statusCode !== 200) throw new Error(`诺诺接口 HTTP ${response.statusCode}`);
  const payload = JSON.parse(response.body.toString('utf8'));
  const invoice = payload?.data?.invoiceSimpleVo;
  const pdfUrl = invoice?.url;
  const ofdUrl = invoice?.ofdDownloadUrl;
  const targetUrl = pdfUrl || ofdUrl;
  if (!targetUrl) throw new Error('诺诺接口未返回 PDF/OFD 下载地址');
  const file = await fetchUrl(targetUrl);
  if (pdfUrl && isPdfResponse(file)) return { url: targetUrl, body: file.body, ext: '.pdf', resolver: 'nuonuo-api' };
  const fileType = String(file.headers['content-type'] || '').toLowerCase();
  if (ofdUrl && (fileType.includes('application/ofd') || targetUrl.toLowerCase().includes('.ofd'))) {
    return { url: targetUrl, body: file.body, ext: '.ofd', resolver: 'nuonuo-api' };
  }
  if (pdfUrl && file.body.length > 1024) return { url: targetUrl, body: file.body, ext: '.pdf', resolver: 'nuonuo-api' };
  throw new Error('诺诺返回的下载地址不是有效 PDF/OFD');
}

function discoverDownloadLinks(html, baseUrl) {
  const links = [];
  const text = String(html || '');
  const patterns = [
    /(?:href|src)=["']([^"']+\.(?:pdf|ofd)(?:\?[^"']*)?)["']/gi,
    /(https?:\/\/[^\s'"<>]+?\.(?:pdf|ofd)(?:\?[^\s'"<>]*)?)/gi,
    /["']([^"']*(?:download|pdf|ofd)[^"']*)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1].replace(/\\u0026/g, '&').replace(/&amp;/g, '&').trim();
      if (!raw || raw.startsWith('javascript:') || raw.startsWith('#')) continue;
      try {
        const absolute = new URL(raw, baseUrl).href;
        if (!links.includes(absolute)) links.push(absolute);
      } catch (_) {}
    }
  }
  return links;
}

async function resolveInvoiceLink(url) {
  const directPdfLike = /[?&]wjgs=pdf(?:&|$)/i.test(url) || /\.pdf(?:[?#]|$)/i.test(url);
  const directOfdLike = /[?&]wjgs=ofd(?:&|$)/i.test(url) || /\.ofd(?:[?#]|$)/i.test(url);
  let first;
  try {
    first = await fetchUrl(url);
  } catch (e) {
    // fetchUrl 失败时，尝试用 curl 直连；curl 返回 null（含超时/ETIMEDOUT）则回退到原始错误
    if (directPdfLike) {
      const file = fetchUrlWithCurl(url, '.pdf');
      if (file) return { url: file.url, body: file.body, ext: '.pdf', resolver: 'curl-direct-pdf' };
    }
    if (directOfdLike) {
      const file = fetchUrlWithCurl(url, '.ofd');
      if (file) return { url: file.url, body: file.body, ext: '.ofd', resolver: 'curl-direct-ofd' };
    }
    throw e;
  }
  if (isPdfResponse(first) || /[?&]wjgs=pdf(?:&|$)/i.test(first.url)) return { url: first.url, body: first.body, ext: '.pdf', resolver: 'direct-pdf' };
  const nuonuo = await resolveNuonuoInvoice(first.url);
  if (nuonuo) return nuonuo;
  const contentType = String(first.headers['content-type'] || '').toLowerCase();
  if (contentType.includes('application/ofd') || first.url.toLowerCase().includes('.ofd') || /[?&]wjgs=ofd(?:&|$)/i.test(first.url)) {
    return { url: first.url, body: first.body, ext: '.ofd', resolver: 'direct-ofd' };
  }
  const html = first.body.toString('utf8');
  for (const candidate of discoverDownloadLinks(html, first.url).slice(0, 8)) {
    try {
      const next = await fetchUrl(candidate);
      if (isPdfResponse(next)) return { url: next.url, body: next.body, ext: '.pdf', resolver: 'html-link-discovery' };
      const nextType = String(next.headers['content-type'] || '').toLowerCase();
      if (nextType.includes('application/ofd') || next.url.toLowerCase().includes('.ofd')) {
        return { url: next.url, body: next.body, ext: '.ofd', resolver: 'html-link-discovery' };
      }
    } catch (err) {
      console.warn(`[link] 候选链接解析失败 ${candidate}: ${err.message}`);
    }
  }
  throw new Error(`未发现可直接下载的 PDF/OFD 链接: HTTP ${first.statusCode}`);
}

/**
 * 从邮件正文中提取发票下载链接
 */
function extractInvoiceLinks(bodyText) {
  const links = [];
  // 百旺金穗云格式：PDF / OFD / XML 链接
  const pdfMatch = bodyText.match(/https?:\/\/[^\s'"<>]+\.pdf\?[^'"<> \n]+/gi) || [];
  const ofdMatch = bodyText.match(/https?:\/\/[^\s'"<>]+\.ofd\?[^'"<> \n]+/gi) || [];
  // 滴滴格式
  const didiMatch = bodyText.match(/https?:\/\/[^\s'"<>]{30,}/g) || [];
  
  return [...pdfMatch, ...ofdMatch, ...didiMatch]
    .map(l => l.trim().replace(/[\]>\s]+$/, ''))
    .filter(l => l.startsWith('http'));
}

function linkPriority(url) {
  const u = String(url || '').toLowerCase();
  if (/[?&]wjgs=pdf(?:&|$)/i.test(u) || /\.pdf(?:[?#]|$)/.test(u)) return 0;
  if (/[?&]wjgs=ofd(?:&|$)/i.test(u) || /\.ofd(?:[?#]|$)/.test(u)) return 1;
  if (u.includes('nnfp.jss.com.cn') || u.includes('of1.cn')) return 2;
  if (u.includes('download') || u.includes('export')) return 3;
  if (/\.(png|jpg|jpeg|gif)(?:[?#]|$)/.test(u) || u.includes('qrcode')) return 9;
  return 5;
}

function prioritizeInvoiceLinks(links) {
  return [...new Set((links || []).map(l => String(l || '').trim().replace(/[\]>\s]+$/, '').replace(/&amp;/g, '&')).filter(Boolean))]
    .sort((a, b) => linkPriority(a) - linkPriority(b));
}

/**
 * 从文件名推断发票号
 */
function guessInvoiceNoFromFilename(filename) {
  const m = filename.match(/(\d{20,})/);
  return m ? m[1] : null;
}

async function main() {
  safeCleanDir(STAGING_DIR, { allowedRoot: ROOT });
  if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });
  if (!fs.existsSync(OFD_DIR)) fs.mkdirSync(OFD_DIR, { recursive: true });
  if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });
  if (!fs.existsSync(FAILED_DIR)) fs.mkdirSync(FAILED_DIR, { recursive: true });

  const data = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  const okEmails = data.records || data.emails || [];
  
  /** 为 error 邮件猜测附件名（仅在 error 状态时回退） */
  function guessAttachments(email) {
    const atts = email.attachments || [];
    if (atts.length > 0) return atts;
    if (email.status !== 'error') return atts;
    // 回退：根据 subject 推断
    const subj = email.subject || '';
    if (subj.includes('电子发票')) return [{ filename: '电子发票.pdf', contentType: 'application/pdf', size: 0, type: 'pdf' }];
    return atts;
  }

  const downloaded = [];
  const skipped = [];
  const failed = [];
  const seenInvoiceNo = new Set();

  // ---- D: 进度心跳 / 卡死预警（长邮箱任务防「看起来卡死被中断」）----
  const total = okEmails.length;
  let processed = 0;
  let lastActivity = Date.now();
  const HEARTBEAT_MS = Number(process.env.DOWNLOAD_HEARTBEAT_MS || 30000);
  const STUCK_MS = Number(process.env.DOWNLOAD_STUCK_MS || 900000);
  const heartbeat = setInterval(() => {
    const stuck = Date.now() - lastActivity > STUCK_MS;
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`ℹ️ [心跳 ${ts}] 进度 ${processed}/${total} · 成功 ${downloaded.length}/失败 ${failed.length}/跳过 ${skipped.length}${stuck ? ` · ⚠️ 超 ${STUCK_MS / 60000} 分钟无新邮件，可能卡死（仍在等待…）` : ''}`);
  }, HEARTBEAT_MS);

  // IMAP 连接
  let imap = await new Promise((resolve, reject) => {
    const i = new Imap(IMAP_CONFIG);
    let connected = false;
    i.once('ready', () => { connected = true; resolve(i); });
    // 连接阶段报错才 reject；连接成功后仅记录（teardown 期的 socket 错误不致命，避免未处理 'error' 事件崩进程）
    i.once('error', (e) => {
      if (!connected) reject(e);
      else console.warn('[imap] teardown 警告（已忽略，不中断）:', e && e.message);
    });
    i.connect();
  });
  // D2: openBox 改为 await（原 fire-and-forget，openBox 报错会被静默吞掉、main() 提前返回 → 表现为「跑一半静默结束」）
  try {
    await new Promise((resolve, reject) => {
      imap.openBox(MAILBOX, true, (err) => err ? reject(err) : resolve());
    });
  } catch (e) {
    console.error('❌ 打开邮箱文件夹失败:', e && e.message);
    try { imap.end(); } catch (_) {}
    clearInterval(heartbeat);
    process.exit(1);
  }
  console.log('✅ IMAP已连接，开始下载附件...\n');

  try {
    for (const email of okEmails) {
      const uid = email.uid;
      const subject = email.subject || '(无主题)';
      processed++;
      lastActivity = Date.now();
      console.log(`\n📨 [${processed}/${total}] uid=${uid} · 累计 成功${downloaded.length}/失败${failed.length}/跳过${skipped.length}`);

      // === 情况1：有PDF附件 ===
      const allAtts = guessAttachments(email);
      const pdfAtts = allAtts.filter(a => a.type === 'pdf') || [];
      const ofdAtts = allAtts.filter(a => a.type === 'ofd') || [];
      const imageAtts = allAtts.filter(a => a.type === 'image') || [];
      
      for (const att of [...pdfAtts, ...ofdAtts, ...imageAtts]) {
        const invoiceNo = guessInvoiceNoFromFilename(att.filename) || `uid${uid}`;
        
        if (seenInvoiceNo.has(invoiceNo + '_' + att.filename)) {
          skipped.push({ uid, type: 'duplicate', filename: att.filename, invoiceNo });
          console.log(`⏭ [${uid}] 跳过重复: ${att.filename}`);
          continue;
        }
        seenInvoiceNo.add(invoiceNo + '_' + att.filename);

        try {
          process.stdout.write(`⏳ [${uid}] 正在下载: ${att.filename} (${(att.size/1024).toFixed(0)}KB)... `);
          imap = await ensureImapAlive(imap);
          const attData = await fetchAttachment(imap, uid, att.filename);
          
          if (!attData || !attData.content || attData.content.length === 0) {
            failed.push({ uid, type: 'empty', filename: att.filename });
            console.log('❌ 空内容');
            continue;
          }

          const destDir = att.type === 'ofd' ? OFD_DIR : (att.type === 'image' ? IMAGE_DIR : PDF_DIR);
          const safeName = sanitizeFilename(att.filename);
          let destPath = path.join(destDir, safeName);
          // 防止同名文件覆盖：加UID前缀
          if (fs.existsSync(destPath)) {
            const ext = path.extname(safeName);
            const base = path.basename(safeName, ext);
            destPath = path.join(destDir, `uid${uid}_${base}${ext}`);
          }
          fs.writeFileSync(destPath, attData.content);
          downloaded.push({ uid, type: att.type, sourceType: email.sourceType || null, filename: path.basename(destPath), originalFilename: att.filename, path: destPath, stagingPath: path.relative(STAGING_DIR, destPath), size: attData.content.length, anomaly: att.type === 'image' ? 'png_anomaly' : null });
          console.log(`✅ ${(attData.content.length/1024).toFixed(0)}KB → ${destPath}`);
        } catch(e) {
          failed.push({ uid, type: 'error', filename: att.filename, error: e.message });
          console.log(`❌ ${e.message}`);
        }
        await sleep(200);
      }

      // === 情况2：无附件但有链接 ===
      if (pdfAtts.length === 0 && ofdAtts.length === 0 && imageAtts.length === 0 && email.links?.length > 0) {
        const links = prioritizeInvoiceLinks([...(email.links || []), ...extractInvoiceLinks(email.bodyText || '')]);
        
        if (links.length > 0) {
          for (const url of links.slice(0, 3)) { // 最多尝试3个候选链接
            const invoiceNo = guessInvoiceNoFromFilename(url) || `uid${uid}`;

            try {
              process.stdout.write(`⏳ [${uid}] 解析链接发票: ${url.slice(0, 80)}... `);
              const resolved = await resolveInvoiceLink(url);
              const ext = resolved.ext || '.pdf';
              const fname = `uid${uid}_${invoiceNo}${ext}`;
              const destDir = ext === '.ofd' ? OFD_DIR : PDF_DIR;
              const destPath = uniquePath(path.join(destDir, fname));
              fs.writeFileSync(destPath, resolved.body);
              const size = resolved.body.length;
              downloaded.push({ uid, type: ext === '.ofd' ? 'ofd' : 'link', sourceType: email.sourceType || null, filename: path.basename(destPath), path: destPath, stagingPath: path.relative(STAGING_DIR, destPath), size, url, resolvedUrl: resolved.url, resolver: resolved.resolver || 'unknown-link-resolver' });
              console.log(`✅ ${(size/1024).toFixed(0)}KB`);
              break;
            } catch(e) {
              failed.push({ uid, type: 'link_error', filename: `uid${uid}_${invoiceNo}`, error: e.message, url });
              console.log(`❌ ${e.message}`);
            }
            await sleep(300);
          }
        }
      }
    }
    } catch (fatal) {
      // E: 主循环未预期错误 = 全局不可恢复，应终止而非生成残缺报告（避免「看似成功」）
      console.error('❌ [FATAL] 下载主循环未预期错误（致命，流水线终止）:', fatal && (fatal.stack || fatal.message));
      clearInterval(heartbeat);
      try { imap.end(); } catch (_) {}
      process.exit(1);
    } finally {
      clearInterval(heartbeat);
      try { imap.end(); } catch (_) {}
      console.log('\n━━━ 下载结果 ━━━');
    console.log('  ✅ 下载成功: ' + downloaded.length);
    console.log('  ⏭  跳过: ' + skipped.length);
    console.log('  ❌ 失败: ' + failed.length);
    
    // 保存下载记录
    const report = { meta: { dateTag, inputFile: INPUT_FILE, stagingDir: STAGING_DIR }, downloaded, skipped, failed, downloadedAt: new Date().toISOString() };
    const reportFile = path.join(DOWNLOADS_DIR, `download-results-${dateTag}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');
      fs.writeFileSync(path.join(DOWNLOADS_DIR, 'download-report.json'), JSON.stringify(report, null, 2), 'utf8');
      console.log('\n报告已保存: ' + reportFile);
    }
}

main().catch(e => { console.error(e); process.exit(1); });
