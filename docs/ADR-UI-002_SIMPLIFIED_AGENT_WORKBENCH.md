# ADR-UI-002：精简 Agent 工作台

> 状态：Accepted
> 决策日期：2026-09-20
> 适用范围：Hara Desktop、`hara serve` 的桌面协议与未来 Mobile 投影

> 后续对“一个 Agent 一条可见对话、底层保留多段 Session 与工作区边界”的修订见
> `ADR-UI-003_AGENT_CONVERSATION_WORKSPACE.md`。

## 背景

Hara Desktop 曾同时提供桌宠、游戏化 Agent 办公室、会话、任务、工具、交付物和审批。前两项
建立了第二套视觉状态和入口，却没有增加执行能力：用户仍需回到会话、终端、浏览器、文件或
审批界面才能完成工作。这也引入额外窗口、素材、3D 依赖、权限和恢复逻辑。

本次精简参考 xAI 官方 Grok Bot 的产品边界：Bot 是持久、具名且职责清晰的工作主体；核心交互
围绕对话、任务、结果和审批展开。Hara 只学习这一产品原则，不复制其品牌、素材或实现。

参考：

- <https://docs.x.ai/grok-bot/overview>
- <https://docs.x.ai/grok-bot/get-started>

## 决策

Desktop 的主路径固定为：

```text
Agent 列表 → 会话 → 终端 / 浏览器 / 文件 / Artifact → 结果与审批
```

- 移除桌宠窗口、桌宠聊天、素材目录、设置项和原生窗口能力。
- 移除游戏化 Agent 办公室、2.5D/3D 场景、启动入口和 Three.js 依赖。
- 保留具名 Agent、Agent 独立会话、会话历史、任务状态、终端、浏览器、文件、Artifact、审批、
  自动任务、Hara Live、Mobile/Relay 与组织能力。
- Agent 头像只承担列表识别和在线/工作状态，不再渲染全身角色或房间位置。
- `hara serve` 仍是任务、权限、结果和恢复的唯一事实来源。Desktop 不从动画或自然语言推断状态。
- 已存在的 `event.workforce_state` 线协议可在兼容期继续被旧客户端或 Core 识别，但 Desktop 不再
  暴露对应产品表面，也不应把它作为新功能的状态真相。

## 迁移与兼容

- 历史会话、Agent 身份、任务、Artifact 和审批不迁移、不删除。
- 旧桌宠偏好不再读取；旧素材和专用 capability 不进入安装包。
- 扩展屏新增菜单只提供 Terminal、Browser 和 Files；任务结果仍可自动打开对应 Artifact。
- Mobile 继续消费会话、任务、审批和终端协议，无需了解桌宠或办公室投影。

## 验收

- 生产构建不存在桌宠或 Agent 办公室入口、资源块、原生命令和 Three.js 依赖。
- 用户可以从 Agent 列表创建、切换和恢复独立会话。
- 会话仍能打开 Terminal、Browser、Files、Review 和 Artifact 工作面。
- 任务状态、审批、重连和跨 Space 隔离的现有测试继续通过。
