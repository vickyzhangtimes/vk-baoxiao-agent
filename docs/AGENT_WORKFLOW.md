# Agent 工作流

这个项目不是让用户手动点脚本，而是给 Agent 一组可靠工具。Agent 负责理解用户目标、配置本地环境、运行流水线、检查结果、解释异常。

支持两种输入模式：**邮箱模式**（自动扫描下载）和**文件夹模式**（用户已下载好 PDF，直接识别）。

## 1. 开始前

先向用户说明风险：

- 邮箱模式会读取指定日期范围内的邮箱标题、正文摘要、链接和附件。
- 授权码只保存到本地 `.env`，不提交 Git，不在回复里展示。
- 台账是辅助结果，需要用户复核。
- 只处理发票邮件 / 指定文件夹内的发票，不处理无关内容。

收集信息（邮箱模式）：

- 邮箱地址
- 邮箱授权码
- 日期范围
- IMAP 主机、端口，默认 `imap.qq.com:993`
- `MAIL_WEB_USER`，QQ 邮箱通常填 QQ 号

文件夹模式只需：文件夹绝对路径（可选 `--date-tag` 批次标签）。

## 2. 初始化

邮箱模式：如果用户在对话中给了账号信息，直接写入本地 `.env`（复制 `.env.example`）。不要回显授权码。或运行：

```bash
npm install
npm run setup
```

两种模式都要检查环境：

```bash
npm run doctor
npm run check
```

文件夹模式无需邮箱，无需联网。

## 3. 运行

### 邮箱模式

```bash
npm run run -- 2026-06-15 2026-06-22
```

### 文件夹模式

```bash
node run-all.js --folder "/绝对路径/发票文件夹" --date-tag mybatch01
```

流水线（11 步）：

```text
邮箱模式                              文件夹模式
─────────────────────────          ─────────────────────────
1. step1-email-scan                  （跳过）
2. step2-classify-invoices           （跳过）
3. step2-download-pdf                （跳过；ingest-folder 收 PDF 进 staging）
─────────────────────────          ─────────────────────────
4. step3-extract-pdf                 4. step3-extract-pdf
5. step4-merge-data（按 UID/文件合并   5. step4-merge-data
   + 发票/行程单自动关联）
6. step4b-enrich-classify（分类/归属/   6. step4b-enrich-classify
   项目号）
7. step5-generate-ledger（Excel 台账） 7. step5-generate-ledger
8. step6-generate-reimbursement      8. step6-generate-reimbursement
   （可打印报销单，含行程列）
9. archive-invoices（按 购买方/销售方    9. archive-invoices
   /金额 归档 + 本轮全部PDF 平铺）
10. build-invoice-table（规范中间表）   10. build-invoice-table
11. export-to-edrive（导出报销包）       11. export-to-edrive
```

`run-all.js` 的参数解析：第一个位置参数是起始日（邮箱模式）；`--folder <路径>` 启用文件夹模式并跳过邮箱三步；`--date-tag <标签>` 指定批次标签；`--no-email` 也可单独跳过邮箱步骤。

## 4. 检查结果

运行后必须检查：

- 邮箱模式：发票候选邮件数量 / 下载成功数量 / PDF 识别数量。
- 完整记录数量（invoice-final 条数）。
- 人工任务数量（manual-tasks CSV）。
- 报销包是否生成（export-to-edrive 末尾的 `✅ 报销包已导出到`）。
- `archive/index.html` 是否可打开。

重点文件：

- `scan-results/invoice-final-{dateTag}.json`：合并数据（含差旅字段）。
- `scan-results/invoice-table-{dateTag}.json`：规范中间表（看板/报销包读取源）。
- `scan-results/发票台账-{dateTag}.xlsx`：Excel 台账。
- `scan-results/报销单-{dateTag}.xlsx`：可打印报销单。
- `scan-results/报销看板-{dateTag}.html`：总览看板。
- `scan-results/manual-tasks-{dateTag}.csv`：人工补齐项。
- 报销包目录（默认 `~/报销` 或 `~/报销` 下 `<日期>_报销批次/`）。

## 5. 人工任务

任何无法自动处理的邮件或发票都不能静默跳过，必须进入人工任务或异常项。

常见原因：

- 链接过期 / 需扫码 / 平台防盗链（邮箱模式）。
- PDF 无法解析。
- 缺少购买方、销售方或金额（如打车行程单无金额，仅作行程说明）。
- 无发票号的发票靠文件名+金额去重。

向用户汇报时，说明 UID / 邮件标题（或文件名）、已知字段、失败原因和建议动作。补齐用 `fill-pending.js`。

## 6. 扩展原则

不要只为某一封邮件写特例。重复出现的失败模式应抽象成新的链接解析类型或字段识别规则。

差旅字段（打车/火车）来自 `lib/extract-travel.js`：发票 PDF 提供金额/销售方，`行程单` PDF 提供起点终点，由 step4 按同邮件/同文件夹合并覆盖。新增打车平台（曹操、首汽等）只需在 `extractItinerary()` 加规则。

最终数据可信顺序：

```text
PDF 发票正文 > PDF 文件名 > 邮件正文 > 邮件标题 > 发件人/映射推断
```

提交代码前确认这些内容没有进入 Git：

- `.env`
- `config/package-config.js`
- `config/IMAP_CREDENTIALS.js`
- `config/mailboxes.json`
- `scan-results/`
- `archive/`
- 邮箱授权码、发票源文件
