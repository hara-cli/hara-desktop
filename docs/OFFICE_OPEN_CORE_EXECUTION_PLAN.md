# Hara Office 开源内核与商业产品执行方案

> 状态：方案已落库。公开仓库
> [`hara-cli/hara-office`](https://github.com/hara-cli/hara-office) 已于 2026-07-19
> 创建并推送九个 `0.1.0-alpha.0` 契约包；npm 尚未首发，Desktop/Serve 尚未接入。
> 决策日期：2026-07-18。
> 执行更新：2026-07-19。
> 适用范围：Hara Desktop、Hara CLI、PPT、表格、文档、能力市场、国内/全球服务。
> 核心原则：先冻结协议、安全、许可和保真承诺，再建库；安全能力不作为付费墙。

## 1. 决策

采用 open-core：

- 公开、Apache-2.0：本地运行时、Artifact 协议、Office 基础能力、基础可编辑导出、
  安装签名验证、文件边界、回滚、验证与导出回执。
- 私有商业层：复杂 Office 高保真往返、精品行业模板、品牌治理、账号/支付/同步、
  市场运营、企业治理与 SLA。
- 客户文件、模板和品牌资产始终归客户，不进入 Hara 公共仓库或通用训练/评测语料。
- Hara 名称、Logo、`@nanhara` 包命名和“官方认证”由商标规则保护；社区 fork 可说明
  “Compatible with Hara”，但不得冒充官方发行。

国内版与全球版共用客户端、协议和包格式，不分叉两个核心代码库。账号、订单、签名根、
对象存储、日志和数据驻留服务按 CN / Global 物理分区。

## 2. 仓库拓扑

已创建一个公开 monorepo；包按工作区独立发布、独立版本：

```text
hara-office/                         Public / Apache-2.0
├── packages/office-schema          @nanhara/hara-office-schema
├── packages/office-sdk             @nanhara/hara-office-sdk
├── packages/template-kit           @nanhara/hara-template-kit
├── packages/worker-sdk             @nanhara/hara-worker-sdk
├── packages/panel-sdk              @nanhara/hara-panel-sdk
├── packages/conformance            @nanhara/hara-office-conformance
├── capabilities/presentation       @nanhara/hara-presentation
├── capabilities/spreadsheet        @nanhara/hara-spreadsheet
└── capabilities/document           @nanhara/hara-document
```

`template-kit` 包含跨 PPT/表格/文档的组件 Schema、输入 Schema、受限 repeat/
condition/data-binding evaluator、包验证和 conformance fixtures；不含 renderer、UI 或
可执行脚本。三种 capability 实现格式专用组件、布局验证和 renderer adapter。

这不是一个强制整包安装的“大 Office 包”。Desktop、CLI 和用户只安装所需能力；
npm workspaces + Changesets 负责独立版本和发布，CI 只运行受影响包与跨包契约测试。

商业实现已创建私有仓库并保持物理隔离：

```text
hara-office-pro         高保真 Office adapter、品牌治理、批量处理
hara-market-server      审核、签名、目录、定价、购买、撤回、灰度
hara-account-service    CN/Global 账号、设备、订单、entitlement
hara-enterprise         SSO/SCIM、企业策略、私有目录、审计、舰队
```

第二个非 Office 产品正式采用 Artifact 协议时，再把纯协议包抽成独立
`hara-artifact-sdk`。不因包版本不同或目录变大就提前拆库。

## 3. 现有产品职责

| 产品 | 职责 | 不承担 |
|---|---|---|
| `hara-cli` / Serve | Artifact 存储、权限、能力安装、worker 生命周期、RPC、恢复 | Office UI、模型密钥进入 Panel |
| `hara-desktop` | 普通用户任务简报、预览、人工编辑、确认、导出、升级提示 | 直接执行不受控 worker、保存模型密钥 |
| `hara-office` | Schema/SDK、三种能力、确定性 worker、Panel、模板、校验 | 登录、订单、私有企业策略 |
| `hara-office-pro` | 高保真 adapter、商业模板与品牌规则 | 替换或削弱开源安全边界 |
| 区域云服务 | 账号、授权、同步、市场和企业托管 | 默认收集 Artifact 原文、本地完整路径或提示内容 |

低版本不维护无期限兼容分支。Desktop 缺少 `artifact/1`、`panel/2` 或所需 worker
协议时，明确提示升级 Desktop 内置引擎；CLI 用户提示升级 CLI。

## 4. 共用协议

三种 Office 能力共用以下对象：

```text
TaskBrief
  goal / audience / inputs / outputs / constraints / acceptance

Artifact
  artifactId / kind / title / currentRevisionId / origin
  dataResidency / capabilityLock / templateLock

Revision
  revisionId / parentRevisionId / baseRevisionId / actor / taskRunId
  contentRef / assetRefs / contentDigest / changedPaths / createdAt

ValidationReport
  revisionId / validatorId+version / findings[] / snapshotDigest / status

ExportReceipt
  artifactId / revisionId / format / fidelity
  capability+worker+template+font locks
  validationReportId / output MIME+size+SHA-256 / warnings[]
```

工程约束：

- JSON Schema Draft 2020-12 是协议真源，TypeScript 类型从 Schema 生成。
- 规范化 JSON + SHA-256 形成内容摘要；资产按内容寻址。
- 所有路径是规范化相对路径，拒绝绝对路径、`..`、NUL 和符号链接逃逸。
- `artifact.commit` 必须携带 `baseRevisionId`，过期基线返回冲突，不静默覆盖。
- commit 采用临时写入、校验、fsync 和原子切换；原始导入文件永不覆盖。
- Session rewind 不回滚 Artifact；用户、Agent 和 Panel 走同一 commit 流。
- 能力包使用 Hara 统一数据目录解析器，不自行解释 HOME / USERPROFILE。

### 4.1 模板与组件协议

模板组件的规范真源是
[`OFFICE_TEMPLATE_COMPONENT_SYSTEM.md`](./OFFICE_TEMPLATE_COMPONENT_SYSTEM.md)，首版实现
必须同时交付以下对象：

```text
TemplatePackage
  manifest.json                         包身份、i18n、publisher、SPDX、grants、兼容性
  content.path -> content.json|content.md  独立内容入口，禁止与 manifest 同名
  input.schema.json                     普通用户表单与导入数据约束
  design-contract.json                  token、字体、版式和 overflow policy
  provenance.spdx.json                  模板、字体、图片、样例的来源和许可证
  assets + previews + signatures        MIME/尺寸/digest 与 DSSE envelope

ExpandedTemplate
  templateLock / inputDigest / componentTree / assetRefs / expansionFindings

ComponentNode
  id / type / literal|binding / styleRef / layout / sourceRefs / accessibility
  when / repeat
```

约束：

- `manifest.json` 只描述包；`content.path` 指向独立内容文件。安装器先验证完整包再读取
  内容入口，禁止把 manifest 当可执行内容。
- 组件树的包含关系、基数和上限由 JSON Schema 与语义 validator 双重检查；节点 id、
  引用和 reading order 必须稳定。
- 模板输入由 JSON Schema 约束；repeat/condition/data binding 是无副作用白名单 DSL，
  没有 eval、任意表达式、文件、环境变量、网络或模型访问。
- evaluator 先展开为普通组件树并固定 digest；预览与导出只消费同一个 expanded
  digest，renderer 不得二次解释模板逻辑。
- 页面几何以整数 EMU、字号以 1/100 point 持久化；表格以 row/column 加 EMU offset。
  文本 shaping 引擎、字体和换行算法随 worker 锁定。
- overflow 只能选择 `error/shrink/continue/split-rows`；`ellipsis` 仅用于 UI 预览。
  所有字体替换、图表静态化、动画/公式降级必须进入确认页与 `ExportReceipt`。
- 文档使用 `Hara Markdown Profile 1`：CommonMark/GFM 加受限 section/header/footer/
  page-break directive、footnote 和 citation。structure sidecar 只是带 source digest 的
  可重建缓存，不成为第二份内容真源。

### 4.2 模板供应链状态

模板目录和安装器共用确定状态机：

```text
downloaded → digest_verified → signature_verified
→ trust_policy_checked(online|offline) → compatibility_checked
→ staged → installed → active

失败 → quarantined
撤回 → revoked → disabled
更新失败 → rollback_available → active(previous)
```

- CN / Global 使用独立、版本化、带到期时间的阈值签名 trust root；轮换需要旧根授权
  新根且有重叠窗口，普通包不能添加根。
- signed revocation 区分 key compromised、publisher disabled 和 malicious package；
  hard revoke 禁止运行包，但从不删除用户 Artifact。
- 离线新安装必须携带完整 bundle，链到本机未过期 root，并符合撤回清单新鲜度策略；
  不满足时阻止安装而不是放宽验证。
- 包、依赖和旧版本按内容寻址不可变存储；新版本验证完成后原子切换 active pointer，
  至少保留一个可验证旧版本。
- 每次安装、更新、撤回和回滚产生 receipt，记录 root/key、digest、grants、兼容性、
  offline 状态和 finding，供崩溃恢复与审计。

## 5. 保真合同

扩展名不能代表能力承诺。每次导出必须显示并写入以下一种 fidelity：

| 等级 | 含义 |
|---|---|
| `visual-fidelity` | 外观优先，元素可能被扁平化；例如逐页图片型 PPTX |
| `template-editable` | Hara 受控模板生成，支持的元素可继续编辑 |
| `semantic-editable` | 结构、内容和受控格式可编辑，但不承诺原文件像素级还原 |
| `roundtrip` | 只有真实兼容矩阵通过后，才对明确功能子集作往返承诺 |

基础可编辑属于 Community；复杂旧文件 round-trip、复杂图表/公式/修订等属于 Pro。
所有版本都必须提供真实警告、文件有效性验证和恢复能力。

## 6. Community 与商业边界

| 能力 | Community / Apache-2.0 | Pro / Team / Enterprise |
|---|---|---|
| PPT | 语义模型、基础主题、HTML/PDF、图片型与基础可编辑 PPTX | 复杂 OOXML、母版/品牌锁、高级动画与批量 |
| 表格 | CSV/XLSX 基础导入导出、受控公式、基础样式和图表 | 复杂公式、透视、高级图表、打印布局、企业连接器 |
| 文档 | Markdown 真源、基础编辑、PDF、基础 DOCX | 修订批注、复杂分节、复杂模板、高保真导入 |
| 安全 | 路径边界、签名、权限、回滚、备份、回执 | 始终开源，不收费 |
| 市场 | 包协议、免费签名目录、免费包安装 | 审核后台、支付、商业内容、推荐、结算 |
| 企业 | 策略扩展点、基础本地审计 | SSO/SCIM、DLP、集中审计、私有目录、SLA |

Community 不强制登录。只有购买、跨设备同步、连接在线 Office、进入组织或发布市场内容
时才需要账号。

授权判断使用具体 grant，而不是 `plan === "pro"`：

```text
office.pptx.basic
office.pptx.pro
office.xlsx.pro
office.docx.pro
sync.personal
workspace.team
catalog.private
enterprise.sso
enterprise.dlp
```

订阅到期不删除用户的本地文件、Revision 或导出结果，只停止创建新的付费能力 Revision。

## 7. Worker 与 Panel 边界

Worker 使用 JSONL stdio：

```text
hello
job.start
job.progress
job.result
job.error
job.cancel
```

要求：

- 不走 shell、PATH 或 `npx`，正式包携带固定运行时、Chromium、字体和 exporter。
- 不继承 HOME、API Key、npm 配置；默认断网。
- 只获得只读输入 mount、scratch 和输出目录。
- heartbeat、单操作 timeout 和总 deadline 都必须有上限。
- 超时先保存最后已提交 Revision，再终止完整进程树。
- macOS/Linux 使用进程组，Windows 使用 Job Object。
- 输出再次经过 host containment、Schema 和 MIME 校验。
- 导出不消耗 Agent 对话轮次；reviewer 最多两轮，超限转为等待用户确认。

Panel v2：

- Serve 返回 `capabilityId/panelId/panelInstanceId`，不把 command/args 交给 renderer。
- 独立 origin、严格 CSP、一次性短时 token。
- Panel 没有文件系统和通用 Tauri invoke 权限。
- 只经 Artifact bridge 读取范围、选择、commit、预览和导出。
- token 绑定 artifact、revision、panel 和 capability，禁止重放和任意导航。
- 能力停用、撤回或 App 退出时，关闭 Panel 并清理 owned worker。

## 8. 建库与首发门禁

以下十份 ADR 已在公开仓库接受，`hara-office` 基础仓库据此创建：

1. `ADR-001_OPEN_CORE_BOUNDARY`
2. `ADR-002_OFFICE_MONOREPO_AND_PACKAGES`
3. `ADR-003_ARTIFACT_REVISION_CONCURRENCY`
4. `ADR-004_OFFICE_FIDELITY_CONTRACT`
5. `ADR-005_WORKER_SANDBOX_AND_PROTOCOL`
6. `ADR-006_PANEL_V2_SECURITY`
7. `ADR-007_TEMPLATE_PACKAGE_AND_MARKET`
8. `ADR-008_THIRD_PARTY_DEPENDENCIES_AND_REPLACEMENT`
9. `ADR-009_COMPONENT_DSL_LAYOUT_AND_DEGRADATION`
10. `ADR-010_DOCUMENT_PROFILE_AND_TEMPLATE_TRUST`

以下要求继续作为首次 npm 发布、Desktop/Serve 接入和可安装能力上线的门禁；建库不等于
这些产品能力已经交付：

- PPT、表格、文档各有一份通过 Schema 的示例 JSON。
- 每种示例同时具备独立 `manifest.json`、内容入口、输入 Schema、preview digest、
  SPDX provenance、字体 fallback 和最小 DSSE 测试 envelope。
- 共用组件、三种格式专用组件、基数、单位、文本度量、overflow 和降级矩阵冻结；
  repeat/condition/data-binding evaluator 有 deterministic 与 fuzz fixtures。
- Hara Markdown Profile、sidecar 失效重建和 DOCX/PDF 映射样例通过评审。
- 威胁模型覆盖路径穿越、符号链接、恶意 Office、Panel 导航/token 重放和孤儿进程。
- 模板威胁模型覆盖 expansion bomb、MIME 欺骗、preview 替换、依赖漂移、签名降级、
  trust root 轮换/过期、撤回、离线旧清单和更新中断。
- 依赖、字体、Logo、模板和样例数据都有许可证与 provenance。
- Open / Pro 扩展接口和禁止反向依赖规则明确。
- Windows 商用测试矩阵、签名和更新方案明确。
- 公共仓库泄漏 canary、secret scan、依赖许可、`npm pack` 二次扫描通过。

## 9. 当前许可证与仓库问题

建库前需处理：

- `hara-control` 已公开且 LICENSE 是 Apache-2.0，但 `package.json` 标为 `UNLICENSED`
  和 closed-source；应保留已公开的基础 control core 为 Apache-2.0，修正文案，把账号/
  市场/托管服务移入新私有仓库。历史 Apache 授权不能撤回。
- `hara-desktop` 的 `"private": true` 只表示不发布 npm 包，应补充
  `"license": "Apache-2.0"` 消除歧义。
- `hara-cli/CLA.md` 仍是未正式启用的法律模板；需经律师形成 ICLA/CCLA，并用 CLA Bot
  执行。CLA 是贡献许可，不转让作者版权。
- Slidev 工作区虽然依赖 MIT 项目，但本地根目录缺正式 LICENSE/NOTICE，addon 标为
  private，且混有内部品牌与稿件；不得整库复制。

每个公开仓库应具备：

```text
LICENSE
NOTICE
THIRD_PARTY_NOTICES.md
CONTRIBUTING.md
SECURITY.md
CLA.md
TRADEMARKS.md
```

每次发布生成包级 CycloneDX SBOM、SHA-256 和构建来源证明。

## 10. 阶段计划

### M0：方案冻结（3–5 个工作日）

- 完成十份 ADR、三种 Project Schema、共用 Component/TemplatePackage/Input Schema 草案、
  Hara Markdown Profile、威胁模型和 Slidev provenance。
- 冻结 manifest/content 分离、组件基数、EMU/text metrics、overflow/degradation、
  DSL 上限、i18n/SPDX/MIME/preview/signature/compatibility 字段和 trust 状态机。
- 做 Office 依赖、字体、包体、离线和 Windows spike。
- 评审 fidelity、open/pro 和区域服务边界。
- Go 后才创建公开与私有仓库。

### M1：公共 Schema/SDK（约 2 周）

- 建 monorepo、Changesets、Schema 生成、digest、路径 containment、Revision 冲突。
- 完成 `template-kit`、安全 evaluator、Hara Markdown parser、worker/panel 类型、
  conformance/golden/fuzz fixtures、包级 SBOM 和 CI 防泄漏。
- 用相同输入重复展开 100 次得到相同 digest；超基数、递归深度和缺失 required
  binding 必须稳定失败。

### M2：CLI/Serve Artifact Runtime（约 2–3 周）

- Artifact store、锁、原子 commit、崩溃恢复和 `artifact.*` RPC。
- TemplatePackage manifest、独立内容入口、MIME sniff、DSSE/阈值根验证、不可变缓存、
  安装状态/回执/撤回/离线策略/更新回滚、worker launcher。

### M3：Panel v2（约 2–3 周）

- 独立窗口、CSP/origin/token、Artifact bridge、选择/提交/撤回和进程清理。

### M4：Presentation 纵向切片（约 3–4 周）

- Brief → Artifact → HTML/PDF/图片型 PPTX/基础可编辑 PPTX。
- Presentation Component Schema/基数、EMU adapter、固定字体 shaping、overflow/
  degradation validator、视觉快照、contact sheet、真实 Office/WPS/LibreOffice 重开。
- 三个免费 starter：`briefing-neutral`、`proposal-clean`、`training-step`。

### M5：Spreadsheet 纵向切片（约 4–5 周）

- CSV、受限 XLSX、range bridge、公式覆盖报告、基础图表和安全导出。
- Sheet Component Schema/基数、typed binding、repeat 到 row/table、公式和图表显式降级、
  字体/打印边界验证。
- starter：`data-cleanup`、`sales-summary`、`weekly-operations`。

### M6：Document 纵向切片（约 3–4 周）

- Hara Markdown Profile 真源、sidecar 重建、编辑 Panel、DOCX/PDF、分节/header/footer/
  page break/footnote/citation、分页/字体/overflow 校验。
- starter：`weekly-report`、`meeting-minutes`、`formal-proposal`。

### M7：普通用户 Beta 与商业层（约 2–3 周）

- 30–50 份脱敏真实 Office 语料，至少 10 名非技术用户测试。
- Windows 安装/签名/更新/回滚，macOS 签名公证。
- 免费签名目录、CN/Global 根轮换和撤回演练、断网安装/更新中断/回滚测试、区域账号/
  entitlement 内测、Pro conformance。

## 11. 拆库触发条件

满足任一硬条件才拆：

- 某能力引入不兼容许可证或需要独立安全披露。
- 原生 worker 需要不同高权限 runner、签名密钥或发布环境。
- 已有独立维护团队、CODEOWNER 和 on-call。
- 连续两个季度发布节奏显著分离。
- 路径过滤后 p95 CI 仍超过 20 分钟，或仓库因 fixture/二进制超过 1 GB。
- 能力连续两个 minor 版本只依赖已发布的公共 SDK，不再横向读取源码。
- 需要独立漏洞禁运、SLA 或企业交付周期。

## 12. 首版明确不做

- 完整 Office 克隆或任意 PPTX/XLSX/DOCX 无损往返。
- 执行宏/VBA 或自动刷新外部数据连接。
- 任意 Vue/JS/CSS 进入普通用户模板。
- shell/PATH/`npx` worker。
- 第三方 executable 市场。
- 在模板内容或绑定 DSL 中执行代码、读取环境变量或隐式联网。
- 未验证 MIME/尺寸/digest 的 preview 和资产。
- 两份互相冲突的 Markdown/sidecar 内容真源。
- trust root 在线静默替换、过期清单下放宽离线新安装，或更新失败后删除旧版本。
- 自动覆盖原文件。
- 国内/全球两套核心代码。
- 多 Agent 同时直接写同一 Artifact。
- 仅凭扩展名宣称“可编辑”或“高保真”。

## 13. 正确顺序

```text
ADR / 法律与安全边界
→ CI 防泄漏
→ 创建 hara-office（已完成，2026-07-19）
→ Artifact Core 契约与 conformance（alpha 基础已完成）
→ PPT / 表格 / 文档纵向切片
→ Desktop Artifact 工作台
→ 免费签名目录
→ Account / Market / Pro / Enterprise
```
