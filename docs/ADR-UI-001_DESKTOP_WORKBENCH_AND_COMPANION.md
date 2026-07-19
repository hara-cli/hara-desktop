# ADR-UI-001：Hara Desktop 工作台、任务交互与桌面伙伴

> 状态：Accepted
> 决策日期：2026-07-19
> 适用范围：Hara Desktop、`hara serve` 的桌面协议、桌面伙伴与未来能力市场

## 1. 背景

Hara Desktop 已经形成四个稳定场所：

1. 工作助理：自然语言沟通、任务发起和外部渠道；
2. 我的文件：项目、资料、交付物和预览；
3. 自动任务：计划任务、运行记录、待确认事项；
4. 设置：模型、安全、能力、桌面伙伴和更新。

当前主要问题不是缺少更多入口，而是对话、任务执行、工具记录、等待人工、交付物和后台活动
仍然过多地挤在同一条会话流中。`App.tsx` 同时承担连接控制、场所路由、会话呈现、设置和桌面
伙伴桥接，也会放大后续 Office 工作台与能力市场的改动风险。

本决策参考了 OpenHuman 的应用壳、任务时间线、Workflow 提案、通知/活动分离和桌面伙伴状态机。
OpenHuman 根项目使用 GPL-3.0；Hara 只学习不可版权化的产品模式，并独立实现，不复制或移植其
源码、样式表、品牌、素材和组件结构。

## 2. 决策

### 2.1 Desktop 继续是薄客户端

- Agent loop、TaskRun、权限、Artifact、能力执行和恢复仍由 `hara serve` 负责。
- Desktop 只消费结构化状态，不解析模型自然语言猜测任务进度或错误。
- Desktop 不持有模型密钥，不直接启动第三方 worker，不扩大文件或网络权限。
- UI 拆分不能改变 protocol-v1 的 session、approval、interrupt 和 capability 语义。

### 2.2 四场所保持稳定

不增加 Brain、Agent World、Skill、MCP 等面向普通用户的一级入口。能力和底层技术按需进入
设置或具体任务，不能让用户先理解运行时术语才能完成工作。

```text
场所栏              上下文栏                 主工作区
工作助理        →    对话 / 渠道          →   对话 + 任务 + 交付物
我的文件        →    文件夹 / 工作记录      →   Artifact 编辑、预览和版本
自动任务        →    计划 / 运行记录        →   状态、审批、重试和回执
设置            →    设置分组              →   模型、安全、能力和个性化
```

每个场所独立记忆当前对象。切换场所时必须先校验对象归属；没有有效对象就显示该场所首页，
禁止仅改变标题后继续向上一个场所的 session 发送输入。

### 2.3 对话、任务、交付物和注意力分离

Desktop 的稳定对象是：

```text
Conversation
  澄清、解释、追问和 steering

TaskRun
  目标、验收、步骤、活跃预算、暂停/等待/阻断状态

Artifact
  文件、Revision、Validation、预览和 ExportReceipt

AttentionItem
  需要用户审批、补资料、处理失败或确认结果的事项
```

原始工具调用默认折叠在任务步骤下。用户首先看到“正在做什么、完成到哪里、需要我做什么、
保存了什么”，需要诊断时再展开命令、diff、模型和 token。

运行中输入必须由任务协议明确分类：

- 现在调整：steer 当前真实 TaskRun；
- 完成后再做：进入可查看、可撤回、可排序的队列；
- 新建任务：创建独立 TaskRun；
- 只问状态：不改变当前计划。

控制命令、设置操作和本地选择器不能制造伪 TaskRun，也不能把普通输入误路由为 steer。

### 2.4 视觉方向

Hara 采用“安静的编辑工作台”，不是游戏化控制台：

- 墨色和暖纸色构成主表面，朱砂只承担品牌与主要动作；
- 等待使用琥珀，成功使用松绿色，危险使用独立错误红，不能复用品牌朱砂表达所有状态；
- 首版提供跟随系统、浅色和深色三种模式，不先开放任意主题编辑器；
- 一级内容不小于 14px，元信息不小于 11px；图标按钮保持至少 34px 视觉区域和稳定 SVG 尺寸；
- 动画只用于状态转换、任务完成和桌面伙伴，遵守 `prefers-reduced-motion`；
- 不使用风景壁纸、低对比透明层或让大型桌宠占据 Artifact 工作区。

桌面主工作流优先级：

```text
意图 → 任务简报 → 执行进度 → 交付物预览 → 人工确认 → 导出/分享
```

### 2.5 组件边界

第一阶段按责任拆分，保持行为不变：

```text
App
  Serve 连接、会话/任务状态与顶层编排

AppRail
  四场所导航、未读与更新提示

ConversationTimeline
  用户消息、回答、工具、diff、审批和执行尾部状态

DesktopCompanionController
  目录、选择、窗口同步、活动归约、对话桥接与点击回到任务

DesktopCompanionSettings
  显示开关、本地目录和兼容性状态

PetOverlay
  只渲染已验证素材和语义状态

PetChat
  独立可聚焦窗口；只通过事件向主渲染器提交消息、steer 与一次性审批
```

后续阶段再引入 `TaskHeader`、`TaskTimeline`、`AttentionCenter`、`ArtifactWorkbench` 和声明式
Settings Registry。不能为了拆文件复制状态或建立第二个运行时。

## 3. 桌面伙伴整合

### 3.1 产品角色

桌面伙伴是可选的注意力与状态表面，不是 Agent，也不拥有任务：

- `idle`：待命；
- `running`：正在执行；
- `waiting`：需要用户输入或审批；
- `paused`：已在安全边界暂停，可继续；
- `ready`：结果可查看；
- `blocked`：任务遇到可见问题。

优先级固定为 `waiting → blocked → paused → ready → running`，同级以最近更新时间优先。点击伙伴必须
回到拥有该 activity 的场所和 session；不能打开一个标题正确但 cwd 错误的会话。

伙伴只显示简短状态和由 `state/phase` 映射出的固定安全标题；原始 `objective`、brief、checkpoint
和 detail 都不能进入置顶窗口，以免显示 chain-of-thought、密钥、客户文本、完整路径、命令输出
或文件正文。多个任务同时存在时显示数量，详细列表由 Desktop 的注意力中心负责。

### 3.2 现有素材统一

统一目录协议而不是统一素材版权：

| Provider | 位置/性质 | 行为 |
| --- | --- | --- |
| `builtin` | Hara 内置代码伙伴 | 随 Desktop 发布 |
| `hara-local` | `~/.hara/pets` | Hara 校验并管理 |
| `codex-local` | `~/.codex/pets` | 只读发现，不复制、不改名 |
| `hara-market` | 未来签名市场 | 下载后验证并安装为 `hara-local` |

Selector 是 provider-qualified 逻辑 ID，不能是任意路径或 URL。Codex 包只有用户明确导入且
许可证允许时才能复制到 Hara 目录；兼容发现不代表 Hara 获得素材所有权。

### 3.3 安全与可访问性

- 包只允许 manifest 和一张 PNG/WebP spritesheet，不执行 HTML、CSS、脚本或命令；
- Native 层重复校验根目录、路径、符号链接、MIME、大小和 v1/v2 几何；
- Pet webview 只收到验证后的 data URL，不拥有文件系统或市场 Token；
- 动画 Pet 窗口默认不抢键盘焦点；聊天使用独立可聚焦窗口，只拥有 event/window
  capability；生产构建只对专用 `pet-chat.html` 注入 `connect-src 'none'` 的
  deny-by-default CSP，封死 `fetch`、WebSocket、beacon 等浏览器网络通道，因此不能直接调用
  Native、文件、网络、更新器或 Agent。开发构建不注入该 CSP，以保留 Vite HMR；
- 聊天打开时固定目标 session，broker 会拒绝来自旧页面状态的跨 session 请求；切换目标会清空
  旧草稿和 pending request。明确的桥接失败会恢复草稿；仅仅超过响应阈值时仍保持 pending
  并禁止重发，因为可信主窗口可能已经开始派发，不能把慢响应伪装成可重试失败而重复执行；
- 新引擎以 typed lifecycle 为状态真相；兼容旧 sidecar 时仍从受限的运行/完成事件和未答复
  approval 生成状态；turn 结束时旧 approval 会明确过期，不让“等待确认”错误持续存在；
- 所有显示、选择和收起操作在主设置页必须有等价入口；
- reduced-motion 固定首帧；
- 市场浏览和免费安装不强制登录，发布、付费和同步才引入账号。

## 4. 不采用的方案

### 4.1 整体迁入 OpenHuman

拒绝。许可证、内核模型、依赖规模、产品导航和发布成本均与 Hara 不匹配。

### 4.2 让桌宠成为主界面

拒绝。普通办公任务的中心必须是 TaskRun 和 Artifact；桌宠可以提醒和导航，但不能挤压预览、
编辑或审批空间。

### 4.3 Desktop 从聊天文本推断任务状态

拒绝。文本变化会产生误判，也无法支持恢复、并发和审计。缺少结构化事件时应显示“旧引擎需
升级”，而不是猜测。

## 5. 分阶段实施

### Phase 1：壳层与伙伴收口

- 抽出四场所 AppRail；
- 抽出 ConversationTimeline；
- 抽出 DesktopCompanionController 与设置组件；
- 保持现有 protocol-v1 行为和视觉结果；
- 补组件边界、场所归属、伙伴优先级与点击回路回归。

### Phase 2：任务交互（协议基础已落地）

- `hara serve` 已暴露版本化 `event.task_state`、waiting/pause/checkpoint 和 expected-turn
  `session.steer`；Desktop 通过 capability negotiation 兼容旧引擎；
- Desktop 已将运行中纯文本输入路由到真实 steer，将附件与文本作为一个可见、可撤回的新回合
  队列，并用结构化状态驱动桌面伙伴；
- Desktop 增加 TaskHeader、折叠步骤、运行中输入选择和 Attention Center；
- 人工等待不显示为“仍在执行”，活跃预算与墙钟时间分开。

### Phase 3：Artifact 工作台

- 落地 Revision、Validation、Preview、ExportReceipt；
- PPT、表格、文档和视频使用同一工作台骨架；
- Desktop 只启动经过 Capability Runtime 授权的 Panel v2。

### Phase 4：能力与伙伴市场

- 签名目录、安装计划、权限说明、更新、撤回和回滚；
- 免费公共内容无需登录；
- 国内/全球服务分区，但共用协议和客户端代码。

## 6. 验收条件

- 切换四场所后不会显示或发送到错误 session；
- 结构拆分前后的 protocol-v1 事件、审批、interrupt、队列和 Panel 行为一致；
- 桌面伙伴可选择内置、Hara 本地和 Codex 只读兼容包；
- 伙伴窗口不抢输入焦点，等待/失败/完成优先级稳定，点击回到正确场所；
- 伙伴聊天不直接执行 Agent/Native 操作，目标 session 不因其他任务活动而串线；明确发送失败会
  恢复草稿，慢请求保持单一 pending 且提示不得重发；冷启动时会先恢复持久 session，再发送消息；
- 不兼容包不能加载，错误不泄露本机路径或凭据；
- Node 测试、TypeScript/Vite 构建、Rust 单测、Cargo check 和 release metadata 全部通过。
