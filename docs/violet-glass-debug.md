# Violet Glass UI · local Debug

The production route remains `main.tsx → WorkspaceEntry → WorkspaceLocalDev →
WorkspaceScreen`. The three-column shell and centered Settings modal are implemented
on that route. The native entry decision, Core protocol and sidecar locks are unchanged.

For a fast UI review, run the real `WorkspaceScreen` with an in-memory RPC adapter:

```bash
PATH=/Users/zhujianbo/.nvm/versions/node/v22.23.1/bin:$PATH npm run dev -- --host 127.0.0.1 --port 1445 --strictPort
```

Open <http://127.0.0.1:1445/test/fixtures/violet-glass-preview.html?locale=zh-Hans&theme=dark#workspace>.
Use `theme=light`, or choose a theme in Settings → Appearance. English and Traditional
Chinese use `locale=en` and `locale=zh-Hant`.

This standalone DEV-only, loopback-only fixture imports the production components
and model. It is not a production URL/query fallback and is not a build input.
All data and mutations stay in memory. It never calls a model, Tauri, an updater,
the real account, the filesystem or a candidate workflow. Reload resets the sample.
The isolated browser profile keeps its preferences separate from the installed app.

With that owned Vite server running, the browser regression command is:

```bash
node scripts/violet-workspace-smoke.mjs http://127.0.0.1:1445 /ABSOLUTE/PRIVATE/NEW/EVIDENCE
```

It captures three themes, conversations, schedules, dirty-draft protection and a
compact window; checks scoped skill/schedule updates, retained shell state, focus
trapping/restoration and Inspector controls. Chrome uses a fresh temporary profile
and mock credential storage; it never opens the user's profile or login Keychain.

This is renderer Debug evidence. Native startup, the Tauri bridge, a real Core,
real account/pairing and Jeff's interactive acceptance remain separate. For native
acceptance use the established isolated lane in `local-workspace-dev.md`, with an
owned fixture and reviewed compatible source pins. Do not launch an unconfigured
native app against real `~/.hara`, reuse a dirty build target, alter its source pins,
or turn UI review into a candidate/signing/notarization run.

Current account/pairing remains in the explicit legacy entry. The frozen Workspace
API has no equivalent account client; this UI slice does not invent one or route
model keys into an account page. Migrating that function needs its own API/UI slice.

Visual authority: Violet Glass DS v1.0, approved dark + Daylight screens, three-column
main shell and centered Settings with a left rail. The exact logo fill is `#7C3AED`;
the editable mark and deterministic asset command are documented in `brand/README.md`.

The approved soft-dark refinement uses charcoal surfaces, soft-white text and
muted grey-violet conversation bubbles. Chat fill tokens are separate from the
fixed identity/action violet, so long transcripts do not repeat saturated button
fills. Conversation text is 14px with 1.75 line height. Daylight keeps its light
surfaces and uses a light grey-violet outgoing bubble with dark text. This is a
local visual refinement; it does not claim a measured reduction in eye fatigue.
The upstream design pack remains read-only.
