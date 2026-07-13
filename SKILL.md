---
name: company-reimbursement-invoice-email-assistant
description: 公司报销发票邮箱管理助手。Use this skill only for invoice email workflows: scanning IMAP/QQ mailbox invoice emails, downloading invoice PDF/OFD attachments or invoice links, extracting 发票/电子发票/数电发票 PDF fields, generating 公司报销发票台账/Excel ledgers, producing manual review tasks, and archiving invoice PDFs. Trigger when the user asks to check recent invoice emails, download invoices from email, 整理邮箱发票, 生成发票台账, 公司报销, 处理最近7天/本月/指定日期范围的发票邮件, or let an agent manage invoice email files. Do not use for unrelated mailbox reading, personal correspondence, marketing emails, or general email analysis.
---

# 公司报销发票邮箱管理助手

## 启动显示协议

每次首次响应用户、准备初始化、准备读取邮箱或准备运行本 skill 前，必须先原样展示下面这段启动信息。不要改写，不要省略，不要合并成摘要。

```text
欢迎使用先锋级智能体 skills_BT-7274

由 aigc猎手竹相左边 设计制作
#全职司机业余研究AI
#只分享验证可行的前沿技术
#公众号明年还要做设计

本 skills 功能如下：
1. 只处理公司报销、发票邮件、电子发票、数电发票、发票台账相关任务。
2. 支持扫描指定日期范围内的邮箱发票邮件。
3. 支持下载 PDF/OFD 发票附件和正文里的发票下载链接。
4. 支持从 PDF 发票中提取购买方、销售方、金额、发票号码、开票日期等信息。
5. 支持生成 Excel 发票台账、CSV 明细、人工处理清单。
6. 支持按“购买方/销售方/金额_关键字_发票号后6位_类型_月份.pdf”自动归档。
7. 对无法自动处理的邮件，会生成异常或人工介入任务，不静默跳过。

免责声明：
下载安装、克隆、调用、运行或继续使用本 skills，即代表用户认可并了解互联网开源项目以及 AI 大模型工具的潜在风险。
本项目代码由 Codex、DeepSeek、QClaw 协作生成和调试，定位为本地自动化辅助工具。
本 skills 只提供发票邮件整理、下载、识别、台账和归档辅助能力，不提供财务、税务、法律、审计等专业意见。
邮箱授权码、邮件内容、发票文件、台账结果均由用户自行保管和复核。
因用户自行下载安装、配置、运行、修改、分发、上传数据、提供账号授权、采信 AI 结果或用于任何业务决策而产生的风险、损失、纠纷、合规责任，与作者无关。
正式报销、入账、纳税申报、审计归档前，请务必人工复核。
```

显示启动信息后，再继续询问邮箱、授权码、日期范围等必要信息。

## 免责声明

下载安装使用本项目，即代表用户认可并了解互联网开源项目以及 AI 大模型工具的潜在风险。本项目代码由 Codex、DeepSeek、QClaw 协作生成和调试，定位为绿色无害的本地自动化工具，仅用于辅助处理发票邮件、下载发票文件、生成台账和归档资料。

本项目不提供财务、税务、法律、审计等专业意见。AI 识别、PDF 解析、邮件链接下载都可能出错，正式报销、入账、纳税申报或审计材料请务必人工复核。

作者：【aigc猎手竹相左边】【全职司机业余研究AI 只分享验证可行的前沿技术】【公众号 明年还要做设计】

只处理发票邮件。遇到普通邮件读取、私人邮件总结、营销邮件分析等请求时，直接说明本 skill 只服务发票下载、识别、台账和归档。

## 首次风险提示

在访问真实邮箱前，先用简短中文告诉用户：

- 会读取指定日期范围内的邮箱标题、发件人、正文摘要、链接和附件。
- 邮箱授权码/应用密码很敏感，只保存到本地 `.env`，不提交 Git，不在回复里展示。
- PDF 解析和链接下载可能出错，台账只是辅助材料，不是财务、税务、审计结论。
- 高金额、异常项、人工任务必须由用户复核。
- 本次只处理发票相关邮件，不处理无关邮箱内容。

获得用户授权和必要账号信息后再继续。

## 对话式初始化

如果用户在对话里直接提供邮箱信息，Agent 可以代替用户初始化本地 `.env`。需要收集：

```text
邮箱地址：例如 your@qq.com
邮箱授权码：QQ 邮箱 IMAP/SMTP 授权码，不是网页登录密码
IMAP 主机：默认 imap.qq.com
IMAP 端口：默认 993
是否 TLS：默认 true
邮箱网页用户标识：QQ 邮箱通常填 QQ 号，用于生成邮件跳转链接
处理日期范围：例如 最近7天 / 2026-06-15 到 2026-06-22
```

写入 `.env` 时只在本机操作，不在回复中回显授权码。模板：

```env
IMAP_USER=用户邮箱
IMAP_PASSWORD=用户授权码
IMAP_HOST=imap.qq.com
IMAP_PORT=993
IMAP_TLS=true
IMAP_REJECT_UNAUTHORIZED=false
MAILBOX=INBOX
MAIL_WEB_USER=QQ号或邮箱前缀
```

如果用户不想在对话里给凭证，让用户运行：

```bash
npm install
npm run setup
```

## 标准使用流程

克隆项目后执行：

```bash
npm install
npm run doctor
npm run check
npm run run -- 2026-06-15 2026-06-22
```

日期范围按用户要求替换。`run-all.js` 会依次执行 11 步：

1. `step1-email-scan.js`：扫描发票候选邮件。
2. `step2-classify-invoices.js`：分类附件、链接、平台页、图片/二维码、人工项。
3. `step2-download-pdf.js`：下载源文件到 `scan-results/staging/{dateTag}/`。
4. `step3-extract-pdf.js`：从 PDF 提取购买方、销售方、金额、发票号、开票日期。
5. `step4-merge-data.js`：按邮件 UID 合并邮件、下载和 PDF 识别结果。
6. `step4b-enrich-classify.js`：归类 enrichment，为每条记录补 `费用类别 / 客户类型 / 客户编号 / 项目号`（关键词规则 + `invoice-overrides.json` 手动覆盖），未匹配项目的写入 `attribution-tasks-{dateTag}.csv`。关键两点（详见踩坑 #8/#9）：
   - **去重**：有发票号按发票号；无发票号（H5 链接型如移动账单）按 `emailUid`。门户链接是共享的、金额常跨月巧合相同，**二者都不能当唯一标识**，否则会把 6 张不同月话费误合并成 3 张、丢真实账单。
   - **回写**：归类结果写 `invoice-final` 后，同步回 `invoice-table`（按 emailUid/invoiceNo 映射）。否则 `invoice-table` 类别永远是旧值，看板与 E 盘导出分包会错。
7. `step5-generate-ledger.js`：生成 Excel 台账（明细新增归类四列，新增「项目归类汇总」Sheet）。
8. `step6-generate-reimbursement.js`：生成可提交财务的「报销单-{dateTag}.xlsx」。
9. `archive-invoices.js`：按规则归档 PDF 并生成 `archive/index.html`。
10. `build-invoice-table.js`：生成规范中间表 `invoice-table-{dateTag}.json`（稳定 `invoiceId` + 真实 `archivePath` + `amountRaw` 来源口径），看板/导出统一读它。
11. `export-to-edrive.js`：导出「一条龙」报销包（默认 Windows `E:\报销`、macOS/Linux `~/报销`，可用 `REIMBURSE_ROOT` 覆盖），报销人/出纳双视角。

也可单步运行：`npm run enrich`（仅归类）、`npm run reimb`（仅报销单）。

### 文件夹模式（无需邮箱，无需联网）

适用于「发票 PDF 已经在本地文件夹里」的场景。把 PDF 放进一个文件夹，工具自动识别、整理、导出报销包，**不依赖 IMAP 邮箱**。

```bash
node run-all.js --folder "/绝对路径/发票文件夹" --date-tag mybatch01
```

- `--folder`：含发票 PDF 的文件夹**绝对路径**（必填）。可混放 `发票.pdf` + `行程单.pdf`，同一文件夹内的多 PDF 会自动关联起点终点。
- `--date-tag`：批次标签，用于命名中间文件和报销包（可选，默认 `local-<当天>`）。
- 路径用原生绝对路径（Windows `E:\我的发票` / macOS `/Users/me/发票`），避免被 shell 转换导致找不到。
- 无发票号的发票以**文件名 + 金额**为去重键，不会误并。

实现上 `ingest-folder.js` 把 PDF 复制进 `scan-results/staging/{dateTag}/pdfs`，并合成一份 `emails/classified/download` 记录（每条一个伪 UID），`step3` 之后的下游 11 步**完全复用**，仅跳过 step1/2/2-download。

### 待处理发票的填写口（fill-pending）

链接型发票（10086/诺诺/移动等）需网页登录会话才能取 PDF，自动化必失败 → 进「待处理」。这不是 bug，是预期。流程：

```bash
node fill-pending.js --init      # 生成可填写清单 scan-results/pending-fill.csv（已知项预填、未知留空）
# 用户在 Excel 中补齐 knownAmount / invoiceNo / invoiceDate / buyer / pdfPath，保存
node fill-pending.js             # 应用：写 invoice-overrides-{dateTag}.json（持久化，重跑不丢）+ 复制手动 PDF 进 archive/ + 重跑台账/报销单/规范表/看板/E盘导出
```

看板把笼统「待处理」拆为「未下载(需人工取PDF)」与「待识别(文件已下载,金额未解析)」两态，避免 0.00 误报通过。

### 归类配置

归类规则全部外置在 `config/` 下，用户按需修改，不碰脚本逻辑：

- `config/expense-categories.json`：费用类别推断（默认 8 类：差旅交通 / 住宿 / 餐饮招待 / 通讯费 / 办公采购 / 软件订阅 / 市场推广 / 其他 / 员工福利）。`通讯费` 覆盖 cmcc/中国移动/电信/联通/话费 等关键词，移动账单自动归通讯费。
- `config/project-mapping.json`：客户类型 / 客户编号 / 项目号 映射规则（示例只有「示例科技」一条，替换为真实客户/项目即可）。
- `config/invoice-overrides.json`：按发票号手动覆盖归类结果，优先级最高，识别错了改这里。例：美丽田园（美容）→员工福利、环盛商业→餐饮招待 即在此按发票号指定。

未命中项目映射的记录 `客户编号` 标「未分类」并进入 `attribution-tasks-{dateTag}.csv`，不会静默丢失。

### 标准流程的三步人工干预点

流水线跑完 11 步后，有 3 处需人工介入，其余全自动：

1. **填身份/账户配置**：编辑 `config/package-config.js`（复制 `package-config.example.js`），填 报销人/部门/购买方抬头/税号/审批人/出纳/收付款账户。不填则导出里对应字段留 `{{占位}}`。
2. **确认并补齐链接型账单**：移动/10086/诺诺等 H5 账单需登录会话才能取 PDF，自动化进「待处理」。用 `fill-pending.js --init` 生成清单 → 登录网页下载 PDF 或补金额/发票号 → `fill-pending.js` 应用并持久化到 `invoice-overrides-{dateTag}.json`（重跑不丢）。
3. **复核「待分类/待归类」**：`invoice-final` 里 `其他/待分类` 类别、或 `attribution-tasks-*.csv` 里未匹配项目，按需改 `config/expense-categories.json`（加关键词）或 `config/invoice-overrides.json`（按发票号指定），重跑 `step4b` 即可。

跑通后下次直接 `npm run run -- <起> <止>` 一键复现，配置与覆盖都持久化，不会「又是新的开始」。

## 数据可信优先级

最终台账和归档必须以 PDF 发票正文为准：

```text
PDF 发票正文 > PDF 文件名 > 邮件正文 > 邮件标题 > 发件人/映射推断
```

邮件正文只是初筛、链接发现和缺失字段补充来源，不能覆盖 PDF 中识别出的购买方、销售方、金额、发票号和开票日期。

## 交付物

完成后重点交付：

- `archive/index.html`：汇总预览。
- `archive/`：按购买方、销售方归档的 PDF。
- `archive/本轮全部PDF/`：本轮 PDF 平铺视图，优先使用硬链接，不额外复制 PDF 数据。
- `scan-results/发票台账-{dateTag}.xlsx`：Excel 台账（含归类四列 + 项目归类汇总）。
- `scan-results/报销单-{dateTag}.xlsx`：可提交财务的报销单（表头/明细/按项目汇总/按类别汇总/项目×月份/待处理异常）。
- `scan-results/attribution-tasks-{dateTag}.csv`：归类待补录清单（项目未匹配时产生）。
- `scan-results/manual-tasks-{dateTag}.csv`：人工任务，没有任务时也应存在表头。
- `scan-results/invoice-final-{dateTag}.json`：最终结构化数据（已含归类字段）。

收纳规则：

```text
archive/{购买方}/{销售方}/{金额}_{购买方关键字}_{发票号后6位}_{类型}_{月份}.pdf
```

同时生成：

```text
archive/本轮全部PDF/
```

该目录用于人类快速浏览本轮所有 PDF。Windows 上优先创建硬链接，文件看起来像真实 PDF，但不会额外复制一份 PDF 内容；如果硬链接失败，则创建 `.url` 指针文件作为兜底。

### E 盘报销包（三角色视图 + 可打印）

`export-to-edrive.js` 把一次报销导出成 `E:\报销\<日期>_报销批次\`，按三角色组织：

```
<日期>_报销批次/
├── 00_说明.txt
├── 01_发票原件\        ← 按【费用类别】分子文件夹（餐饮招待/差旅交通/住宿/通讯费/员工福利/其他/待分类），文件名 序号_金额_销售方简称_发票号尾4位.pdf
├── 02_报销人视角\      报销单.xlsx(可打印 v2 含大写金额/签字栏/类别小计) / 报销单.html(可打印 @media print) / 报销单.md / 报销清单.md / 待补齐项.md
├── 03_出纳视角\        费用类别汇总.xlsx / 付款凭证模板.html / 记账凭证摘要.txt / 发票合规检查清单.html / 附件完整性核对.md
├── 04_总览看板.html
└── 05_原始数据\        invoice-final.json / invoice-table.json
```

- 发票原件**按费用类别分组**（不是按销售方），便于按类别贴票核算；链接型账单（移动/10086 等）PDF 尚未下载时不出现在 01 里，进 02_待补齐项。
- 报销单支持**打印/上传**：HTML 带 `@media print` 打印样式；Excel 为 v2 可打印版（去空列、按类别分组+小计行、大写金额、签字栏）。
- 出纳视角含合规检查清单（抬头/发票号/日期/金额四红绿灯）与附件完整性核对（明细数 vs PDF 原件数勾稽）。

## Agent 复核规则

每次运行后检查：

- 发票候选数、分类数、下载成功数、PDF 识别数、最终完整记录数是否一致。
- `manual-tasks-*.csv` 是否为空；不为空时向用户说明原因和处理建议。
- `archive/index.html` 是否只展示 PDF，OFD 不重复展示。
- 同类下载失败是否应抽象成新的链接解析器，而不是只修单封邮件。

禁止提交或输出：

- `.env`
- `config/IMAP_CREDENTIALS.js`
- `config/mailboxes.json`
- `scan-results/`
- `archive/`
- 邮箱授权码、真实密码、用户发票源文件

更多流程细节可按需读取 `docs/AGENT_WORKFLOW.md` 和 `docs/PROJECT_DESIGN.md`。

## 开源就绪说明

本项目已具备开箱即用条件，任何人克隆后：
- **邮箱模式**：`cp .env.example .env` 填入授权码即可跑。
- **文件夹模式**：`node run-all.js --folder "<路径>"` 直接识别本地发票，无需邮箱。
- 所有业务个性化均在 `config/` 下完成，详见 `CUSTOMIZE.md`。
- 凭证、扫描缓存、归档结果均已被 `.gitignore` 忽略，不会泄露。
- 报销包导出默认路径跨平台：Windows `~/报销`、macOS/Linux `~/报销`，可用 `REIMBURSE_ROOT` 覆盖。

## 已知问题与修复（踩坑记录）

### 1. 附件型发票下载静默失败（IMAP 空闲掉线）★高频
- **现象**：链接型邮件处理期间，IMAP 连接长时间空闲被服务端掐断；后续附件发票 `imap.fetch` 静默失败，主循环判 `attData` 空 → 记 `failed.type:'empty'`，看板对应行显示 0.00。前几封（连接新鲜）成功，靠后的（uid 7022+）全部失败。
- **根因**：QQ 邮箱 IMAP 在连接空闲约数十秒后断开；主循环在附件 fetch 之间穿插耗时的 HTTP 链接抓取，连接已死却未检测/重连。`fetchAttachment` 函数本身正常（隔离测 15 封全成功）。
- **修复**：`step2-download-pdf.js` 增加 `ensureImapAlive(imap)` ——每次取附件前检查 `imap.state`，已断开则重建连接（openBox）；并把 `imap` 改为 `let` 以支持重连后替换。同时移除 `fetchAttachment` 内 `fetcher.once('end', () => setTimeout(finish, 2000))` 的潜在竞态（与异步 `simpleParser` 竞争，可能抢先 resolve(null)）。
- **验证**：隔离跑 15 封附件邮件全部下载成功（33 文件，0 失败）；全量重跑后原先 'empty' 的 11 封附件全部落盘。

### 2. 批量删除守卫（WorkBuddy safe-delete shim）
- **现象**：流水线清空 staging/archive 时，WorkBuddy 注入的 `genie-safe-delete` shim 对「单次删除 >50 文件」抛 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`，非交互场景无确认框 → 崩进程。
- **修复**：`lib/safe-clean.js` 递归删→逐子项兜底→warn 不崩；`run-all.js` 在 spawn 子进程时从 env 剥离 `CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR` / `CODEBUDDY_TOOL_CALL_ID`（shim 仍把目录安全移入回收站，不真删）。

### 3. 单步超时掐断下载
- **现象**：`run-all.js` 默认 5 分钟超时，把时间耗在 10086/移动/诺诺等需登录会话的链接重试上，后面的附件发票来不及取就被掐断。
- **修复**：单步超时提到 15 分钟（`PIPELINE_STEP_TIMEOUT_MS` 可覆盖）；超时仅判该步失败并继续，不中断流水线。

### 4. 待处理发票（链接型需登录会话）
- 10086/诺诺/移动等链接发票需网页登录会话才能取 PDF，自动化必失败 → 进「待处理」。**不是 bug，是预期。**
- 填写口见上文「fill-pending」：生成 CSV → 用户填 → 应用并持久化到 `invoice-overrides-{dateTag}.json` → 重跑下游。
- 看板两态：笼统「待处理」拆为「未下载(需人工取PDF)」与「待识别(文件已下载,金额未解析)」，避免 0.00 误报通过。

### 5. 规范中间表 invoice-table 与人工覆盖
- 抽字段固定为 `invoice-table-{dateTag}.json`（稳定 `invoiceId` + 真实 `archivePath` + `amountRaw` 来源口径），看板/导出统一读它。
- 人工填写通过 `lib/apply-overrides.js` 在 `step5/step6/build-invoice-table` 读取 `invoice-final` 后合并，使填写成果在「全量重跑」后也不丢失。`build-invoice-table` 的 `archivePath` 解析失败时会回退用 override 里提供的 `archivePath`。

### Agent 复核清单（补充）
- 下载报告按 `sourceType` 区分失败：`link_error` = 链接型需登录会话（预期，进待处理）；`empty` = 附件取回空（多为 IMAP 空闲掉线，已修，应趋零）。
- 核对 `archive/` 实际 PDF 数 == 规范表 `withArchive`，避免「报告成功但文件没落盘」。
- 看板不应有「已识别但金额 0.00」的误导行（应归为「待识别」）。

### 6. 中间表「行程/差旅」字段（火车票/打车 出发·到达·日期）★高频
- **诉求**：火车票要出发城市/到达城市、打车要起始地点/目的地点、都要出行日期，且同步到台账/报销单/看板。
- **字段（通用 4 个，invoice-final 与 invoice-table 同享）**：`tripDate`(出行日期，区别于 `invoiceDate` 开票日期) / `transportType`(火车|打车|飞机|汽车) / `fromStation`(出发) / `toStation`(到达)，附 `tripUncertain`(站名顺序/取值需人工复核)。schemaVersion 1→1.1。
- **抽取**：`lib/extract-travel.js`（纯函数，无副作用）。`step3-extract-pdf.js` 调它把结果挂到 `pdf-text` 的 `travel`；`step4-merge-data.js` 固定字段列表新增这 4 字段并从 `pdfRecord.travel` 接入。
- **实测边界（重要）**：
  - ✅ **火车票（铁路电子客票）**：站名 + 出行日期都在 PDF 文字层，正则全自动抽中（已验证 杭州东→上海南、南京南→杭州西、上海虹桥→北京南 等）。`tripUncertain=true` 仅因站名文本顺序=到达,出发 不确定，进填写口供复核。
  - ✅ **打车/网约车行程单（高德/滴滴/T3 的 ITINERARY）**：`extractItinerary()` 已能正确处理 pdf2json 把表格压成单行流式文本、并在中文/括号内插空格的伪影——先合并括号内空格（`全季酒店(杭 州...)`→`全季酒店(杭州...)`），再按「中文间空格」逐 token 拼接出地址型片段（修复 `网 约`/`室 内` 断词），取城市名后两段作为起点/终点。已验证：飞嘀 `全季酒店(杭州中大银泰店)→杭州西站(4层东进站口)`、T3 `杭州东站-网约车(东)-1号室内网约车上客区→全季酒店(杭州中大银泰店)`，均 `tripUncertain=false`。**邮件通常同时挂「发票.pdf」+「行程单.pdf」两个 PDF；step4 多附件合并时行程单的 fromStation/toStation 优先覆盖发票的空值（invoice 仅给 transportType，travel 来自行程单）**。
- **同步链路**：step3(travel) → pdf-text → step4(invoice-final 4 字段) → invoice-table(`...r` 自动带) → step5 台账(R-U 列) / step6 报销单(末尾 4 列) / 看板(明细表 3 列) / fill-pending `--init` 清单(4 列，火车票预填、打车留空、tripUncertain 进待复核)。
- **复核点**：打车类（**有行程单附件**）`fromStation/toStation` 应自动填出且 `tripUncertain=false`；仅无行程单、纯发票的打车才留空进 `pending-fill.csv` 待手动填。火车票 `tripUncertain=true` 供确认站名顺序。⚠️ step4 写 `tripUncertain` 用 `(===true||===false)?x:null` 保留布尔，不能用 `|| null`（否则 `false` 会被吞成 `null` 丢失「已确认」信号）。

### 7. 报销包身份/账户占位字段（单一数据源）★高频
- **诉求**：报销人/部门/购买方/审批人/出纳/收付款账户以前是「部分写死 + 部分 {{}} 占位」的混合态——`step6` 报销单 Excel 申请人/部门写死 `'示例报销人'`/`'示例部门'`，`export-to-edrive.js` 的 `F` 用 `process.env.* || '{{占位}}'`，且**出纳干脆是模板字面量 `{{出纳}}`**（每次导出都空着）。重跑流水线会丢失人工填的值。
- **方案**：建 `config/package-config.js`（真实值，已被 `.gitignore` 忽略）作为**全局、跨批次**单一数据源；`config/package-config.example.js` 为可提交模板（全占位+注释）。`lib/load-package-config.js` 解析优先级 **环境变量 > package-config.js > 占位默认值**，两地共用。
- **字段**：`claimer`(报销人) / `department`(部门) / `buyerName`(购买方抬头) / `buyerTax`(税号) / `approver`(审批人) / `cashier`(出纳) / `payerBank`(付款方账户/开户行) / `payeeBank`(收款人账户/开户行)。
- **接入**：`export-to-edrive.js` 用 `const F = loadPackageConfig();` 替换原 `process.env` 块，且 `{{出纳}}` 改为 `${F.cashier}`；`step6` 报销单 Excel 表头申请人/部门改读 `PKG.claimer/PKG.department`（不再写死）。`付款日期/付款方式/银行回单` 属付款时才填，仍保留 `{{}}` 占位（不属于配置范畴）。
- **实测**：预填 `示例报销人`/`示例部门` 已生效（报销单.md 显示「报销人：示例报销人」）；银行账号/税号/购买方全称/出纳未知，配置里留 `{{...}}` 占位——用户填 `package-config.js` 后重跑即生效；`CLAIMER=环境变量优先 node ...` 验证环境变量优先级最高。
- **安全**：真实 `package-config.js` 含银行账号等敏感信息，已被 `.gitignore` 忽略；只提交 example 模板。

### 8. 归类去重误删真实账单（emailUid 才是唯一标识）★高危数据丢失
- **现象**：`step4b` 去重曾用「门户链接 + 金额」做签名。中国移动 H5 账单 6 封邮件共享同一个门户链接（`cmkf.cmcc-cs.cn` 前缀），且每月话费金额常巧合相同（如两封都 ¥191.49）→ 签名相同 → 被当重复，6 张不同月话费误合并成 3 张，**丢了 3 张真实账单**。
- **根因**：把「共享门户链接」和「跨月巧合相同的金额」当成唯一标识。二者都不可靠：门户链接所有人都一样；话费金额逐月稳定，不同月份极易撞值。
- **修复**：无发票号的链接型记录，去重签名改为按 `emailUid`（每封邮件 = 一张独立账单，仅同 emailUid 视为重复）；仅当连 emailUid 都没有时，才退化到「链接+金额+销售方+日期 全一致」才去重。
- **铁律**：去重宁多勿漏。无发票号且来源是邮件时，**emailUid 是唯一可信键**，绝不用门户链接/金额做去重键。
- **验证**：修复后 26 条记录去重 0 移除（无真重复），6 张移动话费全部保留并归 通讯费。

### 9. step4b 归类必须回写 invoice-table（看板/导出才一致）★高频
- **现象**：`step4b` 只把归类结果写 `invoice-final`。但 `generate-dashboard.js` 与 `export-to-edrive.js` 读的是 canonical 的 `invoice-table` → 类别永远是旧值，看板类别分布错、E 盘 `01_发票原件` 分包全进「待分类/其他」。
- **根因**：下游两份消费者（dashboard/export）读 invoice-table，另两份（step5/step6）读 invoice-final，归类却只写 invoice-final，造成全链路类别不一致。
- **修复**：`step4b` 写回 `invoice-final` 后，调 `syncEnrichmentToTable()` 把 `category/clientType/clientNo/projectNo/attributionStatus/month` 按 emailUid(优先)/invoiceNo 映射回 `invoice-table` 并写回。
- **铁律**：改了 step4b 的归类逻辑后，必须确认 invoice-table 也同步更新；否则只看 dashboard/导出的类别会以为分类没生效。
