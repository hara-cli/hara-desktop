# Hara continuous product backlog

This file is the durable continuation list for product work discussed in Hara sessions. It complements
issue-specific Feishu threads: Feishu is the intake and release-closure channel, while this document keeps
cross-repository work from disappearing when a session or release ends.

Status vocabulary: **active**, **next**, **planned**, **verify**, **done**. A task is not **done** until its
relevant tests and user-facing release have been verified.

## Active release train — model connections and feedback

| Status | Work | Repositories / acceptance |
|---|---|---|
| verify | Fix the 0.153.1 MiniMax-M3 run that exhausted all 64 Agent rounds in about 2.9 minutes while editing a Bilibili comment-ingestion script. Do not recommend raising `maxAgentRounds`; detect strategy churn even when each nominally successful command differs, preserve the last useful checkpoint, and show a concise recovery action instead of the raw English engine diagnostic. | `hara-cli`, `hara-desktop`; reproduce with changing-but-equivalent tool calls, stop/nudge before 64 rounds, and close the original Feishu report only after a verified release. |
| verify | Fix the 0.153.1 long-task context guard that reduced even the newest narrow `read_file`/command evidence, then let MiniMax-M3 misclassify Hara's historical-output marker as an external user dependency. The Agent must page or narrow its own reads and must never ask the user to open another conversation, run Hara's script, or paste Hara's own output. | `hara-cli`, `hara-desktop`; preferentially retain the newest tool round, reject tool/history truncation as `awaiting_user`, present a recoverable Agent-owned continuation, and close the original Feishu report only after a verified release. |
| verify | Remove the legacy secondary image-model route. Attachments, screenshots, and image tools must use the selected conversation model only; a text-only model asks the user to switch and never silently sends context to Qwen or another provider. | `hara-cli`, `hara-desktop`; native and unsupported paths covered by regression tests. |
| verify | Add MiniMax Token Plan as a first-class connection. Official Codex route uses `https://api.minimaxi.com/v1`, Responses transport, `MiniMax-M3`, native image input, and adaptive thinking. Keep the endpoint visible. | `hara-cli`, `hara-desktop`; connection test, model discovery/fallback, image capability and request-shape tests pass. |
| verify | Simplify model setup to **choose plan/provider → enter Key → choose model → chat**. Protocol is an advanced transport detail, not the primary navigation. Keep a custom endpoint/model escape hatch. | `hara-desktop`; no long preset rail, no manual model ID required for known plans, keyboard and screen-reader states remain clear. |
| verify | Fix current Feishu UI feedback: MiniMax-M3 must not show “no image”; light mode must not retain a dark provider rail; selected-model text and settings typography must remain legible. | `hara-desktop`; focused UI regressions plus light/dark visual smoke. |
| verify | Replace raw authentication-expiry diagnostics with a recoverable task state: “需要重新登录”, retained progress, trusted re-login action, explicit preflight-and-resume, and technical details behind disclosure. Never render or open model-supplied auth URLs. | `hara-desktop`, `hara-cli`; expired/refreshed/retry paths covered without repeated model or tool consumption. |

## Next architecture — company data with independent model funding

| Status | Work | Acceptance |
|---|---|---|
| next | Decouple `spaceId` (data/Agent/project authority) from `connectionId` (provider/model/credential/billing). | A company project can remain company-owned while an authorized member chooses a personal BYOK connection; personal credentials never grant company access. |
| next | Add organization policy `personalModelConnections = deny | allow | requireApproval`, with provider/model/endpoint/region restrictions and audit attribution. | Company administrators control data-egress policy; existing sessions stay pinned and never silently reroute. |
| next | Add a clear “模型来源/费用” selector: company-provided or one of “我的连接”, with a badge such as “公司数据 · 个人计费” and an explicit disclosure before company context reaches a personal provider. | Usage records distinguish organization spend from personal BYOK; company conversation/files remain company-owned. |
| next | Support personal and multiple-company workspaces with Feishu-style company switching. | Active company, project, Agent, data authority, and editable permissions are always visible; switching never mixes histories or credentials. |
| planned | Keep PostgreSQL and organization persistence server-side. Desktop must not install or require PostgreSQL. | A fresh client works with local client state plus Control APIs only. |

## Agent identity, management, and conversation UX

| Status | Work | Acceptance |
|---|---|---|
| next | Make Agent selection a first-class dimension alongside project/directory selection. | A user can select an Agent in Desktop and chat immediately; Feishu routing can address the same Agent unambiguously. |
| next | Replace the mixed history tree with a message-center flow: Agent/project conversation list first, then a focused history view with an obvious back action. | Personal, company, project, Agent, and archived sessions remain understandable at a glance. |
| next | Add complete Agent identity: immutable unique handle, editable nickname, avatar/logo, generated bio, personality, skills, and greeting. | Right-click/context menu exposes allowed edits; company-owned Agents are editable only by authorized administrators. |
| next | Complete lifecycle and permissions: create/generate, preview, hire, assign to a department/project, edit, suspend, and delete/archive. | Destructive actions are recoverable or confirmed; company policy and audit are enforced. |
| next | Expand the Agent talent market beyond IT. Import the remaining reviewed agency blueprints and add finance, sales, HR, operations, legal/compliance, customer success, marketing, research, and industry-specific roles. | Catalog has provenance, capability/permission disclosures, search/filtering, and no near-duplicate anonymous characters. |
| planned | Give characters visually distinct, reusable identities. Prefer a coherent illustrated/cartoon art direction over unrelated photorealistic faces; generation must preserve style, diversity, and attribution/provenance. | Each Agent is recognizable at small sizes in lists and office scenes; user/company custom avatars remain supported. |

## Game-like office and overall visual system

| Status | Work | Acceptance |
|---|---|---|
| next | Treat the office as an integrated work surface, not a separate skill: click a character to chat, inspect work/status, or open allowed management actions. | Game interaction and real project execution share one Agent/session model; no decorative dead-end scene. |
| next | Use department-based rooms/offices with an office switcher instead of crowding every Agent into one canvas. Start from a polished 2D comic mode; keep 3D as an optional later view after asset quality and performance gates. | Characters do not overlap, departments scale, camera/zoom and keyboard navigation work, and dense organizations remain usable. |
| next | Define complete dark and light art directions for Chat, Settings, Agent market, office, and company switching. | Both themes pass contrast and minimum-type-size checks; the game surface still feels like Hara rather than a detached mini-game. |
| planned | Evaluate the local `ai-office` and `GOD` reference repositories, plus license-compatible game/office assets, as references rather than code to copy blindly. | Record license, security, performance, and architectural fit before reuse; do not use uncertain Free3D assets in a release. |

## Agent behavior and continuous improvement

| Status | Work | Acceptance |
|---|---|---|
| next | Correct “chatbot-like” behavior: when authorized and capable, the Agent executes the task instead of routinely telling the user how to do it. | Evaluation traces distinguish execution, approval-required work, true blockers, and advice-only requests. |
| next | Add controlled self-improvement across user execution and business learning. | Learnings are evidence-linked, scoped to personal/company/project authority, reviewable, reversible, privacy-safe, and evaluated before promotion into durable instructions or memory. |
| planned | Surface what is consuming tokens: foreground turns, compaction/summaries, Agent delegation, scheduled/monitor jobs, memory extraction, retries, and background connectors. | Per-session/provider usage is attributable; idle Desktop does not silently consume model tokens. |

## Provider and operational follow-through

| Status | Work | Acceptance |
|---|---|---|
| verify | Recheck the current DeepSeek integration, including Responses/Chat transport, model listing/balance/file APIs where in product scope, native visual understanding, personal and company-Control catalogs, and a current 100M-token cost comparison. | Official documentation is the source of truth; unsupported or non-public visual models are never advertised as generally available. |
| verify | Browser Use is already built in; confirm it is exposed as a governed system skill with correct permissions and no duplicate installation flow. | The capability works in a real Agent task and follows browser security/approval boundaries. |
| planned | Continue the Feishu acknowledgment → diagnosis → verified-release closure workflow for every Hara report. | The original message receives both acknowledgment and fixed-version follow-up; every release also posts a group notice with upgrade and focused checks. |
