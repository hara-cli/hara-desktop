const NATIVE_CONTEXT_MENU_TARGETS = [
  "input",
  "textarea",
  "[contenteditable]:not([contenteditable='false'])",
  "a[href]",
  "[data-native-context-menu='true']",
].join(", ");

export function shouldSuppressAppContextMenu(target: EventTarget | null, selectedText: string): boolean {
  if (selectedText.trim()) return false;
  const closest = target && typeof (target as Element).closest === "function"
    ? (target as Element).closest(NATIVE_CONTEXT_MENU_TARGETS)
    : null;
  return !closest;
}

/**
 * Tauri's WebView menu includes a document-level Reload action. App chrome has no useful native
 * context actions, so suppress that menu there while preserving editing, links, selected text, and
 * the terminal's normal copy menu.
 */
export function installAppContextMenuBoundary(doc: Document = document): () => void {
  const handleContextMenu = (event: MouseEvent): void => {
    if (event.defaultPrevented) return;
    const selectedText = doc.getSelection()?.toString() ?? "";
    if (shouldSuppressAppContextMenu(event.target, selectedText)) event.preventDefault();
  };
  doc.addEventListener("contextmenu", handleContextMenu);
  return () => doc.removeEventListener("contextmenu", handleContextMenu);
}
