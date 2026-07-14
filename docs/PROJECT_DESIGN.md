# 项目设计

## 目标

让 Agent 用轻量 Node.js 工具管理发票，支持两种输入：

- **邮箱模式**：扫描邮箱里的发票邮件，自动下载并识别。
- **文件夹模式**：用户已把发票 PDF 放到本地文件夹，直接识别整理（无需邮箱、无需联网）。

统一产出：发票字段提取 → 中间表 → 多视角报表（台账 / 报销单 / 看板）→ 报销包（报销人/出纳/总览三角色）。

## 数据流

```text
【邮箱模式】
邮箱
  -> step1-email-scan.js
  -> scan-results/emails/emails-{dateTag}.json
  -> step2-classify-invoices.js
  -> scan-results/classified/classified-{dateTag}.json
  -> step2-download-pdf.js
  -> scan-results/staging/{dateTag}/
  -> step3-extract-pdf.js ... (同下)

【文件夹模式】
本地文件夹
  -> ingest-folder.js（复制 PDF 进 staging，合成 emails/classified/download 记录）
  -> scan-results/staging/{dateTag}/

【共享下游】
  -> step3-extract-pdf.js
  -> scan-results/pdf-text-{dateTag}.json
  -> step4-merge-data.js              （合并 + 发票/行程单关联）
  -> scan-results/invoice-final-{dateTag}.json
  -> step4b-enrich-classify.js        （分类/归属/项目号）
  -> step5-generate-ledger.js         （Excel 台账）
  -> step6-generate-reimbursement.js  （可打印报销单，含行程列）
  -> archive-invoices.js              （按 购买方/销售方/金额 归档 + 本轮全部PDF）
  -> build-invoice-table.js           （规范中间表，稳定 ID）
  -> export-to-edrive.js              （导出「报销包」到本地目录）
```

## 核心设计

### 两种模式的统一抽象

`step3` 之后所有步骤只依赖 `scan-results/staging/{dateTag}/pdfs` 里的 PDF，**完全不碰邮箱文件**。因此文件夹模式只需新增 `ingest-folder.js`：把本地 PDF 复制进 staging，并生成一份「合成 emails/classified/download」记录（每条一个伪 UID，附件指向 staging 里的 PDF）。下游 step4~step11 一行不用改。

`run-all.js` 通过 `--folder <路径>` 启用文件夹模式，自动跳过 step1/2/2-download；`--date-tag` 指定批次标签；`--no-email` 也可单独跳过邮箱步骤。

### 主键策略

- 邮箱模式：IMAP UID 串联邮件、附件、下载、识别、台账。
- 文件夹模式：按 PDF 内容 SHA-256 去重并为每份文档生成独立 UID；同名文件使用哈希前缀安全保存，同时保留原相对路径。
- 规范中间表 `invoice-table` 另行生成稳定 `invoiceId`，供看板/报销包跨运行引用。

### 中转目录

所有源 PDF 先进入：

```text
scan-results/staging/{dateTag}/
  pdfs/
  ofds/
  images/
  failed/
```

`archive/` 是累积去重归档（跨批次共享），不作为处理工作区。报销包从本批次记录的 `archivePath` 复制，不扫整个 `archive/`，避免混入其它批次。

### 分类先于下载（邮箱模式）

`step2-classify-invoices.js` 把每封候选邮件分成明确类型：

- `attachment_pdf` / `attachment_pdf_ofd` / `attachment_ofd` / `attachment_image`
- `link_direct_pdf` / `link_direct_ofd` / `link_platform_page` / `link_qrcode_image` / `link_unknown_page`
- `manual_body` / `scan_error`

Agent 可以先检查分类结果，再决定是否需要改进解析器。

### PDF 字段最高优先级

购买方、销售方、金额、发票号、开票日期必须优先使用 PDF 发票正文。

```text
已确认的人工覆盖 > PDF 发票正文 > 邮件正文 > 邮件标题 > 发件人/映射推断
```

邮件正文用于初筛、链接发现和缺失字段兜底，不能覆盖 PDF 的真实发票数据。

### 差旅字段：发票 + 行程单关联

打车/火车类发票，金额销售方来自**发票 PDF**，起点终点来自同邮件/同文件夹的**行程单 PDF**。step4 先区分发票与配套凭证，再按金额、服务商、日期、来源目录和文件名线索寻找唯一候选。只有唯一候选才把 `legs` 写入发票；同分多候选进入人工复核。

### 归档只展示 PDF

最终归档规则：

```text
archive/{购买方}/{销售方}/{金额}_{购买方关键字}_{发票号后6位}_{类型}_{月份}.pdf
```

OFD 保留在中转目录用于追溯，但不进入 HTML 汇总，避免和 PDF 重复。同时生成 `archive/本轮全部PDF/` 平铺视图（Windows 优先硬链接，不重复占用空间）。

### 人工任务不是失败

无法自动处理的邮件/发票必须进入 `manual-tasks-*.csv` 或 HTML 异常页。至少包含：UID/文件名、标题、日期、已知字段、原始线索、失败原因、建议动作。

### 报销包（export-to-edrive）

`export-to-edrive.js` 把本批次导出为干净目录（默认 Windows `~/报销`、其他系统 `~/报销`，可用 `REIMBURSE_ROOT` 覆盖）：

```text
<报销根目录>/<日期>_报销批次/
├── 00_说明.txt
├── 01_发票原件/<费用类别>/<去重唯一PDF>   ← 仅本批次
├── 02_报销人视角/  报销单(html/md/xlsx) / 报销清单.md / 待补齐项.md
├── 03_出纳视角/    费用类别汇总.xlsx / 付款凭证模板.html / 记账凭证摘要.txt / 发票合规检查清单.html / 附件完整性核对.md
├── 04_总览看板.html
└── 05_原始数据/    invoice-table / download-results 备份
```

严格按本批次 `records[].archivePath` 复制 PDF，不遍历整个 `archive/`，避免批次串味。

## 安全边界

项目只处理发票邮件 / 指定文件夹内的发票，不处理无关邮箱内容。

不得提交（已被 `.gitignore` 忽略）：

- `.env`
- `config/package-config.js` / `config/IMAP_CREDENTIALS.js` / `config/mailboxes.json`
- `scan-results/`
- `archive/`
- 任何邮箱授权码或用户发票源文件
