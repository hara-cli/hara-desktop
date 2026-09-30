# Hara Desktop brand assets

`hara-mark.svg` is an exact generated copy of the canonical Hara vector at
`../hara-web/brand/hara-logo-v3-imagegen/source/hara-mark.svg` in the shared workspace.
Do not edit this copy or generated icon files by hand.

Run the central installer from `hara-web/brand/hara-logo-v3-imagegen` to synchronize all
products, or run `bash scripts/generate-brand-assets.sh` after this local master has
been synchronized. The script copies the SVG into the Vite bundle, creates the
transparent rounded Desktop icon source, and lets Tauri generate macOS, Windows,
Linux, Android, and iOS derivatives.

macOS uses a separate generated source, `hara-macos-icon.png`: the 1024px generic
canvas is scaled to 856px and centered on a transparent 1024px canvas. Its visible
surface is approximately 824px wide (80.5% of the canvas), about 16% smaller than
the generic export. Only `src-tauri/icons/icon.icns` is replaced from this source;
Windows, Linux, Android, and iOS retain their existing platform exports. This fixes
the oversized Dock/Launchpad appearance without changing the canonical mark.
Regenerate rather than editing either PNG or the ICNS by hand.
The generator also canonicalizes ICNS entry order without changing pixels, so
repeated exports have identical bytes even when Tauri emits frames in a different order.

The mark uses Hara Coral `#FF6B5C`; the Desktop icon surface uses Hara Ink `#131316`
with a subtle `#2A2A30` edge. Platform output files are committed release resources.
