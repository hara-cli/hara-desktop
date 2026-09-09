# Hara Desktop brand assets

`hara-mark.svg` is an exact generated copy of the canonical Hara vector at
`../hara-web/brand/hara-logo-v3-imagegen/source/hara-mark.svg` in the shared workspace.
Do not edit this copy or generated icon files by hand.

Run the central installer from `hara-web/brand/hara-logo-v3-imagegen` to synchronize all
products, or run `bash scripts/generate-brand-assets.sh` after this local master has
been synchronized. The script copies the SVG into the Vite bundle, creates the
transparent rounded Desktop icon source, and lets Tauri generate macOS, Windows,
Linux, Android, and iOS derivatives.

The mark uses Hara Coral `#FF6B5C`; the Desktop icon surface uses Hara Ink `#131316`
with a subtle `#2A2A30` edge. Platform output files are committed release resources.
