/**
 * Safari/WebKit can report `isComposing === false` for the Enter key that commits an IME
 * candidate. `keyCode === 229` is the interoperable fallback used by editors to keep that key
 * inside the composition instead of treating it as a submit shortcut.
 */
export function isImeCompositionKey(event: {
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  return event.isComposing === true || event.keyCode === 229;
}
