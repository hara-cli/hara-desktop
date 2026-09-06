# Model connection usage, entitlement, and failover design

> Corrected 2026-09-06. Hara may normalize presentation, but it never normalizes different providers'
> subscription formulas into one Token or currency calculation.

## 1. Provider support matrix

| Provider / plan | Official usage source | Credential boundary | Desktop display |
| --- | --- | --- | --- |
| DeepSeek API | `GET /user/balance` returns provider balance availability and currency balances | Normal inference credential | Provider-authoritative balance and last refresh; no token-to-currency conversion in Hara |
| MiniMax Token Plan | `GET /v1/token_plan/remains` returns that plan's native rolling allowance | Token Plan credential; not interchangeable with PAYG key | Provider-native meter/window and last refresh, without conversion to another plan's units |
| OpenAI API | Organization Usage and Costs APIs | Separate Admin API Key; never elevate the inference key | Authoritative usage/cost only after separately authorized admin access; it is not assumed to be a remaining subscription allowance |
| Anthropic API | Admin Usage/Cost report, groupable by API key/workspace/model | Separate Admin Key | Authoritative usage/cost only after separately authorized admin access; it is not assumed to be a remaining subscription allowance |
| Alibaba Coding Plan | Console currently documents the plan usage view, not a client quota API | Coding Plan key is restricted to supported coding tools | “Go to provider console”; Hara transport telemetry stays separate and is never presented as remaining plan allowance |
| Volcengine Agent Plan | Console is authoritative for the account's plan and native meters | Agent Plan credential | “Go to Ark”; Hara transport telemetry stays separate and is never converted to Fuel Points, cost, or remaining allowance |
| Hara Enterprise Gateway | Control-selected upstream adapter: provider subscription API, PAYG ledger, administrator policy, or unavailable | Device credential reaches Control only; upstream credentials remain server-side | Control-authoritative native meters and source; never a Desktop-side universal calculation |

Official references:

- DeepSeek balance: <https://api-docs.deepseek.com/zh-cn/api/get-user-balance/>
- DeepSeek error codes: <https://api-docs.deepseek.com/zh-cn/quick_start/error_codes/>
- MiniMax Token Plan FAQ: <https://platform.minimaxi.com/docs/token-plan/faq>
- OpenAI organization usage API: <https://platform.openai.com/docs/api-reference/usage>
- Anthropic Admin usage report: <https://docs.anthropic.com/zh-CN/api/admin-api/usage-cost/get-messages-usage-report>
- Alibaba Coding Plan: <https://help.aliyun.com/zh/model-studio/coding-plan>
- Volcengine Agent Plan local provider guide: [`ark-agent-plan.md`](../../provider_docs/ark-agent-plan.md)

“No integrated authoritative API” must not be rendered as zero remaining and must not be replaced by a local
estimate. The UI says “供应商未提供可查询余额接口” and may separately show Hara-observed request transport
tokens for context diagnostics, with no balance/cost label.

## 2. Connection-level quota adapter

Quota belongs to a saved **connection**, not just a provider name or model. Two accounts from the same provider
must have independent quota, health, and refresh state.

```ts
type UsageSupport =
  | 'provider_api'
  | 'organization_control'
  | 'console_only'
  | 'admin_credential_required'
  | 'not_applicable'
  | 'unavailable';

type NativeMeter = {
  id: string;
  label: string;
  // Provider-defined: credits, requests, currency, points, seats, or a future native unit.
  unit: string;
  used?: number | string;
  remaining?: number | string;
  limit?: number | string;
  window?: string;
  resetAt?: string;
};

type ConnectionUsage = {
  connectionId: string;
  authority: 'provider' | 'organization' | 'local';
  mode: 'subscription' | 'provider_defined' | 'managed' | 'local';
  support: UsageSupport;
  // Safe local diagnostics. These fields never determine billing, entitlement, or failover.
  transport?: { inputTokens: number; outputTokens: number; requests: number };
  allowance?: {
    source: 'provider_api' | 'organization_control';
    availability: 'available' | 'exhausted' | 'unknown';
    authoritative: boolean;
    meters: NativeMeter[];
    fetchedAt: string;
    // Adapter-owned freshness boundary; required for unattended switching.
    validUntil?: string;
  };
  consoleUrl?: string;
  errorCode?: 'unauthorized' | 'rate_limited' | 'provider_unavailable' | 'unknown';
};
```

Admin usage credentials are saved as a separate secret role. They are never sent to inference endpoints and are
never exported into Codex/Claude provider environment variables. Refresh is user-triggered plus conservative
background caching; opening the model menu must not hammer provider APIs.

## 3. Desktop presentation

Each connection row identifies its accounting authority first, then shows one of:

- **厂商原生额度**: authoritative native amount/window/unit, provider badge, refresh time, and stale indicator;
- **企业 Control 额度**: Control's upstream source and native meter labels, without Desktop-side conversion;
- **会话传输统计**: Hara-observed input/output tokens and requests for context diagnosis only, never called
  spend, credits, Fuel Points, balance, or remaining quota;
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
5. allowance is either fresh and authoritatively available, or unknown with explicit user permission to attempt
   the route; unknown is never rewritten as a numeric balance.

Enterprise sessions can only fail over to Control-approved enterprise routes. They never fall back to a Personal
API key. A Personal session does not silently enter an enterprise route either.

## 5. Safe switching boundary

Failover is allowed only before a model attempt emits visible output, requests/executes a tool, writes a file, or
causes any external side effect. After that boundary the runtime reports the failure and asks the user what to do.

Definitive exhaustion triggers:

- a fresh provider/Control usage adapter explicitly reports `exhausted` in that plan's native semantics;
- a provider-specific insufficient quota/balance response mapped by that provider adapter (for example DeepSeek
  `402`), before any visible output or side effect.

Rate limiting, transport failure, and 5xx responses are health/failover signals, not proof that a subscription is
used up. They may use a separately enabled availability failover policy after bounded retries, but the UI must not
label that reason “额度已用尽”.

Authentication failures do not auto-switch: they may indicate a revoked/compromised or incorrectly routed
credential and require explicit attention. Provider safety/policy refusals never trigger provider shopping.

Every switch records source connection, destination connection, model mapping, classified reason, attempt count,
and timestamps without prompt bodies or credentials. The conversation remains one Hara task, but each turn exposes
which connection actually served it. Returning to the preferred connection happens only on a later turn after its
cooldown/refresh gate passes.

## 6. Managed connection rule

Company-managed does not imply one Hara billing algorithm. Control may route through a vendor subscription, a
PAYG gateway ledger, a prepaid balance, or an administrator-authored non-financial limit. Each upstream adapter
owns the mapping from vendor responses to native meters and `available/exhausted/unknown`. Control returns the
source and freshness with that decision; Desktop displays it and never recalculates it from session tokens.

An organization may additionally impose its own RPM, TPM, request, time, or spend policy. That policy is a second
explicit boundary and must not overwrite the upstream subscription meter. When either boundary denies admission,
the recorded reason identifies which authority made the decision.

## 7. Implementation order

1. immutable connection IDs, tombstoned history, and separate transport/accounting records;
2. accounting-authority metadata in the CLI/Desktop connection protocol;
3. DeepSeek and MiniMax provider-native adapters;
4. a Control adapter that preserves upstream provider/plan meters and separately reports organization policy;
5. separate OpenAI/Anthropic admin-secret roles;
6. console-only adapters for Alibaba and Volcengine, with no local allowance estimate;
7. typed model capability matrix and connection health circuit;
8. user-authored failover groups and dry-run compatibility preview;
9. failover execution only after authoritative-exhaustion, idempotency, and side-effect-boundary tests pass.
