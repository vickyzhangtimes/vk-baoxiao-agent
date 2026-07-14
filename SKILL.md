---
name: vk-baoxiao-agent
description: "本地优先的 VK BaoXiao Agent 与可安装 Skill。可首次读取现有报销模板和规则资料，生成本地配置与模板版本；之后根据邮箱日期或任意本地文件夹地址，自动识别发票、机票/航空电子客票、火车票、网约车行程单和图片结构化结果，再计算、归类、填写报销单、归档并导出完整报销包。Use when the user asks to 学习/接入报销模板、整理发票、扫描发票邮箱、识别发票或机票图片、生成报销台账/报销单、归档报销材料或运行报销流水线。Do not use for unrelated mailbox reading or professional tax/legal advice。"
---

# VK BaoXiao Agent

## 定位与运行边界

这是 VK BaoXiao Agent 的 Skill 入口。先判断输入是邮箱、PDF 文件夹还是图片；先展示权限计划并取得显式授权，再调用确定性流水线。不要在对话中索取或回显邮箱授权码，优先让用户运行 `npm run setup` 在本机录入。

- Controller：`agent-controller.js`
- 确定性流水线：`run-all.js`（只允许 Controller 调用）
- 图片契约：需要图片时读取 `references/image-intake-schema.md`
- 完整架构：按需读取 `docs/AGENT_ARCHITECTURE.md`
## 免责声明

下载安装使用本项目，即代表用户认可并了解互联网开源项目以及 AI 大模型工具的潜在风险。本项目代码由 Codex、DeepSeek、QClaw 协作生成和调试，定位为绿色无害的本地自动化工具，仅用于辅助处理发票邮件、下载发票文件、生成台账和归档资料。

本项目不提供财务、税务、法律、审计等专业意见。AI 识别、PDF 解析、邮件链接下载都可能出错，正式报销、入账、纳税申报或审计材料请务必人工复核。

维护者：Vicky（VK Agent Lab，X：`@vickyzhangtimes`）。基于 aigc猎手竹相左边 发布的 MIT 上游版本继续开发，准确版权声明与上游链接见 LICENSE。

只处理发票邮件。遇到普通邮件读取、私人邮件总结、营销邮件分析等请求时，直接说明本 skill 只服务发票下载、识别、台账和归档。

## 首次风险提示

在访问真实邮箱前，先用简短中文告诉用户：

- 会读取指定日期范围内的邮箱标题、发件人、正文摘要、链接和附件。
- 邮箱授权码/应用密码很敏感，只保存到本地 `.env`，不提交 Git，不在回复里展示。
- PDF 解析和链接下载可能出错，台账只是辅助材料，不是财务、税务、审计结论。
- 高金额、异常项、人工任务必须由用户复核。
- 本次只处理发票相关邮件，不处理无关邮箱内容。

获得用户授权和必要账号信息后再继续。

## 本地初始化

首次克隆后在本机运行：

```bash
npm install
npm run init
npm run doctor -- --mode folder
npm run config:check
```

邮箱模式再运行：

```bash
npm run setup
npm run doctor -- --mode email
```

授权码只写入本地 `.env`，不得在对话、日志或 Git 中展示。文件夹和图片模式不需要邮箱配置。

## 首次模板与规则接入

用户提供现有 `.xlsx` 报销模板、脱敏历史报销单或报销制度时，先读取 `docs/templates.md`，然后：

1. 保留原件，只在本地创建可版本化的模板副本和配置；不将真实材料提交 Git。
2. 识别抬头、明细行、合计、签字/审批区及费用分类，展示“源字段 → 模板字段”映射。
3. 在用户确认前，不覆盖原模板、不写入正式身份/账户配置、不将推测规则当成财务事实。
4. 确认后用合法 token 生成模板副本，完成宏、外联公式和路径安全检查，注册模板版本并设置 `REIMBURSEMENT_TEMPLATE`。
5. 将稳定的费用/客户/项目规则保存到本地 `config/`，后续日常任务只需邮箱日期或文件夹绝对路径。

这里的“学习”是把用户确认的字段映射和规则固化为本地配置/模板版本，不是将真实报销材料上传训练公共模型。

## 标准使用流程

邮箱模式执行：

```bash
npm run agent -- 2026-06-15 2026-06-22 --plan
npm run agent -- 2026-06-15 2026-06-22 --approve mail.read,network.download,filesystem.clean,filesystem.write-output
```

日期范围按用户要求替换。`run-all.js` 会依次执行 12 步报销流水线（详见 `docs/AGENT_WORKFLOW.md`）：

1. `step1-email-scan.js`：扫描发票候选邮件。
2. `step2-classify-invoices.js`：分类附件、链接、平台页、图片/二维码、人工项。
3. `step2-download-pdf.js`：下载源文件到 `scan-results/staging/{dateTag}/`。
4. `step3-extract-pdf.js`：从 PDF 提取购买方、销售方、金额、发票号、开票日期；机票/航空电子客票同时提取乘机日期、航班号和起降机场。
5. `step4-merge-data.js`：按邮件 UID 合并邮件、下载和 PDF 识别结果。
6. `step4b-enrich-classify.js`：归类 enrichment，为每条记录补 `费用类别 / 客户类型 / 客户编号 / 项目号`（关键词规则 + `invoice-overrides.json` 手动覆盖），未匹配项目的写入 `attribution-tasks-{dateTag}.csv`。关键两点（详见踩坑 #8/#9）：
   - **去重**：有发票号按发票号；无发票号（H5 链接型如移动账单）按 `emailUid`。门户链接是共享的、金额常跨月巧合相同，**二者都不能当唯一标识**，否则会把 6 张不同月话费误合并成 3 张、丢真实账单。
   - **回写**：归类结果写 `invoice-final` 后，同步回 `invoice-table`（按 emailUid/invoiceNo 映射）。否则 `invoice-table` 类别永远是旧值，看板与 E 盘导出分包会错。
7. `step5-generate-ledger.js`：生成 Excel 台账（明细新增归类四列，新增「项目归类汇总」Sheet）。
8. `step6-generate-reimbursement.js`：生成可提交财务的「报销单-{dateTag}.xlsx」。
9. `archive-invoices.js`：按规则归档 PDF 并生成 `archive/index.html`。
10. `build-invoice-table.js`：生成规范中间表 `invoice-table-{dateTag}.json`（稳定 `invoiceId` + 真实 `archivePath` + `amountRaw` 来源口径），看板/导出统一读它。
11. `export-to-edrive.js`：导出「一条龙」报销包（默认各平台 `~/报销`，可用 `REIMBURSE_ROOT` 覆盖），报销人/出纳双视角。
12. `generate-dashboard.js`：生成 HTML 报销看板，集中展示金额、分类、差旅行程与待复核项。

也可单步运行：`npm run enrich`（仅归类）、`npm run reimb`（仅报销单）。

### 文件夹模式（无需邮箱，无需联网）

适用于「发票 PDF 已经在本地文件夹里」的场景。把 PDF 放进一个文件夹，工具自动识别、整理、导出报销包，**不依赖 IMAP 邮箱**。

```bash
npm run agent -- --folder "/绝对路径/发票文件夹" --date-tag mybatch01 --approve filesystem.read-input,filesystem.clean,filesystem.write-output
```

- `--folder`：含报销 PDF 的文件夹**绝对路径**（必填）。可混放普通发票、机票/航空电子客票、火车票、网约车行程单和配套凭证；行程明细只在候选唯一时自动关联。
- `--date-tag`：批次标签，用于命名中间文件和报销包（可选，默认 `local-<当天>`）。
- 路径用原生绝对路径（Windows `E:\我的发票` / macOS `/Users/me/发票`），避免被 shell 转换导致找不到。
- 文件夹收件按 PDF 内容 SHA-256 去重；业务记录仍以发票号优先，无发票号时保留独立 UID，不用共享链接或相同金额强行合并。

实现上 `ingest-folder.js` 把 PDF 复制进 `scan-results/staging/{dateTag}/pdfs`，并合成一份 `emails/classified/download` 记录（每条一个伪 UID），`step3` 之后的下游 9 步**完全复用**，仅跳过 step1/2/2-download。

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

跑通后下次直接 `npm run agent -- <起> <止>` 一键复现，配置与覆盖都持久化，不会「又是新的开始」。

## 金额与配套凭证硬规则

- 先区分 `invoice` 与 `supporting_document`。行程单、路线明细等配套凭证必须归档，但不得计入发票张数、报销总额或待补发票分母。
- PDF 正文未抽到金额时，文件名金额只能写入 `amountCandidate`，标记 `FILENAME_AMOUNT_REVIEW`；用户确认前不得写入正式 `amount`。
- 文件夹输入必须按内容哈希去重，并保留 `sourceRelativePath`、`sourceSha256`，不能用 basename 覆盖同名文件。
- 行程单仅在候选唯一时自动关联发票。关联依据至少记录金额，并结合服务商、日期、来源目录或文件名；同分多候选必须标记 `TRAVEL_LINK_AMBIGUOUS`，禁止选择第一条。
- 路线统一用 `legs` 保存。所有 Excel、HTML、Markdown、看板和模板输出调用同一条格式化规则；人工修正使用 `routeLegs`（`甲→乙 | 乙→丙`）。
## 数据可信优先级

最终台账和归档必须以 PDF 发票正文为准：

```text
已确认的人工覆盖 > PDF 发票正文 > 邮件正文 > 邮件标题 > 发件人/映射推断

文件名金额只作候选，必须人工确认后才进入正式金额。
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

### 本地报销包（三角色视图 + 可打印）

`export-to-edrive.js` 把一次报销导出成 `~/报销/<日期>_报销批次/`，按三角色组织：

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
- 先运行 `npm install && npm run init`，初始化过程不覆盖已有本地配置。
- **邮箱模式**：运行 `npm run setup` 在本机录入授权码。
- **文件夹模式**：`npm run agent -- --folder "<路径>" --approve filesystem.read-input,filesystem.clean,filesystem.write-output` 直接识别本地发票，无需邮箱。
- **图片模式**：宿主视觉 Agent 先按 `references/image-intake-schema.md` 生成 JSON；Node 流水线不冒充内置 OCR。
- 所有业务个性化均在 `config/` 下完成，详见 `CUSTOMIZE.md`。
- 凭证、扫描缓存、归档结果均已被 `.gitignore` 忽略，不会泄露。
- 报销包导出默认路径跨平台：Windows `~/报销`、macOS/Linux `~/报销`，可用 `REIMBURSE_ROOT` 覆盖。

## 维护与反馈

运行记录写入 `scan-results/runs/`。人工修正先写入 `agent-memory/` 和规则候选；只有取得 `rules.write` 授权后，才能把候选关键词提升到正式分类规则。详细设计见 `docs/AGENT_ARCHITECTURE.md`。
