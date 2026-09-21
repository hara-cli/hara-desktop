# ADR-UI-003：Agent 对话与工作区调度

> 状态：Accepted
> 决策日期：2026-09-21
> 适用范围：Hara Desktop、Hara CLI/Serve、未来 Hara Mobile

## 决策

Hara 采用“去项目化界面，不去工作区化内核”的产品架构：

- 用户的一级心智只有 Agent 私聊、群聊、组织协作和任务状态。
- “项目”不再作为 Workbench 一级页签或创建会话的必经入口。
- 每个 `{Space, Agent}` 默认显示为一个稳定联系人；历史执行不再用数字徽标冒充多段聊天。
- 用户发出新任务、切换模型、切换工作区、发生压缩或并行执行时，Core 可以创建新的底层
  Session 段，但 Desktop/Mobile 将其投影到同一 Agent 联系人下。
- 当前工作区只以对话顶部的轻量标签和详情面板出现；用户无需先理解 cwd/project/session。
- Agent 可以从已授权工作区中选择或建议工作区。访问新目录、跨 Space、扩大写权限或执行权限
  时，必须再次获得用户确认。

底层继续保留以下不可删除的安全边界：

- `spaceId/profileId`：组织、账号与模型路由边界。
- `cwd/workspaceRef`：文件、命令、终端和工具权限边界。
- Session：模型、审批、恢复、压缩、审计和并发执行边界。
- Worktree 与 Diff 所有权：可写子 Agent 的隔离及人工合并边界。
- 项目级 `AGENTS.md`、Skills、审批和 `.hara/memory`。

## 记忆分层

记忆必须保持三层隔离，不能因为界面去掉“项目”而合并：

1. **Agent 关系记忆**：称呼、长期偏好、Agent 的公开身份和协作习惯。
2. **对话摘要**：当前联系人下多个 Session 段之间的必要连续性。
3. **工作区记忆**：该目录的架构、命令、约束和历史决策；只在 Agent 被授权处理该工作区时加载。

工作区记忆继续存放在对应工作区的 `.hara/memory`。Personal 与公司 Space、不同公司、不同
工作区之间默认不共享；跨边界迁移必须是显式、可审核的动作。

## Agent 调度规则

Agent 自动选择工作区时按以下顺序执行：

1. 当前任务已经绑定工作区：继续使用。
2. Agent 有已授权默认工作区，且用户意图明确：使用并在消息流显示。
3. 用户明确提到一个已授权工作区：创建新的 Session 段并切换。
4. 多个已授权候选同样匹配：询问一次。
5. 新目录、跨 Space 或权限扩大：展示目标和权限并等待确认。

Agent 不得静默扫描用户 Home 来推断项目，也不得把旧 Session 原地改绑到另一个工作区。

## 私聊、群聊与执行段

```text
Space
└── Conversation（用户看到的联系人或群聊）
    ├── Session A（workspace hara / Claude Code）
    ├── Session B（workspace control / Codex）
    └── Session C（无工作区的普通咨询）
```

- `Conversation` 是产品层的长期对话。
- `Session` 是 Core 的执行段；它可暂停、迁移、压缩和审计。
- 现有 Agent Room 是 Session 内的临时任务协作室，后续改名为 `TaskRoom`；它不能替代长期群聊。
- 长期群聊需要 Space 级 Conversation/Event 存储、成员关系、分页、幂等消息和 Agent 唤醒策略。

## 当前落地

- Workbench 隐藏 Projects 和独立 Deliverables 一级入口。
- Agent 联系人点击后直接进入最近执行段；多段历史收进“历史任务”。
- 新建入口显示为“新任务”，不再暗示每次都是一个新的社交对话。
- 对话顶部显示 Agent 名称和当前工作区标签。
- 主 Hara 使用内部 Agent 目录路由消息；内部 Agent 名称优先于飞书/微信外部联系人。
- Provider/凭证错误在目标 Agent 对话中显示可操作提示，不再留下空白气泡。

## 后续迁移

1. 为 Agent 分配与 `project:name` 解耦的稳定 `agentId`，旧引用仅作为兼容别名。
2. 新增持久化 Conversation/Event 数据层，把历史 Sessions 无损投影为一条 Agent 对话。
3. 新增长期群聊并保留 TaskRoom 作为内部执行协作。
4. 把工作区授权目录、默认工作区和撤销入口放入联系人详情与聊天“+”菜单。
5. 最后清理只服务旧 Projects 页签的 UI 缓存；不得删除历史、记忆、审批或工作区数据。

## 验收原则

- 用户不进入“项目页”也能创建任务、选择 Agent、关联工作区、审批并查看结果。
- 同名外部联系人与内部 Agent 并存时，内部 Agent 路由可解释且不会误发到外部渠道。
- Agent 切换工作区会创建新的执行段，并继续遵守 Space、审批、Worktree 和 Diff 边界。
- 隐藏项目入口不会丢失历史 Session、项目记忆、终端、文件、Review 或 Artifact 能力。

聊天呈现、滚动、群聊、运行设置与 Agent 招聘的后续决策见
[ADR-UI-004：对话优先的 Desktop](./ADR-UI-004_CONVERSATION_FIRST_DESKTOP.md)。
