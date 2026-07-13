# 用户模板指南（templates）

报销单支持「占位符 xlsx 模板」：你提供一张空白 Excel，在单元格里写 `{{token}}`，
流水线按你的模板生成报销单。**映射是自描述的**——token 落在哪个单元格，就填哪个单元格。

## 1. 怎么写模板

最简单的方式是用起步生成器产出一个含全部 token 的空白模板，再改样式 / 增删列：

```bash
node generate-template.js --output 我的模板.xlsx
# 同时产出 我的模板.meta.json
```

生成后打开 `我的模板.xlsx`：
- 第 6 行是「行样板」，含行级 token（每张发票展开一行）。
- 合计 / 大写 / 签署区已带好聚合与签署 token。

你可以：
- 改字体、列宽、配色（纯样式，不影响渲染）；
- 删掉不需要的列（如没有「不含税金额」就删那列）；
- 增列并填自己的静态文字；
- **不要**在单元格里写非白名单 token（会被拒收）。

## 2. Token 字典（白名单，我们维护）

占位符 xlsx 下，只有以下 `{{token}}` 合法；非法 token 渲染时整体报错（防 `{{eval(...)}}` 注入）。

**单据头**（整单共用）
| Token | 字段 |
|-------|------|
| `{{报销人}}` | claimer |
| `{{部门}}` | department |
| `{{报销日期}}` | 渲染当天 |
| `{{成本中心}}` | costCenter |
| `{{预算科目}}` | budgetCategory |
| `{{合同号}}` | contractNo |
| `{{购买方名称}}` | buyerName（可选） |
| `{{购买方税号}}` | buyerTax（可选） |

**行级**（每张发票展开一行）
| Token | 字段 |
|-------|------|
| `{{发票号码}}` | invoiceNo |
| `{{发票代码}}` | 数电票常无，留空 |
| `{{开票日期}}` | invoiceDate |
| `{{发票类型}}` | 专票/普票/数电票/未知 |
| `{{销售方名称}}` | seller |
| `{{销售方税号}}` | 数电票常无，留空 |
| `{{费用类别}}` | category |
| `{{不含税金额}}` | exTaxAmount |
| `{{税额}}` | taxAmount |
| `{{价税合计}}` | amount |
| `{{备注}}` | notes |
| `{{行小计}}` | 该行 amount |

**聚合**（渲染期计算）
| Token | 说明 |
|-------|------|
| `{{合计小写}}` | 全部行 sum |
| `{{合计大写}}` | 精确中文大写，带单测 |
| `{{附件张数}}` | 发票张数 |
| `{{按类别小计:餐饮}}` | 按类别（示例） |

**签署**
| Token | 字段 |
|-------|------|
| `{{审批人}}` | approver |
| `{{复核人}}` | reviewer |
| `{{出纳}}` | cashier |
| `{{收款账号}}` | payeeBank |
| `{{付款日期}}` | 留白给人填 |

## 3. meta.json

`generate-template.js` 同目录产出 `我的模板.meta.json`：

```json
{
  "version": 1,
  "rollup": "flat",
  "createdAt": "2026-07-13T...",
  "tokensUsed": ["报销人", "发票号码", "..."]
}
```

- `version`：模板版本，渲染时可指定历史版本重跑旧批次。
- `rollup`：行聚合方式，见下。

## 4. Rollup（行聚合方式）

`meta.rollup` 决定行如何展开：

| 值 | 行为 |
|----|------|
| `flat` | 每张发票一行（默认） |
| `byCategory` | 按费用类别聚合，一类一行（金额求和，发票号码退化为「（N张）」） |
| `byDay` | 按开票日期聚合，一日一行 |

聚合后所有行金额之和仍等于合计，强制对账机制保证一致。

## 5. 安全规则

渲染器使用 exceljs，**只读 / 写单元格值，绝不求值公式**，因此模板里的 `SUM` 等公式会被原样保留、不会被执行；外部公式引用也不会在渲染期触发。

仍会被**主动拒绝**的模板：
- 宏启用扩展名 `.xlsm` / `.xlsb` / `.xltm`；
- 内嵌 VBA 工程（zip 内含 `vbaProject.bin`）；
- 含 `WEBSERVICE()` 外联公式（可能触发网络请求 / 数据外泄）。

## 6. 用模板渲染报销单

```bash
# 先把模板存进 store（隔离目录 templates/<user>/<name>/<version>/）
node -e "require('./lib/starter-template').generateStarterTemplate({}).then(t=>require('./lib/template-store').saveTemplate({user:'我',name:'std',buffer:t.buffer,meta:{rollup:'flat'}}))"

# 模板驱动渲染（与 step6 硬编码生成互补）
node render-reimbursement.js --user 我 --name std --dateTag 20260101-20260711 --output 报销单.xlsx
```

`--version <n>` 可指定历史版本重跑旧批次；`--input <invoice-final.json>` 可显式指定数据文件。

## 8. 接入主流水线（run-all 自动跑批）

设置环境变量 `REIMBURSEMENT_TEMPLATE` 后，`run-all.js` 会在 step6 之后自动多跑一步模板渲染，
无需手动调 `render-reimbursement.js`。**未设置该变量 = 行为完全不变**（零侵入）。

```bash
# 格式：user/name[:version]
export REIMBURSEMENT_TEMPLATE="我/std"          # 用最新版
# 或指定历史版本重跑旧批次：
export REIMBURSEMENT_TEMPLATE="我/std:2"

npm run run                                     # 智能模式，模板步骤自动并入
```

接入细节（与 step6 互补，不替换）：
- 产物文件：`scan-results/报销单-<user>-<name>-<dateTag>.xlsx`（与 step6 的 `报销单-<dateTag>.xlsx` 并列）。
- 若同时跑 `export`（导出批次），会额外把模板报销单复制进 `02_报销人视角/报销单-模板.xlsx`。
- 脏检查：模板产物依赖 `invoice-final` + 全部渲染代码 + 模板目录；改模板或改代码 → 自动重渲 + 重导出（沿用 run-all 链式传导）。
- 配置开关在 `lib/pipeline-template-step.js`（`buildTemplateRenderStep`），便于单测。

## 7. 提交前自查

```bash
grep -rn "vbaProject\|WEBSERVICE" . --include=*.xlsx   # 期望：无
git status --porcelain | grep "templates/"            # 期望：无（模板不进库）
```
