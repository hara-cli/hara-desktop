# Hara 同事用量真源与 runtime 分账契约

> 2026-10-29 · 刀0～4。此页定义按账号分账、派前读窗与只读界面投影；不授权自动换号、计费或发布。

## 归属与读窗

每位同事先确定其已保存的角色绑定，再解析 `runtimeId`，最后解析该 runtime 的账号 `connectionId`。读窗键为 `(runtimeId, connectionId)`；供应商名、模型名、同事名都不能代替这个键。同一供应商的两个 connection 必须独立。

| 绑定 runtime | 用量权威源 | Hara 自管额度 |
| --- | --- | --- |
| 默认内建 Pi (`pi`) | 该 Pi connection 对应的厂商 API 或企业 Control 原生窗；无权威接口时为 unknown | 只适用于这条默认 Pi 路径 |
| `opencode`、`codex`、`claude` 或其他外部 runtime | 各 runtime 自己的账号窗或经授权的只读采集；未接通时为 unknown | 不适用；外部用量不得写进 Hara-Pi 账 |
| 旧兼容 `hara` runtime | 其绑定 connection 的现有 provider/Control 读窗；无绑定时为 unknown | 不得推定为默认 Pi 额度 |

读窗投影只包含 `runtimeId`、`connectionId`、权威源、`available | exhausted | unknown`、`fresh`、采集时间及可选的原生 `resetAt`。`fresh` 由权威源给出的有效期判断；过期、缺失、身份不匹配或采集失败一律投影为 `unknown`，不能把传输 token、错误率或缺失数据换算成余额，也不能把 unknown 表示成“有额度”。保留原生计量单位与窗口，不创造跨厂商总积分。

调度层只能在**派前读取**当前同事绑定 runtime 的账号窗。它不能写用量、不能汇总所有同事为一个总闸或总积分账本。权威窗新鲜且 `exhausted` 时拒绝派给该同事，并在流内说明换同事或稍后再试；有未来 `resetAt` 时仅提示时间，不自动续跑。`unknown` 继续现有执行路径，但界面明确显示「用量暂不可查」，绝不显示「可用」。`rate_limit` 与 `quota_exhausted` 继续区分。

## 首次安装与建同事交界

首次安装的默认同事使用内建 Pi，因而只读其已选 connection 对应的 Pi 用量窗。建同事仍由主同事提议并经人确认；新同事绑定默认 Pi 时沿用同一规则。外部执行器仅在将来另行批准并实现 governed binding 后，才能读取它自己的 runtime 账号窗。界面不提供把引擎当作「共享额度池」的下拉，也不因芯片颜色自动切换同事或账号。

Core 的采集入口由可信 Host 注入；无原生权威适配器、读取失败或过期时都是 `unknown`。目前本刀没有替第三方账号建立原生采集授权；这些账号不会被推定为有余额。芯片与 attention 仅投影 Host 缓存，不形成第二调度器。

## 工程边界

- Core 的 runtime 绑定真源为 `src/agent-runtime/bindings.ts`；`src/agent-runtime/usage.ts` 只接受显式的 runtime/connection 绑定与对应账号快照，拒绝跨 runtime 或跨 connection 借窗。
- Desktop 的 `src/agent-runtime-usage.ts` 从同事 `AgentInfo.runtime` 读取同一身份；它只构造展示/后续派前读模型，绝不写用量或授权派活。
- 现有 saved connection、厂商原生计量与安全切换规则见 [MODEL_CONNECTION_QUOTA_FAILOVER.md](MODEL_CONNECTION_QUOTA_FAILOVER.md)。Core 权威源形状见 `hara-cli/src/providers/accounting.ts`；撞错分类及已有 failover 见 `hara-cli/src/agent/failover.ts`。
- 建同事、首装 OpenMaus 与执行 Raft 的既定选择保持；本页不改变人确认。

用户可见文案使用「Hara 同事」或「同事」，不将 runtime/账号窗等工程字段直接当作产品文案。
