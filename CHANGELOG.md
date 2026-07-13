# 变更记录

本仓库为上游 skill「先锋级智能体 skills_BT-7274」（原作者 【aigc猎手竹相左边】）的衍生版本，遵循 MIT 协议。以下仅记录**本仓库**的二次开发改动。

## [未发布 / 本地] 2026-07

### 新增
- **图片 intake 模式**（`--images`）：Agent 视觉抽取字段 → `ingest-images.js` 转换为与文件夹模式同构的中间产物，复用下游 11 步流程。
- **报销单模板化渲染**（`REIMBURSEMENT_TEMPLATE` 开关）：支持多用户 / 多版本 xlsx 模板占位符渲染，导出包额外包含 `02_报销人视角/报销单-模板.xlsx`。
- **致命 / 可恢复错误分级**（`lib/error-classify.js`）：全局未处理错误默认致命退出（`exit 1`），仅 IMAP 库 teardown 噪声允许继续，消除“看似成功”盲区。
- **通用 Skill 包装** `reimbursement-pipeline-engine`：供其它 AI 助手通过关键词调用本流水线。

### 修复
- step4 普票税额 `0` 被 `|| null` 吞掉 → 改为仅在空 / 未定义时置 `null`，保留合法的零税额。
- step4 不含税金额（exTax）在 PDF 金额定稿前计算导致恒为 `null` → 移到金额定稿之后计算。

### 文档
- 补充 `SECURITY.md` / `CODE_OF_CONDUCT.md` / `CHANGELOG.md` / `.github` 模板。
- `README.md` 改为衍生改写署名（Vicky 维护，致谢原作者），移除上游自宣传横幅，补 License / Contributing / Security 链接。
