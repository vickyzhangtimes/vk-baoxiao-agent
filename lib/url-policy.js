'use strict';

const dns = require('dns');
const net = require('net');

function isPrivateIp(address) {
  if (!net.isIP(address)) return false;
  if (address === '::1' || address === '0.0.0.0') return true;
  if (address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:')) return true;
  const p = address.split('.').map(Number);
  if (p.length !== 4) return false;
  return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
    (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}

function assertAllowedRemoteUrl(rawUrl) {
  const url = new URL(rawUrl);
  const allowHttp = process.env.ALLOW_INSECURE_HTTP === '1';
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new Error(`只允许 HTTPS 发票链接: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || isPrivateIp(host)) {
    throw new Error(`拒绝访问本机或私网地址: ${host}`);
  }
  return url;
}

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: false }, (err, address, family) => {
    if (err) return callback(err);
    if (isPrivateIp(address)) return callback(new Error(`DNS 解析到私网地址，已拒绝: ${address}`));
    callback(null, address, family);
  });
}

function collectResponse(res, maxBytes = Number(process.env.MAX_DOWNLOAD_BYTES || 25 * 1024 * 1024)) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    res.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        res.destroy(new Error(`响应超过大小上限 ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  });
}

module.exports = { isPrivateIp, assertAllowedRemoteUrl, safeLookup, collectResponse };
