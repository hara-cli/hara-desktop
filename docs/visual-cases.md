# Visual cases and evidence

The Hara-owned registry is `test/visual-cases.json`. It defines nine scenarios across
runtime selection, login recovery, errors/diagnostics and group conversations.
Existing component fixtures are reused. Diagnostic summaries and folded
interjections remain pending on the initial source baseline; a registered case
does not mean that its feature is implemented.

## Focused capture

Use the repository-pinned Node and an initialized task directory. Keep all
temporary data and evidence in that task. Reuse locked dependencies without
copying an existing dependency tree. Commit source before capture: the collector
rejects tracked changes and untracked source, and checks source identity again
before writing each receipt.

```sh
node scripts/visual-case-registry.mjs list
node scripts/workspace-visual-cases-smoke.mjs /absolute/task/evidence/visual /absolute/task/scratch
node scripts/visual-case-registry.mjs report /absolute/task/evidence/visual
```

The smoke starts its own Vite server on a dynamically assigned IPv4 loopback
port and an isolated headless Chrome profile. It imports the actual components
through the registered development-only fixtures. It does not start Core,
Tauri, authenticate, run CLI login, access a system credential store or send
external messages. Browser traffic is restricted to its owned Vite origin.
The original user browser, user data and real Hara home are not attached.
It cleans up only its own server/browser. An existing receipt is not overwritten;
choose a new evidence directory for a new run.

Each capture stores its assertions, PNGs, file sizes and SHA256 hashes. Source
SHA, data source, capture surface and pending visual-review state are separate
fields. A JSON and Markdown report include every case, including those without
captures. Missing/changed artifacts are invalid, and a different SHA or dirty
tree makes evidence stale. An execution failure does not become a passed receipt.

## Evidence boundaries

Three independent evidence lanes exist for every case:

| Lane | State data | Surface | What a passed check means |
| --- | --- | --- | --- |
| `fixture-browser` | Synthetic fixture | Headless browser | Listed DOM/interaction assertions passed and PNGs were captured. |
| `isolated-core-browser` | Real Core in an isolated environment | Browser | That separately attributed Core/browser run passed its recorded assertions. |
| `native-core` | Real Core in an isolated environment | Native package | That separately attributed exact package passed its recorded assertions. |

All automated receipts keep `visualReview: pending`. Inspect screenshots and
record a separate reviewer note bound to the receipt digest; automated assertions
alone never mean "UI accepted". A lock screen or unavailable capture must be
recorded as pending with its reason; do not manufacture a successful screenshot.

The future real-Core/native collector can call `saveEvidence` with an explicit
capture method and its own observed artifacts. It must supply the full Desktop
and Core SHAs, isolated-environment check metadata, and for native captures the
exact package SHA256. Checks must identify the same case, method and source SHA
and explicitly declare whether they are synthetic. The registry validates these
declarations and artifact integrity; it does not independently authenticate a
caller-supplied Core run. Audit the collector and environment before accepting
that lane. It cannot relabel a fixture receipt as real Core or promote browser
evidence into native acceptance.

Do not feed raw logs, credentials, user content or private configuration into
check artifacts. Keep screenshots/evidence private and outside the public
repository. This registry adds no CI, release, signing or publishing authority.

## Extending coverage

Add a stable case ID, a concrete scenario, expected behavior and either a
localhost-only fixture or a precise pending reason. The collector's case-specific
actions must use real components and bounded checks. Integrate reviewed source
before implementing the diagnostic-summary and interjection-fold cases; do not
mock an absent product feature into passing. Add focused provenance/negative
tests when changing the evidence contract.
