# Hara 互动终端与 WezTerm 架构审计

> 审计基线：WezTerm `4fbd6b8e90e2`、Hara Desktop 0.1.148、Hara Engine 0.166.1。
> 决策：Hara 统一一条 PTY/会话流；内嵌 Hara Terminal 与独立 WezTerm 是同一会话的不同视图，
> 不复制或并行启动 Codex、Claude Code 与 Shell。

## 1. 结论

Hara 不应把 WezTerm 整个 GUI 复制进 Tauri WebView。WezTerm 的 `wezterm-gui` 使用自己的窗口、事件循环与
GPU 渲染链，不能作为普通 WebView 组件直接嵌入。`wezterm-term` 只是终端状态机，不提供 GUI 或
PTY；若在 Hara 现有 ANSI 帧后再引入它，会形成两次终端仿真和两个滚动状态源。

Hara 采用下面这一条统一链路：

```text
Codex / Claude Code（唯一进程）
  ↕
Herdr PTY（唯一终端状态与生命周期所有者）
  ↕ 有序全量/增量帧、原始输入、resize、scroll、lease
Hara Engine
  ├─ Hara Terminal：Desktop 内嵌，适合对话旁分屏或全宽工作
  ├─ WezTerm：独立原生窗口，取得同一会话的输入租约
  └─ Mobile Terminal：未来只连接用户明确发布的同一会话
```

这既能获得 WezTerm 的原生终端体验，又能保留 Hara 对审批、远程控制、企业隔离和移动端发布的
统一裁决权。

## 2. 从 WezTerm 全面吸收的机制

### 2.1 进程与视图解耦

WezTerm `mux` 使用稳定 pane/window/workspace 身份，让 pane 生命周期不依赖某个 GUI 视图。Hara
对应使用稳定 `sessionId + streamId`：收起、全宽、恢复分屏或打开 WezTerm 都不能重启供应商进程。

### 2.2 有序刷新与可恢复状态

WezTerm pane 暴露 `SequenceNo`、`get_current_seqno` 和 `get_changed_since`，而不是让视图猜测是否漏帧。
Hara 现有终端流使用严格递增 `seq` 和显式 `full` 帧；增量缺口必须断开并重新取全量帧，禁止在损坏
画面上继续输入。下一阶段应增加 `epoch + acknowledgedSequence`，支持断线后有界重放。

### 2.3 输出合并与背压

WezTerm mux 会短暂合并解析工作，避免每个碎片都触发整屏重绘，并向订阅者发布 pane 输出变化。
Hara 保留 Engine 的慢客户端上限，并应把连续 ANSI 帧按渲染帧合并；任何客户端超过队列上限时先
降级为全量重同步，不能无限占用内存或拖慢 PTY。

### 2.4 一个控制者，多个观察者

Hara 比本地 mux 多一条远程安全边界：同一终端可以有多个只读观察端，但只有一个输入租约。Desktop、
WezTerm 与未来手机端之间必须显式申请、确认移交、释放和超时；租约变化需要单调 `leaseEpoch`，旧输入
即使延迟到达也必须拒绝。

### 2.5 尺寸、滚动与搜索

WezTerm 的 pane 将 PTY 尺寸、scrollback、逻辑行和可见 viewport 分开。Hara 已把真实 `resize` 与
`scroll` 送回 PTY，后续应补齐：

1. 保留用户滚动位置，新输出到达时不强制跳到底部；
2. 搜索、复制、超链接与当前选区均为视图状态，不写回会话正文；
3. 控制端决定 PTY 尺寸，观察端只改变自己的 viewport；控制转移后由新控制端提交一次尺寸；
4. 全宽、分屏、窗口缩放与 Retina 比例变化经防抖后只提交最新尺寸。

## 3. Desktop 交互标准

- 互动终端默认全宽打开，避免长命令、diff 和审批在窄列中折行；“恢复分屏”始终可见。
- 分屏状态保留可拖动宽度；中等窗口也不能隐藏“终端全宽”入口。
- 实时状态栏提供取得控制、释放、重连和“在 WezTerm 打开”；控制转交必须二次确认。
- 内嵌视图命名为 **Hara Terminal**。只有真正启动独立应用时才显示 **WezTerm**，不把 xterm.js
  渲染器冒充成嵌入式 WezTerm。
- Desktop 与 Engine 版本不一致时，在当前工作区直接提示并提供“切换到内置引擎”；旧 Engine 的
  终端快照不能伪装成可互动终端。
- `Ctrl+C`、Enter、Esc、方向键、Tab、PgUp/PgDn 均发送真实终端字节或滚动命令，并同时显示中英文
  动作含义；按钮不是只改变前端文本的模拟控件。

## 4. 可靠性验收

每次终端发布至少验证：

1. 全宽 ↔ 分屏 ↔ 收起不改变进程 PID，不丢失当前审批或输入状态；
2. Desktop ↔ WezTerm 控制移交后始终只有一个写入端，外置启动失败时 Desktop 不丢控制；
3. Ctrl+C 发送 `0x03`，IME 粘贴、方向键、Tab、Enter 与 resize 在 Codex、Claude Code 各验证一次；
4. 丢帧、乱序、重连和慢观察端不会产生重复命令，也不会把旧帧当成当前画面；
5. 终端字节、命令、路径和凭据不进入遥测、崩溃报告、群消息或普通 Hara 会话正文；
6. Desktop 版本、运行 Engine 版本和打包 Sidecar 版本一致；若端口被开发引擎占用，界面明确阻止混用。

## 5. 分阶段落地

### 已具备

- 结构化 ANSI 帧、严格序号、原始输入、resize、scroll 与 release；
- 单控制者/多观察者与显式 takeover；
- xterm.js 内嵌渲染和独立 WezTerm 同会话接管；
- 终端真实按键、中文动作标签和旧 Engine 快照降级。

### 当前 Desktop 修复

- 终端默认进入全宽工作区；
- “终端全宽 / 恢复分屏”改为常显文字按钮，中等窗口不再隐藏；
- 内嵌来源改为 `Herdr · Hara Terminal`，WezTerm 只作为独立原生窗口入口；
- Desktop/Engine 混用时在工作区直接告警并可切回内置 Engine。

### 后续协议升级

- `streamEpoch + lastAcknowledgedSequence` 的断线重放；
- 控制租约 epoch、客户端身份和幂等 input command ID；
- 有界帧合并、全量重同步、滚动位置、搜索和链接；
- 复用同一协议接入 React Native 原生终端视图，不把 WezTerm mux 暴露到公网或手机端。
