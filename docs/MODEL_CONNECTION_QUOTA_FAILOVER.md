# Model connection quota and failover design

> Snapshot: 2026-09-05. This document distinguishes provider-authoritative data from local estimates.

## 1. Provider support matrix

| Provider / plan | Official usage source | Credential boundary | Desktop display |
| --- | --- | --- | --- |
| DeepSeek API | `GET /user/balance` returns availability and currency balances | Normal inference credential | Authoritative balance and last refresh |
| MiniMax Token Plan | `GET /v1/token_plan/remains` returns rolling plan allowance | Token Plan credential; not interchangeable with PAYG key | Authoritative request allowance/window and last refresh |
| OpenAI API | Organization Usage and Costs APIs | Separate Admin API Key; never elevate the inference key | Only after the user separately supplies an admin credential; otherwise local usage |
| Anthropic API | Admin Usage/Cost report, groupable by API key/workspace/model | Separate Admin Key | Only after separate admin credential; otherwise local usage |
| Alibaba Coding Plan | Console currently documents the plan usage view, not a client quota API | Coding Plan key is restricted to supported coding tools | Local session/request estimate + open-console link |
| Volcengine Agent Plan | Console usage and delayed detail are documented; no stable client quota API is documented | Agent Plan credential | Local session/request estimate + open-console link; show that detailed billing can be delayed |

Official references:

- DeepSeek balance: <https://api-docs.deepseek.com/zh-cn/api/get-user-balance/>
- DeepSeek error codes: <https://api-docs.deepseek.com/zh-cn/quick_start/error_codes/>
- MiniMax Token Plan FAQ: <https://platform.minimaxi.com/docs/token-plan/faq>
- OpenAI organization usage API: <https://platform.openai.com/docs/api-reference/usage>
- Anthropic Admin usage report: <https://docs.anthropic.com/zh-CN/api/admin-api/usage-cost/get-messages-usage-report>
- Alibaba Coding Plan: <https://help.aliyun.com/zh/model-studio/coding-plan>
- Volcengine Agent Plan local provider guide: [`ark-agent-plan.md`](../../provider_docs/ark-agent-plan.md)

“No documented API” must not be rendered as zero remaining. The UI says “供应商未提供可查询余额接口” and
separately shows Hara-observed token/request totals.

## 2. Connection-level quota adapter

Quota belongs to a saved **connection**, not just a provider name or model. Two accounts from the same provider
must have independent quota, health, and refresh state.

```ts
type QuotaSupport =
  | 'live'
  | 'console_only'
  | 'admin_credential_required'
  | 'local_estimate_only'
  | 'unavailable';

type ConnectionQuota = {
  connectionId: string;
  support: QuotaSupport;
  available?: boolean;
  remaining?: Array<{ unit: 'currency' | 'requests' | 'tokens'; value: number; label: string }>;
  windowEndsAt?: string;
  observed?: { inputTokens: number; outputTokens: number; requests: number };
  fetchedAt?: string;
  staleAfter?: string;
  consoleUrl?: string;
  errorCode?: 'unauthorized' | 'rate_limited' | 'provider_unavailable' | 'unknown';
};
```

Admin usage credentials are saved as a separate secret role. They are never sent to inference endpoints and are
never exported into Codex/Claude provider environment variables. Refresh is user-triggered plus conservative
background caching; opening the model menu must not hammer provider APIs.

## 3. Desktop presentation

Each connection row shows one of:

- **余额可查**: authoritative amount/window, provider badge, refresh time, and stale indicator;
- **仅本次统计**: Hara-observed tokens/requests, explicitly not called remaining quota;
- **需管理凭据**: optional setup entry for OpenAI/Anthropic administrators;
- **去控制台查看**: safe external link for Alibaba/Volcengine;
- **暂不可用**: reason and retry action without exposing provider response bodies.

The active session keeps its own token counters regardless of quota API availability. Historical usage is keyed
by immutable connection ID so deleting a saved secret does not erase audit totals; the UI can show a tombstoned
connection label without restoring the secret.

## 4. Explicit failover groups

Automatic switching is disabled by default. A user may create an ordered failover group of compatible saved
connections, including multiple accounts at the same provider. Creating the group requires consent that the same
prompt/data may be sent to another provider or region.

Selection gates:

1. connection is enabled, authorized, and not circuit-open;
2. target supports required image/video/text modality, tool protocol, context size, and reasoning controls;
3. target satisfies Personal/enterprise realm, data-region, retention, and administrator policy;
4. model aliases resolve to a deliberately selected compatible model, never an unrelated audio/image-generation model;
5. quota is either authoritative and available, or unknown with user permission to attempt it.

Enterprise sessions can only fail over to Control-approved enterprise routes. They never fall back to a Personal
API key. A Personal session does not silently enter an enterprise route either.

## 5. Safe switching boundary

Failover is allowed only before a model attempt emits visible output, requests/executes a tool, writes a file, or
causes any external side effect. After that boundary the runtime reports the failure and asks the user what to do.

Definitive triggers:

- provider-specific insufficient quota/balance response (for example DeepSeek `402`);
- bounded rate-limit retries exhausted, only when the adapter can distinguish quota exhaustion from a short burst;
- transport/5xx failure after the connection's central retry policy is exhausted and no output/side effect occurred.

Authentication failures do not auto-switch: they may indicate a revoked/compromised or incorrectly routed
credential and require explicit attention. Provider safety/policy refusals never trigger provider shopping.

Every switch records source connection, destination connection, model mapping, classified reason, attempt count,
and timestamps without prompt bodies or credentials. The conversation remains one Hara task, but each turn exposes
which connection actually served it. Returning to the preferred connection happens only on a later turn after its
cooldown/refresh gate passes.

## 6. Implementation order

1. immutable connection IDs and tombstoned usage history;
2. local per-turn/per-connection usage aggregation;
3. DeepSeek and MiniMax authoritative adapters;
4. separate OpenAI/Anthropic admin-secret roles;
5. console-only adapters for Alibaba and Volcengine;
6. typed model capability matrix and connection health circuit;
7. user-authored failover groups and dry-run compatibility preview;
8. failover execution only after idempotency and side-effect boundary tests pass.
