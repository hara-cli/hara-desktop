# Hara 手机伴侣端 MVP 方案

> 状态：进入协议与安全边界规划；尚未交付手机应用或公网中继服务。
> 基线：Hara Desktop 0.1.147、Hara Engine 0.166.1。
> 关联约束：`MOBILE_IDENTITY_CONTRACT.md`、`EXTERNAL_SESSION_RUNTIME_PLAN.md`。

## 1. 产品目标

手机端不是在手机上重新运行 Codex、Claude Code 或本地 Shell，而是让用户在离开电脑时，
安全地查看和操控 Desktop 已明确发布的同一个 Hara 会话。

首版只解决四件事：

1. 查看电脑是否在线，以及已授权会话的真实运行、等待、完成和失败状态；
2. 阅读经过用户授权发布的消息与结果，并收到不含任务正文的隐私通知；
3. 回复 Agent 的问题、处理普通审批、暂停、中断或继续任务；
4. 在用户主动取得控制权后，为已发布的 Hara Live 会话提供实时终端交互。

首版不支持从手机读取电脑文件系统、导出供应商原生会话 ID、获得模型 API Key、复制浏览器
Cookie，或绕过 Desktop 的审批与沙箱策略。手机离线时只能查看加密缓存，不能代替用户启动任务。

## 2. 总体架构

```text
iOS / Android Hara
  └─ 独立 deviceId、硬件保护设备密钥、短期账号凭据
       ⇅ TLS + 端到端加密信封
Hara Relay
  └─ 只保存路由、序号、到期时间和密文，不持有供应商凭据
       ⇅ Desktop 主动建立的出站连接
Hara Desktop / hara serve
  └─ publication、权限、控制租约和执行的最终裁决者
       ├─ Hara 会话
       ├─ Codex App Server / Claude SDK continuation
       └─ Hara Live PTY
```

Desktop 不开放入站端口。Relay 不能解密消息正文，也不能直接调用终端；所有命令都必须携带
已配对设备签名、`publicationId`、`commandId`、`leaseEpoch` 和到期时间，并由 Desktop/Core
再次验证。

## 3. 当前已经具备的基础

Desktop 0.1.147 与 Engine 0.166.1 已经把原生终端进程和显示层分开。现有本地协议可以直接
作为移动协议的语义基础，但目前仍只允许本机客户端使用：

- `external.sessions.list/read/fork/submit/steer/interrupt` 提供供应商无关的会话交互；
- `external.sessions.terminal.attach` 返回带严格递增序号的 `ansi-base64` 全量或增量帧；
- `terminal.raw-input/resize/scroll/release` 提供原始输入、尺寸、滚动和控制释放；
- PTY 同一时刻只有一个输入控制端，Hara 与 WezTerm 之间必须明确移交，观察端不能写入；
- `event.task_state`、`event.workforce_state` 与审批事件提供无需解析聊天文案的真实状态；
- Desktop 只接收 Hara 不透明会话 ID，供应商原生 ID、完整路径和凭据留在 Core。

这意味着手机端不需要复制 WezTerm 或再启动一个 Codex/Claude 进程。它需要新增的是可靠远程
传输、设备身份、发布授权和移动交互层。

## 4. 必须补齐的协议

### 4.1 发布授权

本地会话默认不可见。用户必须在 Desktop 逐个发布，并选择能力：

```ts
type PublishedSessionCapabilities = {
  read: boolean;
  submit: boolean;
  approve: boolean;
  interrupt: boolean;
  terminalObserve: boolean;
  terminalControl: boolean;
};
```

发布记录绑定 owner、源设备、目标设备、会话、能力、到期时间和撤销时间。Personal 会话不会因
切换企业而自动进入企业空间；企业会话还必须重新校验成员身份和管理员策略。

### 4.2 有序恢复

每个远程流都必须提供 `streamId + epoch + sequence`。手机断线重连后先取有界快照，再从已确认
序号继续；重复命令按 `commandId` 幂等返回，序号缺口触发重新同步，不能猜测或静默跳过。

### 4.3 单一控制租约

观察者可以有多个，输入控制者只能有一个。手机申请控制时，Desktop 显示设备名称、会话、
权限和到期时间；已有控制端必须确认移交，或者先显式释放。锁屏、网络超时、账号退出、设备
撤销和 App 进入后台超过期限都会使租约失效。

### 4.4 审批等级

- 普通回复和低风险选择可在已授权手机上完成；
- 文件写入、命令执行和外部网络沿用原任务审批策略；
- 高风险操作要求手机生物识别，企业策略也可强制 Desktop 二次确认；
- 过期审批永远不能在重连后重新提交。

## 5. 交付顺序

### P0：远程协议与本机双客户端仿真

- 为快照、增量、命令幂等、租约申请/移交/释放和撤销建立版本化 schema；
- 用第二个本机测试客户端模拟手机，覆盖断线、乱序、重复、慢客户端和控制争抢；
- Relay 使用密文假实现验证边界，日志只保留脱敏审计字段；
- 未完成 P0 前不发布公网可控终端。

### P1：手机只读伴侣

- 登录、设备配对、电脑在线状态和设备撤销；
- 会话列表、真实任务状态、消息阅读和结果通知；
- 通知只显示“需要确认/任务完成”等固定文案，锁屏不显示任务正文；
- 首个内部测试版只对 Personal 会话开放显式发布。

### P2：回复与审批

- 文本回复、结构化选择、暂停/继续/中断；
- 生物识别、过期处理、重复提交保护和审计记录；
- Desktop 与手机明确显示当前控制者，并能立即断开远程访问。

### P3：实时终端

- 使用现有 ANSI 帧协议接入移动终端渲染器；
- 提供中文/英文的 Enter、Esc、方向键、Tab、Ctrl+C 等快捷键；
- 自适应尺寸、滚动、前后台恢复和慢网络降级为只读快照；
- 手机不暴露任意本地会话，只能进入 Desktop 已发布的 Hara Live 会话。

### P4：企业策略与 Android 对等

- 管理员控制是否允许发布、终端控制、审批等级、保留期和设备数量；
- 完成跨组织隔离、离职/撤销、审计导出和 Android 对等验证；
- 企业策略不满足时，客户端只展示不可用原因，不能自动降级到 Personal。

## 6. P0 验收门槛

1. 10,000 个重复或乱序帧不会导致重复显示、越权输入或无限内存增长；
2. 同一个会话在 Desktop、手机仿真端和 WezTerm 间始终只有一个输入租约；
3. 设备撤销、publication 撤销或 epoch 变化后，旧命令和旧审批全部拒绝；
4. Relay 数据库、日志、推送和崩溃报告中没有正文、完整路径、原生会话 ID 或凭据；
5. Personal 与两个不同企业之间的会话、缓存、推送和审计无法串读；
6. Desktop 离线或退出后，手机明确显示离线，不能让 Relay 代执行任务；
7. 丢失手机后可从 Desktop 或账号后台单独撤销该设备，不影响电脑上的本地会话。

满足以上门槛后，才创建可分发的手机内部测试构建。

## 7. 客户端技术决定

手机端采用 **React Native New Architecture + TypeScript**，iOS 先进入内部测试，Android 使用
同一业务代码随后达到功能对等。它是原生控件应用，不是把 Desktop 网页塞进 WebView。

选择 React Native 的原因：

- Hara Desktop 的状态归约、协议类型和界面逻辑已经使用 React/TypeScript，可把无平台依赖的
  schema、幂等命令、会话 reducer、i18n 和测试夹具抽成共享包；
- New Architecture 的 Codegen/TurboModule 允许为两端建立类型安全的原生边界，也能在确有需要
  时复用 C++ 模块；
- 一套界面覆盖 iOS/Android，同时仍能对安全和性能关键路径使用真正的 Swift/Kotlin 实现；
- Flutter 会引入独立 Dart 技术栈且无法直接复用现有 React 状态层；完整 SwiftUI + Compose 会把
  业务、无障碍和回归测试维护两遍。

以下能力必须是原生模块或原生组件，不能用普通 JavaScript 存储或后台定时器替代：

- iOS Keychain/Secure Enclave 与 Android Keystore 的设备密钥；
- APNs/FCM 推送、系统生物识别、加密本地缓存和锁屏清理；
- 前后台生命周期、网络恢复和控制租约释放；
- 高帧率终端视图、IME、选择复制、无障碍与硬件键盘事件。

工程可以采用 React Native 官方推荐的框架化初始化与原生 development build，但安全相关逻辑、
审批文案和远程控制能力不得通过绕过应用商店签名链的 OTA JavaScript 更新发布。终端协议继续保持
ANSI frame + 输入 bytes + resize + lease 的渲染器无关边界，不把 WezTerm mux 协议带到手机端。

## 8. NayiApp 成熟基线复用

首个工程基线位于同工作站的 `reactNative/NayiApp`。Hara Mobile 已使用相同的 React Native 0.86.2
New Architecture 创建独立原生工程，并复用其中已经通过生产验证的组织方式：

- React Navigation 7 的类型化导航与完整字体主题，避免导航组件因字体字段缺失崩溃；
- React Query 的查询缓存，以及对非幂等 mutation 默认不自动重放的安全口径；
- MMKV 的偏好持久化、系统/浅色/深色三态主题与首帧恢复；
- Safe Area、React Native Screens、手势系统、原生 iOS/Android 构建和 Jest/TypeScript 验证链；
- 动画分段选择器、语义色板、卡片层级与中文可读性等成熟交互范式。

以下内容不得从 NayiApp 复制：`.env*`、服务域名、账号 Token、签名/发布资料、支付与微信 SDK、
埋点标识、玄学业务模块、用户数据和历史构建产物。Hara 使用独立包名 `tech.nanhara.hara`、独立
Keychain/Keystore 命名空间和独立后端协议。复用指工程能力和经过验证的交互算法，不形成两款
产品之间的运行时数据或账号耦合。
