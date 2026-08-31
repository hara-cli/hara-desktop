# Hara Desktop design system

Hara is a working environment, not a collection of unrelated dashboards. Its visual language is an **editorial operations desk**: warm paper and vermilion by day, graphite and signal light by night. Both themes share one information architecture, one spacing system, and one component tree.

## Theme ownership

- `src/App.css` owns the default dark semantic tokens and shared component foundations.
- `src/theme-light.css` overrides token values for daylight. It must not create a second layout or repair a component with page-specific light selectors.
- Colocated component CSS, such as `src/CapabilityDirectory.css`, consumes semantic tokens only.
- `src/theme.ts` owns the `system | light | dark` preference and applies the resolved `data-theme` value to `<html>`.

When a component looks wrong in one theme, fix the semantic token or remove the hard-coded component color. Do not add another `html[data-theme="light"] .component` exception unless the visual is intentionally theme-specific, such as a preview thumbnail.

## Semantic token contract

| Purpose | Tokens |
| --- | --- |
| Product canvas | `--surface-canvas`, `--surface-sidebar`, `--surface-panel`, `--surface-raised`, `--surface-inset` |
| Interactive surfaces | `--surface-control`, `--surface-hover`, `--surface-selected` |
| Text | `--ink-strong`, `--ink-muted`, `--ink-faint` |
| Borders | `--border`, `--border-subtle`, `--border-control`, `--border-strong` |
| Brand and status | `--accent`, `--accent-strong`, `--accent-soft`, `--success`, `--warning`, `--danger`, `--info` and their `-soft` variants |
| Focus and selection | `--focus-ring`, `--selection-bg`, `--selection-fg`, `--code-selection-bg`, `--code-selection-fg` |
| Shape and depth | `--radius-control`, `--radius-card`, `--shadow-card`, `--shadow-soft`, `--shadow-float` |
| Typography | `--font-sans`, `--font-mono` |

Legacy aliases (`--bg`, `--bg2`, `--bg3`, `--fg`, `--dim`) remain while older surfaces migrate. New UI should use the semantic names above.

## Information hierarchy

1. **Place** — the global rail and active personal/company space answer “where am I?”
2. **Purpose** — a page heading explains the outcome before exposing controls.
3. **Scope** — tabs or segmented navigation change one bounded catalog, never the whole application.
4. **Objects** — cards and rows represent capabilities, Agents, sessions, or settings.
5. **State and action** — status is quiet and persistent; the next action is explicit and visually stronger.

Avoid stacking several dark islands inside a light page or several bright cards inside night mode. A section gets one container; objects inside it get one additional elevation at most.

## Component rules

- Controls are at least 38 px high in primary navigation and have a visible `:focus-visible` state.
- Cards use `--surface-panel`, `--border-subtle`, and `--radius-card`; hover may lift by no more than 2 px.
- Search fields combine an icon and input inside one `--surface-control` shell.
- Status badges never carry the primary action color unless they are actionable.
- Icons come from `src/icons.tsx`, use `currentColor`, and never substitute an emoji for an interface control.
- Component styles must remain usable at 200% zoom and below 820 px width.
- Motion is optional. Every transform or looping animation needs a `prefers-reduced-motion` fallback.

## Accessibility gates

- Normal text targets WCAG AA contrast (4.5:1); large text and essential iconography target at least 3:1.
- Selected text must remain readable on both normal surfaces and deliberate dark code/terminal islands.
- Color is never the only indicator of selection, failure, or connection state.
- Keyboard tab order follows visible reading order; tab lists support arrow, Home, and End navigation.
- Disabled controls remain identifiable and cannot be the sole explanation of why an action is unavailable.

## Capability Center pattern

The Capability Center is a catalog, not a settings spreadsheet:

- source tabs and search share one calm toolbar;
- Hara capabilities use an icon, name, provenance, short outcome, installed state, and one open action;
- the fifth odd card spans the row instead of leaving a dead half-column;
- organization, market, installed packages, and skills keep separate provenance and permission semantics;
- all colors are semantic tokens so daylight and night render the same hierarchy.

## Review checklist

Before merging a UI change:

1. Check light, dark, and system-resolved themes.
2. Check 1280×800, the normal Desktop window, 820 px, and 520 px widths.
3. Tab through every action and verify the focus ring is not clipped.
4. Inspect hover, active, disabled, empty, loading, success, warning, and error states.
5. Select ordinary text and code text; both must remain legible.
6. Run `npm test` and `npm run build` with the repository-pinned Node runtime.
