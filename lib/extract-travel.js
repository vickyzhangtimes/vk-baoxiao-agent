#!/usr/bin/env node
/**
 * lib/extract-travel.js — 行程/差旅结构化字段抽取（纯函数，无副作用）
 *
 * 输入：PDF 全文（pdf2json fullText）+ docType/seller/category 上下文
 * 输出：{ transportType, tripDate, fromStation, toStation, tripUncertain }
 *   - transportType: 火车 | 打车 | 飞机 | 汽车（空=非差旅）
 *   - tripDate:      出行日期（火车票=车次号后日期，区别于开票日期）
 *   - fromStation:   出发站/出发地
 *   - toStation:     到达站/到达地
 *   - tripUncertain: true 表示站名顺序/取值需人工复核（进 fill 清单）
 *
 * 关键约束（实测）：
 *   - 铁路电子客票（火车票）：站名+出行日期都在文字层，可自动抽（顺序需复核）
 *   - 打车「发票」本身：行程明细常是非文字层 → 站名多为空 + tripUncertain
 *   - 打车「行程单」(高德/滴滴/T3 的 ITINERARY)：文字层完整含 起点/终点/城市，
 *     但 pdf2json 会把表格转成单行流式文本并在中文/括号内插空格 → 过滤地址型 token 提取
 */

function normalizeDate(value) {
  if (!value) return null;
  const m = String(value).match(/(\d{4})[年\-\/](\d{1,2})[月\-\/](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
}

function inferTransportType({ docType = '', seller = '', text = '' }) {
  const hay = `${seller} ${text} ${docType}`;
  if (/铁路电子客票|携程火车票|高铁|火车站/.test(hay)) return '火车';
  if (/机票|航班|航空|东方航空|南方航空|中国国航|厦航|深航/.test(hay)) return '飞机';
  if (/客运服务|打车|出租车|网约车|智捷|飞嘀|高德|滴滴|首汽|出行服务费/.test(hay)) return '打车';
  if (/长途汽车|客运班线|汽车票/.test(hay)) return '汽车';
  return '';
}

// 铁路电子客票：站名带「站」+ 车次号后日期
function extractTrain(text) {
  const out = { transportType: '火车', tripDate: null, fromStation: null, toStation: null, tripUncertain: true };
  // 出行日期：车次号(如 G1633)后的日期，区别于末尾「开票日期」
  const dm = text.match(/[A-Z]\d{1,4}\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (dm) out.tripDate = normalizeDate(`${dm[1]}-${dm[2]}-${dm[3]}`);
  // 站名：带「站」的中文 token（允许「杭州东 站」中的空格），去重保序
  const raw = [...text.matchAll(/([一-龥]{2,6})\s*站/g)].map(m => m[1]);
  const seen = new Set();
  const stations = [];
  for (const s of raw) { if (!seen.has(s)) { seen.add(s); stations.push(s); } }
  if (stations.length >= 2) {
    out.fromStation = stations[0];
    out.toStation = stations[1];
  } else if (stations.length === 1) {
    out.fromStation = stations[0];
  }
  return out;
}

// 打车/客运：尝试抽文字层中的出行日期/出发地/到达地（多数发票此部分非文字层）
function extractRide(text) {
  const out = { transportType: '打车', tripDate: null, fromStation: null, toStation: null, tripUncertain: true };
  const dm = text.match(/出行日期[：:]\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (dm) out.tripDate = normalizeDate(`${dm[1]}-${dm[2]}-${dm[3]}`);
  const rm = text.match(/出发地[：:]\s*([^到达地]{1,20}?)\s*到达地[：:]\s*([^等级]{1,20}?)(?:\s*等级|$)/);
  if (rm) {
    out.fromStation = rm[1].trim();
    out.toStation = rm[2].trim();
    out.tripUncertain = false;
  }
  return out;
}

// 打车/网约车 行程单（高德/滴滴/T3 等）：pdf2json 把表格转成单行流式文本，
// 表头与数据值交替出现，例如：
//   高德...行程单 AMAP ITINERARY ... 序号 服务商 车型 上车时间 城市 起点 终点 金额
//   1 飞嘀打车 经济型 08:52 杭州市 全季酒店(杭州中大银泰店) 杭州西站(4层东进站口) 43.58元
// 数据行结构固定为「城市名 起点 终点 金额」，城市名之后紧跟的两条地址即 起点/终点。
// 关键修复（pdf2json 伪影）：
//   1) 括号内部空格 "(杭 州中大银泰店)" → "(杭州中大银泰店)"
//   2) 中文/数字间断词 "1号室 内网约车上客区" → "1号室内网约车上客区"
//   3) 过滤出地址型 token（含括号 / 连字符 / 纯中文≥4字），取最后两个作为 起点/终点
function extractItinerary(text) {
  const out = { transportType: '打车', tripDate: null, fromStation: null, toStation: null, tripUncertain: false };
  const clean = s => String(s || '').replace(/([一-龥])\s+(?=[一-龥])/g, '$1');

  // 1) 合并括号内被空格断开的词，如 "(杭 州中大银泰店)" → "(杭州中大银泰店)"
  const parenFixed = text.replace(/\(([^)]*)\)/g, m => '(' + m.slice(1, -1).replace(/\s+/g, '') + ')');

  // 出行日期（日期无中文空格，直接用 parenFixed 匹配）
  const tm = parenFixed.match(/(?:行程时间|上车时间)[：:]\s*(\d{4}-\d{2}-\d{2})/) ||
             parenFixed.match(/(\d{4}-\d{2}-\d{2})\s*\d{1,2}:\d{2}/);
  if (tm) out.tripDate = tm[1];

  // 2) 按原空格分词；pdf2json 会把地址在中文间断词（如「网 约」「室 内」），
  //    需把【相邻的地址片段】重新拼回整段，但城市/表头/金额之间的边界保留。
  //    判定「已闭合的地址」则停止拼接，避免把 起点/终点 两段误并。
  const isShortAdmin = t => /^[一-龥]{2,3}(市|区|县|省)$/.test(t); // 杭州市 / 余杭区 等
  // 地名特征字：用于区分「真实地址」与「表头关键词(上车时间/行程时间/服务商…)」
  const PLACE = /[站酒店场机场路道区园区口楼门桥港厦广场号街弄栋室层苑庄村镇屯湾坡岭谷庭寓]/;
  const isAddr = s => {
    if (!s || /元|：|:|；|;|，/.test(s)) return false;  // 含金额/冒号/逗号
    if (/^\d/.test(s)) return false;                    // 以数字开头（时间/序号/金额）
    if (!/[一-龥]/.test(s)) return false;               // 必须含中文
    // 含括号的详细地址 / 含连字符的中文地址 / 含地名特征字的中文串(≥3字)
    return /\(/.test(s) || /-/.test(s) || (PLACE.test(s) && /[一-龥]{3,}/.test(s));
  };
  const isComplete = t => t.endsWith(')') || isShortAdmin(t) || /[一-龥]{4,}$/.test(t);

  const tokens = parenFixed.split(/\s+/).filter(Boolean).map(clean);
  const merged = [];
  for (const tok of tokens) {
    const prev = merged[merged.length - 1];
    const canGlue = prev && !isShortAdmin(prev) && !isComplete(prev) &&
      /[一-龥)\-]/.test(prev.slice(-1)) && /^[一-龥(]/.test(tok); // 上一段未闭合且首尾可衔接
    if (canGlue) merged[merged.length - 1] = prev + tok;
    else merged.push(tok);
  }

  // 3) 城市之后的两段地址即 起点/终点（单行程行程单恰好两段）
  const addrs = merged.filter(t => !isShortAdmin(t) && isAddr(t));
  if (addrs.length >= 2) {
    out.fromStation = addrs[0].trim();
    out.toStation = addrs[1].trim();
    if (addrs.length > 2) out.tripUncertain = true; // 多于两段，顺序需人工复核
  } else if (addrs.length === 1) {
    out.fromStation = addrs[0].trim();
    out.tripUncertain = true;
  }
  return out;
}

function extractTravel({ fullText = '', docType = '', seller = '', category = '' }) {
  const text = (fullText || '').replace(/\s+/g, ' ');
  const type = inferTransportType({ docType, seller, text });

  // 行程单（高德/滴滴/T3 的 itinerary）：文字层含完整 起点/终点/城市，自动抽取起终点
  if (/行程单|起点|终点|上车时间|AMAP ITINERARY|ITINERARY/.test(text)) return extractItinerary(text);

  const isTrain = /铁路电子客票|携程火车票/.test(`${seller} ${text}`) ||
    (/[A-Z]\d{2,4}/.test(text) && /站/.test(text) && /电子客票/.test(text));
  const isRide = type === '打车' || /客运服务|出行服务费/.test(text);

  if (isTrain) return extractTrain(text);
  if (isRide) return extractRide(text);
  if (type === '飞机' || type === '汽车') {
    return { transportType: type, tripDate: null, fromStation: null, toStation: null, tripUncertain: true };
  }
  return null; // 非差旅，不产出 travel
}

module.exports = { extractTravel, inferTransportType, normalizeDate };
