# 变更记录

本仓库为上游 skill「先锋级智能体 skills_BT-7274」（原作者 【aigc猎手竹相左边】）的衍生版本，遵循 MIT 协议。以下仅记录**本仓库**的二次开发改动。
## [2.0.0] 2026-07-14

### Agent 化
- 新增统一 `agent-controller.js`，邮箱、PDF 文件夹和图片进入同一权限计划与运行记录。
- 新增图片字段 schema、字段级置信度和 `VISION_LOW_CONFIDENCE` 人工复核。
- 新增 `agent-memory/` 反馈日志、精确覆盖、规则候选与经授权的 `rules.write` 提升。

### 真实报销回归修复
- 新增机票/航空运输电子客票行程单的乘机日期、航班号和起降机场抽取，并将航空客票按可报销发票计入。
- 重写网约车行程单解析，支持按金额切分多段路线；不再把普通出租车发票中的“起点/终点”误判为行程单。
- 新增 `invoice` / `supporting_document` 角色，行程单归档但不计入发票张数、待补分母和报销总额。
- 文件名金额降级为 `amountCandidate`，标记 `FILENAME_AMOUNT_REVIEW`，人工确认前不动正式总额。
- 文件夹模式新增 SHA-256 去重、同名文件安全命名、原相对路径与哈希溯源。
- 行程单仅在唯一候选时关联；同金额歧义标记 `TRAVEL_LINK_AMBIGUOUS`，不再默认取第一张。
- 修复归档解析塌到第一份文件、扁平目录重复扫描、任一输出缺失却跳过重跑等问题。
- 多段路线统一输出到 Excel、HTML、Markdown、看板和模板合同，并支持 `routeLegs` 人工修改。
- 新增 12 个真实场景回归测试。
### 品牌与可发现性
- 产品名统一为 **VK BaoXiao Agent**，GitHub 仓库改为 `vk-baoxiao-agent`。
- README 新增 Vicky 的 X 入口、VK Agent Lab 署名和 CI 状态徽章；看板与报销包说明增加克制的生成工具标识。
- 包名、Skill 名、OpenAI display name、克隆地址和仓库元数据同步更新。

### 安全
- IMAP 默认启用证书校验。
- 邮件链接默认只允许公网 HTTPS，限制重定向、私网地址和响应大小。
- 清理目录和模板目录增加路径越界守卫。
- 使用 npm `overrides` 将 `semver` 固定到 `5.7.2`、`uuid` 固定到 `11.1.1`，在保持 Excel/IMAP 主依赖版本的情况下消除已知传递依赖漏洞；`npm audit` 为 0。

### 发布
- Skill frontmatter 通过官方校验，新增 `agents/openai.yaml` 和 GitHub Actions CI。
- 项目定位升级为“报销发票 Agent + 可安装 Skill”。
- README 改为公开用户优先，补充 Vicky 的一人公司/QQ 邮箱/Windows 使用场景及无隐私配置边界。
- 新增无覆盖的 `npm run init`、分模式 `npm run doctor -- --mode ...` 和 `npm run config:check`。
- 明确图片模式由宿主视觉 Agent 生成结构化 JSON，本项目不冒充内置云端 OCR。
- README 与 Skill 新增


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
