# 公司报销发票邮箱管理助手

> 一个本地自动化的发票整理工具：从邮箱（或本地文件夹）收集电子发票 → 识别字段 → 生成台账 / 报销单 / 出纳做账包。

## 启动广告

```text
欢迎使用先锋级智能体 skills_BT-7274

由 aigc猎手竹相左边 设计制作
#全职司机业余研究AI
#只分享验证可行的前沿技术
#公众号明年还要做设计

本 skills 功能如下：
1. 只处理公司报销、发票邮件、电子发票、数电发票、发票台账相关任务。
2. 支持两种输入模式：扫描邮箱发票邮件，或直接丢一个本地发票文件夹。
3. 支持下载 PDF/OFD 发票附件和正文里的发票下载链接。
4. 支持从 PDF 发票 + 打车行程单中提取购买方、销售方、金额、发票号码、开票日期、差旅起终点。
5. 支持生成 Excel 发票台账、可打印报销单、CSV 明细、人工处理清单。
6. 支持按“购买方/销售方/金额_关键字_发票号后6位_类型_月份.pdf”自动归档。
7. 支持一键导出「报销包」到本地目录（报销人视角 / 出纳视角 / 总览看板）。
8. 对无法自动处理的邮件或发票，会生成异常或人工介入任务，不静默跳过。
```

## 免责声明

下载安装使用本项目，即代表用户认可并了解互联网开源项目以及 AI 大模型工具的潜在风险。本项目代码由 Codex、DeepSeek、QClaw 协作生成和调试，定位为绿色无害的本地自动化工具，仅用于辅助处理发票邮件、下载发票文件、生成台账和归档资料。

本项目不提供财务、税务、法律、审计等专业意见。AI 识别、PDF 解析、邮件链接下载都可能出错，正式报销、入账、纳税申报或审计材料请务必人工复核。

## 作者

【aigc猎手竹相左边】｜【全职司机业余研究AI 只分享验证可行的前沿技术】｜【公众号 明年还要做设计】

---

## 两种使用模式

| 模式 | 适用场景 | 入口 |
|---|---|---|
| **A. 邮箱模式** | 发票都在邮箱里，让工具自动扫描+下载 | `npm run run -- 起始日 结束日` |
| **B. 文件夹模式** | 你已经把发票 PDF 下载到一个文件夹，直接让工具识别整理 | `npm run run -- --folder "/路径/发票文件夹" --date-tag 任意标签` |

两种模式共享同一套「识别 → 中间表 → 多视角报表 → 报销包」下游逻辑，仅输入入口不同。

## 快速开始

```bash
npm install              # 安装依赖（需要 Node >= 18）
npm run setup           # 交互式配置邮箱（仅邮箱模式需要）
npm run doctor          # 自检环境
npm run check           # 语法检查所有脚本
npm run health          # 健康检查最新批次（产物完整性 + 指标 + 待处理告警）

# 模式 A：邮箱模式，处理 2026-06-15 ~ 2026-06-22 的发票
npm run run -- 2026-06-15 2026-06-22

# 模式 B：文件夹模式，直接识别一个本地文件夹
npm run run -- --folder "/绝对路径/我的发票" --date-tag mybatch01
```

> 文件夹模式不需要邮箱配置，也不需要联网。适合「发票已经在我电脑里」的场景。

## 给 Agent 的一句话用法

用户可以直接把下面这段发给 Codex / Claude Code 等代码 Agent：

```text
请克隆本项目，只处理我的发票。根据我提供的日期范围（邮箱模式）或本地文件夹路径（文件夹模式），
在本地配置后运行流水线：扫描/收集发票 → 识别 PDF 字段 → 生成 Excel 台账、可打印报销单、CSV 明细
→ 按规则归档 → 导出「报销包」。不要处理非发票邮件，不要输出或提交我的授权码。
```

如果用户愿意在对话框提供账号信息，Agent 应收集：

```text
邮箱地址：
邮箱授权码（应用专用密码，不是网页登录密码）：
日期范围：
IMAP 主机：默认 imap.qq.com
IMAP 端口：默认 993
MAIL_WEB_USER：QQ 邮箱通常填 QQ 号
```

Agent 应把这些信息写入本地 `.env`，不要在回复里回显授权码。

## 配置

### 邮箱模式（需要）

```bash
npm run setup          # 推荐：交互式填入
# 或手动：
cp .env.example .env   # 然后编辑 .env 填入真实值
```

`.env.example` 字段说明：

```env
IMAP_USER=your@qq.com
IMAP_PASSWORD=your_email_app_password
IMAP_HOST=imap.qq.com
IMAP_PORT=993
IMAP_TLS=true
MAIL_WEB_USER=your_qq_number     # 用于生成邮件跳转超链接
MAILBOX=INBOX
```

### 文件夹模式（不需要邮箱）

直接准备一个文件夹，里面放好发票 PDF（可以混着发票.pdf + 行程单.pdf，工具会自动关联）。运行：

```bash
node run-all.js --folder "/绝对路径/发票文件夹" --date-tag mybatch01

# 指定批次健康检查（严格模式下，有告警也返回非 0）
npm run health -- 20260101-20260711 --strict
```

- `--folder`：包含发票 PDF 的文件夹绝对路径（必填）。
- `--date-tag`：本次批次标签，用于命名中间文件和报销包（可选，默认 `local-当天日期`）。
- 注意：路径请使用**原生绝对路径**（如 Windows `E:\我的发票` 或 macOS `/Users/me/发票`），避免使用会被 shell 转换的写法。

### 身份 / 账户配置（两种模式都需要，用于报销包模板）

复制并填写：

```bash
cp config/package-config.example.js config/package-config.js
```

填入报销人、购买方（抬头/税号）、出纳、审批人、收付款账户等。真实文件已被 `.gitignore` 忽略。

## 处理流程（11 步）

```text
邮箱模式                             文件夹模式
─────────────────────────         ─────────────────────────
1. step1-email-scan                 （跳过）
2. step2-classify-invoices          （跳过）
3. step2-download-pdf               （跳过，用 ingest-folder 收 PDF 进 staging）
─────────────────────────         ─────────────────────────
4. step3-extract-pdf                4. step3-extract-pdf
   提取 PDF 字段（购销方/金额/           提取 PDF 字段
   发票号/日期/差旅起终点）
5. step4-merge-data                 5. step4-merge-data
   按 UID/文件夹合并多附件                按文件合并多附件
   （发票+行程单自动关联）
6. step4b-enrich-classify           6. step4b-enrich-classify
   分类（餐饮/差旅/住宿…）、               分类、归属、项目号
   归属、项目号
7. step5-generate-ledger            7. step5-generate-ledger
   生成 Excel 发票台账                  生成 Excel 发票台账
8. step6-generate-reimbursement     8. step6-generate-reimbursement
   生成可打印报销单（含行程列）           生成可打印报销单
9. archive-invoices                 9. archive-invoices
   按 购买方/销售方/金额 归档             归档
   + 本轮全部PDF平铺视图               + 本轮全部PDF平铺视图
10. build-invoice-table             10. build-invoice-table
    生成规范中间表（稳定ID）             生成规范中间表
11. export-to-edrive                11. export-to-edrive
    导出「报销包」到本地目录             导出「报销包」
```

人工介入点：`fill-pending.js` 用于补齐链接型/识别失败的发票（进 `manual-tasks-{dateTag}.csv`）。

## 数据优先级

最终台账和归档必须以 PDF 发票正文为最高可信来源：

```text
PDF 发票正文 > PDF 文件名 > 邮件正文 > 邮件标题 > 发件人/销售方映射推断
```

- 购买方、销售方、金额、发票号码、开票日期：PDF 能识别就用 PDF。
- 打车类：发票 PDF 仅含金额/销售方，**起点终点来自同邮件的「电子行程单」PDF**，由 step4 自动关联覆盖。
- PDF 无法解析时，才允许用邮件/标题/配置映射补充，并在人工任务里标注来源。

## 支持的输入形态

**邮箱模式：**
- 直接带 PDF 附件的发票邮件。
- 同时带 PDF + OFD 的邮件（优先 PDF）。
- 正文含 PDF 直链的邮件。
- 正文链接进平台页后再解析下载地址的邮件（如移动/10086/诺诺，需登录态，否则进人工）。
- 图片、二维码、过期/防盗链等无法自动下载的，进人工任务。

**文件夹模式：**
- 任意数量的发票 PDF 文件，放一个文件夹即可。
- 支持「发票.pdf + 行程单.pdf」成对出现，工具按同文件夹自动关联起点终点。
- 无发票号时以文件名 + 金额做去重键。

## 收纳规则

归档目录（`archive/`，累积去重，跨批次共享）：

```text
archive/{购买方}/{销售方}/{金额}_{购买方关键字}_{发票号后6位}_{类型}_{月份}.pdf
```

示例：

```text
archive/示例公司有限公司/示例供应商有限公司/334.02_示例_855376_发票_202606.pdf
```

- `购买方`/`销售方` 优先来自 PDF 正文。
- `金额` 用价税合计；`月份` 来自开票日期 `YYYYMM`。
- 同时生成 `archive/本轮全部PDF/` 平铺视图（Windows 优先硬链接，不重复占用空间）。

## 报销包（export-to-edrive 输出）

运行结束后，`export-to-edrive` 把本次批次导出成一个干净的「报销包」目录（默认 Windows `~/报销`、其他系统 `~/报销`，可用 `REIMBURSE_ROOT` 覆盖）：

```text
<报销根目录>/<日期>_报销批次/
├── 00_说明.txt
├── 01_发票原件/<费用类别>/<去重后的唯一PDF>   ← 只含本批次发票
├── 02_报销人视角/  报销单.html / 报销单.md / 报销单.xlsx / 报销清单.md / 待补齐项.md
├── 03_出纳视角/    费用类别汇总.xlsx / 付款凭证模板.html / 记账凭证摘要.txt / 发票合规检查清单.html / 附件完整性核对.md
├── 04_总览看板.html
└── 05_原始数据/    invoice-table / download-results 备份
```

- **严格按本批次记录**复制 PDF，不会混入其它批次的发票。
- 报销人视角能交、能贴票、能跟进；出纳视角能核算、能合规、能对账。

## 输出文件速查

`scan-results/` 下重点文件（均带 `{dateTag}` 后缀）：

- `invoice-final-{dateTag}.json`：合并后的结构化发票数据（含差旅字段）。
- `invoice-table-{dateTag}.json`：规范中间表（稳定 ID，看板/报销包优先读它）。
- `发票台账-{dateTag}.xlsx`：Excel 台账。
- `报销单-{dateTag}.xlsx`：可打印报销单（含大写金额/签字栏/行程列）。
- `报销看板-{dateTag}.html`：可视化总览。
- `manual-tasks-{dateTag}.csv`：需人工补齐的发票。
- `attribution-tasks-{dateTag}.csv`：归属/项目待确认项。
- `archive/index.html`：归档汇总预览。

## 跨平台与环境

- **Node 版本**：需要 Node >= 18（推荐 20 LTS）。`imap` 依赖在 Node 22/24 下建议使用 LTS 版本验证。
- **报销包默认路径**：Windows `~/报销`；macOS / Linux `~/报销`。可用环境变量 `REIMBURSE_ROOT` 覆盖为任意路径（如 `REIMBURSE_ROOT=/data/报销`）。
- **凭证安全**：`.env`、`config/package-config.js`、`scan-results/`、`archive/` 均已被 `.gitignore` 忽略，不会进入版本库。

## Agent 使用约定

- 只处理用户指定日期范围内的发票邮件 / 指定文件夹内的发票。
- 不回答、不整理、不输出与发票无关的邮箱内容。
- 每封发票候选必须有结果：已归档、需人工、异常、或明确失败原因。
- 下载/解析失败不能静默跳过，必须进入 `manual-tasks` 或异常清单。
- 提交代码前必须确认 `.env`、真实凭证、发票源文件、扫描缓存、归档结果没有进入 Git。

## 自定义（客户怎么改）

- 费用类别 / 关键词：见 `config/expense-categories.json`
- 客户 / 项目映射：见 `config/project-mapping.json`
- 按发票号手动覆盖：见 `config/invoice-overrides.json`
- 身份 / 账户：见 `config/package-config.js`

详见 `CUSTOMIZE.md`。

## 文档

- `docs/AGENT_WORKFLOW.md`：Agent 操作手册（11 步细节）。
- `docs/PROJECT_DESIGN.md`：项目架构与设计决策。
- `SKILL.md`：Skill 内部定义与复核点（供 Agent 运行时参考）。
