'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { extractTravel, extractItinerary } = require('../lib/extract-travel');
const { fallbackAmountFromFilename } = require('../step3-extract-pdf');
const { inferRecordRole, isInvoiceRecord, formatRoute, parseRouteLegs } = require('../lib/record-utils');
const { linkSupportingDocuments } = require('../lib/travel-link');
const { stagePdfs } = require('../lib/folder-intake');
const { scanArchive, resolveArchive } = require('../lib/archive-resolver');
const { isStepDirty } = require('../lib/pipeline-dirty');

test('机票抽取日期、航班号和起降机场', () => {
  const result = extractTravel({
    fullText: '航空运输电子客票行程单 乘机日期：2026-07-18 航班号：MU 5103 出发机场：上海虹桥国际机场T2 到达机场：北京首都国际机场T3',
    docType: '航空运输电子客票行程单',
    seller: '中国东方航空股份有限公司',
  });
  assert.equal(result.transportType, '飞机');
  assert.equal(result.tripDate, '2026-07-18');
  assert.equal(result.flightNo, 'MU5103');
  assert.equal(result.fromStation, '上海虹桥国际机场T2');
  assert.equal(result.toStation, '北京首都国际机场T3');
  assert.equal(result.tripUncertain, false);
  assert.equal(inferRecordRole({ docType: '航空运输电子客票行程单', fullText: '航空运输电子客票行程单' }), 'invoice');
});
test('行程单抽取单段和多段路线', () => {
  const one = extractItinerary('高德地图 行程单 AMAP ITINERARY 服务商 车型 上车时间 城市 起点 终点 金额 1 飞嘀 经济型 08:52 杭州市 全季酒店(杭州店) 杭州西站(进站口) 43.58元');
  assert.deepEqual(one.legs, [{ from: '全季酒店(杭州店)', to: '杭州西站(进站口)' }]);
  const many = extractItinerary('行程单 服务商 车型 城市 起点 终点 金额 1 A 快车 厦门市 厦门北站 中山路 12.30元 2 A 快车 厦门市 中山路 高崎机场 18.20元');
  assert.equal(many.legs.length, 2);
  assert.equal(formatRoute(many, ' | '), '厦门北站 → 中山路 | 中山路 → 高崎机场');
});

test('行程只有起点时必须标记不确定', () => {
  const result = extractItinerary('行程单 服务商 车型 城市 起点 终点 金额 1 A 快车 厦门市 厦门北站 12.30元');
  assert.equal(result.legs[0].to, null);
  assert.equal(result.tripUncertain, true);
});

test('普通出租车发票出现起点终点字样时不误走行程单解析', () => {
  const result = extractTravel({ fullText: '电子发票 发票号码 123 出租车服务 起点终点信息见附件 价税合计 20.00', docType: '发票', seller: '某出租汽车公司' });
  assert.equal(result.transportType, '打车');
  assert.equal(result.legs, undefined);
});

test('文件名金额只进入候选，不进入正式金额', () => {
  const info = fallbackAmountFromFilename({ amount: null }, '携华行程单-12.49元.pdf');
  assert.equal(info.amount, null);
  assert.equal(info.amountCandidate, '12.49');
  assert.equal(info.amountCandidateSource, 'filename');
});

test('配套凭证不计为发票；同金额多候选不自动选第一张', () => {
  const records = [
    { emailUid: 1, docType: '发票', amount: 12.49, seller: '携华', sourceRelativePath: 'A/a.pdf' },
    { emailUid: 2, docType: '发票', amount: 12.49, seller: '携华', sourceRelativePath: 'A/b.pdf' },
    { emailUid: 3, docType: '行程单', recordRole: 'supporting_document', amountCandidate: 12.49, legs: [{ from: '甲', to: '乙' }], sourceRelativePath: 'A/行程单.pdf' },
  ];
  const links = linkSupportingDocuments(records);
  assert.equal(links[0].status, 'ambiguous');
  assert.equal(records[2].manualReason, 'TRAVEL_LINK_AMBIGUOUS');
  assert.equal(records[0].legs, undefined);
  assert.equal(records.filter(isInvoiceRecord).length, 2);
});

test('唯一候选才关联，并保留关联依据', () => {
  const records = [
    { emailUid: 10, docType: '发票', amount: 35.2, seller: '高德', invoiceDate: '2026-07-01' },
    { emailUid: 11, recordRole: 'supporting_document', amountCandidate: 35.2, seller: '高德', tripDate: '2026-07-01', legs: [{ from: '甲', to: '乙' }] },
  ];
  linkSupportingDocuments(records);
  assert.equal(records[1].parentInvoiceUid, 10);
  assert.equal(formatRoute(records[0]), '甲 → 乙');
  assert.equal(records[0].travelAssociation.confidence, 'high');
});

test('文件夹收件处理同名文件并按内容哈希去重', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-intake-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const a = path.join(root, 'a'), b = path.join(root, 'b'), out = path.join(root, 'out');
  fs.mkdirSync(a); fs.mkdirSync(b);
  fs.writeFileSync(path.join(a, '发票.pdf'), 'same');
  fs.writeFileSync(path.join(b, '发票.pdf'), 'different');
  fs.writeFileSync(path.join(b, '副本.pdf'), 'same');
  const result = stagePdfs([path.join(a, '发票.pdf'), path.join(b, '发票.pdf'), path.join(b, '副本.pdf')], root, out);
  assert.equal(result.staged.length, 2);
  assert.equal(result.duplicates.length, 1);
  assert.notEqual(result.staged[0].stagedFilename, result.staged[1].stagedFilename);
});

test('归档解析不扫描扁平目录，也不把无条件记录塌到首文件', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-archive-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '本轮全部PDF'));
  fs.mkdirSync(path.join(root, '客户'));
  fs.writeFileSync(path.join(root, '本轮全部PDF', '10.00_A_123456_uid1.pdf'), 'x');
  fs.writeFileSync(path.join(root, '客户', '10.00_A_123456_uid1.pdf'), 'x');
  const idx = scanArchive(root, '本轮全部PDF');
  assert.equal(idx.length, 1);
  assert.equal(resolveArchive({}, idx), null);
  assert.equal(resolveArchive({ invoiceNo: 'ABC123456' }, idx), idx[0].file);
});

test('任一声明输出缺失时步骤必须重跑', () => {
  const fakeFs = { statSync(file) { if (file === 'missing') throw new Error('ENOENT'); return { mtimeMs: file === 'input' ? 1 : 2 }; } };
  assert.equal(isStepDirty(fakeFs, { inputs: ['input'], outputs: ['output', 'missing'] }), true);
});

test('多段路线人工字段可往返解析', () => {
  assert.deepEqual(parseRouteLegs('甲→乙 | 乙→丙'), [{ from: '甲', to: '乙' }, { from: '乙', to: '丙' }]);
});

test('行程单角色推断不会被当作发票', () => {
  assert.equal(inferRecordRole({ docType: '行程单', filename: '高德行程单.pdf' }), 'supporting_document');
  assert.equal(inferRecordRole({ docType: '发票', fullText: '高德地图 行程单 AMAP ITINERARY' }), 'supporting_document');
});
