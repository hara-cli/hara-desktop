# Hara Desktop Learnings

## [LRN-20260825-AGENT-PORTRAIT-SILHOUETTES] correction

**Logged**: 2026-08-25T02:50:00+08:00
**Priority**: high
**Status**: in_progress
**Area**: frontend

### Summary

Color, initials, and small accessories do not create enough identity; Hara Agents need recognizably
different faces, silhouettes, expressions, clothing, and occupational props.

### Details

The current procedural `AgentPortrait` makes market candidates feel like one template with palette
swaps. Generated character art must use one coherent Hara comic art direction while preserving strong
per-Agent identity, and the same stable character asset must appear in the market, profile, chat, and
office instead of being regenerated per surface.

### Suggested Action

Define a character art bible first, generate a reviewed portrait for every curated blueprint, store the
assets locally with immutable blueprint mapping, and keep a deterministic procedural fallback for old,
external, custom, and offline Agents. Treat photorealistic faces as an opt-in future theme, not the
default product identity.

### Progress

Finance `Ledger`, Sales `Radar`, and People `Scout` now have three reviewed, visibly distinct comic
portraits shared by the market, hire dialog, chat/profile identity, and office character head. Remaining
curated portraits should follow these masters; community portraits should be generated and persisted at
hire time rather than bundled eagerly.

### Metadata

- Source: user_feedback
- Related Files: src/AgentPortrait.tsx, src/AgentCharacter.tsx, src/talent-blueprints.ts, src/TalentMarket.tsx
- Tags: agents, identity, avatars, comic, consistency
- Pattern-Key: frontend.agent_identity_requires_distinct_stable_silhouettes
- Recurrence-Count: 1

---

## [LRN-20260825-RELEASE-PROCESS-COMMAND-LINE] best_practice

**Logged**: 2026-08-25T12:42:00+08:00
**Priority**: high
**Status**: resolved
**Area**: infra

### Summary

Do not inspect full signing-process command lines while monitoring a release; Apple notarization and
similar tools may place credential-related identifiers or protected file locations in their arguments.

### Details

Actions job and step status already provide enough evidence to distinguish queued, building, signing,
notarizing, promoting, and public-edge verification states. A full `ps ... command` probe adds no
release assurance and can surface metadata that must then be redacted from every downstream update.
Executable basenames alone prove liveness but do not identify the exact substage: the same `node`, `gh`,
or `curl` names can belong to initial transfer, digest-cache reconciliation, API fallback, policy reads,
or publication. Do not turn a process-name transition into a completion claim.

### Suggested Action

Monitor the protected release through bounded GitHub Actions job/step JSON only. If local liveness is
needed, inspect PID, parent PID, elapsed time, and executable basename without the argument vector.
Describe that evidence only as liveness; never infer a narrower stage from it. Never copy
signing-process arguments into commentary, notes, Feishu, or release reports.

### Metadata

- Source: error
- Related Files: WORKFLOW.md, .github/workflows/build.yml
- Tags: release, observability, credentials, signing, redaction
- Pattern-Key: release.monitor_steps_without_process_argument_vectors
- Recurrence-Count: 1

---

## [LRN-20260825-TALENT-MARKET-INDUSTRY-BREADTH] correction

**Logged**: 2026-08-25T02:52:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary

A talent market seeded mainly with engineering roles reads as an IT-only product; the complete
cross-industry catalog must remain discoverable without weakening curation honesty.

### Details

The hand-adapted roles should be the `Hara curated` shelf, not the entire market. Import the full
Agency Agents snapshot as a searchable community tier across all 17 divisions, clearly distinguish
curation/evaluation status, and progressively load results so 270 records do not crowd the UI or main
bundle. Hiring still creates a separate Hara Agent instance with explicit permissions.

### Suggested Action

The implemented catalog contains all 270 upstream roles: 31 Hara-curated blueprints and 239 clearly
marked community blueprints. Finance, Sales, and People/HR are first-class Hara departments, the market
is lazy-loaded, and only 48 candidate cards render initially. Specialist evaluation remains a versioned
promotion path from `community` to `curated`.

### Metadata

- Source: user_feedback
- Related Files: src/talent-blueprints.ts, src/TalentMarket.tsx, scripts/build-agency-talent-catalog.mjs
- Tags: talent-market, industry, catalog, curation, performance
- Pattern-Key: product.talent_market_separates_breadth_from_verified_curation
- Recurrence-Count: 1

---
