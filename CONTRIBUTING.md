# 贡献指南（CONTRIBUTING）

感谢你关注 `reimbursement-invoice-pipeline`！本仓库是报销发票流水线的开源快照版。

## 双轨维护说明（重要）

- **内部版（开发源）**：包含真实邮箱凭据、真实发票数据、个人路径配置，仅本地使用，不对外。
- **本开源版（公开快照）**：从内部版脱敏派生，不含任何密钥 / 真实业务数据 / 个人路径。
- 内部版做的、可以公开的修改，**手动挑选**到本仓库即可；**绝不反向同步**（不要把本仓库的改动推回内部版，以免泄露）。

## 提交前自检（脱敏清单）

任何改动合入前，请确认仓库内**不存在**以下内容：

- 任何形式的邮箱密码 / IMAP 凭据 / Token（`.env`、`config/IMAP_CREDENTIALS.js`、`config/mailboxes.json`、`config/package-config.js` 均已被 `.gitignore` 忽略，请勿提交）
- 真实发票号码、真实客户/购买方名称、真实金额
- 个人机器绝对路径（如 Windows 盘符路径、用户主目录绝对路径等硬编码路径）
- 个人身份信息（姓名、公司全称、官网域名等）

快速自查命令：

```bash
grep -rn "真实客户名\|真实发票号\|IMAP密码\|C:/Users" . --include=*.js --include=*.md --include=*.json
# 期望：无输出
```

## 本地运行

```bash
npm install
cp .env.example .env          # 填入你自己的邮箱凭据（不会进库）
cp config/IMAP_CREDENTIALS.example.js config/IMAP_CREDENTIALS.js
cp config/mailboxes.example.json config/mailboxes.json
cp config/package-config.example.js config/package-config.js
npm run run -- 2025-01-01 2025-12-31   # 跑指定日期区间
```

## 提交流程

1. Fork → 分支 → 改动
2. 跑 `npm run check` 做语法自检
3. 确保脱敏清单通过（无敏感串）
4. 提 PR，说明改动动机与影响范围

## 用户模板不进仓库（重要）

`templates/` 目录存放**最终用户**的占位符 xlsx 模板，可能含真实公司名 / 成本中心 / 审批人等敏感信息。该目录已被 `.gitignore` 忽略，**请勿提交**。

贡献「模板能力」的正确方式：
- 改 `lib/token-dictionary.js` 的白名单、`lib/render-template.js` / `lib/rollup.js` / `lib/template-store.js` 的逻辑；
- 更新 `docs/templates.md` 的 token 字典表与示例；
- 用 `node generate-template.js --output 我的模板.xlsx` 产出一个**脱敏示例**模板供他人参考（不含真实信息）。

提交前自查（期望：无输出）：

```bash
grep -rn "vbaProject\|WEBSERVICE" . --include=*.xlsx   # 宏 / 外联公式
git status --porcelain | grep "templates/"            # 模板未进库
```

> 注：本仓库使用 MIT 许可证，与上游一致。
