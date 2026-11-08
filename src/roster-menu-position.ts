/** Place the measured menu below the pointer, flip above it, or clamp a scrollable menu. */
export function rosterMenuPosition(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  const margin = 8, maxHeight = Math.max(0, viewportHeight - margin * 2);
  const visibleHeight = Math.min(height, maxHeight), visibleWidth = Math.min(width, Math.max(0, viewportWidth - margin * 2));
  const below = viewportHeight - margin - y, above = y - margin;
  const desired = height <= below ? y : height <= above ? y - height : y - visibleHeight;
  return { left: Math.max(margin, Math.min(x, viewportWidth - visibleWidth - margin)),
    top: Math.max(margin, Math.min(desired, viewportHeight - visibleHeight - margin)), maxHeight };
}
