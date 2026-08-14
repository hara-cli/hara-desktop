# Hara 协作工位与桌宠统一状态方案

> 状态：专家评审结论，待按阶段实施。
> 决策日期：2026-08-14。
> 适用范围：Hara CLI / Serve、Hara Desktop 右侧扩展屏、Desktop 桌宠。

## 1. 产品决定

Hara 应吸收旧 Mission Control 像素办公室中“让 Agent 的真实工作状态可见、可理解、可
进入”的价值，但不直接嵌入或复制旧应用。

首个产品形态命名为 **协作工位**（内部 surface kind 可使用 `workforce`）：

- 它是当前聊天或项目会话拥有的原生右侧扩展屏标签，可收起、关闭、调宽和聚焦。
- 左侧聊天仍是任务的控制入口；点击工位中的角色回到精确会话、审批或结果。
- 桌宠是同一份活动状态在扩展屏收起、Desktop 失焦或窗口关闭后的系统级投影。
- `Office` 继续表示演示文稿、表格和文档能力，避免与“Agent 办公室”混淆。
- 初版不增加常驻左侧导航；只有多会话全局调度需求被真实使用验证后，才增加全局任务中心。

## 2. 旧 Mission Control 原型的取舍

### 可以学习

- 工位、走动、打字、等待气泡、出生/离场、交付和短暂庆祝等可读状态。
- 父 Agent 与子 Agent 的空间关系，以及角色进入、工作、等待和结束的连续性。
- 猫、休息区、咖啡区等低干扰趣味元素，但必须服务于真实状态或环境氛围。
- 稳定座位、可点击角色和状态检查器的空间记忆。

### 不直接复用

- 当前 `OfficeView` 硬编码的角色名单和 `online -> working` 粗略映射。
- 与 Hara 会话、审批、恢复和权限边界无关的独立 Dashboard 数据源。
- 整个页面 iframe / WebView 嵌套、每个实例独立 60fps 循环和随机重排座位。
- 未确认许可证与来源的角色、家具和音效资产。
- 展示提示词、思维链、完整工具参数、命令、路径、输出或凭据的状态气泡。

File、Computer、Browser、Design、Office 等应是**能力区域**，不是永远在线的虚构 Agent。
只有 Serve 报告真实执行者时，场景中才出现相应角色。

## 3. 一个状态真源

将现有桌宠专用活动状态提升为共享的 `AgentActivityLedger`。三个界面只做选择与投影：

```text
Hara CLI / Serve
  └─ event.workforce_state.v1（有序、可恢复、脱敏快照）
       └─ Desktop AgentActivityLedger
            ├─ 当前会话 → 右侧协作工位
            ├─ 全部会话 → 后续全局任务中心
            └─ 最高优先级一项 → 桌宠
```

现有 `event.task_state` 继续负责根任务生命周期。新增事件补足根 Agent、子 Agent 和外部
执行者的并发关系，不能通过解析聊天文案或工具返回值推断。

建议首版协议：

```ts
interface WorkforceStateEventV1 {
  version: 1;
  streamId: string;
  sequence: number;
  sessionId: string;
  taskId: string;
  turnId: string;
  mode: "snapshot";
  actors: Array<{
    actorId: string;
    parentActorId?: string;
    kind: "root" | "subagent" | "external";
    role?: string;
    capability: "orchestration" | "files" | "code" | "browser" |
      "research" | "design" | "office" | "communication" | "other";
    state: "queued" | "working" | "waiting" | "paused" | "blocked" |
      "completed" | "failed" | "cancelled";
    activity: "planning" | "reading" | "writing" | "running" |
      "reviewing" | "awaiting_approval" | "delivering" | "idle";
    startedAt: string;
    updatedAt: string;
    endedAt?: string;
  }>;
}
```

协议约束：

- `sequence` 在 `streamId` 内严格递增；重连和 `session.resume` 必须恢复当前快照。
- 每个会话最多返回 24 个可视角色，更多执行者聚合为一组，避免 UI 和事件风暴。
- 工具名在 Serve 侧映射为有限的 capability / activity 枚举。
- 事件不得包含任务原文、思维链、完整工具参数、命令、绝对路径、文件内容、输出或凭据。
- 当前正在执行的一轮保持稳定；协议升级、重连和旧引擎降级必须有兼容测试。

## 4. 状态到场景的确定性映射

| 真实状态 | 工位表现 | 桌宠表现 |
|---|---|---|
| 根任务规划 | 中央调度桌或白板 | 处理中 |
| 子 Agent 排队 | 入口或预留座位 | 不抢占更高优先级状态 |
| 文件/研究 | 资料架或阅读工位 | 处理中 |
| 浏览器/计算机操作 | 显示器工位 | 处理中 |
| 设计 | 白板或画架 | 处理中 |
| PPT/文档/表格 | Office 能力工位 | 处理中 |
| 等待用户或审批 | 举手、琥珀提示和明确文字 | 需要你确认 |
| 暂停 | 咖啡或休息区 | 已安全暂停 |
| 阻塞/失败 | 红色修复区和明确原因类别 | 遇到问题 |
| 完成 | 短暂交付托盘/庆祝，随后淡出或待命 | 任务完成 |

动画只能由真实事件触发。没有真实 handoff、等待或子 Agent 事件时，不播放相应动画。
同一 `actorId` 的座位必须稳定，不能因每次刷新随机变化。

## 5. Desktop 交互

- `+` 菜单增加“协作工位”，默认绑定当前聊天/项目会话 owner。
- 标签头显示工作中、等待和阻塞数量；扩展屏关闭后完整归还聊天空间。
- 主体由场景与紧凑角色列表组成；场景负责理解，列表负责精确状态、键盘操作和无障碍。
- 点击角色只执行安全导航：打开精确会话、审批卡或已完成结果。
- 审批仍在现有聊天/审批面板完成；场景本身不获得新的权限。
- 当前会话和全局范围必须明确区分，禁止不同 Chat、Project、Task 或 Office owner 混用权限。

## 6. 桌宠协同

- 桌宠不维护第二套任务真相，只从共享 ledger 选择一个最高优先级活动。
- 优先级保持：等待审批 > 阻塞 > 暂停 > 完成 > 工作中 > 空闲。
- 桌宠点击后打开产生该状态的精确会话和任务，不跳到“最近活动”的其他项目。
- 常驻顶层窗口继续只显示脱敏状态标题，不显示客户内容、目标、路径或工具输出。
- 协作工位可展开查看多个角色；桌宠只表达一个当前最需要用户注意的状态。

## 7. 视觉、性能与可访问性

- 首版优先 DOM/SVG 加经过验证的桌宠 spritesheet；家具和道具使用 Hara 自有资产。
- 共享 8–12fps 动画时钟，最高不超过 30fps；标签隐藏、窗口失焦或系统节能时暂停。
- 支持 `prefers-reduced-motion` 和完全静态模式。
- 颜色之外同时使用图标和文字；角色列表具备键盘焦点、ARIA 标签和与场景等价的信息。
- 初版最多 24 个角色，避免 WebGL 和独立游戏引擎依赖。
- 暂不抽 npm 包。只有 Desktop 与第二个真实消费者都需要该场景后，再评估
  `@nanhara/agent-office-scene`。

## 8. 实施阶段与门禁

### P0：协议与恢复

- Serve 发出有序、脱敏的 workforce 快照，覆盖根 Agent 和真实子 Agent。
- Desktop reducer 覆盖乱序、重复、断线、重连、resume、旧引擎和 24 人聚合。
- 安全测试证明敏感原文不会进入事件、日志、桌宠或系统通知。

### P1：当前会话协作工位

- 在现有 owner-scoped Extension Dock 中新增原生 `workforce` 标签。
- 先交付根 Agent、列表、确定性工位和工作/等待/阻塞/完成状态。
- 关闭、收起、调宽、聚焦和切换会话均不串状态。

### P2：真实子 Agent 与桌宠统一

- CLI 子 Agent runtime 暴露 queued / started / settled 生命周期。
- 子 Agent 出生、工作、等待、交付和离场全部由协议驱动。
- 桌宠改为共享 ledger selector，验证优先级和精确回跳。

### P3：全局任务中心

- 只有多会话调度需求有真实使用证据后，增加列表 / 工位 / 时间线三种视图。
- 全局视图默认仍不合并权限；进入角色时回到其 owner 会话。

### P4：主题和历史

- 增加经过许可审查的主题、家具、节庆和完成回放。
- 趣味元素不能掩盖等待、失败、权限和任务真实性。

## 9. 首版验收

首版只有同时满足以下条件才算完成：

1. 用户能从当前聊天打开和关闭协作工位，聊天和扩展屏空间行为与其他标签一致。
2. 根任务与至少一个真实子 Agent 的排队、工作、等待、完成和取消状态可重放验证。
3. 重连后角色、父子关系和状态恢复一致，不出现幽灵角色或随机换座。
4. 点击等待角色进入精确审批；点击完成角色进入精确会话或结果。
5. 桌宠与工位对同一活动给出一致状态，且不会泄露任务内容或凭据。
6. 隐藏标签不持续高频绘制；减弱动画、键盘和屏幕阅读器路径可用。

