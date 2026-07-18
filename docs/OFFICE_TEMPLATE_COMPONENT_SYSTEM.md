# Hara Office 模板组件系统

> 状态：组件盘点与抽取边界已确定；尚未创建 `hara-office`。
> 目标：让普通用户从“选一种工作 → 填一句目标 → 预览 → 修订 → 导出”完成 Office
> 工作，同时让模板可验证、可版本化、可在市场分发。

## 1. 结论

有，而且应当把它正式建设成 `Hara Office Component Kit`，而不是继续把模板理解成
一组 Slidev 页面。现有资产足以启动第一版：

- 本地 Slidev `addon-nanhara`：7 个布局、5 种叙事模式、20 多个语义/图示组件。
- `hara-design`：30 多种单页 PPT 模板、十余套完整 deck、40+ 视觉主题。
- Hara Desktop：已有 PPT、表格、文档、资料整理四种任务入口。

目前真正缺少的是统一的组件协议、受限模板语言和各格式 renderer，而不是更多
HTML/Vue 文件。Office 模板系统必须分四层：

```text
语义组件（跨格式）
→ 格式专用组件（PPT / Sheet / Document）
→ Renderer adapter（HTML / PDF / PPTX / XLSX / DOCX）
→ 行业模板（starter / premium / enterprise）
```

Slidev Vue 组件不能直接复用到 Excel 或 Word。三种格式共享语义和数据契约，各 renderer
根据目标格式生成真实对象。

本文中的“必须”“禁止”“应当”是首版实现和 conformance 测试的规范性要求；示例字段
不是 UI 草图。

## 2. 现有 Slidev 资产

### 布局

- `nh-cover`
- `nh-section`
- `nh-content`
- `nh-closing`
- `nh-swiss`
- `nh-data`
- `nh-editorial`

### 叙事模式

- `pyramid`
- `narrative`
- `instructional`
- `showcase`
- `briefing`

### 语义组件

- 数字：`NhStat`、`NhBigNumber`、`NhTrend`
- 内容：`NhCard`、`NhQuote`、`NhCompare`
- 图表：`NhBars`、`NhLine`
- 过程：`NhTimeline`、`NhFlow`
- 图示：`NhMatrix`、`NhFunnel`、`NhPyramid`、`NhCycle`、`NhFramework`、`NhVenn`

### 工具

- `templates/design_spec.md`：设计契约。
- `scripts/check.js`：溢出、未解析组件和运行错误检查。
- `scripts/export.js`：区分图片型 PPTX。

## 3. 不能整包复制的原因

- `slidev-addon-nanhara` 标记为 private。
- 工作区根缺正式 LICENSE/NOTICE，不能把“上游 Slidev 是 MIT”当作本地全部资产的许可。
- CSS 混有 `nh-weekly-*`、`nh-thinking-*` 等内部稿件样式。
- `NhLogo`、`NhSeal` 和硬编码公司页脚属于品牌资产。
- `Chart.vue` / `EChart.vue` 使用 CDN，不符合固定、离线 worker。
- 设计文档与当前 layout 的明暗规则存在漂移。
- 系统字体在 Windows/macOS 上不能保证一致。

抽取必须按文件记录 provenance，重建无品牌语义实现：

| 现有实现 | 新组件 |
|---|---|
| `NhStat / BigNumber / Trend` | `MetricBlock` |
| `NhBars / NhLine` | `ChartBlock` |
| `NhCard / Quote / Compare` | 共用内容块 |
| `NhTimeline / NhFlow` | `TimelineBlock / FlowBlock` |
| Matrix/Funnel/Pyramid/Cycle/Framework/Venn | PPT `DiagramBlock` |
| 7 个 Vue layout | `PresentationLayout` + renderer |
| 5 种 mode | `NarrativeMode` |
| CSS token | `DesignContract` |
| `check.js` | Presentation validator |
| `export.js` | fidelity-aware exporter |

## 4. 三种格式共用的开源组件

这些是语义对象，不绑定 React、Vue 或 CSS：

- `DesignContract`：颜色、字体、间距、边框、品牌位、主题锁。
- `HeadingBlock`、`TextBlock`、`ListBlock`、`ImageBlock`、`TableBlock`。
- `MetricBlock`、`TrendBlock`、`NumberFormat`。
- `BarChartBlock`、`LineChartBlock`、`DataBinding`。
- `CalloutBlock`、`QuoteBlock`、`CompareBlock`。
- `TimelineBlock`、`FlowBlock`。
- `Source`、`Citation`、`AltText`、`Provenance`。
- `AssetRef`、`TemplateRef`、`ValidationFinding`。
- Artifact selection、commit、preview 和 export bridge。

每种格式实现自己的 renderer，不能依赖 CSS 在 Office 文件里“尽量长得一样”。

### 4.1 共用节点 Schema

所有内容节点必须具备稳定 `id` 和显式 `type`，不得靠数组位置或组件名称推断类型：

```json
{
  "id": "metric-revenue",
  "type": "metric",
  "binding": {
    "value": { "path": "/metrics/revenue", "required": true },
    "label": { "literal": "年度收入" }
  },
  "styleRef": "metric.primary",
  "layout": {
    "xEmu": 914400,
    "yEmu": 1371600,
    "widthEmu": 3657600,
    "heightEmu": 1371600,
    "overflow": "shrink"
  },
  "accessibility": { "readingOrder": 3 }
}
```

共用节点只允许以下字段族：

- 身份：`id`、`type`、`role`。
- 内容：每个可绑定属性使用 `literal` 或 `binding`，同一属性二者互斥。
- 样式：`styleRef` 加少量 Schema 声明的 override；禁止任意 CSS。
- 布局：格式允许的 layout 对象；禁止负尺寸和超出画布的隐式裁剪。
- 来源：`sourceRefs[]`、`assetRef`、`altText`。
- 可访问性：reading order、表头、语言、装饰图片标记。
- 控制：`when`、`repeat`；只接受第 8 节的受限 DSL。

Schema 的基数和包含关系必须由机器校验：

| 父对象 | 子对象 | 基数 | 关键约束 |
|---|---|---:|---|
| `PresentationProject` | `Slide` | `1..500` | `id` 唯一；页面尺寸一致或显式分组 |
| `Slide` | Block | `1..200` | 只能使用 PPT 允许的 block；reading order 唯一 |
| `Workbook` | `Sheet` | `1..255` | sheet 名称符合 XLSX 限制且大小写不冲突 |
| `Sheet` | Cell/Range/Chart | `0..1,000,000` | range 不越界；合并范围不得相交 |
| `DocumentProject` | `DocumentSection` | `1..256` | 分节属性显式；header/footer 引用存在 |
| `DocumentSection` | Block | `0..100,000` | heading 级别连续；footnote/citation 引用可解析 |
| 容器 Block | 子 Block | `0..100` | 只有 `group/columns/list/table` 可包含子节点 |
| 非容器 Block | 子 Block | `0` | 出现 `children` 即 Schema 错误 |

上限用于防止恶意包和失控展开，不代表产品推荐容量。超过上限必须在模板展开前失败，
不得截断后继续导出。

### 4.2 校验管道

每次预览和导出依次执行，结果写入同一 `ValidationReport`：

1. `package`：签名、digest、许可证、MIME、路径和资产大小。
2. `schema`：类型、必填字段、基数、引用、DSL 和输入数据。
3. `semantic`：公式、图表范围、标题层级、引用和可访问性。
4. `layout`：字体可用性、文本度量、溢出、对比度和打印边界。
5. `export`：目标格式支持度、降级选择和真实 Office/WPS 重开结果。

`error` 阻止 commit/export，`warning` 要求在预览和回执中可见，`info` 只记录。finding
必须包含稳定 code、节点路径、renderer 版本和可操作修复建议。

### 4.3 单位、文本度量与溢出

- 页面和绝对对象几何统一使用整数 EMU（`914400 EMU = 1 inch`）；禁止浮点像素作为
  持久化真源。DOCX twip、PPTX EMU 和 PDF point 由 adapter 做确定性换算。
- 字号使用整数 `fontSizeHundredthPt`；表格行列使用语义 row/column，浮动对象再用
  cell anchor + EMU offset。
- 颜色使用 design token 或 8 位 sRGB；日期、货币、百分比必须携带 locale 和 format，
  不保存 renderer 已格式化的偶然字符串。
- 文本测量使用随 worker 固定版本发布的 shaping 引擎、字体文件和换行规则。使用
  `local(...)` OS 字体时必须标记 `environment-dependent`，不得宣称像素级一致。
- renderer 必须在预览前返回实际行数、占用边界、fallback 字体和溢出决策；禁止只在
  最终导出时发现截字。

允许的 `overflow` 策略：

| 策略 | 适用 | 行为 |
|---|---|---|
| `error` | 全部，默认 | 阻止导出并定位节点 |
| `shrink` | PPT 短文本 | 逐级缩小到模板声明的最小字号；仍溢出则报错 |
| `continue` | 文档 | 创建下一页/下一节的 continuation，不删除内容 |
| `split-rows` | 表格/文档表格 | 在允许的行边界拆分并重复表头 |
| `ellipsis` | 仅预览卡片 | 不得用于正式 Office/PDF 内容导出 |

禁止无告警 `clip`、自动删除段落、让文本覆盖相邻组件，或通过截图隐藏溢出。

### 4.4 明确的降级合同

| 不支持或缺失项 | 默认处理 | fidelity / finding |
|---|---|---|
| 字体缺失 | 按 manifest 顺序使用已授权 fallback 并重新度量 | `FONT_FALLBACK`; 不再承诺 visual |
| 高级图表/图示 | 用户选择静态矢量/图片或取消导出 | 降为 visual，记录原语义摘要 |
| 动画/transition | 静态首态，或目标支持时映射到白名单效果 | `ANIMATION_DEGRADED` |
| 公式不支持 | 阻止 semantic/roundtrip 导出；visual 可用已验证缓存值 | `FORMULA_UNSUPPORTED` |
| 宏/外部连接 | 永不执行；隔离并要求用户决定移除或保留原件 | `ACTIVE_CONTENT_QUARANTINED` |
| 资产损坏/摘要不符 | 隔离模板，禁止占位后发布 | `ASSET_INTEGRITY_FAILED` |
| 图片格式不支持 | 用固定本地 codec 转换，保留原资产与 provenance | `ASSET_TRANSCODED` |

所有降级都必须在预览确认页和 `ExportReceipt` 可见；禁止 renderer 自行静默选择。

## 5. PPT 专用组件

- `PresentationProject`
- `Slide`
- `Master`
- `PresentationLayout`
- `Section`
- `SpeakerNotes`
- `Build`
- `Transition`
- `DiagramBlock`
  - Matrix
  - Funnel
  - Pyramid
  - Cycle
  - Framework
  - Venn
- `NarrativeMode`
- `SlideClaim`
- `TakeawayTitle`

受限 block DSL：

```text
heading / text / list / image / table
metric / chart / quote / callout / compare
timeline / flow / diagram
columns / group
```

普通模板禁止任意 Vue、JavaScript、HTML 和 CSS。

首批免费 starter：

- `briefing-neutral`
- `proposal-clean`
- `training-step`

开源：基础布局、图示、叙事模式、无品牌主题和 validator。

商业：高级自动排版、复杂动画、高保真导入回写、企业品牌锁和精品行业模板。

## 6. 表格专用组件

- `SpreadsheetProject`
- `Workbook`
- `Sheet`
- `Cell`
- `Range`
- `NamedRange`
- `Formula`
- `MergedRange`
- `FreezePane`
- `Filter`
- `Sort`
- `DataValidation`
- `ConditionalFormatting`
- `ChartRange`

Agent 经 range API 读取需要的范围，不把整个大工作簿塞进上下文。

首批免费 starter：

- `data-cleanup`
- `sales-summary`
- `weekly-operations`

开源：值/类型、受控公式、基础样式、CSV/XLSX、基础图表和验证。

商业：复杂公式、透视表、高级图表、打印布局、品牌模板和有限高保真往返。

宏、VBA 和外部数据连接不是 Pro 功能，而是默认不执行并报告风险。

## 7. 文档专用组件

- `DocumentProject`
- `DocumentSection`
- `Paragraph`
- `TextRun`
- `HeadingLevel`
- `DocumentList`
- `DocumentTable`
- `PageBreak`
- `Header`
- `Footer`
- `Footnote`
- `Citation`

CommonMark/GFM 子集 Markdown 是内容真源；编辑器只是 Panel，不成为私有存储格式。

文档首版定义 `Hara Markdown Profile 1`，只增加可移植的容器/叶子 directive：

```markdown
---
haraDocument: 1
page: { size: A4, marginMm: [25, 20, 25, 20] }
---

:::hara-header {#default}
季度经营报告
:::

:::hara-section {#overview header=default footer=page-number}
# 经营概览

正文引用 [@source-q2]，脚注使用 [^risk]。

::hara-page-break
:::

[^risk]: 风险口径说明。
```

允许的扩展只有 `hara-section/header/footer/page-break`、GFM footnote 和
`[@citation-id]`。属性由 JSON Schema 校验，禁止 raw HTML、脚本、模板表达式和
网络 URL 自动执行。

可生成 `document.structure.json` sidecar，保存 block id、源范围、目录、分页测量和
header/footer 解析结果，供 Panel 增量编辑。sidecar 是可重建缓存，必须携带
`sourceDigest`；与 Markdown 摘要不一致时丢弃重建，不能反过来覆盖 Markdown。若未来
支持纯 sidecar 模式，manifest 必须声明唯一 canonical source，严禁 Markdown 和
sidecar 同时成为冲突真源。

首批免费 starter：

- `weekly-report`
- `meeting-minutes`
- `formal-proposal`

开源：Markdown、标题/列表/表格/图片/分页、基础 DOCX/PDF。

商业：复杂 DOCX 往返、修订、批注、复杂分节、企业公文模板和品牌锁。

## 8. 模板变量与受限数据绑定

模板用 `input.schema.json` 声明用户需要填写或导入的输入。Desktop 根据 JSON Schema
生成普通表单；CLI 可验证同一份输入。模板不得读取未声明的环境变量、文件、网络或模型
上下文。

内容节点只支持受限的读取、绑定、条件和重复四类纯数据操作：

```json
{
  "repeat": {
    "source": { "path": "/products" },
    "as": "product",
    "minItems": 1,
    "maxItems": 12
  },
  "when": {
    "op": "not-empty",
    "value": { "var": "product", "pointer": "/risk" }
  },
  "binding": {
    "title": { "var": "product", "pointer": "/name", "required": true },
    "value": {
      "var": "product",
      "pointer": "/revenue",
      "format": { "kind": "currency", "currency": "CNY", "locale": "zh-CN" }
    }
  }
}
```

- `path` 是输入根上的 RFC 6901 JSON Pointer；`var + pointer` 只能读取当前 repeat
  作用域，禁止父目录逃逸。
- `input.schema.json` 禁止远程 `$ref`；包内 `$ref` 先做路径 containment 和循环/深度
  检查。
- `when.op` 只允许 `equals/not-equals/empty/not-empty/gt/gte/lt/lte/all/any/not`，
  且递归深度不超过 8。
- `repeat` 必须有模板声明的 `maxItems`；嵌套最多 3 层，展开后仍受第 4.1 节基数上限。
- `format` 只允许 number/currency/percent/date/time/join 和显式 locale；`truncate`
  只允许 Desktop 预览摘要，不能改变正式导出内容。禁止 eval、正则回溯脚本、函数名或
  任意表达式。
- required 数据缺失是 `error`；可选数据必须声明 literal fallback、隐藏节点，或保留
  空白中的一种确定行为。
- binding 在 commit 前展开成普通组件树；导出 renderer 不再执行 DSL，确保预览与导出
  使用同一 expanded digest。

## 9. 模板包契约

模板不是一份可随意执行的代码目录。包根的 `manifest.json` 是包清单，
`content.path` 指向独立的内容入口；两者禁止同名或互相递归：

```json
{
  "schemaVersion": "hara.template/1",
  "id": "org.example.proposal-clean",
  "version": "1.0.0",
  "kind": "presentation",
  "title": {
    "default": "Clean proposal",
    "locales": {
      "zh-CN": "简洁提案",
      "en-US": "Clean proposal"
    }
  },
  "description": {
    "default": "A structured proposal template",
    "locales": {
      "zh-CN": "结构化提案模板"
    }
  },
  "publisher": {
    "id": "org.example",
    "displayName": "Example Studio",
    "region": "CN"
  },
  "licenseExpression": "Apache-2.0",
  "provenance": {
    "path": "provenance.spdx.json",
    "mediaType": "application/spdx+json",
    "byteSize": 14822,
    "sha256": "<spdx-digest>"
  },
  "fidelity": ["visual-fidelity", "template-editable"],
  "designContract": {
    "path": "design-contract.json",
    "mediaType": "application/vnd.hara.design-contract+json",
    "byteSize": 6041,
    "sha256": "<design-contract-digest>"
  },
  "content": {
    "path": "content.json",
    "mediaType": "application/vnd.hara.presentation-template+json",
    "byteSize": 24012,
    "sha256": "<content-digest>"
  },
  "inputSchema": {
    "path": "input.schema.json",
    "mediaType": "application/schema+json",
    "byteSize": 2013,
    "sha256": "<schema-digest>"
  },
  "preview": {
    "path": "previews/cover.webp",
    "mediaType": "image/webp",
    "byteSize": 92410,
    "width": 1600,
    "height": 900,
    "sha256": "<preview-digest>",
    "contentDigest": "<content-digest>",
    "fixtureRef": {
      "path": "fixtures/preview-cover.input.json",
      "mediaType": "application/json",
      "byteSize": 428,
      "sha256": "<fixture-file-digest>"
    },
    "inputDigest": "<canonical-example-input-digest>",
    "expandedDigest": "<expanded-example-content-digest>",
    "evaluatorLock": {
      "id": "org.hara.template-evaluator",
      "version": "1.0.0",
      "sha256": "<evaluator-package-digest>"
    },
    "rendererLock": {
      "id": "org.hara.presentation-preview-renderer",
      "version": "1.0.0",
      "profile": "webp-1600x900-srgb-v1",
      "sha256": "<renderer-package-digest>",
      "environmentDigest": "<fonts-shaper-codecs-and-render-options-digest>"
    }
  },
  "assets": [
    {
      "path": "assets/hero.webp",
      "mediaType": "image/webp",
      "byteSize": 842031,
      "width": 2400,
      "height": 1350,
      "sha256": "<digest>",
      "licenseExpression": "CC0-1.0",
      "sourceRef": "spdxref-hero"
    }
  ],
  "dependencies": [
    {
      "id": "org.hara.theme.neutral",
      "version": ">=1.2 <2",
      "sha256": "<locked-digest>"
    }
  ],
  "grants": ["asset.read:package"],
  "compatibility": {
    "artifactProtocol": ">=1 <2",
    "capability": ">=0.1 <0.2",
    "desktop": ">=0.2.0",
    "os": ["darwin-arm64", "darwin-x64", "win32-x64", "linux-x64"],
    "fonts": [
      {
        "family": "Noto Sans CJK SC",
        "required": true,
        "source": "package",
        "licenseExpression": "OFL-1.1",
        "fallback": ["Noto Sans", "Arial"]
      }
    ]
  },
  "signature": {
    "scheme": "DSSE",
    "keyId": "cn-template-2026-01",
    "envelope": "signatures/manifest.dsse.json"
  },
  "integrity": {
    "algorithm": "sha256",
    "files": [
      { "path": "content.json", "sha256": "<content-digest>" },
      { "path": "input.schema.json", "sha256": "<schema-digest>" },
      { "path": "fixtures/preview-cover.input.json", "sha256": "<fixture-file-digest>" },
      { "path": "design-contract.json", "sha256": "<design-contract-digest>" },
      { "path": "provenance.spdx.json", "sha256": "<spdx-digest>" },
      { "path": "assets/hero.webp", "sha256": "<asset-digest>" },
      { "path": "previews/cover.webp", "sha256": "<preview-digest>" },
      { "path": "LICENSES/Apache-2.0.txt", "sha256": "<license-digest>" }
    ]
  }
}
```

要求：

- `manifest.json`、内容入口、输入 Schema、preview、资产、依赖锁、grants、
  SPDX license/provenance 清单和全部文件 digest 进入 DSSE 签名；签名 envelope 本身
  不纳入被签 payload，避免循环摘要。
- `integrity.files` 必须列出除 `manifest.json` 和签名 envelope 外的每个普通文件；
  DSSE payload 是 canonical manifest，所以 manifest 本身无需、也禁止记录自摘要。
- manifest 的 title/description/category/tag 支持 BCP 47 locale；缺失 locale 按
  exact → language → default 回退，不使用市场服务端临时改写包内容。
- 每个资产声明真实 MIME、byte size；位图声明 width/height，字体声明 family/weight/
  style，Office 样例声明页数或 sheet 数。host 必须校验 byte size 并 sniff MIME，不能
  信任扩展名。
- preview 必须同时绑定模板 `contentDigest`、example fixture、规范化 `inputDigest`、
  展开后的 `expandedDigest`、`evaluatorLock` 和 `rendererLock`；市场重新生成预览后作为
  新包版本签名，禁止只替换同 URL 图片。
- SPDX expression、SPDX provenance 文件和 publisher 身份是必填项；来源不清或许可证
  不兼容不能进入官方目录。
- grants 默认空且最小化。首版内容模板只允许读取包内资产；网络、shell、用户文件、
  credential 等 grant 一律非法。依赖必须锁 id、semver 和 digest，禁止漂移安装。
- compatibility 必须覆盖协议、能力、Desktop、OS/架构和字体。安装前不兼容就提示升级
  或选择替代模板，不能进入运行后才失败。
- 模板锁包含 `templateId + version + digest`。
- 远程图片先缓存、扫描并写入 provenance，导出时不隐式联网。
- 字体必须有来源、许可、fallback 和嵌入策略。
- 模板升级生成新 Revision，不原地改变历史 Artifact。
- 内容模板默认不能执行代码；可执行 worker 是另一种更高风险包。

推荐包结构：

```text
manifest.json
content.json
input.schema.json
design-contract.json
provenance.spdx.json
assets/
fixtures/
previews/
LICENSES/
signatures/manifest.dsse.json
```

preview fixture 是可审计的最小示例输入，不得把市场服务端的隐式默认值当作输入。例如
`fixtures/preview-cover.input.json` 可以是：

```json
{
  "title": "季度经营复盘",
  "subtitle": "示例数据 · 仅用于模板预览",
  "metrics": [
    { "label": "收入", "value": 1280, "unit": "万元" }
  ]
}
```

### 9.1 Preview 可重算证据链

官方市场把 preview 当成构建产物，而不是营销图片。验证器必须闭合以下证据链：

1. 验证 canonical manifest 的 DSSE 签名，并按 `integrity.files` 校验 fixture、
   content、design contract、资产和 preview 原始字节。
2. 读取 `fixtureRef`，按输入 Schema 校验；对解析后的 JSON 使用 JCS 规范化，再计算
   SHA-256，结果必须等于 `inputDigest`。fixture 文件字节摘要与规范化输入摘要是两个
   不同证据，不得混用。
3. 使用 `contentDigest` 指向的模板、锁定依赖和 `evaluatorLock` 展开 fixture；输出树
   经过规范化后的摘要必须等于 `expandedDigest`。
4. 把该展开树交给 `rendererLock`。lock 必须固定 renderer、render profile、字体、
   shaping 引擎、codec、色彩空间和所有渲染选项；生成的 preview 字节摘要必须等于
   `sha256`。
5. 任一 digest 或 lock 无法解析时，preview 只能标为 `illustrative-unverified`，
   不能进入官方目录，也不能用于用户确认后直接导出。

因此证明关系是：

```text
signed manifest
  → fixture bytes → JCS inputDigest
  → content + evaluator/dependency locks → expandedDigest
  → renderer/environment lock → preview sha256
```

同一个已签包在任意受支持机器上重复上述流程，必须得到相同 `expandedDigest` 和 preview
摘要；使用 `local(...)` 字体或其他环境依赖的模板不满足此条件，必须先把已授权字体打包。

### 9.2 信任、安装、更新与回滚状态机

```text
downloaded
  → digest_verified
  → signature_verified
  → trust_policy_checked(online|offline)
  → compatibility_checked
  → staged
  → installed
  → active

任一校验失败 → quarantined
发现 signed revocation → revoked → disabled
更新：active(old) → update_available → downloaded(new) → 完整验证链 → staged(new)
  → active(new)
更新失败：任一 new 状态 → rollback_available → active(old)
```

- CN 与 Global 使用独立 trust root 和撤回清单；客户端不得跨区把一个根当另一个根。
- root metadata 采用版本号、到期时间和阈值签名。轮换时新旧根重叠发布，客户端验证
  单调递增版本和旧根对新根的阈值授权；不得从普通模板包导入新根。
- 签名 key 撤回区分 `compromised`、`publisher-disabled`、`package-malicious`。
  恶意包立即禁用；普通 publisher 到期不破坏已经固定、仍通过策略的历史 Artifact。
- `trust_policy_checked(offline)` 只允许完整 bundle，且能链到本机未过期的 trust
  root，包签名时间有效，
  本地撤回清单新鲜度未超过企业策略（默认 7 天）。否则阻止“新安装”，但不删除用户
  文件；已安装包是否继续运行由 hard/soft revocation policy 明确决定。
- 安装和更新采用不可变、内容寻址目录；新版本完整验证后原子切换 active pointer。
  至少保留一个已验证旧版本和 Artifact 的 template lock，失败可一键回滚。
- 任何状态都写 installation receipt：root/key id、包 digest、校验时间、离线状态、
  grants、compatibility、前后版本和失败 finding。崩溃后根据 receipt 恢复，不猜状态。

### 9.3 Host API 与执行顺序

`template-kit` 对 Desktop、CLI 和三种 capability 暴露同一组纯函数/受控操作：

```text
inspectPackage(path)                  只读目录与大小，不解析内容
verifyPackage(package, trustPolicy)   digest / DSSE / SPDX / MIME / compatibility
resolveDependencies(lock, catalog)   只接受已验证且 digest 匹配的不可变依赖
validateInput(schema, input)
expandTemplate(content, input)        输出 ExpandedTemplate + deterministic digest
validateComponents(tree, target)
measureAndPreview(tree, rendererLock)
render(tree, target, acceptedDegradations)
verifyExport(output)                  输出 ValidationReport + ExportReceipt
```

规范顺序是 inspect → verify → resolve → validate input → expand → validate components →
measure/preview → 用户确认降级 → render → verify export。任何调用方都不得跳过验证直接
调用 renderer；同一输入、包锁和 evaluator 版本重复展开必须得到相同 digest。

## 10. Desktop 专用 UI 模板组件

普通用户不应看到 Skill、MCP、cwd 或 worker。Desktop 需要以下可复用组件：

### 起步与选择

- `TaskTemplateGallery`
- `TaskTemplateCard`
- `TemplatePreview`
- `RecentArtifactCard`
- `OpenFilesCard`

### 任务简报

- `TaskBriefForm`
- `AudienceField`
- `SourcePicker`
- `OutputFormatPicker`
- `AcceptanceChecklist`

### Artifact 工作台

- `ArtifactWorkspaceShell`
- `ArtifactPreview`
- `RevisionTimeline`
- `ValidationSummary`
- `FindingList`
- `DataBoundaryBadge`

### 导出

- `ExportProfilePicker`
- `FidelityBadge`
- `CompatibilitySummary`
- `ExportReceiptView`
- `SafeSaveDialog`

### 设置与能力中心

当前 Desktop 已先落地共享设置组件：

- `SettingsPage`
- `SettingsCard`
- `SettingsItem`
- `SettingsNotice`
- `SettingsBadge`

后续 Office 工作台沿用相同的信息纪律：先说明用途与边界，再显示控制项；错误留在原位，
不把整个页面退化成空白或只显示内部术语。

## 11. 模板市场分层

1. 无登录的官方免费静态目录。
2. 官方 Premium 模板。
3. 受邀发布者的内容模板、Skill、字体/图片资产。
4. 受邀 executable 发布者。
5. 供应链演练通过后才开放申请。

内容型模板/Skill 可采用创作者 85%、Hara 15%；可执行 worker/连接器可采用 75%/25%，
以覆盖安全审核和支持成本。企业私有模板不抽交易佣金，只收 Team/Enterprise 服务费。

CN / Global 使用不同签名根、对象存储和撤回清单；同一模板源码需要分别审核、签名和发布。

## 12. QA 与验收

### 所有模板

- manifest/content 入口分离、Schema、digest、签名、SPDX、publisher、MIME/尺寸和资产
  完整性。
- 无绝对路径、路径穿越、符号链接逃逸和远程隐式请求。
- 预览快照与导出回执绑定同一 Revision。
- DSL 基数/深度边界、确定性展开和恶意输入 fuzz。
- 字体 fallback、文本度量、所有 overflow 策略及每种显式降级的 golden fixtures。
- trust root 轮换/过期、key/package 撤回、离线安装、断电恢复、更新与回滚演练。

### PPT

- 溢出、字体、对比度、页面尺寸、每页 claim、图表标签。
- HTML/PDF/PPTX 页数一致。
- PowerPoint、WPS、LibreOffice 真实重开。

### 表格

- 日期、货币、百分比、空值、中文和公式类型。
- CSV 公式注入防护。
- unsupported 公式、外链、宏、隐藏对象明确报告。
- Excel/WPS 重开和重算状态进入回执。

### 文档

- Markdown 往返不破坏受支持语法。
- 字体嵌入、分页、目录、表格和图片边界。
- Word/WPS/LibreOffice 真实重开。
- DOCX 导入明确标注为提取，不宣称原文件 round-trip。

## 13. 首版不做

- 用“更多主题”替代叙事和信息结构。
- 把 Slidev Vue 组件直接当作三种 Office 共用组件。
- 把公司 Logo、印章、周会稿或客户模板放入公开 starter。
- 从 CDN 加载图表、字体或图片。
- 模板执行任意脚本。
- 自动覆盖原文件。
- 用扩展名替代 fidelity 和兼容报告。
