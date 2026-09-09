#!/usr/bin/env bash

set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mark_source="${root_dir}/brand/hara-mark.svg"
runtime_mark="${root_dir}/src/assets/hara-mark.svg"
icon_source="${root_dir}/brand/hara-desktop-icon.png"
image_tool="${MAGICK_BIN:-magick}"

if ! command -v "${image_tool}" >/dev/null 2>&1; then
  echo "ImageMagick is required to regenerate Hara Desktop brand assets." >&2
  exit 1
fi

node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
if (( node_major < 22 )); then
  echo "Node 22 or newer is required to run the Tauri icon generator." >&2
  exit 1
fi

mkdir -p "${root_dir}/brand" "${root_dir}/src/assets"
cp "${mark_source}" "${runtime_mark}"

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/hara-desktop-brand.XXXXXX")"
trap 'rm -rf "${temporary_dir}"' EXIT
temporary_mark="${temporary_dir}/mark.png"

"${image_tool}" -background none "${mark_source}" \
  -resize 704x704 \
  "PNG32:${temporary_mark}"

"${image_tool}" \
  -size 1024x1024 canvas:none \
  -fill '#131316' \
  -stroke '#2A2A30' \
  -strokewidth 8 \
  -draw 'roundrectangle 24,24 1000,1000 220,220' \
  "${temporary_mark}" \
  -gravity center \
  -geometry +0+8 \
  -composite \
  "PNG32:${icon_source}"

"${root_dir}/node_modules/.bin/tauri" icon "${icon_source}" -o "${root_dir}/src-tauri/icons"

echo "Generated Hara Desktop runtime mark and Tauri platform icons."
