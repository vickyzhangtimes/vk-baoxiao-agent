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

// 机票 / 航空运输电子客票行程单：保守抽取日期、航班号和起降地。
function extractFlight(text) {
  const out = { transportType: '飞机', tripDate: null, fromStation: null, toStation: null,
    flightNo: null, tripUncertain: true, legs: [] };
  const dm = text.match(/(?:乘机日期|航班日期|出发日期|起飞日期|日期)[：:]?\s*(\d{4}[年\-\/]\d{1,2}[月\-\/]\d{1,2})/) ||
    text.match(/(\d{4}[年\-\/]\d{1,2}[月\-\/]\d{1,2})\s*(?:\d{1,2}:\d{2})?/);
  if (dm) out.tripDate = normalizeDate(dm[1]);
  const fm = text.match(/(?:航班号|航班号码|FLIGHT(?:\s*NO)?)[：:]?\s*([A-Z0-9]{2}\s*\d{3,4})/i) ||
    text.match(/\b([A-Z0-9]{2}\d{3,4})\b/);
  if (fm) out.flightNo = fm[1].replace(/\s+/g, '').toUpperCase();

  const fromM = text.match(/(?:出发地|始发地|起飞机场|出发机场|FROM)[：:]?\s*([^\s,，;；]{2,40})/i);
  const toM = text.match(/(?:到达地|目的地|降落机场|到达机场|TO)[：:]?\s*([^\s,，;；]{2,40})/i);
  if (fromM) out.fromStation = fromM[1].trim();
  if (toM) out.toStation = toM[1].trim();

  if (!out.fromStation || !out.toStation) {
    const airports = [...text.matchAll(/([一-龥]{2,16}(?:国际)?机场(?:T\d)?)/g)].map(m => m[1]);
    const unique = [...new Set(airports)];
    if (!out.fromStation && unique[0]) out.fromStation = unique[0];
    if (!out.toStation && unique[1]) out.toStation = unique[1];
  }
  if (out.fromStation || out.toStation) out.legs = [{ from: out.fromStation, to: out.toStation }];
  out.tripUncertain = !(out.fromStation && out.toStation);
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
  // legs: 高德/滴滴/T3 行程单可能含多段行程，逐段记录 {from,to}
  const out = { transportType: '打车', tripDate: null, fromStation: null, toStation: null, tripUncertain: false, legs: [] };
  // 合并括号内被空格断开的词，如 "(厦 门鹭江道店)" → "(厦门鹭江道店)"
  const parenFixed = String(text || '').replace(/\(([^)]*)\)/g, m => '(' + m.slice(1, -1).replace(/\s+/g, '') + ')');
  const clean = s => String(s || '').replace(/([一-龥])\s+(?=[一-龥])/g, '$1');

  // 出行日期（日期无中文空格，直接用 parenFixed 匹配）
  const tm = parenFixed.match(/(?:行程时间|上车时间)[：:]\s*(\d{4}-\d{2}-\d{2})/) ||
             parenFixed.match(/(\d{4}-\d{2}-\d{2})\s*\d{1,2}:\d{2}/);
  if (tm) out.tripDate = tm[1];

  const isShortAdmin = t => /^[一-龥]{2,3}(市|区|县|省)$/.test(t); // 厦门市 / 余杭区 等
  // 地名特征字：用于区分「真实地址」与「表头关键词(上车时间/行程时间/服务商…)」
  const PLACE = /[站酒店场机场路道区园区口楼门桥港厦广场号街弄栋室层苑庄村镇屯湾坡岭谷庭寓]/;
  // 排除表头/元信息/服务商/车型等噪声
  const BAD = /元|：|:|；|;|，|,|申请时间|行程时间|行程人|手机号|共计|合计|说明|页码|序号|服务商|车型|上车时间|城市|起点|终点|金额|高德地图|行程单|AMAP|ITINERARY|至|公里|km|优惠|路桥|停车|附加/i;
  const isAddr = s => {
    if (!s || BAD.test(s)) return false;
    if (/^\d/.test(s)) return false;                 // 序号/时间/金额
    if (!/[一-龥A-Za-z]/.test(s)) return false;     // 必须含中文或字母
    // 含括号的详细地址 / 含连字符 / 含间隔号· / 含地名特征字(≥3中文) / 含英文(商场地标如 AI PLAZA)
    return /\(/.test(s) || /-/.test(s) || /·/.test(s) ||
           (PLACE.test(s) && /[一-龥]{3,}/.test(s)) || /[A-Za-z]{2,}/.test(s);
  };

  // 按「金额 X.XX元」切分每段行程明细；每段 = 一次行程（起点→终点 在金额前）
  const body = parenFixed.replace(/\s+/g, ' ');
  const trips = [...body.matchAll(/([\s\S]*?)(\d{1,6}\.\d{2})\s*元/g)];
  for (const m of trips) {
    const seg = m[1];
    const toks = seg.split(/\s+/).filter(Boolean).map(clean);
    // 起点/终点一定在「城市」(短行政区划，如 厦门市) 之后；城市前的服务商/车型一律忽略
    const cityIdx = toks.findIndex(t => isShortAdmin(t));
    const addrToks = cityIdx >= 0 ? toks.slice(cityIdx + 1) : toks;
    const addrs = addrToks.filter(t => !isShortAdmin(t) && isAddr(t));
    if (addrs.length >= 1) {
      const from = addrs[0];
      // 终点可能含空格（如「西岸凤巢AI PLAZA」），其余地址片段一并拼接
      const to = addrs.slice(1).join(' ') || null;
      out.legs.push({ from, to });
    }
  }
  if (out.legs.length) {
    out.fromStation = out.legs[0].from;
    out.toStation = out.legs[0].to;
    out.tripUncertain = out.legs.some(leg => !leg.from || !leg.to);
  } else {
    out.tripUncertain = true;
  }
  return out;
}

function extractTravel({ fullText = '', docType = '', seller = '', category = '' }) {
  const text = (fullText || '').replace(/\s+/g, ' ');
  const type = inferTransportType({ docType, seller, text });

  if (type === '飞机') return extractFlight(text);

  // 行程单（高德/滴滴/T3 的 itinerary）：文字层含完整 起点/终点/城市，自动抽取起终点
  const strongItinerary = /行程单|AMAP ITINERARY|\bITINERARY\b/i.test(text) ||
    (/服务商/.test(text) && /车型/.test(text) && /城市/.test(text) && /起点/.test(text) && /终点/.test(text) && /金额/.test(text));
  if (strongItinerary) return extractItinerary(text);

  const isTrain = /铁路电子客票|携程火车票/.test(`${seller} ${text}`) ||
    (/[A-Z]\d{2,4}/.test(text) && /站/.test(text) && /电子客票/.test(text));
  const isRide = type === '打车' || /客运服务|出行服务费/.test(text);

  if (isTrain) return extractTrain(text);
  if (isRide) return extractRide(text);
  if (type === '汽车') {
    return { transportType: type, tripDate: null, fromStation: null, toStation: null, tripUncertain: true };
  }
  return null; // 非差旅，不产出 travel
}

module.exports = { extractTravel, extractItinerary, extractFlight, inferTransportType, normalizeDate };
