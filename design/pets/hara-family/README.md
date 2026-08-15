# Hara official companion family

The official family is one recognizable Hara character with eleven role variants. Every variant keeps
the same head, eyes, ear geometry, body proportions, vermilion Hara badge, frame registration, and
motion vocabulary. Identity comes from bounded wearable details and a secondary accent, never from
detached props, text, or a different species.

## Canonical character

- Form: compact anthropomorphic bear-cub/helper robot derived from the Hara mark.
- Style: premium 3D designer toy with a subtle plush surface.
- Primary palette: Hara coral `#ff655c`, near-black `#141417`, warm off-white.
- Runtime target: Codex/Hara v2 atlas, `1536x2288`, eight columns, eleven rows, `192x208` cells.
- Source reference: `reference/hara-master-chroma.png`.

## Public collection

| ID | Display name | Role | Secondary accent | Wearable identity cue |
| --- | --- | --- | --- | --- |
| `hara-core` | 小哈 · 核心 | General Hara companion | coral | canonical suit, no extra accessory |
| `hara-forge` | 造造 · 开发 | Code and build work | amber | compact utility harness and reinforced cuffs |
| `hara-muse` | 灵灵 · 设计 | Product and visual design | violet | asymmetric creative collar and ear inlays |
| `hara-scout` | 探探 · 研究 | Search and research | sky blue | integrated forehead sensor and ear modules |
| `hara-ledger` | 数数 · 数据 | Tables, analysis, and charts | teal-blue | tidy segmented side panels and wrist bands |
| `hara-story` | 文文 · 文档 | Writing and documents | warm ivory | soft folded collar and sleeve tabs |
| `hara-stage` | 演演 · 演示 | Presentations and storytelling | indigo | presenter lapel and shoulder light panels |
| `hara-flow` | 流流 · 自动化 | Workflows and operations | electric blue | connected circuit seams printed into the suit |
| `hara-shield` | 守守 · 审核 | Security and review | steel | compact shoulder armor and guarded cuffs |
| `hara-link` | 联联 · 连接 | Apps, messages, and integrations | cobalt | attached headset band and side-node accents |
| `hara-cozy` | 暖暖 · 陪伴 | Ambient companion mode | warm cream | plush hood rim and soft mitten cuffs |

## Visual constraints

- Preserve the canonical face and body silhouette in all variants and animation rows.
- Keep the Hara badge coral and clearly readable at pet size.
- Accessories must remain attached to the body and survive left/right motion and 16 look directions.
- Do not add held tools, floating symbols, motion lines, scenery, shadows, labels, or readable text.
- Use a chroma color absent from the selected character palette; deterministic atlas processing owns
  transparency, registration, cell geometry, and final validation.
- Public Desktop integration must use code-owned, read-only assets. Local Codex packages remain a
  compatibility source and are never silently copied or rebranded.

## Current Desktop delivery

- The eleven transparent renders under `public/pets/hara-official` are the shipped first-party
  collection. Desktop applies its bounded status motion (idle, running, waiting, paused, ready, and
  blocked) without evaluating character-owned code.
- These renders are not v2 sprite packages and must not be presented as such. The v2 atlas remains
  the animation-quality target for a later deterministic generation and validation pass.
- The chroma sources under `concepts` are retained as design inputs, not runtime assets.
- Provenance: generated for Hara on 2026-08-15 from the repository's Hara application icon with
  OpenAI image generation, then role variants were curated against the canonical identity above.
