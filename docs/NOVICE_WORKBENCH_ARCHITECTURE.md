# Hara Desktop 小白工作台与能力中心架构

> 决策日期：2026-07-18
> 状态：实施规划；不代表现有版本已经提供以下能力。
> 目标：在不复制第二套 Agent Runtime 的前提下，把 Hara Desktop 从 coding shell 扩展为普通职员可用的工作助理。

## 1. 不变边界

Hara Desktop 继续是 `hara serve` 的薄客户端：

- Agent loop、TaskRun、Session、Artifact、Tool、权限、市场安装都在 CLI/Serve；
- Desktop 负责工作入口、任务状态、预览、人工编辑、确认、通知和更新；
- renderer 不持有模型密钥、办公 AppSecret 或市场签名私钥；
- Desktop 不通过解析模型自然语言猜测执行状态，只消费结构化事件；
- 能力安装不能扩大已有文件、网络和审批边界。

这是参考 Codex Desktop 最重要的部分。需要学习其 Chat/Work、Goal、Projects、Plugins、Artifact
和 Permissions 结构，不照搬其仓库、终端、worktree 和代码 diff 心智。

官方参考：

- [Work mode](https://learn.chatgpt.com/docs/get-started-with-work)
- [Long-running work](https://learn.chatgpt.com/docs/long-running-work)
- [Projects and chats](https://learn.chatgpt.com/docs/projects)
- [Plugins](https://learn.chatgpt.com/docs/plugins)
- [Work with files](https://learn.chatgpt.com/docs/artifacts-viewer)
- [Permissions](https://learn.chatgpt.com/docs/permission-modes)

## 2. 当前基础与缺口

已有：

- `hara serve` WebSocket JSON-RPC 客户端；
- session create/resume/send/interrupt；
- model、approval、context、compact、rewind、fork；
- Skill/Plugin 列表和启停；
- project Panel 左右分屏；
- 图片粘贴；
- 自动任务、通知和任务状态桌宠。

缺口：

1. 没有“问一问/帮我做”的双入口；
2. 没有持久 Goal/TaskRun 卡片和结构化步骤；
3. README 声称支持 steer queue，但 `src/client.ts` 尚未暴露 `session.steer`；
4. 没有通用文件附件；
5. 没有 Artifact、Revision、Annotation、Preview、Export 协议；
6. Skill 信息只有 `id/description/source`，不足以构成小白能力卡；
7. 只能列出已安装扩展，没有搜索、安装计划、更新、回滚、隔离和登录；
8. Panel 通过 shell 启动，缺少适合第三方市场的独立 CSP、origin、token 和 capability；
9. Windows Panel 生命周期和 Authenticode 仍是商用发行门槛；
10. 审批只有 question + allow/always/deny，不能清楚说明文件、数据去向和可撤销性。

## 3. 用户信息架构

保留现有四场所模型，不增加一排技术入口：

| 场所 | 国内版名称 | 主要对象 |
|---|---|---|
| Chat | 工作助理 | 问一问、帮我做、任务卡、外部渠道 |
| Projects | 我的文件 | 工作文件夹、资料、交付物和版本 |
| Automations | 自动任务 | 定期工作、运行记录、待确认结果 |
| Settings | 设置 | 账号、安全、模型、能力中心、更新 |

“能力中心”同时可从工作助理首页的“添加能力”卡片打开，但不成为普通用户必须先经过的步骤。

首页主入口：

```text
今天想做什么？

[ 问个问题 ]        [ 帮我完成工作 ]

常用：
[做一份表格] [改这份文档] [生成汇报 PPT]
[整理资料]   [设置定期汇报]
```

### 3.1 问一问

- 短回答、解释、改写；
- 默认不建立长期 TaskRun；
- 默认不修改文件；
- 用户随时可转成“帮我做”。

### 3.2 帮我做

Hara 自动把自然语言整理成一张任务简报：

```text
目标：按区域汇总销售明细并生成图表
资料：销售明细.xlsx
交付：可继续编辑的 XLSX
限制：不改原文件、不上传云端
验收：公式无错误，Excel/WPS 可打开
确认点：导出前
```

只追问真正阻断执行的内容，不要求用户学习 prompt 工程。

## 4. 对话与执行分离

Desktop 至少同时展示四种状态：

- Conversation：澄清、解释、steer；
- TaskRun：目标、步骤、进度、deadline、阻断；
- Artifact：当前工作文件和预览；
- Revision：人工或 Agent 的可回退修改。

任务头部固定显示：

```text
正在生成区域汇总  3/5
[暂停] [调整目标] [查看步骤] [取消]
```

到达运行截止时显示：

```text
任务已安全暂停
已保存：区域汇总草稿 v3
原因：本次最长运行时间已到
[继续 15 分钟] [调整要求] [稍后提醒]
```

不能把 timeout 表现成“莫名停止”。

### 4.1 运行中输入

用户发送新消息时，如果当前任务正在运行，显示：

- **现在调整**：通过 `session.steer` + `expectedTurnId` 影响当前任务；
- **完成后再做**：进入可查看、编辑、撤回和排序的队列；
- **新建任务**：独立 TaskRun；
- **只看状态**：侧问，不打断当前任务。

Desktop 不能再把所有输入都调用 `session.send`。

## 5. Artifact 工作台

办公任务采用左右布局：

```text
┌──────────────────────────┬────────────────────────────────────┐
│ 对话、任务简报和进度      │ 表格 / 文档 / PPT / PDF 工作台     │
│                          │                                    │
│ Hara 正在检查公式……      │ 实时预览与人工编辑                 │
│                          │                                    │
├──────────────────────────┴────────────────────────────────────┤
│ 版本 v4  [查看变更] [撤销] [恢复版本] [导出] [替换原文件]     │
└───────────────────────────────────────────────────────────────┘
```

要求：

- Artifact 不是普通聊天附件；
- 每个 Artifact 显示类型、来源、当前 Revision、验证和数据位置；
- 人工编辑与 Agent 编辑进入同一 revision/etag 流；
- 支持选中单元格、图表、段落或页面后发起局部修改；
- 导出按钮绑定确定的 Revision；
- Session rewind 不回滚二进制文件；
- 崩溃后可恢复最后已提交 Revision。

## 6. Serve Protocol v2 需求

Desktop 不实现这些逻辑，只增加 client bindings 和 UI。

### 6.1 方法

```text
task.get
task.pause
task.resume
task.update
session.steer
queue.list
queue.update
queue.remove

artifact.import
artifact.list
artifact.get
artifact.revisions
artifact.commit
artifact.revert
artifact.export

capability.catalog
capability.package.get
capability.install.plan
capability.install.apply
capability.update.plan
capability.update.apply
capability.rollback
capability.remove.plan
capability.remove.apply
capability.permissions

panel.open
panel.close
```

### 6.2 事件

```text
event.task_progress
event.task_waiting
event.queue_changed
event.artifact_created
event.artifact_changed
event.artifact_preview
event.validation
event.export_ready
event.capability_progress
approval.request.v2
```

客户端继续通过 `initialize.capabilities.methods` 做 feature negotiation；老 sidecar 缺方法时显示升级指引，
不长期维护两套复杂兼容分支。

## 7. 能力中心

默认栏目：

- 官方精选；
- 办公；
- 设计与视频；
- 企业内部；
- 个人创建；
- 已安装；
- 更新。

能力卡只展示：

- 能做什么；
- 需要什么资料；
- 产生什么文件；
- 会读取/修改什么；
- 数据是否离开电脑；
- 是否收费。

详情的“高级信息”才展示组件、权限、发布者、版本、digest、签名、SBOM 和兼容范围。

安装必须先调用 `capability.install.plan`。UI 只能提交绑定 package digest 与 permission hash 的一次性
`planId`，避免“显示 A、安装 B”。

首版只安装 Hara 官方签名能力，不开放第三方 executable/MCP/native Panel。

## 8. 行动卡

`approval.request.v2` 应返回结构化字段：

```text
title
summary
reason
resource
effect
dataDestination
reversible
risk
choices
expiresAt
```

示例：

```text
读取“销售明细.xlsx”

用途：生成区域汇总
范围：你选择的这一份文件
数据：抽样内容会发送给当前云模型
修改：只创建本地副本，不改原文件

[仅这次允许] [本任务允许] [拒绝]
```

重要动作：

- 覆盖原文件；
- 上传云端；
- 分享/发送；
- 执行宏；
- 刷新外部链接；
- 安装或更新高风险能力；
- 扩大文件或网络范围。

创建可撤销草稿不应每一步弹窗。

## 9. Panel v2

当前 `start_panel` 不能成为开放市场运行器。Panel v2：

- 不拼 shell，不从任意 PATH 解析命令；
- entrypoint 必须位于不可变 package root 并绑定 digest；
- 独立 WebviewWindow 和最小 Tauri capability；
- 默认拒绝 CSP；
- 严格解析 loopback 或签名 allowlist origin；
- 随机端口、一次性 token、短 TTL；
- 版本化 Artifact bridge；
- 禁止任意导航和直接 Tauri invoke；
- 文件操作回到 `hara serve`；
- macOS/Linux 使用进程组，Windows 使用 Job Object；
- app 退出、包撤回或权限失效时终止 owned process。

内置官方 Panel 也走同一协议，避免市场版形成第二条旁路。

## 10. Windows 商用门槛

国内普通职员以 Windows 为主。进入公开商用试点前必须：

- MSI/NSIS 或 MSIX 完成 Authenticode 和 timestamp；
- 内置 sidecar、Office worker 和 updater 分别验证签名；
- Windows 原生 Panel lifecycle；
- 中文用户名、空格、长路径、文件锁、网络盘测试；
- WebView2 缺失/损坏的可理解修复指引；
- 安装、更新、回滚和卸载 smoke；
- SmartScreen 实际验证；
- 企业静默安装与版本 pin 方案。

没有 Authenticode 时不能宣称“Windows 无安全警告”。

## 11. 实施顺序

### P0-A：执行状态

- Task/Goal 卡；
- `session.steer` client；
- 队列查看、编辑和撤回；
- deadline/pause/resume 友好状态；
- task/session 恢复 UI。

### P0-B：文件与 Artifact

- 通用附件；
- Artifact/Revision/Export；
- preview/validation 事件；
- 行动卡 v2；
- 本地副本与替换原文件确认。

### P0-C：Panel 与市场安全

- Panel v2；
- Windows lifecycle；
- CSP/capability/origin/token；
- 签名 package 的 install plan；
- 能力中心官方精选。

### P0-D：表格助手

- 表格 Panel；
- CSV + 受限 XLSX；
- 版本、变更、校验和导出；
- 小白任务模板；
- 10 名非技术用户可用性测试。

### P1

- 国内登录和 entitlement；
- WPS 或飞书 Sheets 一个在线 Provider；
- 云 Artifact 和协作；
- 文档/PPT/PDF 能力；
- 企业内部目录。

## 12. 验收

- 默认界面不出现 MCP、cwd、JSON、Skill ID 或 shell 错误；
- 80% 未培训用户完成“选文件—一句话—预览—导出”；
- 100% 测试用户能找到暂停、撤销和导出；
- timeout 明确说明原因和恢复方式；
- 人工/Agent 并发修改不静默覆盖；
- Panel 无主窗口 Tauri 权限；
- Windows/macOS/Linux 安装和 Panel 退出均无孤儿进程；
- 低版本 sidecar 给出明确升级命令。
