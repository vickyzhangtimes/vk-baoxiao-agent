# 自定义指南（客户怎么改）

本工具的所有「业务个性化」都通过 `config/` 下的几个 JSON/JS 文件完成，**改配置不碰代码**。下面逐项说明。

> 所有改动在重新运行流水线后生效。改完先运行 `npm run config:check` 检查 JSON/JS 配置语法，再运行 `npm run check` 检查脚本语法。

---

## 1. 费用类别（发票自动归类）

文件：`config/expense-categories.json`

作用：根据**销售方名称 + 邮件主题 + 发票正文前 500 字**自动判断费用类别（餐饮招待 / 差旅交通 / 住宿 / 通讯费 …）。

规则：按 `rules` 数组**顺序匹配，命中第一条即停**。没命中任何规则则归入 `default`（默认「其他」）。

怎么改：

```json
{
  "default": "其他",
  "rules": [
    {
      "category": "差旅交通",
      "keywords": ["打车", "滴滴", "高铁", "12306", "携程", "uber", "taxi"]
    },
    {
      "category": "餐饮招待",
      "keywords": ["餐厅", "餐饮", "星巴克", "瑞幸", "招待", "restaurant", "cafe"]
    }
  ]
}
```

- 新增类别：在 `rules` 里加一个对象（`category` + `keywords` 数组）。
- 调整优先级：把更具体的类别放到数组前面（如「住宿」里的「全季」应排在「餐饮」之前，避免酒店名误判）。
- 加关键词：在对应 `keywords` 数组里追加字符串即可。

> 想加新类别同时让它在报销包里单独成文件夹？`export-to-edrive.js` 里 `CATEGORY_ORDER` 已预置常用顺序（餐饮招待/差旅交通/住宿/通讯费/员工福利/其他），新类别若不在其中会自动排到「其他」之后，不影响功能。

---

## 2. 客户 / 项目归属

文件：`config/project-mapping.json`

作用：把发票归属到**客户类型 / 客户编号 / 项目号**，供做账和财务系统对接。

字段说明：
- `clientType`：固定三分类——`企业客户` / `政府及事业单位` / `个人及其他`。
- `clientNo`：客户编号（按你财务系统填）。
- `projectNo`：项目号。
- `match`：关键字数组，匹配范围同费用类别（销售方名 + 主题 + 正文前 500 字）。

规则：按 `rules` 顺序匹配，命中第一条即停。没命中走 `fallback`（标「未分类」并进入 `attribution-tasks-{dateTag}.csv` 待归类清单，**不会静默丢失**）。

怎么改：

```json
{
  "defaultClientType": "企业客户",
  "rules": [
    {
      "match": ["示例科技", "Example Tech"],
      "clientType": "企业客户",
      "clientNo": "C-001",
      "projectNo": "P-2026-001"
    }
  ],
  "fallback": { "clientType": "未分类", "clientNo": "未分类", "projectNo": "未分类" }
}
```

- 把你真实客户在发票/邮件里出现的名称或关键词填进 `match`。
- 带 `【】` 的是占位符（不会命中任何真实发票），替换前可放心留着。

---

## 3. 按发票号手动覆盖（修正识别错误）

文件：`config/invoice-overrides.json`

作用：**优先级最高**，一旦填写，覆盖自动规则和项目映射。适合修正「自动识别错的类别/项目」。

key 必须等于发票数据里的 `invoiceNo`（发票号码）**完全一致**（含前导零）。

```json
{
  "示例发票号12345678": { "category": "员工福利" },
  "示例发票号87654321": { "category": "餐饮招待", "clientNo": "C-001" }
}
```

- 只改类别：写一个 `{ "category": "..." }` 即可。
- 同时改项目归属：加上 `clientType` / `clientNo` / `projectNo`。

> 不知道某张票的 `invoiceNo`？去看 `scan-results/invoice-final-{dateTag}.json` 或 `invoice-table-{dateTag}.json` 里对应记录的 `invoiceNo` 字段。

---

## 4. 身份 / 账户（报销包模板占位）

文件：`config/package-config.js`（由 `config/package-config.example.js` 复制而来）

作用：报销包里的报销人、购买方抬头/税号、审批人、出纳、收付款账户等。

```js
module.exports = {
  claimer: '张三',                 // 报销人
  department: '市场部',            // 部门
  buyerName: 'XX科技有限公司',      // 购买方抬头（报销单付款方）
  buyerTax: '91310000XXXXXXXXXX',  // 税号
  approver: '李四',                // 审批人
  cashier: '王五',                 // 出纳
  payerBank: '招商银行 1234...',   // 付款方账户
  payeeBank: '工商银行 5678...',   // 收款人账户
};
```

- 优先级：**环境变量 > package-config.js > 模板占位值**。
- 真实文件 `package-config.js` 已被 `.gitignore` 忽略，不会进版本库。
- 没填的字段在报销包里显示为 `{{...}}` 占位，提醒你补齐。

---

## 5. 报销包导出位置（跨平台）

环境变量：`REIMBURSE_ROOT`

- Windows 默认 `~/报销`
- macOS / Linux 默认 `~/报销`
- Windows PowerShell：`$env:REIMBURSE_ROOT = 'E:\报销'`
- macOS / Linux：`REIMBURSE_ROOT=/data/报销 npm run agent -- ...`

其它可选环境变量：`BATCH_DATE`（批次日期，默认今天）、`PERIOD_LABEL`（期间说明，默认「报销批次」）。

---

## 6. 邮箱配置（仅邮箱模式）

文件：`.env`（由 `.env.example` 复制）

字段：`IMAP_USER` / `IMAP_PASSWORD`（授权码，不是登录密码）/ `IMAP_HOST` / `IMAP_PORT` / `IMAP_TLS` / `MAIL_WEB_USER` / `MAILBOX`。

---

## 常见坑

1. **JSON 改坏**：改完运行 `npm run config:check`；逗号、引号、括号最容易错。
2. **关键词顺序**：具体类别往前放，避免被宽泛类别抢先命中。
3. **覆盖不生效**：检查 `invoiceNo` 是否与数据里**完全一致**（别漏前导零）。
4. **新类别不单独建文件夹**：在 `export-to-edrive.js` 的 `CATEGORY_ORDER` 里加上你的类别名即可。
5. **改了配置没反应**：确认运行的是最新批次（`--date-tag`），旧的中间文件不会自动重算。
