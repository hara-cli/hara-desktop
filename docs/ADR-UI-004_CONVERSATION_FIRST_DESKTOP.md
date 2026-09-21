# ADR-UI-004：对话优先的 Desktop

状态：接受（分阶段实施）

## 决策

Hara Desktop 采用“聊天是产品层，任务与 Session 是运行层”的结构。用户面对联系人、私聊、群聊和
消息，不需要先理解 Session、模型路由、工作区或工具生命周期。

Hara 不是普通 IM：任务、审批、执行摘要和交付物可以成为消息流中的结构化工作卡；终端、完整 Diff
和长日志进入侧屏或独立扩展屏，避免把聊天正文变成控制台。

## 主界面

- 左栏是最近聊天，不再把 Session 数量作为一级信息。
- 全局入口使用 `＋ 新建`，菜单包含“发起聊天、创建群聊、创建 Agent”。
- 给某个 Agent 执行新工作从该 Agent 的对话发起；底层是否新建 Session 由 Hara 决定。
- 单一 Personal Space 不占用侧栏；多个 Space 或企业托管时显示紧凑边界标记。
- Space 名称只表达数据与权限边界。供应商或套餐名称只属于模型连接，不能显示为 Space 名称。

## 对话时间线

- 用户消息使用右侧气泡；Agent 回复使用左侧开放正文，避免每条回复都是厚重卡片。
- 同一发送者的连续消息合并头像与名称；不同 Turn 之间保留清楚的节奏。
- 工具和 Diff 默认折叠为一条执行摘要；审批和失败保留高显著操作卡。
- 任务状态绑定到发起消息/Turn，并使用稳定高度的紧凑状态条，避免不断改变页面高度。
- Message/Event 数据需要稳定 ID、sender、createdAt、turnId/taskId、状态、replyTo、mentions 与
  clientMessageId，才能支持失败重试、未读游标、分页和群聊。

## 跟随滚动

- 只监听当前活动对话，后台会话更新不得滚动当前页面。
- 距离底部不超过 96px 时自动跟随；用户上翻后立即停止抢夺滚动。
- 流式输出使用 `requestAnimationFrame` 合并后的即时容器滚动，不连续启动 smooth 动画。
- 暂停跟随后显示“查看新消息”；切换联系人和主动发送后回到底部。
- 历史 Turn 后续使用 memo、`content-visibility` 或窗口化，流式 Markdown 不应重算整段历史。

## Composer 与运行设置

默认输入区只显示附件入口、自动增高输入框和发送/停止：

- 工作区显示在对话标题或详情。
- 全局模型连接、模型、权限和思考强度成为新执行段的默认值。
- 对话仅在用户主动打开“运行设置”时提供临时覆盖。
- 全局设置变化不静默改写正在执行的 Session；下一次发送创建新的执行段，视觉聊天保持连续。
- 只有重要异常常驻：完全自动权限、企业托管、下一轮待切换、上下文高水位和附件不兼容。

## 长期群聊

现有 Agent Room 是 Session 内的临时任务讨论室，继续作为 `TaskRoom` 使用。长期群聊必须新增
Space 级持久模型：

```text
Conversation
├── Participant（用户、Agent、外部联系人）
├── Message/Event（有序、分页、幂等）
├── ReadCursor / Delivery
└── TaskRun
    └── Session（模型、工作区、审批和执行边界）
```

- `@Agent` 只唤醒被点名成员；无 @ 时由群主 Agent/Hara 路由。
- 加群只授予阅读已共享消息的权限，不自动获得工作区、终端、网络或外部发送权限。
- `@所有Agent` 受角色、预算、并发和频率限制。
- 新成员加入时必须明确可读取的历史范围。

## Agent 招聘

Agent 可以搜索、筛选、比较和推荐人才，也可以创建招聘申请，但不默认拥有最终雇佣权：

1. `agent.catalog.read`：读取公开候选资料。
2. `agent.hire.request`：生成候选清单、风险与 HireIntent。
3. `agent.hire.approve`：Personal 由用户确认；Company 由管理员或获授权招聘者批准。
4. `agent.manage`：管理已入职 Agent 的合同与生命周期。

禁止 Agent 自批、自授权或无限递归扩编。入职合同必须冻结来源、能力、模型/区域、工作区白名单、
工具、外部发送、记忆范围、预算、并发和期限，并记录发起 Agent 与人类批准人。

## 分阶段实施

1. P0：修复流式跟随、上翻保护和新消息入口；隐藏单一 Personal Space。
2. P1：Compact Composer、标题栏运行设置、`＋ 新建`和聊天 Turn 视觉。
3. P2：Message/Event/TaskRun 投影，任务与审批消息化。
4. P3：Space 级持久私聊/群聊、游标、幂等、分页与多端同步。
5. P4：共享人才目录、HireIntent、Personal 确认与 Company 审批。

## 验收

- 20+ token/s 流式输出时不反复重启滚动动画。
- 用户上翻后绝不被强制拉回底部。
- 单一 Personal Space 在联系人栏不占大卡高度。
- 空闲 Composer 不常驻模型、供应商、权限和思考四套控件。
- 720px、900px 和 1280px 宽度下聊天正文不被侧栏/扩展屏压到 480px 以下。
- Agent、群聊、招聘和运行设置在 Personal/Company 中遵循相同的 Space 与审批边界。
